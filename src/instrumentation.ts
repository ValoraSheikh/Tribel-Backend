import "dotenv/config";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  console.log("OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)");
} else {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "tribel-backend",
      "service.version": process.env.APP_VERSION ?? "dev",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // pino log correlation + shipping is done explicitly in src/lib/logger.ts;
        // the bundled instrumentation never patches pino under tsx/ESM.
        "@opentelemetry/instrumentation-pino": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log("OpenTelemetry instrumentation initialized");

  process.on("SIGTERM", () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
}
