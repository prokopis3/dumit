import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { HistoryTopicDetails, HistoryTopicSummary, RankedDomainResult } from "@/lib/types";

interface PromptRecord {
  id: string;
  prompt: string;
  createdAt: string;
  responseTimeMs?: number;
  results: RankedDomainResult[];
  selected: string[];
}

interface TopicRecord {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  prompts: PromptRecord[];
}

interface TopicRow {
  id: string;
  user_id: string | null;
  payload: unknown;
  latest_prompt?: string | null;
  updated_at?: string;
}

const localStore = new Map<string, Map<string, TopicRecord>>();

const nowIso = () => new Date().toISOString();

const randomId = () => crypto.randomUUID();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID_REGEX.test(value);

const getClient = (accessToken?: string): SupabaseClient | null => {
  if (!env.supabaseUrl || !(env.supabaseServiceRoleKey || env.supabaseAnonKey)) return null;
  const key = env.supabaseServiceRoleKey ?? env.supabaseAnonKey;
  if (!key) return null;

  return createClient(env.supabaseUrl, key, accessToken
    ? {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
    : undefined);
};

const getLocalUserStore = (userId: string): Map<string, TopicRecord> => {
  const existing = localStore.get(userId);
  if (existing) return existing;
  const created = new Map<string, TopicRecord>();
  localStore.set(userId, created);
  return created;
};

const isPromptRecord = (value: unknown): value is PromptRecord => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PromptRecord>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.prompt === "string"
    && typeof candidate.createdAt === "string"
    && Array.isArray(candidate.results)
    && Array.isArray(candidate.selected)
  );
};

const deserializeTopicRecord = (row: TopicRow): TopicRecord | null => {
  if (!row.payload || typeof row.payload !== "object") return null;

  const payload = row.payload as Partial<TopicRecord>;
  const prompts = Array.isArray(payload.prompts)
    ? payload.prompts.filter(isPromptRecord)
    : [];

  const topic: TopicRecord = {
    id: row.id,
    userId:
      row.user_id
      ?? (typeof payload.userId === "string" ? payload.userId : ""),
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : nowIso(),
    updatedAt:
      typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : (typeof row.updated_at === "string" ? row.updated_at : nowIso()),
    prompts,
  };

  return topic;
};

async function reassignLegacyTopicOwner(input: {
  topicId: string;
  userId: string;
  accessToken?: string;
}): Promise<void> {
  if (!isUuid(input.userId)) return;

  const client = getClient(input.accessToken);
  if (!client) return;

  await client
    .from("domain_topics")
    .update({ user_id: input.userId, updated_at: nowIso() })
    .eq("id", input.topicId)
    .is("user_id", null);
}

async function loadTopicFromSupabase(topicId: string, userId: string, accessToken?: string): Promise<TopicRecord | null> {
  const client = getClient(accessToken);
  if (!client) return null;

  const { data, error } = await client
    .from("domain_topics")
    .select("id,user_id,payload,updated_at")
    .eq("id", topicId)
    .eq("user_id", userId)
    .maybeSingle<TopicRow>();

  if (!error && data) {
    const topic = deserializeTopicRecord(data);
    if (!topic) return null;
    getLocalUserStore(userId).set(topic.id, topic);
    return topic;
  }

  const { data: legacyData, error: legacyError } = await client
    .from("domain_topics")
    .select("id,user_id,payload,updated_at")
    .eq("id", topicId)
    .is("user_id", null)
    .filter("payload->>userId", "eq", userId)
    .maybeSingle<TopicRow>();

  if (legacyError || !legacyData) return null;

  await reassignLegacyTopicOwner({ topicId, userId, accessToken });

  const legacyTopic = deserializeTopicRecord({ ...legacyData, user_id: userId });
  if (!legacyTopic) return null;
  getLocalUserStore(userId).set(legacyTopic.id, legacyTopic);
  return legacyTopic;
}

