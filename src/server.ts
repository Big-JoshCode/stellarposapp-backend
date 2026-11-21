import { createServer } from 'node:http';
import { app } from '@/app';
import { config } from '@/config/config';
import { attachRealtime, closeRealtime } from '@/services/realtime';
import { startPaymentWatcher, stopPaymentWatcher } from '@/services/paymentWatcher';
import { startBackupSchedule, stopBackupSchedule } from '@/utils/backup';
import { closeDatabase, connectDatabase } from '@/utils/database';
import { logger } from '@/utils/logger';
import { connectRedis } from '@/utils/redis';
import { closeQueues, flushQueues, setupQueues } from '@/utils/queue';
import { createShutdown } from '@/utils/shutdown';
import { startEmailWorker } from '@/services/email.service';

export { app };

export const server = createServer(app);

async function start(): Promise<void> {
  await connectDatabase();
  await connectRedis();
  setupQueues();
  startEmailWorker();
  attachRealtime(server);
  startPaymentWatcher();
  startBackupSchedule();

  server.listen(config.port, () => {
    logger.info(`StellarPOS API listening on http://localhost:${config.port} (${config.env})`);
  });
}

const shutdown = createShutdown({
  server,
  timeoutMs: config.shutdown.timeoutMs,
  flushTimeoutMs: config.shutdown.timeoutMs,
  stopBackground: () => {
    stopPaymentWatcher();
    stopBackupSchedule();
  },
  flushJobs: (timeoutMs) => flushQueues(timeoutMs),
  release: async () => {
    await closeRealtime();
    closeQueues();
    closeDatabase();
  },
  exit: (code) => process.exit(code),
  log: (message) => logger.info(message),
  warn: (message) => logger.warn(message),
});

if (require.main === module) {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  start().catch((err: Error) => {
    logger.error(`Failed to start: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
}
