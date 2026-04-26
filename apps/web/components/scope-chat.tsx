"use client";

// Pre-research clarifying chat. Sits in NewResearchForm. Takes user's
// raw topic, has a 1-3-turn dialogue with the LLM to pin down domain and
// scope, then emits a structured brief the pipeline consumes.
//
// Flow:
//   initial textarea → "Discuss scope" → chat mode
//   chat: alternating user/assistant bubbles, inline input
//   when assistant returns done=true → show BriefCard
//   BriefCard → "Run research" (POST /api/runs/start) or "Keep refining"

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type Brief = {
  topic_refined: string;
  domain_hints: string[];
  constraints: string[];
  question_preview: string[];
};

export function ScopeChat({
  initialTopic,
  onCancel,
  onRunStarted,
  mode = "new",
  sourceTopic,
  onBriefReady,
}: {
  initialTopic: string;
  onCancel: () => void;
  onRunStarted?: (runId: string, slug: string) => void;
  // "new" = default, starts a new research via /api/runs/start once brief ready.
  // "extend" = extend flow, parent handles what to do with the brief via
  //            onBriefReady — typically POST /api/projects/:slug/extend.
  mode?: "new" | "extend";
  sourceTopic?: string;
  onBriefReady?: (brief: Brief) => void | Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: "user", content: initialTopic },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Kick off the first assistant turn immediately on mount.
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void ask([{ role: "user", content: initialTopic }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  async function ask(history: ChatMessage[]) {
    setThinking(true);
    setError(null);
    try {
      const r = await fetch("/api/chat/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          mode,
          source_topic: sourceTopic,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      const assistant: ChatMessage = {
        role: "assistant",
        content: d.message ?? "(no reply)",
      };
      setMessages([...history, assistant]);
      if (d.done && d.brief) setBrief(d.brief);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setThinking(false);
    }
  }

  async function send() {
    if (!input.trim() || thinking) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    await ask(next);
  }

  async function runResearch() {
    if (!brief) return;
    setStarting(true);
    try {
      // Extend flow: hand the brief back to the parent, which will call
      // /api/projects/:slug/extend with the angle built from brief fields.
      if (mode === "extend" && onBriefReady) {
        await onBriefReady(brief);
        return;
      }
      const payload = {
        topic: brief.topic_refined,
        constraints: [
          brief.domain_hints.length
            ? `Domain: ${brief.domain_hints.join(", ")}`
            : "",
          brief.constraints.length
            ? `Constraints: ${brief.constraints.join("; ")}`
            : "",
          brief.question_preview.length
            ? `Planned questions: ${brief.question_preview.join(" | ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
      const r = await fetch("/api/runs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        setStarting(false);
        return;
      }
      onRunStarted?.(d.runId, d.slug);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setStarting(false);
    }
  }

  return (
    <div className="rounded-xl bg-ink-800 border border-fg/[0.06] card-warm overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-fg/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="micro text-accent-primary">Scope</span>
          <span className="text-[12px] text-fg-muted">
            quick chat to pin domain before the pipeline runs
          </span>
        </div>
        <button
          onClick={onCancel}
          className="text-[11px] text-fg-muted hover:text-fg-dim transition"
        >
          cancel
        </button>
      </div>

      <div
        ref={listRef}
        className="flex flex-col gap-3 px-4 py-4 max-h-[420px] overflow-y-auto"
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {thinking && (
          <div className="flex gap-2 items-center text-[12px] text-fg-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span>thinking…</span>
          </div>
        )}
        {error && (
          <div className="text-[12px] text-accent-red bg-accent-red/5 border border-accent-red/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {brief ? (
        <BriefCard
          brief={brief}
          onRun={runResearch}
          starting={starting}
          onRefine={() => setBrief(null)}
        />
      ) : (
        <div className="border-t border-fg/[0.06] p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={thinking ? "Agent thinking — you can draft next reply" : "Your answer…"}
            className="flex-1 h-10 px-3 rounded-lg bg-ink-900 border border-fg/[0.06] text-[13px] placeholder:text-fg-muted focus:outline-none focus:border-accent-primary/60 transition"
          />
          <button
            onClick={send}
            disabled={thinking || !input.trim()}
            className="h-10 px-4 rounded-lg bg-accent-primary text-ink-900 text-[13px] font-semibold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={`max-w-[85%] ${isUser ? "self-end" : "self-start"} rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
        isUser
          ? "bg-accent-primary/15 text-fg border border-accent-primary/20"
          : "bg-ink-700 text-fg-dim border border-fg/[0.05]"
      }`}
    >
      <div className="whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );
}

function BriefCard({
  brief,
  onRun,
  onRefine,
  starting,
}: {
  brief: Brief;
  onRun: () => void;
  onRefine: () => void;
  starting: boolean;
}) {
  return (
    <div className="border-t border-fg/[0.06] bg-ink-900/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="micro text-accent-sage">Research brief</div>
        <div className="text-[11px] text-fg-muted">
          pipeline will be constrained to this scope
        </div>
      </div>
      <div className="font-serif text-[18px] leading-snug text-fg">
        {brief.topic_refined}
      </div>
      {brief.domain_hints.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {brief.domain_hints.map((h) => (
            <span
              key={h}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary text-[11px] font-medium"
            >
              {h}
            </span>
          ))}
        </div>
      )}
      {brief.constraints.length > 0 && (
        <div className="text-[12px] text-fg-dim space-y-0.5">
          {brief.constraints.map((c, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-fg-muted mt-0.5">·</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}
      {brief.question_preview.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-fg/[0.06]">
          <div className="micro text-fg-muted">Questions preview</div>
          <ol className="space-y-1 text-[13px] text-fg-dim list-decimal list-inside">
            {brief.question_preview.map((q, i) => (
              <li key={i} className="leading-snug">
                {q}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={onRun}
          disabled={starting}
          className="h-10 px-5 rounded-lg bg-accent-primary text-ink-900 text-[13px] font-semibold hover:brightness-110 transition disabled:opacity-50"
        >
          {starting ? "Starting…" : "Run research"}
        </button>
        <button
          onClick={onRefine}
          disabled={starting}
          className="h-10 px-3 rounded-lg border border-fg/[0.08] text-fg-dim hover:text-fg hover:bg-ink-700 transition text-[12px] disabled:opacity-50"
        >
          Keep refining
        </button>
      </div>
    </div>
  );
}
