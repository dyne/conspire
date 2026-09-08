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
