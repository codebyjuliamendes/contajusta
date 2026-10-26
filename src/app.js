'use strict';

const express = require('express');
const path = require('node:path');
const { version } = require('../package.json');
const { createStore } = require('./store');
const { createLogger } = require('./logger');
const { securityHeaders } = require('./http/security');
const { requestContext } = require('./http/request-context');
const { rateLimit } = require('./http/rate-limit');
const { errorHandler, notFound } = require('./http/errors');
const { groupRoutes } = require('./routes/groups');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * @param db conexão better-sqlite3 já migrada
 * @param options.logger padrão: silencioso (testes)
 * @param options.rateLimitPerMinute 0 desativa
 * @param options.trustProxy saltos de proxy confiáveis para req.ip
 */
function createApp(db, { logger = createLogger({ level: 'silent' }), rateLimitPerMinute = 0, trustProxy = 0 } = {}) {
  const store = createStore(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use(requestContext(logger));
  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));
  // Assets sem hash no nome: revalida sempre via ETag (304 barato, nunca desatualizado).
  app.use(express.static(PUBLIC_DIR, { setHeaders: res => res.set('Cache-Control', 'no-cache') }));
  // Link de convite: a SPA lê a chave da URL.
  app.get('/g/:groupKey', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC_DIR, 'index.html')));

  const api = express.Router();
  const limiter = rateLimit({ limit: rateLimitPerMinute });
  api.use((req, res, next) => (MUTATING.has(req.method) ? limiter(req, res, next) : next()));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', version });
  });
  api.use('/groups', groupRoutes(store));
  api.use((_req, _res, next) => next(notFound('Rota da API não encontrada.')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
