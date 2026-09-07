import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { createFileChunkMessage } from '../../front/chat/protocol.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = resolve(root, process.env.CONSPIRE_E2E_BINARY ?? 'build/native-gcc/server/conspire-exe');
const messageCode = Object.freeze({
  info: 0,
  peerJoined: 1,
  peerMessage: 3,
  peerFile: 4,
  fileShare: 6,
  fileRequestChunk: 7,
});
const execFileAsync = promisify(execFile);

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
    'TLS_FILE_CERT_CHAIN', 'URL_STATS_PATH', 'STATS_STATE_PATH',
    'TOR_CONTROL_SOCKET', 'TOR_CONTROL_HOST', 'TOR_CONTROL_PORT',
    'TOR_BACKEND_PORT', 'TOR_VIRTUAL_PORT', 'TOR_KEY_PATH',
  ]) delete environment[name];

  const torConfigured = extraArguments.includes('--tor-control-port');
  const child = spawn(binary, [
    '--host', 'localhost', '--port', String(port),
    ...(torConfigured ? [] : ['--no-tor']), ...extraArguments,
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

async function connectClient(url, origin, headers = undefined) {
  const socket = new WebSocket(url, { origin, headers });
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

async function requestText(port, path, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', rejectRequest);
    request.end();
  });
}

async function requestBuffer(port, path, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once('error', rejectRequest);
    request.end();
  });
}

async function startFakeTor(cookiePath) {
  const serviceId = 'a'.repeat(56);
  const privateKey = `ED25519-V3:${'A'.repeat(86)}==`;
  const cookie = randomBytes(32);
  await writeFile(cookiePath, cookie, { mode: 0o600 });
  const commands = [];
  const connections = new Set();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    let buffered = '';
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      while (buffered.includes('\r\n')) {
        const lineEnd = buffered.indexOf('\r\n');
        const command = buffered.slice(0, lineEnd);
        buffered = buffered.slice(lineEnd + 2);
        commands.push(command);
        if (command === 'PROTOCOLINFO 1') {
          socket.write(`250-PROTOCOLINFO 1\r\n250-AUTH METHODS=SAFECOOKIE COOKIEFILE="${cookiePath}"\r\n250-VERSION Tor="test"\r\n250 OK\r\n`);
        } else if (command.startsWith('AUTHCHALLENGE SAFECOOKIE ')) {
          const clientNonce = Buffer.from(command.slice('AUTHCHALLENGE SAFECOOKIE '.length), 'hex');
          const serverNonce = randomBytes(32);
          const message = Buffer.concat([cookie, clientNonce, serverNonce]);
          const serverHash = createHmac('sha256',
            'Tor safe cookie authentication server-to-controller hash')
            .update(message).digest('hex').toUpperCase();
          socket.expectedClientHash = createHmac('sha256',
            'Tor safe cookie authentication controller-to-server hash')
            .update(message).digest('hex').toUpperCase();
          socket.write(`250 AUTHCHALLENGE SERVERHASH=${serverHash} SERVERNONCE=${serverNonce.toString('hex').toUpperCase()}\r\n`);
        } else if (command === `AUTHENTICATE ${socket.expectedClientHash}`) {
          socket.write('250 OK\r\n');
        } else if (command.startsWith('ADD_ONION NEW:ED25519-V3 ')) {
          socket.write(`250-ServiceID=${serviceId}\r\n250-PrivateKey=${privateKey}\r\n250 OK\r\n`);
        } else if (command.startsWith(`ADD_ONION ${privateKey} `)) {
          socket.write(`250-ServiceID=${serviceId}\r\n250 OK\r\n`);
        } else if (command === `DEL_ONION ${serviceId}`) {
          socket.write('250 OK\r\n');
        } else if (command === 'QUIT') {
          socket.end();
        } else {
          socket.write('510 Unrecognized command\r\n');
        }
      }
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    port: address.port,
    serviceId,
    privateKey,
    commands,
    close: async () => {
      for (const connection of connections) connection.destroy();
      await new Promise((resolveClose, rejectClose) => server.close(
        (error) => error ? rejectClose(error) : resolveClose(),
      ));
    },
  };
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

