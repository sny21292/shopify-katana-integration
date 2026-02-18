const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Get current timestamp in readable format
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Get today's log file path
 */
function getLogFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `sync-${date}.log`);
}

/**
 * Write a log entry to both console and file
 */
function writeLog(level, message, data = null) {
  const timestamp = getTimestamp();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data && { data }),
  };

  // Console output
  const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') {
    console.error(consoleMsg, data || '');
  } else {
    console.log(consoleMsg, data ? JSON.stringify(data) : '');
  }

  // File output
  try {
    const fileLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(getLogFilePath(), fileLine);
  } catch (err) {
    console.error('Failed to write to log file:', err.message);
  }
}

const logger = {
  info: (message, data) => writeLog('info', message, data),
  warn: (message, data) => writeLog('warn', message, data),
  error: (message, data) => writeLog('error', message, data),
  success: (message, data) => writeLog('success', message, data),
};

module.exports = logger;
