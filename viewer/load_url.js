// Subpath-safe replay URLs (§5.8 B). Relative `?file=` follows the page URL.
// A root fallback exists only for old links that do not start with ".".

/** Hosts where replays are regenerated and must not be cached. */
export const LOCAL_DEV_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

const ABSOLUTE_HTTP = /^https?:\/\//i;
const ROOT_PATH = /^\//;

/**
 * @param {string} hostname `location.hostname` (no port)
 * @returns {"no-store" | "default"}
 */
export function fetchCacheMode(hostname) {
  return LOCAL_DEV_HOSTS.includes(hostname) ? "no-store" : "default";
}

/**
 * @param {string} file raw `?file=` value (already decoded)
 * @param {string} pageHref the viewer page URL, including any query
 * @returns {{ cache: "no-store" | "default", urls: string[] }}
 */
export function replayFetchPlan(file, pageHref) {
  const page = new URL(pageHref);
  const cache = fetchCacheMode(page.hostname);
  if (ABSOLUTE_HTTP.test(file) || ROOT_PATH.test(file)) {
    return { cache, urls: [file] };
  }
  const urls = [new URL(file, page).href];
  if (!file.startsWith(".")) {
    const rooted = file.replace(/^\/+/, "");
    urls.push(new URL(`/${rooted}`, page.origin).href);
  }
  return { cache, urls };
}

/**
 * Loading line. A known length is a percentage; otherwise the bytes received.
 * @param {number} received
 * @param {number | null | undefined} total Content-Length, or null when absent
 */
export function formatLoadProgress(received, total) {
  const got = Math.max(0, Math.floor(Number(received) || 0));
  if (Number.isFinite(total) && total > 0) {
    const pct = Math.max(0, Math.min(100, Math.floor((got / total) * 100)));
    return `加载 ${pct}%`;
  }
  return `已接收 ${got} 字节`;
}
