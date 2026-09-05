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
  for (const file of ['front/index.html', 'front/chat/index.html']) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /<title>%%%CONSPIRE_TITLE%%%<\/title>/, file);
  }

  const controller = await readFile(
    new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8');
  assert.match(controller, /pageTitle\(version/);
  assert.match(controller, /replaceLiteral\(page, "%%%CONSPIRE_TITLE%%%"/);
});

test('the server embeds its complete frontend instead of loading runtime files', async () => {
  const [cmake, generator, controller] = await Promise.all([
    readFile(new URL('../server/CMakeLists.txt', import.meta.url), 'utf8'),
    readFile(new URL('../server/cmake/EmbedFrontend.cmake', import.meta.url), 'utf8'),
    readFile(new URL('../server/src/controller/StaticController.hpp', import.meta.url), 'utf8'),
  ]);
  assert.match(cmake, /GLOB_RECURSE CONSPIRE_FRONTEND_ASSETS CONFIGURE_DEPENDS/);
  assert.match(cmake, /EmbedFrontend\.cmake/);
  assert.match(generator, /file\(GLOB_RECURSE frontend_assets/);
  assert.match(controller, /findAsset\(path\)/);
  assert.match(controller, /loadAsset\("style\.css"\)/);
  assert.doesNotMatch(controller, /loadFromFile|frontPath/);
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
