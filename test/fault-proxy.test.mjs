import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { createFaultProxy } from './fault-proxy.mjs';

test('test-only fault proxy pauses, resumes, caps, and terminates TCP forwarding', async () => {
  const backend = createServer((socket) => socket.on('data', (chunk) => socket.write(chunk)));
  await new Promise((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const backendAddress = backend.address();
  assert(backendAddress && typeof backendAddress !== 'string');
  const proxy = await createFaultProxy({ port: backendAddress.port, cap: 2 });
  const client = createConnection({ host: '127.0.0.1', port: proxy.port });
  const received = [];
  client.on('data', (chunk) => received.push(chunk));
  await new Promise((resolve) => client.once('connect', resolve));
  proxy.pause();
  client.write('paused');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(Buffer.concat(received).toString(), '');
  proxy.resume();
  await new Promise((resolve) => client.once('data', resolve));
  assert.equal(Buffer.concat(received).toString(), 'paused');
  proxy.terminate();
  await new Promise((resolve) => client.once('close', resolve));
  await proxy.close();
  await new Promise((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
});
