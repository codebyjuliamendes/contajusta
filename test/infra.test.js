'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { redactPath } = require('../src/http/request-context');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

async function withServer(options, fn) {
  const server = createApp(openDatabase(':memory:'), options).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('config: padrões e validação no boot', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.rateLimitPerMinute, 60);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT inválido/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL inválido/);
});

test('logger: JSON por linha, respeita nível e herda campos', () => {
  const lines = [];
  const logger = createLogger({ level: 'info', write: line => lines.push(JSON.parse(line)) }).child({ requestId: 'abc' });
  logger.debug('oculto');
  logger.warn('visivel', { status: 404 });
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].level, lines[0].msg, lines[0].requestId, lines[0].status], ['warn', 'visivel', 'abc', 404]);
});

test('chaves de grupo não aparecem inteiras nos logs', () => {
  assert.equal(redactPath('/api/groups/dHhMGeUpQJ8nJ0LGbeKq2g/summary?x=1'), '/api/groups/dHhM…/summary');
  assert.equal(redactPath('/g/dHhMGeUpQJ8nJ0LGbeKq2g'), '/g/dHhM…');
  assert.equal(redactPath('/api/health'), '/api/health');
});

test('log de acesso com request id propagado e caminho redigido', async () => {
  const lines = [];
  const logger = createLogger({ write: line => lines.push(JSON.parse(line)) });
  await withServer({ logger }, async url => {
    const res = await fetch(`${url}/api/groups/dHhMGeUpQJ8nJ0LGbeKq2g/summary`, { headers: { 'X-Request-Id': 'req-12345678' } });
    assert.equal(res.headers.get('x-request-id'), 'req-12345678');
  });
  const entry = lines.find(l => l.msg === 'request');
  assert.deepEqual([entry.requestId, entry.status, entry.path], ['req-12345678', 404, '/api/groups/dHhM…/summary']);
});

test('rate limit só em escritas e responde 429 com Retry-After', async () => {
  await withServer({ rateLimitPerMinute: 2 }, async url => {
    const create = () => fetch(`${url}/api/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await create()).status, 400);
    assert.equal((await create()).status, 400);
    const limited = await create();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match((await limited.json()).error, /Muitas requisições/);
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  });
});

test('SPA servida no link de convite sem cache', async () => {
  await withServer({}, async url => {
    const res = await fetch(`${url}/g/dHhMGeUpQJ8nJ0LGbeKq2g`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.match(await res.text(), /<title>/);
  });
});

test('backup gera cópia consistente e aplica retenção', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contajusta-backup-'));
  try {
    const databasePath = path.join(dir, 'app.sqlite');
    openDatabase(databasePath).close();
    const env = { ...process.env, DATABASE_PATH: databasePath, BACKUP_KEEP: '2' };
    for (let i = 0; i < 3; i++)
      execFileSync(process.execPath, ['scripts/backup.js', path.join(dir, 'bk')], { env, cwd: path.join(__dirname, '..') });
    const files = fs.readdirSync(path.join(dir, 'bk'));
    assert.equal(files.length, 2);
    const copy = openDatabase(path.join(dir, 'bk', files[0]));
    assert.equal(copy.pragma('user_version', { simple: true }), 4);
    copy.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
