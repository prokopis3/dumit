import { env } from "@/lib/env";
import type {
  ModelProvider,
  ProviderApiKeys,
  ProviderRunSummary,
  SearchExecutionMode,
  SearchConstraints,
  SearchIntent,
  SuggestRequest,
} from "@/lib/types";
import { parseJsonArrayFromText } from "@/lib/utils";

const systemPrompt = (constraints: SearchConstraints) => `
You are a domain strategist.
Return only a JSON array of domain names (strings), no markdown and no explanation.
Rules:
- Generate exactly ${constraints.count} domain names.
- Use only these TLDs: ${constraints.tlds.join(", ")}.
- Root label length should be between ${constraints.minLength} and ${constraints.maxLength}.
- Names should be brandable, easy to spell, and relevant to the user prompt.
- Do not include duplicates.
`;

const intentPrompt = (intent: SearchIntent | undefined): string => {
  if (!intent) return "";

  const lines: string[] = [];
  if (intent.brandTone) lines.push(`- Brand tone: ${intent.brandTone}`);
  if (intent.audience) lines.push(`- Audience: ${intent.audience}`);
  if (intent.industry) lines.push(`- Industry: ${intent.industry}`);
  if (intent.language) lines.push(`- Language: ${intent.language}`);
  if (intent.country) lines.push(`- Country/market: ${intent.country}`);
  if (intent.styleKeywords?.length) lines.push(`- Style keywords: ${intent.styleKeywords.join(", ")}`);
  if (intent.mustIncludeWords?.length) lines.push(`- Must include concepts: ${intent.mustIncludeWords.join(", ")}`);
  if (intent.forbiddenWords?.length) lines.push(`- Avoid words: ${intent.forbiddenWords.join(", ")}`);

  if (lines.length === 0) return "";
  return `Intent preferences:\n${lines.join("\n")}`;
};

const userPrompt = (prompt: string, intent: SearchIntent | undefined) => {
  const intentSection = intentPrompt(intent);
  return intentSection
    ? `Prompt: ${prompt}\n${intentSection}`
    : `Prompt: ${prompt}`;
};

const MAX_RETRY_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

class ProviderHttpError extends Error {
  provider: ModelProvider;
  model: string;
  status: number;
  bodyPreview: string;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(input: {
    provider: ModelProvider;
    model: string;
    status: number;
    bodyPreview: string;
    retryAfterMs?: number;
  }) {
    super(`Provider request failed (${input.status}): ${input.bodyPreview}`);
    this.name = "ProviderHttpError";
    this.provider = input.provider;
    this.model = input.model;
    this.status = input.status;
    this.bodyPreview = input.bodyPreview;
    this.retryable = RETRYABLE_HTTP_STATUS.has(input.status);
    this.retryAfterMs = input.retryAfterMs;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;

  const seconds = Number.parseFloat(value);
  if (!Number.isNaN(seconds) && Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
};

const computeBackoffMs = (attempt: number, retryAfterMs?: number): number => {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 15_000);
  }

  const base = 300;
  const exponential = base * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 220);
  return Math.min(8_000, exponential + jitter);
};

async function requestProviderText(input: {
  provider: ModelProvider;
  model: string;
  url: string;
  init: RequestInit;
  signal?: AbortSignal;
}): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetch(input.url, {
      ...input.init,
      signal: input.signal,
    });

    const bodyText = await response.text();
    if (response.ok) return bodyText;

    const error = new ProviderHttpError({
      provider: input.provider,
      model: input.model,
      status: response.status,
      bodyPreview: bodyText.slice(0, 240),
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    });

    if (!error.retryable || attempt === MAX_RETRY_ATTEMPTS) {
      throw error;
    }

    await sleep(computeBackoffMs(attempt, error.retryAfterMs));
  }

  throw new Error("Unreachable provider request state");
}

const formatProviderError = (provider: ModelProvider, model: string, error: unknown): string => {
  if (error instanceof ProviderHttpError) {
    if (error.status === 429) {
      return `${provider} (${model}) rate-limited (429). Consider lowering execution mode or rotating API key.`;
    }
    if (error.status === 403) {
      return `${provider} (${model}) unauthorized/forbidden (403). Verify API key scope, billing, project access, and model entitlement.`;
    }
    if (error.status === 404) {
      return `${provider} (${model}) endpoint/model not found (404). Check configured model name.`;
    }
    return `${provider} (${model}) failed (${error.status}): ${error.bodyPreview}`;
  }

  if (error instanceof Error) return `${provider} (${model}) failed: ${error.message}`;
  return `${provider} (${model}) failed with unknown error`;
};

