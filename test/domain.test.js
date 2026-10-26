'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmountToCents } = require('../src/domain/money');
const { splitEvenly, buildShares } = require('../src/domain/split');
const { ValidationError } = require('../src/domain/errors');
const { suggestTransfers } = require('../src/domain/settle');

test('parseAmountToCents converte formatos comuns sem erro de ponto flutuante', () => {
  assert.equal(parseAmountToCents(120.5), 12050);
  assert.equal(parseAmountToCents('120,50'), 12050);
  assert.equal(parseAmountToCents('1.234,56'), 123456);
  assert.equal(parseAmountToCents('R$ 10'), 1000);
  assert.equal(parseAmountToCents('1.000.000'), 100000000);
  assert.equal(parseAmountToCents(1.15), 115);
  assert.equal(parseAmountToCents(0.29), 29);
});

test('parseAmountToCents rejeita entradas inválidas', () => {
  for (const value of [1.005, '1,005', '-5', 'abc', '', NaN, Infinity, null, undefined, {}, '1e3']) {
    assert.equal(parseAmountToCents(value), null, `deveria rejeitar ${String(value)}`);
  }
});

test('splitEvenly distribui os centavos restantes e preserva o total', () => {
  const shares = splitEvenly(100, [1, 2, 3]);
  assert.deepEqual(
    shares.map(s => s.amountCents),
    [34, 33, 33],
  );
  assert.equal(
    shares.reduce((sum, s) => sum + s.amountCents, 0),
    100,
  );
  assert.throws(() => splitEvenly(100, []), ValidationError);
});

test('suggestTransfers zera todos os saldos', () => {
  const balances = [
    { id: 1, name: 'Ana', balanceCents: 9000 },
    { id: 2, name: 'Bia', balanceCents: -3000 },
    { id: 3, name: 'Caio', balanceCents: -6000 },
    { id: 4, name: 'Duda', balanceCents: 0 },
  ];
  const transfers = suggestTransfers(balances);
  assert.equal(transfers.length, 2);
  const net = new Map(balances.map(b => [b.id, b.balanceCents]));
  for (const t of transfers) {
    net.set(t.fromId, net.get(t.fromId) + t.amountCents);
    net.set(t.toId, net.get(t.toId) - t.amountCents);
  }
  assert.ok([...net.values()].every(v => v === 0));
});

test('suggestTransfers casa maiores valores primeiro', () => {
  const transfers = suggestTransfers([
    { id: 1, name: 'A', balanceCents: 500 },
    { id: 2, name: 'B', balanceCents: 1000 },
    { id: 3, name: 'C', balanceCents: -1000 },
    { id: 4, name: 'D', balanceCents: -500 },
  ]);
  assert.deepEqual(
    transfers.map(t => [t.fromId, t.toId, t.amountCents]),
    [
      [3, 2, 1000],
      [4, 1, 500],
    ],
  );
});

test('buildShares: divisão igual respeita a ordem do grupo e ignora seleção fora de ordem', () => {
  const shares = buildShares(100, { mode: 'equal', memberIds: [3, 1] }, [1, 2, 3]);
  assert.deepEqual(shares, [
    { memberId: 1, amountCents: 50 },
    { memberId: 3, amountCents: 50 },
  ]);
});

test('buildShares: valores exatos precisam fechar o total', () => {
  const exact = shares => ({ mode: 'exact', shares });
  assert.deepEqual(
    buildShares(
      100,
      exact([
        { memberId: 1, amountCents: 70 },
        { memberId: 2, amountCents: 30 },
        { memberId: 3, amountCents: 0 },
      ]),
      [1, 2, 3],
    ),
    [
      { memberId: 1, amountCents: 70 },
      { memberId: 2, amountCents: 30 },
    ],
  );
  assert.throws(() => buildShares(100, exact([{ memberId: 1, amountCents: 99 }]), [1, 2]), /soma/);
  assert.throws(() => buildShares(100, exact([{ memberId: 9, amountCents: 100 }]), [1, 2]), /não está no grupo/);
  assert.throws(
    () =>
      buildShares(
        100,
        exact([
          { memberId: 1, amountCents: 50 },
          { memberId: 1, amountCents: 50 },
        ]),
        [1, 2],
      ),
    /só uma vez/,
  );
  assert.throws(() => buildShares(100, { mode: 'equal', memberIds: [] }, [1, 2]), ValidationError);
  assert.throws(() => buildShares(100, { mode: 'percent' }, [1, 2]), /inválido/);
});