test('Tor ADD_ONION identity persists and onion Host/Origin drive the frontend',
  { timeout: 30_000 }, async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'conspire-tor-e2e-'));
    const keyPath = join(stateDirectory, 'onion.key');
    const cookiePath = join(stateDirectory, 'control.authcookie');
    const controlSocket = join(stateDirectory, 'missing-control.sock');
    const fakeTor = await startFakeTor(cookiePath);
    const onionHost = `${fakeTor.serviceId}.onion`;
    const onionOrigin = `http://${onionHost}`;
    let activeServer;
    let scenarioError;

    const torArguments = [
      '--tor-control-socket', controlSocket,
      '--tor-control-host', '127.0.0.1',
      '--tor-control-port', String(fakeTor.port),
      '--tor-key', keyPath,
    ];

    try {
      const firstPort = await reservePort();
      activeServer = startConspire(firstPort, torArguments);
      await waitForServer(activeServer, `http://localhost:${firstPort}`);
      await waitUntil('first ADD_ONION command', () =>
        fakeTor.commands.find((command) => command.startsWith('ADD_ONION ')));

      const homepage = await requestText(firstPort, '/', { Host: onionHost });
      assert.equal(homepage.status, 200);
      assert.match(homepage.body, />Tor hidden service<\/a>/);
      assert.match(homepage.body, new RegExp(`href="${onionOrigin}"`));

      const chatScript = await requestText(firstPort, '/room/tor-room/chat.js', {
        Host: onionHost,
      });
      assert.equal(chatScript.status, 200);
      assert.match(chatScript.body,
        new RegExp(`urlWebsocket: "ws://${onionHost}:80/api/ws/room/tor-room"`));

      const onionClient = await connectClient(
        `ws://127.0.0.1:${firstPort}/api/ws/room/tor-room/`, onionOrigin,
        { Host: onionHost },
      );
      await waitForMessage(onionClient, 'onion-origin peer onboarding',
        (message) => message.code === messageCode.info);
      await closeClient(onionClient);

      assert.deepEqual(await stopConspire(activeServer), { code: 0, signal: null });
      activeServer = undefined;
      assert(fakeTor.commands.includes(`DEL_ONION ${fakeTor.serviceId}`));
      assert.equal((await readFile(keyPath, 'utf8')).trim(), fakeTor.privateKey);
      assert.equal((await stat(keyPath)).mode & 0o077, 0);
      assert(fakeTor.commands.includes(
        `ADD_ONION NEW:ED25519-V3 Port=80,127.0.0.1:${firstPort}`));

      const secondPort = await reservePort();
      activeServer = startConspire(secondPort, torArguments);
      await waitForServer(activeServer, `http://localhost:${secondPort}`);
      await waitUntil('persistent-key ADD_ONION command', () =>
        fakeTor.commands.find((command) =>
          command.startsWith(`ADD_ONION ${fakeTor.privateKey} `)));
      assert(fakeTor.commands.includes(
        `ADD_ONION ${fakeTor.privateKey} Port=80,127.0.0.1:${secondPort}`));
      assert.deepEqual(await stopConspire(activeServer), { code: 0, signal: null });
      activeServer = undefined;

      const invalidKey = 'not-a-tor-key\n';
      await writeFile(keyPath, invalidKey, { mode: 0o600 });
      const thirdPort = await reservePort();
      activeServer = startConspire(thirdPort, torArguments);
      await waitForServer(activeServer, `http://localhost:${thirdPort}`);
      assert.equal(fakeTor.commands.filter(
        (command) => command.startsWith('ADD_ONION ')).length, 2);
      assert.match(activeServer.getOutput(), /Tor onion key is invalid or unreadable/);
      assert.deepEqual(await stopConspire(activeServer), { code: 0, signal: null });
      activeServer = undefined;
      assert.equal(await readFile(keyPath, 'utf8'), invalidKey);
    } catch (error) {
      scenarioError = error;
    }

    if (activeServer) {
      try {
        await stopConspire(activeServer);
      } catch (error) {
        scenarioError ??= error;
      }
    }
    await fakeTor.close();
    await rm(stateDirectory, { recursive: true, force: true });
    if (scenarioError) throw scenarioError;
  });

