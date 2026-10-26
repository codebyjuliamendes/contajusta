'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server, baseUrl;

test.before(async () => {
  server = createApp(openDatabase(':memory:')).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function request(method, url, body) {
  const response = await fetch(baseUrl + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : body && JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createGroup(members = ['Ana', 'Bia', 'Caio']) {
  const { status, body } = await request('POST', '/api/groups', { name: 'Viagem', members });
  assert.equal(status, 201);
  return body;
}

test('health check responde ok com cabeçalhos de segurança', async () => {
  const { status, headers, body } = await request('GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok' });
  assert.match(headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(headers.get('x-powered-by'), null);
});

test('cria grupo removendo nomes repetidos sem diferenciar maiúsculas', async () => {
  const group = await createGroup(['Ana', 'ana ', 'Bia']);
  assert.deepEqual(
    group.members.map(m => m.name),
    ['Ana', 'Bia'],
  );
  const list = await request('GET', '/api/groups');
  assert.ok(list.body.some(g => g.id === group.id && g.members.length === 2));
});

test('valida dados do grupo', async () => {
  assert.equal((await request('POST', '/api/groups', { name: 'X', members: ['Ana', 'Bia'] })).status, 400);
  assert.equal((await request('POST', '/api/groups', { name: 'Casa', members: ['Ana'] })).status, 400);
});

test('JSON malformado e grupo inexistente retornam erros em JSON', async () => {
  const malformed = await request('POST', '/api/groups', '{oops');
  assert.equal(malformed.status, 400);
  assert.match(malformed.body.error, /JSON/);
  for (const id of ['999', 'abc', '1.5', '-1']) {
    assert.equal((await request('GET', `/api/groups/${id}/summary`)).status, 404);
  }
  assert.equal((await request('GET', '/api/nada')).status, 404);
});

test('fluxo completo: despesa, saldos, sugestão e acerto', async () => {
  const group = await createGroup();
  const [ana, bia, caio] = group.members;

  const expense = await request('POST', `/api/groups/${group.id}/expenses`, { description: 'Jantar', amount: '100,00', paidBy: ana.id });
  assert.equal(expense.status, 201);
  assert.equal(expense.body.amountCents, 10000);

  let summary = (await request('GET', `/api/groups/${group.id}/summary`)).body;
  const balance = id => summary.balances.find(b => b.id === id);
  assert.deepEqual([balance(ana.id).balanceCents, balance(bia.id).balanceCents, balance(caio.id).balanceCents], [6666, -3333, -3333]);
  assert.equal(balance(ana.id).paidCents, 10000);
  assert.equal(
    summary.balances.reduce((sum, b) => sum + b.balanceCents, 0),
    0,
  );
  assert.equal(summary.transfers.length, 2);

  const transfer = summary.transfers[0];
  const tooMuch = await request('POST', `/api/groups/${group.id}/settlements`, {
    fromMember: transfer.fromId,
    toMember: transfer.toId,
    amountCents: transfer.amountCents + 1,
  });
  assert.equal(tooMuch.status, 400);
  const settled = await request('POST', `/api/groups/${group.id}/settlements`, {
    fromMember: transfer.fromId,
    toMember: transfer.toId,
    amountCents: transfer.amountCents,
  });
  assert.equal(settled.status, 201);

  summary = (await request('GET', `/api/groups/${group.id}/summary`)).body;
  assert.equal(summary.transfers.length, 1);
  assert.equal(summary.settlements.length, 1);
});

test('valida despesas', async () => {
  const group = await createGroup();
  const paidBy = group.members[0].id;
  const post = body => request('POST', `/api/groups/${group.id}/expenses`, { description: 'Mercado', paidBy, ...body });
  assert.equal((await post({ amount: 1.005 })).status, 400);
  assert.equal((await post({ amount: 0 })).status, 400);
  assert.equal((await post({ amount: 1000000.01 })).status, 400);
  assert.equal((await post({ amount: 10, paidBy: 999999 })).status, 400);
  assert.equal((await post({ amount: 10, description: 'x' })).status, 400);
});

test('pessoa nova participa só das despesas futuras e nomes não se repetem', async () => {
  const group = await createGroup(['Ana', 'Bia']);
  await request('POST', `/api/groups/${group.id}/expenses`, { description: 'Uber', amount: 20, paidBy: group.members[0].id });
  const added = await request('POST', `/api/groups/${group.id}/members`, { name: 'Caio' });
  assert.equal(added.status, 201);
  assert.equal((await request('POST', `/api/groups/${group.id}/members`, { name: 'CAIO' })).status, 409);
  const summary = (await request('GET', `/api/groups/${group.id}/summary`)).body;
  assert.equal(summary.balances.find(b => b.id === added.body.id).balanceCents, 0);
});
