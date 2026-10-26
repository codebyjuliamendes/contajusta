const express = require('express');
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(process.env.DATABASE_PATH || path.join(dataDir, 'contajusta.sqlite'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, paid_by INTEGER NOT NULL REFERENCES members(id), description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS expense_splits (expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE, member_id INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), PRIMARY KEY(expense_id, member_id));
  CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE, from_member INTEGER NOT NULL REFERENCES members(id), to_member INTEGER NOT NULL REFERENCES members(id), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const bad = (res, status, message) => res.status(status).json({ error: message });
const cleanText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

function groupExists(id) { return db.prepare('SELECT id, name FROM groups WHERE id = ?').get(id); }
function groupMembers(id) { return db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id').all(id); }

function getBalances(groupId) {
  const members = groupMembers(groupId);
  const balance = new Map(members.map(member => [member.id, 0]));
  const expenses = db.prepare('SELECT paid_by, amount_cents FROM expenses WHERE group_id = ?').all(groupId);
  for (const row of expenses) balance.set(row.paid_by, balance.get(row.paid_by) + row.amount_cents);
  const shares = db.prepare(`SELECT s.member_id, s.amount_cents AS share
    FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?`).all(groupId);
  for (const row of shares) balance.set(row.member_id, balance.get(row.member_id) - row.share);
  const settlements = db.prepare('SELECT from_member, to_member, amount_cents FROM settlements WHERE group_id = ?').all(groupId);
  for (const row of settlements) {
    balance.set(row.from_member, balance.get(row.from_member) + row.amount_cents);
    balance.set(row.to_member, balance.get(row.to_member) - row.amount_cents);
  }
  return members.map(member => ({ ...member, balanceCents: balance.get(member.id) }));
}

function suggestedTransfers(balances) {
  const debtors = balances.filter(m => m.balanceCents < 0).map(m => ({ id: m.id, name: m.name, cents: -m.balanceCents }));
  const creditors = balances.filter(m => m.balanceCents > 0).map(m => ({ id: m.id, name: m.name, cents: m.balanceCents }));
  const transfers = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].cents, creditors[c].cents);
    transfers.push({ from: debtors[d].name, fromId: debtors[d].id, to: creditors[c].name, toId: creditors[c].id, amountCents: amount });
    debtors[d].cents -= amount; creditors[c].cents -= amount;
    if (!debtors[d].cents) d++;
    if (!creditors[c].cents) c++;
  }
  return transfers;
}

app.get('/api/groups', (_req, res) => {
  const groups = db.prepare('SELECT id, name, created_at AS createdAt FROM groups ORDER BY id DESC').all();
  res.json(groups.map(group => ({ ...group, members: groupMembers(group.id) })));
});

app.post('/api/groups', (req, res) => {
  const name = cleanText(req.body?.name);
  const names = Array.isArray(req.body?.members) ? [...new Set(req.body.members.map(cleanText).filter(Boolean))] : [];
  if (name.length < 2 || name.length > 60) return bad(res, 400, 'O nome do grupo deve ter entre 2 e 60 caracteres.');
  if (names.length < 2 || names.length > 20 || names.some(n => n.length > 50)) return bad(res, 400, 'Informe de 2 a 20 pessoas, com nomes de até 50 caracteres.');
  const create = db.transaction(() => {
    const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
    const addMember = db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)');
    for (const member of names) addMember.run(result.lastInsertRowid, member);
    return { id: result.lastInsertRowid, name, members: groupMembers(result.lastInsertRowid) };
  });
  res.status(201).json(create());
});

app.post('/api/groups/:id/members', (req, res) => {
  const groupId = Number(req.params.id), name = cleanText(req.body?.name);
  const group = groupExists(groupId);
  if (!group) return bad(res, 404, 'Grupo não encontrado.');
  if (name.length < 2 || name.length > 50) return bad(res, 400, 'O nome deve ter entre 2 e 50 caracteres.');
  if (groupMembers(groupId).length >= 20) return bad(res, 400, 'Este grupo já chegou ao limite de 20 pessoas.');
  if (groupMembers(groupId).some(m => m.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) return bad(res, 409, 'Já existe alguém com esse nome no grupo.');
  const result = db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)').run(groupId, name);
  res.status(201).json({ id: result.lastInsertRowid, name });
});

