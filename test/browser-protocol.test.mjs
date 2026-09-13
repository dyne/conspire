import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MessageCode,
  ImagePreviewLimits,
  createFileChunkMessage,
  humanFileSize,
  imageCandidateMediaType,
  isPreviewCandidate,
  parseProtocolMessage,
  previewDimensions,
  roomFileUrl,
} from '../front/chat/protocol.js';
import { createHandshakeInbox, createReliabilityState, reconcileReplay, retryPendingCommands } from '../front/chat/reliability.js';
import { ReconnectingTransport } from '../front/chat/transport.js';
import { createChatState } from '../front/chat/state.js';
import { formatChatAnnouncement, humanFileSize as formatFileSize, insertTextAtSelection } from '../front/chat/format.js';
import { readFile } from 'node:fs/promises';
import { createImagePreviewController, inspectImageBytes, PreviewMemory, reducePreview } from '../front/chat/image-preview.js';

function png(width = 1, height = 1) { return Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,width,0,0,0,height,8,2,0,0,0]); }
function jpeg(width = 1, height = 1) { return Uint8Array.from([255,216,255,192,0,8,8,0,height,0,width,1,17,0,255,217]); }
function webp(tag = 'VP8 ', payload = [0,0,0,0x9d,0x01,0x2a,1,0,1,0]) { const length = 4 + 8 + payload.length; return Uint8Array.from([82,73,70,70,length,0,0,0,87,69,66,80,...tag.split('').map((x) => x.charCodeAt(0)),payload.length,0,0,0,...payload]); }
function webpChunks(chunks) { const body = chunks.flatMap(([tag, payload]) => [...tag].map((x) => x.charCodeAt(0)).concat([payload.length,0,0,0], payload, payload.length & 1 ? [0] : [])); const size = body.length + 4; return Uint8Array.from([82,73,70,70,size,0,0,0,87,69,66,80,...body]); }
class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.style = {}; this.attributes = new Map(); this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); } insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); }
  replaceChildren(...nodes) { this.children = nodes; } addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  async click() { return this.listeners.get('click')?.(); }
}
function fakeDocument() { return { createElement(tag) { const node = new FakeElement(tag); if (tag === 'img') { node.decode = async () => {}; node.naturalWidth = 1; node.naturalHeight = 1; } return node; } }; }

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

test('image candidate metadata is an exact advisory allowlist', () => {
  for (const mediaType of ImagePreviewLimits.mediaTypes) assert.equal(imageCandidateMediaType(mediaType), mediaType);
  for (const mediaType of [undefined, 'image/gif', 'IMAGE/PNG', 'image/png; charset=utf-8', 'x'.repeat(33), 'image/\u00e9']) {
    assert.equal(imageCandidateMediaType(mediaType), null);
  }
  const parsed = parseProtocolMessage(JSON.stringify({ code: MessageCode.PEER_MESSAGE_FILE, files: [
    { name: 'photo.txt', size: 1, mediaType: 'image/png' }, { name: 'photo.png', size: 1, mediaType: 'image/gif' },
  ] }));
  assert.equal(parsed.files[0].mediaType, 'image/png');
  assert.equal(parsed.files[1].mediaType, undefined);
  assert.equal(isPreviewCandidate({ name: 'fake.png', size: ImagePreviewLimits.encodedBytes, mediaType: 'image/png' }), true);
  assert.equal(isPreviewCandidate({ name: 'photo.png', size: ImagePreviewLimits.encodedBytes + 1, mediaType: 'image/png' }), false);
  assert.equal(isPreviewCandidate({ name: 'photo.png', size: 1 }), false);
  assert.equal(isPreviewCandidate({ name: 'misleading.png', size: 9 * 1024 * 1024 }), false,
    'a filename extension is never preview authorization');
});

test('preview dimensions use checked safe integer arithmetic', () => {
  assert.deepEqual(previewDimensions(8192, 2048), { width: 8192, height: 2048, pixels: 16 * 1024 * 1024 });
  for (const [width, height] of [[8193, 1], [8192, 2049], [0, 1], [-1, 1], [1.5, 2], [Number.MAX_SAFE_INTEGER, 2], [4097, 4097]]) {
    assert.equal(previewDimensions(width, height), null);
  }
});