test('TLS mode exposes a separate loopback HTTP backend for onion port 80',
  { timeout: 30_000 }, async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'conspire-tor-tls-e2e-'));
    const certificatePath = join(stateDirectory, 'certificate.pem');
    const privateKeyPath = join(stateDirectory, 'private-key.pem');
    const cookiePath = join(stateDirectory, 'control.authcookie');
    const onionKeyPath = join(stateDirectory, 'onion.key');
    const controlSocket = join(stateDirectory, 'missing-control.sock');
    let fakeTor;
    let server;
    let scenarioError;

    try {
      await execFileAsync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-keyout', privateKeyPath,
        '-out', certificatePath,
      ]);
      fakeTor = await startFakeTor(cookiePath);
      const tlsPort = await reservePort();
      const backendPort = await reservePort();
      const onionHost = `${fakeTor.serviceId}.onion`;
      server = startConspire(tlsPort, [
        '--tls', '--tls-key', privateKeyPath, '--tls-chain', certificatePath,
        '--tor-control-socket', controlSocket,
        '--tor-control-host', '127.0.0.1',
        '--tor-control-port', String(fakeTor.port),
        '--tor-key', onionKeyPath,
        '--tor-backend-port', String(backendPort),
      ]);

      await waitUntil('Tor loopback HTTP backend', async () => {
        if (server.getProcessError()) throw server.getProcessError();
        if (server.child.exitCode !== null) {
          throw new Error(`server exited with ${server.child.exitCode}`);
        }
        const response = await requestText(backendPort, '/', { Host: onionHost });
        return response.status === 200;
      }, 10_000);
      assert(fakeTor.commands.includes(
        `ADD_ONION NEW:ED25519-V3 Port=80,127.0.0.1:${backendPort}`));

      const onionClient = await connectClient(
        `ws://127.0.0.1:${backendPort}/api/ws/room/tls-tor-room/`,
        `http://${onionHost}`, { Host: onionHost },
      );
      await waitForMessage(onionClient, 'TLS-mode onion peer onboarding',
        (message) => message.code === messageCode.info);
      await closeClient(onionClient);
      assert.deepEqual(await stopConspire(server), { code: 0, signal: null });
      server = undefined;
    } catch (error) {
      scenarioError = error;
    }

    if (server) {
      try {
        await stopConspire(server);
      } catch (error) {
        scenarioError ??= error;
      }
    }
    if (fakeTor) await fakeTor.close();
    await rm(stateDirectory, { recursive: true, force: true });
    if (scenarioError) throw scenarioError;
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

