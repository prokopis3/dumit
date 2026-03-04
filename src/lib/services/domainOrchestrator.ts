import { generateSuggestions } from "@/lib/ai/providers";
import { checkDomainAvailability } from "@/lib/domain/check";
import { getCachedJson, setCachedJson } from "@/lib/infra/cache";
import { createOrAppendPrompt } from "@/lib/infra/history";
import { saveSearchMemory } from "@/lib/infra/searchMemory";
import {
  indexSearchResultsInMilvus,
  rankDomainsByPrompt,
  searchMemoryDomainsByPrompt,
} from "@/lib/infra/vector";
import type {
  ProviderUsageSummary,
  RankedDomainResult,
  SearchExecutionMode,
  SearchIntent,
  SearchSessionInput,
  SearchSessionResult,
  SuggestRequest,
} from "@/lib/types";
import { isDomainWithinConstraints, lexicalPromptScore, normalizeDomain, sanitizeConstraints, sanitizeIntent, unique } from "@/lib/utils";

function cleanLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fitLabelToConstraints(label: string, minLength: number, maxLength: number): string | null {
  let normalized = cleanLabel(label);
  if (!normalized) return null;

  if (normalized.length > maxLength) {
    normalized = normalized.slice(0, maxLength);
  }

  if (normalized.length < minLength) {
    const padding = "x".repeat(minLength - normalized.length);
    normalized = `${normalized}${padding}`;
  }

  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function ensureAllowedTld(domainLike: string, tlds: string[]): string[] {
  const normalized = normalizeDomain(domainLike);
  if (!normalized) return [];

  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) {
    return tlds.map((tld) => `${cleanLabel(normalized)}${tld}`);
  }

  const label = cleanLabel(normalized.slice(0, dotIndex));
  const tld = normalized.slice(dotIndex);
  if (!label) return [];

  if (tlds.includes(tld)) {
    return [`${label}${tld}`];
  }

  return [`${label}${tlds[0]}`];
}

function extractSeedWords(prompt: string, intent: SearchIntent | undefined): string[] {
  const promptTokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && token.length <= 18);

  const includeTokens = intent?.mustIncludeWords ?? [];
  const styleTokens = intent?.styleKeywords ?? [];
  const audienceTokens = intent?.audience
    ? intent.audience.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && token.length <= 18)
    : [];

  return unique([...includeTokens, ...promptTokens, ...styleTokens, ...audienceTokens]).slice(0, 20);
}

function buildConstraintAwareFallbackCandidates(input: {
  prompt: string;
  constraints: { minLength: number; maxLength: number; tlds: string[]; count: number };
  intent: SearchIntent | undefined;
}): string[] {
  const { constraints, prompt, intent } = input;
  const seeds = extractSeedWords(prompt, intent);
  const output: string[] = [];

  const pushLabelAcrossTlds = (label: string) => {
    const fitted = fitLabelToConstraints(label, constraints.minLength, constraints.maxLength);
    if (!fitted) return;
    for (const tld of constraints.tlds) {
      output.push(`${fitted}${tld}`);
    }
  };

  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const nextSeed = seeds[index + 1];

    pushLabelAcrossTlds(seed);
    pushLabelAcrossTlds(seed.slice(0, Math.max(3, Math.floor(constraints.maxLength * 0.6))));

    if (nextSeed) {
      pushLabelAcrossTlds(`${seed}${nextSeed}`);
      pushLabelAcrossTlds(`${seed.slice(0, 4)}${nextSeed.slice(0, 4)}`);
    }
  }

  const acronym = seeds
    .map((seed) => seed[0])
    .join("")
    .slice(0, constraints.maxLength);
  if (acronym.length >= Math.min(3, constraints.minLength)) {
    pushLabelAcrossTlds(acronym);
  }

  if (output.length === 0) {
    const base = cleanLabel(prompt).slice(0, Math.max(constraints.minLength, 3));
    pushLabelAcrossTlds(base || "brand");
  }

  return unique(output)
    .filter((candidate) => isDomainWithinConstraints(candidate, constraints))
    .slice(0, Math.max(constraints.count * 3, constraints.count));
}

function reasonFor(domain: string, score: number, available: boolean): string {
  if (!available) return `${domain} is registered; keep as inspiration.`;
  if (score > 1.1) return "Strong semantic match with your prompt and high brand fit.";
  if (score > 0.6) return "Good relevance and compact naming style.";
  return "Available option with moderate relevance.";
}

const AVAILABILITY_CHECK_CONCURRENCY = 4;

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

