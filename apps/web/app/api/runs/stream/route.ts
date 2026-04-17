import { getRun, type RunEvent } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("id");
  if (!runId) {
    return new Response("Missing id param", { status: 400 });
  }
  const run = getRun(runId);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: RunEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(ev)}\n\n`)
        );
      };

      // Replay existing events
      for (const ev of run.events) send(ev);

      if (run.status !== "running") {
        controller.close();
        return;
      }

      const listener = (ev: RunEvent) => {
        send(ev);
        if (ev.type === "exit" || ev.type === "error") {
          setTimeout(() => controller.close(), 100);
        }
      };
      run.emitter.on("event", listener);

      request.signal.addEventListener("abort", () => {
        run.emitter.off("event", listener);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
