import { ImagePreviewLimits, imageCandidateMediaType, previewDimensions } from './protocol.js';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_HEADER_BYTES = 1024 * 1024;
const ANIMATED_PNG_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);
const COMPRESSED_PNG_METADATA_CHUNKS = new Set(['iCCP', 'zTXt']);

function fail(reason) { return Object.freeze({ ok: false, reason }); }
function ok(format, width, height) {
  const dimensions = previewDimensions(width, height);
  return dimensions ? Object.freeze({ ok: true, format, ...dimensions }) : fail('too-large');
}
function u16(bytes, at) { return bytes[at] * 256 + bytes[at + 1]; }
function little16(bytes, at) { return bytes[at] + bytes[at + 1] * 256; }
function u24(bytes, at) { return bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2]; }
function little24(bytes, at) { return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536; }
function u32(bytes, at) { return bytes[at] * 0x1000000 + bytes[at + 1] * 0x10000 + bytes[at + 2] * 256 + bytes[at + 3]; }
function little32(bytes, at) { return bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 0x1000000; }
function ascii(bytes, at, value) { return value.split('').every((char, index) => bytes[at + index] === char.charCodeAt(0)); }

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let at = start; at < end; at += 1) {
    crc ^= bytes[at];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes) {
  if (bytes.length < 57 || !PNG.every((value, index) => bytes[index] === value)) return fail('invalid');
  let at = 8; let dimensions; let colorType; let bitDepth; let sawPalette = false;
  let sawData = false; let dataEnded = false; let dataBytes = 0; let chunks = 0;
  while (at + 12 <= bytes.length) {
    const length = u32(bytes, at); const dataStart = at + 8; const dataEnd = dataStart + length; const end = dataEnd + 4;
    if (!Number.isSafeInteger(end) || end > bytes.length) return fail('invalid');
    for (let index = 4; index < 8; index += 1) {
      const character = bytes[at + index];
      if (!((character >= 65 && character <= 90) || (character >= 97 && character <= 122))) return fail('invalid');
    }
    if (bytes[at + 6] & 0x20) return fail('invalid');
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (crc32(bytes, at + 4, dataEnd) !== u32(bytes, dataEnd)) return fail('invalid');
    if (ANIMATED_PNG_CHUNKS.has(type) || COMPRESSED_PNG_METADATA_CHUNKS.has(type)) return fail('unsupported');
    if (type === 'iTXt') {
      let keywordEnd = dataStart;
      while (keywordEnd < dataEnd && bytes[keywordEnd] !== 0) keywordEnd += 1;
      if (keywordEnd === dataStart || keywordEnd - dataStart > 79 || keywordEnd + 3 > dataEnd) return fail('invalid');
      const compressed = bytes[keywordEnd + 1]; const method = bytes[keywordEnd + 2];
      if (compressed > 1 || method !== 0) return fail('invalid');
      let languageEnd = keywordEnd + 3;
      while (languageEnd < dataEnd && bytes[languageEnd] !== 0) languageEnd += 1;
      let translatedEnd = languageEnd + 1;
      while (translatedEnd < dataEnd && bytes[translatedEnd] !== 0) translatedEnd += 1;
      if (languageEnd >= dataEnd || translatedEnd >= dataEnd) return fail('invalid');
      // Native decoders need not inflate non-image metadata to render a preview.
      if (compressed === 1) return fail('unsupported');
    }
    if (chunks === 0) {
      if (type !== 'IHDR' || length !== 13) return fail('invalid');
      dimensions = ok('image/png', u32(bytes, dataStart), u32(bytes, dataStart + 4));
      if (!dimensions.ok) return dimensions;
      bitDepth = bytes[dataStart + 8]; colorType = bytes[dataStart + 9];
      const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!validDepths[colorType]?.includes(bitDepth) || bytes[dataStart + 10] !== 0 ||
          bytes[dataStart + 11] !== 0 || ![0, 1].includes(bytes[dataStart + 12])) return fail('unsupported');
    } else if (type === 'IHDR') {
      return fail('invalid');
    } else if (type === 'PLTE') {
      if (sawPalette || sawData || colorType === 0 || colorType === 4 || length === 0 || length > 768 || length % 3 !== 0 ||
          (colorType === 3 && length / 3 > 2 ** bitDepth)) return fail('invalid');
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (colorType === 3 && !sawPalette)) return fail('invalid');
      sawData = true; dataBytes += length;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData || dataBytes === 0 || end !== bytes.length) return fail('invalid');
      return dimensions;
    } else {
      if (sawData) dataEnded = true;
      if ((bytes[at + 4] & 0x20) === 0) return fail('unsupported');
    }
    chunks += 1; at = end;
  }
  return fail('invalid');
}

