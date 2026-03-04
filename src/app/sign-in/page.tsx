"use client";

import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, LogOut, Mail, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ModelProvider } from "@/lib/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browserClient";
import { GlassCard } from "@/components/ui";

const providerNeedsApiKey = (provider: ModelProvider): boolean =>
  provider === "groq" || provider === "gemini" || provider === "openai" || provider === "huggingface" || provider === "grok";

const normalizeNextPath = (value: string | null): string => {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
};

const isSignInPath = (value: string): boolean => value.startsWith("/sign-in");

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" role="img">
      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6H12Z" />
      <path fill="#34A853" d="M3.1 7.6l3.2 2.4c.9-2 2.9-3.9 5.7-3.9 1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.5 12 2.5c-3.6 0-6.7 2-8.4 5.1Z" />
      <path fill="#FBBC05" d="M2.6 12c0 1.5.4 2.9 1 4.1l3.5-2.7c-.2-.5-.3-.9-.3-1.4 0-.5.1-1 .3-1.4L3.6 7.9A9.5 9.5 0 0 0 2.6 12Z" />
      <path fill="#4285F4" d="M12 21.5c2.6 0 4.9-.9 6.5-2.4l-3-2.4c-.8.6-1.9 1.1-3.5 1.1-2.8 0-5.1-1.9-5.9-4.4l-3.5 2.7c1.7 3.1 4.8 5.4 9.4 5.4Z" />
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initializedRef = useRef(false);
  const redirectingRef = useRef(false);
  const checkingRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallbackNextPath, setFallbackNextPath] = useState("/");

  const paramsKey = useMemo(() => searchParams.toString(), [searchParams]);
  const stableParams = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);

  const rawNextPath = useMemo(() => normalizeNextPath(stableParams.get("next")), [stableParams]);
  const nextPath = useMemo(() => {
    if (!isSignInPath(rawNextPath)) return rawNextPath;
    if (!isSignInPath(fallbackNextPath)) return fallbackNextPath;
    return "/";
  }, [fallbackNextPath, rawNextPath]);

  const requiredProviders = useMemo(() => {
    const raw = stableParams.get("requiredProviders") || "";
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is ModelProvider =>
        value === "groq" || value === "gemini" || value === "openai" || value === "huggingface" || value === "grok",
      );
  }, [stableParams]);

  const navigateWithFallback = useCallback((target: string) => {
    redirectingRef.current = true;
    router.replace(target);

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/sign-in")) {
          window.location.replace(target);
        }
      }, 700);
    }
  }, [router]);

  const ensureSupabase = useCallback(async () => {
    const client = await getBrowserSupabaseClient();
    if (!client) {
      setNotice("Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (same values as SUPABASE_URL and SUPABASE_ANON_KEY).");
      return null;
    }
    return client;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.location.hash === "#") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    if (!document.referrer) return;

    try {
      const referrerUrl = new URL(document.referrer);
      if (referrerUrl.origin !== window.location.origin) return;

      const candidate = normalizeNextPath(`${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`);
      if (!isSignInPath(candidate)) {
        setFallbackNextPath(candidate);
      }
    } catch {
      setFallbackNextPath("/");
    }
  }, []);

  const continueAfterAuth = useCallback(async () => {
    if (redirectingRef.current || checkingRef.current) return;

    checkingRef.current = true;

    try {
      const supabase = await ensureSupabase();
      if (!supabase) {
        return;
      }

      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        navigateWithFallback(nextPath);
        return;
      }

      const requiredWithKeys = requiredProviders.filter(providerNeedsApiKey);

      if (requiredWithKeys.length === 0) {
        navigateWithFallback(nextPath);
        return;
      }

      let apiKeyMetadata: Record<string, { hasKey?: boolean }> = {};

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch("/api/api-keys", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const payload = await response.json();
          if (payload?.isGuest) {
            setNotice("Signed in locally, but server auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server runtime.");
            return;
          }
          apiKeyMetadata = payload?.apiKeyMetadata ?? {};
        }
      } catch {
        apiKeyMetadata = {};
      }

      const missing = requiredWithKeys
        .filter((provider) => {
          const hasKey = apiKeyMetadata?.[provider]?.hasKey;
          return !hasKey;
        });

      if (missing.length > 0) {
        const params = new URLSearchParams();
        params.set("next", nextPath);
        params.set("missing", [...new Set(missing)].join(","));
        navigateWithFallback(`/api-keys?${params.toString()}`);
        return;
      }

      navigateWithFallback(nextPath);
    } finally {
      checkingRef.current = false;
    }
  }, [ensureSupabase, navigateWithFallback, nextPath, requiredProviders]);

  const signOut = useCallback(async () => {
    const supabase = await ensureSupabase();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);
    await supabase.auth.signOut();
    setSession(null);
    setBusy(false);
    setNotice("Signed out.");
  }, [ensureSupabase]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let active = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const supabase = await ensureSupabase();
      if (!supabase || !active) return;

      const { data } = await supabase.auth.getSession();
      if (active) {
        setSession(data.session ?? null);
        if (data.session) {
          void continueAfterAuth();
        }
      }

      const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession && !redirectingRef.current) {
          void continueAfterAuth();
        }
      });

      unsubscribe = () => authSubscription.subscription.unsubscribe();
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [continueAfterAuth, ensureSupabase]);

  const signInWithGoogle = async () => {
    const supabase = await ensureSupabase();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);

    const redirectTo = `${window.location.origin}/sign-in?${stableParams.toString()}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setBusy(false);
      setNotice(error.message);
    }
  };

  const signInWithEmail = async () => {
    const supabase = await ensureSupabase();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    setSession(data.session ?? null);
    setNotice("Signed in successfully.");
    void continueAfterAuth();
  };

  const signUpWithEmail = async () => {
    const supabase = await ensureSupabase();
    if (!supabase) return;

    setBusy(true);
    setNotice(null);

    const redirectTo = `${window.location.origin}/sign-in?${stableParams.toString()}`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });

    setBusy(false);
    setNotice(error ? error.message : "Signup request sent. Check your email.");
  };

  return (
    <div className="min-h-screen bg-app-hero text-white">
      <div className="min-h-screen bg-black/45 px-6 py-10">
        <div className="mx-auto grid max-w-xl gap-5">
          <button
            type="button"
            onClick={() => router.push(nextPath)}
            className="material-btn w-fit"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <GlassCard className="space-y-4 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-white/60">Account</p>
              <h1 className="mt-1 text-2xl font-black">Sign in / Sign up</h1>
              <p className="mt-2 text-sm text-white/70">
                Continue with Google, or use email and password.
              </p>
            </div>

            {!session ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signInWithGoogle()}
                  className="material-btn w-full justify-center gap-2 border-white/30 bg-white text-black hover:bg-white/90"
                >
                  <GoogleIcon /> Continue with Google
                </button>

                <label className="material-field">
                  <span className="material-label">Email</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="material-input"
                  />
                  <span className="material-bar" />
                </label>

                <label className="material-field">
                  <span className="material-label">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="material-input"
                  />
                  <span className="material-bar" />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void signInWithEmail()}
                    className="material-btn"
                  >
                    <Mail size={14} /> Sign in with email
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void signUpWithEmail()}
                    className="material-btn"
                  >
                    <UserPlus size={14} /> Sign up with email
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-[18px] border border-white/15 bg-black/35 p-4 text-sm text-white/80">
                  Signed in as <span className="font-semibold">{session.user.email}</span>. Redirecting...
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signOut()}
                  className="material-btn"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}

            {notice && <p className="text-sm text-white/75">{notice}</p>}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
