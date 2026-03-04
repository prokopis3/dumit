import { NextResponse } from "next/server";
import { addSelection } from "@/lib/infra/history";
import { resolveRequestUser } from "@/lib/infra/auth";

export const runtime = "edge";

export async function POST(req: Request) {
  const requestUser = await resolveRequestUser(req);
  const payload = (await req.json()) as {
    topicId?: string;
    promptId?: string;
    domain?: string;
  };

  if (requestUser.isGuest) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  if (!payload.topicId || !payload.promptId || !payload.domain) {
    return NextResponse.json({ error: "topicId, promptId and domain are required" }, { status: 400 });
  }

  const ok = await addSelection({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    topicId: payload.topicId,
    promptId: payload.promptId,
    domain: payload.domain,
  });

  if (ok) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    {
      error: "Failed to save selection",
      details: "Topic or prompt no longer exists. Refresh history and try again.",
    },
    { status: 409 },
  );
}
