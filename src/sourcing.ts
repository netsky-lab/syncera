// Source quality classification.
// Lower tier number = higher quality (cited first).
//
// Tier 0 — PRIMARY: peer-reviewed papers, pre-prints, conference proceedings.
// Tier 1 — OFFICIAL: vendor docs, official model cards, framework documentation.
// Tier 2 — CODE: GitHub repositories, code examples, reference implementations.
// Tier 3 — BLOG: tech blogs, Medium, Substack, personal sites, LinkedIn.
// Tier 4 — COMMUNITY: forums, Reddit, Q&A, aggregators.
// Tier 5 — UNKNOWN / OTHER.

export type SourceTier = 0 | 1 | 2 | 3 | 4 | 5;

const PRIMARY_HOSTS = [
  "arxiv.org",
  "openreview.net",
  "aclanthology.org",
  "neurips.cc",
  "proceedings.neurips.cc",
  "proceedings.mlr.press",
  "papers.nips.cc",
  "dl.acm.org",
  "ieeexplore.ieee.org",
  "link.springer.com",
  "semanticscholar.org",
  "arxiv-vanity.com",
  "jmlr.org",
  "pubmed.ncbi.nlm.nih.gov",
  "biorxiv.org",
];

const OFFICIAL_HOSTS = [
  // AI vendors
  "ai.google.dev",
  "developers.googleblog.com",
  "googleblog.com",
  "research.google",
  "blog.google",
  "openai.com",
  "anthropic.com",
  "deepmind.com",
  "deepmind.google",
  "mistral.ai",
  "meta.com",
  "ai.meta.com",
  "huggingface.co",
  "nvidia.com",
  "developer.nvidia.com",
  "blogs.nvidia.com",
  "amd.com",
  "intel.com",
  "microsoft.com",
  "learn.microsoft.com",
  // Frameworks
  "pytorch.org",
  "tensorflow.org",
  "docs.vllm.ai",
  "vllm.ai",
  "docs.pytorch.org",
  "developers.gpu.nvidia.com",
  // Libraries
  "python.org",
  "docs.python.org",
  "docs.djangoproject.com",
];

const CODE_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "pypi.org",
  "npmjs.com",
  "crates.io",
  "dockerhub.com",
  "hub.docker.com",
];

const BLOG_PATTERNS = [
  /medium\.com/,
  /substack\.com/,
  /dev\.to/,
  /\.hashnode\./,
  /hackernoon\.com/,
  /towards(datascience|ai)\.com/,
  /thenextweb\.com/,
  /linkedin\.com\/pulse/,
  /^blog\./,
  /\.blog$/,
  /\/blog\//,
];

const COMMUNITY_PATTERNS = [
  /reddit\.com/,
  /stackoverflow\.com/,
  /stackexchange\.com/,
  /news\.ycombinator\.com/,
  /twitter\.com/,
  /x\.com/,
  /discord\.com/,
  /quora\.com/,
];

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function scoreSource(url: string): SourceTier {
  if (!url) return 5;
  const host = extractHost(url);
  if (!host) return 5;

  for (const h of PRIMARY_HOSTS) {
    if (host === h || host.endsWith(`.${h}`)) return 0;
  }
  for (const h of OFFICIAL_HOSTS) {
    if (host === h || host.endsWith(`.${h}`)) return 1;
  }
  for (const h of CODE_HOSTS) {
    if (host === h || host.endsWith(`.${h}`)) return 2;
  }
  for (const p of COMMUNITY_PATTERNS) {
    if (p.test(url)) return 4;
  }
  for (const p of BLOG_PATTERNS) {
    if (p.test(url)) return 3;
  }
  // "*.ai" / "*.io" personal/vendor sites — often blogs
  if (/\.(ai|io|dev|me|xyz)$/.test(host)) return 3;
  return 3; // default to blog tier
}

export function tierLabel(tier: SourceTier): string {
  switch (tier) {
    case 0:
      return "primary";
    case 1:
      return "official";
    case 2:
      return "code";
    case 3:
      return "blog";
    case 4:
      return "community";
    default:
      return "other";
  }
}

// Sort an array of items by their source URL tier (ascending = best first).
export function sortByTier<T>(items: T[], getUrl: (item: T) => string): T[] {
  return [...items].sort((a, b) => scoreSource(getUrl(a)) - scoreSource(getUrl(b)));
}
