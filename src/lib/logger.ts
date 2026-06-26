// Minimal structured JSON logger. CloudWatch Logs indexes JSON, so emitting one
// object per line gives queryable, correlatable logs without a logging dependency.

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.log)(line);
}

export const logger = {
  debug: (m: string, e?: Record<string, unknown>) => emit("debug", m, e),
  info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};
