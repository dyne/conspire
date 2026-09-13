import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const tag = Buffer.from(type); const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0); tag.copy(chunk, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([tag, payload])), 8 + payload.length);
  return chunk;
}

/** Small valid RGBA fixtures with actual intrinsic geometry, generated deterministically. */
function pngFixture(width, height, [red, green, blue]) {
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1); pixels[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      pixels[offset] = (red + x) & 255; pixels[offset + 1] = (green + y) & 255;
      pixels[offset + 2] = blue; pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

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
  const websocketFrames = [];
  let scenarioError;

  try {
    await waitForServer(server, origin);

    const trackPage = (page) => {
      page.on('pageerror', (error) => pageErrors.push(error));
      page.on('websocket', (socket) => {
        socket.on('framesent', (event) => websocketFrames.push(`sent ${event.payload}`));
        socket.on('framereceived', (event) => websocketFrames.push(`received ${event.payload}`));
      });
      return page;
    };

    const firstContext = await newSurfaceContext(browser, surfaceMatrix.desktop);
    contexts.push(firstContext);
    const dashboard = trackPage(await firstContext.newPage());
    const dashboardResponse = await dashboard.goto(`${origin}/dashboard`);
    expect(dashboardResponse?.status()).toBe(200);
    await expect(dashboard).toHaveTitle(`Conspire v${buildVersion} by Dyne.org`);
    await expect(dashboard.locator('.chart-container')).toHaveCount(4);
    await expect(dashboard.locator('.chart-data table')).toHaveCount(4);
    await dashboard.locator('#peer-chart-data summary').click();
    await expect(dashboard.getByRole('table')).toHaveCount(1);
    await expect(dashboard.getByRole('status')).toContainText('statistics records loaded');
    await expect(dashboard.locator('#peer-chart-data summary')).toBeVisible();
    await expect(dashboard.locator('#stats-url')).toHaveText(`${origin}/admin/stats.json`);
    await expect.poll(() => dashboard.evaluate(() => Object.keys(Chart.instances).length)).toBe(4);
    await dashboard.getByRole('button', { name: 'Refresh Data' }).focus();
    await expect(dashboard.getByRole('button', { name: 'Refresh Data' })).toHaveCSS('box-shadow', /rgba?\(/);
    await saveStableSurfaceScreenshot(dashboard, 'dashboard-desktop-light');

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
    await expect(first.getByRole('button', { name: 'Insert grinning face' })).toBeVisible();
    await expect(first.locator('#emoji button')).toHaveCount(15);
    const chooserPromise = first.waitForEvent('filechooser');
    await first.getByRole('button', { name: 'Share Files' }).click();
    await chooserPromise;
    await saveStableSurfaceScreenshot(first, 'chat-desktop-emoji-controls');
    const composer = first.getByPlaceholder('Type a message');
    await composer.fill('ab');
    await composer.evaluate((element) => element.setSelectionRange(1, 1));
    await first.getByRole('button', { name: 'Insert grinning face' }).click();
    await expect(composer).toHaveValue('a😀b');
    await composer.fill('');
    await expect(first.getByRole('button', { name: /participants/i })).toBeHidden();

    const compactContext = await newSurfaceContext(browser, surfaceMatrix.compact);
    contexts.push(compactContext);
    const compactLanding = trackPage(await compactContext.newPage());
    await compactLanding.goto(origin);
    await applyFontScale(compactLanding, surfaceMatrix.compact.fontScale);
    await expect(compactLanding.getByRole('main')).toBeVisible();
    await expect(compactLanding.getByRole('button', { name: 'Public Reception' })).toBeVisible();
    await saveStableSurfaceScreenshot(compactLanding, 'landing-compact-light-reduced-motion-200-font');

    const compactDashboard = trackPage(await compactContext.newPage());
    await compactDashboard.goto(`${origin}/dashboard`);
    await expect(compactDashboard.locator('.chart-container').first()).toHaveCSS('transition-duration', '0s');
    await expect(compactDashboard.getByRole('button', { name: 'Refresh Data' })).toHaveCSS('min-height', '44px');
    await saveStableSurfaceScreenshot(compactDashboard, 'dashboard-compact-light-reduced-motion-200-font');

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
    await expect(second.locator('#chat_activity')).toHaveText(new RegExp(`said: ${chatText}$`));

    const third = await openParticipant();
    await expect(third.locator('#participants_toggle #participant_count')).toHaveText('3');
    await expect(third.locator('.message-text', { hasText: chatText })).toBeVisible();
    await expect(third.locator('#chat_activity')).toHaveText('');

    // Browser network emulation closes the transport without changing the
    // document, so the v2 token must resume this same participant identity.
    await firstContext.setOffline(true);
    await expect(first.getByRole('status').first()).toContainText(/offline|reconnecting/i);
    await firstContext.setOffline(false);
    await expect(first.getByRole('status').first()).toHaveText('online');
    await expect(first.locator('#participants_toggle #participant_count')).toHaveText('3');

    const mobileContext = await newSurfaceContext(browser, surfaceMatrix.compact);
    contexts.push(mobileContext);
    const mobile = trackPage(await mobileContext.newPage());
    await mobile.goto(roomUrl);
    const drawerToggle = mobile.getByRole('button', { name: /participants/i });
    await expect(mobile.locator('#chat_participants')).toHaveCSS('transition-duration', '0s');
    await saveStableSurfaceScreenshot(mobile, 'chat-compact-emoji-controls');
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
    await drawerToggle.click();
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(mobile.locator('#chat_participants')).toHaveAttribute('aria-hidden', 'false');
    await expect(mobile.locator('#chat_history_wrapper')).toHaveJSProperty('inert', true);
    await expect(mobile.locator('#participants_heading')).toBeFocused();
    await mobile.keyboard.press('Escape');
    await expect(drawerToggle).toBeFocused();
    await expect(mobile.locator('#chat_participants')).toHaveAttribute('aria-hidden', 'true');
    await expect(mobile.locator('[id="participant_count"]')).toHaveCount(1);
    await mobile.setViewportSize({ width: 768, height: 1000 });
    await drawerToggle.click();
    await expect(mobile.locator('#chat_participants')).toHaveAttribute('aria-hidden', 'false');
    await mobile.locator('#participants_overlay').click({ position: { x: 4, y: 4 } });
    await expect(drawerToggle).toHaveAttribute('aria-expanded', 'false');
    await mobile.setViewportSize({ width: 769, height: 1000 });
    await expect(drawerToggle).toBeHidden();
    await expect(mobile.locator('#chat_participants')).toBeVisible();
    await mobile.setViewportSize({ width: 320, height: 812 });
    await mobile.evaluate(() => {
      const participant = document.createElement('div');
      participant.className = 'participant';
      participant.textContent = 'very-long-peer-name-without-natural-breaks-'.repeat(8);
      document.querySelector('#chat_participants')?.append(participant);
    });
    await expect.poll(() => mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const forcedColorsContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });
    contexts.push(forcedColorsContext);
    const forcedColorsDashboard = trackPage(await forcedColorsContext.newPage());
    await forcedColorsDashboard.goto(`${origin}/dashboard`);
    await expect.poll(() => forcedColorsDashboard.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    await forcedColorsDashboard.getByRole('button', { name: 'Refresh Data' }).focus();
    await expect(forcedColorsDashboard.getByRole('button', { name: 'Refresh Data' })).toBeFocused();

    const staleContext = await browser.newContext();
    contexts.push(staleContext);
    const stale = trackPage(await staleContext.newPage());
    const staleToken = 'x'.repeat(43);
    await stale.addInitScript(({ key, token }) => sessionStorage.setItem(key, JSON.stringify({ resumeToken: token, lastServerSeq: 0 })), {
      key: `conspire.session.v2:${origin}:/room/reception`, token: staleToken,
    });
    await stale.goto(roomUrl);
    await expect(stale.getByRole('status').first()).toHaveText('online');
    await expect.poll(() => stale.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || '{}').resumeToken,
      `conspire.session.v2:${origin}:/room/reception`)).not.toBe(staleToken);
    await expect(first.locator('#participants_toggle #participant_count')).toHaveText('5');
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
    const websocketDiagnostics = websocketFrames.length > 0
      ? `\nWebSocket frames:\n${websocketFrames.slice(-80).join('\n')}`
      : '';
    throw new Error(
      `${scenarioError.message}${browserDiagnostics}${websocketDiagnostics}\nConspire output:\n${diagnostics}`,
      { cause: scenarioError },
    );
  }
  expect(exit, `Conspire output:\n${diagnostics}`).toEqual({ code: 0, signal: null });
});

