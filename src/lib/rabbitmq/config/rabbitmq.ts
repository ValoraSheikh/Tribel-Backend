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

  await channel.assertExchange(exchange, "direct", {
    durable: true,
  });

  await channel.assertExchange("tribel.dlx", "direct", {
    durable: true,
  });
  
  channel.publish(exchange, routingKey, Buffer.from(msg), {
    persistent: true,
  });
}

export default rabbitmq;
