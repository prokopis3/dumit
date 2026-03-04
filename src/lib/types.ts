export type ModelProvider = "groq" | "gemini" | "openai" | "grok" | "huggingface";
export type SearchExecutionMode = "speed" | "balanced" | "quality";

export interface ProviderApiKeys {
  groq?: string;
  gemini?: string;
  openai?: string;
  grok?: string;
  huggingface?: string;
}

export interface ProviderApiKeyMetadata {
  hasKey: boolean;
  last4?: string;
  updatedAt?: string;
}

export type ProviderApiKeyMetadataMap = Partial<Record<ModelProvider, ProviderApiKeyMetadata>>;

export interface UserSettings {
  userId: string;
  defaultProvider: ModelProvider;
  providerOrder: ModelProvider[];
  apiKeys: ProviderApiKeys;
  updatedAt: string;
}

export interface SearchConstraints {
  minLength: number;
  maxLength: number;
  tlds: string[];
  count: number;
}

export interface SearchIntent {
  brandTone?: string;
  audience?: string;
  industry?: string;
  styleKeywords?: string[];
  forbiddenWords?: string[];
  mustIncludeWords?: string[];
  language?: string;
  country?: string;
}

export interface SearchFormState {
  prompt: string;
  intent?: SearchIntent;
  constraints: SearchConstraints;
  providerOrder?: ModelProvider[];
  executionMode?: SearchExecutionMode;
}

export interface SuggestRequest {
  prompt: string;
  providerOrder?: ModelProvider[];
  executionMode?: SearchExecutionMode;
  constraints: SearchConstraints;
  intent?: SearchIntent;
  providerApiKeys?: ProviderApiKeys;
}

export interface DomainAvailability {
  domain: string;
  available: boolean;
  source: "dns" | "rdap" | "cache";
}

export interface RankedDomainResult extends DomainAvailability {
  score: number;
  reason: string;
  isAI: boolean;
}

export interface SearchSessionInput {
  userId?: string;
  accessToken?: string;
  topicId?: string;
  prompt: string;
  constraints: SearchConstraints;
  providerOrder?: ModelProvider[];
  executionMode?: SearchExecutionMode;
  intent?: SearchIntent;
  providerApiKeys?: ProviderApiKeys;
}

export interface ProviderRunSummary {
  provider: ModelProvider;
  model: string;
  status: "success" | "failed";
  estimatedCostUsd: number;
  error?: string;
}

export interface ProviderUsageSummary {
  providerUsed: ModelProvider;
  executionMode: SearchExecutionMode;
  modelsSelectedCount: number;
  modelsExecutedCount: number;
  modelsSucceededCount: number;
  providersTried: ProviderRunSummary[];
  totalEstimatedCostUsd: number;
}

export interface SearchSessionResult {
  topicId: string;
  promptId: string;
  prompt: string;
  responseTimeMs: number;
  statusSteps: string[];
  candidates: string[];
  results: RankedDomainResult[];
  providerUsage: ProviderUsageSummary;
}

export interface SearchMemorySnapshot extends SearchFormState {
  id: string;
  userId?: string;
  guestKey?: string;
  topicId?: string;
  promptId?: string;
  responseTimeMs?: number;
  statusSteps: string[];
  candidates: string[];
  results: RankedDomainResult[];
  providerUsage?: ProviderUsageSummary;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryTopicSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  latestPrompt: string;
  selectedCount: number;
  latestResponseTimeMs?: number;
  latestProviders?: ModelProvider[];
}

export interface HistoryTopicDetails extends HistoryTopicSummary {
  prompts: Array<{
    id: string;
    prompt: string;
    createdAt: string;
    responseTimeMs?: number;
    results: RankedDomainResult[];
    selected: string[];
  }>;
}
