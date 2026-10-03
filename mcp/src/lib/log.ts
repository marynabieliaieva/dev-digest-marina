/**
 * Logging goes to STDERR only. On a stdio MCP server stdout IS the protocol
 * channel — a single stray write there corrupts the JSON-RPC stream (D10).
 * Never use console.log in this package.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  (level: LogLevel, message: string): void;
}

/** Strip control chars/newlines so a logged value can't forge extra log lines. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\u0000-\u001f]+/g, ' ');
}

export const log: Logger = (level, message) => {
  process.stderr.write(`[devdigest-mcp] ${level}: ${oneLine(message)}\n`);
};
