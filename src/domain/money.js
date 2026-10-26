'use strict';

const MAX_AMOUNT_CENTS = 100_000_000; // R$ 1.000.000,00

/**
 * Converte um valor monetário em centavos inteiros sem passar por aritmética
 * de ponto flutuante (ex.: 1.005 * 100 === 100.49999...).
 * Aceita números ou strings como "120", "120.5", "120,50" ou "1.234,56".
 * Retorna null quando o valor é inválido ou tem mais de duas casas decimais.
 */
function parseAmountToCents(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? parseAmountToCents(String(value)) : null;
  if (typeof value !== 'string') return null;

  let text = value.trim().replace(/^R\$\s*/i, '');
  // Separador de milhar brasileiro só quando não há ambiguidade: "1.234,56" ou "1.234.567".
  // "1.005" sozinho é tratado como decimal (e rejeitado por ter três casas).
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text) || /^\d{1,3}(\.\d{3}){2,}$/.test(text)) text = text.replace(/\./g, '');
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return null;

  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

module.exports = { MAX_AMOUNT_CENTS, parseAmountToCents };
