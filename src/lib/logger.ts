import pino from "pino";
import { context, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

const SEVERITY: Record<number, number> = {
  10: 1,
  20: 5,
  30: 9,
  40: 13,
  50: 17,
  60: 21,
};

const otelLogger = logs.getLogger("tribel-backend");

function toAttributes(record: Record<string, unknown>): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    } else {
      attributes[key] = JSON.stringify(value);
    }
  }
  return attributes;
}

const otelStream = {
  write(line: string) {
    try {
      const { level, msg, time, ...rest } = JSON.parse(line);
      otelLogger.emit({
        timestamp: typeof time === "number" ? time : Date.now(),
        severityNumber: SEVERITY[level] ?? 9,
        severityText: (pino.levels.labels[level] ?? "info").toUpperCase(),
        body: msg ?? "",
        attributes: toAttributes(rest),
        context: context.active(),
      });
    } catch {
      // logging must never throw
    }
  },
};

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId, traceFlags } = span.spanContext();
      return {
        trace_id: traceId,
        span_id: spanId,
        trace_flags: `0${traceFlags.toString(16)}`,
      };
    },
  },
  pino.multistream([{ stream: process.stdout }, { stream: otelStream }]),
);

export default logger;
