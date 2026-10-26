'use strict';

const { splitEvenly } = require('./domain/split');

/** Camada de acesso a dados: toda SQL da aplicação fica aqui. */
function createStore(db) {
  const sql = {
    listGroups: db.prepare('SELECT id, name, created_at AS createdAt FROM groups ORDER BY id DESC'),
    listAllMembers: db.prepare('SELECT id, group_id AS groupId, name FROM members ORDER BY id'),
    getGroup: db.prepare('SELECT id, name, created_at AS createdAt FROM groups WHERE id = ?'),
    groupMembers: db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id'),
    insertGroup: db.prepare('INSERT INTO groups (name) VALUES (?)'),
    insertMember: db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)'),
    insertExpense: db.prepare('INSERT INTO expenses (group_id, paid_by, description, amount_cents) VALUES (?, ?, ?, ?)'),
    insertSplit: db.prepare('INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES (?, ?, ?)'),
    insertSettlement: db.prepare('INSERT INTO settlements (group_id, from_member, to_member, amount_cents) VALUES (?, ?, ?, ?)'),
    expenses:
      db.prepare(`SELECT e.id, e.description, e.amount_cents AS amountCents, e.created_at AS createdAt, m.id AS paidById, m.name AS paidBy
      FROM expenses e JOIN members m ON m.id = e.paid_by WHERE e.group_id = ? ORDER BY e.id DESC`),
    settlements:
      db.prepare(`SELECT s.id, s.amount_cents AS amountCents, s.created_at AS createdAt, f.id AS fromId, f.name AS fromName, t.id AS toId, t.name AS toName
      FROM settlements s JOIN members f ON f.id = s.from_member JOIN members t ON t.id = s.to_member WHERE s.group_id = ? ORDER BY s.id DESC`),
    // Agrega no banco o que cada pessoa pagou, consumiu e acertou.
    balances: db.prepare(`SELECT m.id, m.name,
        COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE paid_by = m.id), 0) AS paidCents,
        COALESCE((SELECT SUM(amount_cents) FROM expense_splits WHERE member_id = m.id), 0) AS shareCents,
        COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE from_member = m.id), 0) AS sentCents,
        COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE to_member = m.id), 0) AS receivedCents
      FROM members m WHERE m.group_id = ? ORDER BY m.id`),
  };

  const createGroupTx = db.transaction((name, memberNames) => {
    const groupId = Number(sql.insertGroup.run(name).lastInsertRowid);
    for (const memberName of memberNames) sql.insertMember.run(groupId, memberName);
    return { ...sql.getGroup.get(groupId), members: sql.groupMembers.all(groupId) };
  });

  const addExpenseTx = db.transaction(({ groupId, paidBy, description, amountCents, memberIds }) => {
    const expenseId = Number(sql.insertExpense.run(groupId, paidBy, description, amountCents).lastInsertRowid);
    for (const share of splitEvenly(amountCents, memberIds)) sql.insertSplit.run(expenseId, share.memberId, share.amountCents);
    return expenseId;
  });

  return {
    listGroups() {
      const membersByGroup = new Map();
      for (const { groupId, ...member } of sql.listAllMembers.all()) {
        if (!membersByGroup.has(groupId)) membersByGroup.set(groupId, []);
        membersByGroup.get(groupId).push(member);
      }
      return sql.listGroups.all().map(group => ({ ...group, members: membersByGroup.get(group.id) || [] }));
    },
    getGroup: id => sql.getGroup.get(id),
    groupMembers: id => sql.groupMembers.all(id),
    createGroup: (name, memberNames) => createGroupTx(name, memberNames),
    addMember: (groupId, name) => ({ id: Number(sql.insertMember.run(groupId, name).lastInsertRowid), name }),
    addExpense: input => addExpenseTx(input),
    addSettlement: (groupId, from, to, amountCents) => Number(sql.insertSettlement.run(groupId, from, to, amountCents).lastInsertRowid),
    expenses: groupId => sql.expenses.all(groupId),
    settlements: groupId => sql.settlements.all(groupId),
    balances: groupId =>
      sql.balances.all(groupId).map(({ sentCents, receivedCents, ...row }) => ({
        ...row,
        balanceCents: row.paidCents - row.shareCents + sentCents - receivedCents,
      })),
  };
}

module.exports = { createStore };
