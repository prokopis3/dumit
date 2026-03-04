import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "edge";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.supabaseUrl;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.supabaseAnonKey;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Supabase public env is not configured." }, { status: 503 });
  }

  return NextResponse.json({
    supabaseUrl,
    supabaseAnonKey,
  });
}
