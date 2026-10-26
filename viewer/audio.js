// Match audio. One AudioContext, suspended until a gesture calls `unlock`
// (开球, ▶, Space, or 列表). Samples come from ./sfx/; the catalog decides
// which kind plays. Mute forces silence. The master volume scales every kind.

import {
  CONTACT_SFX,
  SFX_CATALOG,
  SFX_STORAGE_KEY,
  catalogSampleNames,
  clampVolume,
  freshSfxMemory,
  pickSample,
  planForward,
  sampleGain,
} from "./sfx/catalog.js";

export { SFX_STORAGE_KEY };

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Private mode and some embeds throw on access.
  }
  return null;
}

function readPrefs(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SFX_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return { muted: !!data.muted, volume: clampVolume(data.volume) };
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   AudioContext?: typeof AudioContext,
 *   fetch?: typeof fetch,
 *   random?: () => number,
 *   storage?: Storage | null,
 *   buffers?: Record<string, AudioBuffer>,
 *   preload?: boolean,
 * }} [options]
 */
export function createMatchAudio(options = {}) {
  const Ctor =
    options.AudioContext ||
    (typeof globalThis.AudioContext === "function" ? globalThis.AudioContext : null) ||
    (typeof globalThis.webkitAudioContext === "function" ? globalThis.webkitAudioContext : null);
  const fetchImpl = options.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch : null);
  const random = options.random || Math.random;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const saved = readPrefs(storage);

  let ctx = null;
  let muted = saved ? saved.muted : false;
  let volume = saved ? saved.volume : 1;
  let unlocked = false;
  let played = 0;
  let memory = freshSfxMemory();
  let epoch = 0;
  /** @type {Map<string, AudioBuffer>} */
  const buffers = new Map(Object.entries(options.buffers || {}));
  const failed = new Set();
  /** @type {Array<{ sfx: string, speed: number | null, eventGain: number, epoch: number }>} */
  const pending = [];
  let loading = null;

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(SFX_STORAGE_KEY, JSON.stringify({ muted, volume }));
    } catch {
      // Quota or a locked store. The slider still works for this page.
    }
  }

  function ensure() {
    if (!ctx && Ctor) {
      try {
        ctx = new Ctor();
      } catch {
        ctx = null;
      }
    }
    return ctx;
  }

  function arm(c) {
    unlocked = c.state === "running";
    return unlocked;
  }

  function buffersReady() {
    const names = catalogSampleNames();
    return names.every((name) => buffers.has(name) || failed.has(name));
  }

  function sampleUrl(name) {
    return new URL(`./sfx/${name}`, import.meta.url);
  }

  async function loadOne(c, name) {
    if (buffers.has(name) || failed.has(name)) return;
    if (!fetchImpl || typeof c.decodeAudioData !== "function") {
      failed.add(name);
      return;
    }
    try {
      const res = await fetchImpl(sampleUrl(name));
      if (!res.ok) throw new Error(String(res.status));
      const raw = await res.arrayBuffer();
      const copy = raw.slice(0);
      const decoded = await c.decodeAudioData(copy);
      buffers.set(name, decoded);
    } catch {
      failed.add(name);
    }
  }

  function startPreload() {
    const c = ensure();
    if (!c || loading) return loading;
    const names = catalogSampleNames().filter((name) => !buffers.has(name) && !failed.has(name));
    loading = Promise.all(names.map((name) => loadOne(c, name))).then(() => {
      flushPending();
    });
    return loading;
  }

  function startBuffer(c, buffer, gainValue) {
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.value = gainValue;
    src.connect(gain);
    gain.connect(c.destination);
    src.start();
  }

  /**
   * @param {string} sfx
   * @param {{ speed?: number | null, eventGain?: number }} [opts]
   */
  function playSfx(sfx, opts = {}) {
    if (muted || !(volume > 0)) return false;
    const entry = SFX_CATALOG[sfx];
    if (!entry) return false;
    const gainValue = sampleGain(sfx, {
      speed: opts.speed,
      eventGain: opts.eventGain ?? 1,
      master: volume,
    });
    if (!(gainValue > 0)) return false;
    const file = pickSample(entry.samples, random);
    const buffer = file ? buffers.get(file) : null;
    const c = ensure();
    if (!c || !buffer || !arm(c)) return false;
    startBuffer(c, buffer, gainValue);
    played += 1;
    return true;
  }

  function flushPending() {
    if (!unlocked || !pending.length) return;
    const queued = pending.splice(0, pending.length);
    const again = [];
    for (const item of queued) {
      if (item.epoch !== epoch || muted || !(volume > 0)) continue;
      if (playSfx(item.sfx, item)) continue;
      const entry = SFX_CATALOG[item.sfx];
      const waiting = entry?.samples.some((name) => !buffers.has(name) && !failed.has(name));
      if (waiting) again.push(item);
    }
    if (again.length) pending.unshift(...again);
  }

  function queue(actions) {
    for (const action of actions) {
      if (action.sfx === "dribble" && pending.some((item) => item.sfx === "dribble" && item.epoch === epoch)) {
        continue;
      }
      pending.push({ ...action, epoch });
    }
    if (pending.length > 12) pending.splice(0, pending.length - 12);
    if (buffersReady()) flushPending();
  }

  if (options.preload !== false) startPreload();

  return {
    /**
     * Resume on a user gesture. Safe to call again.
     * @returns {Promise<boolean>}
     */
    async unlock() {
      const c = ensure();
      if (!c) return false;
      const preload = startPreload();
      if (c.state === "suspended" && typeof c.resume === "function") {
        try {
          await c.resume();
        } catch {
          return false;
        }
      }
      if (preload) {
        try {
          await preload;
        } catch {
          // A missing file stays silent; the rest still play.
        }
      }
      const running = arm(c);
      flushPending();
      return running;
    },

    /**
     * One kick contact. Silent until unlock, while muted, or for a non-contact.
     * @param {string} kind
     * @param {number | null} [speed]
     * @returns {boolean}
     */
    playContact(kind, speed = null) {
      const rule = CONTACT_SFX[kind];
      if (!rule) return false;
      return playSfx(rule.sfx, { speed, eventGain: rule.gain });
    },

    /**
     * Forward playback only. Whistle, kicks, woodwork, and the dribble clock.
     * @param {Parameters<typeof planForward>[0]} step
     */
    onForward(step) {
      const planned = planForward(step, memory);
      memory = planned.memory;
      if (!planned.actions.length) return;
      for (const action of planned.actions) {
        if (playSfx(action.sfx, action)) continue;
        // Keep a kick that arrived before the gesture or before decode.
        // Mute and a zero master drop it: that moment was silent on purpose.
        if (!muted && volume > 0) queue([action]);
      }
    },

    /** Scrub, step, or any jump. Drops queued sounds and arms the next crossing. */
    onSeek() {
      epoch += 1;
      pending.length = 0;
      memory = freshSfxMemory();
    },

    /** @param {boolean} value */
    setMuted(value) {
      muted = !!value;
      if (muted) pending.length = 0;
      persist();
      return muted;
    },

    toggleMuted() {
      return this.setMuted(!muted);
    },

    /** @param {number} value master gain, clamped to 0…1 */
    setVolume(value) {
      volume = clampVolume(value);
      if (!(volume > 0)) pending.length = 0;
      persist();
      return volume;
    },

    get muted() {
      return muted;
    },

    get volume() {
      return volume;
    },

    get unlocked() {
      return unlocked;
    },

    get played() {
      return played;
    },
  };
}