function isSof(marker) {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('invalid');
  let at = 2; let pendingMarker; let dimensions; let componentIds; let componentQuantizers; let frameMarker; let sawScan = false;
  const initialComponents = new Set();
  const quantizers = new Set(); const dcTables = new Set(); const acTables = new Set();
  while (at < bytes.length || pendingMarker !== undefined) {
    if (!dimensions && at >= MAX_HEADER_BYTES) return fail('unsupported');
    let marker;
    if (pendingMarker !== undefined) { marker = pendingMarker; pendingMarker = undefined; }
    else {
      if (bytes[at++] !== 0xff) return fail('invalid');
      while (at < bytes.length && bytes[at] === 0xff) at += 1;
      if (at >= bytes.length) return fail('invalid');
      marker = bytes[at++];
    }
    if (marker === 0xd9) return dimensions && sawScan && initialComponents.size === componentIds.size && at === bytes.length ? dimensions : fail('invalid');
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return fail('invalid');
    if (marker === 0x01) return fail('unsupported');
    if (at + 2 > bytes.length) return fail('invalid');
    const length = u16(bytes, at); const end = at + length;
    if (length < 2 || !Number.isSafeInteger(end) || end > bytes.length) return fail('invalid');
    if (!dimensions && end > MAX_HEADER_BYTES) return fail('unsupported');
    if (isSof(marker)) {
      if (dimensions) return fail('invalid');
      if (![0xc0, 0xc1, 0xc2].includes(marker) || end > MAX_HEADER_BYTES || length < 11 || bytes[at + 2] !== 8) return fail('unsupported');
      const componentCount = bytes[at + 7];
      if (componentCount === 0 || componentCount > 4 || length !== 8 + 3 * componentCount) return fail('invalid');
      dimensions = ok('image/jpeg', u16(bytes, at + 5), u16(bytes, at + 3));
      if (!dimensions.ok) return dimensions;
      frameMarker = marker; componentIds = new Set(); componentQuantizers = new Map();
      for (let index = 0; index < componentCount; index += 1) {
        const componentAt = at + 8 + index * 3; const id = bytes[componentAt]; const sampling = bytes[componentAt + 1];
        if (componentIds.has(id) || (sampling >> 4) === 0 || (sampling >> 4) > 4 || (sampling & 0x0f) === 0 ||
            (sampling & 0x0f) > 4 || bytes[componentAt + 2] > 3) return fail('invalid');
        componentIds.add(id); componentQuantizers.set(id, bytes[componentAt + 2]);
      }
    } else if (marker === 0xdb) {
      let item = at + 2;
      while (item < end) {
        const precision = bytes[item] >> 4; const id = bytes[item] & 0x0f; const tableBytes = precision === 0 ? 64 : 128;
        if (precision > 1 || id > 3 || item + 1 + tableBytes > end) return fail('invalid');
        for (let valueAt = item + 1; valueAt < item + 1 + tableBytes; valueAt += precision + 1) {
          const value = precision === 0 ? bytes[valueAt] : u16(bytes, valueAt);
          if (value === 0) return fail('invalid');
        }
        quantizers.add(id); item += 1 + tableBytes;
      }
      if (item !== end) return fail('invalid');
    } else if (marker === 0xc4) {
      let item = at + 2;
      while (item < end) {
        if (item + 17 > end) return fail('invalid');
        const tableClass = bytes[item] >> 4; const id = bytes[item] & 0x0f;
        if (tableClass > 1 || id > 3) return fail('invalid');
        let symbols = 0; let availableCodes = 1;
        for (let depth = 1; depth <= 16; depth += 1) {
          availableCodes = availableCodes * 2 - bytes[item + depth]; symbols += bytes[item + depth];
          if (availableCodes < 0) return fail('invalid');
        }
        if (symbols === 0 || symbols > 256 || item + 17 + symbols > end) return fail('invalid');
        (tableClass === 0 ? dcTables : acTables).add(id); item += 17 + symbols;
      }
      if (item !== end) return fail('invalid');
    } else if (marker === 0xdd) {
      if (length !== 4) return fail('invalid');
    } else if (marker === 0xda) {
      if (!dimensions || length < 8) return fail('invalid');
      for (const quantizer of componentQuantizers.values()) if (!quantizers.has(quantizer)) return fail('invalid');
      const scanComponents = bytes[at + 2];
      if (scanComponents === 0 || scanComponents > componentIds.size || length !== 6 + 2 * scanComponents) return fail('invalid');
      const scanIds = new Set();
      for (let index = 0; index < scanComponents; index += 1) {
        const componentAt = at + 3 + index * 2; const id = bytes[componentAt]; const tables = bytes[componentAt + 1];
        if (!componentIds.has(id) || scanIds.has(id) || (tables >> 4) > 3 || (tables & 0x0f) > 3) return fail('invalid');
        scanIds.add(id);
      }
      const spectralAt = at + 3 + 2 * scanComponents;
      const spectralStart = bytes[spectralAt]; const spectralEnd = bytes[spectralAt + 1];
      const successiveHigh = bytes[spectralAt + 2] >> 4; const successiveLow = bytes[spectralAt + 2] & 0x0f;
      if (spectralStart > spectralEnd || spectralEnd > 63 || successiveHigh > 13 || successiveLow > 13) return fail('invalid');
      if (frameMarker !== 0xc2 && (spectralStart !== 0 || spectralEnd !== 63 || successiveHigh !== 0 || successiveLow !== 0)) return fail('invalid');
      if (frameMarker === 0xc2 && ((spectralStart === 0 && spectralEnd !== 0) || (spectralStart > 0 && scanComponents !== 1) ||
          (successiveHigh > 0 && successiveHigh !== successiveLow + 1))) return fail('invalid');
      if (frameMarker === 0xc2 && (spectralStart > 0 || successiveHigh > 0)) {
        for (const id of scanIds) if (!initialComponents.has(id)) return fail('invalid');
      }
      for (let index = 0; index < scanComponents; index += 1) {
        const tables = bytes[at + 4 + index * 2];
        if ((spectralStart === 0 && !dcTables.has(tables >> 4)) ||
            (spectralEnd > 0 && !acTables.has(tables & 0x0f))) return fail('invalid');
      }
      if (spectralStart === 0 && successiveHigh === 0) for (const id of scanIds) initialComponents.add(id);
      sawScan = true; at = end;
      let scanDataBytes = 0;
      while (at < bytes.length) {
        if (bytes[at++] !== 0xff) { scanDataBytes += 1; continue; }
        while (at < bytes.length && bytes[at] === 0xff) at += 1;
        if (at >= bytes.length) return fail('invalid');
        const next = bytes[at++];
        if (next === 0x00) { scanDataBytes += 1; continue; }
        if (next >= 0xd0 && next <= 0xd7) continue;
        if (scanDataBytes === 0) return fail('invalid');
        pendingMarker = next; break;
      }
      if (pendingMarker === undefined) return fail('invalid');
      continue;
    } else if (marker === 0xcc || (marker >= 0xdc && marker <= 0xdf)) {
      return fail('unsupported');
    } else if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      return fail('unsupported');
    }
    at = end;
  }
  return fail('invalid');
}
function inspectWebp(bytes) {
  if (bytes.length < 16 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || little32(bytes, 4) + 8 !== bytes.length) return fail('invalid');
  let at = 12; let canvas = null; let primary = null; let flags = 0; let chunks = 0; let primaryTag; let primaryHasAlpha = false;
  const features = new Set();
  while (at + 8 <= bytes.length) {
    const tag = String.fromCharCode(...bytes.slice(at, at + 4)); const length = little32(bytes, at + 4);
    const end = at + 8 + length + (length & 1);
    if (!Number.isSafeInteger(end) || end > bytes.length || ((length & 1) && bytes[end - 1] !== 0)) return fail('invalid');
    if (tag === 'ANIM' || tag === 'ANMF') return fail('unsupported');
    if (tag === 'VP8X') {
      if (length !== 10 || chunks !== 0 || canvas) return fail('invalid');
      flags = bytes[at + 8];
      if ((flags & 0x02) || (flags & 0xc1) || bytes[at + 9] !== 0 || bytes[at + 10] !== 0 || bytes[at + 11] !== 0) return fail('unsupported');
      canvas = ok('image/webp', little24(bytes, at + 12) + 1, little24(bytes, at + 15) + 1);
      if (!canvas.ok) return canvas;
    } else if (tag === 'VP8 ') {
      const frameTag = little24(bytes, at + 8);
      const firstPartition = frameTag >>> 5;
      if (length < 11 || (frameTag & 1) !== 0 || ((frameTag >> 1) & 0x07) > 3 || (frameTag & 0x10) === 0 ||
          firstPartition === 0 || firstPartition > length - 10 ||
          bytes[at + 11] !== 0x9d || bytes[at + 12] !== 0x01 || bytes[at + 13] !== 0x2a) return fail('invalid');
      if (primary) return fail('invalid');
      primary = ok('image/webp', little16(bytes, at + 14) & 0x3fff, little16(bytes, at + 16) & 0x3fff);
      primaryTag = tag;
      if (!primary.ok) return primary;
    } else if (tag === 'VP8L') {
      if (length < 6 || bytes[at + 8] !== 0x2f) return fail('invalid');
      if (primary) return fail('invalid');
      const value = little32(bytes, at + 9);
      if (value >>> 29) return fail('unsupported');
      primary = ok('image/webp', (value & 0x3fff) + 1, ((value >> 14) & 0x3fff) + 1);
      primaryTag = tag; primaryHasAlpha = Boolean(value & 0x10000000);
      if (!primary.ok) return primary;
    } else if (['ICCP', 'ALPH', 'EXIF', 'XMP '].includes(tag)) {
      if (!canvas || features.has(tag) || (tag === 'ICCP' && primary) || (tag === 'ALPH' && (primary || length < 2)) ||
          (tag !== 'ALPH' && tag !== 'ICCP' && !primary)) return fail('invalid');
      if (tag === 'ALPH') {
        const header = bytes[at + 8];
        if ((header & 0xc0) || ((header >> 4) & 0x03) > 1 || (header & 0x03) > 1) return fail('unsupported');
      }
      features.add(tag);
    } else if (!canvas && !primary) {
      return fail('unsupported');
    }
    chunks += 1; at = end;
  }
  if (at !== bytes.length || !primary) return fail('invalid');
  if (!canvas) return chunks === 1 ? primary : fail('invalid');
  if (canvas.width !== primary.width || canvas.height !== primary.height ||
      Boolean(flags & 0x20) !== features.has('ICCP') || Boolean(flags & 0x08) !== features.has('EXIF') ||
      Boolean(flags & 0x04) !== features.has('XMP ') || Boolean(flags & 0x10) !== (features.has('ALPH') || primaryHasAlpha)) return fail('invalid');
  if (features.has('ALPH') && primaryTag !== 'VP8 ') return fail('invalid');
  return primary;
}

