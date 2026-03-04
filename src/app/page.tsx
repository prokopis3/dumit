"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  History,
  KeyRound,
  Search,
  Settings,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  HistoryTopicSummary,
  ModelProvider,
  ProviderApiKeyMetadataMap,
  ProviderUsageSummary,
  SearchExecutionMode,
  SearchMemorySnapshot,
  UserSettings,
} from "@/lib/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browserClient";
import { ProviderLogo } from "@/components/provider-logo";
import { GlassCard, MotionWrapper } from "@/components/ui";
import { PROVIDER_META, providerLabel } from "@/lib/providerMeta";
import { inferRelevantTlds } from "@/lib/utils";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DomainResult {
  domain: string;
  available: boolean;
  source: "dns" | "rdap" | "cache";
  score: number;
  reason: string;
  isAI: boolean;
  pending?: boolean;
}

interface StreamProgressPayload {
  type?: "status" | "suggestions" | "ranked_partial" | "ranked" | "saved";
  statusSteps?: string[];
  candidates?: string[];
  results?: DomainResult[];
  pendingDomains?: string[];
  providerUsage?: ProviderUsageSummary | null;
  topicId?: string;
  promptId?: string;
}

interface StreamCompletePayload {
  topicId?: string;
  promptId?: string;
  responseTimeMs?: number;
  statusSteps?: string[];
  candidates?: string[];
  results?: DomainResult[];
  providerUsage?: ProviderUsageSummary | null;
}

type TopicSummary = HistoryTopicSummary;

interface TopicPromptDetails {
  id: string;
  prompt: string;
  createdAt: string;
  responseTimeMs?: number;
  results: DomainResult[];
  selected: string[];
}

interface TopicDetailsResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  latestPrompt: string;
  selectedCount: number;
  prompts: TopicPromptDetails[];
}

interface SearchRestoreDraft {
  query: string;
  selectedTopicId?: string;
  activeProviders: ModelProvider[];
  minLength: number;
  maxLength: number;
  domainCount: number;
  brandTone: string;
  audience: string;
  industry: string;
  styleKeywords: string;
  forbiddenWords: string;
  mustIncludeWords: string;
  language: string;
  country: string;
  executionMode: SearchExecutionMode;
  results: DomainResult[];
  statusSteps: string[];
  responseTimeMs: number | null;
  promptId: string | null;
  topicId: string | null;
  providerUsage: ProviderUsageSummary | null;
}

interface PendingAuthSavePayload {
  createdAt: string;
  pendingDomain: string;
  draft: SearchRestoreDraft;
}

type ToastKind = "info" | "success" | "error";

interface ToastMessage {
  id: string;
  message: string;
  kind: ToastKind;
}

type MainView = "search" | "history" | "settings";
type PaletteTone = "tone-emerald" | "tone-cyan" | "tone-violet" | "tone-amber";

const defaultSettings: UserSettings = {
  userId: "guest",
  defaultProvider: "groq",
  providerOrder: ["groq", "grok", "gemini", "openai", "huggingface"],
  apiKeys: {},
  updatedAt: new Date().toISOString(),
};

const defaultApiKeyMetadata: ProviderApiKeyMetadataMap = {};
const SKIP_AUTO_RESTORE_KEY = "domain-search.skip-auto-restore";
const paletteRhythm: PaletteTone[] = ["tone-emerald", "tone-cyan", "tone-violet", "tone-amber"];
const pickPaletteTone = (index: number, offset = 0): PaletteTone =>
  paletteRhythm[(index + offset) % paletteRhythm.length]!;

const registrarProviders = [
  {
    id: "namecheap",
    label: "Namecheap",
    className: "border-orange-300/40 bg-orange-500/15 text-orange-100 hover:bg-orange-500/25",
    href: (domain: string) => `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`,
  },
  {
    id: "godaddy",
    label: "GoDaddy",
    className: "border-emerald-300/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25",
    href: (domain: string) => `https://www.godaddy.com/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}`,
  },
  {
    id: "squarespace",
    label: "Squarespace",
    className: "border-zinc-300/35 bg-zinc-500/15 text-zinc-100 hover:bg-zinc-500/25",
    href: (domain: string) => `https://domains.squarespace.com/?query=${encodeURIComponent(domain)}`,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    className: "border-violet-300/35 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25",
    href: (domain: string) => `https://dash.cloudflare.com/sign-up?to=/:account/domain-registration/register?domain=${encodeURIComponent(domain)}`,
  },
];

function RegistrarLogo(props: { id: string }) {
  if (props.id === "namecheap") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" role="img">
        <defs>
          <linearGradient id="reg-nc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <rect x="3" y="3" width="18" height="18" rx="6" fill="url(#reg-nc)" />
        <path d="M8 15V9h2l4 4V9h2v6h-2l-4-4v4H8Z" fill="#fff" />
      </svg>
    );
  }

  if (props.id === "godaddy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" role="img">
        <circle cx="12" cy="12" r="9" fill="#22c55e" />
        <path d="M12 7a5 5 0 1 0 5 5h-3a2 2 0 1 1-2-2V7Z" fill="#062b13" />
      </svg>
    );
  }

  if (props.id === "cloudflare") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" role="img">
        <defs>
          <linearGradient id="reg-cf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <path d="M4 16a4 4 0 0 1 4-4h1a5 5 0 0 1 9.6 1.7A2.8 2.8 0 0 1 18.8 19H8a4 4 0 0 1-4-3Z" fill="url(#reg-cf)" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" role="img">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#a1a1aa" />
      <path d="M8 8h8v2h-6v2h5v2h-5v2h6v2H8V8Z" fill="#111827" />
    </svg>
  );
}

function MaterialField(props: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "password";
  placeholder?: string;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <label className="material-field">
      <span className="material-label">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        min={props.min}
        max={props.max}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        className="material-input"
      />
      {props.hint && <span className="mt-1 block text-[11px] text-white/60">{props.hint}</span>}
      <span className="material-bar" />
    </label>
  );
}

