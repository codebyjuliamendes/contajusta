'use strict';

const crypto = require('node:crypto');

// Map.groupBy só existe a partir do Node 21.
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// 128 bits em base64url: inviável de adivinhar ou enumerar.
const newPublicId = () => crypto.randomBytes(16).toString('base64url');

// rowId é interno (FKs); a API só expõe o public_id como `id`.
const publicGroup = ({ rowId: _rowId, ...group }) => group;

/** Acesso a dados. Toda SQL fica aqui; registros com deleted_at são ignorados nas leituras. */
function createStore(db) {
  const sql = {
    groupsByKeys: db.prepare(`SELECT id AS rowId, public_id AS id, name, created_at AS createdAt
      FROM groups WHERE public_id IN (SELECT value FROM json_each(?)) ORDER BY id DESC`),
    membersOfGroups: db.prepare(`SELECT id, group_id AS groupId, name
      FROM members WHERE group_id IN (SELECT value FROM json_each(?)) ORDER BY id`),
    getGroupByKey: db.prepare('SELECT id AS rowId, public_id AS id, name, created_at AS createdAt FROM groups WHERE public_id = ?'),
    groupMembers: db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id'),
    insertGroup: db.prepare('INSERT INTO groups (name, public_id) VALUES (?, ?)'),
    insertMember: db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)'),

    getExpense:
      db.prepare(`SELECT id, group_id AS groupId, description, amount_cents AS amountCents, paid_by AS paidBy, split_mode AS splitMode
      FROM expenses WHERE id = ? AND group_id = ? AND deleted_at IS NULL`),
    insertExpense: db.prepare(
      'INSERT INTO expenses (group_id, paid_by, description, amount_cents, split_mode) VALUES (@groupId, @paidBy, @description, @amountCents, @splitMode)',
    ),
    updateExpense: db.prepare(`UPDATE expenses SET paid_by = @paidBy, description = @description, amount_cents = @amountCents,
      split_mode = @splitMode, updated_at = CURRENT_TIMESTAMP WHERE id = @id`),
    softDeleteExpense: db.prepare('UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'),
    expenses: db.prepare(`SELECT e.id, e.description, e.amount_cents AS amountCents, e.split_mode AS splitMode,
        e.created_at AS createdAt, e.updated_at AS updatedAt, m.id AS paidById, m.name AS paidBy
      FROM expenses e JOIN members m ON m.id = e.paid_by
      WHERE e.group_id = ? AND e.deleted_at IS NULL ORDER BY e.id DESC`),

    insertSplit: db.prepare('INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES (?, ?, ?)'),
    deleteSplits: db.prepare('DELETE FROM expense_splits WHERE expense_id = ?'),
    expenseSplits: db.prepare(
      'SELECT member_id AS memberId, amount_cents AS amountCents FROM expense_splits WHERE expense_id = ? ORDER BY member_id',
    ),
    groupSplits: db.prepare(`SELECT s.expense_id AS expenseId, s.member_id AS memberId, s.amount_cents AS amountCents
      FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
      WHERE e.group_id = ? AND e.deleted_at IS NULL ORDER BY s.member_id`),

    insertEvent: db.prepare('INSERT INTO expense_events (expense_id, action, snapshot) VALUES (?, ?, ?)'),
    expenseEvents: db.prepare(`SELECT ev.id, ev.action, ev.snapshot, ev.created_at AS createdAt
      FROM expense_events ev JOIN expenses e ON e.id = ev.expense_id WHERE e.group_id = ? AND ev.expense_id = ? ORDER BY ev.id`),

    insertSettlement: db.prepare('INSERT INTO settlements (group_id, from_member, to_member, amount_cents) VALUES (?, ?, ?, ?)'),
    softDeleteSettlement: db.prepare(
      'UPDATE settlements SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ? AND deleted_at IS NULL',
    ),
    settlements: db.prepare(`SELECT s.id, s.amount_cents AS amountCents, s.created_at AS createdAt,
        f.id AS fromId, f.name AS fromName, t.id AS toId, t.name AS toName
      FROM settlements s JOIN members f ON f.id = s.from_member JOIN members t ON t.id = s.to_member
      WHERE s.group_id = ? AND s.deleted_at IS NULL ORDER BY s.id DESC`),

    // Saldo = pago - consumido + enviado em acertos - recebido em acertos.
    balances: db.prepare(`SELECT m.id, m.name,
        COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE paid_by = m.id AND deleted_at IS NULL), 0) AS paidCents,
        COALESCE((SELECT SUM(s.amount_cents) FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
                  WHERE s.member_id = m.id AND e.deleted_at IS NULL), 0) AS shareCents,
        COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE from_member = m.id AND deleted_at IS NULL), 0) AS sentCents,
        COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE to_member = m.id AND deleted_at IS NULL), 0) AS receivedCents
      FROM members m WHERE m.group_id = ? ORDER BY m.id`),
  };

  // Estado completo da despesa gravado em cada evento de auditoria.
  const snapshot = expense =>
    JSON.stringify({
      description: expense.description,
      amountCents: expense.amountCents,
      paidBy: expense.paidBy,
      splitMode: expense.splitMode,
      shares: expense.shares,
    });

  const writeSplits = (expenseId, shares) => {
    sql.deleteSplits.run(expenseId);
    for (const share of shares) sql.insertSplit.run(expenseId, share.memberId, share.amountCents);
  };

  const createGroup = db.transaction((name, memberNames) => {
    const publicId = newPublicId();
    const rowId = Number(sql.insertGroup.run(name, publicId).lastInsertRowid);
    for (const memberName of memberNames) sql.insertMember.run(rowId, memberName);
    return { ...publicGroup(sql.getGroupByKey.get(publicId)), members: sql.groupMembers.all(rowId) };
  });

  const addExpense = db.transaction(expense => {
    const id = Number(sql.insertExpense.run(expense).lastInsertRowid);
    writeSplits(id, expense.shares);
    sql.insertEvent.run(id, 'created', snapshot(expense));
    return id;
  });

  const updateExpense = db.transaction((id, expense) => {
    sql.updateExpense.run({ ...expense, id });
    writeSplits(id, expense.shares);
    sql.insertEvent.run(id, 'updated', snapshot(expense));
  });

  const deleteExpense = db.transaction((groupId, id) => {
    const current = sql.getExpense.get(id, groupId);
    if (!current) return false;
    sql.softDeleteExpense.run(id);
    sql.insertEvent.run(id, 'deleted', snapshot({ ...current, shares: sql.expenseSplits.all(id) }));
    return true;
  });

  return {
    /** Só os grupos cujas chaves o cliente já conhece. */
    groupsByKeys(keys) {
      const groups = sql.groupsByKeys.all(JSON.stringify(keys));
      const membersByGroup = groupBy(sql.membersOfGroups.all(JSON.stringify(groups.map(g => g.rowId))), 'groupId');
      return groups.map(group => ({
        ...publicGroup(group),
        members: (membersByGroup.get(group.rowId) || []).map(({ id, name }) => ({ id, name })),
      }));
    },
    getGroupByKey: key => sql.getGroupByKey.get(key),
    publicGroup,
    groupMembers: id => sql.groupMembers.all(id),
    createGroup,
    addMember: (groupId, name) => ({ id: Number(sql.insertMember.run(groupId, name).lastInsertRowid), name }),

    getExpense: (groupId, id) => {
      const expense = sql.getExpense.get(id, groupId);
      return expense && { ...expense, shares: sql.expenseSplits.all(id) };
    },
    addExpense,
    updateExpense,
    deleteExpense,
    expenses(groupId) {
      const sharesByExpense = groupBy(sql.groupSplits.all(groupId), 'expenseId');
      return sql.expenses.all(groupId).map(expense => ({
        ...expense,
        shares: (sharesByExpense.get(expense.id) || []).map(({ memberId, amountCents }) => ({ memberId, amountCents })),
      }));
    },
    expenseHistory: (groupId, id) => sql.expenseEvents.all(groupId, id).map(event => ({ ...event, snapshot: JSON.parse(event.snapshot) })),

    addSettlement: (groupId, from, to, amountCents) => Number(sql.insertSettlement.run(groupId, from, to, amountCents).lastInsertRowid),
    deleteSettlement: (groupId, id) => sql.softDeleteSettlement.run(id, groupId).changes > 0,
    settlements: groupId => sql.settlements.all(groupId),

    balances: groupId =>
      sql.balances.all(groupId).map(({ sentCents, receivedCents, ...row }) => ({
        ...row,
        balanceCents: row.paidCents - row.shareCents + sentCents - receivedCents,
      })),
  };
}

module.exports = { createStore };