/** Bounded, decoder-free verification of untrusted encoded image bytes. */
export function inspectImageBytes(input, declaredSize, hint) {
  if (!(input instanceof Uint8Array) || !Number.isSafeInteger(declaredSize) || declaredSize < 0) return fail('invalid');
  if (declaredSize > ImagePreviewLimits.encodedBytes) return fail('too-large');
  if (input.byteLength !== declaredSize) return fail('invalid');
  const expected = imageCandidateMediaType(hint); if (!expected) return fail('unsupported');
  const result = expected === 'image/png' ? inspectPng(input) : expected === 'image/jpeg' ? inspectJpeg(input) : inspectWebp(input);
  return result.ok && result.format !== expected ? fail('unsupported') : result;
}

const terminal = new Set(['unsupported', 'invalid', 'too-large', 'unavailable']);
export function reducePreview(state = { phase: 'offered' }, event) {
  const phase = state.phase;
  if (terminal.has(phase)) return state;
  const transitions = { offered: { load: 'confirmed', unavailable: 'unavailable' }, confirmed: { start: 'downloading', cancel: 'cancelled', unavailable: 'unavailable' }, downloading: { complete: 'inspecting', cancel: 'cancelled', unavailable: 'unavailable' }, inspecting: { valid: 'decoding', invalid: event.reason || 'invalid', unavailable: 'unavailable' }, decoding: { decoded: 'visible', error: 'retryable-error', cancel: 'cancelled', unavailable: 'unavailable' }, visible: { evict: 'evicted', cancel: 'cancelled', unavailable: 'unavailable' }, cancelled: { load: 'confirmed', unavailable: 'unavailable' }, evicted: { load: 'confirmed', unavailable: 'unavailable' }, 'retryable-error': { load: 'confirmed', unavailable: 'unavailable' } };
  const next = transitions[phase]?.[event.type];
  return next ? { phase: next } : state;
}

