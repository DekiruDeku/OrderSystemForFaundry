/**
 * ОПБСАН · моушен JRPG-листа персонажа.
 *
 * AppV1-лист перерисовывает весь HTML на каждое изменение актора, поэтому анимации
 * нельзя вешать на CSS-классы в шаблоне: они переигрывались бы при каждом ре-рендере.
 * Здесь всё запускается из кода (WAAPI), а состояние живёт на инстансе листа (sheet._osFx):
 *   - интро играет один раз, при первом рендере;
 *   - ресурсы анимируются от прошлого значения к новому;
 *   - смена вкладки анимируется только по клику.
 *
 * Модуль не зависит от Foundry: его же использует прототип в docs/prototype.
 * Пока у окна листа нет класса .osj, bind() ничего не делает.
 */
import { playUi } from "./OrderSheetSfx.js";

const T = { xs: 90, s: 160, m: 280, l: 520, stagger: 35 };
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
const BACK_OUT = "cubic-bezier(.34,1.56,.64,1)"; // перелёт в конце, без раскачки в начале

const q = (s, r) => r.querySelector(s);
const qa = (s, r) => [...r.querySelectorAll(s)];
// Окно листа (.osj) и его .window-content переживают ре-рендер AppV1, форма внутри нет.
// Поэтому тряска и слой эффектов живут на окне: ре-рендер посреди удара их не обрывает.
const appOf = (root) => root.closest?.(".osj") ?? root;
const stageOf = (root) => q(".window-content", appOf(root)) ?? q(".os-sheet", root) ?? root;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Можно ли сейчас анимировать: настройка системы, настройка ОС и видимость вкладки. */
function motionOK() {
  return !document.body.classList.contains("order-no-animations")
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    && document.visibilityState === "visible";
}

/* ───────── цвет игрока ───────── */
const PLATE = [5, 7, 11], ICE = [240, 244, 255];
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const rgbToHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const lum = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, n) => n - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lift = (rgb, min) => { let out = rgb, t = 0; while (contrast(out, PLATE) < min && t < 1) { t += 0.06; out = mix(rgb, ICE, t); } return out; };

/**
 * Ставит акцент листа от цвета игрока. Слишком тёмный цвет осветляется, чтобы читаться
 * на чёрных плашках; цвет текста поверх акцента подбирается по контрасту.
 * @returns {string} цвет для линий и мелкого текста (--os-accent-vis)
 */
function applyAccent(app, hex) {
  const c = accentOf(hex);
  if (!c) return null;
  app.style.setProperty("--os-accent", c.fill);
  app.style.setProperty("--os-accent-vis", c.vis);
  app.style.setProperty("--os-accent-ink", c.ink);
  return c.vis;
}
/** Три производных цвета игрока: заливка, линии/мелкий текст, текст поверх заливки. */
function accentOf(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex ?? ""));
  if (!m) return null;
  const raw = hexToRgb("#" + m[1]);
  const fill = lift(raw, 3), vis = lift(raw, 4.5);
  const ink = contrast(fill, PLATE) >= contrast(fill, [255, 255, 255]) ? "#05070b" : "#ffffff";
  return { fill: rgbToHex(fill), vis: rgbToHex(vis), ink };
}

/* ───────── вход элемента ─────────
   Анимируются отдельные свойства translate / scale / rotate: они складываются с transform
   из CSS (скосы, наклон меню), поэтому собственную форму элемента не ломают. */
function enter(el, { x = 0, y = 0, scale, rotate, fade = true } = {}, opt = {}) {
  if (!el) return null;
  const kf = { translate: [`${x}px ${y}px`, "0px 0px"] };
  if (scale) kf.scale = [scale, "1 1"];
  if (rotate) kf.rotate = [rotate, "0deg"];
  if (fade) kf.opacity = [0, 1];
  return el.animate(kf, { duration: T.m, easing: EASE_OUT, fill: "backwards", ...opt });
}

/* ───────── тряска: затухающая «травма» ─────────
   Удары складываются, сила = trauma², смещение берётся из синусов, а не случайно
   (иначе дребезжит). Двигается только картинка листа. */
const shakers = new WeakMap();
function shake(root, amount) {
  if (!motionOK()) return;
  const target = stageOf(root);
  let s = shakers.get(target);
  if (!s) { s = { trauma: 0, raf: 0, t: 0, last: 0 }; shakers.set(target, s); }
  s.trauma = Math.min(1, s.trauma + amount);
  if (s.raf) return;
  s.last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    s.trauma = Math.max(0, s.trauma - 2.4 * dt);
    if (s.trauma <= 0 || !target.isConnected) { stopShake(root); return; }
    const k = s.trauma * s.trauma;
    s.t += dt * 42;
    target.style.translate = `${(11 * k * Math.sin(s.t * 1.7)).toFixed(1)}px ${(8 * k * Math.sin(s.t * 2.3)).toFixed(1)}px`;
    target.style.rotate = `${(0.5 * k * Math.sin(s.t * 1.1)).toFixed(2)}deg`;
    s.raf = requestAnimationFrame(step);
  };
  s.raf = requestAnimationFrame(step);
}
function stopShake(root) {
  const target = stageOf(root), s = shakers.get(target);
  if (s) { cancelAnimationFrame(s.raf); s.raf = 0; s.trauma = 0; }
  target.style.translate = "";
  target.style.rotate = "";
}

