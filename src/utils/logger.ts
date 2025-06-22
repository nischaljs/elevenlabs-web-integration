// Simple logger for development
const logForDev = (...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    const level = '[DEV LOG]';
    const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg)).join(' ');
    // Print a separator line before every log
    console.log('---------------------------------------------------------------------------------------------------------');
    console.log(`${level} [${timestamp}] ${msg}`);
  }
};

export default logForDev; 