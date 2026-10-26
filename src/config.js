'use strict';

const path = require('node:path');

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

function int(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} inválido: "${raw}" (inteiro entre ${min} e ${max}).`);
  return value;
}

/** Lê e valida o ambiente uma vez; falha no boot em vez de em runtime. */
function loadConfig(env = process.env) {
  const logLevel = env.LOG_LEVEL || 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`LOG_LEVEL inválido: "${logLevel}" (${LOG_LEVELS.join(', ')}).`);

  return Object.freeze({
    env: env.NODE_ENV || 'development',
    port: int(env, 'PORT', 3000, { min: 1, max: 65535 }),
    databasePath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'contajusta.sqlite'),
    logLevel,
    // Saltos de proxy confiáveis (ex.: 1 atrás do proxy da Fly/Render) para obter o IP real.
    trustProxy: int(env, 'TRUST_PROXY', 0, { min: 0, max: 10 }),
    rateLimitPerMinute: int(env, 'RATE_LIMIT_PER_MINUTE', 60, { min: 0 }),
  });
}

module.exports = { loadConfig, LOG_LEVELS };
