// One AudioContext for ball-contact ticks. The context stays suspended until
// a user gesture calls `unlock` (开球, ▶, Space, or 列表). After that the
// match is unmuted. The mute button is a separate toggle.
//
// Each contact is synthesized here. No sample files.
// A leather kick is a crack plus a short low-mid body, not a sine thump:
//   slap   — broadband transient, under 8 ms
//   strike — shot body, damped partials and band-limited noise, ~70 ms
//   pass   — same family, softer and shorter
//   dull   — block / tackle residual, muffled and shorter still

/** shot > pass_released / clearance > block / deflection / tackle. */
export const COLLISION_GAIN = {
  shot: 0.85,
  pass_released: 0.5,
  clearance: 0.5,
  block: 0.28,
  deflection: 0.28,
  tackle: 0.28,
};

/** Buffer length for each layer, in seconds. */
export const CONTACT_SECONDS = {
  slap: 0.0064,
  strike: 0.074,
  pass: 0.052,
  dull: 0.032,
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
 * @returns {Array<{ name: "slap" | "strike" | "pass" | "dull", gain: number }>}
 */
export function collisionLayers(kind, gain) {
  if (!(gain > 0)) return [];
  if (kind === "shot") {
    return [
      { name: "slap", gain: gain * 0.72 },
      { name: "strike", gain },
    ];
  }
  if (kind === "pass_released" || kind === "clearance") {
    return [
      { name: "slap", gain: gain * 0.4 },
      { name: "pass", gain: gain * 0.9 },
    ];
  }
  return [
    { name: "slap", gain: gain * 0.22 },
    { name: "dull", gain: gain * 0.75 },
  ];
}

function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeBandpass(sampleRate, freq, q) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function makeLowpass(sampleRate, freq) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * freq);
  const alpha = dt / (rc + dt);
  let y = 0;
  return (x) => {
    y += alpha * (x - y);
    return y;
  };
}

function normalizePeak(data, peak) {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  if (!(max > 1e-8)) return;
  const gain = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= gain;
}

/** Leather crack: high-passed noise, gone inside the buffer. Not a sine. */
function fillSlap(data, sampleRate) {
  const rand = makeRand(0x51a9c0de);
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const white = rand() * 2 - 1;
    const hp = white - prev;
    prev = white;
    data[i] = hp * Math.exp(-t * 860);
  }
  normalizePeak(data, 0.8);
}

/**
 * Damped inharmonic partials plus band-limited noise.
 * `glide` drops only the lowest partial a little, under the noise.
 * @param {Float32Array} data
 * @param {number} sampleRate
 * @param {{ seed: number, center: number, q: number, noise: number, noiseDecay: number, partials: Array<{ f0: number, f1: number, decay: number, amp: number }> }} spec
 */
function fillBody(data, sampleRate, spec) {
  const rand = makeRand(spec.seed);
  const color = spec.lowpass
    ? makeLowpass(sampleRate, spec.center)
    : makeBandpass(sampleRate, spec.center, spec.q);
  const phase = spec.partials.map(() => 0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let y = 0;
    for (let p = 0; p < spec.partials.length; p++) {
      const part = spec.partials[p];
      const glide = Math.min(1, t / 0.045);
      const freq = part.f0 + (part.f1 - part.f0) * glide;
      phase[p] += (2 * Math.PI * freq) / sampleRate;
      y += Math.sin(phase[p]) * Math.exp(-t * part.decay) * part.amp;
    }
    y += color(rand() * 2 - 1) * Math.exp(-t * spec.noiseDecay) * spec.noise;
    data[i] = y;
  }
  normalizePeak(data, spec.peak ?? 0.86);
}

function fillStrike(data, sampleRate) {
  fillBody(data, sampleRate, {
    seed: 0x5a1701,
    center: 155,
    q: 0.75,
    noise: 0.62,
    noiseDecay: 40,
    partials: [
      { f0: 96, f1: 78, decay: 36, amp: 0.62 },
      { f0: 148, f1: 148, decay: 44, amp: 0.4 },
      { f0: 208, f1: 208, decay: 56, amp: 0.28 },
      { f0: 246, f1: 246, decay: 68, amp: 0.18 },
    ],
  });
}

function fillPass(data, sampleRate) {
  fillBody(data, sampleRate, {
    seed: 0x9a5502,
    center: 118,
    q: 0.9,
    noise: 0.36,
    noiseDecay: 52,
    partials: [
      { f0: 84, f1: 72, decay: 48, amp: 0.58 },
      { f0: 124, f1: 124, decay: 60, amp: 0.32 },
      { f0: 168, f1: 168, decay: 74, amp: 0.14 },
    ],
  });
}

function fillDull(data, sampleRate) {
  fillBody(data, sampleRate, {
    seed: 0xd01103,
    center: 140,
    lowpass: true,
    noise: 0.28,
    noiseDecay: 70,
    peak: 0.7,
    partials: [
      { f0: 74, f1: 68, decay: 78, amp: 0.55 },
      { f0: 108, f1: 108, decay: 96, amp: 0.22 },
    ],
  });
}

const CONTACT_FILL = {
  slap: fillSlap,
  strike: fillStrike,
  pass: fillPass,
  dull: fillDull,
};

/**
 * One rendered layer. Used by the context and by the unit test.
 * @param {"slap" | "strike" | "pass" | "dull"} name
 * @param {number} [sampleRate]
 * @returns {Float32Array}
 */
export function renderContact(name, sampleRate = 44100) {
  const seconds = CONTACT_SECONDS[name];
  const fill = CONTACT_FILL[name];
  if (!seconds || !fill) return new Float32Array(0);
  const rate = sampleRate > 0 ? sampleRate : 44100;
  const length = Math.max(1, Math.floor(rate * seconds));
  const data = new Float32Array(length);
  fill(data, rate);
  return data;
}

function buildBuffers(ctx) {
  const rate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
  const buffers = {};
  for (const name of Object.keys(CONTACT_SECONDS)) {
    const data = renderContact(name, rate);
    const buffer = ctx.createBuffer(1, data.length, rate);
    buffer.getChannelData(0).set(data);
    buffers[name] = buffer;
  }
  return buffers;
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
