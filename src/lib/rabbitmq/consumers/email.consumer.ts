import { connect } from "amqplib";
import emailWorker from "../workers/email.worker.ts";

async function emailConsumer() {
  const connection = await connect(process.env.RABBITMQ_ACCESS_KEY || "");
  const channel = await connection.createChannel();
  channel.prefetch(1);

  await channel.assertQueue("tribel.email.queue", { durable: true });
  await channel.bindQueue("tribel.email.queue", "tribel.events", "email");

  await channel.consume(
    "tribel.email.queue",
    async (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());

        console.log(" [x] Received '%s'", content);
        const result = await emailWorker({ msg: content });
        console.log(" [x] Result '%s'", result);

        channel.ack(msg);
      }
    },
    { noAck: false },
  );
}

export default emailConsumer;