/* ───────── слой эффектов ───────── */
function fxLayer(root) {
  const host = appOf(root);
  let layer = q(":scope > .osj-fx", host);
  if (!layer) { layer = document.createElement("div"); layer.className = "osj-fx"; layer.setAttribute("aria-hidden", "true"); host.append(layer); }
  return layer;
}
function spawn(root, cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  if (text != null) el.textContent = text;
  fxLayer(root).append(el);
  return el;
}
function box(target, root) {
  const a = target.getBoundingClientRect(), b = fxLayer(root).getBoundingClientRect();
  return { left: a.left - b.left, top: a.top - b.top, w: a.width, h: a.height, cx: a.left - b.left + a.width / 2, cy: a.top - b.top + a.height / 2 };
}
const done = (anim, el) => anim.finished.then(() => el.remove(), () => el.remove());

function burst(root, target, { count = 8, color, up = false } = {}) {
  const b = box(target, root);
  for (let i = 0; i < count; i++) {
    const s = spawn(root, "osj-fx-spark");
    s.style.left = b.cx + "px"; s.style.top = b.cy + "px";
    if (color) s.style.background = color;
    const ang = up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.5 : Math.random() * Math.PI * 2;
    const dist = 28 + Math.random() * 52;
    done(s.animate({
      translate: ["0px 0px", `${(Math.cos(ang) * dist).toFixed(0)}px ${(Math.sin(ang) * dist).toFixed(0)}px`],
      rotate: ["45deg", `${180 + Math.random() * 180}deg`],
      scale: ["1", "0"]
    }, { duration: 420 + Math.random() * 220, easing: EASE_OUT }), s);
  }
}
function ring(root, target, color) {
  const b = box(target, root), size = Math.max(b.w, b.h, 24);
  const r = spawn(root, "osj-fx-ring");
  Object.assign(r.style, { left: b.cx - size / 2 + "px", top: b.cy - size / 2 + "px", width: size + "px", height: size + "px" });
  if (color) r.style.borderColor = color;
  done(r.animate({ scale: ["0.5", "1.9"], opacity: [0.9, 0] }, { duration: 380, easing: EASE_OUT }), r);
}
function sweep(root, target) {
  const b = box(target, root);
  const s = spawn(root, "osj-fx-sweep");
  Object.assign(s.style, { left: b.left + "px", top: b.top + "px", width: b.w + "px", height: b.h + "px" });
  done(s.animate([
    { transform: "skewX(-12deg) scaleX(0)", opacity: 0.55 },
    { transform: "skewX(-12deg) scaleX(1)", opacity: 0.45, offset: 0.5 },
    { transform: "skewX(-12deg) scaleX(1)", opacity: 0 }
  ], { duration: 340, easing: EASE_OUT }), s);
}
function popText(root, target, cls, text, { dx = 0, dy = 0, tilt = -8, life = 950 } = {}) {
  const b = box(target, root);
  const n = spawn(root, cls, text);
  Object.assign(n.style, { left: b.cx + dx + "px", top: b.cy + dy + "px", rotate: tilt + "deg" });
  done(n.animate([
    { opacity: 0, translate: "-50% -50%", scale: "2.3" },
    { opacity: 1, translate: "-50% -50%", scale: "1", offset: 0.14, easing: EASE_OUT },
    { opacity: 1, translate: "-50% -50%", scale: "1", offset: 0.72 },
    { opacity: 0, translate: "-50% -110%", scale: "1" }
  ], { duration: life }), n);
  return n;
}
function flash(host, { hold = 0, color, peak = 1, fade = 240 } = {}) {
  const f = document.createElement("div");
  f.className = "osj-fx-flash";
  if (color) { f.style.background = color; f.style.mixBlendMode = "multiply"; }
  host.append(f);
  const total = hold + fade;
  done(f.animate([{ opacity: peak }, { opacity: peak, offset: hold / total }, { opacity: 0 }], { duration: total }), f);
}

/** Вайп-раскрытие: полосы мгновенно закрывают область (или весь лист) и уезжают по диагонали. */
function wipe(root, area, { duration = 260, gap = 45 } = {}) {
  const w = spawn(root, "osj-wipe");
  w.innerHTML = "<i></i><i></i><i></i>";
  if (area) {
    const b = box(area, root);
    Object.assign(w.style, { inset: "auto", left: b.left + "px", top: b.top + "px", width: b.w + "px", height: b.h + "px" });
  }
  const bands = qa("i", w).reverse(); // верхняя полоса уходит первой
  const anims = bands.map((band, i) => band.animate(
    [{ transform: "translateX(0) skewX(-18deg)" }, { transform: "translateX(170%) skewX(-18deg)" }],
    { duration, delay: i * gap, easing: "cubic-bezier(.55,0,.25,1)", fill: "backwards" }
  ));
  done(anims[anims.length - 1], w);
}

