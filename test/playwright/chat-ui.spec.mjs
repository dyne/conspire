import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  applyFontScale,
  computedToken,
  focusNext,
  newSurfaceContext,
  saveStableSurfaceScreenshot,
  surfaceMatrix,
} from './surface-fixtures.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = resolve(root, process.env.CONSPIRE_E2E_BINARY ?? 'build/native-gcc/server/conspire-exe');
const buildVersion = process.env.CONSPIRE_E2E_VERSION ?? 'e2e';

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reservePort() {
  const reservation = createServer();
  await new Promise((resolveListen, rejectListen) => {
    reservation.once('error', rejectListen);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a localhost port');
  await new Promise((resolveClose, rejectClose) => reservation.close(
    (error) => error ? rejectClose(error) : resolveClose(),
  ));
  return address.port;
}

function startConspire(port) {
  const environment = { ...process.env };
  for (const name of [
    'EXTERNAL_ADDRESS', 'EXTERNAL_PORT', 'TLS_FILE_PRIVATE_KEY',
    'TLS_FILE_CERT_CHAIN', 'URL_STATS_PATH',
  ]) delete environment[name];

  const child = spawn(binary, [
    '--host', 'localhost', '--port', String(port), '--no-tor',
  ], {
    cwd: tmpdir(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const appendOutput = (chunk) => { output = `${output}${chunk}`.slice(-64 * 1024); };
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
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.getProcessError()) throw server.getProcessError();
    if (server.child.exitCode !== null) {
      throw new Error(`Conspire exited with ${server.child.exitCode}\n${server.getOutput()}`);
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  throw new Error(`Timed out waiting for Conspire: ${lastError?.message ?? 'not ready'}`);
}

async function stopConspire(server) {
  if (server.child.exitCode === null) server.child.kill('SIGTERM');
  let timeoutId;
  const timeout = new Promise((_, rejectTimeout) => {
    timeoutId = setTimeout(() => {
      server.child.kill('SIGKILL');
      rejectTimeout(new Error('Timed out stopping Conspire'));
    }, 7_000);
  });
  try {
    return await Promise.race([server.exit, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

test('users chat through the browser UI and a newcomer receives history', async ({ browser }) => {
  test.setTimeout(45_000);
  const port = await reservePort();
  const origin = `http://localhost:${port}`;
  const roomUrl = `${origin}/room/reception`;
  const server = startConspire(port);
  const contexts = [];
  const pageErrors = [];
  let scenarioError;

  try {
    await waitForServer(server, origin);

    const trackPage = (page) => {
      page.on('pageerror', (error) => pageErrors.push(error));
      return page;
    };

    const firstContext = await newSurfaceContext(browser, surfaceMatrix.desktop);
    contexts.push(firstContext);
    await firstContext.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: 'globalThis.Chart = class { constructor() { globalThis.__chartCount = (globalThis.__chartCount ?? 0) + 1; } destroy() {} };',
    }));

    const dashboard = trackPage(await firstContext.newPage());
    const dashboardResponse = await dashboard.goto(`${origin}/dashboard`);
    expect(dashboardResponse?.status()).toBe(200);
    await expect(dashboard).toHaveTitle(`Conspire v${buildVersion} by Dyne.org`);
    await expect(dashboard.locator('.chart-container')).toHaveCount(4);
    await expect(dashboard.locator('#stats-url')).toHaveText(`${origin}/admin/stats.json`);
    await expect.poll(() => dashboard.evaluate(() => globalThis.__chartCount ?? 0)).toBe(4);
    await dashboard.getByRole('button', { name: 'Refresh Data' }).focus();
    await expect(dashboard.getByRole('button', { name: 'Refresh Data' })).toHaveCSS('box-shadow', /rgba?\(/);

    const landing = trackPage(await firstContext.newPage());
    await landing.goto(origin);
    await expect(landing).toHaveTitle(`Conspire v${buildVersion} by Dyne.org`);
    await expect(landing.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(landing.getByRole('button', { name: 'Public Reception' })).toBeVisible();
    await expect(landing.getByRole('button', { name: 'New Private Room' })).toBeVisible();
    await expect(landing.getByRole('link', { name: 'Tor hidden service' })).toHaveCount(0);
    expect(await computedToken(landing, 'body', 'font-family')).toContain('system-ui');
    await saveStableSurfaceScreenshot(landing, 'landing-desktop-light');

    expect(await focusNext(landing)).toBe('public-room-button');
    await expect(landing.getByRole('button', { name: 'Public Reception' })).toBeFocused();
    await expect(landing.getByRole('button', { name: 'Public Reception' })).toHaveCSS('outline-style', 'solid');
    const firstPageOpened = firstContext.waitForEvent('page');
    await landing.keyboard.press('Enter');
    const first = trackPage(await firstPageOpened);
    await first.waitForLoadState();
    await expect(first).toHaveURL(roomUrl);
    await expect(first.locator('#chat_container')).toHaveCSS('background-color', 'rgb(66, 66, 66)');
    await expect(first.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Share Files' })).toBeVisible();
    await first.getByRole('button', { name: 'Send', exact: true }).focus();
    await expect(first.getByRole('button', { name: 'Send', exact: true })).toHaveCSS('outline-style', 'solid');

    const compactContext = await newSurfaceContext(browser, surfaceMatrix.compact);
    contexts.push(compactContext);
    const compactLanding = trackPage(await compactContext.newPage());
    await compactLanding.goto(origin);
    await applyFontScale(compactLanding, surfaceMatrix.compact.fontScale);
    await expect(compactLanding.getByRole('main')).toBeVisible();
    await expect(compactLanding.getByRole('button', { name: 'Public Reception' })).toBeVisible();
    await saveStableSurfaceScreenshot(compactLanding, 'landing-compact-light-reduced-motion-200-font');

    const openParticipant = async () => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = trackPage(await context.newPage());
      await page.goto(roomUrl);
      await expect(page).toHaveTitle(`Conspire v${buildVersion} by Dyne.org`);
      return page;
    };

    await expect(first.locator('#participants_toggle #participant_count')).toHaveText('1');

    const second = await openParticipant();
    await expect(first.locator('#participants_toggle #participant_count')).toHaveText('2');
    await expect(second.locator('#participants_toggle #participant_count')).toHaveText('2');

    const chatText = `playwright-${Date.now()}`;
    await first.getByPlaceholder('Type a message').fill(chatText);
    await first.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(first.locator('.message-text', { hasText: chatText })).toBeVisible();
    await expect(second.locator('.message-text', { hasText: chatText })).toBeVisible();

    const third = await openParticipant();
    await expect(third.locator('#participants_toggle #participant_count')).toHaveText('3');
    await expect(third.locator('.message-text', { hasText: chatText })).toBeVisible();
    expect(pageErrors, pageErrors.map((error) => error.message).join('\n')).toEqual([]);
  } catch (error) {
    scenarioError = error;
  }

  for (const context of contexts.reverse()) {
    try {
      await context.close();
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
    const browserDiagnostics = pageErrors.length > 0
      ? `\nBrowser errors:\n${pageErrors.map((error) => error.stack ?? error.message).join('\n')}`
      : '';
    throw new Error(
      `${scenarioError.message}${browserDiagnostics}\nConspire output:\n${diagnostics}`,
      { cause: scenarioError },
    );
  }
  expect(exit, `Conspire output:\n${diagnostics}`).toEqual({ code: 0, signal: null });
});
