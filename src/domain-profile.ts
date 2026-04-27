export type DomainProfileId =
  | "generic"
  | "llm_infra"
  | "chemistry_cosmetics"
  | "battery_materials"
  | "biomedical_clinical";

export interface DomainProfile {
  id: DomainProfileId;
  label: string;
  plannerGuidance: string[];
  academicSiteFilters: string[];
  queryExamples: string[];
  namedEntities: string[];
  metrics: string[];
  sourcePreferences: string[];
  learningGuidance: string[];
  evidenceGuidance: string[];
}

const PROFILES: Record<DomainProfileId, DomainProfile> = {
  generic: {
    id: "generic",
    label: "general research",
    plannerGuidance: [
      "Use 5-7 focused questions for a narrow applied topic; only expand toward 10-15 for broad surveys.",
      "Keep questions tied to decisions the reader can make after reading the report.",
    ],
    academicSiteFilters: [
      "site:scholar.google.com",
      "site:researchgate.net",
      "site:semanticscholar.org",
      "site:openalex.org",
      "site:ncbi.nlm.nih.gov",
    ],
    queryExamples: [
      '"<specific method/entity> <metric/outcome> systematic review"',
      '"<official source or standard> <topic-specific term> guidance"',
      '"<method A> vs <method B> <comparison axis>"',
    ],
    namedEntities: [
      "named methods",
      "standards",
      "datasets",
      "benchmarks",
      "organizations",
      "regulations",
    ],
    metrics: [
      "measured outcomes",
      "sample sizes",
      "dates",
      "versions",
      "effect sizes",
      "failure rates",
    ],
    sourcePreferences: [
      "peer-reviewed papers",
      "official documentation",
      "standards and regulatory documents",
      "primary datasets",
      "high-quality technical reports",
    ],
    learningGuidance: [
      "Capture who reported the finding, what was measured, and under which conditions.",
      "Prefer source-grounded limitations and boundary conditions over generic summaries.",
    ],
    evidenceGuidance: [
      "Do not force technology-specific categories; use the topic's own named entities and metrics.",
      "When the field has standards, regulations, or primary datasets, cite those over summaries.",
    ],
  },
  llm_infra: {
    id: "llm_infra",
    label: "LLM infrastructure / ML systems",
    plannerGuidance: [
      "Structure around capacity, accuracy, throughput, backend support, failure modes, and deployment path.",
      "Do not ask implementation-coding questions unless the topic explicitly asks for engineering steps.",
    ],
    academicSiteFilters: [
      "site:arxiv.org",
      "site:openreview.net",
      "site:aclanthology.org",
      "site:papers.nips.cc",
      "site:proceedings.mlr.press",
      "site:dl.acm.org",
    ],
    queryExamples: [
      '"KIVI: Tuning-free asymmetric 2-bit quantization for KV cache"',
      '"vLLM KV cache quantization FP8 benchmark"',
      '"LoRA QLoRA DoRA 70B VRAM latency benchmark"',
    ],
    namedEntities: [
      "TurboQuant",
      "KIVI",
      "KVQuant",
      "vLLM",
      "TensorRT-LLM",
      "FlashAttention",
      "LoRA",
      "QLoRA",
      "DoRA",
      "LongBench",
      "WikiText-103",
    ],
    metrics: [
      "perplexity delta",
      "tokens/sec",
      "VRAM footprint",
      "compression ratio",
      "latency",
      "acceptance rate",
      "benchmark score",
    ],
    sourcePreferences: [
      "arXiv/OpenReview papers",
      "conference proceedings",
      "official framework docs",
      "reproducible GitHub repositories",
      "vendor benchmark reports",
    ],
    learningGuidance: [
      "Extract one learning per method/baseline reported in tables, including negative results.",
      "Keep model names, hardware, context length, bit width, benchmark, and framework version attached to each metric.",
    ],
    evidenceGuidance: [
      "Separate method performance, integration status, and hardware-specific deployment evidence.",
      "Do not generalize results across model families unless the source explicitly compares them.",
    ],
  },
  chemistry_cosmetics: {
    id: "chemistry_cosmetics",
    label: "chemistry / cosmetics R&D",
    plannerGuidance: [
      "Use 5 tightly scoped R&D questions for narrow formulation topics: dose/application, skin concentration, repeated application, vehicle/formulation variables, and measurement/validation methods.",
      "Prefer practical formulation and assay questions over numerical-method questions unless the user explicitly asks for FDM, Crank-Nicolson, COMSOL, or simulation schemes.",
      "Do not split hydrophilic vs lipophilic, in vivo vs ex vivo, or layer thickness vs concentration into separate top-level questions unless the topic is broad enough; make them subquestions.",
    ],
    academicSiteFilters: [
      "site:ncbi.nlm.nih.gov",
      "site:pmc.ncbi.nlm.nih.gov",
      "site:pubmed.ncbi.nlm.nih.gov",
      "site:sciencedirect.com",
      "site:tandfonline.com",
      "site:wiley.com",
      "site:springer.com",
      "site:mdpi.com",
      "site:karger.com",
    ],
    queryExamples: [
      '"Ethylhexyl Methoxycinnamate photostability sunscreen formulation"',
      '"Diethylamino Hydroxybenzoyl Hexyl Benzoate UVA photostabilizer study"',
      '"titanium dioxide sunscreen dermal penetration review"',
    ],
    namedEntities: [
      "INCI ingredient names",
      "CAS numbers",
      "UV filters",
      "photostabilizers",
      "formulation vehicles",
      "skin models",
      "SPF",
      "UVA",
      "UVB",
    ],
    metrics: [
      "degradation half-life",
      "SPF/UVA-PF",
      "absorbance",
      "concentration",
      "particle size",
      "penetration depth",
      "irradiation dose",
      "stability time",
    ],
    sourcePreferences: [
      "peer-reviewed chemistry/cosmetic science papers",
      "regulatory safety opinions",
      "clinical or in vitro studies",
      "supplier technical dossiers",
      "patents only when primary literature is absent",
    ],
    learningGuidance: [
      "Preserve ingredient names, formulation context, solvent/vehicle, irradiation conditions, and assay type.",
      "Distinguish in vitro, ex vivo, clinical, and regulatory-safety evidence.",
    ],
    evidenceGuidance: [
      "Do not cite consumer wellness or e-commerce pages for R&D claims.",
      "Do not transfer findings between neat ingredient, emulsion, and finished formulation unless the source does.",
    ],
  },
  battery_materials: {
    id: "battery_materials",
    label: "battery / materials R&D",
    plannerGuidance: [
      "Structure around degradation mechanism, operating condition, measurement protocol, comparative chemistry, and deployment trade-off.",
      "Keep cell chemistry, temperature, SOC/DoD, C-rate, and duration attached to questions.",
    ],
    academicSiteFilters: [
      "site:sciencedirect.com",
      "site:nature.com",
      "site:acs.org",
      "site:wiley.com",
      "site:springer.com",
      "site:mdpi.com",
      "site:osti.gov",
      "site:nrel.gov",
    ],
    queryExamples: [
      '"lithium-ion calendar aging 80% state of charge temperature Arrhenius"',
      '"solid electrolyte interphase capacity fade storage state of charge"',
      '"EV lithium ion cycle life depth of discharge fast charging study"',
    ],
    namedEntities: [
      "cell chemistry",
      "SEI",
      "SOC",
      "DoD",
      "NMC",
      "LFP",
      "solid-state electrolyte",
      "C-rate",
      "Arrhenius",
    ],
    metrics: [
      "capacity retention",
      "cycle count",
      "temperature",
      "state of charge",
      "C-rate",
      "energy density",
      "impedance growth",
      "calendar aging rate",
    ],
    sourcePreferences: [
      "peer-reviewed electrochemistry papers",
      "cell manufacturer datasheets",
      "standards bodies",
      "national lab reports",
      "field fleet studies",
    ],
    learningGuidance: [
      "Attach cell chemistry, temperature, SOC/DoD, C-rate, and test duration to each finding.",
      "Separate calendar aging, cycle aging, fast-charge stress, and safety data.",
    ],
    evidenceGuidance: [
      "Do not generalize across chemistries without explicit evidence.",
      "Prefer long-duration cell tests and field data over generic battery advice.",
    ],
  },
  biomedical_clinical: {
    id: "biomedical_clinical",
    label: "biomedical / clinical research",
    plannerGuidance: [
      "Structure around population, intervention/exposure, comparator, outcome, safety, and guideline/regulatory status.",
      "Separate clinical evidence from preclinical mechanism evidence.",
    ],
    academicSiteFilters: [
      "site:pubmed.ncbi.nlm.nih.gov",
      "site:pmc.ncbi.nlm.nih.gov",
      "site:clinicaltrials.gov",
      "site:cochranelibrary.com",
      "site:who.int",
      "site:fda.gov",
      "site:ema.europa.eu",
    ],
    queryExamples: [
      '"<intervention> randomized controlled trial <population> outcome"',
      '"<compound> safety assessment regulatory opinion"',
      '"<biomarker> systematic review meta-analysis <condition>"',
    ],
    namedEntities: [
      "interventions",
      "conditions",
      "outcomes",
      "patient populations",
      "trial identifiers",
      "dosage",
      "adverse events",
      "guidelines",
    ],
    metrics: [
      "sample size",
      "effect size",
      "confidence interval",
      "p-value",
      "hazard ratio",
      "risk ratio",
      "adverse event rate",
      "follow-up duration",
    ],
    sourcePreferences: [
      "randomized trials",
      "systematic reviews",
      "clinical guidelines",
      "regulatory labels",
      "trial registries",
      "observational cohorts when RCTs are absent",
    ],
    learningGuidance: [
      "Always retain population, intervention/exposure, comparator, outcome, and follow-up duration.",
      "Separate efficacy, safety, mechanism, and guideline evidence.",
    ],
    evidenceGuidance: [
      "Do not upgrade observational findings to causal claims.",
      "Do not cite preclinical evidence as clinical efficacy unless the source explicitly supports it.",
    ],
  },
};

