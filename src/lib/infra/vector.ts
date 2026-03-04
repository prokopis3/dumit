import { env } from "@/lib/env";
import type { RankedDomainResult, SearchIntent } from "@/lib/types";
import { lexicalPromptScore } from "@/lib/utils";

const LOCAL_EMBED_DIM = 256;
let milvusVectorDimCache: number | null | undefined;

interface MilvusDomainMatch {
  domain: string;
  score: number;
  available?: boolean;
}

function buildSearchContext(prompt: string, intent: SearchIntent | undefined): string {
  if (!intent) return prompt;

  const segments = [prompt];
  if (intent.brandTone) segments.push(`tone: ${intent.brandTone}`);
  if (intent.audience) segments.push(`audience: ${intent.audience}`);
  if (intent.industry) segments.push(`industry: ${intent.industry}`);
  if (intent.styleKeywords?.length) segments.push(`style: ${intent.styleKeywords.join(", ")}`);
  if (intent.mustIncludeWords?.length) segments.push(`include: ${intent.mustIncludeWords.join(", ")}`);
  if (intent.forbiddenWords?.length) segments.push(`avoid: ${intent.forbiddenWords.join(", ")}`);
  if (intent.language) segments.push(`language: ${intent.language}`);
  if (intent.country) segments.push(`country: ${intent.country}`);

  return segments.join(" | ");
}

function escapeMilvusString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
}

function domainFilter(domains: string[]): string {
  return `domain in [${domains.map((domain) => `\"${escapeMilvusString(domain)}\"`).join(",")}]`;
}

function scopedFilter(baseFilter: string, userId?: string): string {
  if (!userId?.trim()) return baseFilter;
  return `user_ref == \"${escapeMilvusString(userId)}\" and ${baseFilter}`;
}

function userOnlyFilter(userId: string): string {
  return `user_ref == \"${escapeMilvusString(userId)}\"`;
}

function normalizeScore(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(2, value));
}

function blendScores(input: {
  lexical: number;
  vector?: number;
  scalar?: number;
}): number {
  const lexical = normalizeScore(input.lexical);
  const vector = typeof input.vector === "number" ? normalizeScore(input.vector) : undefined;
  const scalar = typeof input.scalar === "number" ? normalizeScore(input.scalar) : undefined;

  if (typeof vector === "number" && typeof scalar === "number") {
    return normalizeScore(vector * 0.65 + scalar * 0.2 + lexical * 0.15);
  }

  if (typeof vector === "number") {
    return normalizeScore(vector * 0.8 + lexical * 0.2);
  }

  if (typeof scalar === "number") {
    return normalizeScore(scalar * 0.7 + lexical * 0.3);
  }

  return lexical;
}

function toSimilarityFromDistance(distance: number): number {
  if (Number.isNaN(distance) || !Number.isFinite(distance)) return 0;
  if (distance <= 1 && distance >= -1) {
    return normalizeScore((distance + 1) / 2);
  }
  return normalizeScore(1 / (1 + Math.abs(distance)));
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((total, value) => total + value * value, 0));
  if (!norm) return values;
  return values.map((value) => value / norm);
}

function compressVectorByBuckets(values: number[], targetDim: number): number[] {
  const buckets = new Array<number>(targetDim).fill(0);
  const counts = new Array<number>(targetDim).fill(0);

  for (let index = 0; index < values.length; index += 1) {
    const bucket = index % targetDim;
    buckets[bucket] += values[index] ?? 0;
    counts[bucket] += 1;
  }

  for (let index = 0; index < targetDim; index += 1) {
    const count = counts[index] || 1;
    buckets[index] = buckets[index] / count;
  }

  return l2Normalize(buckets);
}

function alignVectorDimension(values: number[], targetDim: number): number[] {
  if (!Number.isFinite(targetDim) || targetDim <= 0) return values;
  if (values.length === targetDim) return values;

  if (values.length > targetDim) {
    return compressVectorByBuckets(values, targetDim);
  }

  const padded = [...values, ...new Array<number>(targetDim - values.length).fill(0)];
  return l2Normalize(padded);
}

