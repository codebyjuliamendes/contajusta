'use strict';

const express = require('express');
const { notFound } = require('../http/errors');
const { parseId } = require('../http/validation');
const { assertValidSettlement } = require('../domain/settle');

function settlementRoutes(store) {
  const router = express.Router({ mergeParams: true });

  router.post('/', (req, res) => {
    const from = parseId(req.body?.fromMember);
    const to = parseId(req.body?.toMember);
    const amountCents = req.body?.amountCents;
    assertValidSettlement(store.balances(req.group.rowId), from, to, amountCents);
    res.status(201).json({ id: store.addSettlement(req.group.rowId, from, to, amountCents) });
  });

  // Desfaz um acerto registrado por engano (soft delete).
  router.delete('/:settlementId', (req, res, next) => {
    if (!store.deleteSettlement(req.group.rowId, parseId(req.params.settlementId))) return next(notFound('Acerto não encontrado.'));
    res.status(204).end();
  });

  return router;
}

module.exports = { settlementRoutes };
