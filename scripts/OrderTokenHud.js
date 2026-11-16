/* ============================================================================
   OrderTokenHud.js — HUD токена над хотбаром: портрет, ресурсы, действия хода,
   характеристики, ячейки, вкладки предметов, базовые действия.
   Визуальный язык листа бойца X: токены цвета, шрифты OSX, звуки OrderSfx.
   К Foundry ядро обращается через адаптер F (OrderTokenHudAdapter.js);
   хуки Foundry (выбор токена, документы, бой, хотбар) — в конце файла.
   ============================================================================ */
import { OrderSfx } from "./OrderSfx.js";
import { F } from "./OrderTokenHudAdapter.js";

const OTH = "order-token-hud", TT = "oth-tt-el", POPUP = "oth-action-popup", MENU = "oth-settings";
const CUTIN = "oth-cutin", SCHEME_STYLE = "oth-scheme-style", SPRITE = "oth-sprite", SLOTS = 10;
const ORDER_RED = "#e3172f";
const CH = "systems/Order/icons/tag-icons/characteristics/";

const CHARS = [
  { k: "Strength", i: CH + "strength.svg", l: "Сила" },
  { k: "Dexterity", i: CH + "agility.svg", l: "Ловкость" },
  { k: "Stamina", i: CH + "endurance.svg", l: "Выносливость" },
  { k: "Accuracy", i: CH + "accuracy.svg", l: "Меткость" },
  { k: "Will", i: CH + "willpower.svg", l: "Стойкость духа" },
  { k: "Knowledge", i: CH + "knowledge.svg", l: "Знание" },
  { k: "Charisma", i: CH + "charisma.svg", l: "Харизма" },
  { k: "Seduction", i: CH + "seduction.svg", l: "Обольщение" },
  { k: "Leadership", i: CH + "leadership.svg", l: "Лидерство" },
  { k: "Faith", i: CH + "faith.svg", l: "Вера" },
  { k: "Medicine", i: CH + "medicine.svg", l: "Медицина" },
  { k: "Magic", i: CH + "magic.svg", l: "Магия" },
  { k: "Stealth", i: CH + "stealth.svg", l: "Скрытность" }
];
const TABS = [
  { id: "weapons", ic: "weapon", l: "Оружие", word: "Оружие" },
  { id: "spells", ic: "spell", l: "Заклинания", word: "Магия" },
  { id: "skills", ic: "skill", l: "Навыки", word: "Навыки" },
  { id: "inventory", ic: "bag", l: "Инвентарь", word: "Снаряжение" },
  { id: "notes", ic: "bolt", l: "Базовые действия", word: "Действия" }
];
const HOME_WORD = "Ячейки";
const HANDS_STATES = [
  { label: "Двуруч.", ic: "hands2", tone: "gold", tip: "Оружие в двух руках" },
  { label: "Одноруч.", ic: "hand1", tone: "ice", tip: "Оружие в одной руке" },
  { label: "Без оруж.", ic: "hand0", tone: "mute", tip: "Без оружия" }
];
const BA_KIND = {
  main: { l: "Основное", ic: "act-main", hint: "использ. (осн. действие)" },
  bonus: { l: "Бонусное", ic: "act-bonus", hint: "использ. (бон. действие)" },
  instant: { l: "Мгновенное", ic: "act-instant", hint: "использовать в чат" },
  defense: { l: "Защита", ic: "shield", hint: "использовать в чат" },
  other: { l: "Действие", ic: "bolt", hint: "использовать в чат" }
};

/* ------------------------------------------------------------------ утилиты */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sumMods = (l) => (Array.isArray(l) ? l.reduce((a, m) => a + (Number(m?.value) || 0), 0) : 0);
const fmtMod = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const calm = () => reduceMotion() || document.body.classList.contains("order-no-animations");
const sfx = (n, a) => { try { OrderSfx.play(n, a); } catch { /* звук не ломает HUD */ } };
const reflow = (el) => void el?.offsetWidth;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } }
};
const ico = (n, cls = "") => `<svg class="oth-ic ${cls}" aria-hidden="true" focusable="false"><use href="#oth-i-${n}"/></svg>`;
const kbd = (...pairs) => `<div class="oth-tip-h">${pairs.map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`).join("")}</div>`;
const $ = (sel, root = document) => root.querySelector(sel);
const hudEl = () => document.getElementById(OTH);

/* --- флаги действий: паритет с OrderTokenHud.js --- */
const getHands = (a) => { try { return Number(a?.getFlag("Order", "othHands")) || 0; } catch { return 0; } };
const setHands = async (a, v) => { try { await a?.setFlag("Order", "othHands", v); } catch { /* */ } };
const getMain = (a) => { try { return a?.getFlag("Order", "othMainAction") !== false; } catch { return true; } };
const setMain = async (a, v) => { try { await a?.setFlag("Order", "othMainAction", !!v); } catch { /* */ } };
const getBonus = (a) => { try { return a?.getFlag("Order", "othBonusAction") !== false; } catch { return true; } };
const setBonus = async (a, v) => { try { await a?.setFlag("Order", "othBonusAction", !!v); } catch { /* */ } };
const getMacros = (a) => { try { return structuredClone(a?.getFlag("Order", "tokenHudMacros") ?? {}); } catch { return {}; } };

function getStunned(a) {
  try {
    const ef = Array.from(a?.effects ?? []).find((e) => e?.getFlag?.("Order", "debuffKey") === "Stunned" && e?.disabled !== true && e?.isSuppressed !== true);
    const s = Number(ef?.getFlag?.("Order", "stateKey") ?? 0) || 0;
    return s >= 1 && s <= 3 ? s : 0;
  } catch { return 0; }
}
/* Напоминание об Оглушении: паритет с _applyStunnedActionReminder */
export async function applyStunnedActionReminder(a, { newTurn = false } = {}) {
  if (!a) return false;
  const st = getStunned(a);
  let changed = false;
  const sm = async (v) => { if (getMain(a) !== v) { await setMain(a, v); changed = true; } };
  const sb = async (v) => { if (getBonus(a) !== v) { await setBonus(a, v); changed = true; } };
  if (newTurn) {
    await sm(!(st === 2 || st === 3));
    await sb(!(st === 1 || st === 3));
    return changed;
  }
  if (st === 1) await sb(false);
  else if (st === 2) await sm(false);
  else if (st === 3) { await sm(false); await sb(false); }
  return changed;
}

/* --- стоимость действий: паритет с OrderTokenHud.js --- */
const actionCost = (i) => String(i?.system?.ActionCost ?? i?.system?.actionCost ?? "").replace(/ /g, " ").trim();
function actionCostMatches(raw, type) {
  const s = String(raw ?? "").toLocaleLowerCase("ru-RU");
  if (!s) return false;
  const re = type === "main"
    ? /(^|[^а-яёa-z0-9])(?:основн[а-яё]*|осн\.?|од)(?=$|[^а-яёa-z0-9])/iu
    : /(^|[^а-яёa-z0-9])(?:бонусн[а-яё]*|бон\.?|бд)(?=$|[^а-яёa-z0-9])/iu;
  return re.test(s);
}
function simpleActionCost(raw, type) {
  let s = String(raw ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
  s = s.replace(/[.!?;:,]+$/g, "").replace(/\s+/g, " ");
  const re = type === "main"
    ? /^(?:1\s+)?(?:основн[а-я]*|осн\.?)\s*(?:действ[а-я]*)?$/iu
    : /^(?:1\s+)?(?:бонусн[а-я]*|бон\.?)\s*(?:действ[а-я]*)?$/iu;
  return re.test(s);
}
const plainText = (s) => { const d = document.createElement("div"); d.innerHTML = String(s ?? ""); return String(d.textContent ?? "").replace(/\s+/g, " ").trim(); };
const cut = (s, n = 190) => { const v = String(s ?? ""); return v.length > n ? `${v.slice(0, Math.max(0, n - 1)).trimEnd()}…` : v; };
const roundWord = (n) => { const v = Math.abs(Number(n) || 0) % 100, d = v % 10; return v > 10 && v < 20 ? "кругов" : d === 1 ? "круг" : d >= 2 && d <= 4 ? "круга" : "кругов"; };
function requiredActionCount(raw, type) {
  const s = String(raw ?? "").toLocaleLowerCase("ru-RU");
  const re = type === "main"
    ? /(\d+)\s*(?:основн[а-яё]*|осн\.?|од)(?=$|[^а-яёa-z0-9])/iu
    : /(\d+)\s*(?:бонусн[а-яё]*|бон\.?|бд)(?=$|[^а-яёa-z0-9])/iu;
  const m = s.match(re), n = Number(m?.[1] ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}
function actionItemStatus(actor, item, type, cost) {
  if (item?.type === "Skill") {
    const cd = F.skillCooldown(actor, item);
    if (cd?.active) {
      const r = Math.max(1, Number(cd.remainingRounds ?? 0) || 1);
      return { key: "cooldown", label: `${r} ${roundWord(r)}`, ic: "hourglass" };
    }
  }
  if (item?.type === "Spell") {
    const use = Number(item.system?.UsageCost ?? 0) || 0;
    const cur = Number(actor?.system?.ManaFatigue?.value ?? 0) || 0;
    const max = Number(actor?.system?.ManaFatigue?.max ?? 0) || 0;
    if (use > 0 && max > 0 && cur + use > max) return { key: "mana", label: "Нет маны", ic: "drop" };
  }
  const available = (type === "main" ? getMain(actor) : getBonus(actor)) ? 1 : 0;
  const required = requiredActionCount(cost, type);
  if (required > available) {
    if (required > 1) return { key: "cost", label: `Нужно ${required} действия`, ic: "layers" };
    return { key: "action", label: "Нет действия", ic: "x" };
  }
  return { key: "available", label: "Доступно", ic: item?.type === "Spell" ? "spell" : "bolt" };
}
function popupItems(actor, type) {
  return Array.from(actor?.items ?? [])
    .filter((i) => i && (i.type === "Skill" || i.type === "Spell"))
    .map((i) => ({ item: i, cost: actionCost(i) }))
    .filter((x) => x.cost && actionCostMatches(x.cost, type))
    .sort((a, b) => {
      const at = a.item.type === "Skill" ? 0 : 1, bt = b.item.type === "Skill" ? 0 : 1;
      if (at !== bt) return at - bt;
      const ac = Number(a.item.system?.Circle ?? 999), bc = Number(b.item.system?.Circle ?? 999);
      if (ac !== bc) return ac - bc;
      return String(a.item.name ?? "").localeCompare(String(b.item.name ?? ""), "ru");
    });
}

/* --- цветовая схема: та же, что у листа (osx-scheme), выбранная вкладка всегда в цвете игрока --- */
function parseHex(c) {
  let h = String(c ?? "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}/i.test(h)) return null;
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}
const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
function schemeTokens(color) {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [h, s0, l0] = rgbToHsl(rgb);
  const s = s0 < 0.08 ? s0 : Math.max(0.5, s0);
  const lb = clamp(l0, 0.4, 0.56);
  const base = hslToRgb(h, s, lb);
  const hot = hslToRgb(h, Math.min(1, s + 0.05), clamp(lb + 0.08, 0.48, 0.64));
  const text = hslToRgb(h, s, Math.max(0.68, lb + 0.16));
  const deep = hslToRgb(h, s, 0.28);
  const ink = hslToRgb(h, s * 0.7, 0.09);
  return { base, hot, text, deep, ink };
}
function applyScheme() {
  let st = document.getElementById(SCHEME_STYLE);
  if (!st) { st = document.createElement("style"); st.id = SCHEME_STYLE; document.head.appendChild(st); }
  const scheme = store.get("osx-scheme", "order");
  const acc = schemeTokens(F.playerColor()) ?? schemeTokens(ORDER_RED);
  const row = (k, rgb) => `--${k}: ${toHex(rgb)}; --${k}-rgb: ${rgb.join(", ")};`;
  let css = `.oth-surface { ${row("acc", acc.base)} ${row("acc-hot", acc.hot)} ${row("acc-text", acc.text)} ${row("acc-deep", acc.deep)} ${row("acc-ink", acc.ink)} }`;
  if (scheme === "player") {
    css += `\n.oth-surface { ${row("red", acc.base)} ${row("red-hot", acc.hot)} ${row("red-text", acc.text)} ${row("red-deep", acc.deep)} ${row("red-ink", acc.ink)} }`;
  }
  st.textContent = css;
  document.querySelectorAll(".oth-surface").forEach((el) => { el.dataset.scheme = scheme; });
}

/* ------------------------------------------------------------------ иконки (одна линия, currentColor) */
const SPRITE_SVG = `<svg id="${SPRITE}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
<defs>
<symbol id="oth-i-heart" viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/></symbol>
<symbol id="oth-i-drop" viewBox="0 0 24 24"><path d="M12 3.5s6 6.3 6 10.6a6 6 0 0 1-12 0C6 9.8 12 3.5 12 3.5z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.4 2.6"/></symbol>
<symbol id="oth-i-pulse" viewBox="0 0 24 24"><path d="M2.5 12.5h4l2.2-5.5 3.4 11 2.6-7.5 1.6 2h5.2"/></symbol>
<symbol id="oth-i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.4c0 4.6-3.2 8-7.5 9.9-4.3-1.9-7.5-5.3-7.5-9.9V6z"/></symbol>
<symbol id="oth-i-run" viewBox="0 0 24 24"><path d="M4.5 6l6 6-6 6M12.5 6l6 6-6 6"/></symbol>
<symbol id="oth-i-hands2" viewBox="0 0 24 24"><path d="M12 2.5v19"/><rect x="7.5" y="8" width="9" height="4.2" rx="1.6"/><rect x="7.5" y="13.6" width="9" height="4.2" rx="1.6"/><path d="M9.5 5.5h5"/></symbol>
<symbol id="oth-i-hand1" viewBox="0 0 24 24"><path d="M12 2.5v19"/><rect x="7.5" y="11" width="9" height="4.6" rx="1.6"/><path d="M9.5 5.5h5"/></symbol>
<symbol id="oth-i-hand0" viewBox="0 0 24 24"><path d="M8 20.5c-1.8-1.4-3-3.6-3-6.2v-2.6a1.5 1.5 0 0 1 3 0v1.4M8 13V5.8a1.5 1.5 0 0 1 3 0V12M11 11.5V4.6a1.5 1.5 0 0 1 3 0V12M14 12V6.4a1.5 1.5 0 0 1 3 0v7.8c0 3.6-2.2 6.3-5.4 7.3"/></symbol>
<symbol id="oth-i-weapon" viewBox="0 0 24 24"><path d="M4 20l9.5-9.5M13.5 10.5l2-5.5 4.5-1-1 4.5-5.5 2zM6 14l4 4M3.5 20.5l2-2"/></symbol>
<symbol id="oth-i-spell" viewBox="0 0 24 24"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></symbol>
<symbol id="oth-i-skill" viewBox="0 0 24 24"><path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z"/><path d="M12 8.5l3 1.7v3.6l-3 1.7-3-1.7v-3.6z"/></symbol>
<symbol id="oth-i-bag" viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8.5l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8.5"/></symbol>
<symbol id="oth-i-bolt" viewBox="0 0 24 24"><path d="M13.5 2.5L5 14h6.2l-1.2 7.5L18.5 10h-6.2z"/></symbol>
<symbol id="oth-i-sound" viewBox="0 0 24 24"><path d="M4 9.5h3.6L12.5 5v14l-4.9-4.5H4z"/><path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.5a7.8 7.8 0 0 1 0 11"/></symbol>
<symbol id="oth-i-mute" viewBox="0 0 24 24"><path d="M4 9.5h3.6L12.5 5v14l-4.9-4.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></symbol>
<symbol id="oth-i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
<symbol id="oth-i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
<symbol id="oth-i-back" viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5"/></symbol>
<symbol id="oth-i-hourglass" viewBox="0 0 24 24"><path d="M6.5 3.5h11M6.5 20.5h11M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5"/></symbol>
<symbol id="oth-i-layers" viewBox="0 0 24 24"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/></symbol>
<symbol id="oth-i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/></symbol>
<symbol id="oth-i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="oth-i-move" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></symbol>
<symbol id="oth-i-image" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14"/><path d="M3.5 16.5l5-5 4 4 2.5-2.5 5.5 5.5"/><circle cx="15.5" cy="9.5" r="1.5"/></symbol>
<symbol id="oth-i-hood" viewBox="0 0 24 24"><path d="M12 3C7.6 3 4.5 6.6 4.5 11.2v9.3h15v-9.3C19.5 6.6 16.4 3 12 3z"/><path d="M8.3 20.5v-6.8c0-2.7 1.7-4.7 3.7-4.7s3.7 2 3.7 4.7v6.8"/><path d="M10.2 14.2h.01M13.8 14.2h.01"/></symbol>
<symbol id="oth-i-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.4 7.8A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.4-1.1"/><path d="M9.9 10a3 3 0 0 0 4.2 4.1"/></symbol>
<symbol id="oth-i-act-main" viewBox="0 0 64 64"><circle cx="32" cy="32" r="8" fill="currentColor" stroke="none"/><path d="M32 8v10M32 46v10M8 32h10M46 32h10" stroke-width="6"/></symbol>
<symbol id="oth-i-act-bonus" viewBox="0 0 64 64"><circle cx="30" cy="34" r="17" stroke-width="6"/><circle cx="45" cy="19" r="8" fill="currentColor" stroke="none"/></symbol>
<symbol id="oth-i-act-instant" viewBox="0 0 64 64"><circle cx="40" cy="32" r="6" fill="currentColor" stroke="none"/><path d="M9 20h19M5 32h20M11 44h19" stroke-width="6"/></symbol>
</defs></svg>`;

const SIGIL = `<svg class="oth-sigil" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><g class="oth-sigil-a" fill="none" stroke="currentColor"><circle cx="100" cy="100" r="94" stroke-width="1"/><circle cx="100" cy="100" r="86" stroke-width="5" stroke-dasharray="1.4 7.6"/><circle cx="100" cy="100" r="66" stroke-width="1"/></g><g class="oth-sigil-b" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M100 30l60.6 105H39.4z"/><path d="M100 170L39.4 65h121.2z"/><circle cx="100" cy="100" r="20"/><path d="M100 64v72M64 100h72" stroke-width=".8"/></g></svg>`;