test('image inspection accepts only bounded matching containers without a browser decoder', () => {
  for (const [bytes, type, width, height] of [[png(2, 3), 'image/png', 2, 3], [jpeg(2, 3), 'image/jpeg', 2, 3], [webp(), 'image/webp', 1, 1]]) {
    assert.deepEqual(inspectImageBytes(bytes, bytes.length, type), { ok: true, format: type, width, height, pixels: width * height });
  }
  const animated = webpChunks([['VP8X', [2,0,0,0,0,0,0,0,0,0]], ['VP8 ', [0,0,0,0x9d,1,0x2a,1,0,1,0]]]);
  const malformed = [new Uint8Array(), png(0, 1), jpeg(0, 1), webp('ANIM', [0,0]), Uint8Array.from([...webp(), 0])];
  for (const bytes of malformed) assert.equal(inspectImageBytes(bytes, bytes.length, 'image/webp').ok, false);
  assert.equal(inspectImageBytes(animated, animated.length, 'image/webp').reason, 'unsupported');
  const primary = [0,0,0,0x9d,1,0x2a,1,0,1,0];
  const extended = webpChunks([['VP8X', [0,0,0,0,0,0,0,0,0,0]], ['VP8 ', primary]]);
  const oversizedFirst = webpChunks([['VP8X', [0,0,0,0,0,32,0,0,0,0]], ['VP8 ', primary]]);
  const duplicateHeader = webpChunks([['VP8X', [0,0,0,0,0,0,0,0,0,0]], ['VP8X', [0,0,0,0,0,0,0,0,0,0]], ['VP8 ', primary]]);
  const duplicatePrimary = webpChunks([['VP8 ', primary], ['VP8 ', primary]]);
  const oversizedPrimary = webpChunks([['VP8 ', [0,0,0,0x9d,1,0x2a,1,32,1,0]]]);
  const conflictingCanvas = webpChunks([['VP8X', [0,0,0,0,0,0,1,0,0,0]], ['VP8 ', primary]]);
  assert.deepEqual(inspectImageBytes(extended, extended.length, 'image/webp'), { ok: true, format: 'image/webp', width: 1, height: 1, pixels: 1 });
  assert.equal(inspectImageBytes(webp('VP8X', [0,0,0,0,0,0,0,0,0,0]), 30, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(oversizedFirst, oversizedFirst.length, 'image/webp').reason, 'too-large');
  assert.equal(inspectImageBytes(duplicateHeader, duplicateHeader.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(duplicatePrimary, duplicatePrimary.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(oversizedPrimary, oversizedPrimary.length, 'image/webp').reason, 'too-large');
  assert.equal(inspectImageBytes(conflictingCanvas, conflictingCanvas.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(png(), png().length - 1, 'image/png').reason, 'too-large');
  assert.equal(inspectImageBytes(png(), png().length, 'image/jpeg').ok, false);
  const markerAbuse = Uint8Array.from([255,216,255,224,255,255]);
  assert.equal(inspectImageBytes(markerAbuse, markerAbuse.length, 'image/jpeg').reason, 'invalid');
  for (let length = 0; length < 24; length += 1) assert.equal(inspectImageBytes(new Uint8Array(length), length, 'image/png').ok, false);
});

test('preview controllers fetch only after Load, fail closed without streaming, and revoke the globally evicted URL', async () => {
  const document = fakeDocument(); const urls = { made: [], revoked: [], createObjectURL() { const value = `blob:${this.made.length}`; this.made.push(value); return value; }, revokeObjectURL(value) { this.revoked.push(value); } };
  const previews = new Map(); const memory = new PreviewMemory(ImagePreviewLimits, (id) => previews.get(id)?.evict());
  let requests = 0; let arrayBufferCalls = 0; const bytes = png();
  const fetch = async () => { requests += 1; return { ok: true, headers: { get: () => String(bytes.length) }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; } }; } } }; };
  for (let id = 1; id <= 4; id += 1) {
    const preview = createImagePreviewController({ file: { serverFileId: id, name: `${id}.png`, size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory, fetch, URL: urls });
    previews.set(String(id), preview); assert.equal(requests, id - 1, 'offered previews do not request bytes'); await preview.load.click();
  }
  assert.equal(requests, 4); assert.deepEqual(urls.revoked, ['blob:0']); assert.equal(previews.get('1').phase, 'evicted');
  const noStream = createImagePreviewController({ file: { serverFileId: 9, name: 'x.png', size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory, URL: urls,
    fetch: async () => ({ ok: true, headers: { get: () => String(bytes.length) }, body: {}, async arrayBuffer() { arrayBufferCalls += 1; return bytes.buffer; } }) });
  await noStream.load.click(); assert.equal(arrayBufferCalls, 0); assert.equal(noStream.phase, 'decode-error');
});

test('preview controller exposes consent, progress, recovery, and loaded-image semantics', async () => {
  const document = fakeDocument(); const bytes = png();
  const urls = { createObjectURL: () => 'blob:preview', revokeObjectURL() {} };
  const preview = createImagePreviewController({ file: { serverFileId: 10, name: 'portrait.png', size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory: new PreviewMemory(), URL: urls,
    fetch: async () => ({ ok: true, headers: { get: () => null }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; } }; } } }) });
  assert.equal(preview.root.children[0].attributes.get('role'), 'status');
  assert.equal(preview.root.children[0].attributes.get('aria-live'), 'polite');
  assert.match(preview.root.children[0].textContent, /require confirmation/);
  assert.equal(preview.root.children.some((node) => node.textContent === 'Cancel image load'), false);
  await preview.load.click();
  assert.equal(preview.phase, 'visible');
  const image = preview.root.children[0];
  assert.equal(image.tag, 'img'); assert.equal(image.alt, 'Shared image: portrait.png');
  assert.equal(image.width, 1); assert.equal(image.height, 1);
  assert.match(preview.root.children[1].textContent, /Image loaded: 1 by 1 pixels/);
  assert.equal(preview.root.children[2].textContent, 'Unload image');
});

