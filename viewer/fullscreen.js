// Fullscreen for the replay viewer (§5.8).
//
// Prefer the Fullscreen API on the viewer root (`#app`): standard
// `requestFullscreen`, then the WebKit prefix still used by older Safari.
// The root is the whole game shell (pitch, HUD, controls, tactics, stats,
// and the new-match layers). Those overlays live inside `#app`, so they
// stay visible when the API fullscreens that element.
// iPhone Safari does not fullscreen a normal element (the video-only
// `webkitEnterFullscreen` would hide the pitch, so it is not called). When
// the API is missing or the call is rejected, a CSS immersive mode fills
// the visual viewport and the same chrome rules apply.

import { CHROME_GAP_PX } from "./mobile.js";

/** Class on <html> while the whole game shell fills the screen (API or CSS). */
export const IMMERSIVE_CLASS = "immersive";

/** Class on <html> while the Fullscreen API owns the viewer root. */
export const FULLSCREEN_CLASS = "fullscreen";

/** Viewer root that goes fullscreen: pitch, HUD, controls, and overlays. */
export const FULLSCREEN_ROOT_ID = "app";

export const FULLSCREEN_BUTTON_ID = "fullscreen";

/** Short label painted on the button. */
export const ENTER_TEXT = "全屏";
export const EXIT_TEXT = "退出";

/** Accessible name. The exit name is longer than the painted word. */
export const ENTER_LABEL = "全屏";
export const EXIT_LABEL = "退出全屏";

export const FULLSCREEN_CHANGE_EVENTS = ["fullscreenchange", "webkitfullscreenchange"];

/** Standard method first, then the prefixes Safari exposed before 16.4. */
export const REQUEST_METHODS = ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"];

export const EXIT_METHODS = ["exitFullscreen", "webkitExitFullscreen", "webkitCancelFullScreen"];

export const ELEMENT_PROPS = ["fullscreenElement", "webkitFullscreenElement", "webkitCurrentFullScreenElement"];

/** CSS variables positioning the viewer root in the CSS fallback. */
export const IMMERSIVE_VARS = {
  top: "--immersive-top",
  left: "--immersive-left",
  width: "--immersive-width",
  height: "--immersive-height",
};

export const CHROME_GAP_VAR = "--chrome-gap";

/**
 * @param {Document} doc
 * @returns {Element|null}
 */
export function fullscreenElement(doc) {
  for (const key of ELEMENT_PROPS) {
    const value = doc[key];
    if (value) return value;
  }
  return null;
}

/**
 * @param {Element|null|undefined} element
 * @returns {string|null}
 */
export function requestMethod(element) {
  if (!element) return null;
  for (const name of REQUEST_METHODS) {
    if (typeof element[name] === "function") return name;
  }
  return null;
}

/**
 * @param {Document} doc
 * @returns {string|null}
 */
export function exitMethod(doc) {
  for (const name of EXIT_METHODS) {
    if (typeof doc[name] === "function") return name;
  }
  return null;
}

/**
 * Pixel size the camera should fit. CSS immersive mode uses the visual
 * viewport so the pitch fills what is actually on screen.
 * @param {Window} win
 * @param {boolean} on
 */
