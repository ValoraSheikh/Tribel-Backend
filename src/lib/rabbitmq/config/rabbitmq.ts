import createRabbitMQConnection from "./connection.ts";

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
  const channel = await createRabbitMQConnection();

  channel.publish(exchange, routingKey, Buffer.from(msg), {
    persistent: true,
  });
}

export default rabbitmq;
