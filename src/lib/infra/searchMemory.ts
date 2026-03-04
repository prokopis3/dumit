import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type {
  ModelProvider,
  ProviderUsageSummary,
  ProviderRunSummary,
  RankedDomainResult,
  SearchConstraints,
  SearchExecutionMode,
  SearchIntent,
  SearchMemorySnapshot,
} from "@/lib/types";
import { inferRelevantTlds } from "@/lib/utils";

interface SearchSessionRow {
  id: string;
  user_id: string | null;
  guest_key: string | null;
  topic_id: string | null;
  prompt_id: string | null;
  prompt: string;
  intent: unknown;
  constraints: unknown;
  provider_order: unknown;
  execution_mode: string;
  provider_usage: unknown;
  status_steps: unknown;
  candidates: unknown;
  results: unknown;
  response_time_ms: number | null;
  created_at: string;
  updated_at: string;
}

interface SaveSearchMemoryInput {
  userId: string;
  accessToken?: string;
  prompt: string;
  responseTimeMs?: number;
  intent?: SearchIntent;
  constraints: SearchConstraints;
  providerOrder?: ModelProvider[];
  executionMode?: SearchExecutionMode;
  topicId?: string;
  promptId?: string;
  providerUsage?: ProviderUsageSummary;
  statusSteps?: string[];
  candidates?: string[];
  results?: RankedDomainResult[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_REGEX.test(value);

const nowIso = (): string => new Date().toISOString();

const localSnapshots = new Map<string, SearchMemorySnapshot>();

const getClient = (accessToken?: string): SupabaseClient | null => {
  if (!env.supabaseUrl || !(env.supabaseServiceRoleKey || env.supabaseAnonKey)) return null;
  const key = env.supabaseServiceRoleKey ?? env.supabaseAnonKey;
  if (!key) return null;

  return createClient(
    env.supabaseUrl,
    key,
    accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : undefined,
  );
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const normalizeProviderOrder = (value: unknown): ModelProvider[] => {
  const normalized = normalizeStringArray(value).filter(
    (provider): provider is ModelProvider =>
      provider === "groq"
      || provider === "grok"
      || provider === "gemini"
      || provider === "openai"
      || provider === "huggingface",
  );

  return [...new Set(normalized)];
};

const normalizeExecutionMode = (value: unknown): SearchExecutionMode => {
  if (value === "balanced" || value === "quality") return value;
  return "speed";
};

const isModelProvider = (value: unknown): value is ModelProvider =>
  value === "groq"
  || value === "grok"
  || value === "gemini"
  || value === "openai"
  || value === "huggingface";

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseSearchConstraints = (value: unknown): SearchConstraints => {
  const raw = asObject(value);
  const tlds = Array.isArray(raw.tlds)
    ? raw.tlds.filter((item): item is string => typeof item === "string")
    : [];

  return {
    minLength: asNumber(raw.minLength, 4),
    maxLength: asNumber(raw.maxLength, 12),
    count: asNumber(raw.count, 12),
    tlds: inferRelevantTlds({ preferred: tlds }),
  };
};

const parseProviderRunSummary = (value: unknown): ProviderRunSummary | null => {
  const raw = asObject(value);
  const status = raw.status === "success" || raw.status === "failed" ? raw.status : null;

  if (!isModelProvider(raw.provider) || !status || typeof raw.model !== "string") {
    return null;
  }

  return {
    provider: raw.provider,
    model: raw.model,
    status,
    estimatedCostUsd: asNumber(raw.estimatedCostUsd, 0),
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
};

const parseProviderUsageSummary = (value: unknown): ProviderUsageSummary | undefined => {
  const raw = asObject(value);
  if (!isModelProvider(raw.providerUsed)) return undefined;

  const providersTried = Array.isArray(raw.providersTried)
    ? raw.providersTried
        .map(parseProviderRunSummary)
        .filter((item): item is ProviderRunSummary => Boolean(item))
    : [];

  return {
    providerUsed: raw.providerUsed,
    executionMode: normalizeExecutionMode(raw.executionMode),
    modelsSelectedCount: asNumber(raw.modelsSelectedCount, providersTried.length),
    modelsExecutedCount: asNumber(raw.modelsExecutedCount, providersTried.length),
    modelsSucceededCount: asNumber(
      raw.modelsSucceededCount,
      providersTried.filter((run) => run.status === "success").length,
    ),
    providersTried,
    totalEstimatedCostUsd: asNumber(raw.totalEstimatedCostUsd, 0),
  };
};

const deserializeRow = (row: SearchSessionRow): SearchMemorySnapshot => ({
  id: row.id,
  userId: row.user_id ?? undefined,
  guestKey: row.guest_key ?? undefined,
  topicId: row.topic_id ?? undefined,
  promptId: row.prompt_id ?? undefined,
  prompt: row.prompt,
  responseTimeMs: typeof row.response_time_ms === "number" ? row.response_time_ms : undefined,
  intent: asObject(row.intent) as SearchIntent,
  constraints: parseSearchConstraints(row.constraints),
  providerOrder: normalizeProviderOrder(row.provider_order),
  executionMode: normalizeExecutionMode(row.execution_mode),
  providerUsage: parseProviderUsageSummary(row.provider_usage),
  statusSteps: normalizeStringArray(row.status_steps),
  candidates: normalizeStringArray(row.candidates),
  results: (Array.isArray(row.results) ? row.results : []) as RankedDomainResult[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildSnapshot = (input: SaveSearchMemoryInput): SearchMemorySnapshot => {
  const guestKey = input.userId.startsWith("guest:") ? input.userId : undefined;

  return {
    id: crypto.randomUUID(),
    userId: isUuid(input.userId) ? input.userId : undefined,
    guestKey,
    topicId: input.topicId,
    promptId: input.promptId,
    prompt: input.prompt,
    responseTimeMs: typeof input.responseTimeMs === "number" ? input.responseTimeMs : undefined,
    intent: input.intent,
    constraints: input.constraints,
    providerOrder: input.providerOrder,
    executionMode: normalizeExecutionMode(input.executionMode),
    providerUsage: input.providerUsage,
    statusSteps: input.statusSteps ?? [],
    candidates: input.candidates ?? [],
    results: input.results ?? [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
};

export async function saveSearchMemory(input: SaveSearchMemoryInput): Promise<void> {
  const snapshot = buildSnapshot(input);
  localSnapshots.set(input.userId, snapshot);

  const client = getClient(input.accessToken);
  if (!client) return;

  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  try {
    await client.from("search_sessions").insert({
      id: snapshot.id,
      user_id: userId,
      guest_key: guestKey,
      topic_id: snapshot.topicId ?? null,
      prompt_id: snapshot.promptId ?? null,
      prompt: snapshot.prompt,
      response_time_ms: snapshot.responseTimeMs ?? 0,
      intent: snapshot.intent ?? {},
      constraints: snapshot.constraints,
      provider_order: snapshot.providerOrder ?? [],
      execution_mode: snapshot.executionMode,
      provider_usage: snapshot.providerUsage ?? {},
      status_steps: snapshot.statusSteps,
      candidates: snapshot.candidates,
      results: snapshot.results,
    });
  } catch {
    // fallback to local in-memory only
  }
}

export async function getLatestSearchMemory(input: {
  userId: string;
  accessToken?: string;
}): Promise<SearchMemorySnapshot | null> {
  const local = localSnapshots.get(input.userId);
  const client = getClient(input.accessToken);

  if (!client) return local ?? null;

  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  try {
    let query = client
      .from("search_sessions")
      .select(
        "id,user_id,guest_key,topic_id,prompt_id,prompt,intent,constraints,provider_order,execution_mode,provider_usage,status_steps,candidates,results,response_time_ms,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(1);

    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { data, error } = await query.maybeSingle<SearchSessionRow>();
    if (error || !data) return local ?? null;

    const snapshot = deserializeRow(data);
    localSnapshots.set(input.userId, snapshot);
    return snapshot;
  } catch {
    return local ?? null;
  }
}

export async function clearLatestSearchMemory(input: {
  userId: string;
  accessToken?: string;
}): Promise<void> {
  localSnapshots.delete(input.userId);

  const client = getClient(input.accessToken);
  if (!client) return;

  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  try {
    let query = client
      .from("search_sessions")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);

    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { data, error } = await query.maybeSingle<{ id: string }>();
    if (error || !data?.id) return;

    await client.from("search_sessions").delete().eq("id", data.id);
  } catch {
    // best effort only
  }
}

export async function listRecentSearchMemories(input: {
  userId: string;
  accessToken?: string;
  limit?: number;
}): Promise<SearchMemorySnapshot[]> {
  const snapshots: SearchMemorySnapshot[] = [];
  const client = getClient(input.accessToken);
  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 10);

  const local = localSnapshots.get(input.userId);
  if (local) {
    snapshots.push(local);
  }

  if (!client) {
    return snapshots.slice(0, limit);
  }

  try {
    let query = client
      .from("search_sessions")
      .select(
        "id,user_id,guest_key,topic_id,prompt_id,prompt,intent,constraints,provider_order,execution_mode,provider_usage,status_steps,candidates,results,response_time_ms,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { data, error } = await query.returns<SearchSessionRow[]>();
    if (error || !data) return snapshots.slice(0, limit);

    const seen = new Set<string>();
    for (const current of snapshots) {
      seen.add(current.id);
    }

    for (const row of data) {
      if (seen.has(row.id)) continue;
      const snapshot = deserializeRow(row);
      snapshots.push(snapshot);
      seen.add(snapshot.id);
      if (snapshots.length >= limit) break;
    }

    return snapshots.slice(0, limit);
  } catch {
    return snapshots.slice(0, limit);
  }
}

export async function deleteSearchMemoryById(input: {
  userId: string;
  accessToken?: string;
  memoryId: string;
}): Promise<boolean> {
  const local = localSnapshots.get(input.userId);
  if (local?.id === input.memoryId) {
    localSnapshots.delete(input.userId);
  }

  const client = getClient(input.accessToken);
  if (!client) return true;

  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  try {
    let query = client.from("search_sessions").delete().eq("id", input.memoryId);
    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { error } = await query;
    return !error;
  } catch {
    return false;
  }
}

export async function listSearchMemoriesByTopic(input: {
  userId: string;
  accessToken?: string;
  topicId: string;
  limit?: number;
}): Promise<Record<string, SearchMemorySnapshot>> {
  const snapshots: Record<string, SearchMemorySnapshot> = {};
  const client = getClient(input.accessToken);
  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  const upsertByPrompt = (snapshot: SearchMemorySnapshot) => {
    if (!snapshot.promptId) return;
    if (!snapshots[snapshot.promptId]) {
      snapshots[snapshot.promptId] = snapshot;
    }
  };

  const local = localSnapshots.get(input.userId);
  if (local && local.topicId === input.topicId) {
    upsertByPrompt(local);
  }

  if (!client) return snapshots;

  try {
    let query = client
      .from("search_sessions")
      .select(
        "id,user_id,guest_key,topic_id,prompt_id,prompt,intent,constraints,provider_order,execution_mode,provider_usage,status_steps,candidates,results,response_time_ms,created_at,updated_at",
      )
      .eq("topic_id", input.topicId)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 30);

    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { data, error } = await query.returns<SearchSessionRow[]>();
    if (error || !data) return snapshots;

    for (const row of data) {
      upsertByPrompt(deserializeRow(row));
    }

    return snapshots;
  } catch {
    return snapshots;
  }
}

export async function listLatestSearchMemoriesByTopics(input: {
  userId: string;
  accessToken?: string;
  topicIds: string[];
}): Promise<Record<string, SearchMemorySnapshot>> {
  const result: Record<string, SearchMemorySnapshot> = {};
  const normalizedTopicIds = [...new Set(input.topicIds.filter((topicId) => topicId.trim().length > 0))];
  if (normalizedTopicIds.length === 0) return result;

  const userId = isUuid(input.userId) ? input.userId : null;
  const guestKey = userId ? null : input.userId;

  for (const localSnapshot of localSnapshots.values()) {
    if (!localSnapshot.topicId) continue;
    if (!normalizedTopicIds.includes(localSnapshot.topicId)) continue;
    if (result[localSnapshot.topicId]) continue;
    if (userId && localSnapshot.userId !== userId) continue;
    if (!userId && localSnapshot.guestKey !== guestKey) continue;
    result[localSnapshot.topicId] = localSnapshot;
  }

  const client = getClient(input.accessToken);
  if (!client) return result;

  try {
    let query = client
      .from("search_sessions")
      .select(
        "id,user_id,guest_key,topic_id,prompt_id,prompt,intent,constraints,provider_order,execution_mode,provider_usage,status_steps,candidates,results,response_time_ms,created_at,updated_at",
      )
      .in("topic_id", normalizedTopicIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(normalizedTopicIds.length * 4, normalizedTopicIds.length));

    query = userId ? query.eq("user_id", userId) : query.eq("guest_key", guestKey);

    const { data, error } = await query.returns<SearchSessionRow[]>();
    if (error || !data) return result;

    for (const row of data) {
      if (!row.topic_id) continue;
      if (result[row.topic_id]) continue;
      result[row.topic_id] = deserializeRow(row);
      if (Object.keys(result).length >= normalizedTopicIds.length) break;
    }

    return result;
  } catch {
    return result;
  }
}
