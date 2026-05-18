// =============================================================================
// server.js — TechManager API Entry Point
// =============================================================================
require('dotenv').config();
const app     = require('./app');
const { sequelize } = require('./config/database');
const logger  = require('./config/logger');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established.');

    // Sync models without dropping tables in production
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: false });
    }

    app.listen(PORT, () => {
      logger.info(`🚀 TechManager API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();
