import { randomUUID } from "crypto";
import redisClient from "./redis.ts";

interface RateLimitResult {
  allowed: boolean; // was the request permitted?
  remaining: number; // how many requests are left in the current window/bucket
  limit: number; // the configured maximum
  retryAfter: number | null; // seconds until the client should retry (null if allowed)
  delay?: number | null; // optional wait time (leaky bucket shaping mode)
}

interface SlidingWindowLogConfig {
  maxRequests: number;
  windowSeconds: number;
}

const DEFAULT_CONFIG: SlidingWindowLogConfig = {
  maxRequests: 10,
  windowSeconds: 1 * 60 * 60,
};

const RATE_LIMIT = `
  local key = KEYS[1]
  local max_requests = tonumber(ARGV[1])
  local window_seconds = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local member = ARGV[4]

  local window_start = now - window_seconds * 1000

  redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

  local count = redis.call('ZCARD', key)

  if count < max_requests then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, window_seconds)
  return { 1, max_requests - count - 1, 0 }
  end

  -- Denied: find oldest entry to compute retry-after (in ms)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after_ms = window_seconds * 1000
  if #oldest >= 2 then
    retry_after_ms = oldest[2] + window_seconds * 1000 - now
  end

  return { 0, 0, retry_after_ms }
`;

export async function attempt(
  key: string,
  config: SlidingWindowLogConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const { maxRequests, windowSeconds } = config;

  const now = Date.now();
  const member = `${now}:${randomUUID()}`;

  const result = (await redisClient.eval(
    RATE_LIMIT,
    1,
    key,
    maxRequests.toString(),
    windowSeconds.toString(),
    now.toString(),
    member,
  )) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1] ?? 0;
  const retryAfterMs = result[2];

  return {
    allowed,
    remaining,
    limit: maxRequests,
    retryAfter: allowed ? null : Math.max(0, retryAfterMs! / 1000),
  };
}
