import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export interface RequestUser {
  id: string;
  accessToken?: string;
  isGuest: boolean;
}

const randomGuestKey = (req: Request): string => {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  return `guest:${ip}`;
};

export async function resolveRequestUser(req: Request): Promise<RequestUser> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token || !env.supabaseUrl || !env.supabaseAnonKey) {
    return {
      id: randomGuestKey(req),
      isGuest: true,
    };
  }

  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return {
      id: randomGuestKey(req),
      isGuest: true,
    };
  }

  return {
    id: data.user.id,
    accessToken: token,
    isGuest: false,
  };
}
