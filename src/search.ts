import type { SearchResult } from "./schemas/source";
import { config } from "./config";

// --- SearXNG (self-hosted, primary web search) ---

export async function searchSearXNG(
  query: string,
  opts: { maxResults?: number; pageno?: number; categories?: string } = {}
): Promise<SearchResult[]> {
  const { maxResults = 20, pageno = 1, categories = "general" } = opts;

  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories,
    pageno: String(pageno),
  });

  const resp = await fetch(`${config.searxng.url}/search?${params}`, {
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    console.warn(`[searxng] Error ${resp.status}: ${await resp.text().catch(() => "")}`);
    return [];
  }

  const data = await resp.json();
  return (data.results ?? []).slice(0, maxResults).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    provider: `searxng:${r.engine ?? "?"}`,
    query,
  }));
}

// --- Arxiv (academic, free) ---

export async function searchArxiv(
  query: string,
  maxResults = 15
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `http://export.arxiv.org/api/query?search_query=all:${encoded}&max_results=${maxResults}&sortBy=relevance`;

  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(`[arxiv] Error ${resp.status}`);
    return [];
  }

  const xml = await resp.text();
  // Rewrite abstract URLs to HTML URLs — Jina Reader gets full paper text
  // from /html/<id> endpoint instead of ~400-char abstract summary.
  const entries = parseArxivXml(xml, query);
  return entries.map((e) => ({
    ...e,
    url: e.url.replace(/\/abs\//, "/html/"),
  }));
}

function parseArxivXml(xml: string, query: string): SearchResult[] {
  const entries: SearchResult[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;

  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const title = extractTag(entry, "title")?.replace(/\s+/g, " ").trim() ?? "";
    const summary =
      extractTag(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
    const link =
      entry.match(/href="(https:\/\/arxiv\.org\/abs\/[^"]+)"/)?.[1] ?? "";

    if (title && link) {
      entries.push({
        title,
        url: link,
        snippet: summary.slice(0, 500),
        provider: "arxiv",
        query,
      });
    }
  }
  return entries;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1] : null;
}

// --- OpenAlex (free, no key, 250M+ papers) ---

export async function searchOpenAlex(
  query: string,
  maxResults = 15
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.openalex.org/works?search=${encoded}&per-page=${maxResults}&filter=has_abstract:true`;

  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "research-lab/1.0 (mailto:research-lab@local)",
    },
  });
  if (!resp.ok) {
    if (resp.status !== 429) console.warn(`[openalex] Error ${resp.status}`);
    return [];
  }
  const data = await resp.json();
  return (data.results ?? []).map((p: any) => {
    const url =
      p.open_access?.oa_url ||
      p.primary_location?.landing_page_url ||
      (p.doi ? `https://doi.org/${String(p.doi).replace(/^https:\/\/doi\.org\//, "")}` : "") ||
      p.id;
    const title = p.title ?? p.display_name ?? "";
    const year = p.publication_year;
    const citations = p.cited_by_count;
    const abstract = invertAbstract(p.abstract_inverted_index);
    return {
      title,
      url,
      snippet: [
        abstract?.slice(0, 400) ?? "",
        year ? `(${year})` : "",
        citations ? `[${citations} citations]` : "",
      ]
        .filter(Boolean)
        .join(" "),
      provider: "openalex",
      query,
    };
  });
}

function invertAbstract(inv: Record<string, number[]> | undefined | null): string {
  if (!inv) return "";
  const positions: [number, string][] = [];
  for (const [word, posArr] of Object.entries(inv)) {
    for (const p of posArr) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ");
}

// --- OpenReview (free, no key, venue-specific conference papers) ---

export async function searchOpenReview(
  query: string,
  maxResults = 10
): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://api2.openreview.net/notes/search?term=${encoded}&source=forum&type=all&limit=${maxResults}`;

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    if (resp.status !== 429) console.warn(`[openreview] Error ${resp.status}`);
    return [];
  }
  const data = await resp.json();
  return (data.notes ?? []).map((n: any) => {
    const content = n.content ?? {};
    const title = (content.title?.value ?? content.title ?? "").toString();
    const abstract = (content.abstract?.value ?? content.abstract ?? "").toString();
    const forumId = n.forum ?? n.id;
    return {
      title,
      url: `https://openreview.net/forum?id=${forumId}`,
      snippet: abstract.slice(0, 400),
      provider: "openreview",
      query,
    };
  });
}

// --- Semantic Scholar (academic, free, rate-limited) ---

export async function searchSemanticScholar(
  query: string,
  maxResults = 5
): Promise<SearchResult[]> {
  const simplified = simplifyQuery(query);
  const encoded = encodeURIComponent(simplified);
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=${maxResults}&fields=title,abstract,url,year,citationCount`;

  const resp = await fetch(url, { headers: { Accept: "application/json" } });

  if (!resp.ok) {
    if (resp.status === 429) {
      await sleep(2000);
      return [];
    }
    return [];
  }

  const data = await resp.json();
  return (data.data ?? []).map((p: any) => ({
    title: p.title ?? "",
    url: p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
    snippet: [
      p.abstract?.slice(0, 400) ?? "",
      p.year ? `(${p.year})` : "",
      p.citationCount ? `[${p.citationCount} citations]` : "",
    ]
      .filter(Boolean)
      .join(" "),
    provider: "semantic_scholar",
    query: simplified,
  }));
}

function simplifyQuery(query: string): string {
  const stopwords = new Set([
    "a", "an", "the", "and", "or", "for", "in", "on", "of", "to", "with", "using",
    "how", "what", "why", "which", "from", "that", "this", "into", "via", "based",
    "by", "at", "as", "is", "are", "be", "been", "being", "was", "were", "will",
    "implementation", "guide", "tutorial", "evaluating", "benchmarking",
    "optimizing", "comparison", "comparative", "analysis", "strategies",
    "techniques", "approaches", "methods",
  ]);
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));
  return words.slice(0, 6).join(" ");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Dispatcher: SearXNG primary, Arxiv/S2 as academic supplement ---

export async function searchAll(
  query: string,
  maxResults = 20
): Promise<SearchResult[]> {
  const [web, arxiv, openalex] = await Promise.all([
    searchSearXNG(query, { maxResults }),
    searchArxiv(query, 15),
    searchOpenAlex(query, 15),
  ]);

  const s2 = await searchSemanticScholar(query, 5);
  await sleep(1200); // respect S2 rate limit

  const flat = [...web, ...arxiv, ...openalex, ...s2];

  // Deduplicate by URL
  const seen = new Set<string>();
  return flat.filter((r) => {
    const key = r.url.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
