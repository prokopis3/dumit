import { NextResponse } from "next/server";
import { resolveRequestUser } from "@/lib/infra/auth";
import { deleteSearchMemoryById, listRecentSearchMemories } from "@/lib/infra/searchMemory";

export const runtime = "edge";

export async function GET(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : 10;

    const memories = await listRecentSearchMemories({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
      limit,
    });

    return NextResponse.json({ memories });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load recent search memories",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const requestUser = await resolveRequestUser(req);
    const url = new URL(req.url);
    const memoryId = url.searchParams.get("id")?.trim();

    if (!memoryId) {
      return NextResponse.json({ error: "memory id is required" }, { status: 400 });
    }

    const deleted = await deleteSearchMemoryById({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
      memoryId,
    });

    if (!deleted) {
      return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to delete memory",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
