// =============================================================================
// server.js — SMaRT API Entry Point
// =============================================================================
require('dotenv').config();
const http = require('http');
const app     = require('./app');
const { sequelize } = require('./config/database');
const logger  = require('./config/logger');
const { initSocket } = require('./config/socket');
const { runMigrations } = require('./config/migrate');
const { detectLibreOfficeBinary } = require('./exports/core/planned-daily-template.service');

const PORT = process.env.PORT || 3000;

const PLACEHOLDER_SECRET_RE = /change_me|changeme|dev_secret|replace-with|your_super_secret|change_in_production|example|placeholder/i;

function assertSecuritySecrets() {
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const refreshSecret = String(process.env.JWT_REFRESH_SECRET || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required.');
  }
  if (isProd) {
    if (jwtSecret.length < 32 || PLACEHOLDER_SECRET_RE.test(jwtSecret)) {
      throw new Error('Production JWT_SECRET must be a strong, non-placeholder secret (min 32 chars).');
    }
    if (!refreshSecret || refreshSecret.length < 32 || PLACEHOLDER_SECRET_RE.test(refreshSecret)) {
      throw new Error('Production JWT_REFRESH_SECRET must be a strong, non-placeholder secret (min 32 chars).');
    }
    if (jwtSecret === refreshSecret) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be distinct values in production.');
    }
  } else if (refreshSecret && jwtSecret === refreshSecret) {
    logger.warn('JWT_SECRET and JWT_REFRESH_SECRET are identical; configure distinct secrets before deploying to production.');
  }
}

async function bootstrap() {
  let server = null;
  let io = null;
  let shuttingDown = false;

  const gracefulShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s. Forcing exit.');
      process.exit(1);
    }, 10000);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    const finish = async () => {
      try {
        if (io) {
          await new Promise((resolve) => io.close(resolve));
        }
        await sequelize.close();
        logger.info('Graceful shutdown completed.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during graceful shutdown:', err);
        process.exit(1);
      }
    };

    if (server) {
      server.close(() => { void finish(); });
    } else {
      void finish();
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  try {
    assertSecuritySecrets();

    const libreOffice = detectLibreOfficeBinary();
    if (libreOffice.available) {
      logger.info(`Template PDF conversion enabled (binary: ${libreOffice.binary})`);
    } else {
      logger.warn('Template PDF conversion disabled: LibreOffice/soffice not found. DOCX exports still work.');
    }

    await sequelize.authenticate();
    logger.info('✅ Database connection established.');

    // Ensure all migrations are applied cleanly (migrations are the single schema authority)
    await runMigrations();

    server = http.createServer(app);
    io = initSocket(server);
    app.set('io', io);

    server.listen(PORT, () => {
      logger.info(`🚀 SMaRT API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();

