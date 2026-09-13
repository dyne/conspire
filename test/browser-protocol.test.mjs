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
import { createImagePreviewController, inspectImageBytes, PreviewMemory, PreviewRegistry, reducePreview } from '../front/chat/image-preview.js';

function fixture(...parts) { return Uint8Array.from(Buffer.from(parts.join(''), 'base64')); }
function u16ForTest(bytes, at) { return bytes[at] * 256 + bytes[at + 1]; }
function crc32ForTest(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(tag, payload) {
  const type = Buffer.from(tag, 'ascii'); const data = Buffer.from(payload); const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0); type.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32ForTest(Buffer.concat([type, data])), 8 + data.length); return result;
}
const validPng = fixture('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC', 'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
function pngWithChunks(beforeIdat = [], afterIdat = []) {
  return Uint8Array.from(Buffer.concat([Buffer.from(validPng.slice(0, 33)), ...beforeIdat,
    Buffer.from(validPng.slice(33, -12)), ...afterIdat, Buffer.from(validPng.slice(-12))]));
}
const validJpeg = fixture(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDREN',
  'Dg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
  'EBAQEBAQEBAQEBAQEBD/wAARCAADAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAA',
  'AAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ACJWAEf/2Q==',
);
const validWebp = fixture('UklGRhwAAABXRUJQVlA4TA8AAAAvAYAAAAcQ/Y/+ByKi/wEA');
function webp(tag = 'VP8 ', payload = [0x10,0,0,0x9d,0x01,0x2a,1,0,1,0]) { const length = 4 + 8 + payload.length; return Uint8Array.from([82,73,70,70,length,0,0,0,87,69,66,80,...tag.split('').map((x) => x.charCodeAt(0)),payload.length,0,0,0,...payload]); }
function webpChunks(chunks) { const body = chunks.flatMap(([tag, payload]) => [...tag].map((x) => x.charCodeAt(0)).concat([payload.length,0,0,0], payload, payload.length & 1 ? [0] : [])); const size = body.length + 4; return Uint8Array.from([82,73,70,70,size,0,0,0,87,69,66,80,...body]); }
class FakeElement {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.style = {}; this.attributes = new Map(); this.dataset = {}; this.removed = false; }
  append(...nodes) { this.children.push(...nodes); } insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, listener) { const listeners = this.listeners.get(type) || new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  setAttribute(name, value) { this.attributes.set(name, value); } removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; if (name === 'href') this.href = ''; }
  remove() { this.removed = true; }
  async dispatch(type) { for (const listener of [...(this.listeners.get(type) || [])]) await listener(); }
  async click() { return this.dispatch('click'); }
}
function fakeDocument({ decode = async () => {}, width = 1, height = 1 } = {}) { return { createElement(tag) { const node = new FakeElement(tag); if (tag === 'img') { node.decode = decode; node.naturalWidth = width; node.naturalHeight = height; } return node; } }; }

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
  for (const [bytes, type, width, height] of [[validPng, 'image/png', 1, 1], [validJpeg, 'image/jpeg', 2, 3], [validWebp, 'image/webp', 2, 3]]) {
    assert.deepEqual(inspectImageBytes(bytes, bytes.length, type), { ok: true, format: type, width, height, pixels: width * height });
  }
  const primary = [...validWebp.slice(20, 35)];
  const animated = webpChunks([['VP8X', [2,0,0,0,0,0,0,0,0,0]], ['VP8 ', primary]]);
  assert.equal(inspectImageBytes(animated, animated.length, 'image/webp').reason, 'unsupported');
  const extended = webpChunks([['VP8X', [0,0,0,0,1,0,0,2,0,0]], ['VP8L', primary]]);
  const oversizedFirst = webpChunks([['VP8X', [0,0,0,0,0,32,0,0,0,0]], ['VP8 ', primary]]);
  const duplicateHeader = webpChunks([['VP8X', [0,0,0,0,0,0,0,0,0,0]], ['VP8X', [0,0,0,0,0,0,0,0,0,0]], ['VP8 ', primary]]);
  const duplicatePrimary = webpChunks([['VP8L', primary], ['VP8L', primary]]);
  const oversizedPrimary = webpChunks([['VP8 ', [0x30,0,0,0x9d,1,0x2a,1,32,1,0,0]]]);
  const conflictingCanvas = webpChunks([['VP8X', [0,0,0,0,0,0,0,1,0,0]], ['VP8L', primary]]);
  assert.deepEqual(inspectImageBytes(extended, extended.length, 'image/webp'), { ok: true, format: 'image/webp', width: 2, height: 3, pixels: 6 });
  assert.equal(inspectImageBytes(webp('VP8X', [0,0,0,0,0,0,0,0,0,0]), 30, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(oversizedFirst, oversizedFirst.length, 'image/webp').reason, 'too-large');
  assert.equal(inspectImageBytes(duplicateHeader, duplicateHeader.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(duplicatePrimary, duplicatePrimary.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(oversizedPrimary, oversizedPrimary.length, 'image/webp').reason, 'too-large');
  assert.equal(inspectImageBytes(conflictingCanvas, conflictingCanvas.length, 'image/webp').reason, 'invalid');
  assert.equal(inspectImageBytes(validPng, validPng.length - 1, 'image/png').reason, 'invalid');
  assert.equal(inspectImageBytes(validPng, validPng.length, 'image/jpeg').ok, false);
  const markerAbuse = Uint8Array.from([255,216,255,224,255,255]);
  assert.equal(inspectImageBytes(markerAbuse, markerAbuse.length, 'image/jpeg').reason, 'invalid');
  for (let length = 0; length < 24; length += 1) assert.equal(inspectImageBytes(new Uint8Array(length), length, 'image/png').ok, false);
});

test('image inspection rejects structurally truncated, corrupted, and polyglot-like containers', () => {
  const pngWithoutBody = validPng.slice(0, 33);
  const pngBadHeaderCrc = Uint8Array.from(validPng); pngBadHeaderCrc[32] ^= 1;
  const pngTrailing = Uint8Array.from([...validPng, 0]);
  const jpegSofOnly = Uint8Array.from([255,216,255,192,0,8,8,0,1,0,1,1,17,0,255,217]);
  const jpegWithoutEoi = validJpeg.slice(0, -2);
  const jpegTrailing = Uint8Array.from([...validJpeg, 0]);
  const jpegEmptyScan = Uint8Array.from(validJpeg);
  const sos = jpegEmptyScan.findIndex((value, index) => value === 0xff && jpegEmptyScan[index + 1] === 0xda);
  const sosEnd = sos + 2 + u16ForTest(jpegEmptyScan, sos + 2);
  const jpegWithoutEntropy = Uint8Array.from([...jpegEmptyScan.slice(0, sosEnd), 0xff, 0xd9]);
  const jpegReservedExtension = Uint8Array.from([...validJpeg.slice(0, -2), 0xff, 0xf0, 0, 2, 0xff, 0xd9]);
  const webpTrailing = Uint8Array.from([...validWebp, 0]);
  const webpHeaderOnly = webp('VP8 ', [0x10,0,0,0x9d,1,0x2a,1,0,1,0]);
  const webpLosslessHeaderOnly = webp('VP8L', [0x2f,1,128,0,0]);
  const reservedWebp = webpChunks([['VP8X', [0x80,0,0,0,0,0,0,0,0,0]], ['VP8 ', [0x10,0,0,0x9d,1,0x2a,1,0,1,0]]]);
  const oversizedVp8x = webpChunks([['VP8X', [0,0,0,0,0,0,0,0,0,0,0]], ['VP8 ', [0x10,0,0,0x9d,1,0x2a,1,0,1,0]]]);
  oversizedVp8x[16] = 11;
  for (const [bytes, type] of [[pngWithoutBody, 'image/png'], [pngBadHeaderCrc, 'image/png'], [pngTrailing, 'image/png'],
    [jpegSofOnly, 'image/jpeg'], [jpegWithoutEoi, 'image/jpeg'], [jpegTrailing, 'image/jpeg'], [jpegWithoutEntropy, 'image/jpeg'],
    [jpegReservedExtension, 'image/jpeg'],
    [reservedWebp, 'image/webp'], [oversizedVp8x, 'image/webp'], [webpTrailing, 'image/webp'],
    [webpHeaderOnly, 'image/webp'], [webpLosslessHeaderOnly, 'image/webp']]) {
    assert.equal(inspectImageBytes(bytes, bytes.length, type).ok, false, `${type} malformed bytes must fail before decoder exposure`);
  }
});

test('PNG inspection rejects animation and decoder-expanding ancillary metadata regardless of chunk order', () => {
  const acTL = pngChunk('acTL', [0,0,0,1,0,0,0,0]);
  const fcTL = pngChunk('fcTL', [0,0,0,0, 0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,0, 0,1, 0,10, 0,0]);
  const fdAT = pngChunk('fdAT', [0,0,0,1,0x78,0x9c,0x03,0,0,0,0,1]);
  const compressedITXt = pngChunk('iTXt', [107,0,1,0,0,0,0x78,0x9c,0x03,0,0,0,0,1]);
  const cases = [
    pngWithChunks([acTL, fcTL], [fdAT]),
    ...[acTL, fcTL, fdAT].flatMap((chunk) => [pngWithChunks([chunk]), pngWithChunks([], [chunk])]),
    pngWithChunks([pngChunk('iCCP', [112,0,0,0x78,0x9c,0x03,0,0,0,0,1])]),
    pngWithChunks([], [pngChunk('zTXt', [107,0,0,0x78,0x9c,0x03,0,0,0,0,1])]),
    pngWithChunks([compressedITXt]),
    pngWithChunks([], [compressedITXt]),
  ];
  for (const bytes of cases) assert.equal(inspectImageBytes(bytes, bytes.length, 'image/png').reason, 'unsupported');
  const uncompressedITXt = pngWithChunks([pngChunk('iTXt', [107,0,0,0,0,0,115,116,97,116,105,99])]);
  assert.deepEqual(inspectImageBytes(uncompressedITXt, uncompressedITXt.length, 'image/png'),
    { ok: true, format: 'image/png', width: 1, height: 1, pixels: 1 }, 'bounded uncompressed text preserves static PNG compatibility');
});

test('JPEG dimensions must occur inside the bounded one-mebibyte header scan', () => {
  const commentPayload = Buffer.alloc(65531); const comment = Buffer.alloc(65535);
  comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(65533, 2); commentPayload.copy(comment, 4);
  const sofAt = validJpeg.findIndex((value, index) => value === 0xff && [0xc0, 0xc1, 0xc2].includes(validJpeg[index + 1]));
  assert.ok(sofAt > 0);
  const delayedHeader = Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xd8]), ...Array.from({ length: 17 }, () => comment), Buffer.from(validJpeg.slice(sofAt))]));
  assert.ok(delayedHeader.length < ImagePreviewLimits.encodedBytes);
  assert.equal(inspectImageBytes(delayedHeader, delayedHeader.length, 'image/jpeg').reason, 'unsupported');
});

