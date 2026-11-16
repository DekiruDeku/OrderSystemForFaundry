/* OrderSfx: звуки интерфейса листа бойца, синтез на Web Audio API (без файлов).
   Характер: холодный терминал Ордена с искрой магии. Щелчки, вжухи, стеклянные пинги.
   Правила: один AudioContext, запуск после жеста пользователя, огибающие только до 0.001,
   время берётся один раз на звук, общий компрессор, троттлинг частых звуков.
   Громкость = своя громкость листа × громкость интерфейса Foundry (core.globalInterfaceVolume).
   Настройки (вкл/выкл, громкость) хранятся в браузере игрока: localStorage "osx-sfx". */

const S = { enabled: true, volume: 0.65, t0: 0, ctx: null, master: null, noiseBuf: null, last: Object.create(null) };

try {
  const saved = JSON.parse(localStorage.getItem("osx-sfx") || "null");
  if (saved) {
    S.enabled = !!saved.enabled;
    S.volume = Math.min(1, Math.max(0, Number(saved.volume) || 0));
  }
} catch (e) { /* хранилище недоступно: работаем на значениях по умолчанию */ }

function persist() {
  try { localStorage.setItem("osx-sfx", JSON.stringify({ enabled: S.enabled, volume: S.volume })); } catch (e) { /* ignore */ }
}

function interfaceVolume() {
  try {
    const v = Number(game?.settings?.get?.("core", "globalInterfaceVolume"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch (e) {
    return 1;
  }
}

function masterGain() {
  return S.volume * 0.8 * interfaceVolume();
}

function getCtx() {
  if (!S.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    S.ctx = new AC();
    const comp = S.ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.15;
    S.master = S.ctx.createGain();
    S.master.gain.value = masterGain();
    S.master.connect(comp); comp.connect(S.ctx.destination);
  }
  if (S.ctx.state === "suspended") S.ctx.resume();
  return S.ctx;
}

// Браузер не даёт звук до первого жеста: создаём контекст на первом клике или клавише
const unlock = () => {
  getCtx();
  window.removeEventListener("pointerdown", unlock, true);
  window.removeEventListener("keydown", unlock, true);
};
window.addEventListener("pointerdown", unlock, true);
window.addEventListener("keydown", unlock, true);

function noiseBuffer(ctx) {
  if (S.noiseBuf) return S.noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  S.noiseBuf = buf;
  return buf;
}

/* ---------- строительные блоки: все части звука считаются от S.t0 ---------- */
function tone(ctx, dest, { type = "sine", f0 = 440, f1 = null, t = 0, attack = 0.004, dur = 0.1, peak = 0.15, detune = 0, lp = null }) {
  const now = S.t0 + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f0, now);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, now + attack + dur);
  g.gain.setValueAtTime(0.001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + attack);
  g.gain.exponentialRampToValueAtTime(0.001, now + attack + dur);
  let node = o;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); node = f; }
  node.connect(g); g.connect(dest);
  o.start(now); o.stop(now + attack + dur + 0.03);
}

function noise(ctx, dest, { t = 0, attack = 0.002, dur = 0.05, peak = 0.12, type = "bandpass", f0 = 3000, f1 = null, q = 1 }) {
  const now = S.t0 + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, now);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, now + attack + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + attack);
  g.gain.exponentialRampToValueAtTime(0.001, now + attack + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(now, Math.random() * 0.5); src.stop(now + attack + dur + 0.03);
}

const rnd = (a, b) => a + Math.random() * (b - a);

// удар сердца: два глухих толчка «тук-тук»
function heartbeat(ctx, d, t = 0, peak = 0.32) {
  tone(ctx, d, { f0: 78, f1: 44, t, attack: 0.006, dur: 0.13, peak });
  noise(ctx, d, { t, dur: 0.05, peak: peak * 0.4, type: "lowpass", f0: 260, q: 0.7 });
  tone(ctx, d, { f0: 66, f1: 40, t: t + 0.17, attack: 0.006, dur: 0.16, peak: peak * 0.8 });
}

