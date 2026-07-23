import * as pino from 'pino';
import { env } from '@/config';

/** Shared application logger. Level is configurable via `NEXT_PUBLIC_LOGGING_LEVEL`. */
export const logger = pino.pino({
  level: env.NEXT_PUBLIC_LOGGING_LEVEL,
  browser: { asObject: true },
});
