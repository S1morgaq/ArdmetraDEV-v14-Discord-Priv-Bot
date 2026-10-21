import type { Server } from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import MongoStore from 'connect-mongo';
import { config } from '../config';
import { getHealth } from '../core/state';
import { logger, errorMessage } from '../utils/logger';
import './types';
import { csrfProtection } from './middleware/csrf';
import { requireAuth } from './middleware/auth';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/auth';
import { pagesRouter } from './routes/pages';
import { userAvatarUrl } from './data';

export interface DashboardHandle {
  close(): Promise<void>;
}

// dist/dashboard -> ../../dashboard (project root); src/dashboard -> ../../dashboard as well.
const ASSET_ROOT = path.resolve(__dirname, '..', '..', 'dashboard');

export async function startDashboard(): Promise<DashboardHandle> {
  const app = express();
  app.disable('x-powered-by');
  if (config.dashboard.trustProxy > 0) app.set('trust proxy', config.dashboard.trustProxy);

  app.set('view engine', 'ejs');
  app.set('views', path.join(ASSET_ROOT, 'views'));

  // Health endpoints stay reachable without a session and without rate limiting.
  const health = (_req: Request, res: Response) => {
    const report = getHealth();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.dashboard.secureCookies ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      hsts: config.dashboard.secureCookies,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(
    '/static',
    express.static(path.join(ASSET_ROOT, 'public'), { maxAge: config.isProduction ? '1h' : 0, index: false }),
  );

  app.use(rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));

  const store = MongoStore.create({
    mongoUrl: config.database.uri,
    collectionName: 'sessions',
    ttl: 24 * 3600,
    touchAfter: 300,
  });
  app.use(
    session({
      name: 'priv.sid',
      secret: config.dashboard.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      proxy: config.dashboard.trustProxy > 0,
      cookie: {
        httpOnly: true,
        secure: config.dashboard.secureCookies,
        sameSite: 'lax',
        maxAge: 24 * 3600 * 1000,
      },
    }),
  );

  app.use(csrfProtection);

  // Template locals available in every view.
  app.use((req, res, next) => {
    const user = req.session.user;
    res.locals.user = user ? { ...user, displayName: user.globalName ?? user.username, avatarUrl: userAvatarUrl(user) } : null;
    res.locals.isBotOwner = user ? config.dashboard.ownerIds.includes(user.id) : false;
    res.locals.tagline = config.tagline;
    res.locals.version = config.version;
    res.locals.path = req.path;
    res.locals.guildCtx = undefined;
    next();
  });

  app.use(
    '/auth',
    rateLimit({ windowMs: 15 * 60_000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false }),
  );
  app.use(authRouter);

  app.use(
    '/api',
    requireAuth,
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.session.user?.id ?? req.ip ?? 'anonymous',
      message: { error: 'Too many requests. Slow down.' },
    }),
    apiRouter,
  );
  app.use(pagesRouter);

  app.use((req, res) => {
    res.status(404);
    if (req.originalUrl.startsWith('/api')) res.json({ error: 'Not found.' });
    else res.render('pages/error', { code: 404, message: 'Page not found.' });
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error(`[DASHBOARD] ${req.method} ${req.originalUrl}: ${error instanceof Error ? (error.stack ?? error.message) : errorMessage(error)}`);
    if (res.headersSent) return;
    res.status(500);
    if (req.originalUrl.startsWith('/api')) res.json({ error: 'Internal server error.' });
    else res.render('pages/error', { code: 500, message: 'Something went wrong.' });
  });

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(config.dashboard.port, config.dashboard.host, () => resolve(s));
    s.once('error', reject);
  });
  server.keepAliveTimeout = 65_000;
  logger.info(`[DASHBOARD] Listening on ${config.dashboard.host}:${config.dashboard.port} (public URL ${config.dashboard.url}).`);

  return {
    async close() {
      // Stop accepting new requests, then drop idle connections and close the session store.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        setTimeout(() => {
          server.closeAllConnections();
          resolve();
        }, 3000).unref();
      });
      await store.close();
    },
  };
}
