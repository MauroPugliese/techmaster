// =============================================================================
// server.js — SMaRT API Entry Point
// =============================================================================
require('dotenv').config();
const http = require('http');
const app     = require('./app');
const { sequelize } = require('./config/database');
const logger  = require('./config/logger');
const { initSocket } = require('./config/socket');
const { PlannedMaintenanceTask, PlannedMaintenanceTaskInstance } = require('./models');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established.');

    // Ensure the planned maintenance tables exist even on older live volumes.
    await PlannedMaintenanceTask.sync({ alter: true });
    await PlannedMaintenanceTaskInstance.sync({ alter: true });

    // Sync models without dropping tables in production
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
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