async function checkMany(
  domains: string[],
  options?: { allowRdapFallback?: boolean },
): Promise<Array<{ domain: string; available: boolean; source: "dns" | "rdap" | "cache" }>> {
  return mapWithConcurrency(domains, AVAILABILITY_CHECK_CONCURRENCY, async (domain) => {
    const cacheHit = await getCachedJson<{ available: boolean }>("availability", { domain }, { skipRemote: true });
    if (cacheHit) {
      return { domain, available: cacheHit.available, source: "cache" as const };
    }

    const result = await checkDomainAvailability(domain, {
      allowRdapFallback: options?.allowRdapFallback,
    });
    await setCachedJson("availability", { domain }, { available: result.available }, { skipRemote: true });
    return result;
  });
}

async function scoreDomains(input: {
  prompt: string;
  domains: string[];
  intent: SearchIntent | undefined;
  userId: string;
  executionMode: SearchExecutionMode;
}): Promise<Record<string, number>> {
  if (input.executionMode === "speed") {
    const promptContext = [
      input.prompt,
      input.intent?.brandTone,
      input.intent?.audience,
      input.intent?.industry,
      input.intent?.language,
      input.intent?.country,
      input.intent?.styleKeywords?.join(" "),
      input.intent?.mustIncludeWords?.join(" "),
      input.intent?.forbiddenWords?.join(" "),
    ].filter(Boolean).join(" ");

    return input.domains.reduce<Record<string, number>>((scores, domain) => {
      scores[domain] = lexicalPromptScore(promptContext, domain);
      return scores;
    }, {});
  }

  return rankDomainsByPrompt(input.prompt, input.domains, input.intent, input.userId);
}

export type DomainSessionProgressEvent =
  | { type: "status"; statusSteps: string[] }
  | {
      type: "suggestions";
      candidates: string[];
      providerUsage: ProviderUsageSummary;
    }
  | {
      type: "ranked_partial";
      results: RankedDomainResult[];
      pendingDomains: string[];
      providerUsage: ProviderUsageSummary;
    }
  | {
      type: "ranked";
      results: RankedDomainResult[];
      providerUsage: ProviderUsageSummary;
    }
  | {
      type: "saved";
      topicId: string;
      promptId: string;
    };

