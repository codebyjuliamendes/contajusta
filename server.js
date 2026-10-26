'use strict';

const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'contajusta.sqlite');

const db = openDatabase(dbPath);
const server = createApp(db).listen(port, () => console.log(`ContaJusta disponível em http://localhost:${port}`));

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
