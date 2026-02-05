import redisClient from "./redis.ts";

export const lockScript = `
  if redis.call("GET",KEYS[1]) == ARGV[1]
  then
      return redis.call("DEL",KEYS[1])
  else
      return 0
  end
`;

export async function acquireLock( key: string, keyValue: string, ttl: number,) {
  const result = await redisClient.set(key, keyValue, "PX", ttl, "NX");
  
  return result === "OK"
}

export async function releaseLock(key: string, keyValue: string) {
  return await redisClient.eval(lockScript, 1, key, keyValue);
}