export async function runDomainSession(
  input: SearchSessionInput,
  onProgress?: (event: DomainSessionProgressEvent) => void,
): Promise<SearchSessionResult> {
  const startedAt = Date.now();
  const constraints = sanitizeConstraints(input.constraints);
  const intent = sanitizeIntent(input.intent);
  const prompt = input.prompt.trim();

  const cached = await getCachedJson<SearchSessionResult>("session", {
    prompt,
    constraints,
    intent,
    providerOrder: input.providerOrder,
  });
  if (cached) {
    const cachedResponseTimeMs = typeof cached.responseTimeMs === "number"
      ? cached.responseTimeMs
      : Math.max(0, Date.now() - startedAt);
    await saveSearchMemory({
      userId: input.userId ?? "guest:local",
      accessToken: input.accessToken,
      topicId: cached.topicId,
      promptId: cached.promptId,
      prompt,
      responseTimeMs: cachedResponseTimeMs,
      intent,
      constraints,
      providerOrder: input.providerOrder,
      executionMode: cached.providerUsage.executionMode,
      providerUsage: cached.providerUsage,
      statusSteps: [...cached.statusSteps, "Loaded cached result"],
      candidates: cached.candidates,
      results: cached.results,
    });

    onProgress?.({ type: "status", statusSteps: [...cached.statusSteps, "Loaded cached result"] });
    onProgress?.({
      type: "ranked",
      results: cached.results,
      providerUsage: cached.providerUsage,
    });
    return {
      ...cached,
      responseTimeMs: cachedResponseTimeMs,
      statusSteps: [...cached.statusSteps, "Loaded cached result"],
    };
  }

  const statusSteps = [
    "Analyzing your prompt and intent...",
    "Generating suggested domains with selected AI models...",
    "Checking live availability in parallel (DNS + RDAP fallback)...",
    "Ranking suggestions by relevance and availability...",
    "Saving prompt and results to history...",
  ];

  onProgress?.({ type: "status", statusSteps });

  const suggestRequest: SuggestRequest = {
    prompt,
    providerOrder: input.providerOrder,
    executionMode: input.executionMode,
    constraints,
    intent,
    providerApiKeys: input.providerApiKeys,
  };

  const {
    suggestions,
    providerUsed,
    executionMode,
    modelsSelectedCount,
    modelsExecutedCount,
    modelsSucceededCount,
    providersTried,
    totalEstimatedCostUsd,
  } = await generateSuggestions(suggestRequest);

  const providerUsage: ProviderUsageSummary = {
    providerUsed,
    executionMode,
    modelsSelectedCount,
    modelsExecutedCount,
    modelsSucceededCount,
    providersTried,
    totalEstimatedCostUsd,
  };

  const runSummary = providersTried
    .map((provider) => {
      if (provider.status === "success") {
        return `${provider.provider} (${provider.model}) succeeded`;
      }
      return `${provider.provider} (${provider.model}) failed`;
    })
    .join(" • ");

  if (runSummary) {
    statusSteps.splice(
      2,
      0,
      `Model execution (${executionMode}, ${modelsExecutedCount}/${modelsSelectedCount} models): ${runSummary}`,
    );
    onProgress?.({ type: "status", statusSteps: [...statusSteps] });
  }

  const basePromptDomainRaw = prompt.includes(".") ? normalizeDomain(prompt) : `${normalizeDomain(prompt)}.${constraints.tlds[0]?.replace(/^\./, "") ?? "com"}`;
  const normalizedSuggestionDomains = suggestions.flatMap((item) => ensureAllowedTld(item, constraints.tlds));
  const basePromptCandidates = ensureAllowedTld(basePromptDomainRaw, constraints.tlds);
  const basePromptDomain = basePromptCandidates[0] ?? basePromptDomainRaw;

  let allCandidates = unique([
    ...basePromptCandidates,
    ...normalizedSuggestionDomains,
  ])
    .filter((domain) => isDomainWithinConstraints(domain, constraints))
    .slice(0, constraints.count);

  if (allCandidates.length < constraints.count) {
    const fallbackCandidates = buildConstraintAwareFallbackCandidates({
      prompt,
      constraints,
      intent,
    });

    allCandidates = unique([...allCandidates, ...fallbackCandidates])
      .filter((domain) => isDomainWithinConstraints(domain, constraints))
      .slice(0, constraints.count);

    if (fallbackCandidates.length > 0) {
      const fallbackStatus = `Applied constraint-aware fallback synthesis to recover ${Math.max(0, allCandidates.length - normalizedSuggestionDomains.length)} additional candidates.`;
      statusSteps.push(fallbackStatus);
      onProgress?.({ type: "status", statusSteps: [...statusSteps] });
    }
  }

  if (allCandidates.length < constraints.count) {
    const memoryCandidates = executionMode === "speed"
      ? []
      : await searchMemoryDomainsByPrompt({
          prompt,
          intent,
          userId: input.userId ?? "guest:local",
          limit: Math.max(constraints.count * 2, 8),
          onlyAvailable: true,
        });

    if (memoryCandidates.length > 0) {
      const before = allCandidates.length;
      allCandidates = unique([...allCandidates, ...memoryCandidates])
        .filter((domain) => isDomainWithinConstraints(domain, constraints))
        .slice(0, constraints.count);

      const added = Math.max(0, allCandidates.length - before);
      if (added > 0) {
        const memoryStatus = `Recovered ${added} candidates from semantic memory similar to your past searches.`;
        statusSteps.push(memoryStatus);
        onProgress?.({ type: "status", statusSteps: [...statusSteps] });
      }
    }
  }

  if (allCandidates.length === 0) {
    const noResultsMessage = `No domains matched current constraints (min ${constraints.minLength}, max ${constraints.maxLength}, count ${constraints.count}). Try wider length bounds or simpler include/exclude keywords.`;
    const statusWithNoResults = [...statusSteps, noResultsMessage];

    onProgress?.({ type: "status", statusSteps: statusWithNoResults });
    onProgress?.({
      type: "suggestions",
      candidates: [],
      providerUsage,
    });
    onProgress?.({
      type: "ranked",
      results: [],
      providerUsage,
    });

    const responseTimeMs = Math.max(0, Date.now() - startedAt);

    const { topicId, promptId } = await createOrAppendPrompt({
      userId: input.userId ?? "guest:local",
      accessToken: input.accessToken,
      topicId: input.topicId,
      prompt,
      responseTimeMs,
      results: [],
      replaceLatest: Boolean(input.topicId),
    });

    await saveSearchMemory({
      userId: input.userId ?? "guest:local",
      accessToken: input.accessToken,
      topicId,
      promptId,
      prompt,
      responseTimeMs,
      intent,
      constraints,
      providerOrder: input.providerOrder,
      executionMode,
      providerUsage,
      statusSteps: statusWithNoResults,
      candidates: [],
      results: [],
    });

    onProgress?.({ type: "saved", topicId, promptId });

    const result: SearchSessionResult = {
      topicId,
      promptId,
      prompt,
      responseTimeMs,
      statusSteps: statusWithNoResults,
      candidates: [],
      results: [],
      providerUsage: {
        ...providerUsage,
      },
    };

    await setCachedJson(
      "session",
      { prompt, constraints, intent, providerOrder: input.providerOrder },
      result,
    );

    return result;
  }

  onProgress?.({
    type: "suggestions",
    candidates: allCandidates,
    providerUsage,
  });

  const fastPassCount = Math.min(6, allCandidates.length);
  const fastPassDomains = allCandidates.slice(0, fastPassCount);
  const remainingDomains = allCandidates.slice(fastPassCount);

  const availabilityMap = new Map<string, { domain: string; available: boolean; source: "dns" | "rdap" | "cache" }>();
  const scoreMap: Record<string, number> = {};

  if (fastPassDomains.length > 0) {
    const fastAvailability = await checkMany(fastPassDomains, {
      allowRdapFallback: true,
    });
    const fastScores = await scoreDomains({
      prompt,
      domains: fastPassDomains,
      intent,
      userId: input.userId ?? "guest:local",
      executionMode,
    });

    for (const item of fastAvailability) {
      availabilityMap.set(item.domain, item);
    }
    for (const domain of fastPassDomains) {
      scoreMap[domain] = fastScores[domain] ?? 0;
    }

    const partialRanked = fastAvailability
      .map((item) => {
        const score = scoreMap[item.domain] ?? 0;
        return {
          ...item,
          score,
          reason: reasonFor(item.domain, score, item.available),
          isAI: item.domain !== basePromptDomain,
        };
      })
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return b.score - a.score;
      });

    onProgress?.({
      type: "ranked_partial",
      results: partialRanked,
      pendingDomains: remainingDomains,
      providerUsage,
    });
  }

  if (remainingDomains.length > 0) {
    const [remainingAvailability, remainingScores] = await Promise.all([
      checkMany(remainingDomains, {
        allowRdapFallback: executionMode !== "speed",
      }),
      scoreDomains({
        prompt,
        domains: remainingDomains,
        intent,
        userId: input.userId ?? "guest:local",
        executionMode,
      }),
    ]);

    for (const item of remainingAvailability) {
      availabilityMap.set(item.domain, item);
    }
    for (const domain of remainingDomains) {
      scoreMap[domain] = remainingScores[domain] ?? 0;
    }
  }

  const ranked: RankedDomainResult[] = allCandidates
    .map((domain) => {
      const availability = availabilityMap.get(domain) ?? { domain, available: false, source: "dns" as const };
      const score = scoreMap[domain] ?? 0;

      return {
        ...availability,
        score,
        reason: reasonFor(domain, score, availability.available),
        isAI: domain !== basePromptDomain,
      };
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return b.score - a.score;
    });

  onProgress?.({
    type: "ranked",
    results: ranked,
    providerUsage,
  });

  const responseTimeMs = Math.max(0, Date.now() - startedAt);

  const { topicId, promptId } = await createOrAppendPrompt({
    userId: input.userId ?? "guest:local",
    accessToken: input.accessToken,
    topicId: input.topicId,
    prompt,
    responseTimeMs,
    results: ranked,
    replaceLatest: Boolean(input.topicId),
  });

  await saveSearchMemory({
    userId: input.userId ?? "guest:local",
    accessToken: input.accessToken,
    topicId,
    promptId,
    prompt,
    responseTimeMs,
    intent,
    constraints,
    providerOrder: input.providerOrder,
    executionMode,
    providerUsage,
    statusSteps,
    candidates: allCandidates,
    results: ranked,
  });

  if (executionMode !== "speed") {
    void indexSearchResultsInMilvus({
      prompt,
      intent,
      results: ranked,
      topicId,
      promptId,
      userId: input.userId ?? "guest:local",
    });
  }

  onProgress?.({ type: "saved", topicId, promptId });

  const result: SearchSessionResult = {
    topicId,
    promptId,
    prompt,
    responseTimeMs,
    statusSteps,
    candidates: allCandidates,
    results: ranked,
    providerUsage: {
      ...providerUsage,
    },
  };

  await setCachedJson(
    "session",
    { prompt, constraints, intent, providerOrder: input.providerOrder },
    result,
  );

  return result;
}