/* ───────── меню разделов ───────── */
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** «Ransom»-буквы пункта меню. Seed берётся от имени вкладки, поэтому при ре-рендере буквы не прыгают. */
function ransom(link) {
  if (link.querySelector(".osj-ch")) return;
  const text = link.textContent.trim();
  let seed = 0;
  for (const ch of String(link.dataset.tab ?? text)) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rnd = mulberry(seed);
  let lastInv = -2;
  link.setAttribute("aria-label", text);
  link.innerHTML = [...text].map((ch, i) => {
    const r = (rnd() * 2 - 1) * 6, y = (rnd() * 2 - 1) * 1.6;
    const g = [700, 800, 900, 900][Math.floor(rnd() * 4)], w = Math.round(75 + rnd() * 25);
    const inv = rnd() < 0.24 && i - lastInv > 2 && i > 0;
    if (inv) lastInv = i;
    return `<span class="osj-ch${inv ? " inv" : ""}" aria-hidden="true" style="--r:${r.toFixed(1)}deg;--y:${y.toFixed(1)}px;--g:${g};--w:${w}%">${ch}</span>`;
  }).join("");
}

/** Ставит курсор меню под пункт. Курсор один: при смене вкладки он переезжает, а не мигает. */
function placeCursor(root, link, { instant = false } = {}) {
  const nav = q(".tabs_side-menu", root);
  link ??= nav && q(".navbar.active", nav);
  if (!nav || !link) return;
  let cur = q(".osj-cursor", nav), trail = q(".osj-cursor-trail", nav);
  if (!cur) {
    trail = document.createElement("i"); trail.className = "osj-cursor-trail";
    cur = document.createElement("i"); cur.className = "osj-cursor";
    nav.prepend(trail, cur);
    instant = true;
  }
  for (const el of [trail, cur]) {
    el.classList.toggle("is-instant", instant);
    el.style.height = link.offsetHeight + "px";
    el.style.setProperty("--cx", link.offsetLeft + 3 + "px");
    el.style.setProperty("--cy", link.offsetTop + "px");
    el.style.setProperty("--cs", ((link.offsetWidth * 1.1 + 12) / 200).toFixed(3));
  }
  if (instant) { void cur.offsetWidth; cur.classList.remove("is-instant"); trail.classList.remove("is-instant"); }
}

function tabChrome(root, link) {
  const giant = q(".osj-giant", root), caption = q(".osj-nav-caption", root);
  if (giant) giant.textContent = link.dataset.word ?? link.getAttribute("aria-label") ?? link.textContent.trim();
  if (caption) caption.textContent = link.dataset.caption ?? "";
  return { giant, caption };
}
function paneBlocks(root, name) {
  const pane = name && root.querySelector(`#${CSS.escape(name)}`);
  if (!pane) return [];
  const inner = qa(":scope > * > *", pane);
  return (inner.length > 1 ? inner : qa(":scope > *", pane)).slice(0, 8);
}

/** Смена вкладки по клику. К этому моменту лист уже переключил панели. */
function tabSwitch(root, link) {
  playUi("tab");
  placeCursor(root, link);
  const { giant, caption } = tabChrome(root, link);
  const content = q(".os-left-content", root);
  if (content) content.scrollTop = 0;
  if (!motionOK()) return;
  if (content) wipe(root, content);
  enter(giant, { x: 96, scale: "1.2 1" }, { duration: 380, delay: 70 });
  caption?.animate({ opacity: [0, 1], filter: ["blur(3px)", "blur(0px)"] }, { duration: 220, delay: 90, fill: "backwards" });
  paneBlocks(root, link.dataset.tab).forEach((b, i) => enter(b, { x: 56 }, { duration: 320, delay: 120 + i * T.stagger, easing: BACK_OUT }));
}

/* ───────── ресурсы ───────── */
const RES = {
  hp:     { cls: "os-resource-hp",     worse: "down", critical: (p) => p <= 0.25 },
  mana:   { cls: "os-resource-mana",   worse: "up",   critical: (p) => p >= 0.85 },
  stress: { cls: "os-resource-stress", worse: "up",   critical: (p) => p >= 0.8, high: (p) => p >= 0.5 }
};
// Ресурсы без особых правил (запасы Дрона): полоса и счётчик анимируются, тряски и порогов нет.
const PLAIN = { cls: null, worse: "down", critical: () => false, plain: true };
const resKey = (el) => Object.keys(RES).find((k) => el.classList.contains(RES[k].cls)) ?? (el.dataset.res ? "plain:" + el.dataset.res : undefined);
const ruleOf = (key) => RES[key] ?? PLAIN;
function readResource(el) {
  const inputs = qa(".os-resource-values input", el);
  const v = parseFloat(inputs[0]?.value), max = parseFloat(inputs[1]?.value);
  return { v: Number.isFinite(v) ? v : 0, max: Number.isFinite(max) && max > 0 ? max : 1, input: inputs[0] };
}
function paintResource(el, rule, v, max) {
  const p = clamp01(v / max);
  el.style.setProperty("--pct", p);
  el.classList.toggle("is-critical", rule.critical(p));
  el.classList.toggle("is-high", !!rule.high?.(p));
  return p;
}

const counters = new WeakMap();
function stopCount(input) {
  const c = counters.get(input);
  if (!c) return;
  cancelAnimationFrame(c.raf); clearTimeout(c.guard); clearTimeout(c.start);
  counters.delete(input);
}
function countTo(input, from, to, dur, delay = 0) {
  if (!input || document.activeElement === input) return;
  stopCount(input);
  const c = {};
  counters.set(input, c);
  input.value = Math.round(from);
  const run = () => {
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      input.value = Math.round(from + (to - from) * e);
      if (k < 1) c.raf = requestAnimationFrame(tick);
    };
    c.raf = requestAnimationFrame(tick);
  };
  c.start = setTimeout(run, delay);
  // страховка: итог встанет, даже если rAF остановят (вкладка ушла в фон)
  c.guard = setTimeout(() => { stopCount(input); input.value = to; }, delay + dur + 90);
}

