// Match list (§5.8 C). Reads ./matches.json and links into the viewer.
// Dates are shown in Asia/Shanghai no matter which zone the phone is in.

/** Fixed offset. Asia/Shanghai has no daylight saving. */
export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export const BYTES_PER_MB = 1024 * 1024;

const SCORE_DASH = "\u2013";

/**
 * @param {string} iso
 * @returns {string} `YYYY-MM-DD HH:mm` in Asia/Shanghai
 */
export function formatShanghai(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso ?? "");
  const sh = new Date(t + SHANGHAI_OFFSET_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())} ${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatMegabytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  return `${(n / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * @param {number[]} score
 * @returns {string}
 */
export function formatScore(score) {
  const home = Array.isArray(score) ? Number(score[0]) : 0;
  const away = Array.isArray(score) ? Number(score[1]) : 0;
  return `主 ${home} ${SCORE_DASH} ${away} 客`;
}

/**
 * Newest first. Equal dates break ties on `id` so the order does not depend
 * on the order matches.json was written.
 * @param {Array<{date?: string, id?: string}>} matches
 */
export function sortMatchesNewestFirst(matches) {
  return [...matches].sort((a, b) => {
    const ad = String(a.date ?? "");
    const bd = String(b.date ?? "");
    if (ad !== bd) return ad < bd ? 1 : -1;
    const ai = String(a.id ?? "");
    const bi = String(b.id ?? "");
    if (ai !== bi) return ai < bi ? 1 : -1;
    return 0;
  });
}

/**
 * `viewer/?file=../replays/<file>` relative to the list page (§5.8 C).
 * @param {{ file?: string }} match
 */
/**
 * 「开新局」 target. The published list sits beside `viewer/`. The repo list
 * lives in `list/` under the viewer, so the link steps up.
 * @param {string} pageHref
 */
export function newMatchHref(pageHref) {
  const url = new URL(pageHref, "http://localhost/");
  const path = url.pathname;
  if (/\/list(?:\/(?:index\.html)?)?$/.test(path)) return new URL("../?mode=newMatch", url).href;
  return new URL("viewer/?mode=newMatch", url).href;
}

export function viewerHref(match) {
  const file = String(match.file ?? "");
  const base = file.split("/").filter(Boolean).pop() || file;
  return `viewer/?file=${encodeURIComponent(`../replays/${base}`)}`;
}

/**
 * @param {Array<{date?: string, format?: string, seed?: number, score?: number[], final_clock?: string, engine_sha?: string, bytes?: number, file?: string}>} matches
 * @returns {HTMLElement}
 */
export function renderMatchList(matches) {
  const root = document.createElement("div");
  root.id = "match-list";
  const ordered = sortMatchesNewestFirst(matches);
  if (ordered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有已发布的比赛";
    root.appendChild(empty);
    return root;
  }
  for (const match of ordered) {
    const link = document.createElement("a");
    link.className = "match";
    link.href = viewerHref(match);
    const cells = [
      ["日期", formatShanghai(match.date)],
      ["格式 / 种子", `${match.format ?? ""} / ${match.seed ?? ""}`],
      ["比分", formatScore(match.score)],
      ["终场时钟", String(match.final_clock ?? "")],
      ["引擎", String(match.engine_sha ?? "")],
      ["大小", formatMegabytes(match.bytes)],
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement("span");
      cell.className = "cell";
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = label;
      const v = document.createElement("span");
      v.className = label === "引擎" ? "v engine" : "v";
      v.textContent = value;
      cell.append(k, v);
      link.appendChild(cell);
    }
    root.appendChild(link);
  }
  return root;
}

async function main() {
  const opener = document.getElementById("new-match");
  if (opener) opener.href = newMatchHref(location.href);
  const mount = document.getElementById("matches");
  const error = document.getElementById("error");
  try {
    const res = await fetch(new URL("matches.json", location.href), { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    mount.replaceChildren(renderMatchList(matches));
  } catch (err) {
    error.textContent = `无法读取比赛列表：${err.message}`;
    error.classList.remove("hidden");
  }
}

if (typeof document !== "undefined" && document.getElementById("matches")) {
  main();
}
