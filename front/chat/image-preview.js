import { ImagePreviewLimits, imageCandidateMediaType, previewDimensions } from './protocol.js';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_HEADER_BYTES = 1024 * 1024;

function fail(reason) { return Object.freeze({ ok: false, reason }); }
function ok(format, width, height) {
  const dimensions = previewDimensions(width, height);
  return dimensions ? Object.freeze({ ok: true, format, ...dimensions }) : fail('too-large');
}
function u16(bytes, at) { return bytes[at] * 256 + bytes[at + 1]; }
function little16(bytes, at) { return bytes[at] + bytes[at + 1] * 256; }
function u24(bytes, at) { return bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2]; }
function u32(bytes, at) { return bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 256 + bytes[at + 3]; }
function little32(bytes, at) { return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 0x1000000; }
function ascii(bytes, at, value) { return value.split('').every((char, index) => bytes[at + index] === char.charCodeAt(0)); }

function inspectPng(bytes) {
  if (bytes.length < 24 || !PNG.every((value, index) => bytes[index] === value)) return fail('invalid');
  if (u32(bytes, 8) !== 13 || !ascii(bytes, 12, 'IHDR')) return fail('invalid');
  return ok('image/png', u32(bytes, 16), u32(bytes, 20));
}
function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('invalid');
  let at = 2; const ceiling = Math.min(bytes.length, MAX_HEADER_BYTES);
  while (at < ceiling) {
    while (at < ceiling && bytes[at] === 0xff) at += 1;
    if (at >= ceiling) return fail('invalid');
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return fail('invalid');
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (at + 2 > ceiling) return fail('invalid');
    const length = u16(bytes, at);
    if (length < 2 || at + length > ceiling) return fail('invalid');
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8) return fail('invalid');
      return ok('image/jpeg', u16(bytes, at + 5), u16(bytes, at + 3));
    }
    at += length;
  }
  return fail('invalid');
}
function inspectWebp(bytes) {
  if (bytes.length < 16 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || little32(bytes, 4) + 8 !== bytes.length) return fail('invalid');
  let at = 12; let canvas = null; let primary = null;
  while (at + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.slice(at, at + 4)); const length = little32(bytes, at + 4);
    const end = at + 8 + length + (length & 1);
    if (!Number.isSafeInteger(end) || end > bytes.length) return fail('invalid');
    if (tag === 'ANIM' || tag === 'ANMF') return fail('unsupported');
    if (tag === 'VP8X') {
      if (length < 10 || (bytes[at + 8] & 0x02)) return fail('unsupported');
      if (canvas) return fail('invalid');
      canvas = ok('image/webp', u24(bytes, at + 12) + 1, u24(bytes, at + 15) + 1);
      if (!canvas.ok) return canvas;
    } else if (tag === 'VP8 ') {
      if (length < 10 || bytes[at + 11] !== 0x9d || bytes[at + 12] !== 0x01 || bytes[at + 13] !== 0x2a) return fail('invalid');
      if (primary) return fail('invalid');
      primary = ok('image/webp', little16(bytes, at + 14) & 0x3fff, little16(bytes, at + 16) & 0x3fff);
      if (!primary.ok) return primary;
    } else if (tag === 'VP8L') {
      if (length < 5 || bytes[at + 8] !== 0x2f) return fail('invalid');
      if (primary) return fail('invalid');
      const value = little32(bytes, at + 9);
      primary = ok('image/webp', (value & 0x3fff) + 1, ((value >> 14) & 0x3fff) + 1);
      if (!primary.ok) return primary;
    }
    at = end;
  }
  if (at !== bytes.length || !primary) return fail('invalid');
  return canvas && (canvas.width !== primary.width || canvas.height !== primary.height) ? fail('invalid') : primary;
}