interface ProviderCallResult {
  suggestions: string[];
  model: string;
  estimatedCostUsd: number;
}

interface ProviderAttemptSuccess {
  provider: ModelProvider;
  response: ProviderCallResult;
}

interface CostRates {
  inputPerMillion: number;
  outputPerMillion: number;
}

const providerModelName = (provider: ModelProvider): string => {
  if (provider === "groq") return env.groqModel;
  if (provider === "gemini") return env.geminiModel;
  if (provider === "openai") return env.openAiModel;
  if (provider === "grok") return env.xAiModel;
  return env.huggingFaceModel;
};

const providerCostRates: Record<ModelProvider, CostRates> = {
  groq: { inputPerMillion: 0.08, outputPerMillion: 0.24 },
  gemini: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  openai: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  grok: { inputPerMillion: 0.2, outputPerMillion: 1 },
  huggingface: { inputPerMillion: 0.05, outputPerMillion: 0.2 },
};

const estimateTokensFromText = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
};

const estimateCostUsd = (
  provider: ModelProvider,
  inputTokens: number,
  outputTokens: number,
): number => {
  const rates = providerCostRates[provider];
  const inputCost = (inputTokens / 1_000_000) * rates.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPerMillion;
  return Number((inputCost + outputCost).toFixed(8));
};

const promptTokenEstimate = (prompt: string, constraints: SearchConstraints, intent: SearchIntent | undefined): number =>
  estimateTokensFromText(`${systemPrompt(constraints)}\n${userPrompt(prompt, intent)}`);

