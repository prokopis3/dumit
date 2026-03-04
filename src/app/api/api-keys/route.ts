import { NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/infra/auth";
import { getUserApiKeysMetadata, upsertUserApiKeys } from "@/lib/infra/settings";
import type { ModelProvider } from "@/lib/types";

export const runtime = "edge";

const isProvider = (value: string): value is ModelProvider =>
  value === "groq" || value === "grok" || value === "gemini" || value === "openai" || value === "huggingface";

export async function GET(req: Request) {
  const requestUser = await resolveRequestUser(req);

  if (requestUser.isGuest) {
    return NextResponse.json({ apiKeyMetadata: {}, isGuest: true });
  }

  const apiKeyMetadata = await getUserApiKeysMetadata(requestUser.id, requestUser.accessToken);
  return NextResponse.json({ apiKeyMetadata, isGuest: false });
}

export async function POST(req: Request) {
  const requestUser = await resolveRequestUser(req);

  if (requestUser.isGuest) {
    return NextResponse.json({ error: "Sign in required to persist API keys" }, { status: 401 });
  }

  const payload = (await req.json()) as {
    apiKeys?: Partial<Record<ModelProvider, string>>;
  };

  await upsertUserApiKeys({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    apiKeys: payload.apiKeys ?? {},
  });

  const apiKeyMetadata = await getUserApiKeysMetadata(requestUser.id, requestUser.accessToken);

  return NextResponse.json({ apiKeyMetadata, isGuest: false });
}

export async function PATCH(req: Request) {
  const requestUser = await resolveRequestUser(req);

  if (requestUser.isGuest) {
    return NextResponse.json({ error: "Sign in required to rotate API keys" }, { status: 401 });
  }

  const payload = (await req.json()) as {
    provider?: string;
    apiKey?: string;
  };

  if (!payload.provider || !isProvider(payload.provider)) {
    return NextResponse.json({ error: "Valid provider is required" }, { status: 400 });
  }

  if (typeof payload.apiKey !== "string") {
    return NextResponse.json({ error: "apiKey string is required" }, { status: 400 });
  }

  await upsertUserApiKeys({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    apiKeys: {
      [payload.provider]: payload.apiKey,
    },
  });

  const apiKeyMetadata = await getUserApiKeysMetadata(requestUser.id, requestUser.accessToken);

  return NextResponse.json({ apiKeyMetadata, isGuest: false });
}
