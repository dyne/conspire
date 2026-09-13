import { createConnection, createServer } from 'node:net';

/** Test-only TCP forwarder for reproducible delay/pause/drop scenarios. */
export async function createFaultProxy({ host = '127.0.0.1', port, delay = 0, cap = 0 }) {
  const pairs = new Set();
  let paused = false;
  const forward = (source, destination) => {
    source.on('data', (chunk) => {
      const write = () => {
        for (let offset = 0; offset < chunk.length; offset += cap || chunk.length) {
          destination.write(chunk.subarray(offset, offset + (cap || chunk.length)));
        }
      };
      if (delay > 0) setTimeout(write, delay);
      else write();
    });
    source.on('end', () => destination.end());
    source.on('error', () => destination.destroy());
  };
  const server = createServer((client) => {
    const upstream = createConnection({ host, port });
    const pair = { client, upstream };
    pairs.add(pair);
    const cleanup = () => pairs.delete(pair);
    client.once('close', cleanup);
    upstream.once('close', cleanup);
    forward(client, upstream);
    forward(upstream, client);
    if (paused) { client.pause(); upstream.pause(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('proxy did not bind TCP port');
  return {
    port: address.port,
    pause() { paused = true; for (const pair of pairs) { pair.client.pause(); pair.upstream.pause(); } },
    resume() { paused = false; for (const pair of pairs) { pair.client.resume(); pair.upstream.resume(); } },
    terminate() { for (const pair of pairs) { pair.client.destroy(); pair.upstream.destroy(); } },
    async close() {
      this.terminate();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