async function callGemini(
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  const geminiKey = apiKeys.gemini ?? env.geminiApiKey;
  if (!geminiKey) throw new Error("GEMINI_API_KEY missing");

  const fallbackModels = ["gemini-2.0-flash", "gemini-1.5-flash"];
  const modelsToTry = [...new Set([env.geminiModel, ...fallbackModels])];
  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    const body = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt(constraints)}\n${userPrompt(prompt, intent)}` }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
      },
    });

    try {
      const text = await requestProviderText({
        provider: "gemini",
        model: modelName,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
        signal,
      });

      const json = JSON.parse(text) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      const outputText = json.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n") ?? "[]";

      const suggestions = parseJsonArrayFromText(outputText);
      const inputTokens = json.usageMetadata?.promptTokenCount ?? promptTokenEstimate(prompt, constraints, intent);
      const outputTokens = json.usageMetadata?.candidatesTokenCount ?? estimateTokensFromText(outputText);

      return {
        suggestions,
        model: modelName,
        estimatedCostUsd: estimateCostUsd("gemini", inputTokens, outputTokens),
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        const isModelNotFound = error.status === 404 || (error.status === 400 && /model|not\s*found|unsupported|invalid/i.test(error.bodyPreview));
        if (isModelNotFound) {
          lastError = new Error(formatProviderError("gemini", modelName, error));
          continue;
        }
      }

      lastError = new Error(formatProviderError("gemini", modelName, error));
      throw lastError;
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

async function callOpenAi(
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  const openAiKey = apiKeys.openai ?? env.openAiApiKey;
  if (!openAiKey) throw new Error("OPENAI_API_KEY missing");

  const fallbackModels = ["gpt-4.1-mini", "gpt-4o-mini"];
  const modelsToTry = [...new Set([env.openAiModel, ...fallbackModels])];
  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const text = await requestProviderText({
        provider: "openai",
        model: modelName,
        url: "https://api.openai.com/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            temperature: 0.7,
            messages: [
              { role: "system", content: systemPrompt(constraints) },
              { role: "user", content: userPrompt(prompt, intent) },
            ],
          }),
        },
        signal,
      });

      const json = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const outputText = json.choices?.[0]?.message?.content ?? "[]";
      const suggestions = parseJsonArrayFromText(outputText);

      const inputTokens = json.usage?.prompt_tokens ?? promptTokenEstimate(prompt, constraints, intent);
      const outputTokens = json.usage?.completion_tokens ?? estimateTokensFromText(outputText);

      return {
        suggestions,
        model: modelName,
        estimatedCostUsd: estimateCostUsd("openai", inputTokens, outputTokens),
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        const modelNotFound = error.status === 404 || (error.status === 400 && /model|not\s*found|does\s*not\s*exist|invalid/i.test(error.bodyPreview));
        if (modelNotFound) {
          lastError = new Error(formatProviderError("openai", modelName, error));
          continue;
        }
      }

      lastError = new Error(formatProviderError("openai", modelName, error));
      throw lastError;
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}

async function callGroq(
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  const groqKey = apiKeys.groq ?? env.groqApiKey;
  if (!groqKey) throw new Error("GROQ_API_KEY missing");

  const fallbackModels = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];
  const modelsToTry = [...new Set([env.groqModel, ...fallbackModels])];
  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    try {
      const text = await requestProviderText({
        provider: "groq",
        model: modelName,
        url: "https://api.groq.com/openai/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            temperature: 0.7,
            messages: [
              { role: "system", content: systemPrompt(constraints) },
              { role: "user", content: userPrompt(prompt, intent) },
            ],
          }),
        },
        signal,
      });

      const json = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const outputText = json.choices?.[0]?.message?.content ?? "[]";
      const suggestions = parseJsonArrayFromText(outputText);

      const inputTokens = json.usage?.prompt_tokens ?? promptTokenEstimate(prompt, constraints, intent);
      const outputTokens = json.usage?.completion_tokens ?? estimateTokensFromText(outputText);

      return {
        suggestions,
        model: modelName,
        estimatedCostUsd: estimateCostUsd("groq", inputTokens, outputTokens),
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        const modelNotFound = error.status === 404 || (error.status === 400 && /model|not\s*found|invalid/i.test(error.bodyPreview));
        if (modelNotFound) {
          lastError = new Error(formatProviderError("groq", modelName, error));
          continue;
        }
      }

      lastError = new Error(formatProviderError("groq", modelName, error));
      throw lastError;
    }
  }

  throw lastError ?? new Error("Groq request failed");
}

async function callGrok(
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  const xAiKey = apiKeys.grok ?? env.xAiApiKey;
  if (!xAiKey) throw new Error("XAI_API_KEY missing");

  const fallbackModels = ["grok-3-mini", "grok-3-mini-fast", "grok-beta"];
  const modelsToTry = [...new Set([env.xAiModel, ...fallbackModels])];

  let lastError: Error | null = null;

  for (const modelName of modelsToTry) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    let bodyText: string;
    try {
      bodyText = await requestProviderText({
        provider: "grok",
        model: modelName,
        url: "https://api.x.ai/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${xAiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelName,
            temperature: 0.65,
            messages: [
              { role: "system", content: systemPrompt(constraints) },
              { role: "user", content: userPrompt(prompt, intent) },
            ],
          }),
        },
        signal,
      });
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        const isModelNotFound =
          error.status === 404 ||
          (error.status === 400 && /model\s*not\s*found|invalid\s*argument|unsupported|model/i.test(error.bodyPreview));
        const isModelAccessDenied =
          error.status === 403 &&
          /model|access|entitled|permission|not\s*available|unsupported/i.test(error.bodyPreview);

        if (isModelNotFound || isModelAccessDenied) {
          lastError = new Error(formatProviderError("grok", modelName, error));
          continue;
        }
      }

      lastError = new Error(formatProviderError("grok", modelName, error));
      throw lastError;
    }

    const json = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };
    const outputText = json.choices?.[0]?.message?.content ?? "[]";
    const suggestions = parseJsonArrayFromText(outputText);

    const inputTokens = json.usage?.prompt_tokens ?? promptTokenEstimate(prompt, constraints, intent);
    const outputTokens = json.usage?.completion_tokens ?? estimateTokensFromText(outputText);

    return {
      suggestions,
      model: modelName,
      estimatedCostUsd: estimateCostUsd("grok", inputTokens, outputTokens),
    };
  }

  throw lastError ?? new Error("XAI model request failed");
}

async function callHuggingFace(
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  const hfKey = apiKeys.huggingface ?? env.huggingFaceApiKey;
  if (!hfKey) throw new Error("HUGGINGFACE_API_KEY missing");

  const text = await requestProviderText({
    provider: "huggingface",
    model: env.huggingFaceModel,
    url: `https://api-inference.huggingface.co/models/${encodeURIComponent(env.huggingFaceModel)}`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: `${systemPrompt(constraints)}\n${userPrompt(prompt, intent)}`,
        parameters: { max_new_tokens: 220, temperature: 0.7 },
      }),
    },
    signal,
  });
  const json = JSON.parse(text) as Array<{ generated_text?: string }>;
  const outputText = json?.[0]?.generated_text ?? "[]";
  const suggestions = parseJsonArrayFromText(outputText);
  const inputTokens = promptTokenEstimate(prompt, constraints, intent);
  const outputTokens = estimateTokensFromText(outputText);

  return {
    suggestions,
    model: env.huggingFaceModel,
    estimatedCostUsd: estimateCostUsd("huggingface", inputTokens, outputTokens),
  };
}