/**
 * Ресурс изменился: анимация от старого значения к новому. Сила отклика зависит от доли
 * потери: мелкий урон только дёргает плашку, крупный даёт hit-stop, вспышку и тряску листа.
 */
function resourceChange(root, el, from, to, max, { quiet = false, elapsed = 0 } = {}) {
  const key = resKey(el), rule = ruleOf(key);
  if (!key || from === to) return;
  const p0 = clamp01(from / max), p1 = clamp01(to / max), delta = to - from;
  const worse = rule.worse === "down" ? delta < 0 : delta > 0;
  const frac = Math.abs(delta) / max, isHp = key === "hp";
  const tier = !worse ? "good" : frac >= 0.15 ? "large" : frac >= 0.07 ? "medium" : "small";
  if (!quiet) playUi(rule.plain ? "tick" : !worse ? "heal" : tier === "small" ? "select" : "damage");
  if (!motionOK()) return;

  const input = readResource(el).input, bar = q(".os-bar", el), fill = q(".os-bar-fill", el);
  if (!bar || !fill) return;
  let ghost = q(".os-bar-ghost", bar);
  if (!ghost) { ghost = document.createElement("div"); ghost.className = "os-bar-ghost"; bar.prepend(ghost); }
  const hold = isHp && tier === "large" ? 80 : 0; // hit-stop: кадр удара замирает, потом всё срывается
  const lead = hold - elapsed; // отрицательная задержка продолжает анимацию с середины
  const portrait = q(".os-portrait", root), frame = q(".osj-portrait-frame", root) ?? portrait;

  if (!quiet) countTo(input, from, to, 420, hold);
  ghost.style.background = worse ? "#fff" : "var(--os-cyan)";
  if (p1 < p0) {
    // полоса встаёт на новое значение сразу, «призрак» держит старое и догоняет
    fill.animate([{ transform: `scaleX(${p0})` }, { transform: `scaleX(${p1})` }], { duration: T.s, delay: lead, easing: EASE_OUT, fill: "backwards" });
    ghost.animate([
      { transform: `scaleX(${p0})` },
      { transform: `scaleX(${p0})`, offset: 0.45, easing: EASE_OUT },
      { transform: `scaleX(${p1})` }
    ], { duration: 900, delay: lead, fill: "backwards" });
  } else {
    // «призрак» показывает, куда придёт полоса, полоса догоняет
    ghost.animate([
      { transform: `scaleX(${p1})`, opacity: 0.9 },
      { transform: `scaleX(${p1})`, opacity: 0.9, offset: 0.75 },
      { transform: `scaleX(${p1})`, opacity: 0 }
    ], { duration: 760, delay: -elapsed });
    fill.animate([{ transform: `scaleX(${p0})` }, { transform: `scaleX(${p0})`, offset: 0.2, easing: EASE_OUT }, { transform: `scaleX(${p1})` }], { duration: T.l, delay: -elapsed });
  }
  if (quiet || rule.plain) return; // ре-рендер посреди анимации: полосы доигрывают, остальное живёт на окне

  if (!worse) {
    el.animate({ scale: ["1.05", "1"] }, { duration: T.m, easing: BACK_OUT });
    sweep(root, bar);
    burst(root, bar, { count: 7, color: "var(--os-cyan)", up: true });
    if (isHp && portrait) popText(root, portrait, "osj-fx-num is-good", "+" + delta);
    return;
  }

  const kick = tier === "large" ? 9 : tier === "medium" ? 5 : 3;
  el.animate({ translate: [0, -kick, kick, -kick * 0.6, kick * 0.4, 0].map((x) => `${x}px 0px`) }, { duration: tier === "small" ? 170 : 300, delay: hold });
  if (!isHp) {
    if (frac >= 0.2) shake(root, 0.2);
  } else if (tier !== "small" && portrait) {
    // Отложенные части ищут элементы заново через окно: за время hit-stop лист мог
    // перерисоваться, и захваченные выше узлы уже оторваны от документа.
    const app = appOf(root);
    const live = () => {
      const p = q(".os-portrait", app);
      return { portrait: p, frame: q(".osj-portrait-frame", app) ?? p, bar: q(`.${rule.cls} .os-bar`, app) };
    };
    if (tier === "large") {
      flash(frame, { hold, fade: 90 });                                        // белый кадр удара
      setTimeout(() => {
        const now = live();
        if (!now.portrait) return;
        flash(now.frame, { color: "var(--os-alarm)", peak: 0.8, fade: 320 });
        shake(app, 0.8);
        const v = spawn(app, "osj-fx-vignette");
        done(v.animate({ opacity: [1, 0] }, { duration: 460, easing: "ease-out" }), v);
        now.portrait.animate({ translate: ["0px 0px", "14px -4px", "-9px 3px", "5px 0px", "0px 0px"] }, { duration: 340, easing: EASE_OUT });
        if (now.bar) burst(app, now.bar, { count: 9, color: "var(--os-alarm)" });
      }, hold);
    } else {
      flash(frame, { color: "var(--os-alarm)", peak: 0.6, fade: 260 });
      shake(app, 0.38);
    }
    setTimeout(() => {
      const now = live();
      if (now.portrait) popText(app, now.portrait, "osj-fx-num" + (tier === "large" ? " is-big" : ""), "−" + Math.abs(delta));
    }, hold);
  }
  // порог пройден: штамп с текстом флага ресурса
  if (!rule.critical(p0) && rule.critical(p1)) {
    const app = appOf(root), text = q(".osj-res-flag", el)?.textContent?.trim();
    if (text) setTimeout(() => {
      const target = q(`.${rule.cls}`, app);
      if (target) popText(app, target, "osj-fx-stamp is-alarm", text, { tilt: -5, dy: -14, life: 1200 });
    }, hold + 160);
    shake(app, 0.3);
  }
}

