import Link from "next/link";

// Marketing landing for anonymous visitors. Full-bleed page (no AppShell),
// ported from design/Landing.html: sticky top nav → hero with italic serif
// emphasis + terracotta accent → live pipeline preview card → problem /
// how-it-works / final CTA.
export function LandingHero() {
  return (
    <div className="bg-ink-900 text-fg">
      {/* TOP NAV */}
      <nav
        className="sticky top-0 z-20 flex items-center gap-6 md:gap-8 px-5 md:px-10 py-4 border-b border-ink-600 backdrop-blur"
        style={{ background: "rgba(12,12,13,0.82)" }}
      >
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div className="h-[26px] w-[26px] rounded-[7px] bg-gradient-to-br from-accent-primary to-accent-rust grid place-items-center text-ink-900 font-bold text-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            S
          </div>
          <span className="font-semibold text-[14px] tracking-[-0.01em]">
            Syncera
          </span>
        </Link>
        <div className="hidden md:flex gap-6 text-[13px] text-fg-dim">
          <a href="#pipeline" className="hover:text-fg cursor-pointer">
            Pipeline
          </a>
          <a href="#verification" className="hover:text-fg cursor-pointer">
            Verification
          </a>
          <a href="#sources" className="hover:text-fg cursor-pointer">
            Sources
          </a>
          <a
            href="/api/openapi.json"
            className="hover:text-fg cursor-pointer"
          >
            Docs
          </a>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2.5 items-center">
          <Link
            href="/login"
            className="text-[13px] text-fg-dim hover:text-fg py-1.5 px-2.5"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="px-3.5 py-[7px] rounded-[7px] bg-accent-primary text-ink-900 font-semibold text-[13px] inline-flex items-center gap-1.5 hover:brightness-110 transition"
          >
            Open the Lab
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </nav>

      <div className="max-w-[1240px] mx-auto px-5 md:px-10">
        {/* HERO */}
        <section className="pt-14 md:pt-20 pb-6 md:pb-10 relative">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] text-fg-dim bg-ink-800 border border-ink-500 px-2.5 py-1 rounded-full mb-7">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-sage shadow-[0_0_0_3px_rgba(110,231,160,0.12)]" />
            <span>
              v0.3 · pipeline live · three-layer verifier ships only verified
              facts
            </span>
          </div>

          <h1 className="rl-hero-title max-w-[980px]">
            Verifiable research
            <br />
            at the <em>speed of a</em> <span className="acc">query.</span>
          </h1>

          <p className="text-[16px] md:text-[19px] leading-[1.55] text-fg-dim max-w-[640px] mb-10">
            Syncera runs an open, inspectable pipeline from raw topic to
            cited brief. Every claim ships with its source, its verdict, and
            the exact quote that produced it —{" "}
            <strong className="text-fg font-medium">
              no hallucinated citations, no black boxes.
            </strong>
          </p>

          <div className="flex gap-3 items-center flex-wrap mb-12 md:mb-14">
            <Link
              href="/signup"
              className="px-[22px] py-[13px] rounded-[9px] bg-accent-primary text-ink-900 text-[14.5px] font-semibold inline-flex items-center gap-2 hover:brightness-110 transition"
            >
              Run your first investigation
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link
              href="/login"
              className="px-[18px] py-[13px] rounded-[9px] bg-transparent text-fg border border-ink-500 text-[14.5px] font-medium inline-flex items-center gap-2 hover:border-fg-muted hover:bg-ink-800 transition"
            >
              Sign in
            </Link>
          </div>

          <div className="flex items-center gap-4 md:gap-7 font-mono text-[11.5px] text-fg-muted flex-wrap">
            <div>
              <strong className="text-fg font-medium">
                Open source under MIT
              </strong>
            </div>
            <div className="hidden md:block w-px h-3.5 bg-ink-500" />
            <div>Arxiv · OpenAlex · SearXNG · PubMed · Semantic Scholar</div>
            <div className="hidden md:block w-px h-3.5 bg-ink-500" />
            <div>Self-hosted LLM on Runpod</div>
          </div>
        </section>

        {/* LIVE PIPELINE PREVIEW */}
        <section id="pipeline" className="mt-10 md:mt-14 scroll-mt-20">
          <div
            className="relative rounded-[18px] border border-ink-600 overflow-hidden p-6 md:p-8"
            style={{
              background:
                "radial-gradient(circle at 20% 0%, rgba(232,165,132,0.08) 0%, transparent 50%), var(--ink-800)",
            }}
          >
            <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 font-mono text-[11px] text-fg-muted tracking-[0.08em] uppercase">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-sage shadow-[0_0_0_3px_rgba(110,231,160,0.12)] animate-pulse" />
                <span>Live pipeline · example run</span>
              </div>
              <div className="font-mono text-[12px] text-fg-dim">
                Topic →{" "}
                <span className="text-accent-primary">
                  &quot;Does niacinamide reduce transepidermal water loss?&quot;
                </span>
              </div>
            </div>

            <div className="relative grid grid-cols-2 md:grid-cols-6 gap-y-8 gap-x-0">
              <div className="absolute top-6 left-6 right-6 h-px bg-ink-500 hidden md:block" />
              <div
                className="absolute top-6 left-6 h-px hidden md:block"
                style={{
                  width: "calc((100% - 48px) * 0.6)",
                  background:
                    "linear-gradient(90deg, var(--accent-primary), var(--accent-primary) 70%, transparent)",
                }}
              />
              {STATIC_STAGES.map((s, i) => {
                const done = i < 3;
                const active = i === 3;
                return (
                  <div
                    key={s.name}
                    className={
                      "relative px-2 " +
                      (active
                        ? "rl-stage active"
                        : done
                          ? "rl-stage done"
                          : "rl-stage")
                    }
                  >
                    <div className="rl-stage-node">{s.icon}</div>
                    <div className="rl-stage-num">{s.num}</div>
                    <div className="rl-stage-name">{s.name}</div>
                    <div className="rl-stage-desc">{s.desc}</div>
                    {active && <div className="rl-stage-log">{s.log}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* PROBLEM */}
        <section className="py-20 md:py-28 border-t border-ink-600 mt-16 md:mt-20">
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4">
            The problem
          </div>
          <h2
            className="text-[32px] md:text-[48px] leading-[1.08] tracking-[-0.028em] font-medium max-w-[820px] mb-5"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            LLMs are{" "}
            <em className="font-serif font-normal italic text-fg-dim">fast.</em>{" "}
            LLMs are also confidently wrong about half of what they cite.
          </h2>
          <p className="text-[15px] md:text-[17px] leading-[1.6] text-fg-dim max-w-[620px] mb-12">
            Most &quot;AI research&quot; tools are a single LLM pretending to
            read papers. Hallucinated citations, missing sources, zero audit
            trail. You end up redoing the work in 3× the time.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {PROBLEMS.map((p) => (
              <div
                key={p.title}
                className="relative border border-ink-600 rounded-xl bg-ink-800 p-5 md:p-6"
              >
                <div className="absolute top-5 right-5 font-mono text-[10px] text-accent-red tracking-wider">
                  BROKEN
                </div>
                <div className="w-8 h-8 rounded-lg bg-ink-700 border border-ink-600 grid place-items-center text-fg-muted mb-4">
                  {p.icon}
                </div>
                <h3 className="text-[15px] font-semibold mb-2 tracking-[-0.01em]">
                  {p.title}
                </h3>
                <p className="text-[13px] text-fg-muted leading-[1.55]">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section
          id="verification"
          className="py-20 md:py-28 border-t border-ink-600 scroll-mt-20"
        >
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4">
            How it works
          </div>
          <h2
            className="text-[32px] md:text-[48px] leading-[1.08] tracking-[-0.028em] font-medium max-w-[820px] mb-5"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Seven stages. Each one{" "}
            <em className="font-serif font-normal italic text-fg-dim">
              inspectable,
            </em>{" "}
            <em className="font-serif font-normal italic text-fg-dim">
              reproducible,
            </em>{" "}
            and cheap to replay.
          </h2>
          <p className="text-[15px] md:text-[17px] leading-[1.6] text-fg-dim max-w-[620px] mb-12">
            Every run is a DAG of small, deterministic tasks. Fail a step,
            rerun just that step. Change a model, diff the outputs. No magic.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-ink-600 rounded-[14px] overflow-hidden border border-ink-600">
            {HOW_STAGES.map((s) => (
              <div
                key={s.name}
                className="bg-ink-800 p-5 md:p-6 min-h-[180px] flex flex-col"
              >
                <div className="font-mono text-[10px] text-fg-faint tracking-[0.06em]">
                  {s.tick}
                </div>
                <h4 className="text-[16px] font-medium mt-3 mb-2 tracking-[-0.01em] text-fg">
                  <span className="inline-grid w-[22px] h-[22px] rounded-md place-items-center align-[-5px] mr-2 text-accent-primary bg-accent-primary/10 border border-accent-primary/25">
                    {s.icon}
                  </span>
                  {s.name}
                </h4>
                <p className="text-[12.5px] text-fg-muted leading-[1.55] mb-3">
                  {s.body}
                </p>
                <div className="mt-auto font-mono text-[10.5px] text-accent-primary px-2 py-1.5 bg-ink-900 rounded-md border border-ink-500">
                  <span className="text-fg-faint">out →</span> {s.out}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SOURCES */}
        <section
          id="sources"
          className="py-20 md:py-28 border-t border-ink-600 scroll-mt-20"
        >
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4">
            Sources
          </div>
          <h2
            className="text-[32px] md:text-[48px] leading-[1.08] tracking-[-0.028em] font-medium max-w-[820px] mb-5"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Full-text, not snippets.{" "}
            <em className="font-serif font-normal italic text-fg-dim">
              Playwright pulls the real paper.
            </em>
          </h2>
          <p className="text-[15px] md:text-[17px] leading-[1.6] text-fg-dim max-w-[620px] mb-12">
            Abstracts alone can&apos;t support a verified claim. Every source goes
            through headless Chromium so the quote that grounds each fact comes
            from the actual body of the document, not a Google snippet.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {SOURCES.map((s) => (
              <div
                key={s.name}
                className="border border-ink-600 rounded-xl bg-ink-800 p-5 md:p-6"
              >
                <div
                  className={
                    "w-9 h-9 rounded-lg grid place-items-center font-mono text-[12px] font-semibold mb-4 " +
                    s.tagClass
                  }
                >
                  {s.tag}
                </div>
                <h4 className="text-[15px] font-semibold mb-2 tracking-[-0.01em]">
                  {s.name}
                </h4>
                <p className="text-[12.5px] text-fg-muted leading-[1.5]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* VERIFICATION SPOTLIGHT */}
        <section className="py-20 md:py-28 border-t border-ink-600">
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4">
            Verification, up close
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
            <div>
              <h3
                className="text-[26px] md:text-[32px] leading-[1.15] tracking-[-0.02em] font-medium max-w-[520px] mb-5"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Every fact ships with a{" "}
                <em className="font-serif font-normal italic text-fg-dim">
                  verdict.
                </em>{" "}
                Not a vibe.
              </h3>
              <p className="text-[14.5px] md:text-[15px] leading-[1.65] text-fg-dim max-w-[520px]">
                The three-layer verifier runs URL liveness, exact-quote
                substring match, and an adversarial LLM review against every
                extracted fact. Rejected facts never reach the final report.
              </p>
              <ul className="list-none pl-0 mt-6 flex flex-col gap-2.5">
                <li className="flex gap-3 items-start text-[13.5px] text-fg-dim">
                  <span className="text-accent-sage font-mono shrink-0">●</span>
                  <strong className="text-fg font-medium font-mono text-[12px] mr-1">
                    VERIFIED
                  </strong>
                  <span>
                    URL alive · quote matches · adversarial review clears it
                  </span>
                </li>
                <li className="flex gap-3 items-start text-[13.5px] text-fg-dim">
                  <span className="text-accent-amber font-mono shrink-0">●</span>
                  <strong className="text-fg font-medium font-mono text-[12px] mr-1">
                    PARTIAL
                  </strong>
                  <span>
                    Supported with qualifications — reviewer flags the gap
                  </span>
                </li>
                <li className="flex gap-3 items-start text-[13.5px] text-fg-dim">
                  <span className="text-accent-red font-mono shrink-0">●</span>
                  <strong className="text-fg font-medium font-mono text-[12px] mr-1">
                    CONTRADICTED
                  </strong>
                  <span>
                    Source disagrees with the claim · surfaced, not dropped
                  </span>
                </li>
                <li className="flex gap-3 items-start text-[13.5px] text-fg-dim">
                  <span className="text-fg-muted font-mono shrink-0">○</span>
                  <strong className="text-fg font-medium font-mono text-[12px] mr-1">
                    UNSUPPORTED
                  </strong>
                  <span>
                    Quote not found in source text · removed from the report
                  </span>
                </li>
              </ul>
            </div>

            <div
              className="relative rounded-[14px] border border-ink-600 p-4 md:p-5 overflow-hidden"
              style={{ background: "var(--ink-800)" }}
            >
              <div className="absolute -top-[60px] -right-[60px] w-[200px] h-[200px] pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle, rgba(232,165,132,0.12), transparent 70%)",
                }}
              />
              {VERIFY_DEMO.map((r) => (
                <div
                  key={r.num}
                  className="relative grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3.5 py-3 rounded-[10px] bg-ink-900 border border-ink-600 mb-2 text-[12.5px]"
                >
                  <div className="font-mono text-fg-faint text-[10.5px]">
                    #{r.num}
                  </div>
                  <div>
                    <div className="text-fg leading-[1.4]">{r.claim}</div>
                    <div className="font-mono text-fg-muted text-[10.5px] mt-1">
                      {r.src}
                    </div>
                  </div>
                  <div
                    className={
                      "inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-[3px] rounded-[5px] whitespace-nowrap " +
                      r.verdictClass
                    }
                  >
                    {r.verdict}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SPEC STRIP */}
        <section className="py-20 md:py-28 border-t border-ink-600">
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4">
            Numbers
          </div>
          <h2
            className="text-[32px] md:text-[44px] leading-[1.08] tracking-[-0.028em] font-medium max-w-[820px] mb-5"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Built for the{" "}
            <em className="font-serif font-normal italic text-fg-dim">
              long-tail daily-driver
            </em>{" "}
            workflow.
          </h2>
          <p className="text-[15px] md:text-[17px] leading-[1.6] text-fg-dim max-w-[620px] mb-12">
            Self-hosted LLM on flat-rate Runpod, self-hosted SearXNG, local
            scrape cache. No rate-limit surprises, no per-token metering.
            Replay any stage for free.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-px bg-ink-600 rounded-[14px] overflow-hidden border border-ink-600">
            {SPECS.map((s) => (
              <div
                key={s.k}
                className="p-6 md:p-7 bg-ink-800"
              >
                <div className="font-mono text-[10.5px] text-fg-faint tracking-[0.08em] uppercase mb-2.5">
                  {s.k}
                </div>
                <div
                  className="text-[32px] md:text-[38px] font-medium leading-none text-fg"
                  style={{ letterSpacing: "-0.025em" }}
                >
                  {s.v}
                  <span className="text-fg-muted text-[16px] md:text-[18px] ml-1 font-normal">
                    {s.unit}
                  </span>
                </div>
                <div className="mt-2.5 text-[12.5px] text-fg-muted leading-[1.4]">
                  {s.d}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* OUTPUT SHOWCASE */}
        <section className="py-20 md:py-28 border-t border-ink-600">
          <div className="font-mono text-[11px] text-accent-primary tracking-[0.12em] uppercase mb-4 text-center">
            The output
          </div>
          <h2
            className="text-[32px] md:text-[44px] leading-[1.08] tracking-[-0.028em] font-medium mx-auto text-center mb-4"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            What you actually get.
          </h2>
          <p className="text-[15px] md:text-[17px] leading-[1.6] text-fg-dim max-w-[620px] mx-auto text-center mb-12">
            A REPORT.md with citations inline, a PDF ready to ship, and the
            full JSON audit trail — plan, sources, facts, verdicts, analysis.
          </p>

          <div className="border border-ink-600 rounded-[14px] bg-ink-800 px-6 md:px-12 py-8 md:py-10 max-w-[780px] mx-auto">
            <div className="font-mono text-[11px] text-fg-faint tracking-[0.06em] mb-4">
              REPORT.md · run #42a7 · 48m · 15 sub-questions · 978 sources
            </div>
            <h5
              className="text-[20px] md:text-[24px] leading-[1.2] tracking-[-0.018em] font-medium mb-2"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              Does niacinamide reduce transepidermal water loss?
            </h5>
            <div className="font-mono text-[11px] text-fg-muted mb-6">
              149 / 208 facts verified · 12 partial · 4 contradicted
            </div>

            <div className="font-mono text-[10.5px] text-accent-primary tracking-[0.08em] uppercase mt-5 mb-2">
              Summary
            </div>
            <p className="text-[14px] leading-[1.65] text-fg mb-3.5">
              Topical niacinamide at 2–5% measurably reduces transepidermal
              water loss over a 4–8 week window
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F42]
              </sup>
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F51]
              </sup>
              . The effect is mediated primarily through upregulation of
              ceramide and free-fatty-acid synthesis in the stratum corneum
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F47]
              </sup>
              , though contradicting evidence exists for penetration kinetics
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F44]
              </sup>
              .
            </p>

            <div className="font-mono text-[10.5px] text-accent-primary tracking-[0.08em] uppercase mt-5 mb-2">
              Key qualifiers
            </div>
            <p className="text-[14px] leading-[1.65] text-fg">
              Effect size varies across Fitzpatrick skin types I–VI — only one
              trial reports stratified data
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F43]
              </sup>
              . Formulation matters: emulsion-based vehicles outperform aqueous
              by ~1.4× at the same concentration
              <sup className="text-accent-primary font-mono text-[10.5px] px-0.5">
                [F52]
              </sup>
              .
            </p>

            <div className="font-mono text-[11px] text-fg-muted pt-4 border-t border-dashed border-ink-500 mt-5">
              [F42] Hakozaki 2002 Br J Dermatol · [F43] Navarrete-Solís 2011 ·
              [F44] Gehring 2004 vs Tanno 2000 (contradicted) · [F47] Bissett
              2004 · [F51] Walocko 2017 · [F52] Draelos 2006
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-ink-600 py-20 md:py-28">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0 lg:sticky lg:top-8">
              <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-primary">
                FAQ
              </div>
              <h2
                className="max-w-[560px] text-[30px] font-medium leading-[1.08] tracking-[-0.018em] md:text-[42px]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Before you trust a research answer, ask these.
              </h2>
              <p className="mt-4 max-w-[460px] text-[14.5px] leading-[1.65] text-fg-dim">
                Syncera is built for people who need to defend a conclusion,
                not just read a confident paragraph.
              </p>
            </div>

            <div className="min-w-0">
              {FAQ.map((item, i) => (
                <details
                  key={item.q}
                  open={i === 0}
                  className="group border-b border-ink-600 py-5 first:border-t md:py-6"
                >
                  <summary className="flex min-w-0 cursor-pointer list-none items-start justify-between gap-4 text-[15.5px] font-medium tracking-[-0.01em] text-fg md:text-[17px]">
                    <span className="min-w-0">{item.q}</span>
                    <span className="shrink-0 text-[22px] font-light leading-none text-fg-muted transition group-open:hidden">
                      +
                    </span>
                    <span className="hidden shrink-0 text-[22px] font-light leading-none text-fg-muted transition group-open:inline">
                      −
                    </span>
                  </summary>
                  <div className="max-w-[720px] pt-3 text-[14px] leading-[1.65] text-fg-dim md:text-[14.5px]">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="pb-12 pt-8 md:pb-16 md:pt-12">
          <div
            className="overflow-hidden rounded-[14px] border border-ink-600 px-5 py-10 md:px-10 md:py-14"
            style={{
              background:
                "radial-gradient(circle at 30% 30%, rgba(232,165,132,0.10), transparent 60%), var(--ink-800)",
            }}
          >
            <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
              <div className="min-w-0">
                <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-primary">
                  Start with one question
                </div>
                <h2
                  className="max-w-[820px] text-[32px] font-medium leading-[1.04] tracking-[-0.02em] md:text-[52px]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  Turn a messy topic into a report you can audit line by line.
                </h2>
                <p className="mt-4 max-w-[650px] text-[15px] leading-[1.7] text-fg-dim md:text-[17px]">
                  A run produces REPORT.md, PDF, verified facts, rejected
                  claims, source trust status, research debt, and a JSON audit
                  trail you can replay or branch.
                </p>
              </div>
              <div className="min-w-0 space-y-3">
                <Link
                  href="/signup"
                  className="inline-flex h-11 w-full items-center justify-center rounded-[9px] bg-accent-primary px-5 text-[14.5px] font-semibold text-ink-900 transition hover:brightness-110"
                >
                  Start a research run
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-11 w-full items-center justify-center rounded-[9px] border border-ink-500 bg-transparent px-5 text-[14.5px] font-medium text-fg transition hover:border-fg-muted hover:bg-ink-800"
                >
                  Sign in
                </Link>
                <div className="text-[11.5px] leading-relaxed text-fg-muted">
                  No credit card during beta. Self-hostable, OpenAPI-ready, MIT.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t border-ink-600 py-10 md:py-12 font-mono text-[11px] text-fg-faint flex justify-between items-baseline flex-wrap gap-4">
          <div>© 2026 Syncera · MIT</div>
          <div className="flex gap-5">
            <a
              href="/api/openapi.json"
              className="hover:text-fg-dim cursor-pointer"
            >
              OpenAPI
            </a>
            <a
              href="https://github.com"
              className="hover:text-fg-dim cursor-pointer"
            >
              GitHub
            </a>
            <Link href="/login" className="hover:text-fg-dim">
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

const STATIC_STAGES = [
  {
    num: "01 · SCOUT",
    name: "Decompose",
    desc: "Map the domain, calibrate the field",
    log: "→ 412 candidate topics",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    num: "02 · PLAN",
    name: "Questions",
    desc: "Cut topic into 6 × 6 sub-question matrix",
    log: "→ 15 branches",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    num: "03 · HARVEST",
    name: "Retrieve",
    desc: "Arxiv + OpenAlex + SearXNG + PubMed",
    log: "→ 978 sources",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    num: "04 · VERIFY",
    name: "Cross-check",
    desc: "URL live → quote substring → LLM adversarial",
    log: "verifying 184 / 278 claims…",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    num: "05 · ANALYZE",
    name: "Weigh",
    desc: "Coverage, contradictions, gaps",
    log: "pending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    num: "06 · SYNTH",
    name: "Assemble",
    desc: "MD + PDF + JSON audit trail",
    log: "pending",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

const PROBLEMS = [
  {
    title: "Fabricated citations",
    body: "ChatGPT-style tools invent DOIs that look plausible but point to nothing. You only notice when you try to click.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-4 h-4"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12" y2="17" />
      </svg>
    ),
  },
  {
    title: "Black-box synthesis",
    body: '"Trust us, we read 40 papers" — with no visible chain from claim → passage → source. Impossible to audit, impossible to debug.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-4 h-4"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 3v18" />
      </svg>
    ),
  },
  {
    title: "One-shot outputs",
    body: "A single LLM call with no verification loop. Every contradiction stays hidden, every nuance gets flattened.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-4 h-4"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

const HOW_STAGES = [
  {
    tick: "01 · SCOUT",
    name: "Scan domain",
    body: "Fast literature sweep calibrates what exists in the field before we commit to any research questions.",
    out: "scout.md",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    tick: "02 · PLAN",
    name: "Decompose",
    body: "Planner cuts the topic into 3–12 research questions with 2–4 sub-angles each. No invented hypotheses.",
    out: "plan.json",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    tick: "03 · HARVEST",
    name: "Retrieve",
    body: "Parallel fetch from Arxiv, OpenAlex, SearXNG, Semantic Scholar. Playwright pulls full text, not snippets.",
    out: "200–600 docs",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    tick: "04 · EVIDENCE",
    name: "Claim mining",
    body: "Atomic factual statements bound to the exact quote in the source. Each fact is a citable unit.",
    out: "facts.json",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    tick: "05 · VERIFY",
    name: "Three-layer check",
    body: "L1 URL liveness → L2 quote substring match → L3 LLM adversarial review. Rejected facts don't ship.",
    out: "verdicts.json",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    ),
  },
  {
    tick: "06 · ANALYZE + SYNTH",
    name: "Assemble",
    body: "Per-question narrative from verified facts + coverage status + cross-question contradictions. REPORT.md + PDF.",
    out: "REPORT.md, PDF",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="w-3 h-3"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
];

const SOURCES = [
  {
    tag: "aX",
    tagClass:
      "bg-accent-primary/10 text-accent-primary border border-accent-primary/28",
    name: "Arxiv",
    body: "Preprints in CS, physics, quant-bio. Full PDF harvest, not just abstract.",
  },
  {
    tag: "oA",
    tagClass:
      "bg-accent-blue/10 text-accent-blue border border-accent-blue/25",
    name: "OpenAlex",
    body: "250M+ scholarly works with cleaned citation graph and open access links.",
  },
  {
    tag: "sX",
    tagClass:
      "bg-accent-purple/10 text-accent-purple border border-accent-purple/25",
    name: "SearXNG",
    body: "Self-hosted meta-search across Google / Bing / DuckDuckGo for web-level signals beyond academia.",
  },
];

const VERIFY_DEMO = [
  {
    num: "F042",
    claim: "Niacinamide at 5% reduces TEWL by 24% over 4 weeks.",
    src: "Hakozaki 2002 · Bissett 2004",
    verdict: "✓ VERIFIED",
    verdictClass:
      "text-accent-sage bg-accent-sage/10 border border-accent-sage/20",
  },
  {
    num: "F043",
    claim: "Effect size is comparable across Fitzpatrick skin types.",
    src: "Navarrete-Solís 2011 only",
    verdict: "~ PARTIAL",
    verdictClass:
      "text-accent-amber bg-accent-amber/10 border border-accent-amber/20",
  },
  {
    num: "F044",
    claim:
      "Topical niacinamide penetrates the stratum corneum in < 10 min.",
    src: "Gehring 2004 vs Tanno 2000",
    verdict: "✗ CONTRADICTED",
    verdictClass:
      "text-accent-red bg-accent-red/10 border border-accent-red/20",
  },
  {
    num: "F045",
    claim:
      "Reduces sebum production independent of ceramide pathway.",
    src: "Draelos 2006 · Walocko 2017",
    verdict: "✓ VERIFIED",
    verdictClass:
      "text-accent-sage bg-accent-sage/10 border border-accent-sage/20",
  },
];

const SPECS = [
  {
    k: "Median run",
    v: "48",
    unit: "min",
    d: "Topic → verified REPORT.md + PDF end-to-end.",
  },
  {
    k: "Facts / run",
    v: "208",
    unit: "avg",
    d: "Atomic, citable, each with an L1/L2/L3 verdict.",
  },
  {
    k: "Fact kill-rate",
    v: "28",
    unit: "%",
    d: "Verifier rejects this share before they reach the report.",
  },
  {
    k: "Replay a stage",
    v: "~0",
    unit: "¢",
    d: "Artefacts cached; --replan / --re-synth cost nothing.",
  },
];

const FAQ = [
  {
    q: "How is this different from Perplexity, Elicit, or You.com?",
    a: (
      <>
        Those products are optimized for fast answers. Syncera is optimized
        for accountable research: question plan, source harvest, exact-quote
        facts, verifier verdicts, claim lifecycle, source trust, research
        debt, and report artifacts are all kept separately so a team can audit
        where a conclusion came from.
      </>
    ),
  },
  {
    q: "What stops it from rubber-stamping weak evidence?",
    a: (
      <>
        Verification has deterministic checks before the adversarial LLM pass:
        URL liveness, quote-keyword matching against scraped content, and
        attribution checks that make sure the cited URL actually discusses the
        fact&apos;s named entity. Manually ignored sources are excluded, and
        questionable sources lower confidence and create research debt.
      </>
    ),
  },
  {
    q: "Can we use it inside our own workflow?",
    a: (
      <>
        Yes. The web app is backed by an OpenAPI 3.1 surface at{" "}
        <a href="/api/openapi.json" className="text-accent-primary underline">
          /api/openapi.json
        </a>
        . You can start runs, stream logs, read facts, fetch reports, export
        audit JSON, and receive signed webhooks when a run completes.
      </>
    ),
  },
  {
    q: "Can it work with internal or confidential sources?",
    a: "Yes. Syncera is filesystem-first and self-hostable. You can bring your own URLs, keep artifacts on your own machine, and point the LLM layer at Qwen, Gemini, or another compatible endpoint. The hosted beta is for convenience; the architecture is not locked to hosted search or hosted models.",
  },
  {
    q: "Which LLMs does it use?",
    a: "The local/default profile is Qwen on an OpenAI-compatible endpoint. Gemini is supported as a separate provider, including higher parallelism and search grounding where available. The pipeline keeps provider choice explicit because deep research depends on cost, context, parallelism, and retrieval behavior.",
  },
  {
    q: "What do we get after one run?",
    a: "A report is only the top layer. You also get verified facts, rejected facts, source list, evidence quotes, claim lifecycle, contradiction map, research debt, source trust overrides, cognitive score, PDF, REPORT.md, and audit JSON.",
  },
  {
    q: "Pricing?",
    a: "Free during beta. The repo is MIT for self-hosting. Hosted pricing will be simple and usage-aware because serious research can touch hundreds of sources and many LLM calls; the product shows token and cost telemetry so teams can see what a run consumed.",
  },
];
