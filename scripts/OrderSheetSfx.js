/**
 * ОПБСАН · звуки интерфейса листа персонажа.
 *
 * Все звуки синтезируются на Web Audio: файлов нет, лицензий нет, без сети работает.
 * Характер: тяжёлый терминал, а не аркада. Низкий регистр (40–330 Гц), синус и треугольник,
 * щелчки из отфильтрованного шума, общий срез верхов. Квадратных волн и высоких бипов нет.
 *
 * Играет только локально у того, кто взаимодействует с листом: это обычный AudioContext
 * в браузере пользователя, по сети ничего не передаётся.
 */

const THROTTLE_MS = { hover: 55, tick: 40 };
const MASTER = 0.9;

let ctx = null;
let bus = null;
let armed = false;
let muted = false;
const last = {};

// Политика автоплея: первый звук только после жеста пользователя.
if (typeof window !== "undefined") {
  const arm = () => { armed = true; };
  window.addEventListener("pointerdown", arm, { once: true, capture: true });
  window.addEventListener("keydown", arm, { once: true, capture: true });
}

function setting(key, fallback) {
  try {
    const v = globalThis.game?.settings?.get("Order", key);
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback; // настройка ещё не зарегистрирована
  }
}

function coreInterfaceVolume() {
  try {
    const v = globalThis.game?.settings?.get("core", "globalInterfaceVolume");
    return Number.isFinite(v) ? v : 1;
  } catch (e) {
    return 1;
  }
}

function output() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
    bus = ctx.createGain();
    // общий срез верхов: убирает «пиксельный» звон
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    lp.Q.value = 0.4;
    bus.connect(lp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  bus.gain.value = MASTER * Number(setting("sheetUiVolume", 0.6)) * coreInterfaceVolume();
  return ctx;
}

/* ── кирпичики ── */

// тональный слой: синус/треугольник с экспоненциальным затуханием
function body(now, { f, f2, at = 0, dur = 0.1, vol = 0.2, type = "sine", attack = 0.004 }) {
  const t0 = now + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

// шумовой слой: щелчок, удар, «вжух» (полосовой или низкочастотный фильтр)
function grit(now, { at = 0, dur = 0.03, vol = 0.1, from = 800, to, q = 1.5, filter = "bandpass", attack = 0.002 }) {
  const t0 = now + at;
  const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * dur)), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf;
  flt.type = filter;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(from, t0);
  if (to) flt.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(flt).connect(g).connect(bus);
  src.start(t0);
}