/* ───────── разовые отклики ───────── */

/** Бросок: кубик прокручивается и «выстреливает», сверху выезжает баннер с названием действия. */
function roll(root, btn, label) {
  playUi("dice");
  const layer = fxLayer(root);
  q(".osj-fx-banner", layer)?.remove();
  const anchor = q(".os-center", root) ?? stageOf(root), b = box(anchor, root);
  const banner = spawn(root, "osj-fx-banner", label || "Бросок");
  Object.assign(banner.style, { left: b.left + b.w + 6 + "px", top: b.top + 14 + "px", translate: "-100% 0" });
  if (!motionOK()) { setTimeout(() => banner.remove(), 1200); return; }
  btn?.animate({ rotate: ["0deg", "540deg"], scale: ["1", "1.6", "1"] }, { duration: 480, easing: EASE_OUT });
  if (btn) ring(root, btn);
  shake(root, 0.14);
  done(banner.animate([
    { opacity: 0, transform: "translateX(90px) scaleX(1.5)" },
    { opacity: 1, transform: "none", offset: 0.12, easing: EASE_OUT },
    { opacity: 1, transform: "none", offset: 0.8 },
    { opacity: 0, transform: "translateX(-26px)" }
  ], { duration: 1300 }), banner);
}

/** Характеристика, уровень или ранг выросли. Вызывать только по факту изменения. */
function levelUp(root, row, text) {
  playUi("levelup");
  const value = q("input", row) ?? row;
  if (!motionOK()) return;
  sweep(root, row);
  burst(root, value, { count: 12, color: "var(--os-accent-vis)" });
  ring(root, value, "var(--os-accent-vis)");
  value.animate({ scale: ["1.8", "1"] }, { duration: 320, easing: BACK_OUT });
  popText(root, row, "osj-fx-stamp", text, { tilt: -6, dx: -30, life: 1200 });
  shake(root, 0.16);
}

/** Экипировать / снять: карточка «щёлкает» со сжатием. */
function equip(root, card, on) {
  playUi(on ? "confirm" : "cancel");
  if (!motionOK()) return;
  if (!on) { card.animate({ scale: ["0.97 1", "1 1"] }, { duration: T.s, easing: EASE_OUT }); return; }
  card.animate({ scale: ["1.06 0.86", "1 1"] }, { duration: 300, easing: BACK_OUT });
  card.animate({ filter: ["brightness(2.6)", "brightness(1)"] }, { duration: 280, easing: "ease-out" });
  shake(root, 0.1);
}

/** Эффект наложен: «штамп». */
function effectIn(root, li) {
  playUi("confirm");
  if (!motionOK()) return;
  li.animate({ scale: ["1.7", "1"], rotate: ["-10deg", "0deg"], opacity: [0, 1] }, { duration: 280, easing: BACK_OUT });
  ring(root, li, "var(--os-alarm)");
}
/** Эффект снят: «срыв». Возвращает Promise, после которого элемент можно убрать. */
function effectOut(li) {
  playUi("cancel");
  if (!motionOK()) return Promise.resolve();
  const anim = li.animate({ translate: ["0px 0px", "26px -12px"], rotate: ["0deg", "10deg"], opacity: [1, 0] }, { duration: 200, easing: "ease-in", fill: "forwards" });
  // страховка по таймеру: в фоновой вкладке анимация может не закончиться, а удаление ждать не должно
  return Promise.race([anim.finished.catch(() => {}), new Promise((r) => setTimeout(r, 320))]);
}

