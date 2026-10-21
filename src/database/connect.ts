import mongoose from 'mongoose';
import { config } from '../config';
import { logger, errorMessage } from '../utils/logger';

let listenersAttached = false;

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);

  if (!listenersAttached) {
    listenersAttached = true;
    mongoose.connection.on('disconnected', () => logger.warn('[DATABASE] MongoDB disconnected.'));
    mongoose.connection.on('reconnected', () => logger.info('[DATABASE] MongoDB reconnected.'));
    mongoose.connection.on('error', (error: unknown) => logger.error(`[DATABASE] ${errorMessage(error)}`));
  }

  try {
    await mongoose.connect(config.database.uri, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      autoIndex: !config.isProduction,
    });
  } catch (error) {
    throw new Error(`Could not connect to MongoDB: ${errorMessage(error)}`);
  }

  // Ensure indexes exist even in production (cheap when they already exist).
  await mongoose.syncIndexes().catch((error: unknown) => {
    logger.warn(`[DATABASE] Index sync failed: ${errorMessage(error)}`);
  });
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
