import pino from 'pino';
import { config } from '../config/index';

const isProd = config.node.env === 'production';

export const logger = pino(
  {
    level: config.log.level,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isProd
    ? pino.destination()
    : pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      })
);

export type Logger = typeof logger;