// «магическая искра»: тихий FM-колокол в среднем регистре с длинным хвостом
function spark(now, { f = 330, at = 0, dur = 0.5, vol = 0.05 }) {
  const t0 = now + at;
  const car = ctx.createOscillator(), mod = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
  car.frequency.value = f;
  mod.frequency.value = f * 2.4; // негармоническое отношение даёт металлический оттенок
  depth.gain.setValueAtTime(f * 0.9, t0);
  depth.gain.exponentialRampToValueAtTime(1, t0 + dur);
  g.gain.setValueAtTime(0.001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  mod.connect(depth).connect(car.frequency);
  car.connect(g).connect(bus);
  car.start(t0); mod.start(t0);
  car.stop(t0 + dur + 0.03); mod.stop(t0 + dur + 0.03);
}

/* ── банк звуков ── */
const BANK = {
  // курсор: едва слышный глухой тик
  hover(now) { grit(now, { dur: 0.018, vol: 0.05, from: 620, q: 2.5 }); body(now, { f: 150, dur: 0.03, vol: 0.03 }); },
  // мелкий щелчок (сегмент кольца, стадия эффекта)
  tick(now) { grit(now, { dur: 0.022, vol: 0.09, from: 900, q: 3 }); body(now, { f: 190, f2: 130, dur: 0.045, vol: 0.08 }); },
  // выбор пункта: короткий плотный «тхк»
  select(now) { body(now, { f: 150, f2: 82, dur: 0.085, vol: 0.26 }); grit(now, { dur: 0.02, vol: 0.09, from: 1100, q: 2 }); },
  // смена раздела: сухой двойной «клац» тяжёлой панели, без шипящего «вжуха»
  tab(now) {
    grit(now, { dur: 0.022, vol: 0.13, from: 760, q: 3 });
    body(now, { f: 104, f2: 78, dur: 0.06, vol: 0.24 });
    grit(now, { at: 0.03, dur: 0.07, vol: 0.07, from: 420, to: 240, filter: "lowpass", q: 0.6, attack: 0.01 });
    grit(now, { at: 0.072, dur: 0.02, vol: 0.1, from: 560, q: 3 });
    body(now, { f: 84, f2: 58, at: 0.072, dur: 0.09, vol: 0.28 });
  },
  // открытие листа: длинный «вжух», удар, искра
  open(now) {
    grit(now, { dur: 0.42, vol: 0.2, from: 140, to: 1300, q: 0.8, attack: 0.1 });
    body(now, { f: 96, f2: 42, at: 0.3, dur: 0.34, vol: 0.34 });
    grit(now, { at: 0.3, dur: 0.07, vol: 0.14, from: 500, filter: "lowpass", q: 0.5 });
    spark(now, { f: 294, at: 0.32, dur: 0.6, vol: 0.035 });
  },
  // подтверждение (экипировка, наложение эффекта): две низкие ноты, кварта вверх
  confirm(now) {
    grit(now, { dur: 0.02, vol: 0.09, from: 1000, q: 2 });
    body(now, { f: 147, dur: 0.1, vol: 0.2, type: "triangle" });
    body(now, { f: 196, at: 0.07, dur: 0.16, vol: 0.2, type: "triangle" });
    spark(now, { f: 392, at: 0.07, dur: 0.3, vol: 0.02 });
  },
  // отмена / снятие: нота вниз
  cancel(now) { body(now, { f: 165, f2: 88, dur: 0.14, vol: 0.22, type: "triangle" }); grit(now, { dur: 0.02, vol: 0.06, from: 700, q: 2 }); },
  // действие недоступно: два тупых толчка
  error(now) {
    body(now, { f: 92, dur: 0.07, vol: 0.26, type: "triangle" });
    body(now, { f: 86, at: 0.1, dur: 0.09, vol: 0.26, type: "triangle" });
  },
  // бросок: кость катится по столу и встаёт
  dice(now) {
    [0, 0.045, 0.085, 0.118].forEach((at, i) => grit(now, { at, dur: 0.03, vol: 0.16 - i * 0.02, from: 520 + (i % 2) * 190, q: 4 }));
    body(now, { f: 132, f2: 70, at: 0.15, dur: 0.13, vol: 0.26 });
  },
  // урон: тяжёлый удар
  damage(now) {
    body(now, { f: 118, f2: 36, dur: 0.3, vol: 0.42 });
    grit(now, { dur: 0.14, vol: 0.24, from: 900, to: 180, filter: "lowpass", q: 0.7 });
    grit(now, { dur: 0.025, vol: 0.1, from: 1400, q: 1.5 });
  },
  // лечение: мягкое низкое созвучие (квинта) и искра
  heal(now) {
    body(now, { f: 147, dur: 0.42, vol: 0.14, type: "triangle", attack: 0.05 });
    body(now, { f: 220, at: 0.05, dur: 0.4, vol: 0.11, type: "triangle", attack: 0.05 });
    spark(now, { f: 440, at: 0.1, dur: 0.5, vol: 0.03 });
  },
  // рост ранга / уровня / характеристики: удар-печать и нарастающий низкий гул, без мелодии
  levelup(now) {
    body(now, { f: 92, f2: 44, dur: 0.22, vol: 0.38 });
    grit(now, { dur: 0.06, vol: 0.14, from: 520, filter: "lowpass", q: 0.6 });
    body(now, { f: 73.4, at: 0.05, dur: 0.85, vol: 0.2, type: "triangle", attack: 0.16 });
    body(now, { f: 110, at: 0.05, dur: 0.8, vol: 0.15, type: "triangle", attack: 0.2 });
    spark(now, { f: 220, at: 0.14, dur: 1.0, vol: 0.04 });
  },
  // взять предмет / положить предмет
  "drag-pick"(now) { grit(now, { dur: 0.03, vol: 0.09, from: 800, to: 1300, q: 2 }); body(now, { f: 120, f2: 170, dur: 0.07, vol: 0.12 }); },
  "drag-drop"(now) { body(now, { f: 130, f2: 62, dur: 0.12, vol: 0.3 }); grit(now, { dur: 0.03, vol: 0.12, from: 600, q: 2 }); }
};

/**
 * Проиграть звук интерфейса. Тихо ничего не делает, если звук выключен, не было жеста
 * пользователя или браузер не дал AudioContext.
 * @param {string} name имя из OrderSheetSfx.names
 */
export function playUi(name) {
  const fn = BANK[name];
  if (!fn || muted || !armed || !setting("sheetUiSounds", true)) return;
  const t = performance.now();
  if (THROTTLE_MS[name] && t - (last[name] || 0) < THROTTLE_MS[name]) return;
  last[name] = t;
  try {
    const c = output();
    fn(c.currentTime);
  } catch (e) {
    // звук не обязателен: никаких ошибок в консоль
  }
}

export const OrderSheetSfx = {
  play: playUi,
  names: Object.keys(BANK),
  /** Локальный выключатель (например, из прототипа). Настройка системы проверяется отдельно. */
  setMuted(v) { muted = !!v; }
};
