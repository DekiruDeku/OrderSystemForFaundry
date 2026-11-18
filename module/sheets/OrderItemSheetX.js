/* =========================================================================
   ОПБСАН · Лист предмета «Арсенал» (JRPG)
   Та же дизайн-система, что лист бойца X (osx) и HUD токена (oth).

   Подкласс OrderItemSheet. Все механики остаются у родителя: getData, слушатели,
   блокировка правки (Edit), окна-диалоги, drag & drop модификаций, кольцо прогресса.
   Шаблоны templates/sheets/x/*.hbs переносят исходные блоки дословно (те же классы,
   name и data-атрибуты) в раскладку «шапка-досье + вкладки».

   Здесь только подача:
   - фон (силуэт типа и кольца), плашка правки и слой эффектов висят на окне,
     поэтому render(false) их не пересоздаёт и вращение не прыгает;
   - вкладки с курсором в цвете игрока и шторкой при переключении;
   - тревоги и эффекты считаются по разнице снимков данных между перерисовками
     (прочность 0, пустой магазин, перезарядка, уровень, перебор слотов, требования);
   - строка подсказок, звук (module/ui/OrderSfx.js) и кнопка звука в шапке.
   ========================================================================= */

import OrderItemSheet from "./OrderItemSheet.js";
import OrderSfx from "../ui/OrderSfx.js";
import { isLevelable as lvIsLevelable, isEvolutionLevel as lvIsEvolutionLevel, lvFlags } from "../leveling/rules.js";

export const ORDER_ITEM_X_TYPES = ["meleeweapon", "rangeweapon", "Armor", "Skill", "Spell"];

const ORDER_RED = "#e3172f";
const SCHEME_KEYS = [
  "--red", "--red-rgb", "--red-hot", "--red-hot-rgb", "--red-text", "--red-text-rgb",
  "--red-soft-rgb", "--red-deep", "--red-deep-rgb", "--red-ink", "--red-ink-rgb"
];

/* плашка типа, значок-силуэт, огромное слово на фоне */
const META = {
  meleeweapon: { plate: "Ближний бой", sigil: "blade", giant: "Клинок" },
  rangeweapon: { plate: "Дальний бой", sigil: "barrel", giant: "Ствол" },
  Armor: { plate: "Броня", sigil: "shield", giant: "Броня" },
  Skill: { plate: "Способность", sigil: "tech", giant: "Техника" },
  Perk: { plate: "Перк", sigil: "chevron", giant: "Перк" },
  Spell: { plate: "Заклинание", sigil: "rune", giant: "Магия" }
};

/* списки, у которых считаем «добавили / убрали» для звука и подсветки новой строки */
const LIST_SELECTORS = [
  ["adv", ".advantage-char"],
  ["req", ".requires-char"],
  ["atk", ".attack-char"],
  ["mods", ".modification-row"],
  ["onhit", ".weapon-effect-row"],
  ["fx", ".effect-row"],
  ["tags", ".order-tag-pill"],
  ["atags", "[data-pane=\"tags\"] .ability-tag-pill"],
  ["roll", ".roll-formula-value"],
  ["impact", ".impact-formula-value"],
  ["perk", ".perk-bonus-target"]
];
const ROW_HOST = ".os-pill, .effect-row, .weapon-effect-row, .modification-row, .order-tag-pill, .ability-tag-pill, tr, .os-inline, .os-roll-formula-row";

/* ------------------------------------------------------------------ SVG-спрайт */
const ICON_PATHS = {
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  reload: '<path d="M19 8a7.5 7.5 0 1 0 1 5"/><path d="M19 3v5h-5"/>',
  image: '<path d="M4 5h16v14H4z"/><path d="M4 16l5-5 4 4 2-2 5 5"/><path d="M15 9h.01"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 13"/>',
  vest: '<path d="M8 3l4 3 4-3 4 3-2 5v10H6V11L4 6l4-3z"/><path d="M12 6v15"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  tray: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 15v5h16v-5"/>',
  dice: '<path d="M12 2.5l8.5 5v9L12 21.5 3.5 16.5v-9z"/><path d="M12 2.5L7 12h10z"/><path d="M3.5 7.5L7 12l-3.5 4.5M20.5 7.5L17 12l3.5 4.5M7 12l5 9.5 5-9.5"/>',
  book: '<path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1z"/><path d="M12 6v14"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  /* окна и чат «Арсенал II»: защиты, урон, цель, тревога, навигация */
  dodge: '<path d="M4 19c7 0 6-13 13-13"/><path d="M14 3l3.5 3-3.5 3.5"/><path d="M4 7h4M4 11h2.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  shieldBolt: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M13 7.5l-3 4.5h4l-3 4.5"/>',
  strike: '<path d="M4 20L16.5 7.5"/><path d="M12 4h8v8"/><path d="M5 14l5 5"/>',
  wand: '<path d="M4 20l11-11"/><path d="M13 7l4 4"/><path d="M18 2.5v4M16 4.5h4M20.5 10v3M19 11.5h3"/>',
  fist: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V11M10 10V6.5a1.5 1.5 0 0 1 3 0V10M13 10V7.5a1.5 1.5 0 0 1 3 0V12"/><path d="M7 10.5a1.5 1.5 0 0 0-3 0V14a7 7 0 0 0 7 7h1a5 5 0 0 0 5-5v-4"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  pierce: '<path d="M3 12h16"/><path d="M14.5 7.5L19 12l-4.5 4.5"/><path d="M9 4.5v15"/>',
  half: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 8l4-4M12 13l6-6M12 18l7-7"/>',
  bolt: '<path d="M13 2.5L5 14h6l-1 7.5L18 10h-6z"/>',
  star: '<path d="M12 2.5l2.6 6.8 7.2.4-5.6 4.6 1.9 7-6.1-4-6.1 4 1.9-7-5.6-4.6 7.2-.4z"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8v3l3 2v4.5h10V16l3-2v-3a8 8 0 0 0-8-8z"/><path d="M9 11.5h.01M15 11.5h.01M10.5 20.5v-3M13.5 20.5v-3"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  whisper: '<path d="M4 5h16v11H10l-6 4z"/><path d="M8 10.5h8"/>',
  drop: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v5h16v-5"/>'
};
const SIGIL_PATHS = {
  blade: '<path d="M150 18l32 0 0 32-86 86-32-32z"/><path d="M60 98l42 42"/><path d="M52 118l30 30-12 12-30-30z"/><path d="M40 160l-22 22"/><path d="M158 26l16 16"/>',
  barrel: '<circle cx="100" cy="100" r="58"/><circle cx="100" cy="100" r="22"/><path d="M100 20v40M100 140v40M20 100h40M140 100h40"/><path d="M58 58l10 10M142 58l-10 10M58 142l10-10M142 142l-10-10"/>',
  shield: '<path d="M100 16l70 26v52c0 46-30 76-70 92-40-16-70-46-70-92V42z"/><path d="M100 40l46 18v38c0 32-20 54-46 66-26-12-46-34-46-66V58z"/><path d="M70 96l30 22 30-22"/>',
  tech: '<path d="M100 14l18 50 52-4-40 32 18 50-48-28-48 28 18-50-40-32 52 4z"/><path d="M100 70l14 30-14 30-14-30z"/>',
  rune: '<circle cx="100" cy="100" r="82"/><path d="M100 26l64 112H36z"/><path d="M100 174L36 62h128z"/><circle cx="100" cy="100" r="16"/>',
  chevron: '<path d="M40 70l60-40 60 40"/><path d="M40 110l60-40 60 40"/><path d="M40 150l60-40 60 40"/><path d="M100 150v36"/>'
};