export function immersiveSize(win, on) {
  const width = Number(win.innerWidth);
  const height = Number(win.innerHeight);
  const base = {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
  if (!on || !win.visualViewport) return base;
  const vw = Number(win.visualViewport.width);
  const vh = Number(win.visualViewport.height);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return base;
  return { width: vw, height: vh };
}

/**
 * Esc exits the CSS fallback on the desktop layout. The browser already
 * exits Fullscreen API on Esc, and a phone has no Esc key to claim.
 * `blocked` is the stats panel: that Esc closes the panel first.
 * @param {{ on: boolean, mode: string, desktop: boolean, blocked: boolean, code?: string, key?: string }} state
 */
export function escapeShouldExit(state) {
  if (!state || state.blocked || !state.desktop || !state.on || state.mode !== "css") return false;
  return state.code === "Escape" || state.key === "Escape";
}

function errorName(err) {
  if (err && typeof err.name === "string" && err.name) return err.name;
  return "error";
}

/**
 * @param {Document} doc
 * @param {Element} element
 * @param {{ button?: Element, win?: Window, isDesktop?: () => boolean, onChange?: (state: { on: boolean, mode: string, viewport?: boolean }) => void }} [opts]
 */
export function createFullscreen(doc, element, opts = {}) {
  let cssOnly = false;
  const win = opts.win || doc.defaultView || null;

  function isOn() {
    return doc.documentElement.classList.contains(IMMERSIVE_CLASS);
  }

  function mode() {
    if (!isOn()) return "off";
    if (doc.documentElement.classList.contains(FULLSCREEN_CLASS)) return "api";
    return "css";
  }

  function paintButton() {
    const button = opts.button;
    if (!button) return;
    const on = isOn();
    button.textContent = on ? EXIT_TEXT : ENTER_TEXT;
    if (typeof button.setAttribute === "function") {
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.setAttribute("aria-label", on ? EXIT_LABEL : ENTER_LABEL);
    }
    if (typeof button.removeAttribute === "function") button.removeAttribute("title");
  }

  function applyViewport() {
    const style = doc.documentElement.style;
    style.setProperty(CHROME_GAP_VAR, `${CHROME_GAP_PX}px`);
    const activeCss = isOn() && mode() === "css" && win;
    if (!activeCss) {
      for (const name of Object.values(IMMERSIVE_VARS)) style.removeProperty(name);
      return;
    }
    const vv = win.visualViewport;
    const top = vv && Number.isFinite(Number(vv.offsetTop)) ? Number(vv.offsetTop) : 0;
    const left = vv && Number.isFinite(Number(vv.offsetLeft)) ? Number(vv.offsetLeft) : 0;
    const size = immersiveSize(win, true);
    style.setProperty(IMMERSIVE_VARS.top, `${top}px`);
    style.setProperty(IMMERSIVE_VARS.left, `${left}px`);
    style.setProperty(IMMERSIVE_VARS.width, `${size.width}px`);
    style.setProperty(IMMERSIVE_VARS.height, `${size.height}px`);
  }

  function notify(extra) {
    paintButton();
    applyViewport();
    opts.onChange?.({ on: isOn(), mode: mode(), ...extra });
  }

  function setOn(on, api) {
    const root = doc.documentElement;
    root.classList.toggle(IMMERSIVE_CLASS, on);
    root.classList.toggle(FULLSCREEN_CLASS, Boolean(on && api));
    if (!on) cssOnly = false;
    notify();
  }

  function syncFromApi() {
    if (fullscreenElement(doc)) {
      cssOnly = false;
      setOn(true, true);
      return;
    }
    if (cssOnly) {
      setOn(true, false);
      return;
    }
    setOn(false, false);
  }

  function enter() {
    const request = requestMethod(element);
    if (!request || !exitMethod(doc)) {
      cssOnly = true;
      setOn(true, false);
      return Promise.resolve({ mode: "css", reason: "no-api" });
    }
    let pending;
    try {
      pending = element[request]();
    } catch (err) {
      cssOnly = true;
      setOn(true, false);
      return Promise.resolve({ mode: "css", reason: errorName(err) });
    }
    return Promise.resolve(pending).then(
      () => {
        if (fullscreenElement(doc)) {
          cssOnly = false;
          setOn(true, true);
          return { mode: "api" };
        }
        cssOnly = true;
        setOn(true, false);
        return { mode: "css", reason: "no-element" };
      },
      (err) => {
        cssOnly = true;
        setOn(true, false);
        return { mode: "css", reason: errorName(err) };
      },
    );
  }

  function exit() {
    const api = fullscreenElement(doc);
    const name = exitMethod(doc);
    cssOnly = false;
    if (api && name) {
      let pending;
      try {
        pending = doc[name]();
      } catch (err) {
        setOn(false, false);
        return Promise.resolve({ mode: "off", reason: errorName(err) });
      }
      return Promise.resolve(pending).then(
        () => {
          setOn(false, false);
          return { mode: "off" };
        },
        (err) => {
          setOn(false, false);
          return { mode: "off", reason: errorName(err) };
        },
      );
    }
    setOn(false, false);
    return Promise.resolve({ mode: "off" });
  }

  function toggle() {
    if (isOn()) return exit();
    return enter();
  }

  /**
   * @param {KeyboardEvent|{ code?: string, key?: string }} event
   * @param {{ desktop?: boolean, blocked?: boolean }} [extra]
   */
  function onEscape(event, extra = {}) {
    const desktop = extra.desktop != null ? extra.desktop : opts.isDesktop ? opts.isDesktop() : true;
    if (
      !escapeShouldExit({
        on: isOn(),
        mode: mode(),
        desktop,
        blocked: Boolean(extra.blocked),
        code: event && event.code,
        key: event && event.key,
      })
    ) {
      return false;
    }
    void exit();
    return true;
  }

  function onViewport() {
    if (!isOn() || mode() !== "css") return;
    applyViewport();
    opts.onChange?.({ on: true, mode: mode(), viewport: true });
  }

  function bind() {
    opts.button?.addEventListener("click", () => {
      void toggle();
    });
    for (const eventName of FULLSCREEN_CHANGE_EVENTS) {
      doc.addEventListener(eventName, () => syncFromApi());
    }
    const vv = win && win.visualViewport;
    if (vv && typeof vv.addEventListener === "function") {
      vv.addEventListener("resize", onViewport);
      vv.addEventListener("scroll", onViewport);
    }
    doc.documentElement.style.setProperty(CHROME_GAP_VAR, `${CHROME_GAP_PX}px`);
    paintButton();
  }

  return { toggle, enter, exit, isOn, mode, bind, onEscape, syncFromApi, paintButton };
}
