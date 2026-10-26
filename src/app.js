'use strict';

const express = require('express');
const path = require('node:path');
const { createStore } = require('./store');
const { MAX_AMOUNT_CENTS, parseAmountToCents } = require('./domain/money');
const { suggestTransfers } = require('./domain/settle');

const MAX_MEMBERS = 20;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cleanText = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const nameKey = name => name.toLocaleLowerCase('pt-BR');

function parseId(value) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function uniqueNames(values) {
  const seen = new Map();
  for (const name of values.map(cleanText).filter(Boolean)) if (!seen.has(nameKey(name))) seen.set(nameKey(name), name);
  return [...seen.values()];
}

const securityHeaders = (_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
};

function createApp(db) {
  const store = createStore(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();

  // Resolve o grupo de :id uma única vez para todas as rotas aninhadas.
  api.param('id', (req, _res, next, raw) => {
    const groupId = parseId(raw);
    const group = groupId && store.getGroup(groupId);
    if (!group) return next(new HttpError(404, 'Grupo não encontrado.'));
    req.group = group;
    next();
  });

  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });

  api.get('/groups', (_req, res) => res.json(store.listGroups()));

  api.post('/groups', (req, res) => {
    const name = cleanText(req.body?.name);
    const members = Array.isArray(req.body?.members) ? uniqueNames(req.body.members) : [];
    if (name.length < 2 || name.length > 60) throw new HttpError(400, 'O nome do grupo deve ter entre 2 e 60 caracteres.');
    if (members.length < 2 || members.length > MAX_MEMBERS || members.some(n => n.length < 2 || n.length > 50)) {
      throw new HttpError(400, `Informe de 2 a ${MAX_MEMBERS} pessoas diferentes, com nomes de 2 a 50 caracteres.`);
    }
    res.status(201).json(store.createGroup(name, members));
  });

  api.post('/groups/:id/members', (req, res) => {
    const name = cleanText(req.body?.name);
    if (name.length < 2 || name.length > 50) throw new HttpError(400, 'O nome deve ter entre 2 e 50 caracteres.');
    const members = store.groupMembers(req.group.id);
    if (members.length >= MAX_MEMBERS) throw new HttpError(400, `Este grupo já chegou ao limite de ${MAX_MEMBERS} pessoas.`);
    if (members.some(m => nameKey(m.name) === nameKey(name))) throw new HttpError(409, 'Já existe alguém com esse nome no grupo.');
    res.status(201).json(store.addMember(req.group.id, name));
  });

  api.get('/groups/:id/summary', (req, res) => {
    const groupId = req.group.id;
    const balances = store.balances(groupId);
    res.json({
      group: req.group,
      members: balances.map(({ id, name }) => ({ id, name })),
      expenses: store.expenses(groupId),
      settlements: store.settlements(groupId),
      balances,
      transfers: suggestTransfers(balances),
    });
  });

  api.post('/groups/:id/expenses', (req, res) => {
    const groupId = req.group.id;
    const members = store.groupMembers(groupId);
    const description = cleanText(req.body?.description);
    const paidBy = parseId(req.body?.paidBy);
    const amountCents = parseAmountToCents(req.body?.amount);
    if (description.length < 2 || description.length > 100) throw new HttpError(400, 'A descrição deve ter entre 2 e 100 caracteres.');
    if (!members.some(m => m.id === paidBy)) throw new HttpError(400, 'Selecione quem pagou a despesa.');
    if (amountCents === null || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
      throw new HttpError(400, 'Informe um valor entre R$ 0,01 e R$ 1.000.000,00, com até duas casas decimais.');
    }
    const id = store.addExpense({ groupId, paidBy, description, amountCents, memberIds: members.map(m => m.id) });
    res.status(201).json({ id, amountCents });
  });

  api.post('/groups/:id/settlements', (req, res) => {
    const groupId = req.group.id;
    const from = parseId(req.body?.fromMember),
      to = parseId(req.body?.toMember),
      amountCents = req.body?.amountCents;
    const balances = store.balances(groupId);
    const debtor = balances.find(m => m.id === from),
      creditor = balances.find(m => m.id === to);
    if (!debtor || !creditor || from === to || debtor.balanceCents >= 0 || creditor.balanceCents <= 0) {
      throw new HttpError(400, 'Este acerto não corresponde a uma dívida atual.');
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > Math.min(-debtor.balanceCents, creditor.balanceCents)) {
      throw new HttpError(400, 'O valor do acerto excede o saldo pendente.');
    }
    res.status(201).json({ id: store.addSettlement(groupId, from, to, amountCents) });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Rota da API não encontrada.')));
  app.use('/api', api);

  // Erros sempre saem como JSON; detalhes internos ficam apenas no log.
  app.use((err, _req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err instanceof HttpError ? err.message : 'Não foi possível concluir a ação.';
    if (err.type === 'entity.parse.failed') message = 'O corpo da requisição não é um JSON válido.';
    if (err.type === 'entity.too.large') message = 'A requisição é grande demais.';
    if (status >= 500) {
      status = 500;
      console.error(err);
    }
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp, HttpError };
