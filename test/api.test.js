const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let child, baseUrl, tempDir;
before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contajusta-test-'));
  const port = 20000 + Math.floor(Math.random() * 40000);
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(tempDir, 'test.sqlite') }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try { if ((await fetch(`${baseUrl}/api/groups`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not become ready');
});
after(async () => {
  if (child && child.exitCode === null) { child.kill(); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]); }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

async function json(url, options) { const response = await fetch(baseUrl + url, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } }); return { response, body: await response.json() }; }

test('creates groups, preserves cent-exact equal shares, and supports validated custom splits', async () => {
  const created = await json('/api/groups', { method: 'POST', body: JSON.stringify({ name: 'Test trip', members: ['Alex', 'Sam'] }) });
  assert.equal(created.response.status, 201);
  const [alex, sam] = created.body.members;

  const equal = await json(`/api/groups/${created.body.id}/expenses`, { method: 'POST', body: JSON.stringify({ description: 'Odd-cent bill', amount: 10.01, paidBy: alex.id }) });
  assert.equal(equal.response.status, 201);
  assert.equal(equal.body.amountCents, 1001);

  const invalid = await json(`/api/groups/${created.body.id}/expenses`, { method: 'POST', body: JSON.stringify({ description: 'Bad custom split', amount: 20, paidBy: alex.id, shares: [{ memberId: alex.id, amountCents: 500 }, { memberId: sam.id, amountCents: 501 }] }) });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /soma das parcelas/i);

  const custom = await json(`/api/groups/${created.body.id}/expenses`, { method: 'POST', body: JSON.stringify({ description: 'Custom dinner', amount: 20, paidBy: alex.id, shares: [{ memberId: alex.id, amountCents: 500 }, { memberId: sam.id, amountCents: 1500 }] }) });
  assert.equal(custom.response.status, 201);
  const summary = await json(`/api/groups/${created.body.id}/summary`);
  assert.deepEqual(summary.body.balances.map(x => x.balanceCents), [2000, -2000]);
  assert.equal(summary.body.expenses.reduce((sum, x) => sum + x.amountCents, 0), 3001);
});