/* ───────── интро: один раз при открытии листа, ввод не блокируется ───────── */
function intro(root) {
  if (!motionOK()) return;
  playUi("open");
  wipe(root, stageOf(root), { duration: 320, gap: 70 });
  qa(".osj-slab", root).forEach((el, i) => el.animate({ translate: ["0px -115%", "0px 0px"] }, { duration: 460, delay: i * 60, easing: EASE_OUT, fill: "backwards" }));

  qa(".tabs_side-menu .navbar", root).forEach((l, i) => enter(l, { x: -190 }, { duration: 340, delay: 130 + i * 40, easing: BACK_OUT }));
  qa(".osj-cursor, .osj-cursor-trail", root).forEach((c, i) => c.animate({ opacity: [0, 1] }, { duration: 120, delay: 330 + i * 40, fill: "backwards" }));
  enter(q(".osj-nav-caption", root), { x: -30 }, { delay: 380 });
  enter(q(".osj-giant", root), { x: -140, scale: "1.3 1" }, { duration: 460, delay: 110 });
  paneBlocks(root, q(".tabs_side-menu .navbar.active", root)?.dataset.tab).forEach((b, i) => enter(b, { x: 64 }, { duration: 320, delay: 210 + i * 40, easing: BACK_OUT }));

  // портрет «впечатывается»: в момент посадки вспышка и тряска
  const portrait = q(".os-portrait", root), frame = q(".osj-portrait-frame", root);
  enter(portrait, { scale: "1.38" }, { duration: 300, delay: 150, easing: "cubic-bezier(.3,0,.2,1)" });
  setTimeout(() => { if (!root.isConnected || !motionOK()) return; if (frame) flash(frame, { fade: 220 }); shake(root, 0.45); }, 430);
  enter(q(".osj-portrait-back", root), { x: -11, y: -9, fade: false }, { duration: 300, delay: 440, easing: BACK_OUT });
  const rank = q(".osj-rank", root);
  enter(rank, { scale: "2.5", rotate: "18deg" }, { duration: 240, delay: 500, easing: BACK_OUT });
  setTimeout(() => { if (rank?.isConnected && motionOK()) ring(root, rank, "var(--os-accent-vis)"); }, 680);

  enter(q(".os-namebar", root), { x: -170, scale: "1.3 1" }, { duration: 340, delay: 300, easing: BACK_OUT });
  qa(".osj-tag", root).forEach((t, i) => enter(t, { y: 16 }, { duration: 240, delay: 420 + i * 40, easing: BACK_OUT }));
  qa(".os-resource", root).forEach((el, i) => {
    const delay = 330 + i * 55, { v, max, input } = readResource(el);
    enter(el, { x: 130 }, { duration: 340, delay, easing: BACK_OUT });
    q(".os-bar-fill", el)?.animate([{ transform: "scaleX(0)" }, { transform: `scaleX(${clamp01(v / max)})` }], { duration: 460, delay: delay + 120, easing: EASE_OUT, fill: "backwards" });
    countTo(input, 0, v, 460, delay + 120);
  });
  enter(q(".os-effects", root), { y: 14 }, { duration: 240, delay: 540 });
  qa(".stat-value", root).forEach((row, i) => enter(row, { x: 150 }, { duration: 320, delay: 190 + i * 22, easing: BACK_OUT }));
  enter(q(".osj-hintbar", root), { y: 30 }, { delay: 170 });
}

/* ───────── хинт-строка ───────── */
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function setHint(root, text) {
  const el = q(".osj-hint", root);
  if (!el) return;
  el.innerHTML = (text || el.dataset.default || "").split(" · ").map((part) => {
    const m = part.match(/^([^:]{1,22}):\s*(.+)$/);
    return m ? `<kbd>${esc(m[1])}</kbd>${esc(m[2])}` : esc(part);
  }).join('<span class="sep">/</span>');
}

/* Подсказки для элементов из общих partials: их разметку делят NPC и Дроны, поэтому
   data-hint туда не добавляется, текст берётся отсюда. Явный data-hint всегда главнее. */
const HINTS = [
  [".stat-value", "Название: тренировка · Кубик: бросок · Кольцо: ЛКМ добавляет сегмент, ПКМ убирает"],
  [".skill-card, .spell-card", "Кубик: применить · ПКМ: отправить в чат · 2×ЛКМ: открыть · Перетащить: на хотбар"],
  [".inventory-slot[data-item-id]", "2×ЛКМ: открыть · Перетащить: в другую ячейку"],
  [".os-equipment-card", "Название: открыть · Кубик: атака · Перетащить картинку: на хотбар"]
];
/** Текст баннера действия: что именно бросают. Берётся из разметки вокруг кубика. */
function rollLabel(btn) {
  if (btn.dataset.roll) return btn.dataset.roll;
  const text = (sel, scope) => btn.closest(scope)?.querySelector(sel)?.textContent?.trim();
  if (btn.matches(".roll-characteristic")) return `Проверка · ${text(".train-characteristic", ".stat-value") ?? ""}`;
  if (btn.matches(".roll-attack, .roll-ranged-attack")) return `Атака · ${text(".os-equipment-name", ".item") ?? ""}`;
  if (btn.matches(".roll-improvised-attack")) return "Импровизированная атака";
  return text(".ability-card-name", ".item") ?? btn.title ?? "Бросок";
}
const HINT_TARGETS = "[data-hint], " + HINTS.map(([sel]) => sel).join(", ");
const hintOf = (el) => (!el ? "" : el.dataset.hint ?? HINTS.find(([sel]) => el.matches(sel))?.[1] ?? "");

/* ───────── привязка к листу ───────── */
const HOVER_SFX = ".navbar, .stat-value, .os-equipment-card, .skill-card, .spell-card, .inventory-slot[data-item-id], .effect-item, .header-button, .osj-tag, .os-resource";
const ROLL_BTN = ".roll-characteristic, .roll-dice, .roll-attack, .roll-ranged-attack, .roll-improvised-attack";
const PRESS_SFX = ".train-characteristic, .item-edit, [data-action], .apply-debuff, .ability-filter-toggle, .ability-filter-option";

/**
 * Вызывается в конце activateListeners на каждом рендере.
 * @param {object} sheet  инстанс листа: на нём хранится состояние между ре-рендерами
 * @param {HTMLElement} root  свежий корень разметки листа (форма)
 * @param {{accent?: string}} [opts]  цвет игрока
 */
