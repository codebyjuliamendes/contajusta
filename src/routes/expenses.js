'use strict';

const express = require('express');
const { notFound } = require('../http/errors');
const { parseId, parseExpenseInput } = require('../http/validation');

function expenseRoutes(store) {
  const router = express.Router({ mergeParams: true });

  // Despesas excluídas (soft delete) respondem 404.
  const loadExpense = (req, _res, next) => {
    const id = parseId(req.params.expenseId);
    req.expense = id && store.getExpense(req.group.id, id);
    next(req.expense ? undefined : notFound('Despesa não encontrada.'));
  };

  router.post('/', (req, res) => {
    const expense = parseExpenseInput(req.body, store.groupMembers(req.group.id));
    const id = store.addExpense({ ...expense, groupId: req.group.id });
    res.status(201).json({ id, amountCents: expense.amountCents });
  });

  router.get('/:expenseId', loadExpense, (req, res) => res.json(req.expense));

  router.put('/:expenseId', loadExpense, (req, res) => {
    const expense = parseExpenseInput(req.body, store.groupMembers(req.group.id));
    store.updateExpense(req.expense.id, expense);
    res.json(store.getExpense(req.group.id, req.expense.id));
  });

  router.delete('/:expenseId', loadExpense, (req, res) => {
    store.deleteExpense(req.group.id, req.expense.id);
    res.status(204).end();
  });

  // Histórico continua acessível após a exclusão, por isso não usa loadExpense.
  router.get('/:expenseId/history', (req, res, next) => {
    const events = store.expenseHistory(req.group.id, parseId(req.params.expenseId));
    if (!events.length) return next(notFound('Despesa não encontrada.'));
    res.json(events);
  });

  return router;
}

module.exports = { expenseRoutes };
