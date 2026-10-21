import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';

const logDir = path.resolve(process.cwd(), 'logs');

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const extra = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${String(timestamp)} ${level.toUpperCase().padEnd(5)} ${stack ? String(stack) : String(message)}${extra}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const transports: winston.transport[] = [new winston.transports.Console({ format: consoleFormat })];

// Rotating files: capped by size and age so logs never grow forever.
try {
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
      format: fileFormat,
    }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
      format: fileFormat,
    }),
  );
} catch {
  // File logging is best effort; console logging keeps working.
}

const base = winston.createLogger({
  level: config.logLevel,
  transports,
  exitOnError: false,
});

let closed = false;

export function isLoggerClosed(): boolean {
  return closed;
}

/**
 * Thin facade over winston. Once the logger is closed during shutdown, late log calls (for example
 * a "disconnected" event fired by the driver) are dropped instead of throwing "write after end".
 */
export const logger = {
  error: (message: string): void => {
    if (!closed) base.error(message);
  },
  warn: (message: string): void => {
    if (!closed) base.warn(message);
  },
  info: (message: string): void => {
    if (!closed) base.info(message);
  },
  debug: (message: string): void => {
    if (!closed) base.debug(message);
  },
};

/** Flush transports before the process exits. */
export function closeLogger(): Promise<void> {
  closed = true;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    base.on('finish', () => {
      clearTimeout(timer);
      resolve();
    });
    base.end();
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
