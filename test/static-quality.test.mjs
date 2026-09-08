import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = ['front/index.html', 'front/chat/index.html', 'dashboard/index.html'];

test('shipped HTML keeps executable behavior in external modules', async () => {
  for (const file of files) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /\son(?:click|change|submit|load)=/i, file);
    assert.match(html, /<script[^>]+src=/i, file);
  }
});

test('served pages expose the build-version title placeholder', async () => {
  for (const file of ['front/index.html', 'front/chat/index.html', 'dashboard/index.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /<title>%%%CONSPIRE_TITLE%%%<\/title>/, file);
  }

  const controller = await readFile(
    new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8');
  assert.match(controller, /pageTitle\(version/);
  assert.match(controller, /replaceLiteral\(page, "%%%CONSPIRE_TITLE%%%"/);
});

test('production pages expose truthful metadata and a navigable landmark outline', async () => {
  const [landing, chat, dashboard] = await Promise.all(files.map((file) =>
    readFile(new URL(`../${file}`, import.meta.url), 'utf8')));

  for (const [file, html] of [[files[0], landing], [files[1], chat], [files[2], dashboard]]) {
    assert.match(html, /<html\s+lang="en">/i, file);
    assert.equal((html.match(/<meta\s+charset=/gi) ?? []).length, 1, file);
    assert.equal((html.match(/<h1[\s>]/gi) ?? []).length, 1, file);
  }

  assert.doesNotMatch(landing, /Jaromil|dyne\.org\/img\/jaromil|\$\{NAME\}/i);
  assert.match(landing, /property="og:title" content="Conspire"/);
  assert.match(landing, /<header[\s>][\s\S]*<main[\s>]/);
  assert.match(chat, /<header\s+id="chat_status"[\s>][\s\S]*<main\s+id="chat_main"[\s>][\s\S]*<aside\s+id="chat_participants"[\s>][\s\S]*<footer\s+id="chat_input_container"/);
  assert.match(dashboard, /<main\s+class="dashboard-grid"[\s>]/);
  assert.equal((dashboard.match(/<h2>/g) ?? []).length, 4);
  assert.doesNotMatch(dashboard, /<h3>.*Activity|<h3>Communication|<h3>System Metrics/);
});

test('production controls preserve zoom and expose a visible keyboard focus treatment', async () => {
  const [landing, chat, landingCss, chatCss, dashboardCss] = await Promise.all([
    readFile(new URL('../front/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../front/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(chat, /(?:maximum-scale|user-scalable)/i);
  assert.match(landing, /<button id="public-room-button" type="button">Public Reception<\/button>/);
  assert.match(landing, /<button id="private-room-button" type="button">New Private Room<\/button>/);
  for (const [file, css] of [
    ['front/style.css', landingCss],
    ['front/chat/chat.css', chatCss],
    ['dashboard/style.css', dashboardCss],
  ]) assert.match(css, /:focus-visible[\s\S]*outline:/, file);
  assert.doesNotMatch(landingCss, /input\s*,\s*\.button[\s\S]*outline:\s*none/);
  assert.doesNotMatch(chatCss, /form textarea[\s\S]*outline:\s*none/);
});

test('the landing page has a build-time-safe onion-service insertion point', async () => {
  const [html, controller] = await Promise.all([
    readFile(new URL('../front/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /%%%TOR_HIDDEN_SERVICE_BUTTON%%%/);
  assert.match(controller, /getOnionBaseUrl\(\)/);
  assert.match(controller, />Tor hidden service<\/a>/);
  assert.match(controller, /htmlText\(\*onionBaseUrl\)/);
});

test('the server embeds its complete frontend and dashboard instead of loading runtime files', async () => {
  const [cmake, generator, controller] = await Promise.all([
    readFile(new URL('../server/CMakeLists.txt', import.meta.url), 'utf8'),
    readFile(new URL('../server/cmake/EmbedFrontend.cmake', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(cmake, /GLOB_RECURSE CONSPIRE_FRONTEND_ASSETS CONFIGURE_DEPENDS/);
  assert.match(cmake, /GLOB_RECURSE CONSPIRE_DASHBOARD_ASSETS CONFIGURE_DEPENDS/);
  assert.match(cmake, /EmbedFrontend\.cmake/);
  assert.match(generator, /register_asset_directory\("\$\{FRONTEND_DIR\}" ""\)/);
  assert.match(generator, /register_asset_directory\("\$\{DASHBOARD_DIR\}" "dashboard\/"\)/);
  assert.match(controller, /findAsset\(path\)/);
  assert.match(controller, /loadAsset\("style\.css"\)/);
  assert.match(controller, /loadAsset\("design-system\.css"\)/);
  assert.match(controller, /"dashboard", Dashboard/);
  assert.match(controller, /loadAsset\("dashboard\/index\.html"\)/);
  assert.match(controller, /ConspireDashboardConfig = \{statsUrl:/);
  assert.doesNotMatch(controller, /loadFromFile|frontPath/);
});

test('all production surfaces consume the embedded shared design primitives', async () => {
  const [tokens, landing, chat, chatApp, dashboard, dashboardApp, controller] = await Promise.all([
    readFile(new URL('../front/design-system.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);

  for (const stylesheet of [landing, chat, dashboard]) {
    assert.match(stylesheet, /@import url\("\/design-system\.css"\)/);
  }
  assert.match(tokens, /--ds-color-action:\s*#448aff/);
  assert.match(tokens, /--ds-font-sans:/);
  assert.match(tokens, /--ds-space-16:\s*16px/);
  assert.match(tokens, /--ds-peer-17:\s*#eceff1/);
  assert.match(tokens, /--ds-chart-10:\s*#13343b/);
  assert.match(chat, /var\(--ds-peer-0\)/);
  assert.match(chatApp, /classList\.add\("participant_self"\)/);
  assert.doesNotMatch(chatApp, /style\.backgroundColor/);
  assert.match(controller, /ENDPOINT_ASYNC\("GET", "design-system\.css", DesignSystemCSS\)/);
  assert.doesNotMatch(dashboardApp, /style\.cssText|const colors = \[/);
  assert.match(dashboardApp, /CHART_COLOR_TOKENS/);
});

test('server admission and malformed-message guards remain explicit', async () => {
  const lobby = await readFile(new URL('../server/src/rooms/Lobby.cpp', import.meta.url), 'utf8');
  const room = await readFile(new URL('../server/src/rooms/Room.cpp', import.meta.url), 'utf8');
  const peer = await readFile(new URL('../server/src/rooms/Peer.cpp', import.meta.url), 'utf8');
  assert.match(room, /Limits::peersPerRoom/);
  assert.match(lobby, /room && room->hasPeerCapacity\(\)/);
  assert.match(lobby, /found->second == room && room->isEmpty\(\)/);
  assert.match(lobby, /lock\(m_roomsMutex\)[\s\S]*room->addPeer\(peer\)/);
  assert.match(peer, /filesList->size\(\) != 1/);
  assert.match(peer, /if \(!message\) return onApiError\("No message provided\."\);[\s\S]*message->peerName/);
});