/* знак Ордена для фона окон: три кольца разной скорости */
export const SIGIL_RINGS = {
  r1: '<circle cx="100" cy="100" r="96" stroke-width="1.2" stroke-dasharray="2 7"/><circle cx="100" cy="100" r="84" stroke-width="1"/><path d="M100 0v16M100 184v16M0 100h16M184 100h16" stroke-width="2"/>',
  r2: '<circle cx="100" cy="100" r="92" stroke-width="3" stroke-dasharray="46 14 6 14"/><path d="M100 14l8 14h-16zM100 186l8-14h-16z" stroke-width="1.5"/>',
  r3: '<path d="M100 8l26 64 66 28-66 28-26 64-26-64L8 100l66-28z" stroke-width="2"/><circle cx="100" cy="100" r="30" stroke-width="2"/><path d="M100 70v60M70 100h60" stroke-width="1"/>'
};

/** Спрайт значков один на страницу: листы и окна ссылаются на него через <use href="#osi-i-…"> */
export function ensureOsiSprite() {
  if (document.getElementById("osi-sprite")) return;
  const icons = Object.entries(ICON_PATHS).map(([k, p]) => `<symbol id="osi-i-${k}" viewBox="0 0 24 24">${p}</symbol>`).join("");
  const sigils = Object.entries(SIGIL_PATHS).map(([k, p]) => `<symbol id="osi-sig-${k}" viewBox="0 0 200 200">${p}</symbol>`).join("");
  const box = document.createElement("div");
  box.innerHTML = `<svg id="osi-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${icons}${sigils}</defs></svg>`;
  document.body.prepend(box.firstElementChild);
}
export const osiIcon = (name, cls = "ic") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#osi-i-${name}"/></svg>`;

/* ------------------------------------------------------------------ утилиты */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sfx = (name, arg) => { try { OrderSfx.play(name, arg); } catch (e) { /* звук не ломает лист */ } };
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
export const osiCalm = () => reduceMotion() || document.body.classList.contains("order-no-animations");
const calm = osiCalm;
const reflow = (el) => void el?.offsetWidth;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
};
const normTag = (t) => String(t ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

/* --- цвет: схема «Мой цвет» (ключ общий с листом бойца X) и чернила для цвета игрока --- */
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
  const soft = hslToRgb(h, s * 0.9, 0.8);
  const deep = hslToRgb(h, s, 0.28);
  const ink = hslToRgb(h, s * 0.7, 0.09);
  return {
    "--red": toHex(base), "--red-rgb": base.join(", "),
    "--red-hot": toHex(hot), "--red-hot-rgb": hot.join(", "),
    "--red-text": toHex(text), "--red-text-rgb": text.join(", "),
    "--red-soft-rgb": soft.join(", "),
    "--red-deep": toHex(deep), "--red-deep-rgb": deep.join(", "),
    "--red-ink": toHex(ink), "--red-ink-rgb": ink.join(", ")
  };
}
/** Чёрные или белые чернила на цвете игрока: что контрастнее */
function inkFor(rgb) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#050507" : "#ffffff";
}
/** Цвет игрока для отметок на тёмном фоне: слишком тёмный цвет поднимаем по светлоте, иначе фокус не виден */
export function visibleRgb(color) {
  const rgb = parseHex(color) ?? [63, 183, 255];
  const [h, s, l] = rgbToHsl(rgb);
  return l < 0.45 ? hslToRgb(h, Math.max(s, 0.45), 0.55) : rgb;
}
/** Цвет автора сообщения чата: плашка, срез угла, шапка */
export function auTokens(el, color) {
  const rgb = visibleRgb(color || ORDER_RED);
  el.style.setProperty("--au", toHex(rgb));
  el.style.setProperty("--au-rgb", rgb.join(", "));
  el.style.setProperty("--au-ink", inkFor(rgb));
}
const playerColor = () => String(game.user?.color ?? ORDER_RED);

/** Цвет игрока и схема Ордена/«Мой цвет» на любом окне скина (лист предмета, диалог) */
export function osiApplyScheme(el) {
  if (!el) return;
  const scheme = store.get("osx-scheme", "order");
  const tokens = scheme === "player" ? schemeTokens(playerColor()) : null;
  for (const k of SCHEME_KEYS) {
    if (tokens) el.style.setProperty(k, tokens[k]);
    else el.style.removeProperty(k);
  }
  const rgb = visibleRgb(playerColor());
  el.style.setProperty("--accent", toHex(rgb));
  el.style.setProperty("--accent-rgb", rgb.join(", "));
  el.style.setProperty("--accent-ink", inkFor(rgb));
  el.dataset.scheme = tokens ? "player" : "order";
}

/* ========================================================================= */

export default class OrderItemSheetX extends OrderItemSheet {

  constructor(...args) {
    super(...args);
    this._osiTab = null;          // открытая вкладка переживает перерисовку
    this._osiSnap = null;         // снимок прошлого рендера: из него считаются эффекты
    this._osiLast = null;         // данные подачи последнего getData
    this._osiKick = 0;            // поворот колец фона (дёргается при смене вкладки)
    this._osiIntroDone = false;
    this._osiEditPrev = null;
    this._osiHint = null;
    this._osiClosing = false;
    this._osiTimers = new Set();
  }