function bind(sheet, root, { accent } = {}) {
  const app = root?.closest?.(".osj");
  if (!app) return; // лист ещё не переведён на новый стиль: модуль ничего не трогает
  const st = (sheet._osFx ??= { introPlayed: false, res: {}, resFx: {}, ro: null });
  const first = !st.introPlayed; // первый рендер: сравнивать не с чем, откликов «изменилось» нет
  if (accent) applyAccent(app, accent);

  // меню: буквы, подписи, курсор (без анимации: это ре-рендер, а не клик)
  qa(".tabs_side-menu .navbar", root).forEach(ransom);
  const active = q(".tabs_side-menu .navbar.active", root);
  if (active) { tabChrome(root, active); placeCursor(root, active, { instant: true }); }
  setHint(root);

  // ресурсы: от прошлого значения к новому. Сравнение идемпотентно: повторный рендер
  // с тем же значением ничего не проигрывает.
  qa(".os-resource", root).forEach((el) => {
    const key = resKey(el);
    if (!key) return;
    const { v, max } = readResource(el), prev = st.res[key];
    paintResource(el, ruleOf(key), v, max);
    st.res[key] = { v, max };
    if (first || !prev) return;
    const now = performance.now(), run = st.resFx[key];
    if (prev.v !== v) {
      st.resFx[key] = { from: prev.v, to: v, max, t0: now };
      resourceChange(root, el, prev.v, v, max);
    } else if (run && run.to === v && now - run.t0 < 900) {
      // второй ре-рендер от того же изменения (у листа их бывает два подряд): полосы доигрывают
      resourceChange(root, el, run.from, run.to, run.max, { quiet: true, elapsed: now - run.t0 });
    }
  });

  // характеристики: значение выросло → «level up», сегмент кольца изменился → щелчок.
  // Число сегментов лист пишет в title канваса («x / y») до вызова bind.
  const stats = {};
  qa(".stat-value", root).forEach((row) => {
    const ringEl = q(".circle-progress", row), key = ringEl?.dataset.attribute;
    if (!key) return;
    const value = parseFloat(q("input", row)?.value), filled = parseInt(ringEl.title, 10);
    stats[key] = { value, filled };
    const prev = st.stats?.[key];
    if (first || !prev || !Number.isFinite(value)) return;
    if (value > prev.value) levelUp(root, row, `${q(".train-characteristic", row)?.textContent?.trim() ?? ""} +${value - prev.value}`);
    else if (value === prev.value && filled !== prev.filled) {
      playUi("tick");
      if (motionOK()) ringEl.animate({ scale: ["1.5", "1"] }, { duration: 220, easing: BACK_OUT });
    }
  });
  st.stats = stats;

  // эффекты: новый → «штамп», снятый → звук (сам элемент уже исчез вместе со старой разметкой)
  const effects = new Set(qa(".effect-item[data-effect-id]", root).map((li) => li.dataset.effectId));
  if (!first && st.effects) {
    qa(".effect-item[data-effect-id]", root).forEach((li) => { if (!st.effects.has(li.dataset.effectId)) effectIn(root, li); });
    if ([...st.effects].some((id) => !effects.has(id))) playUi("cancel");
  }
  st.effects = effects;

  // экипировка: карточка стала / перестала быть «в руке»
  const equipped = new Set(qa(".os-equipment-card.is-equipped[data-item-id]", root).map((c) => c.dataset.itemId));
  if (!first && st.equipped) {
    qa(".os-equipment-card[data-item-id]", root).forEach((card) => {
      const id = card.dataset.itemId, on = equipped.has(id);
      if (on !== st.equipped.has(id)) equip(root, card, on);
    });
  }
  st.equipped = equipped;

  if (first) { st.introPlayed = true; intro(root); }

  // слушатели висят на корне разметки и умирают вместе с ним при следующем ре-рендере
  root.addEventListener("click", (ev) => {
    if (ev.target.closest(".tabs_side-menu .navbar")) { st.clicking = true; setTimeout(() => { st.clicking = false; }, 0); }
  }, true);
  root.addEventListener("click", (ev) => {
    const nav = ev.target.closest(".tabs_side-menu .navbar");
    if (nav) { if (st.tab !== nav.dataset.tab) tabSwitch(root, nav); st.tab = nav.dataset.tab; st.clicking = false; return; }
    const die = ev.target.closest(ROLL_BTN);
    if (die) { roll(root, die.matches(".roll-improvised-attack") ? null : die, rollLabel(die)); return; }
    if (ev.target.closest(PRESS_SFX)) playUi("select");
  });
  st.tab = active?.dataset.tab ?? null;

  // Вкладку переключают и без клика (гайд листа): курсор меню и подписи идут следом.
  st.mo?.disconnect();
  const navEl = q(".tabs_side-menu", root);
  if (navEl && typeof MutationObserver !== "undefined") {
    st.mo = new MutationObserver(() => {
      if (st.clicking) return; // клик обработает слушатель выше, со звуком и вайпом
      const now = q(".navbar.active", navEl);
      if (!now || now.dataset.tab === st.tab) return;
      st.tab = now.dataset.tab;
      tabChrome(root, now);
      placeCursor(root, now);
    });
    st.mo.observe(navEl, { attributes: true, attributeFilter: ["class"], subtree: true });
  }

  let lastHover = null, lastHint = null;
  root.addEventListener("mouseover", (ev) => {
    const h = ev.target.closest(HINT_TARGETS);
    if (h !== lastHint) { lastHint = h; setHint(root, hintOf(h)); }
    const s = ev.target.closest(HOVER_SFX);
    if (s !== lastHover) { lastHover = s; if (s) playUi("hover"); }
  });
  root.addEventListener("mouseleave", () => { lastHint = lastHover = null; setHint(root); });

  // параллакс портрета и наклон карточек: только transform, не чаще кадра
  let raf = 0;
  root.addEventListener("mousemove", (ev) => {
    if (raf || !motionOK()) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const b = root.getBoundingClientRect();
      const nx = ((ev.clientX - b.left) / b.width - 0.5) * 2, ny = ((ev.clientY - b.top) / b.height - 0.5) * 2;
      const img = q(".os-portrait-img", root);
      if (img) { img.style.setProperty("--px", (-nx * 6).toFixed(1) + "px"); img.style.setProperty("--py", (-ny * 5).toFixed(1) + "px"); }
      qa(".osj-slab", root).forEach((s) => s.style.setProperty("--bx", (nx * 8).toFixed(1) + "px"));
      const card = ev.target.closest?.(".os-equipment-card");
      qa(".os-equipment-card", root).forEach((c) => {
        if (c !== card) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); return; }
        const r = c.getBoundingClientRect();
        c.style.setProperty("--ry", (((ev.clientX - r.left) / r.width - 0.5) * 6).toFixed(2) + "deg");
        c.style.setProperty("--rx", (-((ev.clientY - r.top) / r.height - 0.5) * 6).toFixed(2) + "deg");
      });
    });
  });

  // инвентарь: предмет после ре-рендера оказался в новой ячейке → «встаёт» с перелётом
  if (st.dropped && performance.now() - st.dropped.t < 1500) {
    const slot = q(`.inventory-slot[data-item-id="${CSS.escape(st.dropped.id)}"]`, root);
    if (slot && motionOK()) {
      slot.animate({ scale: ["1.45", "1"] }, { duration: 300, easing: BACK_OUT });
      ring(root, slot, "var(--os-accent-vis)");
    }
  }
  st.dropped = null;

  // Перетаскивание в инвентаре: только подсветка и звук. Слушатели стоят в фазе перехвата
  // (лист гасит всплытие drop), ничего не отменяют и не трогают dataTransfer.
  let dragId = null;
  const dragOff = () => {
    root.classList.remove("osj-drag-active");
    qa(".osj-dragging, .osj-drop-hover", root).forEach((el) => el.classList.remove("osj-dragging", "osj-drop-hover"));
  };
  root.addEventListener("dragstart", (ev) => {
    const slot = ev.target.closest?.(".inventory-icon[item-draggable]")?.closest(".inventory-slot");
    if (!slot) return;
    dragId = slot.dataset.itemId ?? null;
    playUi("drag-pick");
    // класс ставится кадром позже, иначе браузер снимет «призрак» уже потускневшего предмета
    requestAnimationFrame(() => { root.classList.add("osj-drag-active"); slot.classList.add("osj-dragging"); });
  }, true);
  root.addEventListener("dragenter", (ev) => {
    if (!root.classList.contains("osj-drag-active")) return;
    const slot = ev.target.closest?.(".inventory-slot");
    qa(".osj-drop-hover", root).forEach((el) => { if (el !== slot) el.classList.remove("osj-drop-hover"); });
    slot?.classList.add("osj-drop-hover");
  }, true);
  root.addEventListener("dragend", dragOff, true);
  root.addEventListener("drop", (ev) => {
    if (ev.target.closest?.(".inventory-slot")) {
      playUi("drag-drop");
      if (dragId) st.dropped = { id: dragId, t: performance.now() };
    }
    dragOff();
  }, true);

  // окно ресайзят без ре-рендера: курсор меню подстраивается сам
  st.ro?.disconnect();
  if (typeof ResizeObserver !== "undefined") {
    st.ro = new ResizeObserver(() => placeCursor(root, null, { instant: true }));
    st.ro.observe(stageOf(root));
  }
}

/** Вызывается в close(): гасит тряску и наблюдателей, забывает состояние. */
function unbind(sheet) {
  const st = sheet?._osFx;
  if (!st) return;
  st.ro?.disconnect();
  st.mo?.disconnect();
  const root = sheet.element?.[0] ?? sheet.element;
  if (root?.querySelector) { cancelAll(root); q(":scope > .osj-fx", appOf(root))?.remove(); }
  delete sheet._osFx;
}

/** Мгновенно останавливает всё, что сейчас играет (анимации выключили на лету). */
function cancelAll(root) {
  root.getAnimations?.({ subtree: true }).forEach((a) => a.cancel());
  stopShake(root);
  qa(":scope > .osj-fx > *", appOf(root)).forEach((el) => el.remove());
  qa(".os-resource-values input", root).forEach(stopCount);
}

export const OrderSheetFx = {
  bind, unbind, cancelAll, motionOK,
  applyAccent, accentOf, placeCursor, setHint,
  intro, tabSwitch, resourceChange, roll, levelUp, equip, effectIn, effectOut, shake
};
