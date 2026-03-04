import type { SearchConstraints, SearchIntent } from "@/lib/types";

const DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?\.[a-z]{2,}$/i;

export const normalizeDomain = (domain: string): string =>
  domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

export const isValidDomain = (domain: string): boolean => DOMAIN_REGEX.test(domain);

export const parseJsonArrayFromText = (rawText: string): string[] => {
  const match = rawText.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => String(item ?? ""))
      .map(normalizeDomain)
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
};

export const unique = <T>(items: T[]): T[] => [...new Set(items)];

const DEFAULT_TLD_POOL = [
  ".com",
  ".ai",
  ".io",
  ".app",
  ".dev",
  ".tech",
  ".co",
  ".org",
  ".xyz",
  ".net",
] as const;

const TLD_HINTS: Array<{ keywords: string[]; tlds: string[] }> = [
  { keywords: ["ai", "ml", "llm", "agent", "model", "automation"], tlds: [".ai", ".io", ".dev", ".app", ".tech"] },
  { keywords: ["finance", "bank", "fintech", "capital", "invest", "trading"], tlds: [".finance", ".capital", ".com", ".io", ".co"] },
  { keywords: ["store", "shop", "commerce", "ecom", "retail"], tlds: [".store", ".shop", ".com", ".co", ".app"] },
  { keywords: ["news", "media", "blog", "content", "press"], tlds: [".news", ".media", ".blog", ".com", ".org"] },
  { keywords: ["cloud", "infra", "hosting", "platform", "api"], tlds: [".cloud", ".dev", ".io", ".tech", ".com"] },
];

const normalizeTldList = (values: string[]): string[] =>
  unique(
    values
      .map((value) => value.trim().toLowerCase())
      .map((value) => (value.startsWith(".") ? value : `.${value}`))
      .filter((value) => /^\.[a-z0-9-]{2,}$/.test(value)),
  );

const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const rotatePool = (pool: readonly string[], seed: string, size: number): string[] => {
  const result: string[] = [];
  const start = hashSeed(seed) % pool.length;
  for (let index = 0; index < pool.length && result.length < size; index += 1) {
    result.push(pool[(start + index) % pool.length]);
  }
  return result;
};

export const inferRelevantTlds = (input?: {
  seedText?: string;
  preferred?: string[];
  size?: number;
}): string[] => {
  const preferred = normalizeTldList(input?.preferred ?? []);
  if (preferred.length > 0) return preferred;

  const seedText = (input?.seedText ?? "").toLowerCase();
  const requestedSize = Math.max(3, Math.min(8, input?.size ?? 5));

  const hinted = TLD_HINTS
    .filter((entry) => entry.keywords.some((keyword) => seedText.includes(keyword)))
    .flatMap((entry) => entry.tlds);

  if (hinted.length > 0) {
    const blended = normalizeTldList([...hinted, ...rotatePool(DEFAULT_TLD_POOL, seedText || "domain", requestedSize)]);
    return blended.slice(0, requestedSize);
  }

  const dailySeed = new Date().toISOString().slice(0, 10);
  return normalizeTldList(rotatePool(DEFAULT_TLD_POOL, seedText || dailySeed, requestedSize)).slice(0, requestedSize);
};

export const sanitizeConstraints = (
  constraints: Partial<SearchConstraints> | undefined,
): SearchConstraints => {
  const minLength = Math.max(2, Math.min(20, constraints?.minLength ?? 4));
  const maxLength = Math.max(minLength, Math.min(24, constraints?.maxLength ?? 12));
  const count = Math.max(3, Math.min(24, constraints?.count ?? 12));
  const tlds = inferRelevantTlds({ preferred: constraints?.tlds });

  return { minLength, maxLength, count, tlds };
};

const normalizeIntentList = (items: string[] | undefined, maxItems = 8): string[] => {
  if (!items?.length) return [];
  return unique(
    items
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  ).slice(0, maxItems);
};

export const sanitizeIntent = (intent: SearchIntent | undefined): SearchIntent => {
  if (!intent) return {};

  const trimmed = (value: string | undefined, maxLength = 80): string | undefined => {
    const clean = value?.trim();
    if (!clean) return undefined;
    return clean.slice(0, maxLength);
  };

  return {
    brandTone: trimmed(intent.brandTone),
    audience: trimmed(intent.audience),
    industry: trimmed(intent.industry),
    styleKeywords: normalizeIntentList(intent.styleKeywords),
    forbiddenWords: normalizeIntentList(intent.forbiddenWords),
    mustIncludeWords: normalizeIntentList(intent.mustIncludeWords),
    language: trimmed(intent.language, 32),
    country: trimmed(intent.country, 48),
  };
};

export const hashKey = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const lexicalPromptScore = (prompt: string, domain: string): number => {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

  const base = domain.split(".")[0] ?? domain;
  const hitCount = words.reduce(
    (total, word) => (base.includes(word) ? total + 1 : total),
    0,
  );

  const compactness = Math.max(0, 16 - base.length) / 16;
  return hitCount * 0.7 + compactness * 0.3;
};

export const isDomainWithinConstraints = (
  domain: string,
  constraints: SearchConstraints,
): boolean => {
  const normalized = normalizeDomain(domain);
  if (!isValidDomain(normalized)) return false;

  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) return false;

  const label = normalized.slice(0, dotIndex);
  const tld = normalized.slice(dotIndex);

  if (!constraints.tlds.includes(tld)) return false;
  if (label.length < constraints.minLength || label.length > constraints.maxLength) return false;

  return true;
};
