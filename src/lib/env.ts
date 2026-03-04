const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const toOptionalPositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

export const env = {
  get groqApiKey() {
    return process.env.GROQ_API_KEY;
  },
  get geminiApiKey() {
    return process.env.GEMINI_API_KEY;
  },
  get openAiApiKey() {
    return process.env.OPENAI_API_KEY;
  },
  get xAiApiKey() {
    return process.env.XAI_API_KEY;
  },
  get huggingFaceApiKey() {
    return process.env.HUGGINGFACE_API_KEY;
  },
  get enableRdapFallback() {
    return process.env.ENABLE_RDAP_FALLBACK !== "false";
  },

  get groqModel() {
    return process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";
  },
  get openAiModel() {
    return process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  },
  get xAiModel() {
    return process.env.XAI_MODEL ?? "grok-3-mini";
  },
  get huggingFaceModel() {
    return process.env.HUGGINGFACE_MODEL ?? "meta-llama/Llama-3.1-8B-Instruct";
  },
  get geminiModel() {
    return process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  },

  get upstashRedisRestUrl() {
    return process.env.UPSTASH_REDIS_REST_URL;
  },
  get upstashRedisRestToken() {
    return process.env.UPSTASH_REDIS_REST_TOKEN;
  },

  get supabaseUrl() {
    return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  },
  get supabaseAnonKey() {
    return process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  },
  get supabaseServiceRoleKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  },

  get milvusEndpoint() {
    return process.env.MILVUS_ENDPOINT;
  },
  get milvusToken() {
    return process.env.MILVUS_TOKEN;
  },
  get milvusCollection() {
    return process.env.MILVUS_COLLECTION ?? "domain_vectors";
  },
  get milvusVectorField() {
    return process.env.MILVUS_VECTOR_FIELD ?? "embedding";
  },
  get milvusVectorDim() {
    return toOptionalPositiveInt(process.env.MILVUS_VECTOR_DIM);
  },

  get geminiEmbeddingModel() {
    return process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
  },
  get openAiEmbeddingModel() {
    return process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  },

  get defaultDomainCount() {
    return toInt(process.env.DOMAIN_SUGGEST_COUNT, 12);
  },
  get maxDomainCount() {
    return toInt(process.env.DOMAIN_SUGGEST_MAX, 24);
  },
};
