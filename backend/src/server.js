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

function assertSecuritySecrets() {
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const refreshSecret = String(process.env.JWT_REFRESH_SECRET || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required.');
  }
  if (isProd) {
    if (jwtSecret.length < 16 || /CHANGE_ME|changeme|dev_secret/i.test(jwtSecret)) {
      throw new Error('Production JWT_SECRET must be a strong, non-placeholder secret (min 16 chars).');
    }
    if (!refreshSecret || refreshSecret.length < 16 || /CHANGE_ME|changeme/i.test(refreshSecret)) {
      throw new Error('Production JWT_REFRESH_SECRET must be a strong, non-placeholder secret (min 16 chars).');
    }
    if (jwtSecret === refreshSecret) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be distinct values in production.');
    }
  } else if (refreshSecret && jwtSecret === refreshSecret) {
    logger.warn('JWT_SECRET and JWT_REFRESH_SECRET are identical; configure distinct secrets before deploying to production.');
  }
}

async function bootstrap() {
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

    const server = http.createServer(app);
    const io = initSocket(server);
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

