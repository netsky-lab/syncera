"use client";

import { useState } from "react";

// Split topic into a readable question + optional long tail (e.g. INCI
// ingredient list). Avoids making a 40-ingredient cream composition the
// H1 that fills the entire screen.
function splitTopic(topic: string): { question: string; tail: string | null } {
  const trimmed = topic.trim();

  // Preferred split: first "?" that's followed by more text.
  const qIdx = trimmed.indexOf("?");
  if (qIdx !== -1 && qIdx < trimmed.length - 1) {
    const question = trimmed.slice(0, qIdx + 1).trim();
    const tail = trimmed.slice(qIdx + 1).trim();
    if (tail.length > 40) return { question, tail };
  }

  // Fallback: if the topic is very long, show the first sentence/clause
  // as H1 and the rest as tail. Pick the first period/colon before char 160.
  if (trimmed.length > 200) {
    const cutIdx = findCut(trimmed);
    if (cutIdx > 0 && cutIdx < trimmed.length - 40) {
      return {
        question: trimmed.slice(0, cutIdx + 1).trim(),
        tail: trimmed.slice(cutIdx + 1).trim(),
      };
    }
  }

  return { question: trimmed, tail: null };
}

function findCut(s: string): number {
  const max = Math.min(160, s.length);
  for (const punct of [". ", ": ", " — ", " – "]) {
    const i = s.indexOf(punct);
    if (i > 30 && i < max) return i;
  }
  return -1;
}

export function TopicHeader({ topic }: { topic: string }) {
  const { question, tail } = splitTopic(topic);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-3">
      <h1 className="font-serif text-[26px] md:text-[36px] leading-[1.2] font-semibold tracking-tight text-fg">
        {question}
      </h1>
      {tail && (
        <div className="rounded-lg border border-fg/[0.06] bg-ink-800 card-warm overflow-hidden">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink-700/60 transition text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="micro text-fg-muted shrink-0">Composition</span>
              <span className="text-[12px] text-fg-dim font-mono truncate">
                {tail.slice(0, 140)}
                {tail.length > 140 ? "…" : ""}
              </span>
            </div>
            <svg
              className={`w-3.5 h-3.5 text-fg-muted shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
              viewBox="0 0 14 14"
              fill="none"
            >
              <path
                d="M3.5 5 7 8.5 10.5 5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {expanded && (
            <div className="px-4 py-3 border-t border-fg/[0.06] text-[12px] text-fg-dim font-mono leading-relaxed whitespace-pre-wrap break-words">
              {tail}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
