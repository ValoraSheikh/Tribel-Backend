import type { Channel, ChannelModel } from "amqplib";
import { connect } from "amqplib";

export type RabbitMQConnection = ChannelModel;
export type RabbitMQChannel = Channel;

let initialConnection: Promise<RabbitMQChannel> | undefined;

async function createRabbitMQConnection() {

  if (initialConnection) {
    return initialConnection;
  }

  initialConnection = (async () => {
    const connection = await connect(process.env.RABBITMQ_URL || "");
    const channel = await connection.createChannel();

    await channel.assertExchange("tribel.events", "direct", {
      durable: true,
    });
    await channel.assertExchange("tribel.dlx", "direct", {
      durable: true,
    });
    await channel.assertExchange("tribel.retry", "direct", {
      durable: true,
    });

    connection.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
    });

    connection.on("close", () => {
      console.log("RabbitMQ connection closed");
    });
    
    return channel;
  })();

  return initialConnection;
}

export default createRabbitMQConnection;
