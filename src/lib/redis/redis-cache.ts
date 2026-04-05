import { Redis } from "ioredis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not defined in environment variables");
}

const client = new Redis(process.env.REDIS_URL, {
  enableOfflineQueue: false,
});

export default client;
