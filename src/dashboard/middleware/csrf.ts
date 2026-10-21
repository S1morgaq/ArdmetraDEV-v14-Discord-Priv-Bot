import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Synchronizer-token CSRF protection. The token lives in the server-side session and must be sent
 * back in the `x-csrf-token` header (fetch) or `_csrf` body field (forms) on every unsafe request.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;

  if (SAFE_METHODS.has(req.method)) return next();

  const sent = req.get('x-csrf-token') ?? (typeof req.body?._csrf === 'string' ? (req.body._csrf as string) : '');
  if (!sent || !safeEqual(sent, req.session.csrf)) {
    res.status(403);
    if (req.originalUrl.startsWith('/api')) res.json({ error: 'Invalid CSRF token. Reload the page and try again.' });
    else res.render('pages/error', { code: 403, message: 'Invalid CSRF token. Reload the page and try again.' });
    return;
  }
  next();
}