app.get('/api/groups/:id/summary', (req, res) => {
  const groupId = Number(req.params.id), group = groupExists(groupId);
  if (!group) return bad(res, 404, 'Grupo não encontrado.');
  const members = groupMembers(groupId);
  const expenses = db.prepare(`SELECT e.id, e.description, e.amount_cents AS amountCents, e.created_at AS createdAt, m.id AS paidById, m.name AS paidBy
    FROM expenses e JOIN members m ON m.id = e.paid_by WHERE e.group_id = ? ORDER BY e.id DESC`).all(groupId);
  const settlements = db.prepare(`SELECT s.id, s.amount_cents AS amountCents, s.created_at AS createdAt, f.name AS fromName, t.name AS toName
    FROM settlements s JOIN members f ON f.id = s.from_member JOIN members t ON t.id = s.to_member WHERE s.group_id = ? ORDER BY s.id DESC`).all(groupId);
  const balances = getBalances(groupId);
  res.json({ group, members, expenses, settlements, balances, transfers: suggestedTransfers(balances) });
});

app.post('/api/groups/:id/expenses', (req, res) => {
  const groupId = Number(req.params.id), group = groupExists(groupId);
  if (!group) return bad(res, 404, 'Grupo não encontrado.');
  const description = cleanText(req.body?.description), paidBy = Number(req.body?.paidBy);
  const amount = Number(req.body?.amount);
  if (description.length < 2 || description.length > 100) return bad(res, 400, 'A descrição deve ter entre 2 e 100 caracteres.');
  if (!Number.isSafeInteger(paidBy) || !groupMembers(groupId).some(m => m.id === paidBy)) return bad(res, 400, 'Selecione quem pagou a despesa.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return bad(res, 400, 'Informe um valor maior que R$ 0,00 e até R$ 1.000.000,00.');
  const amountCents = Math.round(amount * 100);
  if (amountCents < 1) return bad(res, 400, 'O valor mínimo é R$ 0,01.');
  const members = groupMembers(groupId);
  let shares;
  if (req.body?.shares !== undefined) {
    if (!Array.isArray(req.body.shares) || req.body.shares.length !== members.length) return bad(res, 400, 'Informe uma parcela para cada pessoa do grupo.');
    const byId = new Map(req.body.shares.map(share => [Number(share?.memberId), share?.amountCents]));
    if (byId.size !== members.length || members.some(member => !byId.has(member.id))) return bad(res, 400, 'As parcelas devem incluir cada pessoa uma única vez.');
    shares = members.map(member => ({ memberId: member.id, amountCents: byId.get(member.id) }));
    if (shares.some(share => !Number.isSafeInteger(share.amountCents) || share.amountCents < 0)) return bad(res, 400, 'Cada parcela deve ser um valor inteiro de centavos igual ou maior que zero.');
    if (shares.reduce((sum, share) => sum + share.amountCents, 0) !== amountCents) return bad(res, 400, 'A soma das parcelas precisa ser igual ao total da despesa.');
  } else {
    const quotient = Math.floor(amountCents / members.length), remainder = amountCents % members.length;
    shares = members.map((member, index) => ({ memberId: member.id, amountCents: quotient + (index < remainder ? 1 : 0) }));
  }
  const save = db.transaction(() => {
    const result = db.prepare('INSERT INTO expenses (group_id, paid_by, description, amount_cents) VALUES (?, ?, ?, ?)').run(groupId, paidBy, description, amountCents);
    const insertShare = db.prepare('INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES (?, ?, ?)');
    shares.forEach(share => insertShare.run(result.lastInsertRowid, share.memberId, share.amountCents));
    return result.lastInsertRowid;
  });
  res.status(201).json({ id: save(), amountCents });
});

app.post('/api/groups/:id/settlements', (req, res) => {
  const groupId = Number(req.params.id), group = groupExists(groupId);
  if (!group) return bad(res, 404, 'Grupo não encontrado.');
  const from = Number(req.body?.fromMember), to = Number(req.body?.toMember), amountCents = Number(req.body?.amountCents);
  const balances = getBalances(groupId);
  const debtor = balances.find(m => m.id === from), creditor = balances.find(m => m.id === to);
  if (!debtor || !creditor || from === to || debtor.balanceCents >= 0 || creditor.balanceCents <= 0) return bad(res, 400, 'Este acerto não corresponde a uma dívida atual.');
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > Math.min(-debtor.balanceCents, creditor.balanceCents)) return bad(res, 400, 'O valor do acerto excede o saldo pendente.');
  const result = db.prepare('INSERT INTO settlements (group_id, from_member, to_member, amount_cents) VALUES (?, ?, ?, ?)').run(groupId, from, to, amountCents);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.use('/api', (_req, res) => bad(res, 404, 'Rota da API não encontrada.'));
app.listen(port, () => console.log(`ContaJusta disponível em http://localhost:${port}`));
