import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageCode, humanFileSize, parseProtocolMessage, roomFileUrl } from '../front/chat/protocol.js';
import { createChatState } from '../front/chat/state.js';
import { humanFileSize as formatFileSize } from '../front/chat/format.js';
import { readFile } from 'node:fs/promises';

test('protocol parser accepts every supported message code', () => {
  for (const code of Object.values(MessageCode)) {
    assert.deepEqual(parseProtocolMessage(JSON.stringify({ code })), { code });
  }
});

test('protocol parser rejects hostile, malformed, and oversized payloads', () => {
  for (const payload of [null, '', '{', '[]', '{"code":99}', 'x'.repeat(8193)]) {
    assert.equal(parseProtocolMessage(payload), null);
  }
});

test('file URLs and file sizes are deterministic at boundaries', () => {
  assert.equal(roomFileUrl('/room/a/', 0), '/room/a/file/0');
  assert.equal(roomFileUrl('/room/a', -1), null);
  assert.equal(roomFileUrl('/room/a', Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(humanFileSize(0), '0 B');
  assert.equal(humanFileSize(1024), '1.0 kB');
  assert.equal(humanFileSize(-1), '0 B');
});

test('chat state and formatting modules are isolated from the DOM', () => {
  const first = createChatState();
  const second = createChatState();
  first.nextFileId += 1;
  first.peers.set(1, { peerName: 'Ada' });
  assert.equal(second.nextFileId, 1);
  assert.equal(second.peers.size, 0);
  assert.equal(formatFileSize(1024), '1.0 kB');
  assert.equal(formatFileSize(-1), '0 B');
});

test('the shipped chat receive path imports and validates the protocol module', async () => {
  const chat = await readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /import\(urlRoom \+ "\/protocol\.js"\)/);
  assert.match(chat, /protocol\.parseProtocolMessage\(event\.data\)/);
  assert.doesNotMatch(chat, /onMessage\(JSON\.parse\(event\.data\)\)/);
});

test('room module imports have explicit matching server routes', async () => {
  const [chat, ui, controller] = await Promise.all([
    readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(chat, /from '\.\/format\.js'/);
  assert.match(chat, /from '\.\/state\.js'/);
  assert.match(ui, /from '\.\/chat\.js'/);
  for (const route of ['format.js', 'state.js', 'chat.js', 'ui.js', 'protocol.js']) {
    assert.match(controller, new RegExp(`room/\\{roomId\\}/${route.replace('.', '\\.')}`));
  }
  assert.doesNotMatch(controller, /\{module:/);
});

test('dashboard keeps hostile strings out of HTML sinks and does not proxy statistics', async () => {
  const dashboard = await readFile(new URL('../dashboard/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /\.innerHTML\s*=/);
  assert.doesNotMatch(dashboard, /cors-anywhere|tryProxyUrl/);
  assert.match(dashboard, /safeStatsUrl/);
  assert.match(dashboard, /MAX_STATS_BYTES/);
  assert.match(dashboard, /validStats\(data\)/);
  assert.doesNotMatch(html, /\sonclick=/);
});

test('room UI registers CSP-compatible handlers from an external script', async () => {
  const room = await readFile(new URL('../front/chat/index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../front/chat/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(room, /\son(?:click|change)=/);
  assert.doesNotMatch(room, /<style/);
  assert.match(room, /chat\.css/);
  assert.match(room, /ui\.js/);
  assert.match(ui, /addEventListener\('click'/);
  assert.match(ui, /addEventListener\('change'/);
});

test('lobby actions are CSP-compatible external listeners', async () => {
  const lobby = await readFile(new URL('../front/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../front/lobby.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lobby, /\sonclick=|<script>(?!\s*src)/);
  assert.match(lobby, /lobby\.js/);
  assert.match(script, /noopener,noreferrer/);
});
