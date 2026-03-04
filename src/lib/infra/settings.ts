import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { ModelProvider, ProviderApiKeyMetadataMap, ProviderApiKeys, UserSettings } from "@/lib/types";

interface SettingsRow {
  user_id: string;
  payload: unknown;
  updated_at?: string;
}

interface VaultKeyRow {
  provider: string;
  api_key: string;
}

interface VaultKeyMetadataRow {
  provider: string;
  has_key: boolean;
  last4: string | null;
  updated_at: string | null;
}

const defaultOrder: ModelProvider[] = ["groq", "grok", "gemini", "openai", "huggingface"];
const providers: ModelProvider[] = ["groq", "grok", "gemini", "openai", "huggingface"];

const isProvider = (value: string): value is ModelProvider =>
  value === "groq" || value === "gemini" || value === "openai" || value === "grok" || value === "huggingface";

const sanitizeProviderOrder = (value: unknown): ModelProvider[] => {
  if (!Array.isArray(value)) return defaultOrder;

  const cleaned = value.filter((item): item is ModelProvider => typeof item === "string" && isProvider(item));
  const deduped = [...new Set(cleaned)];

  if (deduped.length === 0) return ["groq"];

  return deduped;
};

const sanitizeApiKeys = (value: unknown): ProviderApiKeys => {
  if (!value || typeof value !== "object") return {};
  const payload = value as Record<string, unknown>;

  const normalize = (key: string): string | undefined => {
    const item = payload[key];
    if (typeof item !== "string") return undefined;
    const trimmed = item.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    groq: normalize("groq"),
    gemini: normalize("gemini"),
    openai: normalize("openai"),
    grok: normalize("grok"),
    huggingface: normalize("huggingface"),
  };
};

const sanitizeApiKeyPatch = (value: unknown): Partial<Record<ModelProvider, string>> => {
  if (!value || typeof value !== "object") return {};
  const payload = value as Record<string, unknown>;
  const patch: Partial<Record<ModelProvider, string>> = {};

  for (const provider of providers) {
    const item = payload[provider];
    if (typeof item !== "string") continue;
    patch[provider] = item.trim();
  }

  return patch;
};

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

const normalizeSettings = (userId: string, payload: unknown, updatedAt?: string): UserSettings => {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const providerOrder = sanitizeProviderOrder(raw.providerOrder);

  const candidateDefault = typeof raw.defaultProvider === "string" && isProvider(raw.defaultProvider)
    ? raw.defaultProvider
    : providerOrder[0] ?? "groq";

  return {
    userId,
    defaultProvider: candidateDefault,
    providerOrder,
    apiKeys: sanitizeApiKeys(raw.apiKeys),
    updatedAt: updatedAt ?? new Date().toISOString(),
  };
};

const fallbackSettings = (userId: string): UserSettings => ({
  userId,
  defaultProvider: "groq",
  providerOrder: [...defaultOrder],
  apiKeys: {},
  updatedAt: new Date().toISOString(),
});

const readVaultApiKeys = async (client: SupabaseClient, userId: string): Promise<ProviderApiKeys | null> => {
  const { data, error } = await client.rpc("get_user_provider_api_keys", {
    p_user_id: userId,
  });

  if (error || !Array.isArray(data)) {
    return null;
  }

  const keys: ProviderApiKeys = {};

  for (const row of data as VaultKeyRow[]) {
    if (!row || typeof row.provider !== "string" || typeof row.api_key !== "string") continue;
    if (!isProvider(row.provider)) continue;
    const trimmed = row.api_key.trim();
    if (trimmed.length > 0) {
      keys[row.provider] = trimmed;
    }
  }

  return keys;
};

const writeVaultApiKeys = async (
  client: SupabaseClient,
  userId: string,
  apiKeysPatch: Partial<Record<ModelProvider, string>>,
): Promise<boolean> => {
  try {
    const patchEntries = Object.entries(apiKeysPatch) as Array<[ModelProvider, string]>;
    await Promise.all(patchEntries.map(async ([provider, value]) => {
      const { error } = await client.rpc("upsert_user_provider_api_key", {
        p_user_id: userId,
        p_provider: provider,
        p_api_key: value,
      });
      if (error) throw error;
    }));
    return true;
  } catch {
    return false;
  }
};

const readVaultApiKeyMetadata = async (
  client: SupabaseClient,
  userId: string,
): Promise<ProviderApiKeyMetadataMap | null> => {
  const { data, error } = await client.rpc("get_user_provider_api_key_metadata", {
    p_user_id: userId,
  });

  if (error || !Array.isArray(data)) {
    return null;
  }

  const metadata: ProviderApiKeyMetadataMap = {};

  for (const row of data as VaultKeyMetadataRow[]) {
    if (!row || typeof row.provider !== "string" || !isProvider(row.provider)) continue;
    metadata[row.provider] = {
      hasKey: Boolean(row.has_key),
      last4: row.last4 ?? undefined,
      updatedAt: row.updated_at ?? undefined,
    };
  }

  return metadata;
};

export async function getUserSettings(userId: string, accessToken?: string): Promise<UserSettings> {
  const client = getClient(accessToken);
  if (!client) return fallbackSettings(userId);

  const { data, error } = await client
    .from("user_settings")
    .select("user_id,payload,updated_at")
    .eq("user_id", userId)
    .maybeSingle<SettingsRow>();

  if (error || !data) return fallbackSettings(userId);

  return normalizeSettings(userId, data.payload, data.updated_at);
}

export async function upsertUserSettings(input: {
  userId: string;
  accessToken?: string;
  defaultProvider: ModelProvider;
  providerOrder: ModelProvider[];
}): Promise<UserSettings> {
  const client = getClient(input.accessToken);
  if (!client) {
    return {
      userId: input.userId,
      defaultProvider: input.defaultProvider,
      providerOrder: sanitizeProviderOrder(input.providerOrder),
      apiKeys: {},
      updatedAt: new Date().toISOString(),
    };
  }

  const payload = {
    defaultProvider: input.defaultProvider,
    providerOrder: sanitizeProviderOrder(input.providerOrder),
  };

  const { data, error } = await client
    .from("user_settings")
    .upsert({
      user_id: input.userId,
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("user_id,payload,updated_at")
    .single<SettingsRow>();

  if (error || !data) {
    return {
      userId: input.userId,
      defaultProvider: input.defaultProvider,
      providerOrder: sanitizeProviderOrder(input.providerOrder),
      apiKeys: {},
      updatedAt: new Date().toISOString(),
    };
  }

  return normalizeSettings(data.user_id, data.payload, data.updated_at);
}

export async function getUserApiKeys(userId: string, accessToken?: string): Promise<ProviderApiKeys> {
  const client = getClient(accessToken);
  if (!client) return {};

  const keys = await readVaultApiKeys(client, userId);
  return keys ?? {};
}

export async function upsertUserApiKeys(input: {
  userId: string;
  accessToken?: string;
  apiKeys: Partial<Record<ModelProvider, string>>;
}): Promise<ProviderApiKeys> {
  const client = getClient(input.accessToken);
  const sanitizedPatch = sanitizeApiKeyPatch(input.apiKeys);
  if (!client) return {};

  await writeVaultApiKeys(client, input.userId, sanitizedPatch);
  const refreshed = await readVaultApiKeys(client, input.userId);
  return refreshed ?? {};
}

export async function getUserApiKeysMetadata(userId: string, accessToken?: string): Promise<ProviderApiKeyMetadataMap> {
  const client = getClient(accessToken);
  if (!client) return {};

  const metadata = await readVaultApiKeyMetadata(client, userId);
  return metadata ?? {};
}