test('preview cancellation suppresses an in-flight delayed response and leaves a retry action', async () => {
  const document = fakeDocument(); const bytes = png(); let resolveRead; let startFetch;
  const started = new Promise((resolve) => { startFetch = resolve; });
  const preview = createImagePreviewController({ file: { serverFileId: 11, name: 'slow.png', size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory: new PreviewMemory(), URL: { createObjectURL() {}, revokeObjectURL() {} },
    fetch: async () => { startFetch(); return { ok: true, headers: { get: () => null }, body: { getReader() { let calls = 0; return { read: () => calls++ ? Promise.resolve({ done: true }) : new Promise((resolve) => { resolveRead = resolve; }) }; } } }; } });
  const loading = preview.load.click();
  await started;
  assert.equal(preview.phase, 'downloading');
  await preview.cancel.click();
  assert.equal(preview.phase, 'cancelled');
  assert.equal(preview.root.children[1].textContent, 'Retry image preview');
  resolveRead({ done: false, value: bytes });
  await loading;
  assert.equal(preview.phase, 'cancelled', 'a late chunk cannot resurrect a cancelled preview');
});

test('preview reducer and memory budget remain deterministic across races and exact boundaries', () => {
  let state = reducePreview(undefined, { type: 'load' });
  for (const type of ['start', 'complete', 'valid', 'decoded']) state = reducePreview(state, { type });
  assert.equal(state.phase, 'visible');
  assert.equal(reducePreview(reducePreview(state, { type: 'evict' }), { type: 'decoded' }).phase, 'evicted');
  assert.equal(reducePreview({ phase: 'inspecting' }, { type: 'invalid', reason: 'too-large' }).phase, 'too-large');
  const memory = new PreviewMemory(); const evicted = [];
  assert.equal(memory.admit('a', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.admit('b', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.admit('c', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.bytes(), 24 * 1024 * 1024); assert.equal(memory.pixels(), 24 * 1024 * 1024);
  memory.admit('d', 1, 1, (id) => evicted.push(id));
  assert.deepEqual(evicted, ['a']); assert.equal(memory.entries.size, 3); assert.equal(memory.remove('d'), true); assert.equal(memory.remove('d'), false);
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
  for (const route of ['format.js', 'state.js', 'chat.js', 'ui.js', 'protocol.js', 'transport.js', 'reliability.js', 'image-preview.js']) {
    assert.match(controller, new RegExp(`room/\\{roomId\\}/${route.replace('.', '\\.')}`));
  }
  assert.doesNotMatch(controller, /\{module:/);
});

test('preview receive path remains consent-only and uses only blob image sources', async () => {
  const [chat, preview, controller] = await Promise.all([
    readFile(new URL('../front/chat/chat.js', import.meta.url), 'utf8'),
    readFile(new URL('../front/chat/image-preview.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(chat, /isPreviewCandidate\(file\)/);
  assert.match(preview, /load\.addEventListener\('click', start\)/);
  assert.match(preview, /urls\.createObjectURL/);
  assert.match(preview, /urls\.revokeObjectURL/);
  assert.doesNotMatch(preview, /data:|https?:\/\//);
  assert.match(controller, /img-src 'self' blob:/);
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

test('emoji shortcut buttons keep their glyphs visible and accessible', async () => {
  const room = await readFile(new URL('../front/chat/index.html', import.meta.url), 'utf8');
  const buttons = [...room.matchAll(
    /<button[^>]*data-emoji="([^"]+)"[^>]*aria-label="([^"]+)"[^>]*>([^<]+)<\/button>/g,
  )];

  assert.equal(buttons.length, 15);
  for (const [, emoji, accessibleName, visibleText] of buttons) {
    assert.equal(visibleText, emoji, `${accessibleName} must display its emoji glyph`);
    assert.match(accessibleName, /^Insert /);
  }
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
