import invoiceWorker from "../workers/invoice.worker.ts";
import createRabbitMQConnection from "../config/connection.ts";

async function invoiceConsumer() {
  const channel = await createRabbitMQConnection();
  channel.prefetch(1);

  await channel.assertQueue("tribel.invoice.queue", {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "tribel.dlx",
      "x-dead-letter-routing-key": "invoice.failed",
    },
  });
  await channel.bindQueue("tribel.invoice.queue", "tribel.events", "invoice");

  await channel.assertQueue("tribel.invoice.dlq", {
    durable: true,
  });
  await channel.bindQueue("tribel.invoice.dlq", "tribel.dlx", "invoice.failed");

  await channel.assertQueue("tribel.invoice.retry", {
    durable: true,
    arguments: {
      "x-message-ttl": 30000,
      "x-dead-letter-exchange": "tribel.events",
      "x-dead-letter-routing-key": "invoice.retry",
    },
  });
  await channel.bindQueue(
    "tribel.invoice.retry",
    "tribel.retry",
    "invoice.retry",
  );

  await channel.consume(
    "tribel.invoice.queue",
    async (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());

        console.log(" [x] Received '%s'", content);

        try {
          const deathHeaders = msg.properties.headers?.["x-death"] as
            | Array<{ queue: string; reason: string; count: number }>
            | undefined;
          const retries =
            deathHeaders?.find(
              (d) =>
                d.queue === "tribel.invoice.queue" && d.reason === "rejected",
            )?.count ?? 0;

          if (retries >= 3) {
            channel.publish(
              "tribel.events",
              "invoice.failed",
              Buffer.from(JSON.stringify(content)),
            );
            channel.ack(msg);
            return;
          }

          const result = await invoiceWorker({ msg: content });
          console.log(" [x] Result '%s'", result);
          channel.ack(msg);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(message);
          channel.nack(msg, false, false);
        }
      }
    },
    { noAck: false },
  );
}

export default invoiceConsumer;