export class PreviewRegistry {
  constructor(limits = ImagePreviewLimits) {
    this.controllers = new Map();
    this.memory = new PreviewMemory(limits, (id) => this.controllers.get(String(id))?.evict());
  }
  register(id, preview) {
    const key = String(id); this.remove(key); this.controllers.set(key, preview); return preview;
  }
  remove(id) {
    const key = String(id); const preview = this.controllers.get(key);
    if (!preview) return this.memory.remove(key);
    preview.cleanup(); preview.root.remove(); this.controllers.delete(key); return true;
  }
  unavailable(id) {
    const key = String(id); const preview = this.controllers.get(key);
    if (!preview) return false;
    preview.unavailable(); this.controllers.delete(key); return true;
  }
  clear() { for (const id of [...this.controllers.keys()]) this.remove(id); this.memory.clear(); }
  get size() { return this.controllers.size; }
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
  clear() { this.entries.clear(); }
  bytes() { return [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0); }
  pixels() { return [...this.entries.values()].reduce((sum, item) => sum + item.pixels, 0); }
}

/** DOM adapter: it intentionally owns no protocol state and never fetches before its button is clicked. */
export function createImagePreviewController({ file, url, download, document, memory, fetch: request = globalThis.fetch, URL: urls = globalThis.URL }) {
  let phase = { phase: 'offered' }; let controller; let objectUrl; let imageElement; let disposed = false; let generation = 0; let bytes;
  const root = document.createElement('div'); root.className = 'image-preview';
  const status = document.createElement('p'); status.className = 'file-info-size image-preview-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const load = document.createElement('button'); load.type = 'button'; load.className = 'image-preview-action';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'image-preview-action'; cancel.textContent = 'Cancel image load';
  const unload = document.createElement('button'); unload.type = 'button'; unload.className = 'image-preview-action'; unload.textContent = 'Unload image';
  const offerText = `Image offered: ${file.name || 'Shared image'} (${file.size} bytes). JPEG, PNG, or WebP previews require confirmation.`;
  const setStatus = (text) => { status.textContent = text; };
  const render = (image = undefined) => {
    root.dataset.previewState = phase.phase;
    if (phase.phase === 'downloading' || phase.phase === 'inspecting' || phase.phase === 'decoding') {
      root.replaceChildren(status, cancel);
      return;
    }
    if (phase.phase === 'visible' && image) {
      root.replaceChildren(image, status, unload);
      return;
    }
    if (['offered', 'cancelled', 'evicted', 'retryable-error'].includes(phase.phase)) {
      load.disabled = false;
      load.textContent = phase.phase === 'offered' ? `Load image (${file.size} bytes)` : 'Retry image preview';
      root.replaceChildren(status, load);
      return;
    }
    root.replaceChildren(status);
  };
  setStatus(offerText); render();
  const release = () => {
    if (controller) controller.abort(); controller = undefined; bytes = undefined;
    memory.remove(String(file.serverFileId));
    if (imageElement) { imageElement.removeAttribute('src'); imageElement = undefined; }
    if (objectUrl) { urls.revokeObjectURL(objectUrl); objectUrl = undefined; }
  };
  const terminalState = (next, text) => { phase = { phase: next }; release(); setStatus(text); render(); };
  const evict = () => { generation += 1; terminalState('evicted', 'Preview unloaded to save memory.'); };
  const read = async (response, signal) => {
    const reader = response.body?.getReader(); if (!reader) throw new Error('streaming-unavailable');
    const chunks = []; let received = 0;
    while (true) { const part = await reader.read(); if (part.done) break; received += part.value.byteLength;
      if (received > file.size || received > ImagePreviewLimits.encodedBytes) throw new Error('too-large'); chunks.push(part.value); setStatus(`Loading image: ${received}/${file.size} bytes`); }
    const result = new Uint8Array(received); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; } return result;
  };
  const start = async () => {
    if (disposed || load.disabled || !['offered', 'evicted', 'cancelled', 'retryable-error'].includes(phase.phase)) return;
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
      controller = undefined;
      phase = reducePreview(phase, { type: 'complete' }); const inspected = inspectImageBytes(bytes, file.size, file.mediaType);
      if (!inspected.ok) { terminalState(inspected.reason, 'Image preview could not be safely displayed.'); return; }
      phase = reducePreview(phase, { type: 'valid' });
      if (!memory.admit(String(file.serverFileId), bytes.byteLength, inspected.pixels)) {
        terminalState('too-large', 'Image preview exceeds memory limits.'); return;
      }
      objectUrl = urls.createObjectURL(new Blob([bytes], { type: inspected.format })); bytes = undefined;
      const image = document.createElement('img'); imageElement = image; image.className = 'image-preview-image'; image.decoding = 'async'; image.alt = file.name ? `Shared image: ${file.name}` : 'Shared image'; image.width = inspected.width; image.height = inspected.height; image.src = objectUrl;
      await image.decode();
      if (disposed || ownGeneration !== generation || phase.phase !== 'decoding') return;
      if (image.naturalWidth !== inspected.width || image.naturalHeight !== inspected.height) {
        terminalState('invalid', 'Image dimensions did not match the verified container. Download remains available.'); return;
      }
      phase = reducePreview(phase, { type: 'decoded' }); setStatus(`Image loaded: ${inspected.width} by ${inspected.height} pixels.`); render(image);
    } catch (error) {
      if (disposed || ownGeneration !== generation) return;
      if (error?.name === 'AbortError') terminalState('cancelled', 'Image loading cancelled.');
      else if (error?.message === 'too-large') terminalState('too-large', 'Image preview exceeded its declared or encoded byte limit. Download remains available.');
      else terminalState('retryable-error', 'Image preview failed to load or decode. Retry or download the file.');
    }
  };
  const cancelLoad = () => { generation += 1; terminalState('cancelled', 'Image loading cancelled.'); };
  const unloadImage = () => { generation += 1; terminalState('cancelled', 'Image preview unloaded.'); };
  const touch = () => { if (phase.phase === 'visible') memory.touch(String(file.serverFileId)); };
  const removeHandlers = () => {
    load.removeEventListener('click', start); cancel.removeEventListener('click', cancelLoad); unload.removeEventListener('click', unloadImage);
    root.removeEventListener('pointerdown', touch); root.removeEventListener('focusin', touch);
  };
  load.addEventListener('click', start); cancel.addEventListener('click', cancelLoad); unload.addEventListener('click', unloadImage);
  root.addEventListener('pointerdown', touch); root.addEventListener('focusin', touch);
  const unavailable = () => {
    if (disposed) return; disposed = true; generation += 1; phase = reducePreview(phase, { type: 'unavailable' });
    release(); removeHandlers();
    if (download) { download.removeAttribute('href'); download.removeAttribute('target'); download.setAttribute('aria-disabled', 'true'); download.textContent = `${file.name || 'Shared image'} (unavailable after source reload)`; }
    setStatus('Image preview unavailable because the source reloaded.'); render();
  };
  return { root, load, cancel, cleanup: () => { if (disposed) return; disposed = true; generation += 1; release(); removeHandlers(); }, unavailable, evict, get phase() { return phase.phase; } };
}
