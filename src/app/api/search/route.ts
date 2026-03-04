import { NextResponse } from "next/server";
import { checkDomainAvailability } from "@/lib/domain/check";
import { getCachedJson, setCachedJson } from "@/lib/infra/cache";
import { enforceRateLimit } from "@/lib/infra/rateLimit";
import { isValidDomain, normalizeDomain, unique } from "@/lib/utils";

export const runtime = "edge";

const SEARCH_CHECK_CONCURRENCY = 6;

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    const limit = await enforceRateLimit(`search:${ip}`);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const { domains } = (await req.json()) as { domains?: string[] };

    if (!Array.isArray(domains)) {
      return NextResponse.json({ error: "Invalid domains list" }, { status: 400 });
    }

    const cleaned = unique(domains.map(normalizeDomain).filter(isValidDomain)).slice(0, 30);

    const results = await mapWithConcurrency(cleaned, SEARCH_CHECK_CONCURRENCY, async (domain) => {
        const cacheHit = await getCachedJson<{ available: boolean }>("availability", { domain }, { skipRemote: true });
        if (cacheHit) {
          return {
            domain,
            available: cacheHit.available,
            source: "cache",
          };
        }

        const checked = await checkDomainAvailability(domain);
        await setCachedJson("availability", { domain }, { available: checked.available }, { skipRemote: true });

        return checked;
      });

    return NextResponse.json({ results, remaining: limit.remaining });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to search domains",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
