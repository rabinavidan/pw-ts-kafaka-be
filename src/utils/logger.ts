import { createLogger, format, transports } from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = createLogger({
  level: logLevel,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] ${level}: ${message}${metaStr}`;
    }),
  ),
  transports: [
    new transports.Console(),
    new transports.File({
      filename: 'test-results/test.log',
      format: format.combine(format.timestamp(), format.uncolorize(), format.json()),
    }),
  ],
});
