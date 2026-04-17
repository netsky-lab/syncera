import { startRun } from "@/lib/runner";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const topic = String(body.topic ?? "").trim();
  const constraints = body.constraints ? String(body.constraints).trim() : undefined;

  if (!topic || topic.length < 10) {
    return Response.json(
      { error: "Topic is required and must be at least 10 characters" },
      { status: 400 }
    );
  }

  const { runId, slug } = startRun(topic, constraints);
  return Response.json({ runId, slug, topic });
}
