import type { RitualType } from "./charms";

let ctx: AudioContext | null = null;
let reverb: ConvolverNode | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function buildImpulse(audio: AudioContext, duration = 1.2, decay = 3.5): AudioBuffer {
  const rate = audio.sampleRate;
  const length = Math.floor(rate * duration);
  const buffer = audio.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function getBus() {
  const audio = getCtx();
  if (!reverb) {
    reverb = audio.createConvolver();
    reverb.buffer = buildImpulse(audio);
    dry = audio.createGain();
    wet = audio.createGain();
    dry.gain.value = 1;
    wet.gain.value = 1;
    dry.connect(audio.destination);
    reverb.connect(wet).connect(audio.destination);
  }
  return { audio, reverb: reverb!, dry: dry!, wet: wet! };
}

function sendTo(node: AudioNode, wetAmount: number) {
  const { dry: d, reverb: r } = getBus();
  node.connect(d);
  if (wetAmount > 0) {
    const send = getCtx().createGain();
    send.gain.value = wetAmount;
    node.connect(send).connect(r);
  }
}

function tone(
  freq: number,
  startAt: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number; wet?: number } = {},
) {
  const audio = getCtx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, startAt + duration);

  const peak = opts.gain ?? 0.18;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + Math.min(0.01, duration * 0.1));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  sendTo(gain, opts.wet ?? 0.12);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.1);
}

function noiseBurst(
  startAt: number,
  duration: number,
  opts: { gain?: number; filterHz?: number; filterType?: BiquadFilterType; q?: number; wet?: number } = {},
) {
  const audio = getCtx();
  const length = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const src = audio.createBufferSource();
  src.buffer = buffer;

  const filt = audio.createBiquadFilter();
  filt.type = opts.filterType ?? "bandpass";
  filt.frequency.value = opts.filterHz ?? 2200;
  filt.Q.value = opts.q ?? 6;

  const gain = audio.createGain();
  const peak = opts.gain ?? 0.14;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  src.connect(filt).connect(gain);
  sendTo(gain, opts.wet ?? 0.1);
  src.start(startAt);
  src.stop(startAt + duration + 0.05);
}

// A wobbly, cartoon-spring "boing": one oscillator with a fast vibrato LFO riding
// a falling pitch sweep, plus a tiny attack click.
function boing(
  startAt: number,
  duration: number,
  opts: { startFreq: number; endFreq: number; vibratoRate: number; vibratoDepth: number; gain?: number },
) {
  const audio = getCtx();
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(opts.startFreq, startAt);
  osc.frequency.exponentialRampToValueAtTime(opts.endFreq, startAt + duration);

  const lfo = audio.createOscillator();
  lfo.type = "sine";
  lfo.frequency.setValueAtTime(opts.vibratoRate, startAt);
  const lfoGain = audio.createGain();
  lfoGain.gain.value = opts.vibratoDepth;
  lfo.connect(lfoGain).connect(osc.frequency);

  const gain = audio.createGain();
  const peak = opts.gain ?? 0.22;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  sendTo(gain, 0.1);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.1);
  lfo.start(startAt);
  lfo.stop(startAt + duration + 0.1);
}

// A slide-whistle "wheeoop": one glide up, one glide down.
function slideWhistle(startAt: number, peakDuration: number, fallDuration: number, gainPeak = 0.2) {
  const audio = getCtx();
  const osc = audio.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(280, startAt);
  osc.frequency.exponentialRampToValueAtTime(2000, startAt + peakDuration);
  osc.frequency.exponentialRampToValueAtTime(420, startAt + peakDuration + fallDuration);

  const gain = audio.createGain();
  const total = peakDuration + fallDuration;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.02);
  gain.gain.setValueAtTime(gainPeak, startAt + peakDuration * 0.8);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + total);

  osc.connect(gain);
  sendTo(gain, 0.12);
  osc.start(startAt);
  osc.stop(startAt + total + 0.1);
}

function playWard() {
  const t = getCtx().currentTime;
  noiseBurst(t, 0.03, { filterHz: 1800, q: 5, gain: 0.09, wet: 0.1 });
  boing(t + 0.005, 0.42, { startFreq: 340, endFreq: 78, vibratoRate: 24, vibratoDepth: 50, gain: 0.24 });
}

function playBless() {
  const t = getCtx().currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    tone(f, t + i * 0.075, 0.15, { type: "triangle", gain: 0.17, wet: 0.14 });
  });
  boing(t + 0.3, 0.32, { startFreq: 1046.5, endFreq: 1046.5, vibratoRate: 30, vibratoDepth: 22, gain: 0.15 });
}

function playSparkle() {
  const t = getCtx().currentTime;
  slideWhistle(t, 0.13, 0.17, 0.19);
  noiseBurst(t + 0.13, 0.05, { filterHz: 3200, q: 10, gain: 0.05, wet: 0.15 });
}

function playChime() {
  const t = getCtx().currentTime;
  tone(520, t, 0.09, { type: "square", sweepTo: 660, gain: 0.13, wet: 0.1 });
  tone(760, t + 0.12, 0.11, { type: "square", sweepTo: 940, gain: 0.13, wet: 0.1 });
}

export function playRitualSound(ritual: RitualType) {
  try {
    if (ritual === "ward") playWard();
    else if (ritual === "bless") playBless();
    else if (ritual === "sparkle") playSparkle();
    else if (ritual === "chime") playChime();
  } catch {
    // audio unsupported/blocked — fail silently
  }
}

export function isAudioReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

// Bird chirp: a 5ms noise transient, then two short triangle blips glissing
// 2.8kHz -> 3.4kHz. Click-driven (a real user gesture), so it goes through the
// normal getCtx() path and may create/resume the context.
export function playChirp() {
  try {
    const t = getCtx().currentTime;
    noiseBurst(t, 0.005, { filterHz: 3200, q: 8, gain: 0.05, wet: 0.08 });
    tone(2800, t + 0.005, 0.08, { type: "triangle", sweepTo: 3400, gain: 0.15, wet: 0.1 });
    tone(2800, t + 0.11, 0.08, { type: "triangle", sweepTo: 3400, gain: 0.12, wet: 0.1 });
  } catch {
    // audio unsupported/blocked — fail silently
  }
}

// Bird peck: a single 30ms noise tick. Fires with NO user gesture, so it must
// never create or resume the context — silent until the first real click.
export function playPeck() {
  if (!isAudioReady()) return;
  try {
    const t = getCtx().currentTime;
    noiseBurst(t, 0.03, { filterHz: 2400, q: 7, gain: 0.07, wet: 0.06 });
  } catch {
    // audio unsupported/blocked — fail silently
  }
}
