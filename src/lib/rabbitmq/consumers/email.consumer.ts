import emailWorker from "../workers/email.worker.tsx";
import createRabbitMQConnection from "../config/connection.ts";

async function emailConsumer() {
  const channel = await createRabbitMQConnection();
  channel.prefetch(1);

  await channel.assertQueue("tribel.email.queue", {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "tribel.retry",
      "x-dead-letter-routing-key": "email.retry",
    },
  });
  await channel.bindQueue("tribel.email.queue", "tribel.events", "email");

  await channel.assertQueue("tribel.email.dlq", {
    durable: true,
  });
  await channel.bindQueue("tribel.email.dlq", "tribel.dlx", "email.failed");

  await channel.assertQueue("tribel.email.retry", {
    durable: true,
    arguments: {
      "x-message-ttl": 30000,
      "x-dead-letter-exchange": "tribel.events",
      "x-dead-letter-routing-key": "email",
    },
  });
  await channel.bindQueue("tribel.email.retry", "tribel.retry", "email.retry");

  await channel.consume(
    "tribel.email.queue",
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
                d.queue === "tribel.email.queue" && d.reason === "rejected",
            )?.count ?? 0;

          if (retries >= 3) {
            channel.publish(
              "tribel.dlx",
              "email.failed",
              Buffer.from(JSON.stringify(content)),
              {
                persistent: true,
              },
            );

            channel.ack(msg);
            return;
          }

          const result = await emailWorker({ msg: content });
          console.log(" [x] Result '%s'", result);
          channel.ack(msg);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(errorMessage);
          channel.nack(msg, false, false);
        }
      }
    },
    { noAck: false },
  );
}

export default emailConsumer;