type ProviderFn = (
  prompt: string,
  constraints: SearchConstraints,
  intent: SearchIntent | undefined,
  apiKeys: ProviderApiKeys,
  signal?: AbortSignal,
) => Promise<ProviderCallResult>;

const providerMap: Record<ModelProvider, ProviderFn> = {
  groq: callGroq,
  gemini: callGemini,
  openai: callOpenAi,
  grok: callGrok,
  huggingface: callHuggingFace,
};

const defaultProviderOrder: ModelProvider[] = ["groq", "grok", "gemini", "openai", "huggingface"];

const executionModeCap: Record<SearchExecutionMode, number> = {
  speed: 2,
  balanced: 3,
  quality: Number.POSITIVE_INFINITY,
};

const normalizeExecutionMode = (value: unknown): SearchExecutionMode => {
  if (value === "balanced" || value === "quality") return value;
  return "speed";
};

const getExecutionConcurrency = (mode: SearchExecutionMode, totalProviders: number): number => {
  if (totalProviders <= 1) return 1;
  const cap = executionModeCap[mode];
  if (!Number.isFinite(cap)) return totalProviders;
  return Math.max(1, Math.min(totalProviders, cap));
};

const isAbortError = (error: unknown): boolean => {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  if (error instanceof Error) return error.name === "AbortError";
  return false;
};

async function runHedgedBatch(
  batchProviders: ModelProvider[],
  request: SuggestRequest,
  providerApiKeys: ProviderApiKeys,
): Promise<{
  winner: ProviderAttemptSuccess | null;
  summaries: ProviderRunSummary[];
}> {
  const summaryByProvider = new Map<ModelProvider, ProviderRunSummary>();
  const controllers = new Map<ModelProvider, AbortController>();

  const tasks = batchProviders.map(async (provider): Promise<ProviderAttemptSuccess> => {
    const controller = new AbortController();
    controllers.set(provider, controller);

    try {
      const response = await providerMap[provider](
        request.prompt,
        request.constraints,
        request.intent,
        providerApiKeys,
        controller.signal,
      );

      if (response.suggestions.length === 0) {
        summaryByProvider.set(provider, {
          provider,
          model: response.model,
          status: "failed",
          estimatedCostUsd: response.estimatedCostUsd,
          error: "Provider returned no suggestions",
        });
        throw new Error("Provider returned no suggestions");
      }

      summaryByProvider.set(provider, {
        provider,
        model: response.model,
        status: "success",
        estimatedCostUsd: response.estimatedCostUsd,
      });

      return { provider, response };
    } catch (error) {
      if (!summaryByProvider.has(provider)) {
        const providerError = formatProviderError(provider, providerModelName(provider), error);
        summaryByProvider.set(provider, {
          provider,
          model: providerModelName(provider),
          status: "failed",
          estimatedCostUsd: 0,
          error: isAbortError(error) ? "Cancelled after faster winner" : providerError,
        });
      }

      throw error;
    }
  });

  let winner: ProviderAttemptSuccess | null = null;

  try {
    winner = await Promise.any(tasks);
  } catch {
    winner = null;
  }

  if (winner) {
    for (const [provider, controller] of controllers.entries()) {
      if (provider !== winner.provider) {
        controller.abort();
      }
    }

    for (const provider of batchProviders) {
      if (provider !== winner.provider && !summaryByProvider.has(provider)) {
        summaryByProvider.set(provider, {
          provider,
          model: providerModelName(provider),
          status: "failed",
          estimatedCostUsd: 0,
          error: "Cancelled after faster winner",
        });
      }
    }
  }

  const summaries = batchProviders.map((provider) => {
    const summary = summaryByProvider.get(provider);
    if (summary) return summary;

    return {
      provider,
      model: providerModelName(provider),
      status: "failed" as const,
      estimatedCostUsd: 0,
      error: "Provider did not complete",
    };
  });

  return { winner, summaries };
}

