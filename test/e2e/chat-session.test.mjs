import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = resolve(root, process.env.CONSPIRE_E2E_BINARY ?? 'build/native-gcc/server/conspire-exe');
const messageCode = Object.freeze({ info: 0, peerJoined: 1, peerMessage: 3 });

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function withTimeout(promise, milliseconds, message, onTimeout = () => {}) {
  return new Promise((resolveTimed, rejectTimed) => {
    const timeout = setTimeout(() => {
      onTimeout();
      rejectTimed(new Error(message));
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolveTimed(value);
      },
      (error) => {
        clearTimeout(timeout);
        rejectTimed(error);
      },
    );
  });
}

async function waitUntil(description, evaluate, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const { port } = address;
  await new Promise((resolveClose, rejectClose) => server.close((error) => {
    if (error) rejectClose(error);
    else resolveClose();
  }));
  return port;
}

function startConspire(port, extraArguments = []) {
  const environment = { ...process.env };
  for (const name of [
    'EXTERNAL_ADDRESS', 'EXTERNAL_PORT', 'TLS_FILE_PRIVATE_KEY',
    'TLS_FILE_CERT_CHAIN', 'URL_STATS_PATH',
  ]) delete environment[name];

  const child = spawn(binary, [
    '--host', 'localhost', '--port', String(port), ...extraArguments,
  ], {
    cwd: tmpdir(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const appendOutput = (chunk) => {
    output = `${output}${chunk}`.slice(-64 * 1024);
  };
  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);

  let processError;
  child.once('error', (error) => { processError = error; });
  const exit = new Promise((resolveExit) => child.once('exit', (code, signal) => {
    resolveExit({ code, signal });
  }));
  return { child, exit, getOutput: () => output, getProcessError: () => processError };
}

async function waitForServer(server, origin) {
  await waitUntil('Conspire HTTP readiness', async () => {
    if (server.getProcessError()) throw server.getProcessError();
    if (server.child.exitCode !== null) throw new Error(`server exited with ${server.child.exitCode}`);
    const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  }, 10_000);
}

async function connectClient(url, origin) {
  const socket = new WebSocket(url, { origin });
  const messages = [];
  const socketErrors = [];
  socket.on('message', (payload) => {
    try {
      messages.push(JSON.parse(payload.toString()));
    } catch (error) {
      socketErrors.push(error);
    }
  });
  socket.on('error', (error) => socketErrors.push(error));

  await new Promise((resolveOpen, rejectOpen) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('open', onOpen);
      socket.off('error', onConnectionError);
      socket.off('unexpected-response', onUnexpectedResponse);
    };
    const rejectConnection = (error) => {
      cleanup();
      socket.terminate();
      rejectOpen(error);
    };
    const onOpen = () => {
      cleanup();
      resolveOpen();
    };
    const onConnectionError = (error) => rejectConnection(error);
    const onUnexpectedResponse = (_request, response) => {
      response.resume();
      rejectConnection(new Error(`WebSocket upgrade returned HTTP ${response.statusCode}`));
    };
    const timeout = setTimeout(
      () => rejectConnection(new Error(`Timed out opening ${url}`)), 5_000);
    socket.once('open', onOpen);
    socket.once('error', onConnectionError);
    socket.once('unexpected-response', onUnexpectedResponse);
  });
  return { socket, messages, socketErrors };
}

async function waitForMessage(client, description, predicate) {
  return waitUntil(description, () => {
    if (client.socketErrors.length > 0) throw client.socketErrors[0];
    return client.messages.find(predicate);
  });
}

async function sendJson(client, message) {
  await new Promise((resolveSend, rejectSend) => client.socket.send(
    JSON.stringify(message),
    (error) => error ? rejectSend(error) : resolveSend(),
  ));
}

async function closeClient(client) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise((resolveClose) => client.socket.once('close', resolveClose));
  client.socket.close(1000);
  await withTimeout(closed, 2_000, 'Timed out closing WebSocket client');
}

async function stopConspire(server) {
  if (server.child.exitCode === null) server.child.kill('SIGTERM');
  return withTimeout(server.exit, 7_000, 'Timed out stopping Conspire',
    () => server.child.kill('SIGKILL'));
}

test('real server serves its embedded dashboard and configured statistics path',
  { timeout: 30_000 }, async () => {
    const port = await reservePort();
    const origin = `http://localhost:${port}`;
    const server = startConspire(port, ['--url-stats', 'metrics/live.json']);
    let scenarioError;

    try {
      await waitForServer(server, origin);
      const [page, pageWithSlash, stylesheet, script, sample, statistics] = await Promise.all([
        fetch(`${origin}/dashboard`),
        fetch(`${origin}/dashboard/`),
        fetch(`${origin}/dashboard/style.css`),
        fetch(`${origin}/dashboard/app.js`),
        fetch(`${origin}/dashboard/sample-stats.json`),
        fetch(`${origin}/metrics/live.json`),
      ]);

      assert.equal(page.status, 200);
      assert.equal(pageWithSlash.status, 200);
      assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
      assert.match(await page.text(), /<title>Conspire ve2e by Dyne\.org<\/title>/);
      assert.match(stylesheet.headers.get('content-type') ?? '', /^text\/css/);
      assert.match(await stylesheet.text(), /\.dashboard-grid/);
      assert.match(script.headers.get('content-type') ?? '', /^text\/javascript/);
      assert.match(await script.text(),
        /ConspireDashboardConfig = \{statsUrl: "\/metrics\/live\.json"\}/);
      assert.match(sample.headers.get('content-type') ?? '', /^application\/json/);
      assert(Array.isArray(await sample.json()));
      const points = await statistics.json();
      assert(Array.isArray(points));
      assert(points.length > 0);
    } catch (error) {
      scenarioError = error;
    }

    let exit;
    try {
      exit = await stopConspire(server);
    } catch (error) {
      scenarioError ??= error;
    }

    const diagnostics = server.getOutput();
    if (scenarioError) {
      throw new Error(`${scenarioError.message}\nConspire output:\n${diagnostics}`,
        { cause: scenarioError });
    }
    assert.deepEqual(exit, { code: 0, signal: null }, `Conspire output:\n${diagnostics}`);
  });

