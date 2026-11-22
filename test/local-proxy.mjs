// A local forward proxy for tests. It answers an absolute-URL request itself
// (undici 8, Node 26) and tunnels a CONNECT (undici 6 and 7, Node 22 and 24,
// even for http URLs) to its own origin server, so a request through it never
// reaches the address it names. `handler` answers both; `requests` lists what
// the proxy received, as "GET <absolute URL>" or "CONNECT <host:port>".
import { createServer } from 'node:http';
import net from 'node:net';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export async function startLocalProxy(handler) {
  const requests = [];
  const tunnels = new Set();
  const origin = createServer(handler);
  const proxy = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  proxy.on('connect', (req, socket, head) => {
    requests.push(`CONNECT ${req.url}`);
    tunnels.add(socket);
    socket.on('close', () => tunnels.delete(socket));
    const upstream = net.connect(origin.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  try {
    await listen(origin);
    await listen(proxy);
  } catch (error) {
    origin.close();
    proxy.close();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    requests,
    close: async () => {
      for (const socket of tunnels) socket.destroy();
      for (const server of [proxy, origin]) server.closeAllConnections();
      await Promise.all([proxy, origin].map((server) => new Promise((resolve) => server.close(resolve))));
    },
  };
}

/** The path a proxied request asked for, from an absolute URL or a tunnelled one. */
export function proxiedPath(req) {
  return new URL(req.url, 'http://tunnel.invalid').pathname;
}
