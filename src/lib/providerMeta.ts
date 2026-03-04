import type { ModelProvider } from "@/lib/types";

export interface ProviderMeta {
  id: ModelProvider;
  label: string;
  accent: string;
  simpleIconSlug: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  { id: "groq", label: "Groq", accent: "from-emerald-500/35 to-teal-300/8", simpleIconSlug: "groq" },
  { id: "grok", label: "Grok", accent: "from-red-500/40 to-red-300/10", simpleIconSlug: "xai" },
  { id: "gemini", label: "Gemini", accent: "from-slate-500/35 to-emerald-300/10", simpleIconSlug: "googlegemini" },
  { id: "openai", label: "OpenAI", accent: "from-zinc-500/40 to-zinc-300/10", simpleIconSlug: "openai" },
  { id: "huggingface", label: "HuggingFace", accent: "from-indigo-500/40 to-purple-300/10", simpleIconSlug: "huggingface" },
];

const providerMetaRecord = Object.fromEntries(
  PROVIDER_META.map((provider) => [provider.id, provider]),
) as Record<ModelProvider, ProviderMeta>;

export const providerMeta = (provider: ModelProvider): ProviderMeta => providerMetaRecord[provider];

export const providerLabel = (provider: ModelProvider): string => providerMeta(provider).label;

export const providerAccent = (provider: ModelProvider): string => providerMeta(provider).accent;

export const providerIconUrl = (provider: ModelProvider): string => {
  const slug = providerMeta(provider).simpleIconSlug;
  return `https://cdn.simpleicons.org/${slug}/FFFFFF`;
};

export const normalizeProviderList = (providers: ModelProvider[]): ModelProvider[] => {
  const seen = new Set<ModelProvider>();
  for (const provider of providers) {
    if (providerMetaRecord[provider]) {
      seen.add(provider);
    }
  }

  return [...seen];
};