/* ---------- библиотека ---------- */
const SOUNDS = {
  hover(ctx, d) {
    noise(ctx, d, { dur: 0.026, peak: 0.045, f0: 5200, q: 6 });
    tone(ctx, d, { f0: 2400, dur: 0.02, peak: 0.018 });
  },
  move(ctx, d) {
    tone(ctx, d, { f0: 1650, f1: 1380, dur: 0.045, peak: 0.06 });
    noise(ctx, d, { dur: 0.014, peak: 0.045, f0: 3200, q: 2 });
  },
  select(ctx, d) {
    noise(ctx, d, { dur: 0.02, peak: 0.2, f0: 2800, q: 1.2 });
    tone(ctx, d, { type: "triangle", f0: 980, f1: 740, dur: 0.07, peak: 0.13 });
  },
  confirm(ctx, d) {
    tone(ctx, d, { type: "triangle", f0: 784, dur: 0.09, peak: 0.15 });
    tone(ctx, d, { type: "triangle", f0: 1175, t: 0.07, dur: 0.14, peak: 0.13 });
    tone(ctx, d, { f0: 2350, t: 0.07, dur: 0.2, peak: 0.035 });
  },
  cancel(ctx, d) {
    tone(ctx, d, { type: "triangle", f0: 740, dur: 0.07, peak: 0.13 });
    tone(ctx, d, { type: "triangle", f0: 494, t: 0.06, dur: 0.12, peak: 0.12 });
  },
  error(ctx, d) {
    tone(ctx, d, { type: "square", f0: 150, dur: 0.08, peak: 0.1, lp: 1100 });
    tone(ctx, d, { type: "square", f0: 142, t: 0.11, dur: 0.1, peak: 0.1, lp: 1100 });
  },
  toggleOn(ctx, d) {
    noise(ctx, d, { dur: 0.012, peak: 0.12, f0: 3500, q: 2 });
    tone(ctx, d, { f0: 660, f1: 990, dur: 0.09, peak: 0.12 });
  },
  toggleOff(ctx, d) {
    noise(ctx, d, { dur: 0.012, peak: 0.12, f0: 2600, q: 2 });
    tone(ctx, d, { f0: 990, f1: 620, dur: 0.09, peak: 0.11 });
  },
  tab(ctx, d) {
    noise(ctx, d, { attack: 0.07, dur: 0.2, peak: 0.2, f0: 600, f1: 3800, q: 1.4 });
    tone(ctx, d, { f0: 180, f1: 90, attack: 0.02, dur: 0.18, peak: 0.07 });
    noise(ctx, d, { t: 0.2, dur: 0.018, peak: 0.12, f0: 3000, q: 2 });
  },
  swoosh(ctx, d) {
    noise(ctx, d, { attack: 0.03, dur: 0.12, peak: 0.1, f0: 1500, f1: 5200, q: 1.6 });
  },
  open(ctx, d) {
    tone(ctx, d, { f0: 82, f1: 165, attack: 0.22, dur: 0.42, peak: 0.13 });
    noise(ctx, d, { t: 0.04, attack: 0.08, dur: 0.22, peak: 0.16, f0: 500, f1: 4200, q: 1.2 });
    SOUNDS.stamp(ctx, d, 0.46);
    tone(ctx, d, { type: "triangle", f0: 1568, t: 0.5, dur: 0.3, peak: 0.04 });
  },
  close(ctx, d) {
    noise(ctx, d, { attack: 0.03, dur: 0.22, peak: 0.15, f0: 4000, f1: 500, q: 1.2 });
    tone(ctx, d, { f0: 220, f1: 70, dur: 0.24, peak: 0.08 });
  },
  stamp(ctx, d, t = 0) {
    tone(ctx, d, { f0: 118, f1: 46, t, attack: 0.003, dur: 0.15, peak: 0.26 });
    noise(ctx, d, { t, dur: 0.06, peak: 0.18, type: "lowpass", f0: 1900, q: 0.7 });
  },
  rip(ctx, d) {
    for (let i = 0; i < 4; i++) noise(ctx, d, { t: i * 0.028, dur: 0.035, peak: 0.12 - i * 0.02, f0: 4200 - i * 800, q: 0.9 });
    noise(ctx, d, { t: 0.02, attack: 0.01, dur: 0.16, peak: 0.08, f0: 3600, f1: 800, q: 1.1 });
  },
  pick(ctx, d) { tone(ctx, d, { f0: 520, f1: 900, dur: 0.06, peak: 0.12 }); },
  drop(ctx, d) {
    tone(ctx, d, { f0: 900, f1: 430, dur: 0.08, peak: 0.13 });
    noise(ctx, d, { t: 0.06, dur: 0.016, peak: 0.12, f0: 2600, q: 2 });
  },
  tickUp(ctx, d, frac = 0) {
    tone(ctx, d, { f0: 880 + 700 * frac, dur: 0.06, peak: 0.13 });
    noise(ctx, d, { dur: 0.01, peak: 0.06, f0: 4200, q: 3 });
  },
  tickDown(ctx, d) { tone(ctx, d, { f0: 620, f1: 500, dur: 0.07, peak: 0.12 }); },
  levelSmall(ctx, d) {
    [659.25, 880, 1318.5].forEach((f, i) => tone(ctx, d, { type: "triangle", f0: f, t: i * 0.06, dur: 0.18, peak: 0.12 }));
    noise(ctx, d, { t: 0.1, attack: 0.02, dur: 0.3, peak: 0.04, type: "highpass", f0: 6500 });
  },
  levelDown(ctx, d) {
    [880, 659.25].forEach((f, i) => tone(ctx, d, { type: "triangle", f0: f, t: i * 0.07, dur: 0.14, peak: 0.1 }));
  },
  rankUp(ctx, d) {
    noise(ctx, d, { attack: 0.1, dur: 0.3, peak: 0.16, f0: 400, f1: 5000, q: 1.2 });
    [523.25, 659.25, 783.99].forEach((f) => {
      tone(ctx, d, { f0: f, t: 0.08, attack: 0.12, dur: 1.1, peak: 0.07 });
      tone(ctx, d, { type: "triangle", f0: f * 2, t: 0.08, attack: 0.05, dur: 0.6, peak: 0.03 });
    });
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(ctx, d, { type: "triangle", f0: f, t: 0.3 + i * 0.07, dur: 0.22, peak: 0.08 }));
    SOUNDS.stamp(ctx, d, 0.6);
    noise(ctx, d, { t: 0.62, attack: 0.02, dur: 0.6, peak: 0.05, type: "highpass", f0: 7000 });
  },
  diceRattle(ctx, d) {
    [0, 0.045, 0.095, 0.15, 0.21, 0.28, 0.36].forEach((t) => {
      noise(ctx, d, { t, dur: 0.018, peak: rnd(0.1, 0.17), f0: rnd(1800, 4200), q: 3 });
      tone(ctx, d, { type: "triangle", f0: rnd(600, 950), t, dur: 0.02, peak: 0.03 });
    });
  },
  diceLand(ctx, d) {
    tone(ctx, d, { f0: 160, f1: 70, dur: 0.12, peak: 0.2 });
    tone(ctx, d, { type: "triangle", f0: 1046.5, dur: 0.12, peak: 0.09 });
    tone(ctx, d, { f0: 1568, t: 0.05, dur: 0.18, peak: 0.05 });
  },
  diceCrit(ctx, d) {
    tone(ctx, d, { f0: 160, f1: 60, dur: 0.16, peak: 0.24 });
    [784, 988, 1175, 1568, 2093].forEach((f, i) => tone(ctx, d, { type: "triangle", f0: f, t: i * 0.055, dur: 0.24, peak: 0.11 }));
    noise(ctx, d, { t: 0.05, attack: 0.03, dur: 0.5, peak: 0.06, type: "highpass", f0: 6000 });
  },
  diceFail(ctx, d) {
    tone(ctx, d, { type: "sawtooth", f0: 196, f1: 92, dur: 0.42, peak: 0.1, lp: 700 });
    tone(ctx, d, { type: "sawtooth", f0: 196, f1: 92, dur: 0.42, peak: 0.08, lp: 700, detune: 28 });
    tone(ctx, d, { f0: 90, f1: 40, dur: 0.2, peak: 0.2 });
  },
  damage(ctx, d, tier = 1) {
    tone(ctx, d, { f0: 150, f1: 42, dur: 0.16 + 0.08 * tier, peak: Math.min(0.5, 0.2 + 0.1 * tier) });
    noise(ctx, d, { dur: 0.05, peak: 0.15 + 0.05 * tier, f0: 1200, q: 0.7 });
    if (tier >= 3) {
      tone(ctx, d, { f0: 55, dur: 0.5, attack: 0.01, peak: 0.2 });
      noise(ctx, d, { t: 0.02, attack: 0.02, dur: 0.4, peak: 0.1, type: "lowpass", f0: 420 });
    }
  },
  heal(ctx, d) {
    tone(ctx, d, { f0: 520, f1: 1040, attack: 0.02, dur: 0.26, peak: 0.06 });
    tone(ctx, d, { f0: 1046.5, t: 0.08, attack: 0.008, dur: 0.5, peak: 0.08 });
    tone(ctx, d, { f0: 1568, t: 0.14, attack: 0.008, dur: 0.45, peak: 0.06 });
    noise(ctx, d, { t: 0.1, attack: 0.04, dur: 0.3, peak: 0.03, type: "highpass", f0: 7000 });
  },
  stress(ctx, d) {
    tone(ctx, d, { type: "sawtooth", f0: 110, dur: 0.32, attack: 0.03, peak: 0.07, lp: 520 });
    tone(ctx, d, { type: "sawtooth", f0: 116.5, dur: 0.32, attack: 0.03, peak: 0.07, lp: 520 });
  },
  // Рост магической усталости: плохо. Глухой провал вниз, два тона трутся полутоном,
  // сверху тонкое «стекло трескается», в хвосте тяжёлый выдох.
  fatigueUp(ctx, d) {
    tone(ctx, d, { f0: 150, f1: 58, attack: 0.008, dur: 0.3, peak: 0.24 });
    tone(ctx, d, { type: "triangle", f0: 466.2, f1: 349.2, t: 0.02, attack: 0.02, dur: 0.34, peak: 0.07, lp: 1400 });
    tone(ctx, d, { type: "triangle", f0: 493.9, f1: 370, t: 0.02, attack: 0.02, dur: 0.34, peak: 0.06, lp: 1400 });
    for (let i = 0; i < 3; i++) noise(ctx, d, { t: 0.03 + i * 0.03, dur: 0.02, peak: 0.05, f0: 5200 - i * 900, q: 5 });
    noise(ctx, d, { t: 0.08, attack: 0.05, dur: 0.32, peak: 0.06, type: "lowpass", f0: 900, f1: 260, q: 0.7 });
  },
  // Спад усталости: облегчение, мягкий стеклянный звон
  fatigueDown(ctx, d) {
    tone(ctx, d, { f0: 1760, dur: 0.25, peak: 0.05 });
    tone(ctx, d, { f0: 2637, t: 0.04, dur: 0.2, peak: 0.025 });
    noise(ctx, d, { dur: 0.12, peak: 0.025, type: "highpass", f0: 7000 });
  },
  glitch(ctx, d) {
    for (let i = 0; i < 7; i++) tone(ctx, d, { type: "square", f0: rnd(300, 2400), t: i * 0.028, dur: 0.022, peak: 0.045, lp: 3500 });
    noise(ctx, d, { attack: 0.01, dur: 0.18, peak: 0.05, f0: 2400, q: 0.6 });
  },
  // Крит здоровья: монитор пищит, сердце стучит тяжело и редко
  alertCrit(ctx, d) {
    SOUNDS.damage(ctx, d, 2);
    tone(ctx, d, { type: "square", f0: 988, t: 0.1, dur: 0.12, peak: 0.05, lp: 2600 });
    tone(ctx, d, { type: "square", f0: 988, t: 0.32, dur: 0.12, peak: 0.05, lp: 2600 });
    heartbeat(ctx, d, 0.55, 0.34);
    heartbeat(ctx, d, 1.25, 0.26);
    noise(ctx, d, { t: 0.1, attack: 0.3, dur: 1.4, peak: 0.035, type: "lowpass", f0: 300, q: 0.5 });
  },
  // Предел маг. усталости: удар сердца, тонкий свист «стрелы», стеклянный треск
  alertFatigue(ctx, d) {
    noise(ctx, d, { attack: 0.18, dur: 0.06, peak: 0.12, f0: 900, f1: 6500, q: 4 });
    tone(ctx, d, { f0: 1400, f1: 3200, attack: 0.16, dur: 0.05, peak: 0.04 });
    SOUNDS.stamp(ctx, d, 0.24);
    for (let i = 0; i < 5; i++) noise(ctx, d, { t: 0.26 + i * 0.025, dur: 0.025, peak: 0.08 - i * 0.01, f0: rnd(3500, 6500), q: 6 });
    heartbeat(ctx, d, 0.5, 0.3);
    tone(ctx, d, { type: "triangle", f0: 523.3, f1: 261.6, t: 0.5, attack: 0.04, dur: 0.9, peak: 0.06, lp: 1200 });
    tone(ctx, d, { type: "triangle", f0: 554.4, f1: 277.2, t: 0.5, attack: 0.04, dur: 0.9, peak: 0.05, lp: 1200 });
  },
  // Срыв: рваный глитч, диссонанс пилой, провал вниз
  alertBreak(ctx, d) {
    SOUNDS.glitch(ctx, d);
    tone(ctx, d, { type: "sawtooth", f0: 220, f1: 55, t: 0.12, attack: 0.01, dur: 0.8, peak: 0.1, lp: 900 });
    tone(ctx, d, { type: "sawtooth", f0: 233, f1: 58, t: 0.12, attack: 0.01, dur: 0.8, peak: 0.09, lp: 900 });
    tone(ctx, d, { type: "sawtooth", f0: 311, f1: 78, t: 0.12, attack: 0.01, dur: 0.8, peak: 0.06, lp: 700 });
    tone(ctx, d, { f0: 60, f1: 32, t: 0.12, attack: 0.01, dur: 0.7, peak: 0.28 });
    for (let i = 0; i < 6; i++) tone(ctx, d, { type: "square", f0: rnd(180, 900), t: 0.5 + i * 0.05, dur: 0.03, peak: 0.035, lp: 2200 });
  },
  chat(ctx, d) {
    tone(ctx, d, { type: "triangle", f0: 1318.5, dur: 0.08, peak: 0.08 });
    tone(ctx, d, { type: "triangle", f0: 1760, t: 0.06, dur: 0.12, peak: 0.07 });
  }
};