async function resolveMilvusVectorDimension(): Promise<number | undefined> {
  if (typeof milvusVectorDimCache !== "undefined") {
    return milvusVectorDimCache ?? undefined;
  }

  if (env.milvusVectorDim) {
    milvusVectorDimCache = env.milvusVectorDim;
    return milvusVectorDimCache;
  }

  if (!env.milvusEndpoint || !env.milvusToken) {
    milvusVectorDimCache = null;
    return undefined;
  }

  try {
    const response = await fetch(`${env.milvusEndpoint.replace(/\/$/, "")}/v2/vectordb/collections/describe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.milvusToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionName: env.milvusCollection,
      }),
    });

    if (!response.ok) {
      milvusVectorDimCache = null;
      return undefined;
    }

    const payload = (await response.json()) as {
      data?: {
        fields?: Array<{
          name?: string;
          params?: { dim?: number | string };
          typeParams?: { dim?: number | string };
          elementTypeParams?: { dim?: number | string };
          fieldType?: string;
          type?: string;
        }>;
        schema?: {
          fields?: Array<{
            name?: string;
            params?: { dim?: number | string };
            typeParams?: { dim?: number | string };
            elementTypeParams?: { dim?: number | string };
            fieldType?: string;
            type?: string;
          }>;
        };
      };
    };

    const fields = payload.data?.fields ?? payload.data?.schema?.fields ?? [];
    const vectorField = fields.find((field) => field.name === env.milvusVectorField);
    const dimCandidate = vectorField?.params?.dim
      ?? vectorField?.typeParams?.dim
      ?? vectorField?.elementTypeParams?.dim;
    const parsedDim = typeof dimCandidate === "string"
      ? Number.parseInt(dimCandidate, 10)
      : Number(dimCandidate ?? 0);

    if (Number.isFinite(parsedDim) && parsedDim > 0) {
      milvusVectorDimCache = parsedDim;
      return parsedDim;
    }

    milvusVectorDimCache = null;
    return undefined;
  } catch {
    milvusVectorDimCache = null;
    return undefined;
  }
}

async function embedForMilvus(text: string): Promise<number[] | null> {
  const vector = await embedText(text);
  if (!vector) return null;

  const targetDim = await resolveMilvusVectorDimension();
  if (!targetDim) return vector;
  return alignVectorDimension(vector, targetDim);
}

function hashFragment(fragment: string): number {
  let hash = 2166136261;
  for (let index = 0; index < fragment.length; index += 1) {
    hash ^= fragment.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildCharTrigrams(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return [];

  const padded = ` ${normalized} `;
  const trigrams: string[] = [];
  for (let index = 0; index < padded.length - 2; index += 1) {
    trigrams.push(padded.slice(index, index + 3));
  }
  return trigrams;
}

function embedLocally(text: string): number[] {
  const vector = new Array<number>(LOCAL_EMBED_DIM).fill(0);
  const fragments = buildCharTrigrams(text);

  if (fragments.length === 0) return vector;

  for (const fragment of fragments) {
    const hash = hashFragment(fragment);
    const index = hash % LOCAL_EMBED_DIM;
    vector[index] += 1;
  }

  return l2Normalize(vector);
}

async function embedWithGemini(text: string): Promise<number[] | null> {
  if (!env.geminiApiKey) return null;

  try {
    const model = env.geminiEmbeddingModel;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(env.geminiApiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    return Array.isArray(values) && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

async function embedWithOpenAi(text: string): Promise<number[] | null> {
  if (!env.openAiApiKey) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openAiEmbeddingModel,
        input: text,
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const values = payload.data?.[0]?.embedding;
    return Array.isArray(values) && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

async function embedText(text: string): Promise<number[] | null> {
  const geminiVector = await embedWithGemini(text);
  if (geminiVector) return geminiVector;

  const openAiVector = await embedWithOpenAi(text);
  if (openAiVector) return openAiVector;

  return embedLocally(text);
}

export async function indexSearchResultsInMilvus(input: {
  prompt: string;
  intent?: SearchIntent;
  results: RankedDomainResult[];
  topicId?: string;
  promptId?: string;
  userId: string;
}): Promise<void> {
  if (!env.milvusEndpoint || !env.milvusToken) return;
  if (input.results.length === 0) return;

  const context = buildSearchContext(input.prompt, input.intent);
  const vector = await embedForMilvus(context);
  if (!vector) return;

  const now = new Date().toISOString();
  const rows = input.results
    .slice(0, 16)
    .map((result) => ({
      domain: result.domain,
      semantic_score: result.score,
      [env.milvusVectorField]: vector,
      prompt_id: input.promptId ?? null,
      topic_id: input.topicId ?? null,
      user_ref: input.userId,
      available: result.available,
      source: result.source,
      indexed_at: now,
    }));

  try {
    const response = await fetch(`${env.milvusEndpoint.replace(/\/$/, "")}/v2/vectordb/entities/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.milvusToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionName: env.milvusCollection,
        data: rows,
      }),
    });

    if (!response.ok) {
      console.warn("Milvus upsert failed", {
        status: response.status,
        collection: env.milvusCollection,
        vectorField: env.milvusVectorField,
        vectorDim: vector.length,
      });
    }
  } catch {
    // Best-effort write-back for retrieval quality improvements.
  }
}

