import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const origin = new URL(process.argv[2] || 'http://localhost:3000').origin;
let healthy = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(5000) });
    if (response.ok && (await response.text()) === 'ok') {
      healthy = true;
      break;
    }
  } catch {
    /* Allow deployment readiness and cold starts. */
  }
  await delay(5000);
}
assert(healthy, 'The application did not become healthy');
const page = await fetch(origin, { signal: AbortSignal.timeout(15000) });
assert.equal(page.status, 200, 'The SvelteKit page must load');
assert.match(await page.text(), /Among Devs/i);

const clients = [];
try {
  let code;
  for (const name of ['Smoke Alex', 'Smoke Sam', 'Smoke Jo']) {
    const socket = io(origin, {
      transports: ['websocket'],
      extraHeaders: { Origin: origin },
      reconnection: false,
      timeout: 15000
    });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const reply = await socket
      .timeout(15000)
      .emitWithAck('enter', { name, ...(code ? { code } : {}) });
    assert.equal(reply.error, undefined, `Lobby join failed: ${reply.error}`);
    assert.match(reply.code, /^[A-Z0-9]{6}$/);
    assert(reply.token, 'Reconnect credential is missing');
    if (code) assert.equal(reply.code, code);
    code = reply.code;
  }
  console.log(
    `Smoke test passed: HTTPS/HTTP page, health endpoint, and three WebSocket lobby joins at ${origin}`
  );
} finally {
  for (const client of clients) client.disconnect();
}