/* ------------------------------------------------------------------ состояние */
const S = {
  a: null, tab: null, folder: null, dismissed: false, popupType: null,
  prev: null, hold: false, ba: null, baLoading: false, areaSig: "",
  shake: { trauma: 0, raf: 0, last: 0, t: 0 }, deckShake: { trauma: 0, raf: 0, last: 0, t: 0 },
  alertQ: [], alertBusy: false, floatN: 0, word: null, bound: false,
  pic: null, picEdit: false, picking: false, picSaveT: 0
};

/* ------------------------------------------------------------------ сборка */
function resRow(key, cls, label, ic, aria) {
  return `<div class="oth-ob ${cls}" data-res-row="${key}">
    <span class="oth-ob-label">${ico(ic)}<span>${label}</span></span>
    <span class="oth-bar" aria-hidden="true"><i class="oth-bar-ghost"></i><i class="oth-bar-fill"></i></span>
    <span class="oth-ob-readout"><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${aria}" class="oth-inp" data-f="system.${key}.value" data-res="${key}" value=""><span class="oth-ob-rule" aria-hidden="true">/</span><b class="oth-ob-max">0</b></span>
  </div>`;
}

function build(a) {
  const embers = Array.from({ length: 7 }, (_, i) => `<i style="--x:${8 + i * 13}%;--d:${7 + (i % 3) * 1.7}s;--w:${-(i * 1.9).toFixed(1)}s;--dx:${(i % 2 ? 1 : -1) * (6 + i * 2)}px"></i>`).join("");
  let h = "";
  h += `<div class="oth-port">`;
  h += `<div class="oth-port-frame" aria-hidden="true"><span class="oth-stripes"></span>${SIGIL}<span class="oth-embers">${embers}</span></div>`;
  const pd = picOf(a);
  h += `<div class="oth-pic" data-act="sh" role="button" tabindex="0" aria-label="Открыть лист: ${esc(a.name)}" style="${picVars(pd)}"><img src="${esc(picSrc(a, pd))}" alt="" draggable="false"></div>`;
  h += `<div class="oth-shade" aria-hidden="true"></div>`;
  h += `<div class="oth-pic-edit" aria-hidden="true"><span class="oth-pic-hint">${ico("move")}<span>Тяните · колесо — масштаб</span></span></div>`;
  h += `<div class="oth-port-body">`;
  h += `<div class="oth-nm"><span class="oth-name-text">${esc(a.name)}</span></div>`;
  h += `<div class="oth-ov"><div class="oth-ov-grid">`;
  h += resRow("Health", "oth-ob-health", "ХП", "heart", "Текущие ХП");
  h += resRow("ManaFatigue", "oth-ob-mana", "МУ", "drop", "Текущая магическая усталость");
  h += resRow("Stress", "oth-ob-stress", "Стресс", "pulse", "Текущий стресс");
  h += `</div><div class="oth-derived">`;
  h += `<div class="oth-derived-stat oth-armor" data-tip="armor">${ico("shield")}<span>Броня</span><b>0</b></div>`;
  h += `<div class="oth-derived-stat oth-speed" data-tip="speed">${ico("run")}<span>Скорость</span><b>0</b></div>`;
  h += `</div></div></div>`;
  h += `<div class="oth-fx" aria-hidden="true"></div>`;
  h += `<div class="oth-alerts" role="status" aria-live="assertive"></div>`;
  h += `</div>`;

  h += `<div class="oth-upper">`;
  h += `<div class="oth-deck-bg" aria-hidden="true"><span class="oth-stripes"></span><span class="oth-giant"></span></div>`;
  h += `<div class="oth-stats">`;
  h += `<div class="oth-actions" role="group" aria-label="Действия хода">`;
  h += `<button type="button" class="oth-act-btn oth-act-hands" data-act="hands"><span class="oth-act-plate" aria-hidden="true"></span>${ico("hand1", "oth-act-ic")}<span class="oth-act-k">Руки</span><span class="oth-act-v">—</span></button>`;
  h += `<button type="button" class="oth-act-btn oth-act-main" data-act="mainAction"><span class="oth-act-plate" aria-hidden="true"></span>${ico("act-main", "oth-act-ic")}<span class="oth-act-k">Основное</span><span class="oth-act-v">Готово</span><span class="oth-act-stamp" aria-hidden="true">Потрачено</span></button>`;
  h += `<button type="button" class="oth-act-btn oth-act-bonus" data-act="bonusAction"><span class="oth-act-plate" aria-hidden="true"></span>${ico("act-bonus", "oth-act-ic")}<span class="oth-act-k">Бонусное</span><span class="oth-act-v">Готово</span><span class="oth-act-stamp" aria-hidden="true">Потрачено</span></button>`;
  h += `</div>`;
  h += `<div class="oth-sg" role="toolbar" aria-label="Характеристики">`;
  CHARS.forEach((c, i) => {
    h += `<button type="button" class="oth-sc" data-a="${c.k}" style="--i:${i}" aria-label="${c.l}" tabindex="${i ? -1 : 0}"><i class="oth-char-icon" style="--ico:url('${new URL(c.i, document.baseURI).href}')" aria-hidden="true"></i><b>0</b><em></em></button>`;
  });
  h += `</div></div>`;
  h += `<div class="oth-main">`;
  h += `<div class="oth-tabs" role="tablist" aria-orientation="vertical" aria-label="Разделы"><span class="oth-tab-cursor" aria-hidden="true"></span>`;
  TABS.forEach((t, i) => {
    h += `<button type="button" role="tab" class="oth-tb" data-t="${t.id}" data-tt="${t.l}" aria-label="${t.l}" aria-selected="false" tabindex="${i ? -1 : 0}" style="--i:${i}">${ico(t.ic)}</button>`;
  });
  h += `</div><div class="oth-area" role="tabpanel" aria-label="Ячейки"></div></div>`;
  h += `<button type="button" class="oth-sfx-btn" aria-label="Звук HUD">${ico("sound")}</button>`;
  h += `</div>`;
  return h;
}

/* --- содержимое области: ячейки, вкладки, базовые действия --- */
function slotsView(a) {
  const ms = getMacros(a);
  let h = `<div class="oth-view oth-g5" data-view="slots">`;
  for (let i = 0; i < SLOTS; i++) {
    const sl = ms[String(i)];
    if (sl?.img) h += `<div class="oth-c oth-cf" data-sl="${i}" role="button" tabindex="-1" style="--i:${i}" aria-label="Ячейка ${i + 1}: ${esc(sl.name ?? "")}"><img src="${esc(sl.img)}" alt="" draggable="false"><span class="oth-k">${(i + 1) % 10}</span></div>`;
    else h += `<div class="oth-c" data-sl="${i}" role="button" tabindex="-1" style="--i:${i}" aria-label="Пустая ячейка ${i + 1}"><span class="oth-k">${(i + 1) % 10}</span></div>`;
  }
  return h + `</div>`;
}

