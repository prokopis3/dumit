import { NextResponse } from "next/server";
import { deleteTopic, getTopicDetails, listTopicSummaries } from "@/lib/infra/history";
import { resolveRequestUser } from "@/lib/infra/auth";
import { listLatestSearchMemoriesByTopics, listSearchMemoriesByTopic } from "@/lib/infra/searchMemory";

export const runtime = "edge";

export async function GET(req: Request) {
  const requestUser = await resolveRequestUser(req);
  const url = new URL(req.url);
  const topicId = url.searchParams.get("topicId");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSizeParam = Number.parseInt(url.searchParams.get("pageSize") ?? "8", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 4), 24) : 8;

  if (topicId) {
    const topic = await getTopicDetails({
      userId: requestUser.id,
      topicId,
      accessToken: requestUser.accessToken,
    });
    if (!topic) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const memoryByPrompt = await listSearchMemoriesByTopic({
      userId: requestUser.id,
      accessToken: requestUser.accessToken,
      topicId,
    });

    return NextResponse.json({ topic, memoryByPrompt });
  }

  const topicSummaries = await listTopicSummaries({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    q,
    page,
    pageSize,
  });

  const total = topicSummaries.total;
  const paged = topicSummaries.topics;
  const topicIds = paged.map((topic) => topic.id);
  const latestMemoryByTopic = await listLatestSearchMemoriesByTopics({
    userId: requestUser.id,
    accessToken: requestUser.accessToken,
    topicIds,
  });

  const topics = paged.map((topic) => {
    const latestMemory = latestMemoryByTopic[topic.id];
    const providersFromRuns = latestMemory?.providerUsage?.providersTried
      .map((run) => run.provider)
      .filter((provider, index, current) => current.indexOf(provider) === index) ?? [];
    const latestProviders = providersFromRuns.length > 0
      ? providersFromRuns
      : (latestMemory?.providerUsage?.providerUsed ? [latestMemory.providerUsage.providerUsed] : []);

    return {
      ...topic,
      latestResponseTimeMs: latestMemory?.responseTimeMs ?? topic.latestResponseTimeMs,
      latestProviders,
    };
  });

  return NextResponse.json({
    topics,
    total,
    page,
    pageSize,
    hasNextPage: page * pageSize < total,
    hasPrevPage: page > 1,
  });
}

export async function DELETE(req: Request) {
  const requestUser = await resolveRequestUser(req);
  const url = new URL(req.url);
  const topicId = url.searchParams.get("topicId");

  if (!topicId) {
    return NextResponse.json({ error: "topicId is required" }, { status: 400 });
  }

  const deleted = await deleteTopic({
    userId: requestUser.id,
    topicId,
    accessToken: requestUser.accessToken,
  });

  if (!deleted) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
