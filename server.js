'use strict';

const { loadConfig } = require('./src/config');
const { createLogger, serializeError } = require('./src/logger');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, bindings: { service: 'contajusta' } });
const db = openDatabase(config.databasePath);
const app = createApp(db, { logger, rateLimitPerMinute: config.rateLimitPerMinute, trustProxy: config.trustProxy });

const server = app.listen(config.port, () => logger.info('server_started', { port: config.port, env: config.env }));

function shutdown(signal) {
  logger.info('shutdown', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', reason => logger.error('unhandled_rejection', { err: serializeError(Object(reason)) }));
process.on('uncaughtException', err => {
  logger.error('uncaught_exception', { err: serializeError(err) });
  process.exit(1);
});