  static get defaultOptions() {
    // Без класса "item": старые правила .Order.sheet.item не пересиливают новый вид.
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "osi"],
      width: 980,
      height: 740,
      resizable: true,
      scrollY: [".os-item-body"]
    });
  }

  get template() {
    const t = this.item?.type;
    if (ORDER_ITEM_X_TYPES.includes(t)) return `systems/Order/templates/sheets/x/${t}-sheet.hbs`;
    return super.template;
  }

  /* ================================================================== ДАННЫЕ */

  async getData(options = {}) {
    const data = await super.getData(options);
    try {
      data.osi = this._osiData(data);
    } catch (err) {
      console.warn("[Order] OSI: данные подачи", err);
      data.osi = { tabs: [{ id: "main", label: "Основное", active: true }], tab: "main", nameSize: 34, plate: "", sigil: "tech", slots: { cells: [] }, reqCls: [] };
    }
    this._osiLast = data.osi;
    return data;
  }

  _osiKind() {
    const t = this.item?.type;
    return t === "Skill" && this.item?.system?.isPerk ? "Perk" : t;
  }

  _osiActor() {
    const p = this.item?.parent;
    if (p && p.documentName === "Actor") return p;
    return this.item?.actor ?? null;
  }

  /** Требование выполнено? Та же формула, что штраф в листе бойца: null, если бойца нет */
  _osiReqMet(r, actor) {
    if (!actor) return null;
    const c1 = String(r?.RequiresCharacteristic ?? "").trim();
    if (!c1) return null;
    const need = Number(r?.Requires) || 0;
    const c2 = String(r?.RequiresCharacteristicAlt ?? r?.RequiresCharacteristic2 ?? "").trim();
    const useOr = Boolean(r?.RequiresOr ?? r?.useOr ?? r?.or);
    const have = (c) => Number(actor.system?.[c]?.value ?? 0) || 0;
    const best = useOr && c2 ? Math.max(have(c1), have(c2)) : have(c1);
    return best >= need;
  }

  /** Сколько нажатий нужно на перезарядку (как _onReloadRangeWeapon) */
  _osiHeavySteps(sys) {
    const tags = (Array.isArray(sys?.tags) ? sys.tags : []).map(normTag);
    if (tags.includes(normTag("сверхтяжелый магазин"))) return 4;
    if (tags.includes(normTag("тяжелый магазин"))) return 2;
    return 1;
  }

  _osiData(data) {
    const item = this.item;
    const type = item.type;
    const sys = data.data ?? item.system ?? {};
    const kind = this._osiKind();
    const meta = META[kind] ?? META.Skill;
    const isWeapon = type === "meleeweapon" || type === "rangeweapon";
    const isAbility = type === "Skill" || type === "Spell";
    const hasDurability = isWeapon || type === "Armor";
    const canEdit = !!data.osCanEdit;
    const actor = this._osiActor();

    const len = String(item.name ?? "").length;
    const nameSize = len <= 18 ? 40 : len <= 26 ? 34 : len <= 36 ? 28 : 24;

    let sub = "";
    if (isWeapon) sub = String(sys.weaponType ?? "");
    else if (isAbility) {
      const raw = type === "Spell" ? data.spellDeliveryTypes : data.skillDeliveryTypes;
      const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
      sub = String(list.find((o) => o?.value === sys.DeliveryType)?.label ?? "");
    }

    // требования: отметка «выполнено / нет» только у предмета в инвентаре бойца
    const reqs = Array.isArray(sys.RequiresArray) ? sys.RequiresArray : [];
    const met = reqs.map((r) => this._osiReqMet(r, actor));
    const reqCls = met.map((m) => (m === null ? "" : m ? "is-met" : "is-unmet"));
    const unmet = met.filter((m) => m === false).length;

    // модификации: ячейки слотов
    const modCount = num(data.modificationCount);
    const modSlots = num(data.modificationSlots);
    const cellsN = Math.min(Math.max(modSlots, modCount), 24);
    const cells = Array.from({ length: cellsN }, (_, i) => (i < Math.min(modCount, modSlots) ? "is-on" : i >= modSlots ? "is-over" : ""));

    // магазин дальнего оружия
    let mag = null;
    if (type === "rangeweapon") {
      const count = num(sys.Magazine);
      const size = Math.max(0, num(sys.MagazineSize));
      const n = Math.min(Math.max(size, count), 40);
      const heavy = this._osiHeavySteps(sys);
      let prog = 0;
      try { prog = heavy > 1 ? clamp(num(item.getFlag("Order", "reloadProgress")), 0, heavy) : 0; } catch (e) { prog = 0; }
      mag = {
        count, size, empty: count <= 0, heavy, prog,
        pips: Array.from({ length: n }, (_, i) => (i < count ? "is-on" : "")),
        steps: heavy > 1 ? Array.from({ length: heavy }, (_, i) => (i < prog ? "is-on" : "")) : []
      };
    }

    // кольцо прогресса навыка / заклинания (те же формулы, что _activateSkillListeners)
    let ring = null;
    if (isAbility) {
      const c = parseInt(sys.Circle, 10);
      const circle = Number.isNaN(c) ? 1 : c;
      const level = parseInt(sys.Level, 10) || 0;
      const fill = parseInt(sys.filledSegments, 10) || 0;
      const max = this._getMaxLevelForCircle(circle);
      const isMax = level >= max;
      const total = isMax ? 0 : this._calculateSkillSegments(level, circle);
      ring = { circle, level, fill, total, max, isMax, next: level + 1 };
      // Окно «Прокачка» (у бойцов): уровень ждёт выбора, следующий — Эволюция, это вариант Эволюции
      const owner = this.item.parent;
      if (owner?.type === "Player" && lvIsLevelable(this.item)) {
        const lv = lvFlags(this.item);
        const parent = lv.evolutionOf ? owner.items?.get(lv.evolutionOf) : null;
        ring.lvOn = true;
        ring.pendingLevel = lv.pending[0]?.level ?? 0;
        ring.pendingMore = lv.pending.length > 1 ? `+${lv.pending.length - 1}` : "";
        ring.pendingReplace = !!lv.pending[0]?.replace;
        ring.nextEvo = !isMax && !lv.evolutionOf && lvIsEvolutionLevel(level + 1);
        ring.variantOf = lv.evolutionOf ? { id: lv.evolutionOf, name: parent?.name ?? "исходная способность", missing: !parent } : null;
      }
    }

    // вкладки
    const effectsCount = isWeapon
      ? (Array.isArray(sys.OnHitEffects) ? sys.OnHitEffects.length : 0)
      : ((type === "Spell" ? data.spellEffects : data.skillEffects)?.length ?? 0);
    const tagCount = isWeapon
      ? (Array.isArray(sys.tags) ? sys.tags.length : 0)
      : (Array.isArray(data.abilityTags) ? data.abilityTags.length : 0);
    const paramCount = (sys.additionalAdvantages?.length ?? 0) + reqs.length + (isWeapon ? (sys.AttackCharacteristics?.length ?? 0) : 0);
    const T = (id, label, badge = null, alarm = false) => ({ id, label, badge: badge === null ? "" : String(badge), hasBadge: badge !== null, alarm: !!alarm });
    const modsBadge = `${modCount}/${modSlots}`;
    let tabs;
    if (isWeapon) {
      tabs = [T("main", "Основное"), T("params", "Параметры", paramCount, unmet > 0), T("mods", "Моды", modsBadge, data.modificationHasOverflow),
        T("effects", "Эффекты", effectsCount), T("tags", "Теги", tagCount)];
    } else if (type === "Armor") {
      tabs = [T("main", "Основное"), T("params", "Параметры", paramCount, unmet > 0), T("mods", "Моды", modsBadge, data.modificationHasOverflow)];
    } else {
      tabs = [T("main", "Основное")];
      if (kind === "Perk") tabs.push(T("bonus", "Бонусы перка", sys.perkBonuses?.length ?? 0));
      tabs.push(T("desc", "Описание"));
      if (canEdit) tabs.push(T("use", "Применение"));
      if (type === "Spell" || !sys.hiddenDefaults?.Effects) tabs.push(T("effects", "Эффекты", effectsCount));
      if (canEdit) tabs.push(T("tags", "Теги", tagCount));
    }
    if (!tabs.some((t) => t.id === this._osiTab)) this._osiTab = tabs[0].id;
    tabs.forEach((t) => { t.active = t.id === this._osiTab; });

    const hiddenCount = (Array.isArray(sys.additionalFields) ? sys.additionalFields.filter((f) => f?.hidden).length : 0)
      + Object.keys(sys.hiddenDefaults ?? {}).length;

    return {
      kind, type,
      plate: meta.plate, sigil: meta.sigil, giant: meta.giant,
      sub, nameSize,
      tab: this._osiTab, tabs,
      hasDurability,
      // предмет в инвентаре бойца с прочностью 0 считается сломанным
      isBroken: hasDurability && !!actor && num(sys.Durability) <= 0,
      ring, mag, reqCls, unmet,
      slots: { cells },
      hiddenCount,
      actorName: actor?.name ?? ""
    };
  }

  /* ================================================================== ШАПКА ОКНА */

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    const sound = {
      label: "",
      class: "osi-sound-toggle",
      icon: OrderSfx.enabled ? "fas fa-volume-high" : "fas fa-volume-xmark",
      onclick: (ev) => { ev?.preventDefault?.(); this._osiToggleSound(); }
    };
    const cfg = buttons.findIndex((b) => String(b.class || "").includes("configure-sheet"));
    if (cfg >= 0) buttons.splice(cfg, 0, sound);
    else buttons.unshift(sound);
    return buttons;
  }

  _osiSyncHeader() {
    const app = this.element?.[0];
    const head = app?.querySelector(":scope > .window-header");
    if (!head) return;
    const edit = head.querySelector(".os-edit-toggle");
    if (edit) {
      const on = !!this._osEditMode;
      edit.classList.toggle("active", on);
      edit.setAttribute("aria-pressed", String(on));
      const i = edit.querySelector("i");
      if (i) i.className = on ? "fa-solid fa-pen-to-square fas fa-pen-to-square" : "fa-solid fa-pen fas fa-pen";
    }
    const snd = head.querySelector(".osi-sound-toggle");
    if (snd) {
      const on = OrderSfx.enabled;
      snd.classList.toggle("is-muted", !on);
      snd.setAttribute("aria-label", on ? "Выключить звук окон" : "Включить звук окон");
      snd.setAttribute("aria-pressed", String(!on));
      snd.title = on ? "Звук окон включён" : "Звук окон выключен";
      const i = snd.querySelector("i");
      if (i) i.className = on ? "fas fa-volume-high" : "fas fa-volume-xmark";
    }
  }

  _osiToggleSound() {
    const on = !OrderSfx.enabled;
    OrderSfx.setEnabled(on);
    if (on) sfx("muteOff");
    this._osiSyncHeader();
  }

  /* ================================================================== РЕНДЕР */

  activateListeners(html) {
    // До слушателей родителя: окно получает схему и классы, кольцо рисуется уже в цвете игрока.
    try { this._osiPrepareWindow(); } catch (err) { console.warn("[Order] OSI: окно", err); }
    super.activateListeners(html);
    try { this._osiAfterRender(html); } catch (err) { console.warn("[Order] OSI: подача", err); }
    try { this._osiBindLeveling(); } catch (err) { console.warn("[Order] OSI: прокачка", err); }
  }

  /* Кольцо прогресса и окно «Прокачка»: выбор улучшения и переход к исходной способности варианта */
  _osiBindLeveling() {
    const form = this._osiForm();
    const actor = this.item.parent;
    if (!form || !actor) return;
    form.querySelector(".osi-lv-pending")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      game.OrderLeveling?.open?.(actor, { itemId: this.item.id, levelUp: { cutin: false } });
    });
    form.querySelector(".osi-lv-variant")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      const parent = actor.items?.get(ev.currentTarget.dataset.lvParent);
      if (parent) parent.sheet?.render(true);
      else ui.notifications?.warn?.("Исходной способности больше нет в листе.");
    });
  }

  _osiForm() {
    return this.element?.[0]?.querySelector(":scope > .window-content > form") ?? null;
  }

  _osiPrepareWindow() {
    const app = this.element?.[0];
    if (!app) return;
    ensureOsiSprite();
    const L = this._osiLast ?? {};
    const canEdit = this._osCanEditItemSheet();
    const lockable = this._osIsLockableItemSheet();
    app.dataset.type = this.item.type;
    app.classList.toggle("is-perk", this._osiKind() === "Perk");
    app.classList.toggle("is-edit", canEdit);
    app.classList.toggle("is-lockable", lockable);
    app.classList.toggle("is-locked", lockable && !canEdit);
    app.classList.toggle("is-broken", !!L.isBroken);
    osiApplyScheme(app);
    this._osiEnsureLayers(app, L);
  }

  /* Фон, плашка правки и слой эффектов живут на окне, а не в форме */
  _osiEnsureLayers(app, L) {
    const meta = META[this._osiKind()] ?? META.Skill;
    let bd = app.querySelector(":scope > .osi-backdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.className = "osi-backdrop";
      bd.setAttribute("aria-hidden", "true");
      bd.innerHTML = `
        <i class="osi-bd-haze"></i><i class="osi-bd-stripes"></i>
        <div class="osi-orbit">
          <svg class="osi-rings" viewBox="0 0 400 400">
            <g class="spin"><circle class="r-ticks" cx="200" cy="200" r="190"/><circle class="r-outer" cx="200" cy="200" r="198"/></g>
            <g class="spin-rev"><circle class="r-arc" cx="200" cy="200" r="164"/><path class="r-notch" d="M200 28v18M200 354v18M28 200h18M354 200h18"/></g>
            <g class="spin-fast"><circle class="r-mid" cx="200" cy="200" r="128"/></g>
            <circle class="r-inner" cx="200" cy="200" r="96"/>
          </svg>
          <svg class="osi-sigil" viewBox="0 0 200 200"><use href="#osi-sig-${meta.sigil}"/></svg>
        </div>
        <span class="osi-giant"></span>
        <i class="osi-bd-alarm"></i>`;
      const wc = app.querySelector(":scope > .window-content");
      app.insertBefore(bd, wc ?? null);
    }
    bd.querySelector(".osi-sigil use")?.setAttribute("href", `#osi-sig-${meta.sigil}`);
    const giant = bd.querySelector(".osi-giant");
    if (giant && giant.textContent !== meta.giant) giant.textContent = meta.giant;
    bd.querySelector(".osi-orbit")?.style.setProperty("--kick", `${this._osiKick}deg`);

    if (!app.querySelector(":scope > .osi-edit-flag")) {
      const flag = document.createElement("div");
      flag.className = "osi-edit-flag";
      flag.setAttribute("aria-hidden", "true");
      flag.textContent = "Режим правки";
      app.insertBefore(flag, bd);
    }
    if (!app.querySelector(":scope > .osi-fx")) {
      const fx = document.createElement("div");
      fx.className = "osi-fx";
      fx.setAttribute("aria-hidden", "true");
      fx.innerHTML = '<i class="osi-flash"></i>';
      app.append(fx);
    }
  }

  _osiAfterRender(html) {
    const app = this.element?.[0];
    const form = this._osiForm() ?? html?.[0];
    if (!app || !form) return;
    const canEdit = this._osCanEditItemSheet();

    this._osiSyncHeader();
    this._osiBindForm(form);
    this._osiPlaceCursor(form, false);

    // моды сверх лимита слотов: строки подсвечены так же, как ячейки шкалы
    const slots = (this._osiLast?.slots?.cells ?? []).filter((c) => c !== "is-over").length;
    form.querySelectorAll(".modifications-list .modification-row").forEach((row, i) => row.classList.toggle("is-over", i >= slots));

    // кнопки правки появляются волной только в момент включения Edit
    const editChanged = this._osiEditPrev !== null && this._osiEditPrev !== canEdit;
    if (editChanged) sfx(canEdit ? "editOn" : "editOff");
    if (editChanged && canEdit && !calm()) form.querySelectorAll(".osi-edit-reveal").forEach((n, i) => n.style.setProperty("--i", i % 12));
    else form.querySelectorAll(".osi-edit-reveal").forEach((n) => n.classList.remove("osi-edit-reveal"));
    this._osiEditPrev = canEdit;

    // эффекты по разнице с прошлым рендером
    const snap = this._osiSnapshot(form, canEdit);
    const prev = this._osiSnap;
    this._osiSnap = snap;
    if (prev) {
      try { this._osiFxDiff(prev, snap, form); } catch (err) { console.warn("[Order] OSI: эффекты", err); }
    }

    if (!this._osiIntroDone) {
      this._osiIntroDone = true;
      sfx("itemOpen");
      if (!calm()) {
        app.classList.add("osi-intro");
        this._osiLater(() => app.classList.remove("osi-intro"), 1300);
      }
    }
  }

  _osiBindForm(form) {
    // вкладки: мышь и стрелки
    form.querySelectorAll(".osi-tab").forEach((tab) => {
      tab.addEventListener("click", (ev) => { ev.preventDefault(); this._osiSwitchTab(tab.dataset.tab); });
    });
    form.querySelector(".osi-tabs")?.addEventListener("keydown", (ev) => {
      const ids = [...form.querySelectorAll(".osi-tab")].map((t) => t.dataset.tab);
      let i = ids.indexOf(this._osiTab);
      if (ev.key === "ArrowRight") i = (i + 1) % ids.length;
      else if (ev.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
      else if (ev.key === "Home") i = 0;
      else if (ev.key === "End") i = ids.length - 1;
      else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); return; }
      else return;
      ev.preventDefault();
      ev.stopPropagation();
      this._osiSwitchTab(ids[i], { focus: true });
    });

    // смена картинки: та же функция Foundry, что клик по самому арту
    const artEdit = form.querySelector(".osi-art-edit");
    if (artEdit) {
      const open = (ev) => {
        ev.preventDefault();
        const img = form.querySelector('img.os-item-img[data-edit="img"]');
        if (img) img.click();
      };
      artEdit.addEventListener("click", open);
      artEdit.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") open(ev); });
    }

    // ПКМ по кольцу не открывает меню браузера (ПКМ там снимает сегмент)
    form.querySelectorAll("canvas.circle-progress-skill").forEach((cv) => cv.addEventListener("contextmenu", (ev) => ev.preventDefault()));

    // попытка правки в режиме просмотра: то же предупреждение, что у родителя
    if (this._osIsLockableItemSheet() && !this._osCanEditItemSheet() && this.item?.isOwner && this.isEditable) {
      form.querySelector(".os-item-body")?.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        const cell = ev.target.closest("td, .os-field, .os-form-row, .os-inline, .order-save-ability-option");
        if (!cell || ev.target.closest("button, a, canvas, .field-label")) return;
        const locked = cell.querySelector('input[readonly]:not([name="data.Damage"]):not([name="data.Range"]), textarea[readonly], select:disabled, input[type="checkbox"]:disabled');
        if (!locked) return;
        sfx("errorLow");
        this._osWarnItemEditLocked();
      });
    }

    // строка подсказок
    const hintBox = form.querySelector(".osi-hint-text");
    if (hintBox) {
      this._osiHint = null;
      hintBox.innerHTML = this._osiDefaultHint();
      form.addEventListener("pointerover", (ev) => {
        const h = this._osiHintFor(ev.target) || this._osiDefaultHint();
        if (h === this._osiHint) return;
        this._osiHint = h;
        hintBox.innerHTML = h;
        hintBox.classList.remove("is-in");
        reflow(hintBox);
        hintBox.classList.add("is-in");
      });
    }
  }

  _osiDefaultHint() {
    if (!this.isEditable) return `<span>${osiIcon("eye")}Только просмотр</span>`;
    if (!this._osIsLockableItemSheet()) return `<span>${osiIcon("edit")}Изменения сохраняются сразу</span>`;
    return this._osCanEditItemSheet()
      ? `<span>${osiIcon("edit")}Правка: изменения сохраняются сразу</span>`
      : `<span>${osiIcon("eye")}Просмотр: правка открывается кнопкой Edit в шапке</span>`;
  }

  _osiHintFor(t) {
    if (!t?.closest) return "";
    const k = (s) => `<kbd>${s}</kbd>`;
    const ability = this.item.type === "Skill" || this.item.type === "Spell";
    const canEdit = this._osCanEditItemSheet();
    if (t.closest(".field-label")) {
      return `<span>${k("ЛКМ")}показывать на листе бойца</span>${ability && canEdit ? `<span>${k("ПКМ")}подсветить значение при правке</span><span>${k("-")}в значении скрывает поле</span>` : ""}`;
    }
    if (t.closest(".add-field")) return `<span>${k("ЛКМ")}вернуть скрытое поле или добавить своё</span>`;
    if (t.closest("canvas.circle-progress-skill")) return `<span>${k("ЛКМ")}+1 сегмент</span><span>${k("ПКМ")}−1 сегмент</span>`;
    if (t.closest(".osi-tab")) return `<span>${k("←")}${k("→")}переключить раздел</span>`;
    if (t.closest(".modification-open")) return `<span>${k("ЛКМ")}открыть лист модификации</span>`;
    if (t.closest(".order-tag-pill")) return "<span>Наведите на тег: описание</span>";
    const hint = t.closest("[data-hint]")?.dataset.hint;
    if (hint === "hand") return `<span>${k("ЛКМ")}взять в руку или убрать (работает без правки)</span>`;
    if (hint === "reload") {
      const n = this._osiLast?.mag?.heavy ?? 1;
      return `<span>${k("ЛКМ")}${n > 1 ? `перезарядка в ${n} нажатия, прогресс сохраняется` : "выбрать патроны и перезарядить"}</span>`;
    }
    if (hint === "train") {
      return this.item.parent?.type === "Player"
        ? `<span>${k("ЛКМ")}окно «Прокачка»: тренировка, шкала и улучшения</span>`
        : `<span>${k("ЛКМ")}открыть тренировку</span>`;
    }
    if (hint === "lvpick") return `<span>${k("ЛКМ")}выбрать улучшение за новый уровень</span>`;
    if (hint === "lvparent") return `<span>${k("ЛКМ")}открыть лист исходной способности: уровень растёт у неё</span>`;
    if (hint === "drop") return "<span>Перетащите сюда предмет типа «Regular Item» из инвентаря или каталога</span>";
    if (hint === "equip" || hint === "used") return `<span>${k("ЛКМ")}переключить</span>`;
    if (this._osIsLockableItemSheet() && !canEdit && t.closest("input[readonly], textarea[readonly], select:disabled, td, .os-field")) {
      return `<span>${osiIcon("edit")}Правка закрыта: нажмите Edit в шапке</span>`;
    }
    return "";
  }

  /* ================================================================== ВКЛАДКИ */

  _osiSwitchTab(id, { focus = false } = {}) {
    const app = this.element?.[0];
    const form = this._osiForm();
    if (!app || !form || !id || id === this._osiTab) return;
    const tabs = [...form.querySelectorAll(".osi-tab")];
    const ids = tabs.map((t) => t.dataset.tab);
    if (!ids.includes(id)) return;
    const dir = ids.indexOf(id) > ids.indexOf(this._osiTab) ? 1 : -1;
    this._osiTab = id;
    if (this._osiLast) this._osiLast.tab = id;
    tabs.forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    form.querySelectorAll(".osi-pane").forEach((p) => {
      const on = p.dataset.pane === id;
      p.classList.toggle("active", on);
      p.classList.remove("is-enter-r", "is-enter-l");
      if (on && !calm()) { reflow(p); p.classList.add(dir > 0 ? "is-enter-r" : "is-enter-l"); }
    });
    const body = form.querySelector(".os-item-body");
    if (body) body.scrollTop = 0;
    const wipe = form.querySelector(".osi-wipe");
    if (wipe && !calm()) {
      wipe.classList.remove("is-run", "is-back");
      reflow(wipe);
      wipe.classList.toggle("is-back", dir < 0);
      wipe.classList.add("is-run");
    }
    this._osiKick += dir * 40;
    app.querySelector(":scope > .osi-backdrop .osi-orbit")?.style.setProperty("--kick", `${this._osiKick}deg`);
    this._osiPlaceCursor(form, true);
    sfx("tabLow");
    if (focus) form.querySelector(`.osi-tab[data-tab="${id}"]`)?.focus();
  }

  _osiPlaceCursor(form, animate) {
    const tabs = form?.querySelector(".osi-tabs");
    const cur = tabs?.querySelector(".osi-tab-cursor");
    const act = tabs?.querySelector(".osi-tab.active");
    if (!cur || !act) return;
    if (!animate) cur.style.transition = "none";
    cur.style.setProperty("--cx", `${act.offsetLeft}px`);
    cur.style.setProperty("--cw", `${act.offsetWidth}px`);
    if (!animate) { reflow(cur); cur.style.transition = ""; }
  }

  /* ================================================================== КОЛЬЦО ПРОГРЕССА */

  /** Тот же вызов, что у родителя (кольцо из сегментов), но в стиле листа бойца и с поддержкой HiDPI */
  _drawCircle(canvas, filledSegments, totalSegments, isMaxLevel, flashIndex = -1) {
    if (!canvas?.closest?.(".osi-ring")) return super._drawCircle(canvas, filledSegments, totalSegments, isMaxLevel);
    const size = 128;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(canvas);
    const accent = cs.getPropertyValue("--accent").trim() || "#3fb7ff";
    const mint = cs.getPropertyValue("--mint").trim() || "#5ef2b0";
    const c = size / 2, r = 50;
    const total = Math.max(0, Math.floor(Number(totalSegments) || 0));
    const filled = Math.max(0, Math.floor(Number(filledSegments) || 0));
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(c, c, r + 9, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,240,244,0.18)"; ctx.lineWidth = 1;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 - Math.PI / 2, r1 = r + 11, r2 = r + (i % 4 ? 13 : 16);
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); ctx.stroke();
    }
    ctx.lineWidth = 10; ctx.lineCap = "butt";
    if (isMaxLevel || !total) {
      ctx.strokeStyle = isMaxLevel ? mint : "rgba(255,240,244,0.13)";
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      const per = (Math.PI * 2) / total, gap = Math.min(0.06, per * 0.22);
      for (let i = 0; i < total; i++) {
        const a0 = -Math.PI / 2 + i * per + gap / 2;
        ctx.strokeStyle = i === flashIndex ? "#ffffff" : i < filled ? accent : "rgba(255,240,244,0.13)";
        ctx.beginPath(); ctx.arc(c, c, r, a0, a0 + per - gap); ctx.stroke();
      }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,240,244,0.12)";
    ctx.beginPath(); ctx.arc(c, c, r - 10, 0, Math.PI * 2); ctx.stroke();
  }

  /* ================================================================== ЭФФЕКТЫ ПО РАЗНИЦЕ ДАННЫХ */

  _osiSnapshot(form, canEdit) {
    const s = this.item.system ?? {};
    const L = this._osiLast ?? {};
    const lists = {};
    for (const [k, sel] of LIST_SELECTORS) lists[k] = form.querySelectorAll(sel).length;
    const fields = new Set([...form.querySelectorAll(".field-label")].map((el) => (el.dataset.type === "additional" ? `a:${el.dataset.index}` : `f:${el.dataset.field}`)));
    return {
      edit: canEdit,
      kind: this._osiKind(),
      dur: num(s.Durability),
      mag: num(s.Magazine),
      prog: L.mag?.prog ?? 0,
      lvl: L.ring?.level ?? 0,
      fill: L.ring?.fill ?? 0,
      total: L.ring?.total ?? 0,
      isMax: !!L.ring?.isMax,
      mods: lists.mods,
      slots: num(s.Modificationslots),
      over: lists.mods > num(s.Modificationslots),
      unmet: L.unmet ?? 0,
      hidden: L.hiddenCount ?? 0,
      toggles: { inHand: !!s.inHand, isEquiped: !!s.isEquiped, isUsed: !!s.isUsed },
      lists,
      fields
    };
  }

  _osiFxDiff(a, b, form) {
    const type = this.item.type;
    const hasDur = type === "meleeweapon" || type === "rangeweapon" || type === "Armor";
    const isAbility = type === "Skill" || type === "Spell";

    if (hasDur && b.dur !== a.dur) {
      if (b.dur < a.dur && b.dur <= 0) this._osiFxBreak();
      else if (b.dur < a.dur) { sfx("dmgLow"); this._osiShake(0.32); this._osiSlamStat("Durability"); }
      else if (a.dur <= 0 && b.dur > 0) {
        sfx("repairLow");
        this._osiFlash("is-mint");
        this._osiAlert({ title: "В строю", sub: `Прочность <b>${b.dur}</b>`, kind: "is-mint", hold: 900 });
        this._osiSlamStat("Durability");
      } else { sfx("segment", 0.6); this._osiSlamStat("Durability"); }
    }

    if (type === "rangeweapon") {
      if (b.mag < a.mag) {
        for (let i = Math.max(0, b.mag); i < Math.min(a.mag, 40); i++) form.querySelector(`.osi-pips i[data-pip="${i}"]`)?.classList.add("is-spent");
        if (b.mag <= 0) this._osiFxEmpty(form);
        else sfx("roundOut");
      } else if (b.mag > a.mag) this._osiFxReloadFill(form, a.mag, b.mag);
      if (b.prog > a.prog) {
        sfx("reloadStep");
        form.querySelectorAll(".osi-act-steps i")[b.prog - 1]?.classList.add("is-pop");
      }
    }

    if (isAbility && a.kind === b.kind) {
      if (b.lvl > a.lvl) this._osiFxLevelUp(form, b.lvl, b.isMax);
      else if (b.lvl < a.lvl) { sfx("levelDownLow"); this._osiSlamStat("Level"); }
      else if (b.fill > a.fill) {
        sfx("segment", b.total ? b.fill / b.total : 0);
        const cv = form.querySelector("canvas.circle-progress-skill");
        if (cv && b.total) {
          this._drawCircle(cv, b.fill, b.total, false, b.fill - 1);
          this._osiLater(() => { if (cv.isConnected) this._drawCircle(cv, b.fill, b.total, false); }, 110);
        }
      } else if (b.fill < a.fill) sfx("segmentDown");
    }

    if (hasDur) {
      if (b.mods !== a.mods || b.slots !== a.slots) {
        form.querySelectorAll(".osi-slots-bar i").forEach((cell, i) => {
          if (i >= Math.min(a.mods, a.slots) && i < Math.min(b.mods, b.slots)) cell.classList.add("is-pop");
        });
      }
      if (b.over && !a.over) {
        sfx("alarmLow");
        this._osiShake(0.3);
        form.querySelector(".osi-warn-over")?.classList.add("is-new");
        this._osiAlert({ title: "Перебор слотов", sub: `Модов <b>${b.mods}</b> · слотов <b>${b.slots}</b>`, hold: 1200 });
      }
      if (b.unmet > a.unmet) {
        sfx("alarmLow");
        this._osiShake(0.3);
        form.querySelector(".osi-warn-req")?.classList.add("is-new");
        this._osiAlert({ title: "Требования", sub: `${esc(this._osiLast?.actorName ?? "")} не проходит: <b>${b.unmet}</b>`, hold: 1200 });
      }
    }

    for (const k of ["inHand", "isEquiped", "isUsed"]) {
      if (a.toggles[k] === b.toggles[k]) continue;
      sfx("toggleLow", b.toggles[k] ? 1 : -1);
      form.querySelector(`input[name="data.${k}"]`)?.closest(".osi-toggle")?.classList.add("is-flip");
    }

    // строки списков и поля: только если вид листа не сменился (Edit, перк)
    if (a.edit !== b.edit || a.kind !== b.kind) return;
    let added = false, removed = false;
    for (const [k, sel] of LIST_SELECTORS) {
      const d = (b.lists[k] ?? 0) - (a.lists[k] ?? 0);
      if (d > 0) {
        added = true;
        [...form.querySelectorAll(sel)].slice(-d).forEach((n) => (n.closest(ROW_HOST) ?? n).classList.add("is-new"));
      } else if (d < 0) removed = true;
    }
    const appeared = [...b.fields].filter((f) => !a.fields.has(f));
    const vanished = [...a.fields].filter((f) => !b.fields.has(f));
    if (appeared.length && appeared.length <= 4) { added = true; this._osiRevealFields(form, appeared); }
    if (vanished.length && b.hidden > a.hidden) { removed = true; this._osiPingAddField(form); }
    if (added) sfx("pillAdd");
    else if (removed) sfx("pillRemove");
  }

  /* возвращённое через «+ Поле» или новое поле: показать вкладку, где оно живёт, и подсветить */
  _osiRevealFields(form, keys) {
    const nodes = keys.map((k) => (k.startsWith("a:")
      ? form.querySelector(`.field-label[data-type="additional"][data-index="${k.slice(2)}"]`)
      : form.querySelector(`.field-label[data-field="${k.slice(2)}"]`))).filter(Boolean);
    if (!nodes.length) return;
    const pane = nodes[0].closest(".osi-pane");
    if (pane && !pane.classList.contains("active")) this._osiSwitchTab(pane.dataset.pane);
    nodes.forEach((n) => (n.closest("tr") ?? n).classList.add("is-new"));
    const row = nodes[0].closest("tr");
    row?.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
    row?.querySelector("input:not([type=checkbox]):not([readonly]), textarea:not([readonly])")?.focus({ preventScroll: true });
  }

  /* значок «+ Поле» вздрагивает: поле ушло туда */
  _osiPingAddField(form) {
    const b = form.querySelector(".add-field");
    if (!b || calm()) return;
    b.classList.remove("is-ping");
    reflow(b);
    b.classList.add("is-ping");
  }

  _osiFxBreak() {
    const app = this.element?.[0];
    sfx("breakLow");
    this._osiHitstop(110, () => {
      this._osiShake(0.9);
      this._osiFlash();
      app?.classList.add("is-breaking");
      this._osiLater(() => app?.classList.remove("is-breaking"), 700);
      this._osiAlert({ title: "Сломано", sub: `Прочность <b>0</b> · ${esc(this.item.name)}`, hold: 1400 });
    });
    this._osiSlamStat("Durability");
  }

  _osiFxEmpty(form) {
    sfx("emptyClick");
    this._osiShake(0.28);
    form.querySelector(".osi-empty-tag")?.classList.add("is-blink");
    this._osiAlert({ title: "Магазин пуст", sub: "Нажмите «Перезарядить»", hold: 1100 });
  }

  _osiFxReloadFill(form, from, to) {
    const size = Math.min(40, Math.max(1, num(this.item.system?.MagazineSize), to));
    const last = Math.min(to, size);
    const step = calm() ? 0 : 38;
    let n = 0;
    for (let i = Math.max(0, from); i < last; i++, n++) {
      const pip = form.querySelector(`.osi-pips i[data-pip="${i}"]`);
      if (pip) { pip.style.animationDelay = `${n * step}ms`; pip.classList.add("is-pop"); }
      const k = n, frac = i / size;
      if (k < 14) this._osiLater(() => sfx("roundIn", frac), k * step);
    }
    this._osiLater(() => { sfx("magSeat"); this._osiFlash("is-accent"); this._osiShake(0.22); }, n * step + 60);
  }

  _osiFxLevelUp(form, level, isMax) {
    const ring = form.querySelector(".osi-ring");
    this._osiHitstop(70, () => {
      sfx(isMax ? "maxLow" : "levelUpLow");
      ring?.classList.add("is-burst");
      this._osiSparks(form);
      this._osiShake(0.45);
      this._osiFlash(isMax ? "is-mint" : "is-accent");
      this._osiAlert(isMax
        ? { title: "Максимум", sub: `${esc(this.item.name)} · уровень <b>${level}</b> освоен`, kind: "is-mint", hold: 1500 }
        : { title: `Уровень ${level}`, sub: esc(this.item.name), kind: "is-accent", hold: 1300 });
    });
    this._osiSlamStat("Level");
  }

  /* ---------- примитивы game feel ---------- */
  _osiLater(fn, ms) {
    const id = setTimeout(() => { this._osiTimers.delete(id); try { fn(); } catch (e) { /* окно могли закрыть */ } }, ms);
    this._osiTimers.add(id);
    return id;
  }

  _osiShake(trauma) {
    if (calm()) return;
    const wc = this.element?.[0]?.querySelector(":scope > .window-content");
    if (!wc) return;
    const t = Math.min(1, trauma);
    wc.style.setProperty("--amp", `${(2 + t * t * 16).toFixed(1)}px`);
    wc.style.setProperty("--shake-dur", `${Math.round(220 + t * 380)}ms`);
    wc.classList.remove("is-shake");
    reflow(wc);
    wc.classList.add("is-shake");
    clearTimeout(this._osiShakeT);
    this._osiShakeT = this._osiLater(() => wc.classList.remove("is-shake"), 700);
  }

  _osiHitstop(ms, then) {
    const app = this.element?.[0];
    if (calm() || !app) { then?.(); return; }
    app.classList.add("is-hitstop");
    this._osiLater(() => { app.classList.remove("is-hitstop"); then?.(); }, ms);
  }

  _osiFlash(kind = "") {
    const f = this.element?.[0]?.querySelector(":scope > .osi-fx .osi-flash");
    if (!f) return;
    f.className = `osi-flash ${kind}`.trim();
    reflow(f);
    f.classList.add("is-run");
  }

  _osiSlamStat(key) {
    const st = this._osiForm()?.querySelector(`.osi-stat[data-stat="${key}"]`);
    if (!st || calm()) return;
    st.classList.remove("is-slam");
    reflow(st);
    st.classList.add("is-slam");
  }

  _osiAlert({ title, sub = "", kind = "", hold = 1200 }) {
    const fx = this.element?.[0]?.querySelector(":scope > .osi-fx");
    if (!fx) return;
    fx.querySelector(".osi-alert")?.remove();
    const a = document.createElement("div");
    a.className = `osi-alert ${kind}`.trim();
    a.setAttribute("role", "status");
    a.innerHTML = `<div class="osi-alert-title">${title}</div>${sub ? `<div class="osi-alert-sub">${sub}</div>` : ""}`;
    fx.append(a);
    this._osiLater(() => { a.classList.add("is-out"); this._osiLater(() => a.remove(), 260); }, calm() ? Math.max(hold, 1400) : hold);
  }

  _osiSparks(form) {
    if (calm()) return;
    const box = form.querySelector(".osi-ring-box");
    const fx = this.element?.[0]?.querySelector(":scope > .osi-fx");
    if (!box || !fx) return;
    const r = box.getBoundingClientRect(), f = fx.getBoundingClientRect();
    const cx = r.left + r.width / 2 - f.left, cy = r.top + r.height / 2 - f.top;
    for (let i = 0; i < 14; i++) {
      const sp = document.createElement("i");
      sp.className = "osi-spark";
      sp.style.left = `${cx - 1.5}px`;
      sp.style.top = `${cy - 26}px`;
      sp.style.setProperty("--a", `${(i / 14) * 360 + Math.random() * 10}deg`);
      sp.style.setProperty("--d", `${70 + Math.random() * 40}px`);
      fx.append(sp);
      this._osiLater(() => sp.remove(), 700);
    }
  }

  /* ================================================================== ОКНО */

  setPosition(position = {}) {
    if (position && typeof position === "object") {
      if (Number.isFinite(Number(position.width)) && position.width !== null) position.width = Math.max(720, Number(position.width));
      if (Number.isFinite(Number(position.height)) && position.height !== null) position.height = Math.max(560, Number(position.height));
    }
    const pos = super.setPosition(position);
    try { this._osiPlaceCursor(this._osiForm(), false); } catch (e) { /* окно ещё не готово */ }
    return pos;
  }

  async close(options = {}) {
    const app = this.element?.[0];
    if (app && this.rendered && !this._osiClosing) {
      this._osiClosing = true;
      sfx("itemClose");
      if (!calm()) {
        // jQuery slideUp в Application.close сжимает окно; фиксируем высоту и уходим в сторону
        app.style.setProperty("--osi-h", `${app.offsetHeight}px`);
        app.classList.add("is-leave");
      }
    }
    this._osiTeardown();
    try {
      return await super.close(options);
    } finally {
      this._osiClosing = false;
      this._osiSnap = null;
      this._osiEditPrev = null;
      this._osiIntroDone = false;
    }
  }

  _osiTeardown() {
    for (const id of this._osiTimers) clearTimeout(id);
    this._osiTimers.clear();
  }
}