function parseMilvusMatches(payload: { data?: unknown }): MilvusDomainMatch[] {
  const flattened = Array.isArray(payload.data)
    ? payload.data.flatMap((item) => (Array.isArray(item) ? item : [item]))
    : [];

  const matches: MilvusDomainMatch[] = [];
  for (const rawItem of flattened) {
    const item = rawItem as {
      domain?: string;
      distance?: number;
      score?: number;
      available?: boolean;
      entity?: {
        domain?: string;
        available?: boolean;
      };
    };

    const domain = item.domain ?? item.entity?.domain;
    if (!domain) continue;

    const rawScore = Number(item.score ?? Number.NaN);
    const score = !Number.isNaN(rawScore)
      ? normalizeScore(rawScore)
      : toSimilarityFromDistance(Number(item.distance ?? 0));
    matches.push({
      domain,
      score,
      available: typeof item.available === "boolean"
        ? item.available
        : (typeof item.entity?.available === "boolean" ? item.entity.available : undefined),
    });
  }

  return matches;
}

async function rankWithMilvusVector(promptContext: string, domains: string[], userId?: string): Promise<Record<string, number> | null> {
  if (!env.milvusEndpoint || !env.milvusToken) return null;

  const vector = await embedForMilvus(promptContext);
  if (!vector) return null;

  try {
    const response = await fetch(`${env.milvusEndpoint.replace(/\/$/, "")}/v2/vectordb/entities/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.milvusToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionName: env.milvusCollection,
        data: [vector],
        annsField: env.milvusVectorField,
        filter: scopedFilter(domainFilter(domains), userId),
        outputFields: ["domain"],
        limit: Math.max(1, domains.length),
        searchParams: {
          metricType: "COSINE",
          params: { ef: 64 },
        },
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: unknown;
    };

    const scores: Record<string, number> = {};
    for (const item of parseMilvusMatches(payload)) {
      scores[item.domain] = item.score;
    }

    if (Object.keys(scores).length === 0) return null;
    return scores;
  } catch {
    return null;
  }
}

async function rankWithMilvusScalar(domains: string[], userId?: string): Promise<Record<string, number> | null> {
  if (!env.milvusEndpoint || !env.milvusToken) return null;

  try {
    const response = await fetch(`${env.milvusEndpoint.replace(/\/$/, "")}/v2/vectordb/entities/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.milvusToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionName: env.milvusCollection,
        filter: scopedFilter(domainFilter(domains), userId),
        outputFields: ["domain", "semantic_score"],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      data?: Array<{ domain?: string; semantic_score?: number }>;
    };

    const scores: Record<string, number> = {};
    for (const item of payload.data ?? []) {
      if (item.domain) {
        scores[item.domain] = normalizeScore(Number(item.semantic_score ?? 0));
      }
    }

    if (Object.keys(scores).length === 0) return null;
    return scores;
  } catch {
    return null;
  }
}

export async function searchMemoryDomainsByPrompt(input: {
  prompt: string;
  intent?: SearchIntent;
  userId: string;
  limit?: number;
  onlyAvailable?: boolean;
}): Promise<string[]> {
  if (!env.milvusEndpoint || !env.milvusToken) return [];

  const promptContext = buildSearchContext(input.prompt, input.intent);
  const vector = await embedForMilvus(promptContext);
  if (!vector) return [];

  const outputFields = ["domain", "available", "indexed_at"];
  const filters = [userOnlyFilter(input.userId)];
  if (input.onlyAvailable) {
    filters.push("available == true");
  }

  try {
    const response = await fetch(`${env.milvusEndpoint.replace(/\/$/, "")}/v2/vectordb/entities/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.milvusToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collectionName: env.milvusCollection,
        data: [vector],
        annsField: env.milvusVectorField,
        filter: filters.join(" and "),
        outputFields,
        limit: Math.max(1, Math.min(input.limit ?? 24, 64)),
        searchParams: {
          metricType: "COSINE",
          params: { ef: 96 },
        },
      }),
    });

    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: unknown };
    const matches = parseMilvusMatches(payload);

    if (matches.length === 0) return [];

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const match of matches.sort((a, b) => b.score - a.score)) {
      if (seen.has(match.domain)) continue;
      seen.add(match.domain);
      ordered.push(match.domain);
      if (ordered.length >= (input.limit ?? 24)) break;
    }

    return ordered;
  } catch {
    return [];
  }
}

export async function rankDomainsByPrompt(
  prompt: string,
  domains: string[],
  intent?: SearchIntent,
  userId?: string,
): Promise<Record<string, number>> {
  const promptContext = buildSearchContext(prompt, intent);
  const [milvusVectorScores, milvusScalarScores] = await Promise.all([
    rankWithMilvusVector(promptContext, domains, userId),
    rankWithMilvusScalar(domains, userId),
  ]);

  return domains.reduce<Record<string, number>>((scores, domain) => {
    const lexical = lexicalPromptScore(promptContext, domain);
    scores[domain] = blendScores({
      lexical,
      vector: milvusVectorScores?.[domain],
      scalar: milvusScalarScores?.[domain],
    });
    return scores;
  }, {});
}
