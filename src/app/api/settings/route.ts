import { NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/infra/auth";
import { getUserSettings, upsertUserSettings } from "@/lib/infra/settings";
import type { ModelProvider } from "@/lib/types";

export const runtime = "edge";

const isProvider = (value: string): value is ModelProvider =>
  value === "groq" || value === "gemini" || value === "openai" || value === "grok" || value === "huggingface";

const normalizeOrder = (value: unknown): ModelProvider[] => {
  if (!Array.isArray(value)) return ["groq", "grok", "gemini", "openai", "huggingface"];

  const cleaned = value.filter((item): item is ModelProvider => typeof item === "string" && isProvider(item));
  const deduped = [...new Set(cleaned)];

  if (deduped.length === 0) return ["groq"];

  return deduped;
};

export async function GET(req: Request) {
  const requestUser = await resolveRequestUser(req);

  if (requestUser.isGuest) {
    return NextResponse.json({
      settings: {
        userId: requestUser.id,
        defaultProvider: "groq",
        providerOrder: ["groq", "grok", "gemini", "openai", "huggingface"],
        apiKeys: {},
        updatedAt: new Date().toISOString(),
      },
      isGuest: true,
    });
  }

  const settings = await getUserSettings(requestUser.id, requestUser.accessToken);
  return NextResponse.json({ settings, isGuest: false });
}

export async function POST(req: Request) {
  const requestUser = await resolveRequestUser(req);

  if (requestUser.isGuest) {
    return NextResponse.json({ error: "Sign in required to persist settings" }, { status: 401 });
  }

  const payload = (await req.json()) as {
    defaultProvider?: string;
    providerOrder?: unknown;
  };

  const providerOrder = normalizeOrder(payload.providerOrder);
  const candidateDefaultProvider = typeof payload.defaultProvider === "string" && isProvider(payload.defaultProvider)
    ? payload.defaultProvider
    : providerOrder[0] ?? "groq";

  const defaultProvider = providerOrder.includes(candidateDefaultProvider)
    ? candidateDefaultProvider
    : providerOrder[0] ?? "groq";

  const settings = await upsertUserSettings({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    defaultProvider,
    providerOrder,
  });

  return NextResponse.json({ settings, isGuest: false });
}
