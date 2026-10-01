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

async function bootstrap() {
  try {
    const libreOffice = detectLibreOfficeBinary();
    if (libreOffice.available) {
      logger.info(`Template PDF conversion enabled (binary: ${libreOffice.binary})`);
    } else {
      logger.warn('Template PDF conversion disabled: LibreOffice/soffice not found. DOCX exports still work.');
    }

    await sequelize.authenticate();
    logger.info('✅ Database connection established.');

    // Ensure all migrations are applied cleanly
    await runMigrations();

    // In development mode, ensure any new Sequelize model updates are synced
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync();
    }

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

