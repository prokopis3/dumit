import { NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/infra/auth";
import { saveSearchMemory } from "@/lib/infra/searchMemory";
import { inferRelevantTlds } from "@/lib/utils";
import type {
  ModelProvider,
  ProviderUsageSummary,
  RankedDomainResult,
  SearchExecutionMode,
  SearchIntent,
} from "@/lib/types";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    const payload = (await req.json()) as {
      topicId?: string;
      promptId?: string;
      prompt?: string;
      responseTimeMs?: number;
      intent?: SearchIntent;
      constraints?: {
        minLength?: number;
        maxLength?: number;
        count?: number;
        tlds?: string[];
      };
      providerOrder?: ModelProvider[];
      executionMode?: SearchExecutionMode;
      statusSteps?: string[];
      candidates?: string[];
      results?: RankedDomainResult[];
      providerUsage?: ProviderUsageSummary;
    };

    if (!payload.prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    await saveSearchMemory({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
      topicId: payload.topicId,
      promptId: payload.promptId,
      prompt: payload.prompt,
      responseTimeMs: typeof payload.responseTimeMs === "number" ? payload.responseTimeMs : undefined,
      intent: payload.intent,
      constraints: {
        minLength: payload.constraints?.minLength ?? 4,
        maxLength: payload.constraints?.maxLength ?? 12,
        count: payload.constraints?.count ?? 12,
        tlds: inferRelevantTlds({
          seedText: payload.prompt,
          preferred: payload.constraints?.tlds,
        }),
      },
      providerOrder: payload.providerOrder,
      executionMode: payload.executionMode,
      statusSteps: payload.statusSteps,
      candidates: payload.candidates,
      results: Array.isArray(payload.results) ? payload.results : [],
      providerUsage: payload.providerUsage,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to activate search memory",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
