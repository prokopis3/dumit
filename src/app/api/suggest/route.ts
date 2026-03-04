import { NextResponse } from "next/server";
import { generateSuggestions } from "@/lib/ai/providers";
import { enforceRateLimit } from "@/lib/infra/rateLimit";
import { resolveRequestUser } from "@/lib/infra/auth";
import { getUserApiKeys, getUserSettings } from "@/lib/infra/settings";
import type { ModelProvider, SearchIntent } from "@/lib/types";
import { sanitizeConstraints, sanitizeIntent } from "@/lib/utils";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    const userSettings = await getUserSettings(requestUser.id, requestUser.accessToken);
    const userApiKeys = await getUserApiKeys(requestUser.id, requestUser.accessToken);

    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    const limit = await enforceRateLimit(`suggest:${ip}`);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const payload = (await req.json()) as {
      prompt?: string;
      providerOrder?: ModelProvider[];
      constraints?: {
        minLength?: number;
        maxLength?: number;
        tlds?: string[];
        count?: number;
      };
      intent?: SearchIntent;
    };

    const prompt = payload.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const constraints = sanitizeConstraints(payload.constraints);
    const output = await generateSuggestions({
      prompt,
      constraints,
      providerOrder: payload.providerOrder?.length ? payload.providerOrder : userSettings.providerOrder,
      intent: sanitizeIntent(payload.intent),
      providerApiKeys: userApiKeys,
    });

    return NextResponse.json({
      ...output,
      remaining: limit.remaining,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate suggestions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
