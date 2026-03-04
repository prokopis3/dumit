import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

let ratelimit: Ratelimit | null = null;
let disableRemoteRateLimit = false;

if (env.upstashRedisRestUrl && env.upstashRedisRestToken) {
  const redis = new Redis({
    url: env.upstashRedisRestUrl,
    token: env.upstashRedisRestToken,
  });

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(25, "1 m"),
    analytics: true,
    prefix: "dumit-domain-search",
  });
}

export async function enforceRateLimit(identifier: string): Promise<{ allowed: boolean; remaining: number }> {
  if (!ratelimit || disableRemoteRateLimit) {
    return { allowed: true, remaining: 999 };
  }

  try {
    const result = await ratelimit.limit(identifier);
    return {
      allowed: result.success,
      remaining: result.remaining,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("ALLOWLIST") ||
      message.includes("not allowed") ||
      message.includes("ECONN") ||
      message.includes("timeout")
    ) {
      disableRemoteRateLimit = true;
    }

    return { allowed: true, remaining: 999 };
  }
}