test('real server transfers file contents without disconnecting either peer',
  { timeout: 30_000 }, async () => {
    const port = await reservePort();
    const origin = `http://localhost:${port}`;
    const room = 'e2e-file-room';
    const websocketUrl = `ws://localhost:${port}/api/ws/room/${room}/`;
    const server = startConspire(port);
    const clients = [];
    const contents = Buffer.alloc(64 * 1024);
    for (let index = 0; index < contents.length; index += 1) contents[index] = index % 251;
    let scenarioError;

    try {
      await waitForServer(server, origin);
      const offerer = await connectClient(websocketUrl, origin);
      clients.push(offerer);
      await waitForMessage(offerer, 'file offerer onboarding',
        (message) => message.code === messageCode.info);

      const downloader = await connectClient(websocketUrl, origin);
      clients.push(downloader);
      await waitForMessage(downloader, 'file downloader onboarding',
        (message) => message.code === messageCode.info);

      let responseError;
      offerer.socket.on('message', (payload) => {
        try {
          const message = JSON.parse(payload.toString());
          if (message.code !== messageCode.fileRequestChunk) return;
          const request = message.files[0];
          const chunk = contents.subarray(
            request.chunkPosition, request.chunkPosition + request.chunkSize);
          offerer.socket.send(JSON.stringify(createFileChunkMessage(
            request, chunk.toString('base64'), chunk.length)));
        } catch (error) {
          responseError = error;
        }
      });

      await sendJson(offerer, {
        code: messageCode.fileShare,
        files: [{ clientFileId: 1, name: 'transfer.bin', size: contents.length }],
      });
      const shared = await waitForMessage(downloader, 'shared file announcement',
        (message) => message.code === messageCode.peerFile);
      const response = await fetch(
        `${origin}/room/${room}/file/${shared.files[0].serverFileId}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), contents);
      assert.ifError(responseError);
      assert.equal(offerer.socket.readyState, WebSocket.OPEN);
      assert.equal(downloader.socket.readyState, WebSocket.OPEN);
      assert.equal(offerer.messages.filter(
        (message) => message.code === messageCode.fileRequestChunk).length, 16);
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
      throw new Error(`${scenarioError.message}\nConspire output:\n${diagnostics}`,
        { cause: scenarioError });
    }
    assert.deepEqual(exit, { code: 0, signal: null }, `Conspire output:\n${diagnostics}`);
  });

test('real server transfers from a clearnet offerer to an onion downloader',
  { timeout: 30_000 }, async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), 'conspire-file-tor-e2e-'));
    const keyPath = join(stateDirectory, 'onion.key');
    const cookiePath = join(stateDirectory, 'control.authcookie');
    const controlSocket = join(stateDirectory, 'missing-control.sock');
    const fakeTor = await startFakeTor(cookiePath);
    const onionHost = `${fakeTor.serviceId}.onion`;
    const onionOrigin = `http://${onionHost}`;
    const port = await reservePort();
    const clearnetOrigin = `http://localhost:${port}`;
    const room = 'e2e-mixed-file-room';
    const websocketPath = `/api/ws/room/${room}/`;
    const server = startConspire(port, [
      '--tor-control-socket', controlSocket,
      '--tor-control-host', '127.0.0.1',
      '--tor-control-port', String(fakeTor.port),
      '--tor-key', keyPath,
    ]);
    const clients = [];
    const contents = Buffer.from('conspire mixed clearnet and onion transfer');
    let scenarioError;

    try {
      await waitForServer(server, clearnetOrigin);
      await waitUntil('file-transfer ADD_ONION command', () =>
        fakeTor.commands.find((command) => command.startsWith('ADD_ONION ')));

      const offerer = await connectClient(
        `ws://localhost:${port}${websocketPath}`, clearnetOrigin);
      clients.push(offerer);
      await waitForMessage(offerer, 'mixed file offerer onboarding',
        (message) => message.code === messageCode.info);

      const downloader = await connectClient(
        `ws://127.0.0.1:${port}${websocketPath}`, onionOrigin, { Host: onionHost });
      clients.push(downloader);
      await waitForMessage(downloader, 'mixed file downloader onboarding',
        (message) => message.code === messageCode.info);

      let responseError;
      offerer.socket.on('message', (payload) => {
        try {
          const message = JSON.parse(payload.toString());
          if (message.code !== messageCode.fileRequestChunk) return;
          const request = message.files[0];
          const chunk = contents.subarray(
            request.chunkPosition, request.chunkPosition + request.chunkSize);
          offerer.socket.send(JSON.stringify(createFileChunkMessage(
            request, chunk.toString('base64'), chunk.length)));
        } catch (error) {
          responseError = error;
        }
      });

      await sendJson(offerer, {
        code: messageCode.fileShare,
        files: [{ clientFileId: 1, name: 'mixed.txt', size: contents.length }],
      });
      const shared = await waitForMessage(downloader, 'mixed shared file announcement',
        (message) => message.code === messageCode.peerFile);
      const response = await requestBuffer(port,
        `/room/${room}/file/${shared.files[0].serverFileId}`, { Host: onionHost });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, contents);
      assert.ifError(responseError);
      assert.equal(offerer.socket.readyState, WebSocket.OPEN);
      assert.equal(downloader.socket.readyState, WebSocket.OPEN);
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
    try {
      const exit = await stopConspire(server);
      assert.deepEqual(exit, { code: 0, signal: null });
    } catch (error) {
      scenarioError ??= error;
    }
    await fakeTor.close();
    await rm(stateDirectory, { recursive: true, force: true });

    if (scenarioError) {
      throw new Error(`${scenarioError.message}\nConspire output:\n${server.getOutput()}`,
        { cause: scenarioError });
    }
  });
