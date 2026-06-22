import { connect } from "amqplib";
import invoiceWorker from "../workers/invoice.worker.ts";

async function invoiceConsumer() {
  const connection = await connect(process.env.RABBITMQ_ACCESS_KEY || "");
  const channel = await connection.createChannel();
  channel.prefetch(1);

  await channel.assertQueue("tribel.invoice.queue", { durable: true });
  await channel.bindQueue("tribel.invoice.queue", "tribel.events", "invoice");

  await channel.consume(
    "tribel.invoice.queue",
    async (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());

        console.log(" [x] Received '%s'", content);
        const result = await invoiceWorker({ msg: content });
        console.log(" [x] Result '%s'", result);

        channel.ack(msg);
      }
    },
    { noAck: false },
  );
}

export default invoiceConsumer;
