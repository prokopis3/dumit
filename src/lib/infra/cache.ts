import { hashKey } from "@/lib/utils";
import { env } from "@/lib/env";
import { Redis } from "@upstash/redis";

const CACHE_TTL_SECONDS = 60 * 5;

const redis = env.upstashRedisRestUrl && env.upstashRedisRestToken
  ? new Redis({
    url: env.upstashRedisRestUrl,
    token: env.upstashRedisRestToken,
  })
  : null;

const getEdgeCache = (): Cache | null => {
  if (typeof caches === "undefined") return null;
  const workerCaches = caches as CacheStorage & { default?: Cache };
  return workerCaches.default ?? null;
};

const makeEdgeCacheKey = (namespace: string, key: string) =>
  new Request(`https://cache.local/${namespace}/${key}`);

const makeRedisKey = (namespace: string, key: string) =>
  `cache:${namespace}:${key}`;

interface CacheOptions {
  skipRemote?: boolean;
}

export async function getCachedJson<T>(namespace: string, payload: unknown, options?: CacheOptions): Promise<T | null> {
  const key = await hashKey(`${namespace}:${JSON.stringify(payload)}`);

  if (!options?.skipRemote && redis) {
    try {
      const redisValue = await redis.get<string>(makeRedisKey(namespace, key));
      if (redisValue) {
        try {
          const parsed = JSON.parse(redisValue) as T;

          const edgeCache = getEdgeCache();
          if (edgeCache) {
            const response = Response.json(parsed, {
              headers: {
                "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=120`,
                "x-cache-namespace": namespace,
                "x-cache-source": "redis",
              },
            });
            await edgeCache.put(makeEdgeCacheKey(namespace, key), response);
          }

          return parsed;
        } catch {
          return null;
        }
      }
    } catch {
    }
  }

  const edgeCache = getEdgeCache();
  if (!edgeCache) return null;
  const cached = await edgeCache.match(makeEdgeCacheKey(namespace, key));
  if (!cached) return null;

  try {
    return (await cached.json()) as T;
  } catch {
    return null;
  }
}

export async function setCachedJson(namespace: string, payload: unknown, value: unknown, options?: CacheOptions): Promise<void> {
  const key = await hashKey(`${namespace}:${JSON.stringify(payload)}`);

  if (!options?.skipRemote && redis) {
    try {
      await redis.set(makeRedisKey(namespace, key), JSON.stringify(value), {
        ex: CACHE_TTL_SECONDS,
      });
    } catch {
    }
  }

  const edgeCache = getEdgeCache();
  if (!edgeCache) return;

  const cacheKey = makeEdgeCacheKey(namespace, key);
  const response = Response.json(value, {
    headers: {
      "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=120`,
      "x-cache-namespace": namespace,
    },
  });

  await edgeCache.put(cacheKey, response);
}
