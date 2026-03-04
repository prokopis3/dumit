import { NextResponse } from "next/server";
import { runDomainSession } from "@/lib/services/domainOrchestrator";
import { enforceRateLimit } from "@/lib/infra/rateLimit";
import { resolveRequestUser } from "@/lib/infra/auth";
import { getUserApiKeys, getUserSettings } from "@/lib/infra/settings";
import type { ModelProvider, SearchExecutionMode, SearchIntent } from "@/lib/types";
import { sanitizeIntent } from "@/lib/utils";

export const runtime = "edge";

const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

const encodeSseEvent = (event: string, payload: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

export async function POST(req: Request) {
  try {
    const isStreamRequest = new URL(req.url).searchParams.get("stream") === "1";
    const requestUser = await resolveRequestUser(req);
    const userSettings = requestUser.isGuest
      ? {
          providerOrder: ["groq", "grok", "gemini", "openai", "huggingface"] as ModelProvider[],
        }
      : await getUserSettings(requestUser.id, requestUser.accessToken);
    const userApiKeys = requestUser.isGuest
      ? {}
      : await getUserApiKeys(requestUser.id, requestUser.accessToken);

    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    const limit = await enforceRateLimit(`session:${ip}`);

    if (!limit.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const payload = (await req.json()) as {
      topicId?: string;
      prompt?: string;
      constraints?: {
        minLength?: number;
        maxLength?: number;
        tlds?: string[];
        count?: number;
      };
      providerOrder?: ModelProvider[];
      executionMode?: SearchExecutionMode;
      intent?: SearchIntent;
    };

    if (!payload.prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const providerOrder = payload.providerOrder?.length
      ? payload.providerOrder
      : userSettings.providerOrder;

    const sessionInput = {
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
      topicId: payload.topicId,
      prompt: payload.prompt,
      constraints: {
        minLength: payload.constraints?.minLength ?? 4,
        maxLength: payload.constraints?.maxLength ?? 12,
        tlds: payload.constraints?.tlds ?? [".com", ".io", ".ai", ".co"],
        count: payload.constraints?.count ?? 12,
      },
      providerOrder,
      executionMode: payload.executionMode,
      intent: sanitizeIntent(payload.intent),
      providerApiKeys: userApiKeys,
    };

    if (!isStreamRequest) {
      const result = await runDomainSession(sessionInput);
      return NextResponse.json({ ...result, remaining: limit.remaining });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, body: unknown) => {
          controller.enqueue(encoder.encode(encodeSseEvent(event, body)));
        };

        void (async () => {
          try {
            send("started", { ok: true });

            const result = await runDomainSession(sessionInput, (progress) => {
              send("progress", progress);
            });

            send("complete", { ...result, remaining: limit.remaining });
            controller.close();
          } catch (error) {
            send("error", {
              error: "Failed to run domain session",
              details: error instanceof Error ? error.message : "Unknown error",
            });
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, { headers: sseHeaders });

  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to run domain session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
