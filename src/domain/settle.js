'use strict';

const { ValidationError } = require('./errors');

/**
 * Sugere transferências que zeram os saldos líquidos do grupo.
 * Estratégia gulosa: sempre casa o maior devedor com o maior credor, o que
 * gera no máximo n - 1 transferências e costuma chegar ao mínimo na prática.
 */
function suggestTransfers(balances) {
  const byAmountDesc = (a, b) => b.cents - a.cents || a.id - b.id;
  const debtors = balances
    .filter(m => m.balanceCents < 0)
    .map(m => ({ id: m.id, name: m.name, cents: -m.balanceCents }))
    .sort(byAmountDesc);
  const creditors = balances
    .filter(m => m.balanceCents > 0)
    .map(m => ({ id: m.id, name: m.name, cents: m.balanceCents }))
    .sort(byAmountDesc);
  const transfers = [];

  while (debtors.length && creditors.length) {
    const debtor = debtors[0],
      creditor = creditors[0];
    const amountCents = Math.min(debtor.cents, creditor.cents);
    transfers.push({ from: debtor.name, fromId: debtor.id, to: creditor.name, toId: creditor.id, amountCents });
    debtor.cents -= amountCents;
    creditor.cents -= amountCents;
    if (!debtor.cents) debtors.shift();
    if (!creditor.cents) creditors.shift();
    debtors.sort(byAmountDesc);
    creditors.sort(byAmountDesc);
  }
  return transfers;
}

/** Acerto só é válido entre devedor e credor atuais, até o menor dos dois saldos. */
function assertValidSettlement(balances, from, to, amountCents) {
  const debtor = balances.find(m => m.id === from);
  const creditor = balances.find(m => m.id === to);
  if (!debtor || !creditor || from === to || debtor.balanceCents >= 0 || creditor.balanceCents <= 0) {
    throw new ValidationError('Este acerto não corresponde a uma dívida atual.');
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > Math.min(-debtor.balanceCents, creditor.balanceCents)) {
    throw new ValidationError('O valor do acerto excede o saldo pendente.');
  }
}

module.exports = { suggestTransfers, assertValidSettlement };
