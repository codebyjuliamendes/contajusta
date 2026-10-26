'use strict';

/** Violação de regra de negócio; a camada HTTP converte em 400. */
class ValidationError extends Error {}

module.exports = { ValidationError };
