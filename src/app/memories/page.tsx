"use client";

import { Clock3, Globe, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchMemorySnapshot } from "@/lib/types";
import { getBrowserSupabaseClient } from "@/lib/supabase/browserClient";
import { ProviderLogo } from "@/components/provider-logo";
import { providerLabel } from "@/lib/providerMeta";

export default function MemoriesPage() {
  const router = useRouter();
  const [memories, setMemories] = useState<SearchMemorySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await apiRequest("/api/session/recent?limit=10");
      if (!active) return;
      if (response.ok) {
        const payload = (await response.json()) as { memories?: SearchMemorySnapshot[] };
        setMemories(Array.isArray(payload.memories) ? payload.memories : []);
      }
      if (active) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [apiRequest]);

  const availableById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const memory of memories) {
      map[memory.id] = memory.results.filter((item) => item.available).length;
    }
    return map;
  }, [memories]);

  const removeMemory = async (id: string) => {
    const confirmed = window.confirm("Remove this memory draft?");
    if (!confirmed) return;

    setBusyId(id);
    const response = await apiRequest(`/api/session/recent?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusyId(null);

    if (!response.ok) return;
    setMemories((current) => current.filter((memory) => memory.id !== id));
  };

  const openInSearch = (memory: SearchMemorySnapshot) => {
    localStorage.setItem("domain-search.last-memory", JSON.stringify(memory));
    localStorage.removeItem("domain-search.skip-auto-restore");
    void apiRequest("/api/session/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topicId: memory.topicId,
        promptId: memory.promptId,
        prompt: memory.prompt,
        intent: memory.intent,
        constraints: memory.constraints,
        providerOrder: memory.providerOrder,
        executionMode: memory.executionMode,
        providerUsage: memory.providerUsage,
        statusSteps: memory.statusSteps,
        candidates: memory.candidates,
        results: memory.results,
      }),
    });
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-app-hero text-white">
      <div className="min-h-screen bg-black/45 px-6 py-10 backdrop-blur-[1px]">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="glass-card flex items-center justify-between gap-3 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-white/20 bg-black/60 p-2">
                <Globe className="h-4 w-4 text-emerald-300" />
              </div>
              <div>
                <p className="text-lg font-black">Recent Memories</p>
                <p className="text-xs text-white/60">Draft memories (max 10), independent from prompt history</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="material-btn px-3 py-2 text-xs"
            >
              Back to Search
            </button>
          </div>

          {loading ? (
            <div className="glass-card p-5 text-sm text-white/70">Loading memories...</div>
          ) : memories.length === 0 ? (
            <div className="glass-card p-5 text-sm text-white/70">No saved memories found.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {memories.map((memory) => {
                const provider = memory.providerUsage?.providerUsed ?? memory.providerOrder?.[0] ?? "groq";

                return (
                  <div key={memory.id} className="glass-card space-y-3 p-4">
                    <p className="line-clamp-2 text-sm font-semibold text-white/90">{memory.prompt}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/60">
                      <span>{new Date(memory.updatedAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>{memory.executionMode}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/75">
                        <ProviderLogo provider={provider} sizeClassName="h-3.5 w-3.5" className="inline-flex items-center" />
                        <span>{providerLabel(provider)}</span>
                      </span>
                      <span className="rounded-full border border-white/20 bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/75">
                        Results {memory.results.length}
                      </span>
                      <span className="rounded-full border border-emerald-300/30 bg-emerald-500/14 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                        Available {availableById[memory.id] ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openInSearch(memory)}
                        className="material-btn px-3 py-2 text-xs"
                      >
                        Open in Search
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMemory(memory.id)}
                        disabled={busyId === memory.id}
                        className="inline-flex items-center gap-2 rounded-[14px] border border-red-300/35 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-500/25 disabled:opacity-60"
                      >
                        <Trash2 size={14} />
                        {busyId === memory.id ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="glass-card flex items-center gap-2 p-4 text-xs text-white/60">
            <Clock3 size={14} />
            History page stores picked domains per prompt; Memories page stores reusable draft snapshots for quick refill.
          </div>
        </div>
      </div>
    </div>
  );
}