const hasProviderKey = (provider: ModelProvider, keys: ProviderApiKeys): boolean => {
  if (provider === "groq") return Boolean(keys.groq ?? env.groqApiKey);
  if (provider === "gemini") return Boolean(keys.gemini ?? env.geminiApiKey);
  if (provider === "openai") return Boolean(keys.openai ?? env.openAiApiKey);
  if (provider === "grok") return Boolean(keys.grok ?? env.xAiApiKey);
  return Boolean(keys.huggingface ?? env.huggingFaceApiKey);
};

export async function generateSuggestions(request: SuggestRequest): Promise<{
  suggestions: string[];
  providerUsed: ModelProvider;
  executionMode: SearchExecutionMode;
  modelsSelectedCount: number;
  modelsExecutedCount: number;
  modelsSucceededCount: number;
  providersTried: ProviderRunSummary[];
  totalEstimatedCostUsd: number;
}> {
  const providerApiKeys = request.providerApiKeys ?? {};
  const executionMode = normalizeExecutionMode(request.executionMode);
  const hasExplicitSelection = Boolean(request.providerOrder?.length);
  const requestedProviders = hasExplicitSelection
    ? request.providerOrder!
    : defaultProviderOrder;

  const configuredProviders = requestedProviders.filter((provider) => hasProviderKey(provider, providerApiKeys));
  const configuredAnyProvider = defaultProviderOrder.filter((provider) => hasProviderKey(provider, providerApiKeys));

  if (configuredAnyProvider.length === 0) {
    throw new Error("At least one model API key must be configured");
  }

  if (hasExplicitSelection && configuredProviders.length === 0) {
    throw new Error("No configured API key for selected models");
  }

  const primaryProvidersToTry = configuredProviders.length > 0
    ? configuredProviders
    : configuredAnyProvider;

  const fallbackProvidersToTry = hasExplicitSelection
    ? configuredAnyProvider.filter((provider) => !primaryProvidersToTry.includes(provider))
    : [];

  const providersTried: ProviderRunSummary[] = [];
  let winningAttempt: ProviderAttemptSuccess | null = null;

  const runProviderPass = async (providers: ModelProvider[]) => {
    if (providers.length === 0 || winningAttempt) return;

    const concurrency = getExecutionConcurrency(executionMode, providers.length);

    for (let index = 0; index < providers.length; index += concurrency) {
      const batchProviders = providers.slice(index, index + concurrency);
      const { winner, summaries } = await runHedgedBatch(batchProviders, request, providerApiKeys);
      providersTried.push(...summaries);

      if (winner) {
        winningAttempt = winner;
        break;
      }
    }
  };

  await runProviderPass(primaryProvidersToTry);

  if (!winningAttempt && fallbackProvidersToTry.length > 0) {
    await runProviderPass(fallbackProvidersToTry);
  }

  const totalEstimatedCostUsd = Number(
    providersTried.reduce((sum, item) => sum + item.estimatedCostUsd, 0).toFixed(8),
  );
  const modelsSucceededCount = providersTried.filter((run) => run.status === "success").length;

  if (!winningAttempt) {
    const firstError = providersTried.find((run) => run.error)?.error;
    throw new Error(firstError ?? "No provider produced suggestions");
  }

  const winner: ProviderAttemptSuccess = winningAttempt;

  return {
    suggestions: winner.response.suggestions,
    providerUsed: winner.provider,
    executionMode,
    modelsSelectedCount: primaryProvidersToTry.length + fallbackProvidersToTry.length,
    modelsExecutedCount: providersTried.length,
    modelsSucceededCount,
    providersTried,
    totalEstimatedCostUsd,
  };
}
