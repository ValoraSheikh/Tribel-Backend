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

  await channel.consume(
    "tribel.invoice.queue",
    async (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());

        console.log(" [x] Received '%s'", content);

        try {
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