async function loadAllTopicsFromSupabase(userId: string, accessToken?: string): Promise<TopicRecord[]> {
  const client = getClient(accessToken);
  if (!client) return [...getLocalUserStore(userId).values()];

  const { data, error } = await client
    .from("domain_topics")
    .select("id,user_id,payload,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<TopicRow[]>();

  if (error || !data) return [...getLocalUserStore(userId).values()];

  const { data: legacyData } = await client
    .from("domain_topics")
    .select("id,user_id,payload,updated_at")
    .is("user_id", null)
    .filter("payload->>userId", "eq", userId)
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<TopicRow[]>();

  const mergedRows = [...data, ...(legacyData ?? [])];
  const uniqueRows = [...new Map(mergedRows.map((row) => [row.id, row])).values()];

  const topics = uniqueRows
    .map(deserializeTopicRecord)
    .filter((topic): topic is TopicRecord => Boolean(topic));

  if (legacyData?.length) {
    await Promise.all(
      legacyData.map((row) =>
        reassignLegacyTopicOwner({ topicId: row.id, userId, accessToken })),
    );
  }

  for (const topic of topics) {
    getLocalUserStore(userId).set(topic.id, topic);
  }

  return topics;
}

async function loadTopicPageFromSupabase(input: {
  userId: string;
  accessToken?: string;
  page: number;
  pageSize: number;
  q?: string;
}): Promise<{ topics: TopicRecord[]; total: number } | null> {
  const client = getClient(input.accessToken);
  if (!client) return null;

  const safePage = Number.isFinite(input.page) && input.page > 0 ? input.page : 1;
  const safePageSize = Number.isFinite(input.pageSize)
    ? Math.min(Math.max(input.pageSize, 4), 24)
    : 8;
  const query = input.q?.trim().toLowerCase() ?? "";
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize - 1;

  let dbQuery = client
    .from("domain_topics")
    .select("id,user_id,payload,latest_prompt,updated_at", { count: "exact" })
    .eq("user_id", input.userId)
    .order("updated_at", { ascending: false })
    .range(start, end);

  if (query.length > 0) {
    dbQuery = dbQuery.ilike("latest_prompt", `%${query}%`);
  }

  const { data, error, count } = await dbQuery.returns<TopicRow[]>();

  if (error || !data) return null;

  const topics = data
    .map(deserializeTopicRecord)
    .filter((topic): topic is TopicRecord => Boolean(topic));

  for (const topic of topics) {
    getLocalUserStore(input.userId).set(topic.id, topic);
  }

  return {
    topics,
    total: typeof count === "number" ? count : topics.length,
  };
}

const asSummary = (topic: TopicRecord): HistoryTopicSummary => {
  const latest = topic.prompts[topic.prompts.length - 1];
  const selectedCount = topic.prompts.reduce((total, prompt) => total + prompt.selected.length, 0);

  return {
    id: topic.id,
    createdAt: topic.createdAt,
    updatedAt: topic.updatedAt,
    latestPrompt: latest?.prompt ?? "",
    selectedCount,
    latestResponseTimeMs: latest?.responseTimeMs,
  };
};

const asDetails = (topic: TopicRecord): HistoryTopicDetails => ({
  ...asSummary(topic),
  prompts: topic.prompts,
});

async function persistSupabase(topic: TopicRecord, accessToken?: string): Promise<void> {
  if (!isUuid(topic.userId)) return;

  const client = getClient(accessToken);
  if (!client) return;

  const latestPrompt = topic.prompts[topic.prompts.length - 1]?.prompt ?? "";

  await client.from("domain_topics").upsert({
    id: topic.id,
    user_id: topic.userId,
    payload: topic,
    latest_prompt: latestPrompt,
    updated_at: topic.updatedAt,
  });
}

export async function createOrAppendPrompt(input: {
  userId: string;
  accessToken?: string;
  topicId?: string;
  prompt: string;
  responseTimeMs?: number;
  results: RankedDomainResult[];
  replaceLatest?: boolean;
}): Promise<{ topicId: string; promptId: string }> {
  const userStore = getLocalUserStore(input.userId);
  let existingTopic: TopicRecord | null = null;
  if (input.topicId) {
    existingTopic = userStore.get(input.topicId)
      ?? await loadTopicFromSupabase(input.topicId, input.userId, input.accessToken);
  }

  const topicId = existingTopic?.id ?? randomId();
  const topic = existingTopic ?? {
    id: topicId,
    userId: input.userId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    prompts: [],
  };

  const shouldReplaceLatest = Boolean(input.replaceLatest && topic.prompts.length > 0);
  let promptId = randomId();

  if (shouldReplaceLatest) {
    const latestPrompt = topic.prompts[topic.prompts.length - 1];
    latestPrompt.prompt = input.prompt;
    latestPrompt.createdAt = nowIso();
    latestPrompt.responseTimeMs = typeof input.responseTimeMs === "number" ? input.responseTimeMs : undefined;
    latestPrompt.results = input.results;
    latestPrompt.selected = [];
    promptId = latestPrompt.id;
  } else {
    topic.prompts.push({
      id: promptId,
      prompt: input.prompt,
      createdAt: nowIso(),
      responseTimeMs: typeof input.responseTimeMs === "number" ? input.responseTimeMs : undefined,
      results: input.results,
      selected: [],
    });
  }

  topic.updatedAt = nowIso();
  userStore.set(topicId, topic);
  await persistSupabase(topic, input.accessToken);

  return { topicId, promptId };
}

export async function addSelection(input: {
  userId: string;
  accessToken?: string;
  topicId: string;
  promptId: string;
  domain: string;
}): Promise<boolean> {
  const topic = getLocalUserStore(input.userId).get(input.topicId)
    ?? await loadTopicFromSupabase(input.topicId, input.userId, input.accessToken);
  if (!topic) return false;

  const prompt = topic.prompts.find((item) => item.id === input.promptId)
    ?? topic.prompts.find((item) => item.results.some((result) => result.domain === input.domain))
    ?? topic.prompts[topic.prompts.length - 1];
  if (!prompt) return false;

  if (!prompt.selected.includes(input.domain)) {
    prompt.selected.push(input.domain);
    topic.updatedAt = nowIso();
    getLocalUserStore(input.userId).set(topic.id, topic);
    await persistSupabase(topic, input.accessToken);
  }

  return true;
}

export async function listTopicSummaries(input: {
  userId: string;
  accessToken?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ topics: HistoryTopicSummary[]; total: number }> {
  const page = Number.isFinite(input.page) && (input.page as number) > 0 ? (input.page as number) : 1;
  const pageSize = Number.isFinite(input.pageSize)
    ? Math.min(Math.max(input.pageSize as number, 4), 24)
    : 8;
  const query = input.q?.trim().toLowerCase() ?? "";

  const pageData = await loadTopicPageFromSupabase({
    userId: input.userId,
    accessToken: input.accessToken,
    page,
    pageSize,
    q: query,
  });

  if (pageData && pageData.total >= 0) {
    return {
      topics: pageData.topics.map(asSummary),
      total: pageData.total,
    };
  }

  const topics = await loadAllTopicsFromSupabase(input.userId, input.accessToken);
  const summaries = topics
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map(asSummary);

  const filtered = query.length > 0
    ? summaries.filter((topic) => topic.latestPrompt.toLowerCase().includes(query))
    : summaries;

  const total = filtered.length;
  const start = (page - 1) * pageSize;

  return {
    topics: filtered.slice(start, start + pageSize),
    total,
  };
}

export async function getTopicDetails(input: {
  userId: string;
  topicId: string;
  accessToken?: string;
}): Promise<HistoryTopicDetails | null> {
  const topic = getLocalUserStore(input.userId).get(input.topicId)
    ?? await loadTopicFromSupabase(input.topicId, input.userId, input.accessToken);
  if (!topic) return null;
  return asDetails(topic);
}

export async function deleteTopic(input: {
  userId: string;
  topicId: string;
  accessToken?: string;
}): Promise<boolean> {
  const userStore = getLocalUserStore(input.userId);
  const existing = userStore.get(input.topicId)
    ?? await loadTopicFromSupabase(input.topicId, input.userId, input.accessToken);
  if (!existing) return false;

  userStore.delete(input.topicId);

  if (!isUuid(input.userId)) return true;
  const client = getClient(input.accessToken);
  if (!client) return true;

  const { error } = await client
    .from("domain_topics")
    .delete()
    .eq("id", input.topicId)
    .eq("user_id", input.userId);

  return !error;
}
