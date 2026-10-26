'use strict';

const express = require('express');
const path = require('node:path');
const { createStore } = require('./store');
const { securityHeaders } = require('./http/security');
const { errorHandler, notFound } = require('./http/errors');
const { groupRoutes } = require('./routes/groups');

function createApp(db) {
  const store = createStore(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  // Link de convite: a SPA lê a chave da URL.
  app.get('/g/:groupKey', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  api.use('/groups', groupRoutes(store));
  api.use((_req, _res, next) => next(notFound('Rota da API não encontrada.')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
