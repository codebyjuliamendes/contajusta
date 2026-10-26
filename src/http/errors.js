'use strict';

const { ValidationError } = require('../domain/errors');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const notFound = message => new HttpError(404, message);

// Erros sempre em JSON; detalhes de falhas inesperadas só no log.
function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'O corpo da requisição não é um JSON válido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'A requisição é grande demais.' });
  console.error(err);
  res.status(500).json({ error: 'Não foi possível concluir a ação.' });
}

module.exports = { HttpError, notFound, errorHandler };
