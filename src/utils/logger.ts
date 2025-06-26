import util from 'util';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  fg: {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  },
};

function formatLog(level: string, color: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  const msg = args.map(arg =>
    typeof arg === 'object' ? util.inspect(arg, { colors: true, depth: 5 }) : arg
  ).join(' ');
  return `${COLORS.bright}${color}[${level}]${COLORS.reset} ${COLORS.dim}${timestamp}${COLORS.reset} ${msg}`;
}

const logger = {
  info: (...args: any[]) => {
    console.log(formatLog('INFO', COLORS.fg.green, ...args));
  },
  warn: (...args: any[]) => {
    console.warn(formatLog('WARN', COLORS.fg.yellow, ...args));
  },
  error: (...args: any[]) => {
    console.error(formatLog('ERROR', COLORS.fg.red, ...args));
  },
  debug: (...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
      console.debug(formatLog('DEBUG', COLORS.fg.cyan, ...args));
    }
  },
};

export default logger; 