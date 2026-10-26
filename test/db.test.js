'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrate } = require('../src/db');
const { createStore } = require('../src/store');

test('migra banco da v1 preservando dados e gerando histórico das despesas existentes', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Esquema original, sem user_version.
  db.exec(`
    CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE members (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, paid_by INTEGER NOT NULL REFERENCES members(id), description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE expense_splits (expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE, member_id INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), PRIMARY KEY(expense_id, member_id));
    CREATE TABLE settlements (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, from_member INTEGER NOT NULL REFERENCES members(id), to_member INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO groups (name) VALUES ('Antigo');
    INSERT INTO members (group_id, name) VALUES (1, 'Ana'), (1, 'Bia');
    INSERT INTO expenses (group_id, paid_by, description, amount_cents) VALUES (1, 1, 'Mercado', 1001);
    INSERT INTO expense_splits VALUES (1, 1, 501), (1, 2, 500);
  `);

  migrate(db);
  migrate(db); // idempotente

  const store = createStore(db);
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.equal(store.expenses(1)[0].splitMode, 'equal');
  assert.deepEqual(
    store.balances(1).map(b => b.balanceCents),
    [500, -500],
  );

  const [event] = store.expenseHistory(1, 1);
  assert.equal(event.action, 'created');
  assert.deepEqual(event.snapshot.shares, [
    { memberId: 1, amountCents: 501 },
    { memberId: 2, amountCents: 500 },
  ]);
});
