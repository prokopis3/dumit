"use client";

import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, KeyRound, Settings } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ModelProvider, ProviderApiKeyMetadataMap, ProviderApiKeys } from "@/lib/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browserClient";
import { ProviderLogo } from "@/components/provider-logo";
import { providerLabel } from "@/lib/providerMeta";

const defaultApiKeys: ProviderApiKeys = {};
const defaultMetadata: ProviderApiKeyMetadataMap = {};
const providerKeyConfigs: Array<{ provider: ModelProvider; placeholder: string }> = [
  { provider: "groq", placeholder: "gsk_..." },
  { provider: "grok", placeholder: "xai-..." },
  { provider: "gemini", placeholder: "AIza..." },
  { provider: "openai", placeholder: "sk-..." },
  { provider: "huggingface", placeholder: "hf_..." },
];

function MaterialField(props: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: string;
}) {
  return (
    <label className="material-field">
      <span className="material-label">{props.label}</span>
      <input
        type="password"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        className="material-input"
      />
      {props.hint && <span className="mt-1 block text-xs text-white/65">{props.hint}</span>}
      <span className="material-bar" />
    </label>
  );
}

export default function ApiKeysPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initializedRef = useRef(false);
  const hasRedirected = useRef(false);
  const checkingRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [apiKeys, setApiKeys] = useState<ProviderApiKeys>(defaultApiKeys);
  const [apiKeyMetadata, setApiKeyMetadata] = useState<ProviderApiKeyMetadataMap>(defaultMetadata);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const paramsKey = useMemo(() => searchParams.toString(), [searchParams]);
  const stableParams = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);

  const nextPath = useMemo(() => stableParams.get("next") || "/", [stableParams]);
  const missing = useMemo(() => (stableParams.get("missing") || "").split(",").map((v) => v.trim()).filter(Boolean), [stableParams]);
  const returnToApiKeys = useMemo(() => {
    const params = new URLSearchParams();
    const missingParam = stableParams.get("missing");
    if (missingParam) {
      params.set("missing", missingParam);
    }
    const query = params.toString();
    return query ? `/api-keys?${query}` : "/api-keys";
  }, [stableParams]);

  const authedRequest = useCallback(async (token: string, url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }, []);

  const fetchApiKeys = useCallback(async (token: string) => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await authedRequest(token, "/api/api-keys", {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401) {
          setNotice("Session expired on server. Please sign in again.");
        }
        return;
      }

      const payload = await response.json();
      if (payload?.isGuest) {
        setNotice("Signed in locally, but server auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server runtime.");
        return;
      }
      setApiKeyMetadata((payload?.apiKeyMetadata ?? {}) as ProviderApiKeyMetadataMap);
    } catch {
      setNotice("Could not load API keys right now.");
    } finally {
      checkingRef.current = false;
    }
  }, [authedRequest]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let active = true;
    void (async () => {
      try {
        const supabase = await getBrowserSupabaseClient();
        if (!supabase || !active) {
          if (!hasRedirected.current) {
            hasRedirected.current = true;
            router.replace(`/sign-in?next=${encodeURIComponent(returnToApiKeys)}`);
          }
          return;
        }

        const { data } = await supabase.auth.getSession();
        const nextSession = data.session ?? null;
        if (active) {
          setSession(nextSession);
          setAuthChecked(true);
        }

        if (!nextSession || !nextSession.access_token) {
          if (!hasRedirected.current) {
            hasRedirected.current = true;
            router.replace(`/sign-in?next=${encodeURIComponent(returnToApiKeys)}`);
          }
          return;
        }

        void fetchApiKeys(nextSession.access_token);
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [fetchApiKeys, returnToApiKeys, router]);

  const signOut = useCallback(async () => {
    const supabase = await getBrowserSupabaseClient();
    if (!supabase) return;

    await supabase.auth.signOut();
    router.replace(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }, [nextPath, router]);

  const saveSettings = async () => {
    if (!session?.access_token) {
      router.replace(`/sign-in?next=${encodeURIComponent(returnToApiKeys)}`);
      return;
    }

    const patchEntries = Object.entries(apiKeys)
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .map(([provider, value]) => [provider as ModelProvider, value!.trim()]);

    if (patchEntries.length === 0) {
      setNotice("Enter at least one key value to save.");
      return;
    }

    setBusy(true);
    setNotice(null);

    const response = await authedRequest(session.access_token, "/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKeys: Object.fromEntries(patchEntries),
      }),
    });

    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setNotice(payload.error ?? "Failed to save API keys.");
      return;
    }

    setApiKeyMetadata((payload?.apiKeyMetadata ?? {}) as ProviderApiKeyMetadataMap);
    setApiKeys({});
    setNotice("API keys updated.");
  };

  const clearProviderKey = async (provider: ModelProvider) => {
    if (!session?.access_token) {
      router.replace(`/sign-in?next=${encodeURIComponent(returnToApiKeys)}`);
      return;
    }

    setBusy(true);
    setNotice(null);

    const response = await authedRequest(session.access_token, "/api/api-keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey: "",
      }),
    });

    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setNotice(payload.error ?? "Failed to clear API key.");
      return;
    }

    setApiKeyMetadata((payload?.apiKeyMetadata ?? {}) as ProviderApiKeyMetadataMap);
    setApiKeys((current) => ({ ...current, [provider]: "" }));
    setNotice(`${provider.toUpperCase()} key removed.`);
  };

  const canContinue = providerKeyConfigs.every(({ provider }) => {
    if (!missing.includes(provider)) return true;
    return Boolean(apiKeyMetadata[provider]?.hasKey) || Boolean(apiKeys[provider]?.trim());
  });

  const metadataHint = (provider: ModelProvider): string | undefined => {
    const meta = apiKeyMetadata[provider];
    if (!meta?.hasKey) return undefined;
    const masked = meta.last4 ? `••••${meta.last4}` : "••••";
    const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : "";
    return updated ? `Stored key: ${masked} · Updated ${updated}` : `Stored key: ${masked}`;
  };

  const providerFieldLabel = (provider: ModelProvider): ReactNode => (
    <span className="inline-flex items-center gap-1.5">
      <ProviderLogo
        provider={provider}
        sizeClassName={provider === "grok" ? "h-6 w-6" : "h-6 w-6"}
        className="inline-flex items-center"
      />
      <span>{providerLabel(provider)} API Key</span>
    </span>
  );

  return (
    <div className="min-h-screen bg-app-hero text-white">
      <div className="min-h-screen bg-black/45 px-6 py-10">
        <div className="mx-auto grid max-w-2xl gap-5">
          <button type="button" onClick={() => router.push(nextPath)} className="material-btn w-fit">
            <ArrowLeft size={14} /> Back
          </button>

          {session && (
            <button type="button" onClick={() => void signOut()} className="material-btn w-fit">
              Sign out
            </button>
          )}

          {!authChecked ? (
            <section className="glass-card space-y-4 p-6">
              <p className="text-sm text-white/80">Checking your session...</p>
            </section>
          ) : (
            <section className="glass-card space-y-4 p-6">
            <div className="flex items-center gap-2 text-white/90">
              <KeyRound size={16} />
              <h1 className="text-xl font-black">API Keys</h1>
            </div>

            {missing.length > 0 && (
              <div className="rounded-[18px] border border-emerald-300/35 bg-emerald-500/12 p-3 text-sm text-emerald-100">
                Missing required keys: {missing.join(", ")}
              </div>
            )}

            {providerKeyConfigs.map(({ provider, placeholder }) => (
              <div key={provider} className="space-y-2">
                <MaterialField
                  label={providerFieldLabel(provider)}
                  value={apiKeys[provider] ?? ""}
                  onChange={(value) => setApiKeys((current) => ({ ...current, [provider]: value }))}
                  placeholder={placeholder}
                  hint={metadataHint(provider)}
                />
                {apiKeyMetadata[provider]?.hasKey && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void clearProviderKey(provider)}
                    className="material-btn w-fit text-xs"
                  >
                    Clear {providerLabel(provider)} key
                  </button>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void saveSettings()} className="material-btn">
                <Settings size={14} /> {busy ? "Saving..." : "Save keys"}
              </button>
              <button type="button" disabled={!canContinue} onClick={() => router.push(nextPath)} className="material-btn">
                Continue
              </button>
            </div>

            {notice && <p className="text-sm text-white/75">{notice}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
