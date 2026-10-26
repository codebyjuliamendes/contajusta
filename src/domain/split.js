'use strict';

/**
 * Divide um valor em centavos igualmente entre os participantes.
 * Os centavos que sobram vão para os primeiros da lista, então a soma das
 * parcelas é sempre exatamente igual ao total.
 */
function splitEvenly(amountCents, memberIds) {
  if (!memberIds.length) throw new RangeError('É preciso ao menos um participante para dividir.');
  const quotient = Math.floor(amountCents / memberIds.length);
  const remainder = amountCents % memberIds.length;
  return memberIds.map((memberId, index) => ({ memberId, amountCents: quotient + (index < remainder ? 1 : 0) }));
}

module.exports = { splitEvenly };
