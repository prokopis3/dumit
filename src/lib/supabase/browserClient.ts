"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;
let pendingClient: Promise<SupabaseClient | null> | null = null;

const createFromEnv = (): SupabaseClient | null => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey);
};

const createFromApi = async (): Promise<SupabaseClient | null> => {
  try {
    const response = await fetch("/api/public-env", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();

    if (!payload?.supabaseUrl || !payload?.supabaseAnonKey) {
      return null;
    }

    return createClient(payload.supabaseUrl, payload.supabaseAnonKey);
  } catch {
    return null;
  }
};

export async function getBrowserSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  if (!pendingClient) {
    pendingClient = (async () => {
      const fromEnv = createFromEnv();
      if (fromEnv) {
        cachedClient = fromEnv;
        return fromEnv;
      }

      const fromApi = await createFromApi();
      cachedClient = fromApi;
      return fromApi;
    })().finally(() => {
      pendingClient = null;
    });
  }

  return pendingClient;
}
