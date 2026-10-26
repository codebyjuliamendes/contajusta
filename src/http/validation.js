'use strict';

const { ValidationError } = require('../domain/errors');
const { MAX_AMOUNT_CENTS, parseAmountToCents } = require('../domain/money');
const { SPLIT_MODES, buildShares } = require('../domain/split');

const MAX_MEMBERS = 20;

const cleanText = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const nameKey = name => name.toLocaleLowerCase('pt-BR');

/** Inteiro positivo vindo de JSON ou de parâmetro de rota; null se inválido. */
function parseId(value) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Remove vazios e duplicados (case-insensitive), preservando a primeira grafia. */
function uniqueNames(values) {
  const seen = new Map();
  for (const name of values.map(cleanText).filter(Boolean)) if (!seen.has(nameKey(name))) seen.set(nameKey(name), name);
  return [...seen.values()];
}

function parseMemberName(value) {
  const name = cleanText(value);
  if (name.length < 2 || name.length > 50) throw new ValidationError('O nome deve ter entre 2 e 50 caracteres.');
  return name;
}

function parseGroupInput(body) {
  const name = cleanText(body?.name);
  const members = Array.isArray(body?.members) ? uniqueNames(body.members) : [];
  if (name.length < 2 || name.length > 60) throw new ValidationError('O nome do grupo deve ter entre 2 e 60 caracteres.');
  if (members.length < 2 || members.length > MAX_MEMBERS || members.some(n => n.length < 2 || n.length > 50)) {
    throw new ValidationError(`Informe de 2 a ${MAX_MEMBERS} pessoas diferentes, com nomes de 2 a 50 caracteres.`);
  }
  return { name, members };
}

// shares: [{ memberId, amountCents }] no corpo; precisa cobrir cada pessoa do grupo uma vez.
function parseLegacyShares(raw, memberIds) {
  if (!Array.isArray(raw) || raw.length !== memberIds.length) throw new ValidationError('Informe uma parcela para cada pessoa do grupo.');
  const shares = raw.map(share => ({ memberId: parseId(share?.memberId), amountCents: share?.amountCents }));
  if (new Set(shares.map(s => s.memberId)).size !== memberIds.length || !memberIds.every(id => shares.some(s => s.memberId === id))) {
    throw new ValidationError('As parcelas devem incluir cada pessoa uma única vez.');
  }
  if (shares.some(s => !Number.isSafeInteger(s.amountCents) || s.amountCents < 0)) {
    throw new ValidationError('Cada parcela deve ser um valor inteiro de centavos igual ou maior que zero.');
  }
  return { mode: SPLIT_MODES.EXACT, shares };
}

// Ausente => divisão igual entre todo o grupo.
function parseSplit(body, memberIds) {
  const raw = body?.split;
  if ((raw === undefined || raw === null) && body?.shares !== undefined) return parseLegacyShares(body.shares, memberIds);
  if (raw === undefined || raw === null) return { mode: SPLIT_MODES.EQUAL, memberIds };

  if (raw.mode === SPLIT_MODES.EQUAL) {
    if (!Array.isArray(raw.memberIds) || raw.memberIds.length > MAX_MEMBERS) throw new ValidationError('Selecione quem divide a despesa.');
    return { mode: SPLIT_MODES.EQUAL, memberIds: raw.memberIds.map(parseId) };
  }

  if (raw.mode === SPLIT_MODES.EXACT) {
    if (!Array.isArray(raw.shares) || raw.shares.length > MAX_MEMBERS) throw new ValidationError('Informe quanto cabe a cada pessoa.');
    const shares = raw.shares.map(share => {
      const amountCents = parseAmountToCents(share?.amount);
      if (amountCents === null) throw new ValidationError('Os valores por pessoa devem ter no máximo duas casas decimais.');
      return { memberId: parseId(share?.memberId), amountCents };
    });
    return { mode: SPLIT_MODES.EXACT, shares };
  }

  throw new ValidationError('Tipo de divisão inválido.');
}

/** Normaliza o corpo de criação/edição de despesa no formato persistido pelo store. */
function parseExpenseInput(body, members) {
  const memberIds = members.map(m => m.id);
  const description = cleanText(body?.description);
  const paidBy = parseId(body?.paidBy);
  const amountCents = parseAmountToCents(body?.amount);

  if (description.length < 2 || description.length > 100) throw new ValidationError('A descrição deve ter entre 2 e 100 caracteres.');
  if (!memberIds.includes(paidBy)) throw new ValidationError('Selecione quem pagou a despesa.');
  if (amountCents === null || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError('Informe um valor entre R$ 0,01 e R$ 1.000.000,00, com até duas casas decimais.');
  }

  const split = parseSplit(body, memberIds);
  return { description, paidBy, amountCents, splitMode: split.mode, shares: buildShares(amountCents, split, memberIds) };
}

module.exports = { MAX_MEMBERS, cleanText, nameKey, parseId, parseMemberName, parseGroupInput, parseExpenseInput };
