// One AudioContext for ball-contact ticks. The context stays suspended until
// a user gesture calls `unlock` (开球, ▶, Space, or 列表). After that the
// match is unmuted. The mute button is a separate toggle.

/** shot > pass_released / clearance > block / deflection / tackle. */
export const COLLISION_GAIN = {
  shot: 0.85,
  pass_released: 0.5,
  clearance: 0.5,
  block: 0.28,
  deflection: 0.28,
  tackle: 0.28,
};

/**
 * @param {string | null | undefined} kind
 * @returns {number} 0 when this kind is silent
 */
export function collisionGain(kind) {
  const gain = COLLISION_GAIN[kind];
  return Number.isFinite(gain) ? gain : 0;
}

/**
 * @param {string} kind
 * @param {number} gain
 * @returns {Array<{ name: "thump" | "noise" | "knock", gain: number }>}
 */
export function collisionLayers(kind, gain) {
  if (!(gain > 0)) return [];
  if (kind === "shot") {
    return [
      { name: "thump", gain },
      { name: "noise", gain: gain * 0.85 },
    ];
  }
  if (kind === "pass_released" || kind === "clearance") {
    return [
      { name: "thump", gain: gain * 0.7 },
      { name: "noise", gain },
    ];
  }
  return [
    { name: "knock", gain },
    { name: "noise", gain: gain * 0.55 },
  ];
}

function fillNoise(data) {
  for (let i = 0; i < data.length; i++) {
    const env = Math.exp(-i / (data.length * 0.22));
    data[i] = (Math.random() * 2 - 1) * env;
  }
}

function fillThump(data, sampleRate) {
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 32);
    const freq = 150 - 95 * (i / data.length);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
}

function fillKnock(data, sampleRate) {
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 55);
    data[i] = Math.sin(2 * Math.PI * 420 * t) * env;
  }
}

function makeBuffer(ctx, seconds, fill) {
  const rate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(1, length, rate);
  fill(buffer.getChannelData(0), rate);
  return buffer;
}

function buildBuffers(ctx) {
  return {
    noise: makeBuffer(ctx, 0.045, fillNoise),
    thump: makeBuffer(ctx, 0.08, fillThump),
    knock: makeBuffer(ctx, 0.03, fillKnock),
  };
}

function startBuffer(ctx, buffer, gainValue) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = gainValue;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

/**
 * @param {{ AudioContext?: typeof AudioContext }} [options]
 */
export function createMatchAudio(options = {}) {
  const Ctor =
    options.AudioContext ||
    (typeof globalThis.AudioContext === "function" ? globalThis.AudioContext : null) ||
    (typeof globalThis.webkitAudioContext === "function" ? globalThis.webkitAudioContext : null);
  let ctx = null;
  let muted = false;
  let unlocked = false;
  let buffers = null;
  let played = 0;

  function ensure() {
    if (!ctx && Ctor) ctx = new Ctor();
    return ctx;
  }

  function arm(c) {
    unlocked = c.state === "running";
    if (unlocked && !buffers) buffers = buildBuffers(c);
    return unlocked;
  }

  return {
    /**
     * Resume on a user gesture. Safe to call again.
     * @returns {Promise<boolean>}
     */
    async unlock() {
      const c = ensure();
      if (!c) return false;
      if (c.state === "suspended" && typeof c.resume === "function") {
        try {
          await c.resume();
        } catch {
          return false;
        }
      }
      return arm(c);
    },

    /**
     * One contact. Silent until unlock, while muted, or for an unknown kind.
     * @param {string} kind
     * @returns {boolean}
     */
    playContact(kind) {
      if (muted) return false;
      const vol = collisionGain(kind);
      if (!(vol > 0)) return false;
      const c = ensure();
      if (!c || !arm(c)) return false;
      const layers = collisionLayers(kind, vol);
      if (!layers.length || !buffers) return false;
      for (const layer of layers) {
        const buffer = buffers[layer.name];
        if (buffer) startBuffer(c, buffer, layer.gain);
      }
      played += 1;
      return true;
    },

    toggleMuted() {
      muted = !muted;
      return muted;
    },

    get muted() {
      return muted;
    },

    get unlocked() {
      return unlocked;
    },

    get played() {
      return played;
    },
  };
}