test('preview controllers fetch only after Load, fail closed without streaming, and revoke the globally evicted URL', async () => {
  const document = fakeDocument(); const urls = { made: [], revoked: [], createObjectURL() { const value = `blob:${this.made.length}`; this.made.push(value); return value; }, revokeObjectURL(value) { this.revoked.push(value); } };
  const previews = new PreviewRegistry(); let requests = 0; let arrayBufferCalls = 0; const bytes = validPng;
  const fetch = async () => { requests += 1; return { ok: true, headers: { get: () => String(bytes.length) }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; } }; } } }; };
  for (let id = 1; id <= 4; id += 1) {
    const preview = createImagePreviewController({ file: { serverFileId: id, name: `${id}.png`, size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory: previews.memory, fetch, URL: urls });
    previews.register(id, preview); assert.equal(requests, id - 1, 'offered previews do not request bytes'); await preview.load.click();
  }
  assert.equal(requests, 4); assert.deepEqual(urls.revoked, ['blob:0']); assert.equal(previews.controllers.get('1').phase, 'evicted');
  const noStream = createImagePreviewController({ file: { serverFileId: 9, name: 'x.png', size: bytes.length, mediaType: 'image/png' }, url: '/file', document, memory: previews.memory, URL: urls,
    fetch: async () => ({ ok: true, headers: { get: () => String(bytes.length) }, body: {}, async arrayBuffer() { arrayBufferCalls += 1; return bytes.buffer; } }) });
  await noStream.load.click(); assert.equal(arrayBufferCalls, 0); assert.equal(noStream.phase, 'retryable-error');
});

