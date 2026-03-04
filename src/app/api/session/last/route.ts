import { NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/infra/auth";
import { clearLatestSearchMemory, getLatestSearchMemory } from "@/lib/infra/searchMemory";

export const runtime = "edge";

export async function GET(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    const latest = await getLatestSearchMemory({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
    });

    return NextResponse.json({ latest });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load latest search memory",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    await clearLatestSearchMemory({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to clear latest search memory",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