function grid(items, empty, fn) {
  if (!items.length) return `<div class="oth-view oth-empty-view"><div class="oth-empty">${ico("layers")}<span>${empty}</span></div></div>`;
  let h = `<div class="oth-view oth-g5" data-view="items">`;
  items.forEach((i, n) => {
    const m = fn ? fn(i) : {};
    h += `<div class="oth-c oth-cf${m.used ? " used" : ""}" data-iid="${i.id}" draggable="true" role="button" tabindex="-1" style="--i:${Math.min(n, 14)}" aria-label="${esc(i.name)}"><img src="${esc(i.img || "icons/svg/item-bag.svg")}" alt="" draggable="false">`;
    if (m.cir != null) h += `<span class="oth-lb oth-lc">${m.cir}</span>`;
    if (m.perk) h += `<span class="oth-lb oth-lp">P</span>`;
    if (m.used) h += `<span class="oth-lb oth-lu">${ico("check")}</span>`;
    if (m.qty) h += `<span class="oth-lb oth-lq">${m.qty}</span>`;
    h += `</div>`;
  });
  return h + `</div>`;
}

function tabView(a, id) {
  const it = Array.from(a?.items ?? []);
  const circ = (i) => Number(i.system?.Circle ?? i.system?.circle ?? 999);
  switch (id) {
    case "weapons":
      return grid(it.filter((i) => ["weapon", "meleeweapon", "rangeweapon"].includes(i.type)), "Нет оружия", (i) => ({ used: !!i.system?.inHand }));
    case "spells":
      return grid(it.filter((i) => i.type === "Spell").sort((x, y) => circ(x) - circ(y)), "Нет заклинаний", (i) => ({ cir: Number(i.system?.Circle ?? i.system?.circle ?? 0) }));
    case "skills": {
      const sk = it.filter((i) => i.type === "Skill" && !i.system?.isPerk).sort((x, y) => circ(x) - circ(y));
      const pk = it.filter((i) => i.type === "Skill" && !!i.system?.isPerk);
      return grid([...sk, ...pk], "Нет навыков", (i) => ({ cir: i.system?.isPerk ? null : Number(i.system?.Circle ?? 0), perk: !!i.system?.isPerk }));
    }
    case "inventory": {
      const order = { Armor: 0, meleeweapon: 1, rangeweapon: 2, weapon: 3, Consumables: 4, RegularItem: 5 };
      const inv = it.filter((i) => i.type in order && i.getFlag?.("Order", "slotType") !== "storage").sort((x, y) => (order[x.type] ?? 9) - (order[y.type] ?? 9));
      return grid(inv, "Инвентарь пуст", (i) => {
        const s = i.system ?? {}, q = Number(s.Quantity ?? s.quantity ?? 1);
        return { used: !!(s.isEquiped || s.isUsed || s.inHand), qty: q > 1 ? q : null };
      });
    }
    default: return "";
  }
}

function baKind(name) {
  const n = String(name ?? "").toLocaleLowerCase("ru-RU");
  if (n.includes("основн")) return "main";
  if (n.includes("бонусн")) return "bonus";
  if (n.includes("мгновен")) return "instant";
  if (n.includes("защит")) return "defense";
  return "other";
}
function baView() {
  if (S.baLoading && !S.ba) return `<div class="oth-view oth-empty-view"><div class="oth-empty is-loading"><span>Загрузка базовых действий</span></div></div>`;
  const folders = S.ba ?? [];
  if (!folders.length) return `<div class="oth-view oth-empty-view"><div class="oth-empty">${ico("bolt")}<span>Компендиум «Базовые действия» пуст</span></div></div>`;
  if (S.folder == null) {
    let h = `<div class="oth-view oth-ba oth-ba-folders" data-view="ba-folders">`;
    folders.forEach((f, i) => {
      const k = baKind(f.folder);
      h += `<button type="button" class="oth-ba-folder" data-afolder="${i}" data-kind="${k}" style="--i:${i}" tabindex="-1"><span class="oth-ba-ic">${ico(BA_KIND[k].ic)}</span><span class="oth-ba-name">${esc(f.folder)}</span><span class="oth-ba-count">${f.items.length}</span></button>`;
    });
    return h + `</div>`;
  }
  const f = folders[S.folder];
  const k = baKind(f?.folder);
  let h = `<div class="oth-view oth-ba" data-view="ba-items" data-kind="${k}"><button type="button" class="oth-ba-crumb" data-ba-back tabindex="-1">${ico("back")}<span>${esc(f?.folder ?? "")}</span></button><div class="oth-ba-items">`;
  (f?.items ?? []).forEach((it, i) => {
    h += `<button type="button" class="oth-ba-item" data-auuid="${esc(it.id)}" data-kind="${k}" style="--i:${Math.min(i, 12)}" tabindex="-1"><img src="${esc(it.img)}" alt="" draggable="false"><span>${esc(it.name)}</span></button>`;
  });
  return h + `</div></div>`;
}

function areaHtml(a) {
  if (!S.tab) return slotsView(a);
  if (S.tab === "notes") return baView();
  return tabView(a, S.tab);
}

/* ------------------------------------------------------------------ показ, скрытие, обновление */
export function ensureSprite() {
  if (!document.getElementById(SPRITE)) document.body.insertAdjacentHTML("afterbegin", SPRITE_SVG);
}
/* Монтаж: паритет с _mountHudSurface. HUD остаётся в body (position: fixed в координатах окна),
   стоит прямо перед корневой веткой хотбара и берёт её z-index, чтобы окна и модули
   с тем же z рисовались поверх HUD и хотбара одинаково. */
function hotbarRootBranch() {
  const hb = F.hotbar();
  if (!hb) return null;
  let el = hb;
  while (el.parentElement && el.parentElement !== document.body) el = el.parentElement;
  return el?.parentElement === document.body ? el : null;
}
function createsStackingContext(el, cs) {
  if (!el || !cs) return false;
  const positioned = cs.position !== "static";
  if (cs.zIndex !== "auto" && (positioned || ["flex", "inline-flex", "grid", "inline-grid"].includes(cs.display))) return true;
  if (Number(cs.opacity) < 1) return true;
  if (cs.transform !== "none" || cs.perspective !== "none" || cs.filter !== "none") return true;
  if (cs.backdropFilter && cs.backdropFilter !== "none") return true;
  if (cs.isolation === "isolate") return true;
  if (cs.mixBlendMode && cs.mixBlendMode !== "normal") return true;
  if (cs.contain?.includes?.("paint") || cs.contain?.includes?.("layout")) return true;
  return false;
}
function hotbarRootStackZ() {
  const hb = F.hotbar();
  if (!hb) return null;
  const chain = [];
  for (let el = hb; el && el !== document.body && el !== document.documentElement; el = el.parentElement) chain.push(el);
  chain.reverse();
  for (const el of chain) {
    const cs = globalThis.getComputedStyle?.(el);
    if (!createsStackingContext(el, cs)) continue;
    const z = cs?.zIndex;
    return z && z !== "auto" && Number.isFinite(Number(z)) ? Number(z) : 0;
  }
  return 0;
}
function mount(el) {
  if (!el) return el;
  const root = hotbarRootBranch();
  if (el.parentElement !== document.body) document.body.insertBefore(el, root ?? null);
  else if (root && el.nextSibling !== root) document.body.insertBefore(el, root);
  const z = hotbarRootStackZ();
  if (z !== null) el.style.zIndex = String(z);
  return el;
}

export function show(actor, { force = false } = {}) {
  if (!F.canView(actor)) return hide();
  ensureSprite();
  applyScheme();
  let hud = hudEl();
  const sameActor = S.a?.id === actor.id && hud && !hud.classList.contains("is-hidden");
  S.a = actor;
  S.dismissed = false;
  if (sameActor && !force) return refresh();

  const wasVisible = !!hud && !hud.classList.contains("is-hidden");
  const switching = wasVisible && hud.dataset.actorId !== actor.id;
  closePopup(); closeMenu(); ttHide();
  if (!hud) {
    hud = document.createElement("div");
    hud.id = OTH;
    hud.className = "oth-surface";
    bindRoot(hud);
  }
  mount(hud);
  clearTimeout(S.leaveT);
  // Сохраняем живой <img> портрета (GIF не перезапускается), если актёр тот же
  const keepImg = !switching && hud.dataset.actorId === actor.id ? hud.querySelector(".oth-pic > img") : null;
  hud.innerHTML = build(actor);
  if (keepImg) hud.querySelector(".oth-pic > img")?.replaceWith(keepImg);
  hud.dataset.actorId = actor.id;
  hud.dataset.scheme = store.get("osx-scheme", "order");
  hud.classList.remove("is-hidden", "is-leaving");
  S.areaSig = "";
  S.prev = null;
  S.word = null;
  if (S.tab === "notes") loadBA();
  renderArea(actor, { instant: true });
  sync(actor, { silent: true });
  pos(hud);
  syncSoundBtn();
  if (force && !switching) return;
  if (!calm()) {
    const cls = switching ? "is-swapping" : "is-entering";
    hud.classList.remove("is-entering", "is-swapping");
    reflow(hud);
    hud.classList.add(cls);
    clearTimeout(S.enterT);
    S.enterT = setTimeout(() => hud.classList.remove(cls), 1100);
  }
  sfx(switching ? "tabLow" : "hudOpen");
}

export function hide({ sound = false } = {}) {
  const hud = hudEl();
  closePopup(); closeMenu(); ttHide();
  if (!hud || hud.classList.contains("is-hidden")) return;
  if (sound) sfx("hudClose");
  if (calm()) { hud.classList.add("is-hidden"); return; }
  hud.classList.add("is-leaving");
  clearTimeout(S.leaveT);
  S.leaveT = setTimeout(() => { hud.classList.add("is-hidden"); hud.classList.remove("is-leaving"); }, 200);
}

export function dismiss() { S.dismissed = true; hide({ sound: true }); }
export const isVisible = () => !!hudEl() && !hudEl().classList.contains("is-hidden") && !hudEl().classList.contains("is-leaving");
export const currentActor = () => S.a;

/* Полная перерисовка (как _ref при смене предметов): структура заново, без повтора входа */
export function rerender() { if (S.a && isVisible()) show(S.a, { force: true }); }

export function refresh() {
  if (!S.a || !hudEl() || hudEl().classList.contains("is-hidden")) return;
  sync(S.a);
}

/* --- точечная синхронизация значений: анимации переживают обновления --- */
function sync(a, { silent = false } = {}) {
  const hud = hudEl();
  if (!hud || !a) return;
  const sys = a.system ?? {};
  const nm = hud.querySelector(".oth-name-text");
  if (nm && nm.textContent !== a.name) nm.textContent = a.name;
  hud.querySelector(".oth-nm")?.classList.toggle("is-long", String(a.name ?? "").length > 22);
  picApply(a);

  for (const row of hud.querySelectorAll("[data-res-row]")) {
    const key = row.dataset.resRow, r = sys[key] ?? {};
    const v = num(r.value), max = num(r.max, key === "Stress" ? 100 : 0);
    const inp = row.querySelector(".oth-inp");
    if (inp && document.activeElement !== inp) { inp.value = String(v); inp.dataset.lastCommitted = String(v); }
    row.querySelector(".oth-ob-max").textContent = String(max);
    setBar(row, max > 0 ? clamp(v / max, 0, 1) : 0, silent);
    const p = max > 0 ? v / max : 0;
    row.classList.toggle("is-warn", key === "Health" ? p <= 0.25 : p >= 0.75);
    row.classList.toggle("is-over", key !== "Health" && p >= 1);
  }
  hud.querySelector(".oth-armor b").textContent = String(F.armor(a));
  hud.querySelector(".oth-speed b").textContent = String(num(sys.Movement?.value) + sumMods(sys.Movement?.modifiers));

  // руки
  const hs = HANDS_STATES[getHands(a)] ?? HANDS_STATES[0];
  const hb = hud.querySelector('[data-act="hands"]');
  if (hb) {
    hb.dataset.tone = hs.tone;
    hb.querySelector(".oth-act-ic use").setAttribute("href", `#oth-i-${hs.ic}`);
    hb.querySelector(".oth-act-v").textContent = hs.label;
    hb.setAttribute("aria-label", `Руки: ${hs.tip}`);
  }
  if (!S.hold) syncActions(a, { fx: !silent });

  // характеристики
  for (const el of hud.querySelectorAll(".oth-sc")) {
    const cd = sys[el.dataset.a] ?? {}, v = num(cd.value), m = sumMods(cd.modifiers);
    el.querySelector("b").textContent = String(v);
    const em = el.querySelector("em");
    em.textContent = m ? fmtMod(m) : "";
    em.className = m > 0 ? "p" : m < 0 ? "n" : "";
  }

  // область: перестраиваем, только если содержимое изменилось (без шторки)
  if (S.tab !== "notes") {
    const html = areaHtml(a);
    if (html !== S.areaSig) renderArea(a, { instant: true, html });
  }
  if (S.popupType) renderPopup(a, S.popupType, { keepFocus: true });

  // тревоги: пульс по краю, пока состояние держится
  const cur = snap(a);
  const port = hud.querySelector(".oth-port");
  port.classList.toggle("is-crit", isCrit(cur));
  port.classList.toggle("is-limit", isLimit(cur));
  port.classList.toggle("is-break", isBreak(cur));
  if (!silent) fxDiff(S.prev, cur);
  S.prev = cur;
}

