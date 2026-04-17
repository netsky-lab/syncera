// Jina Reader: free URL → clean markdown content
// https://r.jina.ai/<url>

interface ReadResult {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
}

export async function readUrl(url: string, timeoutMs = 30000): Promise<ReadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Retain-Images": "none",
        "X-Md-Link-Style": "discarded",
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      return { url, title: "", content: "", success: false, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    const inner = data.data ?? {};
    return {
      url,
      title: inner.title ?? "",
      content: inner.content ?? "",
      success: true,
    };
  } catch (err: any) {
    clearTimeout(timer);
    return { url, title: "", content: "", success: false, error: err.message };
  }
}

// Read N URLs in parallel, bounded by concurrency
export async function readUrls(
  urls: string[],
  concurrency = 4,
  timeoutMs = 30000
): Promise<ReadResult[]> {
  const results: ReadResult[] = [];
  let i = 0;

  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      const result = await readUrl(url, timeoutMs);
      results[idx] = result;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Truncate content to fit in context window
export function trimContent(content: string, maxChars = 25000): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n\n[...truncated]";
}
