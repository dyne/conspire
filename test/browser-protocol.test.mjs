import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MessageCode,
  createFileChunkMessage,
  humanFileSize,
  parseProtocolMessage,
  roomFileUrl,
} from '../front/chat/protocol.js';
import { createHandshakeInbox, createReliabilityState, reconcileReplay, retryPendingCommands } from '../front/chat/reliability.js';
import { ReconnectingTransport } from '../front/chat/transport.js';
import { createChatState } from '../front/chat/state.js';
import { formatChatAnnouncement, humanFileSize as formatFileSize, insertTextAtSelection } from '../front/chat/format.js';
import { readFile } from 'node:fs/promises';

test('protocol parser accepts every supported message code', () => {
  for (const code of Object.values(MessageCode)) {
    assert.deepEqual(parseProtocolMessage(JSON.stringify({ code })), { code });
  }
});

test('chat announcement formatting stays concise and text insertion preserves selections', () => {
  assert.equal(formatChatAnnouncement('message', { peerName: 'Ada', message: 'Hello' }), 'Ada said: Hello');
  assert.equal(formatChatAnnouncement('joined', { peerName: 'Ada' }), 'Ada joined the room.');
  const field = { value: 'hello world', selectionStart: 6, selectionEnd: 11,
    setRangeText(text, start, end) { this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`; } };
  insertTextAtSelection(field, 'there');
  assert.equal(field.value, 'hello there');
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

test('file chunk replies preserve the requested transfer coordinates', () => {
  const request = {
    serverFileId: 12,
    subscriberId: 34,
    chunkRequestId: 9,
    chunkPosition: 4096,
    chunkSize: 4096,
  };
  assert.deepEqual(createFileChunkMessage(request, 'YWJj', 3), {
    code: MessageCode.FILE_CHUNK_DATA,
    files: [{
      serverFileId: 12,
      subscriberId: 34,
      chunkRequestId: 9,
      chunkPosition: 4096,
      chunkSize: 3,
      data: 'YWJj',
    }],
  });
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
  assert.match(chat, /from '\.\/protocol\.js'/);
  assert.match(chat, /parseProtocolMessage\(payload\)/);
  assert.match(chat, /SESSION_HELLO/);
  assert.match(chat, /SESSION_READY/);
  assert.match(chat, /createFileChunkMessage\(chunkInfo, data, chunkSize\)/);
  assert.doesNotMatch(chat, /onMessage\(JSON\.parse\(event\.data\)\)/);
});

test('room module imports have explicit matching server routes', async () => {
  const [chat, ui, controller] = await Promise.all([
    readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(chat, /from '\.\/format\.js'/);
  assert.match(chat, /from '\.\/protocol\.js'/);
  assert.match(chat, /from '\.\/state\.js'/);
  assert.match(ui, /from '\.\/chat\.js'/);
  for (const route of ['format.js', 'state.js', 'chat.js', 'ui.js', 'protocol.js', 'transport.js', 'reliability.js']) {
    assert.match(controller, new RegExp(`room/\\{roomId\\}/${route.replace('.', '\\.')}`));
  }
  assert.doesNotMatch(controller, /\{module:/);
});

test('reliability state keeps pending commands until their matching acknowledgement and suppresses replay duplicates', () => {
  const state = createReliabilityState();
  state.restoreCursor(40);
  assert.equal(state.highestServerSeq, 40, 'page reload resumes contiguity at the stored hello cursor');
  state.resetSequence();
  assert.equal(state.enqueue({ clientMessageId: 'one', message: 'hello' }), true);
  assert.equal(state.pending().length, 1);
  assert.equal(state.acceptSequence(2), true);
  assert.equal(state.highestServerSeq, 0, 'a gap cannot advance the persisted resume cursor');
  assert.equal(state.acceptSequence(2), false);
  assert.equal(state.acceptSequence(1), true, 'out-of-order replay remains renderable once');
  assert.equal(state.highestServerSeq, 2, 'cursor advances after the gap is filled');
  assert.equal(state.acknowledge('one').message, 'hello');
  assert.equal(state.pending().length, 0);
});

test('terminal command rejection removes poison commands from automatic retry', () => {
  const state = createReliabilityState(); const sent = [];
  state.enqueue({ clientMessageId: 'rejected', message: 'too large' });
  assert.equal(state.reject('rejected').delivery, 'not sent; retry manually');
  retryPendingCommands(state, (payload) => sent.push(payload));
  assert.deepEqual(sent, []);
  assert.equal(state.pending().length, 0);
  assert.equal(state.manualRetryOnly()[0].clientMessageId, 'rejected');
});

test('frames racing ahead of session ready replay in arrival order after reconciliation', () => {
  const inbox = createHandshakeInbox(2);
  assert.equal(inbox.push({ serverSeq: 8 }), true);
  assert.equal(inbox.push({ serverSeq: 9 }), true);
  assert.equal(inbox.push({ serverSeq: 10 }), false);
  const replayed = [];
  inbox.drain((message) => replayed.push(message.serverSeq));
  assert.deepEqual(replayed, [8, 9]);
  assert.equal(inbox.size(), 0);
});

test('retry helper replays only live unacknowledged commands after ready', () => {
  const state = createReliabilityState(); const sent = [];
  state.enqueue({ clientMessageId: 'retry-me', message: 'one' });
  retryPendingCommands(state, (payload) => sent.push(JSON.parse(payload).clientMessageId));
  assert.deepEqual(sent, ['retry-me']);
  state.abandon(); retryPendingCommands(state, (payload) => sent.push(JSON.parse(payload).clientMessageId));
  assert.deepEqual(sent, ['retry-me'], 'fresh identity never receives abandoned commands');
  assert.equal(state.manualRetryOnly()[0].delivery, 'not sent; retry manually');
});

test('resync replaces rendered durable history and replay never duplicates a DOM event', () => {
  const state = createReliabilityState(); const rendered = ['old']; let replacements = 0;
  reconcileReplay(state, [{ serverSeq: 4 }, { serverSeq: 5 }, { serverSeq: 5 }], true,
    () => { replacements += 1; rendered.length = 0; }, (event) => {
      if (state.acceptSequence(event.serverSeq)) rendered.push(event.serverSeq);
    });
  assert.equal(replacements, 1);
  assert.deepEqual(rendered, [4, 5]);
  assert.equal(state.highestServerSeq, 5);
  state.replaceHistory([], 9);
  assert.equal(state.highestServerSeq, 9, 'an empty retained snapshot advances to the server snapshot cursor');
});

test('transport sends only after ready and schedules one deterministic full-jitter retry', () => {
  const timers = []; const states = []; let socket;
  const transport = new ReconnectingTransport({ url: 'ws://example.test', random: () => 0.5,
    createSocket: () => (socket = { readyState: 1, send() {}, close() {} }), onState: (state, detail) => states.push([state, detail]),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimer() {} });
  transport.start();
  assert.equal(transport.send('before'), false);
  socket.onopen();
  assert.equal(transport.hello('hello'), true);
  transport.ready();
  assert.equal(transport.send('after'), true);
  socket.onclose({ code: 1006 }); socket.onclose({ code: 1006 });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 250);
  assert.deepEqual(states.at(-1), ['backoff', 250]);
});

test('dashboard keeps hostile strings out of HTML sinks and does not proxy statistics', async () => {
  const dashboard = await readFile(new URL('../dashboard/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /\.innerHTML\s*=/);
  assert.doesNotMatch(dashboard, /cors-anywhere|tryProxyUrl/);
  assert.match(dashboard, /safeStatsUrl/);
  assert.match(dashboard, /MAX_STATS_BYTES/);
  assert.match(dashboard, /validStats\(data\)/);
  assert.match(dashboard, /ConspireDashboardConfig\?\.statsUrl/);
  assert.match(html, /href="\/dashboard\/style\.css"/);
  assert.match(html, /src="\/dashboard\/app\.js"/);
  assert.match(html, /src="\/dashboard\/vendor\/chart\.umd\.min\.js"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr|https:\/\/.*chart/i);
  assert.doesNotMatch(dashboard, /\balert\s*\(/);
  assert.match(dashboard, /MAX_STATS_POINTS/);
  assert.match(dashboard, /Intl\.DateTimeFormat/);
  assert.match(dashboard, /renderSemanticChart/);
  assert.doesNotMatch(html, /\sonclick=/);
  assert.doesNotMatch(html, /\sstyle=/);
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

test('chat keeps modern keyboard, DOM, and safe-download paths', async () => {
  const chat = await readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chat, /document\.selection|keypress|event\.which|\.innerHTML\s*=/);
  assert.match(chat, /addEventListener\('keydown'/);
  assert.match(chat, /e\.key === 'Enter'/);
  assert.match(chat, /replaceChildren\(/);
  assert.match(chat, /link\.rel = 'noopener noreferrer'/);
  assert.match(chat, /e\.preventDefault\(\)/);
  const deliverySelectors = chat.match(/\.message-delivery\[data-client-message-id=/g) ?? [];
  assert.equal(deliverySelectors.length, 2,
    'ACK and pending-delivery updates must target only the delivery span, never the message container');
});

test('chat leave protection uses its beforeunload event parameter consistently', async () => {
  const chat = await readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8');
  const handler = chat.match(/addEventListener\(["']beforeunload["'],\s*function\s*\((\w+)\)\s*\{([\s\S]*?)\n\}\);/);

  assert.ok(handler, 'beforeunload handler is registered with an event parameter');
  const [, parameter, body] = handler;
  assert.match(body, new RegExp(`\\b${parameter}\\.preventDefault\\(\\)`));
  assert.match(body, new RegExp(`\\b${parameter}\\.returnValue\\s*=`));
  assert.doesNotMatch(body, /\bevent\.returnValue\s*=/);
});

test('lobby actions are CSP-compatible external listeners', async () => {
  const lobby = await readFile(new URL('../front/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../front/lobby.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lobby, /\sonclick=|<script>(?!\s*src)/);
  assert.match(lobby, /lobby\.js/);
  assert.match(script, /noopener,noreferrer/);
});
