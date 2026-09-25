import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const origin = new URL(process.argv[2]).origin;
let lastError;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');
    const page = await fetch(origin, { signal: AbortSignal.timeout(15000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Among Devs/i);
    console.log(`Custom-domain HTTPS smoke test passed at ${origin}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 59) await delay(5000);
  }
}
throw new Error(`Custom-domain HTTPS check failed at ${origin}: ${lastError?.message}`);
