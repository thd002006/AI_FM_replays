// Mobile layout and touch rules for the replay viewer (§5.8).
// One set of named thresholds. Desktop (width ≥ DESKTOP_MIN_WIDTH_PX) is unchanged.

/** Viewport width at or below this is the portrait phone layout, unless landscape wins. */
export const PORTRAIT_MAX_WIDTH_PX = 600;

/** Viewport height at or below this, and wider than tall, is the landscape phone layout. */
export const LANDSCAPE_MAX_HEIGHT_PX = 500;

/** At this width and above the computer layout is kept, including short landscape windows. */
export const DESKTOP_MIN_WIDTH_PX = 1024;

/** Minimum width and height of a tappable control, including the scrub hit area. */
export const MIN_TOUCH_PX = 44;

/** Top bar type size on a phone. */
export const TOP_FONT_PX = 16;

/** Overflow menu and event-feed type size on a phone. */
export const MENU_FONT_PX = 14;

/** On-pitch label type size on a phone. */
export const PITCH_LABEL_FONT_PX = 12;

/** Camera padding used when the bars float on top of the pitch (landscape, fullscreen). */
export const EDGE_PAD_PX = 12;

/** Gap between a floating bar and the screen edge. */
export const CHROME_GAP_PX = 8;

/** Opaque-enough overlay for the landscape bars (0 = clear, 1 = solid). */
export const LANDSCAPE_BAR_ALPHA = 0.55;

/** Playback with no input before the landscape transport fades. */
export const CONTROLS_IDLE_MS = 3000;

/** Two taps on empty grass inside this window restore the full-pitch frame. */
export const DOUBLE_TAP_MS = 300;

/** Movement below this is still a tap (same threshold the desktop click used). */
export const TAP_SLOP_PX = 5;

/**
 * Speed button cycle. Default is the first entry.
 * Each tap advances one step and then wraps.
 */
export const SPEED_CYCLE = [1, 2, 4, 0.5];

/** Orthographic up-vector that puts pitch length (world +X) up the screen. */
export const PORTRAIT_CAMERA_UP = { x: 1, y: 0, z: 0 };

/**
 * @param {number} width
 * @param {number} height
 * @returns {"desktop" | "portrait" | "landscape"}
 */
export function layoutMode(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return "desktop";
  if (w >= DESKTOP_MIN_WIDTH_PX) return "desktop";
  if (h <= LANDSCAPE_MAX_HEIGHT_PX && w > h) return "landscape";
  if (w <= PORTRAIT_MAX_WIDTH_PX) return "portrait";
  return "desktop";
}

/**
 * Next entry in {@link SPEED_CYCLE}. Unknown speeds land on the first step
 * after a full wrap (index −1 → first).
 * @param {number} current
 */
export function nextSpeed(current) {
  const idx = SPEED_CYCLE.indexOf(current);
  return SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
}

/** @param {number} speed */
export function formatSpeed(speed) {
  return `${speed}×`;
}

/**
 * Sets `data-layout` and the CSS variables the phone rules read.
 * Desktop removes the attribute so computer CSS is not retargeted.
 * @param {Window} win
 * @returns {"desktop" | "portrait" | "landscape"}
 */
export function applyDocumentLayout(win) {
  const mode = layoutMode(win.innerWidth, win.innerHeight);
  const root = win.document.documentElement;
  if (mode === "desktop") root.removeAttribute("data-layout");
  else root.dataset.layout = mode;
  root.style.setProperty("--touch-min", `${MIN_TOUCH_PX}px`);
  root.style.setProperty("--hud-font", `${TOP_FONT_PX}px`);
  root.style.setProperty("--menu-font", `${MENU_FONT_PX}px`);
  root.style.setProperty("--pitch-label-font", `${PITCH_LABEL_FONT_PX}px`);
  root.style.setProperty("--bar-alpha", String(LANDSCAPE_BAR_ALPHA));
  root.style.setProperty("--chrome-gap", `${CHROME_GAP_PX}px`);
  return mode;
}
