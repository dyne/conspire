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
  assert.equal((dashboard.match(/<h2\b/g) ?? []).length, 4);
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
  assert.match(controller, /dashboard\/vendor\/chart\.umd\.min\.js/);
  assert.match(controller, /script-src 'self';/);
  assert.doesNotMatch(controller, /cdn\.jsdelivr/);
  assert.doesNotMatch(controller, /loadFromFile|frontPath/);
});

test('dashboard exposes an equivalent semantic representation for every chart', async () => {
  const [html, app, readme] = await Promise.all([
    readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/README.md', import.meta.url), 'utf8'),
  ]);
  assert.equal((html.match(/class="chart-data"/g) ?? []).length, 4);
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 4);
  assert.match(html, /id="dashboard-status"[\s\S]*role="status"/);
  assert.match(app, /formatTimestamp/);
  assert.match(app, /formatValue/);
  assert.match(app, /METRICS\.forEach\(renderSemanticChart\)/);
  assert.doesNotMatch(app, /loadSampleData|Sample Data \(Demo Mode\)/);
  assert.match(readme, /Chart\.js 4\.4\.7/);
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

test('dashboard theme aliases remain defined, canonical, and explicitly overridable', async () => {
  const dashboard = await readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8');

  assert.doesNotMatch(dashboard, /--color-bg-[1-8]:/);
  assert.doesNotMatch(dashboard, /var\(--font-mono\)/);
  assert.equal((dashboard.match(/^\.control-buttons\s*\{/gm) ?? []).length, 1);
  assert.equal((dashboard.match(/^\.load-file-btn\s*\{/gm) ?? []).length, 1);
  assert.match(dashboard, /:root:not\(\[data-color-scheme\]\)/);
  assert.match(dashboard, /\[data-color-scheme="dark"\][\s\S]*--select-caret:\s*var\(--select-caret-dark\)/);
  assert.match(dashboard, /\[data-color-scheme="light"\][\s\S]*--select-caret:\s*var\(--select-caret-light\)/);
});

test('design documentation records the current source of truth and browser policy', async () => {
  const [design, sidecar, audit] = await Promise.all([
    readFile(new URL('../DESIGN.md', import.meta.url), 'utf8'),
    readFile(new URL('../.impeccable/design.json', import.meta.url), 'utf8'),
    readFile(new URL('../docs/FRONTEND_ASSET_REVIEW.md', import.meta.url), 'utf8'),
  ]);
  const parsed = JSON.parse(sidecar);
  assert.equal(parsed.schemaVersion, 2);
  assert.match(parsed.extensions.browserSupport, /Safari/);
  for (const heading of ['## Overview', '## Browser Support Policy', '## Colors', '## Typography', '## Layout']) {
    assert.ok(design.indexOf(heading) >= 0, heading);
  }
  assert.ok(design.indexOf('## Overview') < design.indexOf('## Browser Support Policy'));
  assert.match(audit, /docs\/landing-example\/style\.css/);
  assert.match(audit, /no longer uses inline CSP exceptions or a hardcoded port/);
});

test('motion uses shared tokens and never delays chat cleanup for reduced-motion users', async () => {
  const [tokens, chat, chatApp, dashboard] = await Promise.all([
    readFile(new URL('../front/design-system.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--ds-duration-fast:\s*0ms/);
  assert.match(tokens, /--ds-duration-normal:\s*0ms/);
  assert.doesNotMatch(chat, /transition:\s*(?:0\.3s|transform 0\.25s)/);
  assert.match(chat, /var\(--ds-duration-normal\) var\(--ds-ease-standard\)/);
  assert.match(dashboard, /var\(--duration-fast\) var\(--ease-standard\)/);
  assert.match(chatApp, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(chatApp, /function removeParticipantElement[\s\S]*setTimeout\(finish, 400\)/);
});

test('responsive surfaces preserve target sizes and contain long operational content', async () => {
  const [landing, chat, dashboard] = await Promise.all([
    readFile(new URL('../front/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(landing, /button,[\s\S]*min-block-size:\s*44px/);
  assert.match(chat, /#participants_toggle[\s\S]*min-block-size:\s*40px/);
  assert.match(chat, /\.participant[\s\S]*min-height:\s*32px[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(chat, /\.message-div-files a[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(dashboard, /\.refresh-btn[\s\S]*min-block-size:\s*44px/);
  assert.match(dashboard, /\.load-file-btn[\s\S]*min-block-size:\s*44px/);
  assert.match(dashboard, /\.chart-data table \{ min-width: max-content;/);
});

test('browser-owned surfaces keep semantic styling with forced-colors fallbacks', async () => {
  const [landing, chat, dashboard] = await Promise.all([
    readFile(new URL('../front/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../dashboard/style.css', import.meta.url), 'utf8'),
  ]);

  for (const [file, css] of [
    ['front/style.css', landing],
    ['front/chat/chat.css', chat],
    ['dashboard/style.css', dashboard],
  ]) {
    assert.match(css, /::selection/, file);
    assert.match(css, /@media \(forced-colors: active\)/, file);
    assert.match(css, /scrollbar-color:\s*auto/, file);
  }
  assert.match(landing, /caret-color:/);
  assert.match(chat, /font-variant-numeric:\s*tabular-nums/);
  assert.match(dashboard, /text-underline-offset:/);
  assert.match(dashboard, /color-scheme:\s*light dark/);
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