// Минимальный интервал между повторами, мс: частые звуки не превращаются в пулемёт
const THROTTLE = { hover: 45, move: 35, tickUp: 30, tickDown: 30, diceRattle: 120, fatigueUp: 90, alertCrit: 1500, alertFatigue: 1500, alertBreak: 1500 };

function play(name, arg) {
  if (!S.enabled || S.volume <= 0) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  const nowMs = performance.now();
  const gap = THROTTLE[name] || 0;
  if (gap && S.last[name] && nowMs - S.last[name] < gap) return;
  S.last[name] = nowMs;
  const ctx = getCtx();
  if (!ctx || ctx.state !== "running") return;
  if (S.master) S.master.gain.value = masterGain();
  S.t0 = ctx.currentTime;
  try { fn(ctx, S.master, arg); } catch (e) { /* звук не должен ломать лист */ }
}

export const OrderSfx = {
  play,
  get enabled() { return S.enabled; },
  get volume() { return S.volume; },
  setEnabled(v) { S.enabled = !!v; persist(); },
  setVolume(v) {
    S.volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (S.master && S.ctx) S.master.gain.setTargetAtTime(masterGain(), S.ctx.currentTime, 0.02);
    persist();
  }
};

globalThis.OrderSfx = OrderSfx;
export default OrderSfx;