/** Bounded, decoder-free verification of untrusted encoded image bytes. */
export function inspectImageBytes(input, declaredSize, hint) {
  if (!(input instanceof Uint8Array) || !Number.isSafeInteger(declaredSize) || declaredSize < 0 ||
      input.byteLength !== declaredSize || declaredSize > ImagePreviewLimits.encodedBytes) return fail('too-large');
  const expected = imageCandidateMediaType(hint); if (!expected) return fail('unsupported');
  const result = expected === 'image/png' ? inspectPng(input) : expected === 'image/jpeg' ? inspectJpeg(input) : inspectWebp(input);
  return result.ok && result.format !== expected ? fail('unsupported') : result;
}

const terminal = new Set(['unsupported', 'invalid', 'too-large', 'decode-error', 'cancelled', 'evicted']);
export function reducePreview(state = { phase: 'offered' }, event) {
  const phase = state.phase;
  if (terminal.has(phase)) return event.type === 'load' && (phase === 'evicted' || phase === 'cancelled') ? { phase: 'confirmed' } : state;
  const transitions = { offered: { load: 'confirmed', unavailable: 'cancelled' }, confirmed: { start: 'downloading', cancel: 'cancelled' }, downloading: { complete: 'inspecting', cancel: 'cancelled', unavailable: 'cancelled' }, inspecting: { valid: 'decoding', invalid: event.reason || 'invalid' }, decoding: { decoded: 'visible', error: 'decode-error', cancel: 'cancelled' }, visible: { evict: 'evicted', cancel: 'cancelled' } };
  const next = transitions[phase]?.[event.type];
  return next ? { phase: next } : state;
}

export class PreviewMemory {
  constructor(limits = ImagePreviewLimits, onEvict = undefined) { this.limits = limits; this.entries = new Map(); this.tick = 0; this.onEvict = onEvict; }
  admit(id, bytes, pixels, evict) {
    if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(pixels) || bytes < 0 || pixels < 0 || bytes > this.limits.retainedBlobBytes || pixels > this.limits.livePixels) return false;
    this.remove(id);
    while (this.entries.size >= this.limits.livePreviews || this.bytes() + bytes > this.limits.retainedBlobBytes || this.pixels() + pixels > this.limits.livePixels) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].used - b[1].used)[0]; if (!oldest) break;
      this.entries.delete(oldest[0]); (evict || this.onEvict)?.(oldest[0], oldest[1]);
    }
    this.entries.set(id, { bytes, pixels, used: ++this.tick }); return true;
  }
  touch(id) { const entry = this.entries.get(id); if (entry) entry.used = ++this.tick; }
  remove(id) { return this.entries.delete(id); }
  bytes() { return [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0); }
  pixels() { return [...this.entries.values()].reduce((sum, item) => sum + item.pixels, 0); }
}

