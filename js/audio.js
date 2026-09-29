// Audio: shot-timer beeps (WebAudio), spoken callouts (speechSynthesis, on-device),
// and optional microphone click/shot detection. No network use.

let ctx = null;
let settings = { volume: 0.9, beepStyle: 'timer', haptics: true, voice: true };

export function configure(s) { settings = { ...settings, ...s }; }

export function audioCtx() {
  if (!ctx) {
    const AC = self.AudioContext || self.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

// Must be called from a user gesture (iOS/Safari unlock).
export async function unlock() {
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') { try { await c.resume(); } catch {} }
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b; s.connect(c.destination); s.start(0);
}

const STYLES = {
  timer:  { type: 'square',   freq: 2800, dur: 0.30 },   // classic shot-timer tone
  low:    { type: 'sine',     freq: 1200, dur: 0.35 },
  buzzer: { type: 'sawtooth', freq: 520,  dur: 0.45 },
  chirp:  { type: 'triangle', freq: 1800, dur: 0.25, sweep: 3200 },
};

// Plays a beep and returns the estimated performance.now() when sound leaves the speaker.
export function beep({ style, freq, dur, gain = 1 } = {}) {
  const c = audioCtx();
  const t0 = performance.now();
  if (!c || settings.volume <= 0) { vibrate(80); return t0; }
  const p = STYLES[style || settings.beepStyle] || STYLES.timer;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = p.type;
  const f = freq || p.freq;
  const d = dur || p.dur;
  const now = c.currentTime;
  osc.frequency.setValueAtTime(f, now);
  if (p.sweep && !freq) osc.frequency.linearRampToValueAtTime(p.sweep, now + d);
  const vol = Math.max(0.0001, settings.volume * gain * (p.type === 'square' || p.type === 'sawtooth' ? 0.35 : 0.8));
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.005);
  g.gain.setValueAtTime(vol, now + d - 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + d + 0.02);
  vibrate(60);
  const latency = ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
  return t0 + latency;
}

export function parBeep() { return beep({ style: 'low', freq: 900, dur: 0.18, gain: 0.8 }); }
export function doubleBeep() { beep({ freq: 1500, dur: 0.1 }); setTimeout(() => beep({ freq: 1500, dur: 0.1 }), 160); }
export function failTone() { beep({ style: 'buzzer', freq: 220, dur: 0.5 }); }

export function vibrate(ms) {
  if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
}

// ---- Speech callouts ------------------------------------------------------
let voicesReady = false;
export function speak(text, { rate = 1.15 } = {}) {
  if (!settings.voice || !('speechSynthesis' in self)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = rate;
    u.volume = Math.min(1, settings.volume + 0.1);
    // Prefer a local (on-device) voice so nothing leaves the device.
    const vs = speechSynthesis.getVoices();
    const local = vs.find(v => v.localService && /^en/i.test(v.lang)) || vs.find(v => v.localService);
    if (local) u.voice = local;
    speechSynthesis.speak(u);
    voicesReady = true;
    return true;
  } catch { return false; }
}
export function stopSpeech() { try { speechSynthesis.cancel(); } catch {} }

// ---- Microphone shot detection -------------------------------------------
// Detects sharp transients (dry-fire click, laser-trainer click). Beep playback
// is masked with ignoreUntil so the start tone isn't counted as a shot.
export class ShotDetector {
  constructor({ sensitivity = 5, onShot } = {}) {
    this.sensitivity = sensitivity;
    this.onShot = onShot;
    this.ignoreUntil = 0;
    this.last = 0;
    this.running = false;
  }
  get threshold() {
    // sensitivity 1 (least) .. 10 (most) -> peak threshold 0.6 .. 0.06
    return 0.66 - this.sensitivity * 0.06;
  }
  async start() {
    const c = audioCtx();
    if (!c || !navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not available');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.src = c.createMediaStreamSource(this.stream);
    this.an = c.createAnalyser();
    this.an.fftSize = 512;
    this.src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.running = true;
    this.floor = 0.02;
    const tick = () => {
      if (!this.running) return;
      this.an.getFloatTimeDomainData(this.buf);
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = Math.abs(this.buf[i]); if (v > peak) peak = v; }
      const now = performance.now();
      // Adaptive noise floor so a noisy room doesn't trigger constantly.
      this.floor = this.floor * 0.98 + Math.min(peak, 0.2) * 0.02;
      const th = Math.max(this.threshold, this.floor * 3);
      this.level = peak;
      if (peak > th && now > this.ignoreUntil && now - this.last > 90) {
        this.last = now;
        this.onShot?.(now, peak);
      }
      this.raf = setTimeout(tick, 8);
    };
    tick();
  }
  stop() {
    this.running = false;
    clearTimeout(this.raf);
    try { this.src?.disconnect(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
