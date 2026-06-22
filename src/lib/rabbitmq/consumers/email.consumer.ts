import emailWorker from "../workers/email.worker.ts";
import createRabbitMQConnection from "../config/connection.ts";

async function emailConsumer() {
  const channel = await createRabbitMQConnection();
  channel.prefetch(1);

  await channel.assertQueue("tribel.email.queue", {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "tribel.dlx",
      "x-dead-letter-routing-key": "email.failed",
    },
  });
  await channel.bindQueue("tribel.email.queue", "tribel.events", "email");

  await channel.assertQueue("tribel.email.dlq", {
    durable: true,
  });
  await channel.bindQueue("tribel.email.dlq", "tribel.dlx", "email.failed");

  await channel.consume(
    "tribel.email.queue",
    async (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());

        console.log(" [x] Received '%s'", content);

        try {
          const result = await emailWorker({ msg: content });
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

export default emailConsumer;