function ProviderMultiDropdown(props: {
  label: string;
  value: ModelProvider[];
  onToggle: (provider: ModelProvider) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="material-field w-full text-left"
      >
        <span className="material-label">{props.label}</span>
        <span className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate text-white/85">
            {props.value.length > 0
              ? props.value.map(providerLabel).join(", ")
              : "Choose models"}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/65 transition-transform", open && "rotate-180")} />
        </span>
        <span className="material-bar" />
      </button>

      {open && (
        <div className="absolute z-90 mt-2 w-full rounded-[20px] border border-white/20 bg-black/85 p-2 shadow-2xl backdrop-blur-xl">
          {PROVIDER_META.map((provider) => {
            const active = props.value.includes(provider.id);
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => props.onToggle(provider.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-sm transition-all",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/75 hover:bg-white/10",
                )}
              >
                <span>{provider.label}</span>
                <span
                  className={cn(
                    "h-4 w-4 rounded border",
                    active ? "border-emerald-300 bg-emerald-400/60" : "border-white/35",
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderSingleDropdown(props: {
  label: string;
  value: ModelProvider;
  onSelect: (provider: ModelProvider) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="material-field w-full text-left"
      >
        <span className="material-label">{props.label}</span>
        <span className="flex items-center justify-between gap-3 text-sm text-white/85">
          <span>{providerLabel(props.value)}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/65 transition-transform", open && "rotate-180")} />
        </span>
        <span className="material-bar" />
      </button>

      {open && (
        <div className="absolute z-90 mt-2 w-full rounded-[20px] border border-white/20 bg-black/85 p-2 shadow-2xl backdrop-blur-xl">
          {PROVIDER_META.map((provider) => {
            const active = props.value === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  props.onSelect(provider.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-sm transition-all",
                  active
                    ? "bg-white/15 text-white"
                    : "text-white/75 hover:bg-white/10",
                )}
              >
                <span>{provider.label}</span>
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    active ? "bg-emerald-300" : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const executionModeOptions: Array<{ id: SearchExecutionMode; label: string; helper: string }> = [
  { id: "speed", label: "Speed", helper: "Cap 2 models" },
  { id: "balanced", label: "Balanced", helper: "Cap 3 models" },
  { id: "quality", label: "Quality", helper: "Run all selected" },
];

const landingStats = [
  { label: "Domain availability checks", value: "10M+ / month" },
  { label: "Average response", value: "< 2.5s" },
  { label: "AI provider routing", value: "5 models" },
  { label: "Built for", value: "Founders, SaaS & agencies" },
];

const landingFeatureCards = [
  {
    title: "AI domain name generator",
    description: "Generate startup name ideas from one prompt using tone, market, and keyword controls.",
  },
  {
    title: "Domain availability checker",
    description: "Run parallel DNS checks with RDAP fallback to validate names before you commit to branding.",
  },
  {
    title: "Cost-aware AI routing",
    description: "Use speed, balanced, or quality mode to match launch urgency and budget goals.",
  },
  {
    title: "Naming history + memory",
    description: "Reopen previous domain research sessions and continue from the exact point your team stopped.",
  },
  {
    title: "Provider-level control",
    description: "Bring your own API keys and configure model order for predictable naming runs.",
  },
  {
    title: "Register-ready workflow",
    description: "Move from candidate shortlist to registrar checkout in one continuous workflow.",
  },
];

const seoFaq = [
  {
    question: "How does this AI domain name generator help startup naming?",
    answer:
      "Dum!t combines prompt-driven generation, relevance ranking, and live availability checks so teams can validate startup names faster and launch with confidence.",
  },
  {
    question: "Can I bring my own model API keys?",
    answer:
      "Yes. Signed-in users can store provider keys, set model order, and run domain searches in speed, balanced, or quality mode.",
  },
  {
    question: "Is Dum!t useful for SEO-focused domain research?",
    answer:
      "Absolutely. You can guide style keywords, include/exclude terms, language, and market to generate domain ideas aligned with discoverability and positioning goals.",
  },
];

function ExecutionModeDropdown(props: {
  label: string;
  value: SearchExecutionMode;
  onSelect: (mode: SearchExecutionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const selected = executionModeOptions.find((option) => option.id === props.value) ?? executionModeOptions[0];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="material-field w-full text-left"
      >
        <span className="material-label">{props.label}</span>
        <span className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate text-white/85">{selected.label} • {selected.helper}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/65 transition-transform", open && "rotate-180")} />
        </span>
        <span className="material-bar" />
      </button>

      {open && (
        <div className="absolute z-90 mt-2 w-full rounded-[20px] border border-white/20 bg-black/85 p-2 shadow-2xl backdrop-blur-xl">
          {executionModeOptions.map((option) => {
            const active = option.id === props.value;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  props.onSelect(option.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[14px] px-3 py-2 text-sm transition-all",
                  active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10",
                )}
              >
                <span>{option.label}</span>
                <span className="text-xs text-white/60">{option.helper}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DomainSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isRoutePending, startRouteTransition] = useTransition();
  const [mainView, setMainView] = useState<MainView>("search");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const hasRestoredPendingState = useRef(false);
  const hasHydratedLatestSearch = useRef(false);
  const hasHydratedProviderSelection = useRef(false);
  const hasDraftProviderSelection = useRef(false);
  const previousSessionUserId = useRef<string | null>(null);

  const [query, setQuery] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>();

  const [activeProviders, setActiveProviders] = useState<ModelProvider[]>(["groq"]);
  const [executionMode, setExecutionMode] = useState<SearchExecutionMode>("speed");
  const [minLength, setMinLength] = useState(4);
  const [maxLength, setMaxLength] = useState(12);
  const [domainCount, setDomainCount] = useState(12);

  const [brandTone, setBrandTone] = useState("");
  const [audience, setAudience] = useState("");
  const [industry, setIndustry] = useState("");
  const [styleKeywords, setStyleKeywords] = useState("");
  const [forbiddenWords, setForbiddenWords] = useState("");
  const [mustIncludeWords, setMustIncludeWords] = useState("");
  const [language, setLanguage] = useState("");
  const [country, setCountry] = useState("");

  const [results, setResults] = useState<DomainResult[]>([]);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [statusSteps, setStatusSteps] = useState<string[]>([]);
  const [activeStatusIndex, setActiveStatusIndex] = useState(0);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topicDetails, setTopicDetails] = useState<Record<string, TopicDetailsResponse>>({});
  const [topicMemoryByPrompt, setTopicMemoryByPrompt] = useState<Record<string, Record<string, SearchMemorySnapshot>>>({});
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});
  const [historySearch, setHistorySearch] = useState("");
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageSummary | null>(null);
  const [responseTimeMs, setResponseTimeMs] = useState<number | null>(null);
  const [recentMemories, setRecentMemories] = useState<SearchMemorySnapshot[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [session, setSession] = useState<Session | null>(null);

  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [apiKeyMetadata, setApiKeyMetadata] = useState<ProviderApiKeyMetadataMap>(defaultApiKeyMetadata);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const isUiBusy = loading || historyBusy || settingsBusy || isRoutePending;
  const historyRequestIdRef = useRef(0);
  const historyAbortControllerRef = useRef<AbortController | null>(null);

  const activeAvailable = useMemo(
    () => results.filter((result) => !result.pending && result.available),
    [results],
  );

  const formattedTotalCost = useMemo(() => {
    if (!providerUsage) return "$0.000000";
    return `$${providerUsage.totalEstimatedCostUsd.toFixed(6)}`;
  }, [providerUsage]);

  const grokFallbackModel = useMemo(() => {
    if (!providerUsage) return null;

    const grokRuns = providerUsage.providersTried
      .map((run, index) => ({ ...run, index }))
      .filter((run) => run.provider === "grok");

    const successfulRun = grokRuns.find((run) => run.status === "success");
    if (!successfulRun) return null;

    const hadEarlierFailure = grokRuns.some((run) => run.index < successfulRun.index && run.status === "failed");
    return hadEarlierFailure ? successfulRun.model : null;
  }, [providerUsage]);

  const unavailableCount = useMemo(
    () => results.filter((result) => !result.pending && !result.available).length,
    [results],
  );

  const noResultsMessage = useMemo(() => {
    const explicit = statusSteps.find((step) => /no domains matched|no results|no domains found/i.test(step));
    if (explicit) return explicit;
    if (!loading && results.length === 0 && statusSteps.length > 0) {
      return "No domain results found for the current constraints. Try increasing max letters or relaxing required/forbidden keywords.";
    }
    return null;
  }, [loading, results.length, statusSteps]);

  const savedDomainsForCurrentTopic = useMemo(() => {
    const activeTopicId = topicId ?? selectedTopicId;
    if (!activeTopicId) return new Set<string>();

    const details = topicDetails[activeTopicId];
    if (!details) return new Set<string>();

    const collected = new Set<string>();
    for (const prompt of details.prompts) {
      for (const selected of prompt.selected) {
        collected.add(selected.toLowerCase());
      }
    }

    return collected;
  }, [selectedTopicId, topicDetails, topicId]);

  const groupedTopics = useMemo(() => {
    return topics.reduce<Record<string, TopicSummary[]>>((acc, topic) => {
      const key = new Date(topic.updatedAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      if (!acc[key]) acc[key] = [];
      acc[key].push(topic);
      return acc;
    }, {});
  }, [topics]);

  const historyPageSize = 8;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  const parseCsvInput = (value: string): string[] =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  const pushToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2600);
  }, []);

  const buildPendingDomainResults = useCallback((domains: string[]): DomainResult[] =>
    domains.map((domain) => ({
      domain,
      available: false,
      source: "dns",
      score: 0,
      reason: "Checking availability and ranking...",
      isAI: true,
      pending: true,
    })),
  []);

  const applyLatestSearchMemory = useCallback((snapshot: SearchMemorySnapshot) => {
    if (!snapshot?.prompt) return;

    const intent = snapshot.intent ?? {};
    const constraints = snapshot.constraints ?? {
      minLength: 4,
      maxLength: 12,
      count: 12,
      tlds: inferRelevantTlds({ seedText: snapshot.prompt }),
    };

    setQuery(snapshot.prompt);
    setBrandTone(intent.brandTone ?? "");
    setAudience(intent.audience ?? "");
    setIndustry(intent.industry ?? "");
    setStyleKeywords(Array.isArray(intent.styleKeywords) ? intent.styleKeywords.join(", ") : "");
    setForbiddenWords(Array.isArray(intent.forbiddenWords) ? intent.forbiddenWords.join(", ") : "");
    setMustIncludeWords(Array.isArray(intent.mustIncludeWords) ? intent.mustIncludeWords.join(", ") : "");
    setLanguage(intent.language ?? "");
    setCountry(intent.country ?? "");

    setMinLength(typeof constraints.minLength === "number" ? constraints.minLength : 4);
    setMaxLength(typeof constraints.maxLength === "number" ? constraints.maxLength : 12);
    setDomainCount(typeof constraints.count === "number" ? constraints.count : 12);

    const normalizedProviders = Array.isArray(snapshot.providerOrder)
      ? snapshot.providerOrder.filter(
          (item): item is ModelProvider =>
            item === "groq" || item === "grok" || item === "gemini" || item === "openai" || item === "huggingface",
        )
      : [];
    if (normalizedProviders.length > 0) {
      hasDraftProviderSelection.current = true;
      hasHydratedProviderSelection.current = true;
      setActiveProviders(normalizedProviders);
    }

    setExecutionMode(
      snapshot.executionMode === "balanced" || snapshot.executionMode === "quality"
        ? snapshot.executionMode
        : "speed",
    );

    if (snapshot.topicId) {
      setTopicId(snapshot.topicId);
      setSelectedTopicId(snapshot.topicId);
    }
    if (snapshot.promptId) {
      setPromptId(snapshot.promptId);
    }

    if (Array.isArray(snapshot.results) && snapshot.results.length > 0) {
      setResults(snapshot.results);
    } else if (Array.isArray(snapshot.candidates) && snapshot.candidates.length > 0) {
      setResults(buildPendingDomainResults(snapshot.candidates));
    }

    if (snapshot.providerUsage) setProviderUsage(snapshot.providerUsage);
    setResponseTimeMs(typeof snapshot.responseTimeMs === "number" ? snapshot.responseTimeMs : null);
    if (Array.isArray(snapshot.statusSteps) && snapshot.statusSteps.length > 0) {
      setStatusSteps(snapshot.statusSteps);
    }
  }, [buildPendingDomainResults]);

  const buildRestoreDraft = useCallback((): SearchRestoreDraft => ({
    query,
    selectedTopicId,
    activeProviders,
    minLength,
    maxLength,
    domainCount,
    brandTone,
    audience,
    industry,
    styleKeywords,
    forbiddenWords,
    mustIncludeWords,
    language,
    country,
    executionMode,
    results,
    statusSteps,
    responseTimeMs,
    promptId,
    topicId,
    providerUsage,
  }), [
    query,
    selectedTopicId,
    activeProviders,
    minLength,
    maxLength,
    domainCount,
    brandTone,
    audience,
    industry,
    styleKeywords,
    forbiddenWords,
    mustIncludeWords,
    language,
    country,
    executionMode,
    results,
    statusSteps,
    responseTimeMs,
    promptId,
    topicId,
    providerUsage,
  ]);

  const savePendingAuthPayload = useCallback((pendingDomain: string) => {
    const payload: PendingAuthSavePayload = {
      createdAt: new Date().toISOString(),
      pendingDomain,
      draft: buildRestoreDraft(),
    };

    sessionStorage.setItem("domain-search.pending-auth-save", JSON.stringify(payload));
  }, [buildRestoreDraft]);

  const normalizeProviderList = useCallback((value: unknown): ModelProvider[] => {
    if (!Array.isArray(value)) return [];
    const normalized = value.filter(
      (item): item is ModelProvider =>
        item === "groq" || item === "grok" || item === "gemini" || item === "openai" || item === "huggingface",
    );
    return [...new Set(normalized)];
  }, []);

  useEffect(() => {
    const currentSessionUserId = session?.user?.id ?? null;
    if (previousSessionUserId.current !== currentSessionUserId) {
      previousSessionUserId.current = currentSessionUserId;
      hasHydratedProviderSelection.current = false;
      if (!currentSessionUserId) {
        hasDraftProviderSelection.current = false;
      }
    }

    if (hasHydratedProviderSelection.current) return;

    if (hasDraftProviderSelection.current) {
      hasHydratedProviderSelection.current = true;
      return;
    }

    if (currentSessionUserId) {
      if (settings.userId !== currentSessionUserId) return;
      const normalized = normalizeProviderList(settings.providerOrder);
      setActiveProviders(normalized.length > 0 ? normalized : ["groq"]);
      hasHydratedProviderSelection.current = true;
      return;
    }

    try {
      const raw = localStorage.getItem("domain-search.active-providers");
      if (!raw) {
        hasHydratedProviderSelection.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeProviderList(parsed);
      if (normalized.length > 0) {
        setActiveProviders(normalized);
      }
    } catch {
      localStorage.removeItem("domain-search.active-providers");
    } finally {
      hasHydratedProviderSelection.current = true;
    }
  }, [normalizeProviderList, session?.user?.id, settings.providerOrder, settings.userId]);

  useEffect(() => {
    if (session?.user?.id) return;

    try {
      localStorage.setItem("domain-search.active-providers", JSON.stringify(activeProviders));
    } catch {
      // ignore storage write errors
    }
  }, [activeProviders, session?.user?.id]);

  const restoreFromDraft = useCallback((draft: SearchRestoreDraft) => {
    hasDraftProviderSelection.current = true;
    hasHydratedProviderSelection.current = true;
    setMainView("search");
    setQuery(draft.query ?? "");
    setSelectedTopicId(draft.selectedTopicId);

    const normalizedProviders = normalizeProviderList(draft.activeProviders);
    setActiveProviders(normalizedProviders.length > 0 ? normalizedProviders : ["groq"]);

    setMinLength(typeof draft.minLength === "number" ? draft.minLength : 4);
    setMaxLength(typeof draft.maxLength === "number" ? draft.maxLength : 12);
    setDomainCount(typeof draft.domainCount === "number" ? draft.domainCount : 12);

    setBrandTone(draft.brandTone ?? "");
    setAudience(draft.audience ?? "");
    setIndustry(draft.industry ?? "");
    setStyleKeywords(draft.styleKeywords ?? "");
    setForbiddenWords(draft.forbiddenWords ?? "");
    setMustIncludeWords(draft.mustIncludeWords ?? "");
    setLanguage(draft.language ?? "");
    setCountry(draft.country ?? "");
    setExecutionMode(
      draft.executionMode === "balanced" || draft.executionMode === "quality"
        ? draft.executionMode
        : "speed",
    );

    setResults(Array.isArray(draft.results) ? draft.results : []);
    setStatusSteps(Array.isArray(draft.statusSteps) ? draft.statusSteps : []);
    setResponseTimeMs(typeof draft.responseTimeMs === "number" ? draft.responseTimeMs : null);
    setPromptId(draft.promptId ?? null);
    setTopicId(draft.topicId ?? null);
    setProviderUsage(draft.providerUsage ?? null);
  }, [normalizeProviderList]);

  useEffect(() => {
    if (!loading) return;

    setActiveStatusIndex(0);
    const interval = setInterval(() => {
      setActiveStatusIndex((current) => {
        if (statusSteps.length === 0) return 0;
        return Math.min(current + 1, statusSteps.length - 1);
      });
    }, 900);

    return () => clearInterval(interval);
  }, [loading, statusSteps]);

  const providerNeedsApiKey = useCallback(
    (provider: ModelProvider): boolean =>
      provider === "groq" || provider === "gemini" || provider === "openai" || provider === "huggingface" || provider === "grok",
    [],
  );

  const findMissingApiKeys = useCallback(
    (providerList: ModelProvider[]): ModelProvider[] =>
      providerList
        .filter(providerNeedsApiKey)
        .filter((provider) => !apiKeyMetadata[provider]?.hasKey),
    [providerNeedsApiKey, apiKeyMetadata],
  );

  const redirectToSignIn = useCallback((requiredProviders: ModelProvider[] = [], nextPath = "/") => {
    const params = new URLSearchParams();
    params.set("next", nextPath);
    if (requiredProviders.length > 0) {
      params.set("requiredProviders", [...new Set(requiredProviders)].join(","));
    }
    router.push(`/sign-in?${params.toString()}`);
  }, [router]);

  const resumeSave = searchParams.get("resumeSave") === "1";

  useEffect(() => {
    if (pathname === "/history") {
      setMainView("history");
      return;
    }
    if (pathname === "/settings") {
      setMainView("settings");
      return;
    }

    const requestedView = searchParams.get("view");
    if (requestedView === "history") {
      setMainView("history");
      return;
    }
    if (requestedView === "settings") {
      setMainView("settings");
      return;
    }
    setMainView("search");
  }, [pathname, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;

    const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const hasSupabaseAuthParams =
      normalizedHash.includes("access_token=")
      || normalizedHash.includes("refresh_token=")
      || normalizedHash.includes("type=");

    if (!hasSupabaseAuthParams) return;

    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const supabase = await getBrowserSupabaseClient();
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const apiRequest = useCallback(async (url: string, init?: RequestInit) => {
    const token = await getAccessToken();
    const headers = new Headers(init?.headers ?? {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }, [getAccessToken]);

  const loadRecentMemories = useCallback(async () => {
    const response = await apiRequest("/api/session/recent?limit=10");
    if (!response.ok) return;
    const data = await response.json() as { memories?: SearchMemorySnapshot[] };
    setRecentMemories(Array.isArray(data.memories) ? data.memories : []);
  }, [apiRequest]);

  const clearSearchDraft = useCallback(async () => {
    setQuery("");
    setSelectedTopicId(undefined);
    setActiveProviders(["groq"]);
    setExecutionMode("speed");
    setMinLength(4);
    setMaxLength(12);
    setDomainCount(12);
    setBrandTone("");
    setAudience("");
    setIndustry("");
    setStyleKeywords("");
    setForbiddenWords("");
    setMustIncludeWords("");
    setLanguage("");
    setCountry("");
    setResults([]);
    setPromptId(null);
    setTopicId(null);
    setStatusSteps([]);
    setActiveStatusIndex(0);
    setProviderUsage(null);
    setResponseTimeMs(null);
    setLoading(false);

    try {
      localStorage.removeItem("domain-search.last-memory");
      localStorage.setItem(SKIP_AUTO_RESTORE_KEY, "1");
      await apiRequest("/api/session/last", { method: "DELETE" });
      await loadRecentMemories();
      pushToast("Draft and latest memory cleared.", "success");
    } catch {
      pushToast("Cleared local draft. Server memory clear failed.", "error");
    }
  }, [apiRequest, loadRecentMemories, pushToast]);

  useEffect(() => {
    if (hasHydratedLatestSearch.current) return;
    if (resumeSave) return;

    const shouldSkipAutoRestore = localStorage.getItem(SKIP_AUTO_RESTORE_KEY) === "1";
    if (shouldSkipAutoRestore) {
      hasHydratedLatestSearch.current = true;
      return;
    }

    if (query.trim().length > 0 || results.length > 0) {
      hasHydratedLatestSearch.current = true;
      return;
    }

    void (async () => {
      try {
        const response = await apiRequest("/api/session/last");
        if (response.ok) {
          const payload = (await response.json()) as { latest?: SearchMemorySnapshot | null };
          if (payload.latest?.prompt) {
            applyLatestSearchMemory(payload.latest);
            hasHydratedLatestSearch.current = true;
            return;
          }
        }
      } catch {
        // fallback below
      }

      try {
        const raw = localStorage.getItem("domain-search.last-memory");
        if (!raw) {
          hasHydratedLatestSearch.current = true;
          return;
        }

        const parsed = JSON.parse(raw) as SearchMemorySnapshot;
        if (parsed?.prompt) {
          applyLatestSearchMemory(parsed);
        }
      } catch {
        localStorage.removeItem("domain-search.last-memory");
      } finally {
        hasHydratedLatestSearch.current = true;
      }
    })();
  }, [apiRequest, applyLatestSearchMemory, query, results.length, resumeSave]);

  const refreshHistory = useCallback(async () => {
    historyAbortControllerRef.current?.abort();
    const controller = new AbortController();
    historyAbortControllerRef.current = controller;
    const requestId = historyRequestIdRef.current + 1;
    historyRequestIdRef.current = requestId;

    setHistoryBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(historyPage));
      params.set("pageSize", String(historyPageSize));
      if (debouncedHistorySearch.trim()) params.set("q", debouncedHistorySearch.trim());

      const response = await apiRequest(`/api/history?${params.toString()}`, {
        signal: controller.signal,
      });
      if (requestId !== historyRequestIdRef.current) return;
      if (!response.ok) return;
      const data = await response.json();
      setTopics((current) => {
        const incoming = Array.isArray(data.topics) ? (data.topics as TopicSummary[]) : [];
        if (incoming.length === 0) return incoming;

        const currentById = new Map(current.map((topic) => [topic.id, topic]));

        return incoming.map((topic) => {
          const previous = currentById.get(topic.id);
          const incomingProviders = Array.isArray(topic.latestProviders)
            ? topic.latestProviders.filter((provider): provider is ModelProvider =>
              provider === "groq"
              || provider === "grok"
              || provider === "gemini"
              || provider === "openai"
              || provider === "huggingface",
            )
            : [];

          if (incomingProviders.length > 0) {
            return {
              ...topic,
              latestProviders: incomingProviders,
            };
          }

          return {
            ...topic,
            latestProviders: previous?.latestProviders ?? [],
          };
        });
      });
      setHistoryTotal(typeof data.total === "number" ? data.total : 0);
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") return;
    } finally {
      if (requestId === historyRequestIdRef.current) {
        setHistoryBusy(false);
      }
    }
  }, [apiRequest, debouncedHistorySearch, historyPage]);

  const fetchSettings = useCallback(async () => {
    const response = await apiRequest("/api/settings");
    if (!response.ok) return;
    const data = await response.json();
    const incoming = (data.settings ?? defaultSettings) as UserSettings;
    setSettings(incoming);
  }, [apiRequest]);

  const fetchApiKeys = useCallback(async () => {
    const response = await apiRequest("/api/api-keys");
    if (!response.ok) return;
    const data = await response.json();
    setApiKeyMetadata((data.apiKeyMetadata ?? {}) as ProviderApiKeyMetadataMap);
  }, [apiRequest]);

  const persistProviderSelectionForUser = useCallback(async (providerList: ModelProvider[]) => {
    if (!session?.user?.id) return;

    const normalized = normalizeProviderList(providerList);
    const providerOrder = normalized.length > 0 ? normalized : ["groq"];
    const defaultProvider = providerOrder.includes(settings.defaultProvider)
      ? settings.defaultProvider
      : providerOrder[0];

    const response = await apiRequest("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultProvider,
        providerOrder,
      }),
    });

    if (!response.ok) return;
    const data = await response.json();
    setSettings(data.settings as UserSettings);
  }, [apiRequest, normalizeProviderList, session?.user?.id, settings.defaultProvider]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedHistorySearch(historySearch.trim());
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [historySearch]);

  useEffect(() => {
    return () => {
      historyAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void fetchSettings();
    void fetchApiKeys();

    void (async () => {
      const supabase = await getBrowserSupabaseClient();
      if (!supabase || !active) {
        setSession(null);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (active) {
        setSession(data.session ?? null);
      }

      const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        void fetchSettings();
        void fetchApiKeys();
        void refreshHistory();
        void loadRecentMemories();
      });

      unsubscribe = () => authSubscription.subscription.unsubscribe();
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [fetchApiKeys, fetchSettings, loadRecentMemories, refreshHistory]);

  useEffect(() => {
    void loadRecentMemories();
  }, [loadRecentMemories]);

  const loadTopicDetails = useCallback(async (id: string) => {
    if (topicDetails[id]) return topicDetails[id];

    const response = await apiRequest(`/api/history?topicId=${encodeURIComponent(id)}`);
    if (!response.ok) return null;

    const data = await response.json();
    const topic = data.topic as TopicDetailsResponse;
    const memoryByPrompt = (data.memoryByPrompt ?? {}) as Record<string, SearchMemorySnapshot>;

    setTopicDetails((current) => ({ ...current, [id]: topic }));
    setTopicMemoryByPrompt((current) => ({ ...current, [id]: memoryByPrompt }));
    return topic;
  }, [apiRequest, topicDetails]);

  useEffect(() => {
    const activeTopicId = topicId ?? selectedTopicId;
    if (!activeTopicId) return;
    if (topicDetails[activeTopicId]) return;
    void loadTopicDetails(activeTopicId);
  }, [loadTopicDetails, selectedTopicId, topicDetails, topicId]);

  const toggleHistoryCollapse = useCallback(async (id: string) => {
    if (!topicDetails[id]) {
      await loadTopicDetails(id);
    }
    setExpandedTopics((current) => ({
      ...current,
      [id]: !(current[id] ?? false),
    }));
  }, [loadTopicDetails, topicDetails]);

  const openTopicInSearch = useCallback(async (id: string) => {
    const details = topicDetails[id] ?? await loadTopicDetails(id);
    if (!details?.prompts?.length) return;

    const latestPrompt = details.prompts[details.prompts.length - 1];
    if (!latestPrompt) return;

    const promptMemory = topicMemoryByPrompt[id]?.[latestPrompt.id];
    const fallbackSnapshot: Partial<SearchMemorySnapshot> = {
      id: crypto.randomUUID(),
      topicId: id,
      promptId: latestPrompt.id,
      prompt: latestPrompt.prompt,
      responseTimeMs: latestPrompt.responseTimeMs,
      statusSteps: ["Loaded from history"],
      candidates: latestPrompt.results.map((item) => item.domain),
      results: latestPrompt.results.map((item) => ({ ...item, isAI: true })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionMode: "speed",
      constraints: {
        minLength: 4,
        maxLength: 12,
        count: Math.max(4, latestPrompt.results.length),
        tlds: inferRelevantTlds({
          seedText: latestPrompt.prompt,
          preferred: latestPrompt.results
            .map((item) => item.domain)
            .map((domain) => domain.slice(domain.lastIndexOf(".")))
            .filter((tld) => tld.startsWith(".")),
        }),
      },
      intent: {},
      providerOrder: ["groq", "grok", "gemini", "openai", "huggingface"],
    };

    const snapshotToStore = promptMemory ?? (fallbackSnapshot as SearchMemorySnapshot);
    pushToast("Opening saved search...", "info");
    let activatedOnServer = false;
    try {
      const response = await apiRequest("/api/session/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: snapshotToStore.topicId,
          promptId: snapshotToStore.promptId,
          prompt: snapshotToStore.prompt,
          responseTimeMs: snapshotToStore.responseTimeMs,
          intent: snapshotToStore.intent,
          constraints: snapshotToStore.constraints,
          providerOrder: snapshotToStore.providerOrder,
          executionMode: snapshotToStore.executionMode,
          providerUsage: snapshotToStore.providerUsage,
          statusSteps: snapshotToStore.statusSteps,
          candidates: snapshotToStore.candidates,
          results: snapshotToStore.results,
        }),
      });
      activatedOnServer = response.ok;
    } catch {
      // fallback to local snapshot below
    }

    localStorage.setItem("domain-search.last-memory", JSON.stringify(snapshotToStore));
    localStorage.removeItem(SKIP_AUTO_RESTORE_KEY);
    if (activatedOnServer) {
      pushToast("Search restored.", "success");
    } else {
      pushToast("Opened with local fallback. Server restore unavailable.", "error");
    }
    router.push("/");
  }, [apiRequest, loadTopicDetails, pushToast, router, topicDetails, topicMemoryByPrompt]);

  const deleteTopicFromHistory = useCallback(async (id: string) => {
    pushToast("Deleting history entry...", "info");
    const response = await apiRequest(`/api/history?topicId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      pushToast("Failed to delete history entry.", "error");
      return;
    }

    setTopicDetails((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTopicMemoryByPrompt((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setExpandedTopics((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    if (selectedTopicId === id) {
      setSelectedTopicId(undefined);
      setTopicId(null);
      setPromptId(null);
      setProviderUsage(null);
      setResponseTimeMs(null);
      setResults([]);
    }

    await refreshHistory();
    pushToast("History entry deleted.", "success");
  }, [apiRequest, pushToast, refreshHistory, selectedTopicId]);

  const saveSelectionByIds = useCallback(async (domain: string, nextTopicId: string, nextPromptId: string) => {
    const response = await apiRequest("/api/selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicId: nextTopicId,
        promptId: nextPromptId,
        domain,
        prompt: query,
        results,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = payload?.error ?? "Failed to save selection";
      throw new Error(message);
    }

    setTopicDetails((current) => {
      const activeTopic = current[nextTopicId];
      if (!activeTopic) return current;

      let added = false;

      const nextPrompts = activeTopic.prompts.map((prompt) => {
        if (prompt.id !== nextPromptId) return prompt;
        if (prompt.selected.includes(domain)) return prompt;
        added = true;
        return { ...prompt, selected: [...prompt.selected, domain] };
      });

      return {
        ...current,
        [nextTopicId]: {
          ...activeTopic,
          selectedCount: activeTopic.selectedCount + (added ? 1 : 0),
          prompts: nextPrompts,
        },
      };
    });

    await refreshHistory();
  }, [apiRequest, query, refreshHistory, results]);

  const toggleProvider = (provider: ModelProvider) => {
    const exists = activeProviders.includes(provider);

    if (exists && activeProviders.length === 1) return;

    if (!session && providerNeedsApiKey(provider)) {
      redirectToSignIn([provider]);
      return;
    }

    const nextProviders = exists
      ? activeProviders.filter((item) => item !== provider)
      : [...activeProviders, provider];

    hasDraftProviderSelection.current = false;
    setActiveProviders(nextProviders);

    if (session) {
      void persistProviderSelectionForUser(nextProviders);
    }

    if (session) {
      const missing = findMissingApiKeys(nextProviders);
      if (missing.length > 0) {
        const params = new URLSearchParams();
        params.set("next", "/");
        params.set("missing", missing.join(","));
        router.push(`/api-keys?${params.toString()}`);
      }
    }
  };

  const saveSelection = async (domain: string) => {
    if (!session) {
      savePendingAuthPayload(domain);
      redirectToSignIn(activeProviders.filter(providerNeedsApiKey), "/?resumeSave=1");
      return;
    }

    if (!topicId || !promptId) return;

    try {
      await saveSelectionByIds(domain, topicId, promptId);
      setStatusSteps((current) => [`Saved ${domain}.`, ...current]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save selection";
      if (message.toLowerCase().includes("sign in")) {
        savePendingAuthPayload(domain);
        redirectToSignIn(activeProviders.filter(providerNeedsApiKey));
        return;
      }
      setStatusSteps((current) => [`Save failed: ${message}`, ...current]);
    }
  };

  useEffect(() => {
    if (hasRestoredPendingState.current) return;

    if (!resumeSave) {
      hasRestoredPendingState.current = true;
      return;
    }

    const raw = sessionStorage.getItem("domain-search.pending-auth-save");
    if (!raw) {
      hasRestoredPendingState.current = true;
      return;
    }

    let payload: PendingAuthSavePayload | null = null;
    try {
      payload = JSON.parse(raw) as PendingAuthSavePayload;
    } catch {
      sessionStorage.removeItem("domain-search.pending-auth-save");
      hasRestoredPendingState.current = true;
      return;
    }

    if (!payload?.draft) {
      sessionStorage.removeItem("domain-search.pending-auth-save");
      hasRestoredPendingState.current = true;
      return;
    }

    restoreFromDraft(payload.draft);
    hasRestoredPendingState.current = true;

    if (!session || !payload.pendingDomain) {
      return;
    }

    const nextTopicId = payload.draft.topicId;
    const nextPromptId = payload.draft.promptId;
    if (!nextTopicId || !nextPromptId) {
      setStatusSteps((current) => [
        "Restored your previous form and results after sign-in.",
        ...current,
      ]);
      sessionStorage.removeItem("domain-search.pending-auth-save");
      return;
    }

    void (async () => {
      try {
        await saveSelectionByIds(payload.pendingDomain, nextTopicId, nextPromptId);
        setStatusSteps((current) => [
          `Saved ${payload.pendingDomain} after sign-in.`,
          ...current,
        ]);
      } catch {
        setStatusSteps((current) => [
          `Could not auto-save ${payload.pendingDomain}. Please tap Save pick again.`,
          ...current,
        ]);
      } finally {
        sessionStorage.removeItem("domain-search.pending-auth-save");
      }
    })();
  }, [restoreFromDraft, resumeSave, saveSelectionByIds, session]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;

    const selectedProvidersNeedingKeys = activeProviders.filter(providerNeedsApiKey);

    if (!session && selectedProvidersNeedingKeys.length > 0) {
      redirectToSignIn(selectedProvidersNeedingKeys);
      return;
    }

    if (session) {
      const missing = findMissingApiKeys(activeProviders);
      if (missing.length > 0) {
        const params = new URLSearchParams();
        params.set("next", "/");
        params.set("missing", missing.join(","));
        router.push(`/api-keys?${params.toString()}`);
        return;
      }
    }

    setLoading(true);
    setStatusSteps([
      "Analyzing your prompt and intent...",
      "Generating suggested domains with selected AI models...",
      "Checking live availability in parallel...",
      "Ranking suggestions by relevance and availability...",
      "Saving prompt and results to history...",
    ]);
    setResults([]);
    setProviderUsage(null);
    setResponseTimeMs(null);

    const searchStartedAt = performance.now();

    try {
      localStorage.removeItem(SKIP_AUTO_RESTORE_KEY);
      try {
        const localSnapshot: Partial<SearchMemorySnapshot> = {
          id: "local",
          prompt: query,
          intent: {
            brandTone,
            audience,
            industry,
            styleKeywords: parseCsvInput(styleKeywords),
            forbiddenWords: parseCsvInput(forbiddenWords),
            mustIncludeWords: parseCsvInput(mustIncludeWords),
            language,
            country,
          },
          constraints: {
            minLength,
            maxLength,
            count: domainCount,
            tlds: inferRelevantTlds({ seedText: query }),
          },
          providerOrder: activeProviders,
          executionMode,
          statusSteps,
          candidates: [],
          results: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem("domain-search.last-memory", JSON.stringify(localSnapshot));
      } catch {
        // local storage is best effort only
      }

      const response = await apiRequest("/api/session?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: selectedTopicId,
          prompt: query,
          providerOrder: activeProviders,
          intent: {
            brandTone,
            audience,
            industry,
            styleKeywords: parseCsvInput(styleKeywords),
            forbiddenWords: parseCsvInput(forbiddenWords),
            mustIncludeWords: parseCsvInput(mustIncludeWords),
            language,
            country,
          },
          constraints: {
            minLength,
            maxLength,
            count: domainCount,
            tlds: inferRelevantTlds({ seedText: query }),
          },
          executionMode,
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completePayload: StreamCompletePayload | null = null;

        const processEventBlock = (block: string) => {
          const lines = block
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          let eventName = "message";
          let dataLine = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLine += line.slice("data:".length).trim();
            }
          }

          if (!dataLine) return;

          const payload = JSON.parse(dataLine) as unknown;
          if (!payload || typeof payload !== "object") return;
          const streamPayload = payload as StreamProgressPayload & StreamCompletePayload & {
            error?: string;
            details?: string;
          };

          if (eventName === "error") {
            throw new Error(streamPayload.details ?? streamPayload.error ?? "Stream request failed");
          }

          if (eventName === "progress") {
            if (streamPayload.type === "status") {
              setStatusSteps(Array.isArray(streamPayload.statusSteps) ? streamPayload.statusSteps : []);
              return;
            }

            if (streamPayload.type === "suggestions") {
              const pendingResults = Array.isArray(streamPayload.candidates)
                ? buildPendingDomainResults(streamPayload.candidates)
                : [];
              setResults(pendingResults);
              setProviderUsage(streamPayload.providerUsage ?? null);
              return;
            }

            if (streamPayload.type === "ranked_partial") {
              const partialResults = Array.isArray(streamPayload.results) ? streamPayload.results : [];
              const pendingDomains = Array.isArray(streamPayload.pendingDomains) ? streamPayload.pendingDomains : [];
              const pendingResults = buildPendingDomainResults(pendingDomains);
              setResults([...partialResults, ...pendingResults]);
              setProviderUsage(streamPayload.providerUsage ?? null);
              return;
            }

            if (streamPayload.type === "ranked") {
              setResults(Array.isArray(streamPayload.results) ? streamPayload.results : []);
              setProviderUsage(streamPayload.providerUsage ?? null);
              return;
            }

            if (streamPayload.type === "saved") {
              if (streamPayload.topicId) setTopicId(streamPayload.topicId);
              if (streamPayload.promptId) setPromptId(streamPayload.promptId);
              return;
            }
          }

          if (eventName === "complete") {
            completePayload = streamPayload;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let delimiterIndex = buffer.indexOf("\n\n");
          while (delimiterIndex !== -1) {
            const block = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + 2);
            processEventBlock(block);
            delimiterIndex = buffer.indexOf("\n\n");
          }
        }

        if (!completePayload) {
          throw new Error("Session stream ended before completion");
        }

        const finalPayload: StreamCompletePayload = completePayload;

        setResults(finalPayload.results ?? []);
        setTopicId(finalPayload.topicId ?? null);
        setPromptId(finalPayload.promptId ?? null);
        setSelectedTopicId(finalPayload.topicId ?? undefined);
        setStatusSteps(finalPayload.statusSteps ?? []);
        setProviderUsage(finalPayload.providerUsage ?? null);
        setResponseTimeMs(
          typeof finalPayload.responseTimeMs === "number"
            ? finalPayload.responseTimeMs
            : Math.max(0, Math.round(performance.now() - searchStartedAt)),
        );

        try {
          const localSnapshot: Partial<SearchMemorySnapshot> = {
            id: "local",
            topicId: finalPayload.topicId ?? undefined,
            promptId: finalPayload.promptId ?? undefined,
            prompt: query,
            intent: {
              brandTone,
              audience,
              industry,
              styleKeywords: parseCsvInput(styleKeywords),
              forbiddenWords: parseCsvInput(forbiddenWords),
              mustIncludeWords: parseCsvInput(mustIncludeWords),
              language,
              country,
            },
            constraints: {
              minLength,
              maxLength,
              count: domainCount,
              tlds: inferRelevantTlds({ seedText: query }),
            },
            providerOrder: activeProviders,
            executionMode,
            statusSteps: finalPayload.statusSteps ?? [],
            responseTimeMs:
              typeof finalPayload.responseTimeMs === "number"
                ? finalPayload.responseTimeMs
                : Math.max(0, Math.round(performance.now() - searchStartedAt)),
            candidates: finalPayload.candidates ?? [],
            results: finalPayload.results ?? [],
            providerUsage: finalPayload.providerUsage ?? undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem("domain-search.last-memory", JSON.stringify(localSnapshot));
        } catch {
          // local storage is best effort only
        }

        await Promise.all([refreshHistory(), loadRecentMemories()]);
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Request failed");
      }

      setResults(data.results ?? []);
      setTopicId(data.topicId ?? null);
      setPromptId(data.promptId ?? null);
      setSelectedTopicId(data.topicId ?? undefined);
      setStatusSteps(data.statusSteps ?? []);
      setProviderUsage(data.providerUsage ?? null);
      setResponseTimeMs(
        typeof data.responseTimeMs === "number"
          ? data.responseTimeMs
          : Math.max(0, Math.round(performance.now() - searchStartedAt)),
      );
      await Promise.all([refreshHistory(), loadRecentMemories()]);
    } catch (error) {
      console.error("Search failed:", error);
      setStatusSteps(["Failed to complete search. Try a shorter prompt or fewer constraints."]);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    const supabase = await getBrowserSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setMainView("search");
    setResults([]);
    setTopicId(null);
    setPromptId(null);
    setProviderUsage(null);
    setApiKeyMetadata({});
  };

  const saveSettings = async () => {
    setSettingsBusy(true);
    setSettingsNotice(null);

    const response = await apiRequest("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultProvider: settings.defaultProvider,
        providerOrder: settings.providerOrder,
      }),
    });

    const data = await response.json();
    setSettingsBusy(false);

    if (!response.ok) {
      setSettingsNotice(data.error ?? "Failed to save settings.");
      return;
    }

    const nextSettings = data.settings as UserSettings;
    setSettings(nextSettings);
    const normalized = normalizeProviderList(nextSettings.providerOrder);
    hasDraftProviderSelection.current = false;
    hasHydratedProviderSelection.current = true;
    setActiveProviders(normalized.length > 0 ? normalized : ["groq"]);
    setSettingsNotice("Settings saved.");
  };

  const navigate = useCallback(
    (href: string) => {
      startRouteTransition(() => {
        router.push(href);
      });
    },
    [router, startRouteTransition],
  );

  return (
    <div className="min-h-screen bg-app-hero text-white selection:bg-emerald-500/20">
      <div className="min-h-screen bg-black/45 backdrop-blur-[1px]">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-black/55 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-white/20 bg-black/60 p-2">
                <Globe className="h-4 w-4 text-emerald-300" />
              </div>
              <div>
                <h1 className="text-lg font-black tracking-tight">Dum!t</h1>
                <p className="text-xs text-white/60">Find premium domains blazingly fast</p>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-[22px] border border-white/15 bg-black/45 p-1">
              <button type="button" onClick={() => navigate("/")} className={cn("top-nav-btn", mainView === "search" && "top-nav-btn-active")}>
                <Search size={14} /> Search
              </button>
              {session && (
                <button type="button" onClick={() => navigate("/history")} className={cn("top-nav-btn", mainView === "history" && "top-nav-btn-active")}>
                  <History size={14} /> History
                </button>
              )}
              {session && (
                <button type="button" onClick={() => navigate("/settings")} className={cn("top-nav-btn", mainView === "settings" && "top-nav-btn-active")}>
                  <Settings size={14} /> Settings
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {session ? (
                <>
                  <button type="button" onClick={() => navigate("/api-keys")} className="material-btn px-3 py-2 text-xs">
                    <KeyRound size={14} /> API Keys
                  </button>
                  <button type="button" onClick={() => void signOut()} className="material-btn px-3 py-2 text-xs">
                    Sign out
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => redirectToSignIn(activeProviders.filter(providerNeedsApiKey))} className="material-btn px-3 py-2 text-xs">
                  Sign in / Sign up
                </button>
              )}
            </div>
          </div>

          <AnimatePresence initial={false}>
            {isUiBusy && (
              <motion.div
                key="global-busy-indicator"
                initial={{ opacity: 0, scaleX: 0.2 }}
                animate={{ opacity: 1, scaleX: 1 }}
                exit={{ opacity: 0, scaleX: 0.2 }}
                transition={{ duration: 0.24, ease: "easeInOut" }}
                className="mx-auto mt-3 h-0.5 max-w-6xl origin-left rounded-full bg-linear-to-r from-emerald-300/80 via-teal-300/80 to-emerald-300/80"
              />
            )}
          </AnimatePresence>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.26, ease: "easeInOut" }}
            className="mx-auto max-w-6xl space-y-8 px-6 py-10"
          >
          {mainView === "search" && (
            <>
              <section
                aria-label="SaaS hero"
                className="glass-card relative overflow-hidden p-8 md:p-10"
              >
                <div className="bg-landing-hero pointer-events-none absolute inset-0 opacity-30" />
                <div className="absolute -right-20 -top-20 h-55 w-55 rounded-full bg-emerald-600/16 blur-3xl" />
                <div className="absolute -bottom-22.5 -left-20 h-55 w-55 rounded-full bg-teal-600/12 blur-3xl" />

                <div className="relative grid gap-7 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-5">
                    <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-4 py-1 text-xs uppercase tracking-[0.18em] text-white/70">
                      <Sparkles size={12} /> AI domain name generator for modern SaaS teams
                    </p>
                    <h2 className="text-4xl font-black leading-tight md:text-5xl">
                      Find high-converting startup domains with an
                      <span className="text-emerald-300"> AI-powered naming workflow</span>
                    </h2>
                    <p className="max-w-2xl text-sm text-white/70 md:text-base">
                      Dum!t is a conversion-first domain discovery platform: generate brandable name ideas, run real-time domain availability checks,
                      and shortlist winners your team can register instantly.
                    </p>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {landingStats.map((stat, index) => (
                        <div
                          key={stat.label}
                          className={cn("rounded-[18px] border px-4 py-3", pickPaletteTone(index, 0))}
                        >
                          <p className="text-xl font-black text-white">{stat.value}</p>
                          <p className="text-xs uppercase tracking-[0.12em] text-white/55">{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <motion.form
                    id="domain-search-form"
                    onSubmit={handleSearch}
                    initial={{ opacity: 0.85, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3 rounded-3xl border border-white/15 bg-black/45 p-5 backdrop-blur-xl"
                  >
                    <p className="text-xs uppercase tracking-[0.14em] text-emerald-200/90">Start domain research</p>
                    <MaterialField
                      label="What are you naming?"
                      value={query}
                      onChange={setQuery}
                      placeholder="Describe your startup, product, niche, or brand positioning"
                      hint="Example: AI CRM for e-commerce brands"
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <motion.button
                        disabled={loading}
                        type="submit"
                        whileHover={{ y: -1, scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 320, damping: 22 }}
                        className="material-btn justify-center"
                      >
                        {loading ? <Clock3 size={16} /> : <Sparkles size={16} />}
                        {loading ? "Generating..." : "Generate"}
                      </motion.button>

                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void clearSearchDraft()}
                        className="rounded-[18px] border border-white/20 bg-black/45 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-black/65 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="space-y-2">
                      <ProviderMultiDropdown
                        label="Selection Models"
                        value={activeProviders}
                        onToggle={toggleProvider}
                      />
                      <ExecutionModeDropdown
                        label="Execution Mode"
                        value={executionMode}
                        onSelect={setExecutionMode}
                      />
                    </div>

                    <motion.button
                      type="button"
                      onClick={() => setShowAdvancedFilters((current) => !current)}
                      whileTap={{ scale: 0.96 }}
                      className="material-btn w-full justify-center rounded-full"
                    >
                      {showAdvancedFilters ? "Hide extra filters" : "Show extra filters"}
                      <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedFilters && "rotate-180")} />
                    </motion.button>

                    <AnimatePresence initial={false}>
                      {showAdvancedFilters && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.24, ease: "easeInOut" }}
                          className="space-y-3 overflow-hidden"
                        >
                          <div className="grid gap-3 md:grid-cols-3">
                            <MaterialField label="Min letters" type="number" min={2} max={20} value={minLength} onChange={(value) => setMinLength(Number(value))} hint="Shorter names are often more brandable" />
                            <MaterialField label="Max letters" type="number" min={3} max={24} value={maxLength} onChange={(value) => setMaxLength(Number(value))} hint="Keep concise for memorability" />
                            <MaterialField label="Suggestions" type="number" min={3} max={24} value={domainCount} onChange={(value) => setDomainCount(Number(value))} hint="More ideas = broader exploration" />
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <MaterialField label="Brand tone" value={brandTone} onChange={setBrandTone} placeholder="premium, playful, trusted" hint="How your brand should feel" />
                            <MaterialField label="Audience" value={audience} onChange={setAudience} placeholder="founders, creators, developers" hint="Who the name should resonate with" />
                            <MaterialField label="Industry" value={industry} onChange={setIndustry} placeholder="saas, ai, fintech" hint="Adds category relevance to suggestions" />
                            <MaterialField label="Style keywords (csv)" value={styleKeywords} onChange={setStyleKeywords} placeholder="minimal, bold, futuristic" hint="Comma-separated descriptors" />
                            <MaterialField label="Must include (csv)" value={mustIncludeWords} onChange={setMustIncludeWords} placeholder="flow, stack, loop" hint="Optional concepts to include" />
                            <MaterialField label="Forbidden (csv)" value={forbiddenWords} onChange={setForbiddenWords} placeholder="cheap, random, adult" hint="Words to avoid in outputs" />
                            <MaterialField label="Language" value={language} onChange={setLanguage} placeholder="English" hint="Helpful for localization" />
                            <MaterialField label="Country / market" value={country} onChange={setCountry} placeholder="US, EU, Global" hint="Target market context" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                      <span className="rounded-full border border-white/20 bg-black/35 px-2.5 py-1">No signup required to explore</span>
                      <span className="rounded-full border border-white/20 bg-black/35 px-2.5 py-1">Bring your own model keys</span>
                      <span className="rounded-full border border-white/20 bg-black/35 px-2.5 py-1">Live availability checks</span>
                    </div>
                  </motion.form>
                </div>
              </section>

              <section aria-label="Feature value proposition" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {landingFeatureCards.map((card, index) => (
                  <MotionWrapper
                    key={card.title}
                    whileHover={{ y: -3, scale: 1.01 }}
                    whileTap={{ scale: 0.995 }}
                    transition={{ type: "spring", stiffness: 280, damping: 20 }}
                    className={cn("feature-card", pickPaletteTone(index, 1))}
                  >
                    <p className="feature-title">{card.title}</p>
                    <p className="feature-text">{card.description}</p>
                  </MotionWrapper>
                ))}
              </section>
            </>
          )}

          {mainView === "search" && (
            <>
              <MotionWrapper
                initial={{ opacity: 0.9, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card relative z-40 flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <p className="text-sm text-white/80">Run new searches from the hero form for full controls and advanced filters.</p>
                <button
                  type="button"
                  onClick={() => setMainView("search")}
                  className="material-btn"
                >
                  Back to hero search
                </button>
              </MotionWrapper>

              {(loading || results.length > 0 || recentMemories.length > 0) && (
                <section className="relative z-10 grid gap-4 lg:grid-cols-[1fr_320px]">
                  <div className="space-y-3">
                    {loading && (
                      <div className="glass-card p-4">
                        <div className="mb-2 flex items-center gap-2 text-emerald-200">
                          <Clock3 size={16} />
                          <span className="text-sm">Running domain discovery workflow</span>
                        </div>
                        <div className="space-y-2 text-sm text-white/75">
                          {statusSteps.map((step, index) => {
                            const isDone = index < activeStatusIndex;
                            const isActive = index === activeStatusIndex;

                            return (
                              <motion.div
                                key={`${step}-${index}`}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.2, delay: index * 0.03 }}
                                className={cn(
                                  "rounded-[14px] border px-3 py-2",
                                  isDone && "border-emerald-300/40 bg-emerald-500/10 text-emerald-100",
                                  isActive && "border-emerald-300/45 bg-emerald-500/10 text-emerald-100 animate-pulse",
                                  !isDone && !isActive && "border-white/15 bg-black/25 text-white/60",
                                )}
                              >
                                <span className="mr-2 text-xs uppercase tracking-widest">
                                  {isDone ? "Done" : isActive ? "Doing now" : "Queued"}
                                </span>
                                {step}
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!loading && results.length === 0 && noResultsMessage && (
                      <div className="glass-card border-amber-300/35 bg-amber-500/10 p-4 text-amber-100">
                        <p className="text-sm font-semibold">No results yet</p>
                        <p className="mt-1 text-xs text-amber-100/85">{noResultsMessage}</p>
                      </div>
                    )}

                    {results.map((res, index) => {
                      const isSaved = savedDomainsForCurrentTopic.has(res.domain.toLowerCase());

                      return (
                        <motion.div
                        key={res.domain}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.2), ease: "easeOut" }}
                        className={cn("glass-card flex items-start justify-between gap-4 p-5", res.available ? "border-green-400/30" : "border-white/10")}
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn("mt-0.5 rounded-full p-2", res.pending ? "bg-slate-500/25 text-slate-200" : res.available ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/40")}>
                              {res.pending ? <Clock3 size={16} /> : res.available ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-lg font-semibold">{res.domain}</p>
                                {isSaved && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                                    <BookmarkCheck size={12} /> Saved
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-white/55">{res.reason}</p>
                              <p className="mt-1 text-xs text-emerald-100/85">score: {res.score.toFixed(2)} • source: {res.source}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {res.available && !res.pending && (
                              <button
                                type="button"
                                onClick={() => void saveSelection(res.domain)}
                                disabled={isSaved}
                                title={isSaved ? "Already saved in history" : "Save pick to history"}
                                aria-label={isSaved ? `Already saved ${res.domain}` : `Save ${res.domain} to history`}
                                className={cn(
                                  "material-btn h-9 w-9 justify-center px-0 py-0",
                                  isSaved && "cursor-not-allowed border-emerald-300/45 bg-emerald-500/18 text-emerald-100 opacity-80",
                                )}
                              >
                                {isSaved ? <BookmarkCheck size={15} /> : <BookmarkPlus size={15} />}
                              </button>
                            )}
                            <a
                              href={`https://www.namecheap.com/domains/registration/results/?domain=${res.domain}`}
                              target="_blank"
                              rel="noreferrer"
                              title={`Register ${res.domain}`}
                              aria-label={`Register ${res.domain}`}
                              className="material-btn h-9 w-9 justify-center px-0 py-0"
                            >
                              <ExternalLink size={15} />
                            </a>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  <aside className="glass-card h-fit p-4">
                    <p className="text-sm font-semibold">Results Summary</p>
                    <div className="mt-3 space-y-2 text-xs text-white/75">
                      <p>Available: {activeAvailable.length}</p>
                      <p>Unavailable: {unavailableCount}</p>
                      <p>Total: {results.length}</p>
                      <p>Current topic picks: {topics.find((topic) => topic.id === topicId)?.selectedCount ?? 0}</p>
                      <p>Mode used: {providerUsage ? providerUsage.executionMode : executionMode}</p>
                      <p>
                        Models used: {providerUsage ? providerUsage.modelsExecutedCount : 0}
                        {providerUsage ? ` / ${providerUsage.modelsSelectedCount}` : ""}
                      </p>
                      <p>Estimated AI cost: {formattedTotalCost}</p>
                      <p>Response time: {responseTimeMs !== null ? `${(responseTimeMs / 1000).toFixed(2)}s` : "-"}</p>
                    </div>

                    {providerUsage && (
                      <div className="mt-4 space-y-2">
                        <p className="text-xs uppercase tracking-[0.12em] text-white/55">Models run</p>
                        {grokFallbackModel && (
                          <p className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                            Grok fallback used: {grokFallbackModel}
                          </p>
                        )}
                        {providerUsage.providersTried.map((run, index) => (
                          <div
                            key={`${run.provider}-${run.model}-${index}`}
                            className={cn(
                              "rounded-[14px] border px-3 py-2 text-xs",
                              run.status === "success"
                                ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                : "border-red-300/35 bg-red-500/10 text-red-100",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <ProviderLogo provider={run.provider} sizeClassName="h-4 w-4" className="inline-flex items-center" />
                                <span className="font-semibold">{providerLabel(run.provider)}</span>
                              </div>
                              <span>${run.estimatedCostUsd.toFixed(6)}</span>
                            </div>
                            <p className="mt-1 text-[11px] opacity-85">{run.model}</p>
                            {run.error && <p className="mt-1 text-[11px] opacity-80">{run.error}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.12em] text-white/60">Recent Memories</p>
                        <button
                          type="button"
                          onClick={() => navigate("/memories")}
                          className="rounded-xl border border-white/20 bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-black/60"
                        >
                          Manage Memories
                        </button>
                      </div>

                      {recentMemories.length === 0 ? (
                        <p className="text-xs text-white/55">No recent memories saved yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {recentMemories.slice(0, 10).map((memory) => (
                            <button
                              key={memory.id}
                              type="button"
                              onClick={() => {
                                applyLatestSearchMemory(memory);
                                localStorage.setItem("domain-search.last-memory", JSON.stringify(memory));
                                localStorage.removeItem(SKIP_AUTO_RESTORE_KEY);
                                pushToast("Memory loaded into form.", "success");
                              }}
                              className="w-full rounded-[14px] border border-white/15 bg-black/35 px-3 py-2 text-left transition hover:bg-black/55"
                            >
                              <p className="line-clamp-2 text-xs font-semibold text-white/90">{memory.prompt}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                                <span>{new Date(memory.updatedAt).toLocaleString()}</span>
                                <span>•</span>
                                <span>{memory.executionMode}</span>
                                {typeof memory.responseTimeMs === "number" && (
                                  <>
                                    <span>•</span>
                                    <span>{(memory.responseTimeMs / 1000).toFixed(2)}s</span>
                                  </>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/75">
                                  <span>Model</span>
                                  <ProviderLogo
                                    provider={memory.providerUsage?.providerUsed ?? memory.providerOrder?.[0] ?? "groq"}
                                    sizeClassName="h-3.5 w-3.5"
                                    className="inline-flex items-center"
                                  />
                                </span>
                                <span className="rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/75">
                                  Results {memory.results.length}
                                </span>
                                <span className="rounded-full border border-emerald-300/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                                  Available {memory.results.filter((item) => item.available).length}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </aside>
                </section>
              )}

              <section aria-label="How it works" className="grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "Describe your brand",
                    text: "Add tone, audience, and style signals so generated domain names match your market positioning.",
                  },
                  {
                    title: "Generate and validate",
                    text: "Run multi-model generation and domain availability checks in one flow—no copy/paste between tools.",
                  },
                  {
                    title: "Shortlist and register",
                    text: "Save top picks, compare options later, and jump to registrar pages when your team is ready to buy.",
                  },
                ].map((step, index) => (
                  <article key={step.title} className="glass-card p-5">
                    <p className="text-xs uppercase tracking-[0.14em] text-emerald-200">Step {index + 1}</p>
                    <h3 className="mt-1 text-lg font-bold text-white">{step.title}</h3>
                    <p className="mt-2 text-sm text-white/70">{step.text}</p>
                  </article>
                ))}
              </section>

              <section aria-label="SEO frequently asked questions" className="glass-card tone-mix space-y-4 p-6">
                <p className="text-xs uppercase tracking-[0.14em] text-emerald-200">FAQ</p>
                <h3 className="text-2xl font-black text-white">AI domain name generator FAQ</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  {seoFaq.map((item, index) => (
                    <article
                      key={item.question}
                      className={cn("rounded-[20px] border bg-black/30 p-4", pickPaletteTone(index, 2))}
                    >
                      <h4 className="text-sm font-semibold text-white">{item.question}</h4>
                      <p className="mt-2 text-xs leading-relaxed text-white/70">{item.answer}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="glass-card tone-mix flex flex-col items-start justify-between gap-4 p-6 md:flex-row md:items-center">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-emerald-200">Ready to launch</p>
                  <h3 className="text-2xl font-black text-white">Get your next brandable domain shortlist in minutes</h3>
                  <p className="mt-1 text-sm text-white/70">Built for startup founders, growth teams, builders, and agencies.</p>
                </div>
                <button
                  type="button"
                  onClick={() => document.getElementById("domain-search-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="material-btn"
                >
                  Start free domain research
                </button>
              </section>
            </>
          )}

          {mainView === "history" && session && (
            <section className="glass-card space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-semibold">Grouped Prompt History</p>
                <div className="w-full max-w-70">
                  <MaterialField
                    label="Search history"
                    value={historySearch}
                    onChange={(value) => {
                      setHistorySearch(value);
                      setHistoryPage(1);
                    }}
                    placeholder="Find a previous prompt"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <AnimatePresence initial={false}>
                  {historyBusy && (
                    <motion.div
                      key="history-busy"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="rounded-[14px] border border-emerald-300/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100"
                    >
                      Updating history…
                    </motion.div>
                  )}
                </AnimatePresence>

                {Object.entries(groupedTopics).map(([groupName, groupItems]) => (
                  <div key={groupName} className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.15em] text-white/55">{groupName}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                          {groupItems.map((topic, index) => {
                        const details = topicDetails[topic.id];
                        const latestPrompt = details?.prompts?.[details.prompts.length - 1];
                        const isExpanded = expandedTopics[topic.id] ?? false;
                        const selectedDomains = latestPrompt?.selected ?? [];
                        const latestPromptMemory = latestPrompt ? topicMemoryByPrompt[topic.id]?.[latestPrompt.id] : undefined;
                        const promptResponseTimeMs = latestPromptMemory?.responseTimeMs
                          ?? latestPrompt?.responseTimeMs
                          ?? topic.latestResponseTimeMs;
                        const cardProviders = latestPromptMemory?.providerUsage?.providersTried
                          ?.map((run) => run.provider)
                          .filter((provider, providerIndex, current) => current.indexOf(provider) === providerIndex)
                          ?? [];
                        const providersForSummary = cardProviders.length > 0
                          ? cardProviders
                          : (topic.latestProviders ?? []);

                        return (
                          <motion.div
                            key={topic.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: Math.min(index * 0.025, 0.18), ease: "easeOut" }}
                            className={cn(
                              "rounded-[20px] border bg-black/35 p-3 transition-all",
                              pickPaletteTone(index, 3),
                              selectedTopicId === topic.id
                                ? "border-emerald-300/45 shadow-[0_0_0_1px_rgba(110,231,183,0.35)]"
                                : "border-white/10",
                            )}
                          >
                            <p className="line-clamp-2 text-sm text-white/90">{topic.latestPrompt}</p>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                                  Saved picks {topic.selectedCount}
                                </span>
                                <span className="rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                                  Response {typeof promptResponseTimeMs === "number" ? `${(promptResponseTimeMs / 1000).toFixed(2)}s` : "-"}
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                                  <span>Models</span>
                                  {providersForSummary.length > 0 ? (
                                    <span className="inline-flex items-center gap-1">
                                      {providersForSummary.map((provider) => (
                                        <ProviderLogo
                                          key={`${topic.id}-${provider}`}
                                          provider={provider}
                                          sizeClassName="h-3.5 w-3.5"
                                          className="inline-flex items-center"
                                        />
                                      ))}
                                    </span>
                                  ) : (
                                    <span>-</span>
                                  )}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => void toggleHistoryCollapse(topic.id)}
                                className="rounded-full border border-white/20 bg-black/45 p-2 text-white/80 transition hover:bg-black/65"
                                aria-label={isExpanded ? "Collapse saved picks" : "Expand saved picks"}
                                title={isExpanded ? "Collapse saved picks" : "Expand saved picks"}
                              >
                                <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                              </button>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openTopicInSearch(topic.id)}
                                className="material-btn px-3 py-2 text-xs"
                              >
                                Open Search
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const confirmed = window.confirm("Delete this history entry and all saved picks?");
                                  if (!confirmed) return;
                                  void deleteTopicFromHistory(topic.id);
                                }}
                                className="inline-flex items-center gap-2 rounded-[14px] border border-red-300/35 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/25"
                                aria-label="Delete history entry"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>

                            {details && isExpanded && (
                              <div className="mt-3 space-y-2 rounded-[14px] border border-white/15 bg-black/30 p-3">
                                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Saved Picks</p>
                                {selectedDomains.length === 0 ? (
                                  <p className="text-xs text-white/55">No saved picks yet.</p>
                                ) : (
                                  <div className="space-y-3">
                                    {selectedDomains.map((domain) => (
                                      <div key={`${topic.id}-${domain}`} className="rounded-xl border border-white/10 bg-black/35 p-2">
                                        <p className="text-sm font-semibold text-white/90">{domain}</p>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                          {registrarProviders.map((registrar) => (
                                            <a
                                              key={`${domain}-${registrar.id}`}
                                              href={registrar.href(domain)}
                                              target="_blank"
                                              rel="noreferrer"
                                              className={cn(
                                                "rounded-xl border px-2 py-1.5 text-[11px] font-semibold",
                                                registrar.className,
                                              )}
                                            >
                                              <span className="mr-1 inline-flex items-center"><RegistrarLogo id={registrar.id} /></span>
                                              {registrar.label}
                                            </a>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {topics.length === 0 && (
                  <p className="text-sm text-white/60">No history found for this account/search query.</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-[14px] border border-white/15 bg-black/25 px-3 py-2">
                <p className="text-xs text-white/65">Page {historyPage} / {historyTotalPages} • {historyTotal} results</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                    className="rounded-xl border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= historyTotalPages}
                    onClick={() => setHistoryPage((current) => Math.min(historyTotalPages, current + 1))}
                    className="rounded-xl border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}

          {mainView === "history" && !session && (
            <section className="glass-card space-y-4 p-6">
              <p className="text-lg font-semibold">Sign in required</p>
              <p className="text-sm text-white/70">
                History is only available for signed-in users.
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => redirectToSignIn(activeProviders.filter(providerNeedsApiKey))}
                  className="material-btn"
                >
                  Sign in / Sign up
                </button>
              </div>
            </section>
          )}

          {mainView === "settings" && (
            <section className="grid gap-4">
              {!session ? (
                <div className="glass-card space-y-4 p-5">
                  <p className="text-lg font-semibold">Sign in to manage model settings</p>
                  <p className="text-sm text-white/70">
                    API keys and provider order are tied to your account.
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => redirectToSignIn(activeProviders.filter(providerNeedsApiKey))}
                      className="material-btn"
                    >
                      Sign in / Sign up
                    </button>
                  </div>
                </div>
              ) : (
                <div className="glass-card space-y-4 p-5">
                <div className="flex items-center gap-2 text-white/90">
                  <KeyRound size={16} />
                  <p className="font-semibold">Model + API Key Settings</p>
                </div>

                <ProviderSingleDropdown
                  label="Default model"
                  value={settings.defaultProvider}
                  onSelect={(provider) =>
                    setSettings((current) => ({ ...current, defaultProvider: provider }))}
                />

                <ProviderMultiDropdown
                  label="Provider order"
                  value={settings.providerOrder}
                  onToggle={(provider) => {
                    setSettings((current) => {
                      const exists = current.providerOrder.includes(provider);
                      const next = exists
                        ? current.providerOrder.filter((item) => item !== provider)
                        : [...current.providerOrder, provider];

                      const normalized: ModelProvider[] = next.length > 0 ? next : ["groq"];
                      return {
                        ...current,
                        providerOrder: normalized,
                        defaultProvider: normalized.includes(current.defaultProvider)
                          ? current.defaultProvider
                          : normalized[0],
                      };
                    });
                  }}
                />

                <button
                  type="button"
                  onClick={() => navigate("/api-keys")}
                  className="material-btn"
                >
                  <KeyRound size={14} /> Manage API Keys
                </button>

                <button disabled={settingsBusy} onClick={() => void saveSettings()} className="material-btn">
                  <Settings size={14} /> {settingsBusy ? "Saving..." : "Save settings"}
                </button>

                {settingsNotice && <p className="text-xs text-white/70">{settingsNotice}</p>}
                </div>
              )}
            </section>
          )}
          </motion.main>
        </AnimatePresence>

        <footer className="border-t border-white/10 bg-black/55 px-6 py-8 backdrop-blur-xl">
          <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-sm font-black text-white">Dum!t</p>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/65">
                AI-powered domain discovery for high-growth companies. Generate brandable domain names, validate availability,
                and keep your naming workflow organized across sessions.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs text-white/70">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Product</p>
                <ul className="mt-2 space-y-1.5">
                  <li>AI Name Generation</li>
                  <li>Availability Check</li>
                  <li>Prompt History</li>
                  <li>Model Settings</li>
                </ul>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Use Cases</p>
                <ul className="mt-2 space-y-1.5">
                  <li>SaaS Launches</li>
                  <li>Startup Rebrand</li>
                  <li>Agency Naming Ops</li>
                  <li>SEO Domain Research</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mx-auto mt-6 max-w-6xl border-t border-white/10 pt-4 text-[11px] text-white/45">
            © {new Date().getFullYear()} Dum!t — SaaS landing experience for domain intelligence.
          </div>
        </footer>

        {toasts.length > 0 && (
          <div className="pointer-events-none fixed right-4 top-4 z-120 flex w-[min(92vw,360px)] flex-col gap-2">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={cn(
                  "rounded-[18px] border px-4 py-3 text-sm backdrop-blur-xl",
                  toast.kind === "success" && "border-emerald-300/45 bg-emerald-500/20 text-emerald-100",
                  toast.kind === "error" && "border-red-300/45 bg-red-500/20 text-red-100",
                  toast.kind === "info" && "border-emerald-300/35 bg-emerald-500/14 text-emerald-100",
                )}
              >
                {toast.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