test('preview controller exposes consent, progress, recovery, and loaded-image semantics', async () => {
  const document = fakeDocument(); const bytes = validPng;
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
  const document = fakeDocument(); const bytes = validPng; let resolveRead; let startFetch;
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
  assert.equal(reducePreview({ phase: 'decoding' }, { type: 'error' }).phase, 'retryable-error');
  assert.equal(reducePreview({ phase: 'retryable-error' }, { type: 'load' }).phase, 'confirmed');
  assert.equal(reducePreview({ phase: 'invalid' }, { type: 'load' }).phase, 'invalid');
  const memory = new PreviewMemory(); const evicted = [];
  assert.equal(memory.admit('a', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.admit('b', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.admit('c', 8 * 1024 * 1024, 8 * 1024 * 1024, (id) => evicted.push(id)), true);
  assert.equal(memory.bytes(), 24 * 1024 * 1024); assert.equal(memory.pixels(), 24 * 1024 * 1024);
  memory.admit('d', 1, 1, (id) => evicted.push(id));
  assert.deepEqual(evicted, ['a']); assert.equal(memory.entries.size, 3); assert.equal(memory.remove('d'), true); assert.equal(memory.remove('d'), false);
});

test('preview registry disposes resync and same-id replacements and withdrawal clears every retained resource', async () => {
  const urls = { made: [], revoked: [], createObjectURL() { const value = `blob:${this.made.length}`; this.made.push(value); return value; }, revokeObjectURL(value) { this.revoked.push(value); } };
  const registry = new PreviewRegistry(); const document = fakeDocument();
  const response = (bytes) => ({ ok: true, headers: { get: () => String(bytes.length) }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: bytes }; } }; } } });
  const file = { serverFileId: 41, name: 'retained.png', size: validPng.length, mediaType: 'image/png' };
  const download = new FakeElement('a'); download.href = '/file/41'; download.setAttribute('href', '/file/41'); download.setAttribute('target', '_blank');
  const first = registry.register(41, createImagePreviewController({ file, url: '/file/41', download, document, memory: registry.memory, fetch: async () => response(validPng), URL: urls }));
  await first.load.click(); assert.equal(first.phase, 'visible'); assert.equal(registry.memory.entries.size, 1);
  const replacement = registry.register(41, createImagePreviewController({ file, url: '/file/41', download, document, memory: registry.memory, fetch: async () => response(validPng), URL: urls }));
  assert.equal(first.root.removed, true); assert.deepEqual(urls.revoked, ['blob:0']); assert.equal(registry.memory.entries.size, 0);
  await replacement.load.click(); const image = replacement.root.children[0];
  assert.equal(image.tag, 'img'); assert.equal(registry.memory.entries.size, 1);
  assert.equal(registry.unavailable(41), true); assert.equal(replacement.phase, 'unavailable');
  assert.equal(image.src, ''); assert.deepEqual(urls.revoked, ['blob:0', 'blob:1']); assert.equal(registry.memory.entries.size, 0); assert.equal(registry.size, 0);
  assert.equal(download.attributes.has('href'), false); assert.equal(download.attributes.has('target'), false); assert.equal(download.attributes.get('aria-disabled'), 'true');
  assert.equal(replacement.root.children.some((node) => node.tag === 'img'), false);
  replacement.unavailable(); assert.deepEqual(urls.revoked, ['blob:0', 'blob:1'], 'unavailable cleanup revokes each URL exactly once');
});