export function detectDomainProfile(
  topic: string,
  context?: string | null
): DomainProfile {
  const text = `${topic}\n${context ?? ""}`.toLowerCase();

  if (
    /\b(cosmetic|sunscreen|spf|uva|uvb|inci|skin|dermal|photostability|photodegradation|ethylhexyl|octinoxate|titanium dioxide|zinc oxide|emulsion|formulation)\b/.test(
      text
    )
  ) {
    return PROFILES.chemistry_cosmetics;
  }

  if (
    /\b(battery|lithium|li-ion|solid-state|electrolyte|sei|state of charge|\bsoc\b|depth of discharge|\bdod\b|nmc|lfp|c-rate|calendar aging|cycle life)\b/.test(
      text
    )
  ) {
    return PROFILES.battery_materials;
  }

  if (
    /\b(clinical|patient|trial|randomized|rct|cohort|therapy|drug|dose|adverse|biomarker|disease|diagnosis|guideline|fda|ema)\b/.test(
      text
    )
  ) {
    return PROFILES.biomedical_clinical;
  }

  if (
    /\b(llm|language model|transformer|inference|kv-cache|kv cache|lora|qlora|dora|flashattention|vllm|tensorrt|cuda|gpu|token|perplexity|fine-tuning|reranker|colbert|rope|speculative decoding)\b/.test(
      text
    )
  ) {
    return PROFILES.llm_infra;
  }

  return PROFILES.generic;
}

