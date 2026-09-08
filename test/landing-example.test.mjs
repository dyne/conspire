import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadExample(origin = 'https://landing.example.org') {
  const source = await readFile(new URL('../docs/landing-example/room.js', import.meta.url), 'utf8');
  const context = {
    URL,
    Uint8Array,
    window: { location: { origin, assign: () => {} } },
    document: { addEventListener: () => {}, getElementById: () => null },
    crypto: { getRandomValues: (buffer) => buffer.fill(1) },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'room.js' });
  return context.ConspireRoom;
}

test('landing example emits Base58 room IDs without ambiguous characters', async () => {
  const room = await loadExample();
  assert.equal(room.encodeBase58(new Uint8Array([])), '');
  assert.equal(room.encodeBase58(new Uint8Array([0])), '1');
  assert.equal(room.encodeBase58(new Uint8Array([1])), '2');
  assert.match(room.generateRoomId(16), /^[1-9A-HJ-NP-Za-km-z]+$/);
});

test('landing example constructs default and configured Conspire room URLs safely', async () => {
  const room = await loadExample('https://landing.example.org');
  assert.equal(room.roomUrl(undefined, 'room123'), 'https://landing.example.org/room/room123');
  assert.equal(room.roomUrl('https://chat.example.org/conspire/', 'room123'), 'https://chat.example.org/conspire/room/room123');
  assert.throws(() => room.roomUrl('javascript:alert(1)', 'room123'), /HTTP\(S\) origin/);
  assert.throws(() => room.roomUrl('https://token@example.org', 'room123'), /HTTP\(S\) origin/);
});

test('landing example has no inline CSP exception and documents its configured origin', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../docs/landing-example/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../docs/landing-example/room.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script src="room\.js"><\/script>/);
  assert.doesNotMatch(html, /<style\b|<script(?!\s+src=)/);
  assert.match(html, /data-conspire-origin="https:\/\/chat\.example\.org"/);
  assert.doesNotMatch(script, /CONSPIRE_PORT|8443/);
});