test('two fresh browser participants render one sequenced chat message', async ({ browser }) => {
  test.setTimeout(30_000);
  const port = await reservePort(); const origin = `http://localhost:${port}`; const roomUrl = `${origin}/room/reception`;
  const server = startConspire(port); const contexts = []; let failure; let first; let second;
  try {
    await waitForServer(server, origin);
    for (let index = 0; index < 2; index += 1) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage();
      await page.goto(roomUrl);
    }
    [first, second] = contexts.map((context) => context.pages()[0]);
    await expect(first.locator('#participants_toggle #participant_count')).toHaveText('2');
    await expect(second.locator('#participants_toggle #participant_count')).toHaveText('2');
    const text = `minimal-${Date.now()}`;
    await first.getByPlaceholder('Type a message').fill(text);
    await first.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(first.locator('.message-text', { hasText: text })).toBeVisible();
    await expect(second.locator('.message-text', { hasText: text })).toBeVisible();
    await expect(first.locator('.message-delivery')).toHaveText('sent');
  } catch (error) { failure = error; }
  for (const context of contexts.reverse()) await context.close().catch((error) => { failure ??= error; });
  await stopConspire(server).catch((error) => { failure ??= error; });
  if (failure) throw new Error(`${failure.message}\nConspire output:\n${server.getOutput()}`, { cause: failure });
});

