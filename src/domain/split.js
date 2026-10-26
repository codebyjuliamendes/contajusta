'use strict';

const { ValidationError } = require('./errors');

const SPLIT_MODES = Object.freeze({ EQUAL: 'equal', EXACT: 'exact' });

/**
 * Divide igualmente; o resto vai para os primeiros da lista.
 * Invariante: soma das parcelas === amountCents.
 */
function splitEvenly(amountCents, memberIds) {
  if (!memberIds.length) throw new ValidationError('Selecione ao menos uma pessoa para dividir a despesa.');
  const quotient = Math.floor(amountCents / memberIds.length);
  const remainder = amountCents % memberIds.length;
  return memberIds.map((memberId, index) => ({ memberId, amountCents: quotient + (index < remainder ? 1 : 0) }));
}

/**
 * Gera as parcelas a partir de uma regra de divisão já normalizada:
 *   { mode: 'equal', memberIds: number[] }
 *   { mode: 'exact', shares: { memberId, amountCents }[] }
 * groupMemberIds define quem é válido e a ordem de distribuição do resto.
 */
function buildShares(amountCents, split, groupMemberIds) {
  const allowed = new Set(groupMemberIds);

  if (split.mode === SPLIT_MODES.EQUAL) {
    const selected = new Set(split.memberIds);
    if ([...selected].some(id => !allowed.has(id))) throw new ValidationError('A divisão inclui alguém que não está no grupo.');
    return splitEvenly(
      amountCents,
      groupMemberIds.filter(id => selected.has(id)),
    );
  }

  if (split.mode === SPLIT_MODES.EXACT) {
    const seen = new Set();
    for (const { memberId } of split.shares) {
      if (!allowed.has(memberId)) throw new ValidationError('A divisão inclui alguém que não está no grupo.');
      if (seen.has(memberId)) throw new ValidationError('Cada pessoa pode aparecer só uma vez na divisão.');
      seen.add(memberId);
    }
    const shares = split.shares.filter(share => share.amountCents > 0);
    if (!shares.length) throw new ValidationError('Informe o valor de ao menos uma pessoa.');
    const total = shares.reduce((sum, share) => sum + share.amountCents, 0);
    if (total !== amountCents) throw new ValidationError('A soma das parcelas precisa ser igual ao valor total.');
    return shares;
  }

  throw new ValidationError('Tipo de divisão inválido.');
}

module.exports = { SPLIT_MODES, splitEvenly, buildShares };
