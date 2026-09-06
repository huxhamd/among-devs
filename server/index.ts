import { createServer, type RequestListener } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { Session } from './session.ts';
import type { Action, Reply } from '../src/lib/shared.ts';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || (dev ? 5173 : 3000));
let handler: RequestListener = (_req, res) => {
  res.writeHead(503);
  res.end('Starting');
};
const http = createServer((req, res) => handler(req, res));
const io = new Server(http, {
  maxHttpBufferSize: 4096,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    let permitted = !origin;
    try {
      permitted ||= process.env.ORIGIN
        ? origin === process.env.ORIGIN
        : new URL(origin!).host === req.headers.host;
    } catch {
      /* Reject malformed origins. */
    }
    callback(null, permitted);
  }
});
const rooms = new Map<string, Session>();
const attempts = new Map<string, { count: number; expires: number }>();
function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value: string;
  do {
    value = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(value));
  return value;
}
io.on('connection', (socket) => {
  let room: Session | undefined,
    memberId = '';
  let actions = 0,
    windowStart = Date.now();
  socket.on('enter', (input: unknown, ack?: (reply: Reply) => void) => {
    if (typeof ack !== 'function') return;
    try {
      if (room) throw new Error('You have already joined a workspace.');
      const address = socket.handshake.address;
      const now = Date.now();
      const limit = attempts.get(address) ?? { count: 0, expires: now + 60_000 };
      if (limit.expires < now) {
        limit.count = 0;
        limit.expires = now + 60_000;
      }
      attempts.set(address, limit);
      if (++limit.count > 60) throw new Error('Too many attempts. Please wait a minute.');
      if (!input || typeof input !== 'object') throw new Error('Invalid workspace details.');
      const data = input as Record<string, unknown>;
      if (
        typeof data.name !== 'string' ||
        (data.code !== undefined && typeof data.code !== 'string') ||
        (data.token !== undefined && typeof data.token !== 'string')
      )
        throw new Error('Invalid workspace details.');
      const joining = typeof data.code === 'string' && !!data.code.trim();
      if (!joining && rooms.size >= 100)
        throw new Error('All workspaces are busy. Please try later.');
      const target = joining
        ? rooms.get((data.code as string).trim().toUpperCase())
        : new Session(code());
      if (!target) throw new Error('Workspace not found. Check the six-character code.');
      const member = target.join(data.name, socket.id, data.token as string | undefined);
      room = target;
      memberId = member.id;
      rooms.set(target.code, target);
      ack({ token: member.token, code: target.code });
      socket.emit('state', room.snapshot(memberId));
    } catch (error) {
      ack({ error: error instanceof Error ? error.message : 'Unable to join.' });
    }
  });
  socket.on('action', (input: unknown, ack?: (reply: Reply) => void) => {
    try {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        actions = 0;
        windowStart = now;
      }
      if (++actions > 35) throw new Error('Please slow down.');
      if (
        !room ||
        !input ||
        typeof input !== 'object' ||
        typeof (input as Action).type !== 'string'
      )
        throw new Error('Join a workspace first.');
      room.tick(now);
      room.action(memberId, input as Action, now);
      if (typeof ack === 'function') ack({});
    } catch (error) {
      if (typeof ack === 'function')
        ack({ error: error instanceof Error ? error.message : 'Action unavailable.' });
    }
  });
  socket.on('disconnect', () => room?.disconnect(socket.id));
});
const interval = setInterval(() => {
  const now = Date.now();
  for (const [key, room] of rooms) {
    room.tick(now);
    if (
      !room.players.some((p) => p.connected) &&
      room.players.every((p) => now - p.disconnectedAt > 60_000)
    ) {
      rooms.delete(key);
      continue;
    }
    for (const p of room.players)
      if (p.socket) io.to(p.socket).emit('state', room.snapshot(p.id, now));
  }
  for (const [key, limit] of attempts) if (limit.expires < now) attempts.delete(key);
}, 100);

if (dev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server: http } },
    appType: 'custom'
  });
  handler = vite.middlewares;
} else {
  // SvelteKit emits this handler at build time; keep its import external to the server bundle.
  const path = '../build/handler.js';
  const { handler: svelteHandler } = await import(path);
  handler = (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    svelteHandler(req, res);
  };
}
http.listen(port, '0.0.0.0', () => console.log(`Among Devs listening on http://localhost:${port}`));
function shutdown() {
  clearInterval(interval);
  io.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