function syncActions(a, { fx = true } = {}) {
  const hud = hudEl();
  if (!hud) return;
  const st = getStunned(a);
  const pairs = [["mainAction", getMain(a), st === 2 || st === 3], ["bonusAction", getBonus(a), st === 1 || st === 3]];
  for (const [act, on, stunned] of pairs) {
    const btn = hud.querySelector(`[data-act="${act}"]`);
    if (!btn) continue;
    const was = btn.dataset.on;
    const now = on ? "1" : "0";
    btn.dataset.on = now;
    btn.classList.toggle("oth-act-on", on);
    btn.classList.toggle("oth-act-off", !on);
    btn.querySelector(".oth-act-v").textContent = on ? "Готово" : stunned ? "Оглушён" : "Потрачено";
    btn.querySelector(".oth-act-stamp").textContent = stunned && !on ? "Оглушён" : "Потрачено";
    btn.setAttribute("aria-label", `${act === "mainAction" ? "Основное" : "Бонусное"} действие: ${on ? "доступно" : "использовано"}`);
    if (!fx || was === undefined || was === now) continue;
    if (!on) stamp(btn); else tear(btn);
  }
}

function setBar(row, p, silent) {
  const fill = row.querySelector(".oth-bar-fill"), ghost = row.querySelector(".oth-bar-ghost");
  const old = row.dataset.p === undefined ? p : Number(row.dataset.p);
  row.dataset.p = String(p);
  if (silent || p === old) {
    fill.style.transition = ghost.style.transition = "none";
  } else if (calm()) {
    fill.style.transition = ghost.style.transition = "transform 200ms ease";
  } else if (p < old) {
    fill.style.transition = "transform 140ms var(--ease-out)";
    ghost.style.transition = "transform 560ms var(--ease-out) 420ms";
  } else {
    ghost.style.transition = "none";
    fill.style.transition = "transform 640ms var(--ease-out) 60ms";
    row.classList.remove("is-gain"); reflow(row); row.classList.add("is-gain");
  }
  fill.style.transform = `scaleX(${p})`;
  ghost.style.transform = `scaleX(${p})`;
}

function renderArea(a, { dir = 0, instant = false, html = null } = {}) {
  const hud = hudEl();
  const area = hud?.querySelector(".oth-area");
  if (!area) return;
  const out = html ?? areaHtml(a);
  S.areaSig = out;
  area.innerHTML = out;
  area.scrollTop = 0;
  const view = area.firstElementChild;
  if (view && !instant && !calm()) view.classList.add(dir < 0 ? "is-wipe-l" : "is-wipe-r");
  else if (view && !instant) view.classList.add("is-fade");
  const first = area.querySelector(".oth-c, .oth-ba-folder, .oth-ba-crumb, .oth-ba-item");
  if (first) first.tabIndex = 0;
  const tab = TABS.find((t) => t.id === S.tab);
  area.setAttribute("aria-label", tab ? tab.l : "Ячейки");
  syncTabs();
  setWord(tab ? tab.word : HOME_WORD, dir, instant);
}

function syncTabs() {
  const hud = hudEl();
  if (!hud) return;
  const idx = TABS.findIndex((t) => t.id === S.tab);
  hud.querySelectorAll(".oth-tb").forEach((b, i) => {
    const on = i === idx;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  });
  const cur = hud.querySelector(".oth-tab-cursor");
  if (cur) {
    cur.style.setProperty("--y", String(Math.max(0, idx)));
    cur.classList.toggle("is-on", idx >= 0);
  }
}

function setWord(word, dir, instant) {
  const g = hudEl()?.querySelector(".oth-giant");
  if (!g || S.word === word) return;
  S.word = word;
  const old = g.querySelector("span:not(.is-out)");
  const s = document.createElement("span");
  s.textContent = word;
  if (!instant && !calm()) {
    s.className = dir < 0 ? "is-in-l" : "is-in-r";
    if (old) { old.classList.add("is-out", dir < 0 ? "to-r" : "to-l"); setTimeout(() => old.remove(), 520); }
  } else if (old) old.remove();
  g.appendChild(s);
}

function setTab(id) {
  const from = TABS.findIndex((t) => t.id === S.tab);
  // паритет: повторный клик по активной вкладке возвращает к ячейкам;
  // во «Базовых действиях» внутри папки — сначала к папкам
  if (id === "notes" && S.tab === "notes" && S.folder != null) {
    S.folder = null;
    renderArea(S.a, { dir: -1 });
    sfx("tabLow");
    return;
  }
  S.tab = S.tab === id ? null : id;
  const to = TABS.findIndex((t) => t.id === S.tab);
  if (S.tab === "notes") { S.folder = null; loadBA(); }
  renderArea(S.a, { dir: to >= from ? 1 : -1 });
  sfx("tabLow");
}

async function loadBA() {
  // паритет: компендиум перечитывается при каждом открытии вкладки
  S.baLoading = true;
  try {
    const list = await F.baseActions();
    S.ba = list;
  } catch (e) {
    console.warn("Order | TokenHud base actions", e);
    S.ba = [];
  } finally {
    S.baLoading = false;
  }
  if (S.tab === "notes" && isVisible()) renderArea(S.a, { instant: true });
}

/* ------------------------------------------------------------------ позиция (паритет с _pos) */
function hotbarMetrics() {
  const hb = F.hotbar();
  if (!hb) return null;
  const r = hb.getBoundingClientRect();
  const col = hb.querySelector(".collapse") || hb.querySelector("[data-action='hotbar-collapse']") || hb.querySelector(".bar-controls .collapse");
  const pg = hb.querySelector("#hotbar-page-controls") || hb.querySelector(".page-controls") || hb.querySelector(".hotbar-page");
  return {
    l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height,
    colR: col ? col.getBoundingClientRect().left : r.left + 32,
    pgR: pg ? pg.getBoundingClientRect().right : r.right
  };
}
/* v13+: плашка игроков внизу слева — HUD начинается правее неё. Берём самый правый край
   среди видимых элементов списка игроков (свёрнутый #players держит видимую плашку внутри). */
function playersRight() {
  let best = 0;
  try {
    const cand = document.querySelectorAll('#players, #players-active, #players-inactive, #player-list, aside.players, [id^="players"], #players *');
    for (const el of cand) {
      const pr = el.getBoundingClientRect?.();
      if (!pr || pr.width <= 0 || pr.height <= 0) continue;
      if (pr.left > innerWidth / 3) continue;
      if (pr.bottom < innerHeight * 0.6) continue;
      if (pr.right > best) best = pr.right;
    }
  } catch { /* разметка ядра поменялась — HUD у левого края */ }
  return best > 0 ? Math.ceil(best) + 10 : 0;
}
export function pos(hud = hudEl()) {
  const m = hotbarMetrics();
  if (!hud || !m) return;
  const port = hud.querySelector(".oth-port"), upper = hud.querySelector(".oth-upper");
  if (!port || !upper) return;
  const UPPER_H = 170;
  const baseL = playersRight();
  const portW = Math.max(150, Math.min(m.colR - baseL, 330));
  const portL = Math.max(baseL, Math.floor(m.l - portW - 4));
  const uL = portL + portW + 2;
  const uR = Math.min(m.pgR + 4, m.r + 44);
  Object.assign(upper.style, { left: `${uL}px`, bottom: `${innerHeight - m.t + 2}px`, width: `${Math.max(140, uR - uL)}px`, height: `${UPPER_H}px` });
  Object.assign(port.style, { left: `${portL}px`, bottom: `${innerHeight - m.b}px`, width: `${portW}px`, height: `${m.h + 2 + UPPER_H}px` });
}

/* ------------------------------------------------------------------ события (делегирование на корне) */
function bindRoot(hud) {
  hud.addEventListener("click", onClick);
  hud.addEventListener("contextmenu", onContext);
  hud.addEventListener("mousedown", onMouseDown);
  hud.addEventListener("auxclick", (e) => { if (e.button === 1 && e.target.closest("[data-act=mainAction],[data-act=bonusAction]")) e.preventDefault(); });
  hud.addEventListener("keydown", onKey);
  hud.addEventListener("focusin", (e) => { if (e.target.matches(".oth-inp")) e.target.select(); });
  hud.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches(".oth-inp")) return;
    const raw = String(el.value ?? "");
    const sign = raw.startsWith("-") ? "-" : raw.startsWith("+") ? "+" : "";
    el.value = sign + raw.replace(/[^\d]/g, "");
  });
  hud.addEventListener("focusout", (e) => { if (e.target.matches(".oth-inp")) commitInp(e.target); });
  hud.addEventListener("wheel", onWheel, { passive: false });
  hud.addEventListener("pointerdown", onPicDown);
  hud.addEventListener("mousedown", (e) => { if (e.target.closest(".oth-inp")) e.stopPropagation(); });
  hud.addEventListener("dragstart", onDragStart);
  hud.addEventListener("dragover", (e) => { const sl = e.target.closest("[data-sl]"); if (sl) { e.preventDefault(); sl.classList.add("dov"); } });
  hud.addEventListener("dragleave", (e) => { const sl = e.target.closest("[data-sl]"); if (sl && !sl.contains(e.relatedTarget)) sl.classList.remove("dov"); });
  hud.addEventListener("drop", onDrop);
  hud.addEventListener("dragend", () => hud.querySelectorAll(".dov").forEach((x) => x.classList.remove("dov")));
  hud.addEventListener("mouseover", onOver);
  hud.addEventListener("mouseout", (e) => { const t = tipTarget(e.target); if (t && !t.contains(e.relatedTarget)) ttHide(); });
  hud.addEventListener("mousemove", ttMove);
  if (!S.bound) {
    S.bound = true;
    document.addEventListener("keydown", onGlobalKey, true);
    document.addEventListener("visibilitychange", () => hudEl()?.classList.toggle("is-paused", document.hidden));
    addEventListener("resize", () => { pos(); if (S.popupType) placePopup(); });
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(`#${POPUP}, [data-act=mainAction], [data-act=bonusAction]`)) closePopup();
      // меню живёт, пока правят портрет или открыт выбор файла (окно Foundry вне меню)
      if (!e.target.closest(`#${MENU}, .oth-sfx-btn`) && !S.picking && !(S.picEdit && e.target.closest(`#${OTH} .oth-pic`))) closeMenu();
    }, true);
  }
}

async function onClick(e) {
  const a = S.a;
  if (!a) return;
  const t = e.target;
  if (t.closest(".oth-inp")) return;
  let el;
  if ((el = t.closest(".oth-pic"))) { if (S.picEdit) return; F.openSheet(a); sfx("useLow"); return; }
  if ((el = t.closest("[data-act=hands]"))) { e.preventDefault(); sfx("handsLow", 1); bump(el); await setHands(a, (getHands(a) + 1) % 3); return; }
  if ((el = t.closest("[data-act=mainAction]"))) { e.preventDefault(); await setMain(a, !getMain(a)); return; }
  if ((el = t.closest("[data-act=bonusAction]"))) { e.preventDefault(); await setBonus(a, !getBonus(a)); return; }
  if ((el = t.closest(".oth-sc"))) { e.preventDefault(); ttHide(); press(el); sfx("useLow"); roll(a, el.dataset.a); return; }
  if ((el = t.closest(".oth-tb"))) { e.preventDefault(); ttHide(); setTab(el.dataset.t); return; }
  if ((el = t.closest("[data-iid]"))) {
    e.preventDefault();
    const item = a.items.get(el.dataset.iid);
    if (!item) return;
    press(el); sfx("useLow"); ttHide();
    F.useItem(item);
    return;
  }
  if ((el = t.closest("[data-sl]"))) {
    e.preventDefault();
    const sl = getMacros(a)[el.dataset.sl];
    if (!sl?.uuid) return;
    press(el); sfx("useLow");
    F.useUuid(sl.uuid);
    return;
  }
  if ((el = t.closest("[data-ba-back]"))) { S.folder = null; renderArea(a, { dir: -1 }); sfx("tabLow"); return; }
  if ((el = t.closest(".oth-ba-folder"))) { S.folder = Number(el.dataset.afolder); renderArea(a, { dir: 1 }); sfx("tabLow"); return; }
  if ((el = t.closest(".oth-ba-item"))) { press(el); sfx("useLow"); useBaseAction(a, el); return; }
  if ((el = t.closest(".oth-sfx-btn"))) { toggleSound(el); return; }
}

