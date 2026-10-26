'use strict';

const express = require('express');
const { HttpError, notFound } = require('../http/errors');
const { MAX_MEMBERS, nameKey, parseId, parseMemberName, parseGroupInput } = require('../http/validation');
const { suggestTransfers } = require('../domain/settle');
const { expenseRoutes } = require('./expenses');
const { settlementRoutes } = require('./settlements');

function groupRoutes(store) {
  const router = express.Router();

  router.get('/', (_req, res) => res.json(store.listGroups()));

  router.post('/', (req, res) => {
    const { name, members } = parseGroupInput(req.body);
    res.status(201).json(store.createGroup(name, members));
  });

  // Carrega o grupo uma vez; rotas aninhadas leem req.group.
  const loadGroup = (req, _res, next) => {
    const id = parseId(req.params.groupId);
    req.group = id && store.getGroup(id);
    next(req.group ? undefined : notFound('Grupo não encontrado.'));
  };

  const scoped = express.Router({ mergeParams: true });

  scoped.get('/summary', (req, res) => {
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

  scoped.post('/members', (req, res) => {
    const name = parseMemberName(req.body?.name);
    const members = store.groupMembers(req.group.id);
    if (members.length >= MAX_MEMBERS) throw new HttpError(400, `Este grupo já chegou ao limite de ${MAX_MEMBERS} pessoas.`);
    if (members.some(m => nameKey(m.name) === nameKey(name))) throw new HttpError(409, 'Já existe alguém com esse nome no grupo.');
    res.status(201).json(store.addMember(req.group.id, name));
  });

  scoped.use('/expenses', expenseRoutes(store));
  scoped.use('/settlements', settlementRoutes(store));

  router.use('/:groupId', loadGroup, scoped);
  return router;
}

module.exports = { groupRoutes };
