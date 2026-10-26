'use strict';

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

// Cada migração roda uma única vez, em ordem, controlada por PRAGMA user_version.
// Nunca altere uma migração já publicada: adicione uma nova ao final da lista.
const migrations = [
  `CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, paid_by INTEGER NOT NULL REFERENCES members(id), description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS expense_splits (expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE, member_id INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), PRIMARY KEY(expense_id, member_id));
   CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, from_member INTEGER NOT NULL REFERENCES members(id), to_member INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
  `CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
   CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
   CREATE INDEX IF NOT EXISTS idx_expense_splits_member ON expense_splits(member_id);
   CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(group_id);`,
  // Soft delete + trilha de auditoria. Backfill gera o evento 'created' das despesas existentes.
  `ALTER TABLE expenses ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'equal' CHECK (split_mode IN ('equal', 'exact'));
   ALTER TABLE expenses ADD COLUMN updated_at TEXT;
   ALTER TABLE expenses ADD COLUMN deleted_at TEXT;
   ALTER TABLE settlements ADD COLUMN deleted_at TEXT;
   CREATE TABLE expense_events (
     id INTEGER PRIMARY KEY,
     expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
     action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
     snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   CREATE INDEX idx_expense_events_expense ON expense_events(expense_id);
   INSERT INTO expense_events (expense_id, action, snapshot, created_at)
   SELECT e.id, 'created',
     json_object('description', e.description, 'amountCents', e.amount_cents, 'paidBy', e.paid_by, 'splitMode', e.split_mode,
       'shares', json((SELECT json_group_array(json_object('memberId', s.member_id, 'amountCents', s.amount_cents))
                       FROM expense_splits s WHERE s.expense_id = e.id))),
     e.created_at
   FROM expenses e;`,
];

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let version = current; version < migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

module.exports = { openDatabase, migrate };