async function onContext(e) {
  e.preventDefault();
  const a = S.a;
  if (!a) return;
  const t = e.target;
  let el;
  if ((el = t.closest("[data-act=hands]"))) { sfx("handsLow", -1); bump(el, -1); await setHands(a, (getHands(a) + 2) % 3); return; }
  if ((el = t.closest("[data-act=mainAction]"))) { sfx("useLow"); F.chat(a, `<p><strong>${esc(a.name)}</strong> — ${getMain(a) ? "есть" : "нет"} Основное действие</p>`); return; }
  if ((el = t.closest("[data-act=bonusAction]"))) { sfx("useLow"); F.chat(a, `<p><strong>${esc(a.name)}</strong> — ${getBonus(a) ? "есть" : "нет"} Бонусное действие</p>`); return; }
  if ((el = t.closest(".oth-sc"))) { ttHide(); press(el); sfx("useLow"); train(a, el.dataset.a); return; }
  if ((el = t.closest("[data-iid]"))) { sfx("moveLow"); F.openSheet(a.items.get(el.dataset.iid)); return; }
  if ((el = t.closest("[data-sl]"))) {
    const ms = getMacros(a);
    if (!ms[el.dataset.sl]) return;
    delete ms[el.dataset.sl];
    sfx("ripLow");
    clearSlotFx(el);
    await a.setFlag("Order", "tokenHudMacros", ms);
    return;
  }
  if ((el = t.closest(".oth-ba-item"))) { sfx("moveLow"); F.openBaseActionSheet(el.dataset.auuid); return; }
  if ((el = t.closest(".oth-sfx-btn"))) { openMenu(el); return; }
}

function onMouseDown(e) {
  if (e.button !== 1) return;
  const btn = e.target.closest("[data-act=mainAction],[data-act=bonusAction]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  togglePopup(btn.dataset.act === "mainAction" ? "main" : "bonus", btn);
}

function onWheel(e) {
  if (S.picEdit && e.target.closest(".oth-pic")) {
    e.preventDefault();
    e.stopPropagation();
    picSet({ zoom: picOf(S.a).zoom * Math.exp(-e.deltaY * 0.0015) });
    return;
  }
  const inp = e.target.closest(".oth-inp");
  if (inp) {
    e.preventDefault();
    e.stopPropagation();
    const base = int(inp.value.replace(/^\+/, "")) ?? int(inp.dataset.lastCommitted) ?? 0;
    inp.value = String(base + (e.deltaY < 0 ? 1 : -1));
    commitInp(inp, { force: true });
    return;
  }
  const area = e.target.closest(".oth-area");
  if (area) { area.scrollTop += e.deltaY; e.preventDefault(); }
}

/* --- ресурсы: «+N»/«-N» — относительно, без знака — абсолютно (паритет с _commitInp) --- */
async function commitInp(inp, { force = false } = {}) {
  const a = S.a, f = inp?.dataset?.f;
  if (!f || !a || inp.dataset.committing === "1") return;
  const key = inp.dataset.res;
  const current = num(a.system?.[key]?.value);
  const raw = String(inp.value ?? "").trim();
  const m = raw.match(/^([+-]?)(\d+)$/);
  if (!m) { inp.value = String(int(inp.dataset.lastCommitted) ?? current); return; }
  const v = Number(m[2]);
  const next = m[1] ? current + (m[1] === "-" ? -v : v) : v;
  inp.value = String(next);
  if (!force && next === current) return;
  inp.dataset.committing = "1";
  try { await a.update({ [f]: next }); } finally { inp.dataset.committing = "0"; }
}

function onDragStart(e) {
  const el = e.target.closest("[data-iid]");
  if (!el) return;
  const item = S.a?.items.get(el.dataset.iid);
  if (!item) return;
  ttHide();
  e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid, img: item.img, name: item.name }));
  e.dataTransfer.effectAllowed = "copy";
  sfx("pickLow");
  hudEl()?.classList.add("is-dragging");
  el.addEventListener("dragend", () => hudEl()?.classList.remove("is-dragging"), { once: true });
}
async function onDrop(e) {
  const el = e.target.closest("[data-sl]");
  if (!el) return;
  e.preventDefault();
  el.classList.remove("dov");
  hudEl()?.classList.remove("is-dragging");
  try {
    const d = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    if (d.type !== "Item" || !d.uuid) return;
    const it = F.fromUuidSync(d.uuid);
    const ms = getMacros(S.a);
    ms[el.dataset.sl] = { uuid: d.uuid, img: it?.img || d.img || "icons/svg/item-bag.svg", name: it?.name || d.name || "" };
    sfx("dropLow");
    const idx = el.dataset.sl;
    await S.a.setFlag("Order", "tokenHudMacros", ms);
    const fresh = hudEl()?.querySelector(`[data-sl="${idx}"]`);
    if (fresh && !calm()) { fresh.classList.add("is-dropped"); setTimeout(() => fresh.classList.remove("is-dropped"), 520); }
  } catch (err) { console.warn("Order | TokenHud drop", err); sfx("errorLow"); }
}