test('resync disposal suppresses stale completion and retryable failures fetch again successfully', async () => {
  const registry = new PreviewRegistry(); const urls = { made: [], revoked: [], createObjectURL() { const value = `blob:${this.made.length}`; this.made.push(value); return value; }, revokeObjectURL(value) { this.revoked.push(value); } };
  let resolveRead; let resolveStarted; const started = new Promise((resolve) => { resolveStarted = resolve; });
  const delayed = registry.register(51, createImagePreviewController({ file: { serverFileId: 51, name: 'slow.png', size: validPng.length, mediaType: 'image/png' }, url: '/file/51', document: fakeDocument(), memory: registry.memory, URL: urls,
    fetch: async () => { resolveStarted(); return { ok: true, headers: { get: () => null }, body: { getReader() { let calls = 0; return { read: () => calls++ ? Promise.resolve({ done: true }) : new Promise((resolve) => { resolveRead = resolve; }) }; } } }; } }));
  const pending = delayed.load.click(); await started; registry.clear(); resolveRead({ done: false, value: validPng }); await pending;
  assert.equal(delayed.root.removed, true); assert.equal(registry.memory.entries.size, 0); assert.deepEqual(urls.made, []); assert.deepEqual(urls.revoked, []);

  let requests = 0;
  const retry = createImagePreviewController({ file: { serverFileId: 52, name: 'retry.png', size: validPng.length, mediaType: 'image/png' }, url: '/file/52', document: fakeDocument(), memory: registry.memory, URL: urls,
    fetch: async () => {
      requests += 1; if (requests === 1) throw new Error('temporary');
      return { ok: true, headers: { get: () => String(validPng.length) }, body: { getReader() {
        let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: validPng }; } };
      } } };
    } });
  await retry.load.click(); assert.equal(retry.phase, 'retryable-error'); assert.equal(retry.load.textContent, 'Retry image preview');
  await retry.load.click(); assert.equal(requests, 2); assert.equal(retry.phase, 'visible');
  const used = registry.memory.entries.get('52').used; await retry.root.dispatch('focusin'); const focused = registry.memory.entries.get('52').used;
  await retry.root.dispatch('pointerdown'); assert.ok(focused > used); assert.ok(registry.memory.entries.get('52').used > focused);

  const invalidBytes = Uint8Array.from([1, 2, 3]);
  const permanent = createImagePreviewController({ file: { serverFileId: 53, name: 'invalid.png', size: invalidBytes.length, mediaType: 'image/png' }, url: '/file/53', document: fakeDocument(), memory: registry.memory, URL: urls,
    fetch: async () => ({ ok: true, headers: { get: () => String(invalidBytes.length) }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: invalidBytes }; } }; } } }) });
  await permanent.load.click(); assert.equal(permanent.phase, 'invalid');
  assert.equal(permanent.root.children.includes(permanent.load), false, 'permanent validation failures do not render an inert retry control');

  let decodeAttempts = 0; let decodeRequests = 0;
  const decodeRetry = createImagePreviewController({ file: { serverFileId: 54, name: 'decode.png', size: validPng.length, mediaType: 'image/png' }, url: '/file/54',
    document: fakeDocument({ decode: async () => { decodeAttempts += 1; if (decodeAttempts === 1) throw new Error('decoder busy'); } }), memory: registry.memory, URL: urls,
    fetch: async () => { decodeRequests += 1; return { ok: true, headers: { get: () => String(validPng.length) }, body: { getReader() { let done = false; return { async read() { if (done) return { done: true }; done = true; return { done: false, value: validPng }; } }; } } }; } });
  await decodeRetry.load.click(); assert.equal(decodeRetry.phase, 'retryable-error');
  await decodeRetry.load.click(); assert.equal(decodeRetry.phase, 'visible'); assert.equal(decodeRequests, 2); assert.equal(decodeAttempts, 2);
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
  assert.match(chat, /previews\.register\(file\.serverFileId, preview\)/);
  assert.match(chat, /previews\.unavailable\(file\.serverFileId\)/);
  assert.match(chat, /cleanupAllPreviews\(\); document\.getElementById\('chat_history'\)\.replaceChildren\(\)/);
  assert.match(chat, /querySelectorAll\(`a\[href\$=/);
  assert.match(preview, /load\.addEventListener\('click', start\)/);
  assert.match(preview, /urls\.createObjectURL/);
  assert.match(preview, /urls\.revokeObjectURL/);
  assert.doesNotMatch(preview, /className = 'image-preview-download'/);
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
