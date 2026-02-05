import { Redis } from "ioredis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not defined in environment variables");
}

const redisClient = new Redis(process.env.REDIS_URL, {
  enableOfflineQueue: false,
});

export default redisClient;