/* --- клавиатура: роверы со стрелками, Enter/Space как ЛКМ, Shift+Enter на ОСН/БОН — список --- */
const ROVERS = [
  { sel: ".oth-tb", keys: ["ArrowUp", "ArrowDown"] },
  { sel: ".oth-sc", keys: ["ArrowLeft", "ArrowRight"] },
  { sel: ".oth-act-btn", keys: ["ArrowUp", "ArrowDown"] },
  { sel: ".oth-area .oth-c, .oth-area .oth-ba-folder, .oth-area .oth-ba-crumb, .oth-area .oth-ba-item", keys: ["ArrowLeft", "ArrowRight"] }
];
function onKey(e) {
  const t = e.target;
  if (t.matches(".oth-inp")) {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitInp(t, { force: true }).then(() => t.blur()); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); t.value = t.dataset.lastCommitted ?? t.value; t.blur(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") e.stopPropagation();
    return;
  }
  if (S.picEdit && t.matches(".oth-pic")) {
    const st = e.shiftKey ? 10 : 2, d = picOf(S.a);
    const mv = { ArrowLeft: [st, 0], ArrowRight: [-st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
    const z = { "+": 1.06, "=": 1.06, "-": 1 / 1.06 }[e.key];
    const own = mv || z || e.key === "Enter" || e.key === " ";
    if (own) { e.preventDefault(); e.stopPropagation(); }
    if (mv) picSet({ x: d.x + mv[0], y: d.y + mv[1] });
    else if (z) picSet({ zoom: d.zoom * z });
    if (own) return;
  }
  if (e.key === "Enter" && e.shiftKey && t.matches("[data-act=mainAction],[data-act=bonusAction]")) {
    e.preventDefault(); e.stopPropagation();
    togglePopup(t.dataset.act === "mainAction" ? "main" : "bonus", t);
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && t.matches("[role=button]:not(button)")) { e.preventDefault(); t.click(); return; }
  for (const r of ROVERS) {
    if (!t.matches(r.sel) || !r.keys.concat(r.keys[0] === "ArrowUp" ? [] : ["ArrowUp", "ArrowDown"]).includes(e.key)) continue;
    const list = [...hudEl().querySelectorAll(r.sel)];
    const i = list.indexOf(t);
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const next = list[(i + (back ? -1 : 1) + list.length) % list.length];
    if (!next) return;
    e.preventDefault(); e.stopPropagation();
    list.forEach((x) => { x.tabIndex = -1; });
    next.tabIndex = 0;
    next.focus();
    sfx("moveLow");
    return;
  }
}
function onGlobalKey(e) {
  if (e.key !== "Escape") return;
  if (e.target?.closest?.(`#${OTH} .oth-inp`)) return;
  if (document.getElementById(MENU)) { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
  if (S.popupType) {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    closePopup();
    hudEl()?.querySelector(`[data-act=${S.lastPopupAct}]`)?.focus();
    return;
  }
  // паритет: Esc прячет HUD до следующего клика по выбранному токену
  if (isVisible()) { e.preventDefault(); e.stopPropagation(); dismiss(); }
}

/* ------------------------------------------------------------------ броски и базовые действия */
function roll(a, attr) { F.roll(a, attr); }
function train(a, attr) { F.roll(a, attr, { training: true }); }

async function useBaseAction(a, el) {
  const f = S.ba?.[S.folder];
  const it = f?.items.find((x) => x.id === el.dataset.auuid);
  if (!it) return;
  const k = baKind(f.folder);
  // паритет: папки основных/бонусных действий переключают флаг, затем бросок или карточка
  if (k === "main") await setMain(a, !getMain(a));
  else if (k === "bonus") await setBonus(a, !getBonus(a));
  await F.useBaseAction(a, it.id);
}

/* ------------------------------------------------------------------ подсказки */
function tipTarget(t) { return t?.closest?.(".oth-sc, [data-tt], [data-act], [data-iid], [data-sl], .oth-ba-folder, .oth-ba-item, .oth-derived-stat, .oth-sfx-btn"); }
function onOver(e) {
  const el = tipTarget(e.target);
  if (!el || el.contains(e.relatedTarget)) return;
  const a = S.a;
  if (!a) return;
  let h = "";
  if (el.matches(".oth-sc")) {
    const c = CHARS.find((x) => x.k === el.dataset.a), cd = a.system?.[el.dataset.a] ?? {};
    const mods = Array.isArray(cd.modifiers) ? cd.modifiers : [];
    const tot = sumMods(mods);
    h = `<div class="oth-tip-t">${esc(c?.l)}</div><div class="oth-tip-r"><span>Значение</span><b>${num(cd.value)}</b></div><div class="oth-tip-r"><span>Мод.</span><b class="${tot > 0 ? "p" : tot < 0 ? "n" : ""}">${fmtMod(tot)}</b></div>`;
    if (mods.length) h += `<hr>` + mods.map((m) => `<div class="oth-tip-m"><span>${esc(m.effectName || "?")}</span><span class="${m.value > 0 ? "p" : "n"}">${fmtMod(num(m.value))}</span></div>`).join("");
    h += kbd(["ЛКМ", "бросок"], ["ПКМ", "тренировка"]);
  } else if (el.matches("[data-act=hands]")) {
    const st = HANDS_STATES[getHands(a)] ?? HANDS_STATES[0];
    h = `<div class="oth-tip-t">Занятые руки</div><div class="oth-tip-r"><span>Текущее</span><b>${st.tip}</b></div>` + kbd(["ЛКМ", "вперёд"], ["ПКМ", "назад"]);
  } else if (el.matches("[data-act=mainAction],[data-act=bonusAction]")) {
    const main = el.dataset.act === "mainAction", on = main ? getMain(a) : getBonus(a);
    h = `<div class="oth-tip-t">${main ? "Основное" : "Бонусное"} действие</div><div class="oth-tip-r"><span>Статус</span><b class="${on ? "ok" : "n"}">${on ? "Доступно" : "Использовано"}</b></div>` + kbd(["ЛКМ", "переключить"], ["СКМ", "список"], ["ПКМ", "в чат"]);
  } else if (el.matches("[data-iid]")) {
    const it = a.items.get(el.dataset.iid);
    if (!it) return;
    h = `<div class="oth-tip-t">${esc(it.name)}</div>`;
    const d = cut(plainText(it.system?.Description ?? it.system?.description ?? ""), 180);
    if (d) h += `<div class="oth-tip-d">${esc(d)}</div>`;
    const c = actionCost(it);
    if (c) h += `<div class="oth-tip-r"><span>Действие</span><b>${esc(c)}</b></div>`;
    h += kbd(["ЛКМ", "использовать"], ["ПКМ", "лист"], ["Тянуть", "в ячейку"]);
  } else if (el.matches("[data-sl]")) {
    const sl = getMacros(a)[el.dataset.sl];
    h = sl ? `<div class="oth-tip-t">${esc(sl.name || "Ячейка")}</div>` + kbd(["ЛКМ", "использовать"], ["ПКМ", "очистить"]) : `<div class="oth-tip-t">Пустая ячейка ${(Number(el.dataset.sl) + 1) % 10}</div><div class="oth-tip-d">Перетащите сюда предмет, навык или заклинание из вкладок.</div>`;
  } else if (el.matches(".oth-ba-folder")) {
    const f = S.ba?.[Number(el.dataset.afolder)];
    h = `<div class="oth-tip-t">${esc(f?.folder)}</div><div class="oth-tip-r"><span>Действий</span><b>${f?.items.length ?? 0}</b></div>`;
  } else if (el.matches(".oth-ba-item")) {
    const f = S.ba?.[S.folder], it = f?.items.find((x) => x.id === el.dataset.auuid);
    if (!it) return;
    h = `<div class="oth-tip-t">${esc(it.name)}</div>${it.desc ? `<div class="oth-tip-d">${esc(cut(it.desc, 200))}</div>` : ""}` + kbd(["ЛКМ", BA_KIND[baKind(f.folder)].hint], ["ПКМ", "лист"]);
  } else if (el.matches(".oth-derived-stat")) {
    h = el.dataset.tip === "armor" ? `<div class="oth-tip-t">Броня</div><div class="oth-tip-d">Надетая броня и защитные баффы.</div>` : `<div class="oth-tip-t">Скорость</div><div class="oth-tip-d">Перемещение с модификаторами, клеток за ход.</div>`;
  } else if (el.matches(".oth-sfx-btn")) {
    h = `<div class="oth-tip-t">Звук HUD</div><div class="oth-tip-r"><span>Сейчас</span><b>${OrderSfx.enabled ? "включён" : "выключен"}</b></div>` + kbd(["ЛКМ", "вкл/выкл"], ["ПКМ", "настройки"]);
  } else if (el.matches("[data-tt]")) {
    h = `<div class="oth-tip-t">${esc(el.dataset.tt)}</div>`;
  }
  if (h) ttShow(e, h);
}
function ttEl() {
  let t = document.getElementById(TT);
  if (t) return t;
  t = document.createElement("div");
  t.id = TT;
  t.className = "oth-surface oth-tip";
  t.setAttribute("role", "tooltip");
  document.body.appendChild(t);
  return t;
}
function ttShow(e, html) {
  const t = ttEl();
  t.innerHTML = html;
  t.classList.remove("v"); reflow(t); t.classList.add("v");
  ttMove(e);
}
function ttMove(e) {
  const t = document.getElementById(TT);
  if (!t?.classList.contains("v")) return;
  let x = e.clientX + 14, y = e.clientY - t.offsetHeight - 12;
  if (x + t.offsetWidth > innerWidth - 6) x = e.clientX - t.offsetWidth - 14;
  if (y < 4) y = e.clientY + 18;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function ttHide() { document.getElementById(TT)?.classList.remove("v"); }

/* ------------------------------------------------------------------ окно действий (СКМ на ОСН/БОН) */
function togglePopup(type, anchor) {
  if (S.popupType === type) { closePopup(); sfx("hudClose"); return; }
  closePopup();
  ttHide();
  S.popupType = type;
  S.lastPopupAct = anchor.dataset.act;
  renderPopup(S.a, type);
  sfx("popupLow");
  const first = document.querySelector(`#${POPUP} .oth-action-option`);
  if (first && anchor.matches(":focus-visible")) first.focus();
}
function renderPopup(a, type, { keepFocus = false } = {}) {
  let p = document.getElementById(POPUP);
  const fresh = !p;
  const focusIdx = keepFocus && p ? [...p.querySelectorAll(".oth-action-option")].indexOf(document.activeElement) : -1;
  if (!p) {
    p = document.createElement("section");
    p.id = POPUP;
    p.setAttribute("role", "dialog");
    document.body.appendChild(p);
    p.addEventListener("click", onPopupClick);
    p.addEventListener("contextmenu", onPopupContext);
    p.addEventListener("keydown", onPopupKey);
  }
  p.className = `oth-surface oth-action-popup oth-action-popup-${type}${fresh && !calm() ? " is-in" : ""}`;
  p.dataset.scheme = store.get("osx-scheme", "order");
  p.dataset.actionType = type;
  const title = type === "main" ? "Основные действия" : "Бонусные действия";
  p.setAttribute("aria-label", title);
  const count = (type === "main" ? getMain(a) : getBonus(a)) ? 1 : 0;
  const rows = popupItems(a, type);
  let h = `<header class="oth-action-popup-head"><span class="oth-action-popup-ic">${ico(type === "main" ? "act-main" : "act-bonus")}</span><div class="oth-action-popup-title">${title}</div><div class="oth-action-popup-count${count ? "" : " oth-action-popup-count-off"}">${type === "main" ? "Основное" : "Бонусное"} <b>${count}</b></div><button type="button" class="oth-action-popup-close" aria-label="Закрыть">${ico("x")}</button></header>`;
  h += `<div class="oth-action-popup-list" role="listbox" aria-label="${title}">`;
  if (!rows.length) h += `<div class="oth-action-popup-empty">${ico("layers")}<span>Нет способностей или заклинаний с этой стоимостью действия.</span></div>`;
  rows.forEach(({ item, cost }, i) => {
    const st = actionItemStatus(a, item, type, cost);
    const desc = cut(plainText(item.system?.Description ?? item.system?.description ?? ""));
    h += `<article class="oth-action-option is-${st.key}" data-action-item-id="${esc(item.id)}" role="option" tabindex="${i ? -1 : 0}" style="--i:${i}">`;
    h += `<img class="oth-action-option-img" src="${esc(item.img || "icons/svg/item-bag.svg")}" alt="">`;
    h += `<div class="oth-action-option-body"><div class="oth-action-option-head"><strong>${esc(item.name || "Без названия")}</strong><span class="oth-action-status oth-action-status-${st.key}">${esc(st.label)}</span></div>`;
    if (desc) h += `<div class="oth-action-option-desc">${esc(desc)}</div>`;
    if (!simpleActionCost(cost, type)) h += `<div class="oth-action-option-cost"><span>Стоимость</span><b>${esc(cost)}</b></div>`;
    h += `</div><div class="oth-action-option-state oth-action-option-state-${st.key}" title="${item.type === "Spell" ? "Заклинание" : "Способность"}">${ico(st.ic)}</div></article>`;
  });
  h += `</div><footer class="oth-action-popup-foot">${kbd(["ЛКМ", "использовать"], ["ПКМ", "лист"], ["Esc", "закрыть"]).replace("oth-tip-h", "oth-action-popup-keys")}</footer>`;
  p.innerHTML = h;
  placePopup();
  if (focusIdx >= 0) p.querySelectorAll(".oth-action-option")[focusIdx]?.focus();
}
function placePopup() {
  const p = document.getElementById(POPUP);
  const anchor = hudEl()?.querySelector(`[data-act=${S.lastPopupAct}]`);
  if (!p || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight;
  const left = clamp(r.left + r.width / 2 - 70, 8, innerWidth - w - 8);
  let top = r.top - h - 12;
  const below = top < 8;
  if (below) top = r.bottom + 12;
  p.classList.toggle("oth-action-popup-below", below);
  p.style.left = `${Math.round(left)}px`;
  p.style.top = `${Math.round(top)}px`;
  p.style.setProperty("--oth-action-arrow-x", `${Math.round(clamp(r.left + r.width / 2 - left, 18, w - 18))}px`);
}
function closePopup() {
  document.getElementById(POPUP)?.remove();
  S.popupType = null;
}
async function onPopupClick(e) {
  if (e.target.closest(".oth-action-popup-close")) { e.preventDefault(); closePopup(); sfx("hudClose"); return; }
  const row = e.target.closest(".oth-action-option");
  if (!row) return;
  const a = S.a, type = S.popupType, item = a?.items.get(row.dataset.actionItemId);
  if (!item) return;
  // паритет: использовать предмет и потратить действие
  closePopup();
  sfx("useLow");
  const used = await F.useItem(item);
  if (!used) return;
  if (type === "main") await setMain(a, false); else await setBonus(a, false);
}
function onPopupContext(e) {
  e.preventDefault();
  const row = e.target.closest(".oth-action-option");
  if (row) F.openSheet(S.a?.items.get(row.dataset.actionItemId));
}
function onPopupKey(e) {
  const rows = [...e.currentTarget.querySelectorAll(".oth-action-option")];
  const i = rows.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); e.stopPropagation();
    const n = rows[(i + (e.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length];
    rows.forEach((r) => { r.tabIndex = -1; });
    if (n) { n.tabIndex = 0; n.focus(); sfx("moveLow"); }
  } else if ((e.key === "Enter" || e.key === " ") && i >= 0) {
    e.preventDefault(); rows[i].click();
  }
}

/* ------------------------------------------------------------------ звук и настройки */
function toggleSound(btn) {
  const on = !OrderSfx.enabled;
  OrderSfx.setEnabled(on);
  if (on) sfx("muteOff");
  syncSoundBtn();
  bump(btn);
  ttHide();
}
function syncSoundBtn() {
  const b = hudEl()?.querySelector(".oth-sfx-btn");
  if (!b) return;
  b.classList.toggle("is-muted", !OrderSfx.enabled);
  b.querySelector("use")?.setAttribute("href", `#oth-i-${OrderSfx.enabled ? "sound" : "mute"}`);
  b.setAttribute("aria-label", `Звук HUD: ${OrderSfx.enabled ? "включён" : "выключен"}`);
}
function openMenu(anchor) {
  closeMenu();
  ttHide();
  const m = document.createElement("div");
  m.id = MENU;
  m.className = `oth-surface oth-menu${calm() ? "" : " is-in"}`;
  m.dataset.scheme = store.get("osx-scheme", "order");
  m.setAttribute("role", "menu");
  m.setAttribute("aria-label", "Настройки HUD");
  const scheme = store.get("osx-scheme", "order");
  m.innerHTML = `
    <button type="button" class="oth-menu-row" role="menuitemcheckbox" data-set="sound" aria-checked="${OrderSfx.enabled}"><span>Звук</span><i class="oth-sw" aria-hidden="true"></i></button>
    <label class="oth-menu-row oth-menu-vol"><span>Громкость</span><input type="range" min="0" max="1" step="0.05" value="${OrderSfx.volume}" data-set="volume" aria-label="Громкость звуков интерфейса"></label>
    <button type="button" class="oth-menu-row" role="menuitemcheckbox" data-set="motion" aria-checked="${!document.body.classList.contains("order-no-animations")}"><span>Анимации</span><i class="oth-sw" aria-hidden="true"></i></button>
    <div class="oth-menu-row oth-menu-scheme" role="radiogroup" aria-label="Цветовая схема">
      <button type="button" role="radio" data-scheme="order" aria-checked="${scheme === "order"}"><i style="--sw:${ORDER_RED}"></i>Орден</button>
      <button type="button" role="radio" data-scheme="player" aria-checked="${scheme === "player"}"><i style="--sw:${esc(F.playerColor())}"></i>Мой цвет</button>
    </div>
    <p class="oth-menu-note">Общие с листом бойца</p>${picMenuHtml()}`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.round(clamp(r.right - m.offsetWidth, 8, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.round(Math.max(8, r.top - m.offsetHeight - 10))}px`;
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-set], [data-scheme], [data-pic]");
    if (!b) return;
    if (b.dataset.pic) { onPicMenu(b); return; }
    if (b.dataset.set === "sound") { OrderSfx.setEnabled(!OrderSfx.enabled); if (OrderSfx.enabled) sfx("muteOff"); b.setAttribute("aria-checked", String(OrderSfx.enabled)); syncSoundBtn(); }
    else if (b.dataset.set === "motion") {
      const on = document.body.classList.contains("order-no-animations");
      F.setAnimations(on);
      b.setAttribute("aria-checked", String(on));
      sfx("moveLow");
    } else if (b.dataset.scheme) {
      store.set("osx-scheme", b.dataset.scheme);
      m.querySelectorAll("[data-scheme]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      applyScheme();
      sfx("tabLow");
    }
  });
  m.addEventListener("input", (e) => {
    if (e.target.dataset.set === "volume") OrderSfx.setVolume(e.target.value);
    else if (e.target.dataset.pic === "zoom") picSet({ zoom: Number(e.target.value) });
  });
  m.addEventListener("change", (e) => { if (e.target.dataset.set === "volume") sfx("useLow"); });
  m.addEventListener("contextmenu", (e) => e.preventDefault());
  m.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(true); } });
  sfx("popupLow");
  m.querySelector("button")?.focus({ preventScroll: true });
}
function closeMenu(refocus = false) {
  const m = document.getElementById(MENU);
  if (!m) return;
  m.remove();
  picEditSet(false);
  picFlush();
  if (refocus) hudEl()?.querySelector(".oth-sfx-btn")?.focus();
}

/* ------------------------------------------------------------------ портрет HUD: своя картинка и кадр
   Флаг актёра Order.tokenHudPortrait = { src, x, y, zoom }. src "" — картинка из листа.
   x/y — точка кадра в процентах (object-position и transform-origin), zoom — масштаб 1…3.
   Флаг общий для владельца и мастера; картинка листа не меняется. */
const PIC_DEF = { src: "", x: 50, y: 14, zoom: 1 };
const PIC_ZOOM_MIN = 1, PIC_ZOOM_MAX = 3;
function picNorm(d) {
  return {
    src: typeof d?.src === "string" ? d.src.trim() : "",
    x: clamp(num(d?.x, PIC_DEF.x), 0, 100),
    y: clamp(num(d?.y, PIC_DEF.y), 0, 100),
    zoom: clamp(num(d?.zoom, PIC_DEF.zoom), PIC_ZOOM_MIN, PIC_ZOOM_MAX)
  };
}
const picRead = (a) => picNorm(F.portrait(a) ?? {});
const picOf = (a) => (S.pic && S.pic.a === a ? S.pic.d : picRead(a));
const picSrc = (a, d = picOf(a)) => d.src || a?.img || "icons/svg/mystery-man.svg";
const picVars = (d) => `--pic-x:${d.x}%;--pic-y:${d.y}%;--pic-zoom:${d.zoom}`;
function picApply(a = S.a) {
  const pic = hudEl()?.querySelector(".oth-pic");
  if (!pic || !a) return;
  const d = picOf(a);
  pic.style.setProperty("--pic-x", `${d.x}%`);
  pic.style.setProperty("--pic-y", `${d.y}%`);
  pic.style.setProperty("--pic-zoom", String(d.zoom));
  const img = pic.querySelector("img"), src = picSrc(a, d);
  if (img && img.getAttribute("src") !== src) img.src = src;
}
/* правка: живое значение в S.pic, запись во флаг с задержкой */
function picSet(patch, { save = true, now = false } = {}) {
  const a = S.a;
  if (!a || !F.canEditPortrait(a)) return;
  if (!S.pic || S.pic.a !== a) S.pic = { a, d: picRead(a) };
  S.pic.d = picNorm({ ...S.pic.d, ...patch });
  picApply(a);
  syncPicMenu();
  if (save) picSave(now);
}
function picSave(now = false) {
  clearTimeout(S.picSaveT);
  const p = S.pic;
  if (!p) return Promise.resolve();
  const run = async () => {
    const d = p.d;
    const isDef = !d.src && Math.abs(d.x - PIC_DEF.x) < 0.05 && Math.abs(d.y - PIC_DEF.y) < 0.05 && d.zoom === PIC_DEF.zoom;
    try { await F.setPortrait(p.a, isDef ? null : { src: d.src, x: +d.x.toFixed(1), y: +d.y.toFixed(1), zoom: +d.zoom.toFixed(2) }); }
    catch (err) { console.warn("Order | TokenHud portrait", err); sfx("errorLow"); }
  };
  if (now) return run();
  S.picSaveT = setTimeout(run, 400);
  return Promise.resolve();
}
/* закрытие меню: дописать флаг и отпустить живое значение, когда запись дошла */
function picFlush() {
  const p = S.pic;
  if (!p) return;
  picSave(true).finally(() => { if (S.pic === p) S.pic = null; });
}
function picEditSet(on) {
  const want = !!on && !!S.a && F.canEditPortrait(S.a);
  if (S.picEdit === want) return;
  S.picEdit = want;
  const hud = hudEl();
  hud?.classList.toggle("is-pic-edit", want);
  const pic = hud?.querySelector(".oth-pic");
  pic?.setAttribute("aria-label", want ? "Портрет: тяните мышью или стрелками, колесо или плюс и минус — масштаб" : `Открыть лист: ${S.a?.name ?? ""}`);
  document.getElementById(MENU)?.querySelector('[data-pic="edit"]')?.setAttribute("aria-checked", String(want));
}
function picRange(pic, img, zoom) {
  const bw = pic.clientWidth, bh = pic.clientHeight;
  const ar = img?.naturalWidth && img?.naturalHeight ? img.naturalWidth / img.naturalHeight : bw / Math.max(1, bh);
  const w = Math.max(bw, bh * ar), h = Math.max(bh, bw / ar);
  return { x: zoom * w - bw, y: zoom * h - bh };
}
function onPicDown(e) {
  if (!S.picEdit || e.button !== 0) return;
  const pic = e.target.closest(".oth-pic");
  if (!pic) return;
  e.preventDefault();
  const d = picOf(S.a);
  const st = { cx: e.clientX, cy: e.clientY, x: d.x, y: d.y, r: picRange(pic, pic.querySelector("img"), d.zoom) };
  try { pic.setPointerCapture(e.pointerId); } catch { /* */ }
  pic.classList.add("is-grab");
  sfx("pickLow");
  const move = (ev) => {
    const dx = ev.clientX - st.cx, dy = ev.clientY - st.cy;
    picSet({ x: st.r.x > 0 ? st.x - (dx / st.r.x) * 100 : st.x, y: st.r.y > 0 ? st.y - (dy / st.r.y) * 100 : st.y }, { save: false });
  };
  const up = () => {
    pic.removeEventListener("pointermove", move);
    pic.removeEventListener("pointerup", up);
    pic.removeEventListener("pointercancel", up);
    pic.classList.remove("is-grab");
    picSave(true);
    sfx("dropLow");
  };
  pic.addEventListener("pointermove", move);
  pic.addEventListener("pointerup", up);
  pic.addEventListener("pointercancel", up);
}
function picMenuHtml() {
  const a = S.a;
  if (!a || !F.canEditPortrait(a)) return "";
  const d = picOf(a);
  return `
    <div class="oth-menu-sep" role="separator"></div>
    <div class="oth-menu-head"><span>Портрет HUD</span><em data-pic-state>${d.src ? "свой файл" : "из листа"}</em></div>
    <div class="oth-menu-row oth-menu-pair">
      <button type="button" data-pic="pick">${ico("image")}Файл…</button>
      <button type="button" data-pic="sheet"${d.src ? "" : " disabled"}>Из листа</button>
    </div>
    <button type="button" class="oth-menu-row" role="menuitemcheckbox" data-pic="edit" aria-checked="${S.picEdit}"><span>Двигать портрет</span><i class="oth-sw" aria-hidden="true"></i></button>
    <label class="oth-menu-row oth-menu-vol"><span>Масштаб</span><input type="range" min="${PIC_ZOOM_MIN}" max="${PIC_ZOOM_MAX}" step="0.01" value="${d.zoom}" data-pic="zoom" aria-label="Масштаб портрета"></label>
    <button type="button" class="oth-menu-row oth-menu-reset" data-pic="reset"><span>Сбросить кадр</span>${ico("back")}</button>`;
}
function syncPicMenu() {
  const m = document.getElementById(MENU);
  if (!m || !S.a) return;
  const d = picOf(S.a);
  const st = m.querySelector("[data-pic-state]");
  if (st) st.textContent = d.src ? "свой файл" : "из листа";
  const sh = m.querySelector('[data-pic="sheet"]');
  if (sh) sh.disabled = !d.src;
  const z = m.querySelector('[data-pic="zoom"]');
  if (z && document.activeElement !== z) z.value = String(d.zoom);
}
async function onPicMenu(b) {
  const a = S.a;
  if (!a) return;
  const k = b.dataset.pic;
  if (k === "edit") { picEditSet(!S.picEdit); sfx("moveLow"); if (S.picEdit) hudEl()?.querySelector(".oth-pic")?.focus({ preventScroll: true }); return; }
  if (k === "reset") { picSet({ x: PIC_DEF.x, y: PIC_DEF.y, zoom: PIC_DEF.zoom }, { now: true }); sfx("tabLow"); return; }
  if (k === "sheet") { picSet({ ...PIC_DEF }, { now: true }); sfx("ripLow"); return; }
  if (k === "pick") {
    S.picking = true;
    sfx("popupLow");
    let src = null;
    try { src = await F.pickImage(picOf(a).src || a.img); } finally { S.picking = false; }
    if (!src || S.a !== a) return;
    picSet({ ...PIC_DEF, src }, { now: true });
    picEditSet(true);
    sfx("dropLow");
  }
}

/* ------------------------------------------------------------------ FX: разница состояний */
const snap = (a) => {
  const s = a?.system ?? {};
  return { id: a?.id, hp: num(s.Health?.value), hpMax: num(s.Health?.max), mf: num(s.ManaFatigue?.value), mfMax: num(s.ManaFatigue?.max), st: num(s.Stress?.value), stMax: num(s.Stress?.max, 100) };
};
const isCrit = (s) => s.hpMax > 0 && s.hp <= s.hpMax * 0.25;
const isLimit = (s) => s.mfMax > 0 && s.mf >= s.mfMax;
const isBreak = (s) => s.stMax > 0 && s.st >= s.stMax;

function fxDiff(p, c) {
  if (!p || p.id !== c.id) return;
  const dh = c.hp - p.hp;
  if (dh < 0) hit(-dh, c);
  else if (dh > 0) heal(dh);
  const dm = c.mf - p.mf;
  if (dm > 0) { float(`+${dm}`, "mana", "МУ"); sfx("fatigueUp"); }
  else if (dm < 0) { float(`−${-dm}`, "mana-down", "МУ"); sfx("fatigueDown"); }
  const ds = c.st - p.st;
  if (ds > 0) { float(`+${ds}`, "stress", "Стресс"); sfx("stress"); }
  else if (ds < 0) float(`−${-ds}`, "stress-down", "Стресс");
  if (isCrit(c) && !isCrit(p)) alert("crit", c);
  if (isLimit(c) && !isLimit(p)) alert("limit", c);
  if (isBreak(c) && !isBreak(p)) alert("break", c);
}

function hit(amount, c) {
  const port = hudEl()?.querySelector(".oth-port");
  if (!port) return;
  const r = amount / Math.max(1, c.hpMax);
  const tier = r >= 0.25 ? 3 : r >= 0.1 ? 2 : 1;
  sfx("damage", tier);
  if (calm()) { float(`−${amount}`, "dmg", null, tier); return; }
  const stop = [0, 30, 70, 120][tier];       // hit-stop: кадр удара держится по силе удара
  port.dataset.tier = String(tier);
  port.classList.remove("is-hit"); reflow(port); port.classList.add("is-hit");
  setTimeout(() => {
    float(`−${amount}`, "dmg", null, tier);
    addTrauma(S.shake, port, [0, 0.34, 0.58, 0.95][tier]);
    if (tier === 3) addTrauma(S.deckShake, hudEl()?.querySelector(".oth-upper"), 0.38);
  }, stop);
  setTimeout(() => port.classList.remove("is-hit"), stop + 420);
}
function heal(amount) {
  const port = hudEl()?.querySelector(".oth-port");
  sfx("heal");
  float(`+${amount}`, "heal");
  if (!port || calm()) return;
  port.classList.remove("is-heal"); reflow(port); port.classList.add("is-heal");
  setTimeout(() => port.classList.remove("is-heal"), 900);
}
function float(text, kind, unit = null, tier = 1) {
  const fx = hudEl()?.querySelector(".oth-fx");
  if (!fx) return;
  const n = S.floatN++ % 4;
  const el = document.createElement("span");
  el.className = `oth-float is-${kind}`;
  el.dataset.tier = String(tier);
  el.style.setProperty("--fx", `${(n % 2 ? 1 : -1) * (6 + n * 7)}%`);
  el.style.setProperty("--fy", `${-n * 16}px`);
  el.innerHTML = `<b>${esc(text)}</b>${unit ? `<small>${esc(unit)}</small>` : ""}`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), calm() ? 1300 : 1500);
}

/* --- тряска по травме: смещение ∝ trauma², затухает, сумма синусов --- */
function addTrauma(state, el, amount) {
  if (!el || calm()) return;
  state.el = el;
  state.trauma = Math.min(1, state.trauma + amount);
  if (!state.raf) { state.last = 0; state.raf = requestAnimationFrame((t) => shakeTick(state, t)); }
}
function shakeTick(state, now) {
  const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0.016;
  state.last = now;
  state.t += dt;
  state.trauma = Math.max(0, state.trauma - 1.5 * dt);
  const s = state.trauma * state.trauma, t = state.t;
  const x = 12 * s * (Math.sin(t * 43) + 0.5 * Math.sin(t * 97 + 1.3));
  const y = 8 * s * (Math.sin(t * 37 + 2.1) + 0.5 * Math.sin(t * 83 + 0.4));
  const r = 1.4 * s * Math.sin(t * 29 + 0.7);
  const el = state.el;
  if (el) { el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`; el.style.rotate = `${r.toFixed(3)}deg`; }
  if (state.trauma > 0) state.raf = requestAnimationFrame((tt) => shakeTick(state, tt));
  else { state.raf = 0; if (el) { el.style.translate = ""; el.style.rotate = ""; } }
}

/* --- тревоги: плашка на тёмной подложке над портретом, по очереди --- */
const ALERTS = {
  crit: { title: "Критическое", line: (c) => `ХП ${c.hp} / ${c.hpMax}`, sound: "alertCrit", ic: "heart" },
  limit: { title: "Предел МУ", line: (c) => `Маг. усталость ${c.mf} / ${c.mfMax}`, sound: "alertFatigue", ic: "drop" },
  break: { title: "Срыв", line: (c) => `Стресс ${c.st} / ${c.stMax}`, sound: "alertBreak", ic: "pulse" }
};
function alert(kind, c) {
  S.alertQ.push({ kind, c });
  if (!S.alertBusy) nextAlert();
}
function nextAlert() {
  const next = S.alertQ.shift();
  const host = hudEl()?.querySelector(".oth-alerts");
  if (!next || !host) { S.alertBusy = false; return; }
  S.alertBusy = true;
  const A = ALERTS[next.kind];
  sfx(A.sound);
  const el = document.createElement("div");
  el.className = "oth-alert";
  el.dataset.kind = next.kind;
  el.innerHTML = `<span class="oth-alert-band" aria-hidden="true"></span><span class="oth-alert-ic">${ico(A.ic)}</span><b class="oth-alert-t">${A.title}</b><span class="oth-alert-s">${esc(A.line(next.c))}</span>`;
  host.appendChild(el);
  if (next.kind === "break" && !calm()) {
    const pic = hudEl()?.querySelector(".oth-pic");
    pic?.classList.remove("is-glitch"); reflow(pic); pic?.classList.add("is-glitch");
    setTimeout(() => pic?.classList.remove("is-glitch"), 700);
  }
  if (next.kind === "crit") addTrauma(S.shake, hudEl()?.querySelector(".oth-port"), 0.3);
  setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => { el.remove(); nextAlert(); }, calm() ? 120 : 260);
  }, 2600);
}

/* --- печать на ОСН/БОН: удар штемпеля и отрыв --- */
function stamp(btn) {
  sfx("stampLow");
  if (calm()) return;
  btn.classList.remove("is-stamp", "is-charge"); reflow(btn); btn.classList.add("is-stamp");
  addTrauma(S.deckShake, hudEl()?.querySelector(".oth-upper"), 0.16);
  setTimeout(() => btn.classList.remove("is-stamp"), 600);
}
function tear(btn) {
  sfx("ripLow");
  if (calm()) return;
  const txt = btn.querySelector(".oth-act-stamp")?.textContent ?? "Потрачено";
  for (const side of ["l", "r"]) {
    const s = document.createElement("span");
    s.className = `oth-act-tear is-${side}`;
    s.textContent = txt;
    s.setAttribute("aria-hidden", "true");
    btn.appendChild(s);
    setTimeout(() => s.remove(), 620);
  }
}
function clearSlotFx(el) {
  if (calm()) return;
  const img = el.querySelector("img");
  if (!img) return;
  const ghost = img.cloneNode();
  ghost.className = "oth-slot-tear";
  el.appendChild(ghost);
}
function press(el) {
  if (calm()) return;
  el.classList.remove("is-press"); reflow(el); el.classList.add("is-press");
  setTimeout(() => el.classList.remove("is-press"), 260);
}
function bump(el, dir = 1) {
  if (calm()) return;
  el.style.setProperty("--bump", dir > 0 ? "1" : "-1");
  el.classList.remove("is-bump"); reflow(el); el.classList.add("is-bump");
  setTimeout(() => el.classList.remove("is-bump"), 360);
}

/* --- «Ваш ход»: врезка-полоса, затем заряд ОСН/БОН --- */
export async function turnStart(actor, { round = 1, reset = true, cutin = true } = {}) {
  if (!actor) return;
  const mine = S.a?.id === actor.id;
  if (mine) S.hold = true;
  try {
    if (reset) await applyStunnedActionReminder(actor, { newTurn: true });
    if (cutin) await cutIn(actor, round);
  } finally {
    if (mine) S.hold = false;
  }
  if (S.a?.id !== actor.id || !isVisible()) return;
  const acts = hudEl()?.querySelector(".oth-actions");
  sfx("charge");
  if (acts && !calm()) {
    acts.classList.remove("is-charge"); reflow(acts); acts.classList.add("is-charge");
    setTimeout(() => acts.classList.remove("is-charge"), 900);
  }
  setTimeout(() => syncActions(actor, { fx: true }), calm() ? 0 : 260);
}
function cutIn(actor, round) {
  return new Promise((resolve) => {
    document.getElementById(CUTIN)?.remove();
    const el = document.createElement("div");
    el.id = CUTIN;
    el.className = `oth-surface oth-cutin${calm() ? " is-calm" : ""}`;
    el.dataset.scheme = store.get("osx-scheme", "order");
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="oth-cutin-band"></div><div class="oth-cutin-stripe"></div><div class="oth-cutin-lines" aria-hidden="true">${"<i></i>".repeat(9)}</div>
      <div class="oth-cutin-art"><img src="${esc(picSrc(actor, picRead(actor)))}" alt=""></div>
      <div class="oth-cutin-text"><b class="oth-cutin-title">Ваш ход</b><div class="oth-cutin-sub"><span class="oth-cutin-name">${esc(actor.name)}</span><span class="oth-cutin-round">Раунд ${round}</span></div></div>`;
    document.body.appendChild(el);
    sfx("turnStart");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add("is-out");
      setTimeout(() => { el.remove(); resolve(); }, calm() ? 200 : 280);
    };
    el.addEventListener("click", finish);
    setTimeout(finish, calm() ? 1400 : 1750);
  });
}

/* ============================================================================
   Foundry: выбор токена, документы, бой, хотбар, радиальный HUD токена.
   Паритет с Hooks.once("ready") старого OrderTokenHud.js.
   ============================================================================ */
const HOTBAR_COMPACT_CLASS = "order-hotbar-sidebar-compact";
const Token = foundry.canvas?.placeables?.Token ?? globalThis.Token;
const C = { tok: null, releaseT: 0, sidebarRaf: 0, tokenHudFor: null, tokenHudT: 0 };

const sameActor = (doc) => !!doc && !!S.a && doc.documentName === "Actor" && doc.id === S.a.id;
const ownerOrGM = (a) => !!a && (!!game.user?.isGM || !!a.isOwner);
const hoverToken = () => {
  try { return canvas?.tokens?.hover || canvas?.tokens?._hover || canvas?.tokens?.placeables?.find((t) => t?.hover) || null; } catch { return null; }
};
/* актёр токена без связи пересоздаётся ядром — держим ссылку свежей */
function freshen() {
  const a = C.tok?.actor;
  if (a && a.id === S.a?.id && a !== S.a) S.a = a;
}
function showFor(tok) {
  if (!tok?.actor || !F.hudEnabled()) { C.tok = null; hide(); return; }
  C.tok = tok;
  show(tok.actor);
}
/* паритет с _maybeRestoreHud: клик по выбранному токену возвращает HUD после Esc */
function restoreHud(tok) {
  if (tok?.actor && tok.controlled && (!isVisible() || S.dismissed)) showFor(tok);
}

/* Хотбар: вкладки сайдбара шире чата — компактный хотбар (ячейки 9 и 0 только скрыты) */
function syncHotbarSidebarState() {
  const sidebar = globalThis.ui?.sidebar;
  const activeTab = sidebar?.tabGroups?.primary || (globalThis.ui?.chat?.active ? "chat" : null);
  const compact = Boolean(sidebar?.expanded && activeTab && activeTab !== "chat");
  document.body?.classList.toggle(HOTBAR_COMPACT_CLASS, compact);
  if (C.sidebarRaf) cancelAnimationFrame(C.sidebarRaf);
  C.sidebarRaf = requestAnimationFrame(() => {
    C.sidebarRaf = 0;
    pos();
    if (S.popupType) placePopup();
  });
}
function dressHotbar() {
  const hb = F.hotbar();
  if (!hb) return;
  hb.classList.add("oth-surface");
  hb.dataset.scheme = store.get("osx-scheme", "order");
}

/* Радиальный HUD токена: те же токены цвета и каскад кнопок при открытии */
function dressTokenHud(app, html) {
  const root = document.getElementById("token-hud") ?? (html instanceof HTMLElement ? html : html?.[0]) ?? app?.element;
  if (!(root instanceof HTMLElement)) return;
  root.classList.add("oth-surface");
  root.dataset.scheme = store.get("osx-scheme", "order");
  const forId = app?.object?.id ?? app?.document?.id ?? null;
  const opening = forId !== C.tokenHudFor;
  C.tokenHudFor = forId;
  // после остальных renderTokenHUD (кнопка скрытности добавляется следом)
  queueMicrotask(() => {
    for (const col of root.querySelectorAll(".col")) {
      [...col.children].filter((c) => c.matches(".control-icon, .attribute")).forEach((c, i) => c.style.setProperty("--n", String(i)));
    }
    if (!opening || calm()) return;
    root.classList.remove("is-open");
    reflow(root);
    root.classList.add("is-open");
    clearTimeout(C.tokenHudT);
    C.tokenHudT = setTimeout(() => root.classList.remove("is-open"), 700);
  });
}

Hooks.once("ready", () => {
  ensureSprite();
  dressHotbar();
  applyScheme();
  Hooks.on("renderHotbar", () => { dressHotbar(); applyScheme(); requestAnimationFrame(() => pos()); });
  Hooks.on("changeSidebarTab", syncHotbarSidebarState);
  Hooks.on("collapseSidebar", syncHotbarSidebarState);
  addEventListener("resize", syncHotbarSidebarState);
  syncHotbarSidebarState();
  Hooks.on("renderTokenHUD", dressTokenHud);
  Hooks.on("closeTokenHUD", () => { C.tokenHudFor = null; });

  // выбор токена; снятие выбора откладываем на такт, чтобы смена токена шла одной анимацией
  Hooks.on("controlToken", (tok, ctrl) => {
    if (ctrl && tok?.actor) { clearTimeout(C.releaseT); showFor(tok); return; }
    clearTimeout(C.releaseT);
    C.releaseT = setTimeout(() => {
      const c = canvas?.tokens?.controlled?.[0];
      if (c?.actor) showFor(c);
      else { C.tok = null; hide(); }
    }, 0);
  });

  // клик по уже выбранному токену после Esc возвращает HUD
  const wrapTokenClick = (m) => {
    const orig = Token?.prototype?.[m];
    if (typeof orig !== "function") return;
    Token.prototype[m] = function (...args) {
      const res = orig.apply(this, args);
      setTimeout(() => restoreHud(this), 0);
      return res;
    };
  };
  wrapTokenClick("_onClickLeft");
  wrapTokenClick("_onClickLeft2");
  const view = canvas?.app?.canvas ?? canvas?.app?.view;
  view?.addEventListener("mouseup", () => {
    setTimeout(() => {
      const c = canvas?.tokens?.controlled?.[0], h = hoverToken();
      if (c?.actor && h?.id === c.id) restoreHud(c);
    }, 0);
  }, true);

  // документы: точечная синхронизация, анимации переживают обновления
  Hooks.on("updateActor", (actor) => {
    if (!sameActor(actor) || !isVisible()) return;
    freshen();
    refresh();
  });
  const onChild = (doc) => {
    if (!sameActor(doc?.parent) || !isVisible()) return;
    freshen();
    refresh();
  };
  for (const h of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) Hooks.on(h, onChild);

  // Оглушение снимает ОСН/БОН сразу (владелец или мастер)
  const onStunned = async (effect) => {
    try {
      const actor = effect?.parent;
      if (actor?.documentName !== "Actor" || effect?.getFlag?.("Order", "debuffKey") !== "Stunned") return;
      if (!ownerOrGM(actor)) return;
      await applyStunnedActionReminder(actor);
    } catch (e) { console.warn("Order | TokenHud stunned action reminder failed", e); }
  };
  Hooks.on("createActiveEffect", onStunned);
  Hooks.on("updateActiveEffect", onStunned);
  Hooks.on("canvasTearDown", () => { C.tok = null; hide(); });

  // бой: новый ход или раунд — сброс ОСН/БОН с учётом Оглушения и врезка «Ваш ход»
  Hooks.on("updateCombat", async (combat, changed) => {
    try {
      if (!combat?.started) return;
      const has = (k) => Object.prototype.hasOwnProperty.call(changed ?? {}, k);
      if (!has("turn") && !has("round")) return;
      const actor = combat.combatant?.actor ?? null;
      if (!actor) return;
      // сбрасывает владелец или мастер, как раньше
      const reset = ownerOrGM(actor);
      // врезку видит игрок-владелец, а мастер — только если HUD сейчас показывает этого бойца
      const cutin = F.hudEnabled() && ((!game.user?.isGM && !!actor.isOwner) || (sameActor(actor) && isVisible()));
      if (!reset && !cutin) return;
      await turnStart(actor, { round: Number(combat.round) || 1, reset, cutin });
    } catch (e) {
      console.warn("Order | TokenHud updateCombat reset failed", e);
    }
  });

  try { const c = canvas?.tokens?.controlled?.[0]; if (c?.actor) showFor(c); } catch { /* холст ещё не готов */ }
});

export { applyScheme };
