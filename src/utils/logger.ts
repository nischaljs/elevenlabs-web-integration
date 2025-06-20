import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'local_serverlog.json' })
  ],
});

export default logger; 