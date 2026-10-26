'use strict';

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

module.exports = { suggestTransfers };