test('image previews remain consent-gated, keyboard-operable, and contained at chat widths', async ({ browser }) => {
  test.setTimeout(35_000);
  const port = await reservePort(); const origin = `http://localhost:${port}`; const roomUrl = `${origin}/room/reception`;
  const server = startConspire(port); const contexts = []; let failure;
  try {
    await waitForServer(server, origin);
    const senderContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(senderContext);
    const recipientContext = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' }); contexts.push(recipientContext);
    const sender = await senderContext.newPage(); const recipient = await recipientContext.newPage();
    await Promise.all([sender.goto(roomUrl), recipient.goto(roomUrl)]);
    await expect(sender.locator('#participants_toggle #participant_count')).toHaveText('2');
    const choose = sender.waitForEvent('filechooser');
    await sender.getByRole('button', { name: 'Share Files' }).click();
    const longName = `${'unbroken-image-name-'.repeat(9)}square.png`;
    await (await choose).setFiles([
      { name: 'portrait.png', mimeType: 'image/png', buffer: pngFixture(140, 280, [28, 103, 210]) },
      { name: 'landscape.png', mimeType: 'image/png', buffer: pngFixture(280, 140, [220, 108, 40]) },
      { name: longName, mimeType: 'image/png', buffer: pngFixture(96, 96, [39, 161, 106]) },
      { name: 'malformed.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') },
    ]);
    const previews = recipient.locator('.image-preview');
    await expect(previews).toHaveCount(4);
    await expect(previews.nth(2).getByRole('status')).toContainText(longName);
    const portrait = previews.nth(0);
    await expect(portrait).toHaveAttribute('data-preview-state', 'offered');
    await expect(portrait.getByRole('status')).toContainText('require confirmation');
    await expect(portrait.getByRole('button', { name: /Load image/ })).toBeVisible();
    await expect(portrait.getByRole('button', { name: /Cancel image load/ })).toHaveCount(0);
    await expect(portrait.getByRole('link', { name: 'Download file' })).toBeVisible();
    await portrait.getByRole('button', { name: /Load image/ }).focus();
    await expect(portrait.getByRole('button', { name: /Load image/ })).toBeFocused();
    await recipient.keyboard.press('Enter');
    await expect(portrait.getByRole('status')).toContainText('Image loaded');
    const image = portrait.getByRole('img', { name: 'Shared image: portrait.png' });
    await expect(image).toBeVisible();
    await expect(portrait.getByRole('button', { name: 'Unload image' })).toBeVisible();
    await expect.poll(() => recipient.evaluate(() => {
      const tile = document.querySelector('.image-preview'); const imageElement = tile?.querySelector('img');
      return Boolean(tile && imageElement && tile.scrollWidth <= tile.clientWidth && imageElement.getBoundingClientRect().width <= tile.getBoundingClientRect().width);
    })).toBe(true);
    await saveStableSurfaceScreenshot(recipient, 'chat-image-preview-compact-375x667');
    await recipient.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => recipient.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await saveStableSurfaceScreenshot(recipient, 'chat-image-preview-desktop-1440x900');
    for (const [index, width, height] of [[1, 280, 140], [2, 96, 96]]) {
      const current = previews.nth(index);
      await current.getByRole('button', { name: /Load image/ }).click();
      const dimensions = await current.getByRole('img').evaluate((element) => ({
        naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
        width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        tileWidth: element.closest('.image-preview')?.getBoundingClientRect().width,
      }));
      expect(dimensions.naturalWidth).toBe(width); expect(dimensions.naturalHeight).toBe(height);
      expect(dimensions.width / dimensions.height).toBeCloseTo(width / height, 2);
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.tileWidth ?? 0);
    }
    const longNamePreview = previews.nth(2);
    await expect(longNamePreview.getByRole('img', { name: `Shared image: ${longName}` })).toBeVisible();
    await expect.poll(() => longNamePreview.evaluate((tile) => tile.scrollWidth <= tile.clientWidth)).toBe(true);
    const malformed = previews.nth(3);
    await malformed.getByRole('button', { name: /Load image/ }).click();
    await expect(malformed.getByRole('status')).toContainText('could not be safely displayed');
    await expect(malformed.getByRole('button', { name: 'Retry image preview' })).toBeVisible();
    await expect.poll(() => malformed.evaluate((tile) => tile.scrollWidth <= tile.clientWidth)).toBe(true);
    await recipient.setViewportSize({ width: 375, height: 667 });
    await recipient.evaluate(() => document.documentElement.style.setProperty('font-size', '200%'));
    await expect.poll(() => recipient.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await recipient.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await expect.poll(() => recipient.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    await portrait.getByRole('button', { name: 'Unload image' }).focus();
    await expect(portrait.getByRole('button', { name: 'Unload image' })).toHaveCSS('border-style', 'solid');
    await portrait.getByRole('button', { name: 'Unload image' }).click();
    await expect(portrait).toHaveAttribute('data-preview-state', 'cancelled');
    await expect(portrait.getByRole('button', { name: 'Retry image preview' })).toBeVisible();
  } catch (error) { failure = error; }
  for (const context of contexts.reverse()) await context.close().catch((error) => { failure ??= error; });
  await stopConspire(server).catch((error) => { failure ??= error; });
  if (failure) throw new Error(`${failure.message}\nConspire output:\n${server.getOutput()}`, { cause: failure });
});
