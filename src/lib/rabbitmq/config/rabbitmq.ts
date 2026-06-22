import { connect } from "amqplib";

type routingKey = "email" | "invoice" | "notification";

async function rabbitmq({
  msg,
  exchange = "tribel.events",
  routingKey,
}: {
  msg: string;
  exchange: string;
  routingKey: routingKey;
}) {
  const connection = await connect(process.env.RABBITMQ_ACCESS_KEY || "");
  const channel = await connection.createChannel();

  await channel.assertExchange(exchange, "direct", {
    durable: true,
  });

  channel.publish(exchange, routingKey, Buffer.from(msg), {
    persistent: true,
  });
}

export default rabbitmq;