export function domainPromptBlock(profile: DomainProfile): string {
  return [
    `## Domain profile: ${profile.label}`,
    "",
    "Use the examples below only when they match the user's topic. Do not import example entities into unrelated domains.",
    "",
    "High-signal query patterns:",
    ...profile.queryExamples.map((x) => `- ${x}`),
    "",
    "Planning guidance:",
    ...profile.plannerGuidance.map((x) => `- ${x}`),
    "",
    "Named entities worth preserving:",
    ...profile.namedEntities.map((x) => `- ${x}`),
    "",
    "Metrics and context to retain:",
    ...profile.metrics.map((x) => `- ${x}`),
    "",
    "Preferred sources:",
    ...profile.sourcePreferences.map((x) => `- ${x}`),
  ].join("\n");
}

export function plannerGuidanceBlock(profile: DomainProfile): string {
  return [
    `## Domain planning profile: ${profile.label}`,
    ...profile.plannerGuidance.map((x) => `- ${x}`),
  ].join("\n");
}

export function academicSiteFilter(profile: DomainProfile): string {
  return profile.academicSiteFilters.join(" OR ");
}

export function learningGuidanceBlock(profile: DomainProfile): string {
  return [
    domainPromptBlock(profile),
    "",
    "Domain-specific extraction guidance:",
    ...profile.learningGuidance.map((x) => `- ${x}`),
  ].join("\n");
}

export function evidenceGuidanceBlock(profile: DomainProfile): string {
  return [
    domainPromptBlock(profile),
    "",
    "Domain-specific attribution guidance:",
    ...profile.evidenceGuidance.map((x) => `- ${x}`),
  ].join("\n");
}

export function entityExamples(profile: DomainProfile): string {
  return profile.namedEntities.slice(0, 10).join(", ");
}