/** DOM adapter: it intentionally owns no protocol state and never fetches before its button is clicked. */
export function createImagePreviewController({ file, url, document, memory, fetch: request = globalThis.fetch, URL: urls = globalThis.URL }) {
  let phase = { phase: 'offered' }; let controller; let objectUrl; let disposed = false; let generation = 0; let bytes;
  const root = document.createElement('div'); root.className = 'image-preview';
  const status = document.createElement('p'); status.className = 'file-info-size image-preview-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const load = document.createElement('button'); load.type = 'button'; load.className = 'image-preview-action';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'image-preview-action'; cancel.textContent = 'Cancel image load';
  const unload = document.createElement('button'); unload.type = 'button'; unload.className = 'image-preview-action'; unload.textContent = 'Unload image';
  const download = document.createElement('a'); download.className = 'image-preview-download'; download.textContent = 'Download file'; download.href = url; download.rel = 'noopener noreferrer'; download.download = file.name || 'download';
  const offerText = `Image offered: ${file.name || 'Shared image'} (${file.size} bytes). JPEG, PNG, or WebP previews require confirmation.`;
  const setStatus = (text) => { status.textContent = text; };
  const render = (image = undefined) => {
    root.dataset.previewState = phase.phase;
    if (phase.phase === 'downloading' || phase.phase === 'inspecting' || phase.phase === 'decoding') {
      root.replaceChildren(status, cancel, download);
      return;
    }
    if (phase.phase === 'visible' && image) {
      root.replaceChildren(image, status, unload, download);
      return;
    }
    load.disabled = false;
    load.textContent = phase.phase === 'offered' ? `Load image (${file.size} bytes)` : 'Retry image preview';
    root.replaceChildren(status, load, download);
  };
  setStatus(offerText); render();
  const cleanup = () => {
    if (controller) controller.abort(); controller = undefined; bytes = undefined;
    memory.remove(String(file.serverFileId));
    if (objectUrl) { urls.revokeObjectURL(objectUrl); objectUrl = undefined; }
  };
  const terminalState = (next, text) => { phase = { phase: next }; cleanup(); setStatus(text); render(); };
  const evict = () => { generation += 1; terminalState('evicted', 'Preview unloaded to save memory.'); };
  const read = async (response, signal) => {
    const reader = response.body?.getReader(); if (!reader) throw new Error('streaming-unavailable');
    const chunks = []; let received = 0;
    while (true) { const part = await reader.read(); if (part.done) break; received += part.value.byteLength;
      if (received > file.size || received > ImagePreviewLimits.encodedBytes) throw new Error('too-large'); chunks.push(part.value); setStatus(`Loading image: ${received}/${file.size} bytes`); }
    const result = new Uint8Array(received); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; } return result;
  };
  const start = async () => {
    if (disposed || load.disabled || !['offered', 'evicted', 'cancelled'].includes(phase.phase)) return;
    phase = reducePreview(phase, { type: 'load' }); phase = reducePreview(phase, { type: 'start' }); setStatus(`Loading image: 0/${file.size} bytes`); render();
    const ownGeneration = ++generation; controller = new AbortController();
    try {
      const response = await request(url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('unavailable');
      const declaredLength = response.headers?.get?.('content-length');
      const contentLength = declaredLength === null || declaredLength === undefined || declaredLength === '' ? null : Number(declaredLength);
      if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength !== file.size || contentLength > ImagePreviewLimits.encodedBytes)) throw new Error('too-large');
      bytes = await read(response, controller.signal);
      if (disposed || ownGeneration !== generation) return;
      phase = reducePreview(phase, { type: 'complete' }); const inspected = inspectImageBytes(bytes, file.size, file.mediaType);
      if (!inspected.ok) { terminalState(inspected.reason, 'Image preview could not be safely displayed.'); return; }
      phase = reducePreview(phase, { type: 'valid' });
      if (!memory.admit(String(file.serverFileId), bytes.byteLength, inspected.pixels)) {
        terminalState('too-large', 'Image preview exceeds memory limits.'); return;
      }
      objectUrl = urls.createObjectURL(new Blob([bytes], { type: inspected.format })); bytes = undefined;
      const image = document.createElement('img'); image.className = 'image-preview-image'; image.decoding = 'async'; image.alt = file.name ? `Shared image: ${file.name}` : 'Shared image'; image.width = inspected.width; image.height = inspected.height; image.src = objectUrl;
      await image.decode();
      if (disposed || ownGeneration !== generation || phase.phase !== 'decoding') return;
      if (image.naturalWidth !== inspected.width || image.naturalHeight !== inspected.height) throw new Error('dimension-mismatch');
      phase = reducePreview(phase, { type: 'decoded' }); setStatus(`Image loaded: ${inspected.width} by ${inspected.height} pixels.`); render(image);
      root.addEventListener('pointerdown', () => memory.touch(String(file.serverFileId)), { once: true });
    } catch (error) {
      if (disposed || ownGeneration !== generation) return;
      terminalState(error?.name === 'AbortError' ? 'cancelled' : 'decode-error', error?.name === 'AbortError' ? 'Image loading cancelled.' : 'Image preview could not be displayed.');
    }
  };
  load.addEventListener('click', start);
  cancel.addEventListener('click', () => { generation += 1; terminalState('cancelled', 'Image loading cancelled.'); });
  unload.addEventListener('click', () => { generation += 1; terminalState('cancelled', 'Image preview unloaded.'); });
  return { root, load, cancel, cleanup: () => { if (disposed) return; disposed = true; generation += 1; memory.remove(String(file.serverFileId)); cleanup(); }, evict, get phase() { return phase.phase; } };
}