test('statistics survive a graceful process restart', { timeout: 30_000 }, async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'conspire-statistics-e2e-'));
  const statePath = join(stateDirectory, 'stats.json');
  let activeServer;
  let scenarioError;

  try {
    const firstPort = await reservePort();
    const firstOrigin = `http://localhost:${firstPort}`;
    activeServer = startConspire(firstPort, ['--stats-state', statePath]);
    await waitForServer(activeServer, firstOrigin);
    await fetch(`${firstOrigin}/`);
    await fetch(`${firstOrigin}/`);
    assert.deepEqual(await stopConspire(activeServer), { code: 0, signal: null });
    activeServer = undefined;

    const savedBeforeRestart = JSON.parse(await readFile(statePath, 'utf8'));
    assert(savedBeforeRestart.length > 0);
    const beforeRestart = savedBeforeRestart.at(-1);
    assert(beforeRestart.ev_front_page_loaded >= 2);

    const secondPort = await reservePort();
    const secondOrigin = `http://localhost:${secondPort}`;
    activeServer = startConspire(secondPort, ['--stats-state', statePath]);
    await waitForServer(activeServer, secondOrigin);
    const restored = await (await fetch(`${secondOrigin}/admin/stats.json`)).json();
    assert(restored.length > 0);
    assert(restored.at(-1).ev_front_page_loaded >= beforeRestart.ev_front_page_loaded);
    assert(restored.some((point) => point.timestamp === beforeRestart.timestamp));
  } catch (error) {
    scenarioError = error;
  }

  if (activeServer) {
    try {
      const exit = await stopConspire(activeServer);
      assert.deepEqual(exit, { code: 0, signal: null });
    } catch (error) {
      scenarioError ??= error;
    }
  }
  await rm(stateDirectory, { recursive: true, force: true });

  if (scenarioError) throw scenarioError;
});

test('invalid statistics state is preserved without blocking startup',
  { timeout: 30_000 }, async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'conspire-invalid-statistics-e2e-'));
    const statePath = join(stateDirectory, 'stats.json');
    const invalidState = '{not valid json';
    await writeFile(statePath, invalidState);
    const port = await reservePort();
    const origin = `http://localhost:${port}`;
    const server = startConspire(port, ['--stats-state', statePath]);

    try {
      await waitForServer(server, origin);
      assert.deepEqual(await stopConspire(server), { code: 0, signal: null });
      assert.equal(await readFile(statePath, 'utf8'), invalidState);
    } finally {
      if (server.child.exitCode === null) await stopConspire(server);
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

test('real server broadcasts chat messages and supplies room history', { timeout: 30_000 }, async () => {
  const port = await reservePort();
  const origin = `http://localhost:${port}`;
  const websocketUrl = `ws://localhost:${port}/api/ws/room/e2e-room/`;
  const server = startConspire(port);
  const clients = [];
  let scenarioError;

  try {
    await waitForServer(server, origin);

    const first = await connectClient(websocketUrl, origin);
    clients.push(first);
    const firstInfo = await waitForMessage(first, 'first peer onboarding',
      (message) => message.code === messageCode.info);
    assert.equal(firstInfo.peers.length, 1);

    const second = await connectClient(websocketUrl, origin);
    clients.push(second);
    const joined = await waitForMessage(first, 'second peer join announcement',
      (message) => message.code === messageCode.peerJoined);
    assert.equal(typeof joined.peerId, 'number');

    const secondInfo = await waitForMessage(second, 'second peer onboarding',
      (message) => message.code === messageCode.info);
    assert.equal(secondInfo.peers.length, 2);

    const chatText = `end-to-end-${Date.now()}`;
    await sendJson(first, { code: messageCode.peerMessage, message: chatText });
    const broadcast = await waitForMessage(second, 'chat broadcast',
      (message) => message.code === messageCode.peerMessage && message.message === chatText);
    assert.equal(typeof broadcast.peerId, 'number');
    assert.equal(typeof broadcast.peerName, 'string');
    assert.equal(typeof broadcast.timestamp, 'number');

    const third = await connectClient(websocketUrl, origin);
    clients.push(third);
    const thirdInfo = await waitForMessage(third, 'third peer history',
      (message) => message.code === messageCode.info);
    assert.equal(thirdInfo.peers.length, 3);
    assert(thirdInfo.history.some(
      (message) => message.code === messageCode.peerMessage && message.message === chatText));
  } catch (error) {
    scenarioError = error;
  }

  for (const client of clients.reverse()) {
    try {
      await closeClient(client);
    } catch (error) {
      scenarioError ??= error;
    }
  }

  let exit;
  try {
    exit = await stopConspire(server);
  } catch (error) {
    scenarioError ??= error;
  }

  const diagnostics = server.getOutput();
  if (scenarioError) {
    throw new Error(`${scenarioError.message}\nConspire output:\n${diagnostics}`, { cause: scenarioError });
  }
  assert.deepEqual(exit, { code: 0, signal: null }, `Conspire output:\n${diagnostics}`);
});
