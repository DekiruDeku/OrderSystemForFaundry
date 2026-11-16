/**
 * Лист бойца в стиле JRPG-меню (ОПБСАН).
 *
 * Наследует OrderPlayerSheet: getData, все обработчики, диалоги, броски, тренировки,
 * инвентарь, снаряжение и способности работают как в старом листе. Шаблон носит те же
 * классы и name, поэтому activateListeners родителя находит все кнопки.
 *
 * Здесь только слой подачи:
 *  - FX считаются по разнице с прошлым рендером (каждый update актора перерисовывает форму);
 *  - центральные алерты: крит здоровья, предел маг. усталости, срыв;
 *  - цветовая схема «Орден» или «Мой цвет» (от цвета игрока), звук и его выключение;
 *  - строка-хинт, вкладки с вайпом, кадрирование портрета, гайд по листу.
 * Любая ошибка подачи ловится и не мешает механике.
 */
import OrderPlayerSheet from "./OrderPlayerSheet.js";
import OrderSfx from "../../scripts/OrderSfx.js";

const STAT_KEYS = [
  "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge", "Charisma",
  "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
];
const STAT_LABELS = {
  Strength: "Сила", Dexterity: "Ловкость", Stamina: "Выносливость", Accuracy: "Меткость",
  Will: "Стойкость духа", Knowledge: "Знания", Charisma: "Харизма", Seduction: "Обольщение",
  Leadership: "Лидерство", Faith: "Вера", Medicine: "Медицина", Magic: "Магия", Stealth: "Скрытность"
};
const STAT_ICONS = {
  Strength: "strength", Dexterity: "agility", Stamina: "endurance", Accuracy: "accuracy",
  Will: "willpower", Knowledge: "knowledge", Charisma: "charisma", Seduction: "seduction",
  Leadership: "leadership", Faith: "faith", Medicine: "medicine", Magic: "magic", Stealth: "stealth"
};

const TABS = {
  biography: { giant: "Досье" },
  inventory: { giant: "Груз" },
  equipment: { giant: "Арсенал" },
  skills: { giant: "Техники" }
};
const MENU_TILT = [-3, -1.5, -3.5, -2];

const RES = [
  { key: "Health", kind: "hp", label: "Здоровье", top: 0, flag: "Критично", hint: "Число~введите новое здоровье|Полоса~белым показана потеря, она стекает следом" },
  { key: "ManaFatigue", kind: "mana", label: "Маг. усталость", top: 7.4, flag: "Предел", hint: "Число~введите значение|Деления~одно деление = 1 очко усталости" },
  { key: "Stress", kind: "stress", label: "Стресс", top: 14.8, flag: "Срыв близко", hint: "Число~введите значение|Риски~четверти шкалы, от 75% фон тревожится" }
];

const BIO_FIELDS = [
  ["nickname", "Прозвище"], ["faction", "Фракция"], ["rankTitle", "Звание"], ["age", "Возраст"],
  ["birthday", "День рождения"], ["height", "Рост"], ["weight", "Вес"], ["orientation", "Ориентация"]
];
const BIO_TEXTS = [
  ["system.biography", "Биография", (s) => s.biography],
  ["system.bio.positiveTraits", "Позитивные черты характера", (s) => s.bio?.positiveTraits],
  ["system.bio.negativeTraits", "Негативные черты характера", (s) => s.bio?.negativeTraits],
  ["system.bio.fears", "Страхи", (s) => s.bio?.fears],
  ["system.bio.additionalInfo", "Дополнительная информация", (s) => s.bio?.additionalInfo]
];

const DEFAULT_CROP = { x: 50, y: 15, s: 1 };
const ORDER_RED = "#e3172f";

/* Центральные алерты. Иконки обводкой, viewBox 64×64 */
const ALERTS = {
  crit: {
    title: "Критично", label: "Здоровье", sound: "alertCrit", trauma: 0.7,
    icon: `<svg class="osx-al-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6c-12.7 0-22 8.9-22 21 0 7 3.2 12.4 8 15.6V52h6v-5h4v5h8v-5h4v5h6v-9.4c4.8-3.2 8-8.6 8-15.6C54 14.9 44.7 6 32 6z"/>
      <circle class="fill" cx="23.5" cy="28" r="5"/><circle class="fill" cx="40.5" cy="28" r="5"/>
      <path d="M32 35l-3 6h6z"/><path d="M34 6l-3 7 4 3-2 6"/></svg>`
  },
  fatigue: {
    title: "Предел", label: "Маг. усталость", sound: "alertFatigue", trauma: 0.5,
    icon: `<svg class="osx-al-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 54S10 40.5 10 25.5C10 18 15.6 12 22.5 12c4.3 0 7.6 2.2 9.5 5.6C33.9 14.2 37.2 12 41.5 12 48.4 12 54 18 54 25.5 54 40.5 32 54 32 54z"/>
      <path d="M6 50L58 14"/><path d="M58 14l-8 1.5M58 14l-1.5 8"/>
      <path d="M6 50l.8-6.5M6 50l6.5-.8M10.5 46.9l.8-6.5M10.5 46.9l6.5-.8"/></svg>`
  },
  break: {
    title: "Срыв", label: "Стресс", sound: "alertBreak", trauma: 0.65,
    icon: `<svg class="osx-al-icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M40 56v-8h6c2.2 0 4-1.8 4-4v-6l4-2-4-7c0-11-8.5-19-20-19S10 18.5 10 30c0 7 3.4 12.3 8 15.5V56"/>
      <path d="M30 11l-4 9 7 3-6 9 8 2-5 8"/></svg>`
  }
};

const GUIDE = [
  [".osx-p1", "Портрет", "Портрет, ранг, имя, раса и класс. В режиме Edit справа появляются кнопки смены картинки и выбора кадра. Стрелка у ранга открывает мастер повышения."],
  [".osx-stats", "Характеристики", "Кольцо О.О: ЛКМ добавляет сегмент, ПКМ убирает. Название запускает тренировку, кубик открывает бросок. Скорость в конце списка."],
  [".osx-resources", "Показатели", "Здоровье, магическая усталость и стресс. Введите новое число: лист покажет урон, лечение или нагрузку. На пределе по центру выйдет предупреждение."],
  [".osx-effects", "Активные эффекты", "«Дебафф» накладывает состояние со стадией. Наведите на эффект, чтобы сменить стадию или снять его."],
  [".osx-menu", "Разделы", "Биография, инвентарь, снаряжение и способности. С клавиатуры меню листается стрелками."],
  [".osx-hintbar", "Строка подсказок", "Показывает, что сделает клик по элементу под курсором. Справа баланс ГАЦ: клик открывает инвентарь."],
  [".window-header", "Шапка окна", "Edit включает правку. Кнопка с динамиком выключает звук листа, «Вид» открывает громкость, анимации и цвет листа."]
];

const SCHEME_KEYS = [
  "--red", "--red-rgb", "--red-hot", "--red-hot-rgb", "--red-text", "--red-text-rgb",
  "--red-soft-rgb", "--red-deep", "--red-deep-rgb", "--red-ink", "--red-ink-rgb"
];

/* ------------------------------------------------------------------ утилиты */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sumMods = (list) => (Array.isArray(list) ? list.reduce((a, m) => a + (Number(m?.value) || 0), 0) : 0);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
const sfx = (name, arg) => { try { OrderSfx.play(name, arg); } catch (e) { /* звук не ломает лист */ } };
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
const calm = () => reduceMotion() || document.body.classList.contains("order-no-animations");
const reflow = (el) => void el?.offsetWidth;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим: просто не помним */ } }
};
const route = (p) => { try { return foundry.utils.getRoute(p); } catch (e) { return `/${p}`; } };
const rowF = (row) => ((5.6 + (row + 0.5) * (54 / 7)) / 100).toFixed(4);
const normCrop = (c) => ({
  x: clamp(num(c?.x, DEFAULT_CROP.x), 0, 100),
  y: clamp(num(c?.y, DEFAULT_CROP.y), 0, 100),
  s: clamp(num(c?.s, DEFAULT_CROP.s), 1, 2.4)
});
const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/* --- цвет: схема «Мой цвет» строится от цвета игрока --- */
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

/** Токены схемы из одного цвета: светлота базы зажата, чтобы белый текст на ней читался */
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

const playerColor = () => String(game.user?.color ?? ORDER_RED);

export default class OrderPlayerSheetX extends OrderPlayerSheet {

  constructor(...args) {
    super(...args);
    this._osxPrev = null;            // снимок прошлого рендера: из него считаются FX
    this._osxIntroPlayed = false;    // интро один раз на открытие окна
    this._osxTab = null;
    this._osxScroll = {};
    this._osxCropDraft = null;
    this._osxQueue = [];             // новый ранг и алерты идут по очереди
    this._osxOverlayBusy = false;
    this._osxShake = { trauma: 0, raf: 0, last: 0 };
    this._osxPar = { tx: 0, ty: 0, x: 0, y: 0, raf: 0 };
    this._osxGuideStep = -1;
    this._osxHintSrc = null;
    this._osxRO = null;
    this._osxHooks = [];
    this._osxDocListeners = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "osx"],
      template: "systems/Order/templates/sheets/Player-sheet-x.hbs",
      width: 1256,
      height: 715,
      resizable: true,
      scrollY: [".osx-content", ".osx-effects-list"]
    });
  }

  /* ================================================================== ДАННЫЕ */

  getData() {
    const data = super.getData();
    const sys = data.data || {};
    if (!this._osCanEditActor()) this._osxCropDraft = null;

    const stats = STAT_KEYS.map((key, i) => {
      const d = sys[key] || {};
      const value = num(d.value);
      const total = this._calculateSegments(value);
      const mods = sumMods(d.modifiers);
      const label = STAT_LABELS[key];
      return {
        key, label, value, total,
        filled: num(d.filledSegments),
        icon: route(`systems/Order/icons/tag-icons/characteristics/${STAT_ICONS[key]}.svg`),
        modifiers: Array.isArray(d.modifiers) ? d.modifiers : [],
        penalties: Array.isArray(d.weaponPenalties) ? d.weaponPenalties : [],
        modsText: signed(mods),
        modsClass: mods < 0 ? "is-neg" : mods === 0 ? "is-zero" : "",
        isLong: label.length > 12,
        f: rowF(i % 7), n: i, from: i < 7 ? "-18px" : "18px"
      };
    });

    const mv = sys.Movement || {};
    const mvMods = sumMods(mv.modifiers);
    const speed = {
      f: rowF(6),
      modifiers: Array.isArray(mv.modifiers) ? mv.modifiers : [],
      modsText: signed(mvMods),
      modsClass: mvMods < 0 ? "is-neg" : mvMods === 0 ? "is-zero" : ""
    };

    const res = RES.map((r) => {
      const d = sys[r.key] || {};
      const value = num(d.value), max = num(d.max);
      const p = max > 0 ? clamp(value / max, 0, 1) : 0;
      const warn = max > 0 && (r.key === "Health" ? p <= 0.25 : r.key === "Stress" ? p >= 0.75 : value >= max);
      const usePips = r.kind === "mana" && max > 0 && max <= 30;
      return {
        ...r, value, max, warn,
        p: p.toFixed(4),
        fb: ((61 + r.top + 6.8) / 100).toFixed(3),
        pips: usePips ? Array.from({ length: max }, (_, i) => i < value) : null
      };
    });

    const effects = (data.effects || []).map((e) => {
      const of = e?.flags?.Order || {};
      const stage = num(of.stateKey);
      const rawMax = Number(of.maxState);
      const maxKnown = Number.isFinite(rawMax) && rawMax > 0;
      const max = maxKnown ? rawMax : 0;
      return {
        id: e._id ?? e.id,
        name: e.name,
        img: e.img || e.icon || "icons/svg/aura.svg",
        description: e.description ?? "",
        stage, max, maxKnown,
        showControls: !!e.showLevelControls,
        canDec: stage > 1,
        canInc: !maxKnown || stage < max,
        pips: maxKnown && max > 1 && max <= 8 ? Array.from({ length: max }, (_, i) => i < stage) : null
      };
    });

    const count = num(sys.inventoryCount), cap = num(sys.carryingCapacity);
    const maxSlots = num(sys.inventorySlots) + num(sys.quickAccessSlots);
    const inv = {
      count, cap, maxSlots,
      capP: cap > 0 ? clamp(count / cap, 0, 1).toFixed(3) : 0,
      capOver: cap > 0 && count > cap,
      slotsP: maxSlots > 0 ? clamp(count / maxSlots, 0, 1).toFixed(3) : 0,
      slotsOver: count > maxSlots,
      usedCount: (data.usedGrid || []).filter((s) => !s.empty).length,
      cellsCount: (data.inventoryGrid || []).filter((s) => !s.empty && s.slotType !== "over").length,
      storageCount: (data.storageGrid || []).filter((s) => !s.empty).length
    };

    const equipped = (data.equipmentWeapons || []).filter((w) => w.system?.inHand).length
      + (data.equipmentArmors || []).filter((a) => a.system?.isEquiped).length;

    const hp = res[0], st = res[2];
    data.osx = {
      uid: String(this.id || this.actor.id).replace(/[^\w-]/g, ""),
      statsL: stats.slice(0, 7),
      statsR: stats.slice(7),
      speed, res, effects,
      effectsCompact: effects.length > 3,
      critical: hp.max > 0 && hp.value / hp.max <= 0.25,
      stressed: st.max > 0 && st.value / st.max >= 0.75,
      raceName: data.Races?.[0]?.name ?? "",
      rankTitle: sys.bio?.rankTitle ?? "",
      faction: sys.bio?.faction ?? "",
      crop: this._osxCropDraft || this._osxSavedCrop(),
      cropping: !!this._osxCropDraft,
      bioFields: BIO_FIELDS.map(([key, label]) => ({ key, label, value: sys.bio?.[key] ?? "", placeholder: "—" })),
      bioTexts: BIO_TEXTS.map(([name, label, get]) => ({ name, label, value: get(sys) ?? "" })),
      inv,
      rule: {
        biography: sys.bio?.rankTitle ? `Звание: ${sys.bio.rankTitle}` : `Ранг ${num(sys.Rank)}`,
        inventory: `Груз ${count} / ${cap}`,
        equipment: `В руках и на теле: ${equipped}`,
        skills: `Способностей: ${num(data.abilityTotalCount)}`
      },
      gacsText: num(sys.gacs).toLocaleString("ru-RU")
    };
    return data;
  }

  _osxSavedCrop() {
    return normCrop(this.actor?.getFlag?.("Order", "portraitCrop"));
  }

  /* ================================================================== ШАПКА ОКНА */

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    const guide = buttons.find((b) => b.class === "os-guide-toggle");
    if (guide) guide.label = "Гайд";
    const extra = [
      {
        label: "",
        class: "osx-sound-toggle",
        icon: OrderSfx.enabled ? "fas fa-volume-high" : "fas fa-volume-xmark",
        onclick: (ev) => { ev?.preventDefault?.(); this._osxToggleSound(); }
      },
      {
        label: "Вид",
        class: "osx-view-toggle",
        icon: "fas fa-palette",
        onclick: (ev) => { ev?.preventDefault?.(); this._osxToggleView(); }
      }
    ];
    const cfg = buttons.findIndex((b) => String(b.class || "").includes("configure-sheet"));
    if (cfg >= 0) buttons.splice(cfg, 0, ...extra);
    else buttons.unshift(...extra);
    return buttons;
  }

  _osxSyncHeader() {
    const app = this.element?.[0];
    if (!app) return;
    const head = app.querySelector(":scope > .window-header");
    if (!head) return;
    const edit = head.querySelector(".os-edit-toggle");
    if (edit) {
      edit.classList.toggle("active", !!this._osEditMode);
      edit.setAttribute("aria-pressed", String(!!this._osEditMode));
      edit.dataset.hint = "Edit~режим правки: имя, ранг, характеристики, биография, портрет";
    }
    const guide = head.querySelector(".os-guide-toggle");
    if (guide) guide.dataset.hint = "Гайд~пошаговый обзор листа";
    const snd = head.querySelector(".osx-sound-toggle");
    if (snd) {
      const on = OrderSfx.enabled;
      snd.classList.toggle("is-muted", !on);
      snd.setAttribute("aria-label", on ? "Выключить звук листа" : "Включить звук листа");
      snd.setAttribute("aria-pressed", String(!on));
      snd.dataset.hint = on ? "Звук~выключить звуки листа" : "Звук~включить звуки листа";
      const i = snd.querySelector("i");
      if (i) i.className = on ? "fas fa-volume-high" : "fas fa-volume-xmark";
    }
    const view = head.querySelector(".osx-view-toggle");
    if (view) {
      const pop = app.querySelector(":scope > .osx-view");
      const open = !!pop && !pop.hidden;
      view.classList.toggle("is-open", open);
      view.setAttribute("aria-expanded", String(open));
      view.dataset.hint = "Вид~звук, громкость, анимации, цвет листа";
    }
  }

  _osxToggleSound() {
    const on = !OrderSfx.enabled;
    OrderSfx.setEnabled(on);
    if (on) sfx("toggleOn");
    this._osxSyncHeader();
    this._osxSyncView();
  }

  /* --- панель «Вид» --- */
  _osxToggleView(force) {
    const app = this.element?.[0];
    if (!app) return;
    let pop = app.querySelector(":scope > .osx-view");
    const open = force ?? (!pop || pop.hidden);
    if (!pop && !open) return;
    if (!pop) pop = this._osxBuildView(app);
    pop.hidden = !open;
    if (open) this._osxSyncView();
    sfx(open ? "open" : "close");
    this._osxSyncHeader();
  }

  _osxBuildView(app) {
    const pop = document.createElement("div");
    pop.className = "osx-view";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Вид листа");
    pop.innerHTML = `
      <div class="osx-view-row"><span>Звук листа</span><button type="button" class="osx-switch" role="switch" data-view="sound" aria-label="Звук листа"></button></div>
      <div class="osx-view-row"><span>Громкость</span><input type="range" min="0" max="1" step="0.05" data-view="volume" aria-label="Громкость звуков листа" /></div>
      <div class="osx-view-row"><span>Анимации</span><button type="button" class="osx-switch" role="switch" data-view="motion" aria-label="Анимации листа"></button></div>
      <div class="osx-view-row"><span>Цвет листа</span>
        <div class="osx-scheme" role="radiogroup" aria-label="Цветовая схема">
          <button type="button" role="radio" data-scheme="order" style="--sw:${ORDER_RED}"><i></i>Орден</button>
          <button type="button" role="radio" data-scheme="player"><i></i>Мой цвет</button>
        </div>
      </div>
      <p class="osx-view-note">Звук и цвет запоминаются в этом браузере. Кольца обучения всегда в цвете игрока.</p>`;
    app.appendChild(pop);

    pop.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.view === "sound") { this._osxToggleSound(); return; }
      if (b.dataset.view === "motion") {
        const on = document.body.classList.contains("order-no-animations");
        this._osxSetMotion(on);
        sfx(on ? "toggleOn" : "toggleOff");
        this._osxSyncView();
        return;
      }
      if (b.dataset.scheme) {
        store.set("osx-scheme", b.dataset.scheme);
        this._osxApplyScheme();
        this._osxSyncView();
        sfx("select");
      }
    });
    pop.addEventListener("input", (ev) => {
      if (ev.target.dataset.view !== "volume") return;
      OrderSfx.setVolume(Number(ev.target.value));
      sfx("tickUp", Number(ev.target.value));
    });
    return pop;
  }

  _osxSyncView() {
    const pop = this.element?.[0]?.querySelector(":scope > .osx-view");
    if (!pop) return;
    const snd = pop.querySelector("[data-view=sound]");
    if (snd) snd.setAttribute("aria-checked", String(OrderSfx.enabled));
    const vol = pop.querySelector("[data-view=volume]");
    if (vol) vol.value = String(OrderSfx.volume);
    const mot = pop.querySelector("[data-view=motion]");
    if (mot) mot.setAttribute("aria-checked", String(!document.body.classList.contains("order-no-animations")));
    const scheme = store.get("osx-scheme", "order");
    pop.querySelectorAll("[data-scheme]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.scheme === scheme)));
    const mine = pop.querySelector("[data-scheme=player]");
    if (mine) mine.style.setProperty("--sw", playerColor());
  }

  async _osxSetMotion(on) {
    try {
      if (game.settings.settings.has("Order.enableSheetAnimations")) {
        await game.settings.set("Order", "enableSheetAnimations", !!on);
      }
    } catch (e) { /* настройка недоступна */ }
    document.body.classList.toggle("order-no-animations", !on);
    this._osxSyncView();
  }

  /* --- цветовая схема --- */
  _osxApplyScheme() {
    const app = this.element?.[0];
    if (!app) return;
    const scheme = store.get("osx-scheme", "order");
    const tokens = scheme === "player" ? schemeTokens(playerColor()) : null;
    for (const k of SCHEME_KEYS) {
      if (tokens) app.style.setProperty(k, tokens[k]);
      else app.style.removeProperty(k);
    }
    app.style.setProperty("--accent", playerColor());
    app.dataset.scheme = tokens ? "player" : "order";
    this._osxTokens = tokens;
  }

  /* ================================================================== РЕНДЕР */

  activateListeners(html) {
    try { this._osxInjectTrainButtons(html); } catch (err) { console.warn("[Order] OSX: train buttons", err); }
    super.activateListeners(html);
    try { this._osxAfterRender(html); } catch (err) { console.error("[Order] OSX: sheet FX failed", err); }
  }

  /** Кнопка тренировки на карточках навыков и заклинаний (обработчик .train-item есть у родителя) */
  _osxInjectTrainButtons(html) {
    if (!this.actor?.isOwner) return;
    html.find(".skill-card.item, .spell-card.item").each((_, card) => {
      if (card.querySelector(".train-item")) return;
      const item = this.actor.items.get(card.dataset.itemId);
      if (!item || !["Skill", "Spell"].includes(item.type)) return;
      if (item.type === "Skill" && item.system?.isPerk) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "train-item";
      b.title = "Тренировка";
      b.setAttribute("aria-label", `Тренировка: ${item.name}`);
      b.dataset.hintKey = "Книга";
      b.innerHTML = '<i class="fas fa-book-open"></i>';
      b.addEventListener("dblclick", (ev) => ev.stopPropagation());
      card.insertBefore(b, card.querySelector(".roll-dice") || card.querySelector(".skill-tooltip, .spell-tooltip"));
    });
  }

  _osxAfterRender(html) {
    const form = html[0];
    const app = this.element?.[0];
    const stage = form?.querySelector(".osx-stage");
    if (!app || !stage) return;

    this._osxCounters?.clear(); // счётчики прошлой формы: их поля уже удалены
    this._osxBindApp(app);
    app.classList.toggle("is-edit", this._osCanEditActor());
    this._osxApplyScheme();
    this._osxSyncHeader();
    this._osxSyncView();
    this._osxHintSrc = null;
    this._osxRenderHint(null);

    this._osxBindTooltipSkin(html);
    this._osxBindForm(form);
    this._osxBindPortrait(form);
    this._osxObserve(stage);
    requestAnimationFrame(() => this._osxMoveCursor(form, true));
    if (document.fonts?.ready) document.fonts.ready.then(() => { if (this.form === form) this._osxMoveCursor(form, true); });

    const prev = this._osxPrev;
    const now = this._osxSnapshot();
    this._osxPrev = now;
    if (!this._osxIntroPlayed) {
      this._osxIntroPlayed = true;
      this._osxPlayIntro(stage);
    } else if (prev) {
      this._osxDiff(prev, now, form);
    }
    if (this._osxGuideStep >= 0) requestAnimationFrame(() => this._osxGuideShow(this._osxGuideStep, true));
  }

  /** Слушатели уровня окна: окно живёт между рендерами, форма нет */
  _osxBindApp(app) {
    if (app._osxBound) return;
    app._osxBound = true;

    app.addEventListener("pointerover", (e) => {
      this._osxHintFrom(e.target);
      const nav = e.target.closest?.(".osx-menu .navbar");
      if (nav && !nav.contains(e.relatedTarget)) { sfx("move"); return; }
      const row = e.target.closest?.(".osx-stat");
      if (row && !row.contains(e.relatedTarget)) sfx("hover");
    });
    app.addEventListener("focusin", (e) => this._osxHintFrom(e.target));
    app.addEventListener("pointerleave", () => { this._osxHintSrc = null; this._osxRenderHint(null); });

    const onKey = (e) => {
      if (!this.rendered || this.element?.[0] !== app) return;
      const guide = app.querySelector(":scope > .osx-guide:not([hidden])");
      const view = app.querySelector(":scope > .osx-view:not([hidden])");
      if (e.key === "Escape") {
        if (!guide && !view && !this._osxCropDraft) return;
        e.preventDefault();
        e.stopPropagation();
        if (guide) this._osxGuideClose();
        else if (this._osxCropDraft) this._osxEndCrop(false);
        else this._osxToggleView(false);
        return;
      }
      if (guide && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
        e.preventDefault();
        e.stopPropagation(); // иначе стрелки заодно двигают сцену
        this._osxGuideShow(this._osxGuideStep + (e.key === "ArrowRight" ? 1 : -1));
      }
    };
    const onDown = (e) => {
      const view = app.querySelector(":scope > .osx-view:not([hidden])");
      if (view && !e.target.closest?.(".osx-view, .osx-view-toggle")) this._osxToggleView(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    this._osxDocListeners.push(["keydown", onKey, false], ["pointerdown", onDown, true]);

    // Цвет игрока сменился: схема и кольца перекрашиваются
    const hUser = Hooks.on("updateUser", (user, changes) => {
      if (user?.id !== game.user?.id || !("color" in (changes || {}))) return;
      this._osxApplyScheme();
      this._osxSyncView();
      this._osxRedrawRings(this.form);
    });
    // Баннер броска: сообщения с бросками этого бойца
    const hChat = Hooks.on("createChatMessage", (msg) => {
      try { this._osxOnChat(msg); } catch (err) { /* баннер не обязателен */ }
    });
    this._osxHooks.push(["updateUser", hUser], ["createChatMessage", hChat]);
  }

  async close(options = {}) {
    this._osxTeardown();
    return super.close(options);
  }

  _osxTeardown() {
    this._osxRO?.disconnect();
    this._osxRO = null;
    for (const [type, fn, cap] of this._osxDocListeners) document.removeEventListener(type, fn, cap);
    this._osxDocListeners = [];
    for (const [hook, id] of this._osxHooks) Hooks.off(hook, id);
    this._osxHooks = [];
    if (this._osxShake.raf) cancelAnimationFrame(this._osxShake.raf);
    this._osxShake = { trauma: 0, raf: 0, last: 0 };
    const app = this.element?.[0];
    if (app) { app.style.translate = ""; app.style.rotate = ""; }
    this._osxQueue = [];
    this._osxOverlayBusy = false;
    this._osxFinishCounters();
    this._osxPrev = null;
    this._osxIntroPlayed = false;
    this._osxCropDraft = null;
    this._osxGuideStep = -1;
    if (this.rendered) sfx("close");
  }

  setPosition(position = {}) {
    if (position.width) position.width = Math.max(960, position.width);
    if (position.height) position.height = Math.max(600, position.height);
    const pos = super.setPosition(position);
    if (this._osxGuideStep >= 0) requestAnimationFrame(() => this._osxGuideShow(this._osxGuideStep, true));
    return pos;
  }

  /* ================================================================== СТРОКА-ХИНТ */
  // data-hint="Ключ~текст|Ключ2~текст2". Элемент внутри с data-hint-key подсвечивает свой чип.

  _osxHintFrom(target) {
    const src = target?.closest ? target.closest("[data-hint]") : null;
    if (src !== this._osxHintSrc) { this._osxHintSrc = src; this._osxRenderHint(src); }
    const k = target?.closest ? target.closest("[data-hint-key]") : null;
    const key = k && src && src.contains(k) ? k.dataset.hintKey : null;
    this.form?.querySelectorAll(".osx-hint-line:not(.is-out) .osx-hint-chip").forEach((ch) => ch.classList.toggle("is-hot", !!key && ch.dataset.key === key));
  }

  _osxRenderHint(src) {
    const box = this.form?.querySelector(".osx-hint");
    if (!box) return;
    const str = src ? ((this._osCanEditActor() && src.dataset.hintEdit) || src.dataset.hint) : "";
    const line = document.createElement("div");
    line.className = "osx-hint-line";
    line.innerHTML = str
      ? String(str).split("|").filter(Boolean).map((p) => {
        const [k, ...rest] = p.split("~");
        const key = esc(k.trim());
        return `<span class="osx-hint-chip" data-key="${key}"><span class="osx-key">${key}</span><span>${esc(rest.join("~").trim())}</span></span>`;
      }).join('<span class="osx-hint-sep" aria-hidden="true">/</span>')
      : `<span class="osx-hint-default">Наведите курсор на элемент листа: здесь появится, что сделает клик</span>`;
    box.querySelectorAll(".osx-hint-line:not(.is-out)").forEach((o) => { o.classList.add("is-out"); setTimeout(() => o.remove(), 130); });
    if (!calm()) line.classList.add("is-in");
    box.appendChild(line);
  }

  /* ================================================================== ВСПЛЫВАШКИ */
  // Родитель клонирует подсказки в body как .active-tooltip: красим их в тон листа

  _osxBindTooltipSkin(html) {
    const skin = () => {
      document.querySelectorAll("body > .active-tooltip:not(.osx-tip)").forEach((t) => {
        t.classList.add("osx-tip");
        if (this._osxTokens) for (const k of SCHEME_KEYS) t.style.setProperty(k, this._osxTokens[k]);
      });
    };
    html.find(".modifiers-wrapper, .weapon-penalty-wrapper, .skill-card, .spell-card, .inventory-slot[data-item-id]")
      .on("mouseenter", () => { skin(); requestAnimationFrame(skin); });
  }

  /* ================================================================== ФОРМА */

  _osxBindForm(form) {
    // Имя: Enter сохраняет, а не переносит строку
    form.querySelector(".osx-name")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    });

    // Кольцо с клавиатуры: стрелки работают как ЛКМ и ПКМ (обработчик mousedown у родителя)
    form.querySelectorAll("canvas.circle-progress").forEach((cv) => {
      cv.addEventListener("contextmenu", (e) => e.preventDefault());
      cv.addEventListener("keydown", (e) => {
        const up = ["ArrowUp", "ArrowRight", "+", "="].includes(e.key);
        const down = ["ArrowDown", "ArrowLeft", "-"].includes(e.key);
        if (!up && !down) return;
        e.preventDefault();
        e.stopPropagation();
        $(cv).trigger($.Event("mousedown", { button: up ? 0 : 2 }));
      });
    });

    // Кликабельные span/a с клавиатуры
    form.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target;
      if (t.matches?.(".train-characteristic, .osx-tags .item-edit, .osx-tags .item-delete, .osx-gacs")) {
        e.preventDefault();
        t.click();
      }
    });

    // ГАЦ в строке-хинте: открыть инвентарь и поле суммы
    form.querySelector(".osx-gacs")?.addEventListener("click", () => {
      this._osxSwitchTab("inventory");
      setTimeout(() => {
        const inp = this.form?.querySelector('input[name="data.gacs"]');
        if (inp) { inp.focus(); inp.select?.(); }
      }, calm() ? 0 : 260);
    });

    // Звуки нажатий: только запуск бросков и диалогов, результат озвучивает diff после рендера
    form.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t = e.target;
      const die = t.closest?.(".roll-characteristic, .roll-dice, .roll-attack, .roll-ranged-attack");
      if (die) {
        sfx("select");
        if (!calm() && die.classList.contains("osx-d20")) {
          die.classList.remove("is-rolling"); reflow(die); die.classList.add("is-rolling");
          setTimeout(() => die.classList.remove("is-rolling"), 600);
        }
        return;
      }
      if (t.closest?.(".apply-debuff, .train-characteristic, .train-item, [data-action], .item-edit")) sfx("open");
    });

    // Поповер эффекта не вылезает за ширину блока
    const list = form.querySelector(".osx-effects-list");
    list?.addEventListener("pointerover", (e) => {
      const li = e.target.closest?.(".effect-item");
      if (!li || li.dataset.popPlaced) return;
      const W = list.clientWidth, x = li.offsetLeft, popW = 252;
      li.style.setProperty("--pop-x", `${Math.max(-x, Math.min(0, W - popW - x))}px`);
      li.dataset.popPlaced = "1";
    });

    this._osxBuildMotifs(form);
  }

  /* ================================================================== ВКЛАДКИ */

  _initializeTabs(html) {
    const form = html[0];
    const links = Array.from(form?.querySelectorAll(".osx-menu .navbar") ?? []);
    if (!links.length) return super._initializeTabs(html);

    let tab = this._osxTab || store.get("lastActiveTab", "biography");
    if (!TABS[tab] || !form.querySelector(`#${tab}`)) tab = "biography";
    this._osxTab = tab;
    this._osxBuildMotifs(form);
    this._osxApplyTab(form, tab, true);

    links.forEach((a) => {
      a.addEventListener("click", (ev) => { ev.preventDefault(); this._osxSwitchTab(a.dataset.tab); });
      a.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this._osxSwitchTab(a.dataset.tab); return; }
        if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
        ev.preventDefault();
        ev.stopPropagation();
        const i =(links.indexOf(a) + (ev.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links[i].focus();
        this._osxSwitchTab(links[i].dataset.tab);
      });
    });
    const content = form.querySelector(".osx-content");
    content?.addEventListener("scroll", () => { this._osxScroll[this._osxTab] = content.scrollTop; }, { passive: true });
  }

  _osxApplyTab(form, tab, instant) {
    form.querySelectorAll(".osx-menu .navbar").forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle("active", on);
      a.setAttribute("aria-selected", String(on));
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    form.querySelectorAll(".osx-content .tab-bar").forEach((t) => t.classList.toggle("active", t.id === tab));
    const a = form.querySelector(`.osx-menu .navbar[data-tab="${tab}"]`);
    const cap = form.querySelector(".osx-rule-caption"), dat = form.querySelector(".osx-rule-data");
    if (cap) cap.textContent = a?.dataset.caption ?? "";
    if (dat) dat.textContent = a?.dataset.rule ?? "";
    form.querySelectorAll(".osx-motif").forEach((m) => m.classList.toggle("is-active", m.dataset.tab === tab));
    this._osxSetGiant(form, tab, instant);
  }

  _osxSwitchTab(tab) {
    const form = this.form;
    if (!form || !TABS[tab]) return;
    const before = this._osxTab;
    if (before === tab) return;
    const content = form.querySelector(".osx-content");
    if (content && before) this._osxScroll[before] = content.scrollTop;
    this._osxTab = tab;
    store.set("lastActiveTab", tab);

    form.querySelectorAll(".osx-menu .navbar").forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle("active", on);
      a.setAttribute("aria-selected", String(on));
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    this._osxMoveCursor(form, false);

    const swap = () => {
      if (this.form !== form) return;
      this._osxApplyTab(form, tab, false);
      if (content) content.scrollTop = this._osxScroll[tab] || 0;
      const pane = form.querySelector(`#${tab}`);
      if (pane && !calm()) pane.animate([{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" });
    };
    sfx("tab");
    if (calm()) { swap(); return; }
    sfx("swoosh");
    const [w1, w2] = form.querySelectorAll(".osx-wipe i");
    const kf = [{ transform: "translateX(-160%) skewX(-18deg)" }, { transform: "translateX(260%) skewX(-18deg)" }];
    w1?.animate(kf, { duration: 440, easing: "cubic-bezier(.76,0,.24,1)", fill: "both" });
    w2?.animate(kf, { duration: 440, delay: 50, easing: "cubic-bezier(.76,0,.24,1)", fill: "both" });
    setTimeout(swap, 200);
  }

  _osxMoveCursor(form, instant) {
    const a = form?.querySelector(".osx-menu .navbar.active");
    const cur = form?.querySelector(".osx-menu-cursor");
    const app = this.element?.[0];
    if (!a || !cur || !app) return;
    const i = Number(a.style.getPropertyValue("--i")) || 0;
    const step = parseFloat(getComputedStyle(app).getPropertyValue("--step")) || 7;
    const quiet = instant || calm();
    if (quiet) cur.style.transition = "none";
    cur.style.setProperty("--cx", `${a.offsetLeft - i * step - 18}px`);
    cur.style.setProperty("--cy", `${a.offsetTop + 3}px`);
    cur.style.setProperty("--cw", `${a.offsetWidth + 16}px`);
    cur.style.setProperty("--ch", `${a.offsetHeight - 6}px`);
    cur.style.setProperty("--cr", `${MENU_TILT[i] || 0}deg`);
    if (quiet) { reflow(cur); cur.style.transition = ""; }
  }

  _osxSetGiant(form, tab, instant) {
    const g = form.querySelector(".osx-giant");
    if (!g) return;
    const text = TABS[tab]?.giant ?? "";
    const old = Array.from(g.querySelectorAll("span:not(.is-leaving)"));
    if (old.length === 1 && old[0].textContent === text) return;
    const s = document.createElement("span");
    s.textContent = text;
    g.appendChild(s);
    old.forEach((o) => {
      if (instant || calm()) { o.remove(); return; }
      o.classList.add("is-leaving");
      o.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(-5%)", opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" }).onfinish = () => o.remove();
    });
    if (!instant && !calm()) s.animate([{ transform: "translateX(7%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 640, easing: "cubic-bezier(.19,1,.22,1)" });
  }

  /** Фоновые мотивы разделов. Цвет через переменные, поэтому меняется со схемой */
  _osxBuildMotifs(form) {
    const host = form?.querySelector(".osx-motifs");
    if (!host || host.childElementCount) return;
    const st = 'style="stroke:rgba(255,240,244,0.075)"';
    const red = (w) => `style="stroke:rgba(var(--red-hot-rgb),0.22);stroke-width:${w}"`;
    let fp = "";
    for (let i = 0; i < 12; i++) {
      fp += `<ellipse cx="200" cy="200" rx="${26 + i * 13}" ry="${34 + i * 14.5}" stroke-dasharray="${40 + ((i * 53) % 120)} ${6 + ((i * 17) % 22)}" stroke-dashoffset="${i * 31}"/>`;
    }
    let ticks = "";
    for (let a = 0; a < 360; a += 5) {
      const r0 = a % 30 === 0 ? 158 : 168, rad = (a * Math.PI) / 180;
      ticks += `<line x1="${(200 + r0 * Math.cos(rad)).toFixed(1)}" y1="${(200 + r0 * Math.sin(rad)).toFixed(1)}" x2="${(200 + 182 * Math.cos(rad)).toFixed(1)}" y2="${(200 + 182 * Math.sin(rad)).toFixed(1)}"/>`;
    }
    const tri = (r, rot) => `<polygon points="${[0, 1, 2].map((k) => { const a = ((rot + k * 120 - 90) * Math.PI) / 180; return `${(200 + r * Math.cos(a)).toFixed(1)},${(200 + r * Math.sin(a)).toFixed(1)}`; }).join(" ")}"/>`;
    let runes = "";
    for (let k = 0; k < 36; k++) runes += `<rect x="198" y="${k % 2 ? 24 : 20}" width="${k % 3 ? 4 : 7}" height="${k % 2 ? 9 : 14}" transform="rotate(${k * 10} 200 200)"/>`;
    host.innerHTML = `
      <svg class="osx-motif" data-tab="biography" viewBox="0 0 400 400">
        <g class="spin" fill="none" ${st} stroke-width="2.4">${fp}</g>
        <circle class="spin-rev" cx="200" cy="200" r="194" fill="none" ${red(1.2)} stroke-dasharray="2 9"/>
        <path d="M200 0v34M200 366v34M0 200h34M366 200h34" ${st} stroke-width="2"/>
      </svg>
      <div class="osx-motif" data-tab="inventory"><div class="osx-motif-mesh"></div></div>
      <svg class="osx-motif" data-tab="equipment" viewBox="0 0 400 400">
        <g fill="none" ${st} stroke-width="2"><circle cx="200" cy="200" r="140"/><circle cx="200" cy="200" r="96" stroke-dasharray="6 10"/><circle cx="200" cy="200" r="34"/><path d="M200 30v120M200 250v120M30 200h120M250 200h120"/></g>
        <g class="spin-rev" ${st} stroke-width="2">${ticks}</g>
        <path d="M186 188h28l-14 24z" style="fill:rgba(var(--red-hot-rgb),0.22)"/>
      </svg>
      <svg class="osx-motif" data-tab="skills" viewBox="0 0 400 400">
        <g fill="none" ${red(1.6)}><circle cx="200" cy="200" r="188"/><circle cx="200" cy="200" r="150"/></g>
        <g class="spin" style="fill:rgba(var(--red-hot-rgb),0.2)">${runes}</g>
        <g class="spin-rev" fill="none" ${st} stroke-width="2">${tri(150, 0)}${tri(150, 180)}<circle cx="200" cy="200" r="76"/></g>
        <g class="spin-fast" fill="none" ${red(1.4)}><rect x="146" y="146" width="108" height="108" transform="rotate(45 200 200)"/></g>
      </svg>`;
    host.querySelectorAll(".osx-motif").forEach((m) => m.classList.toggle("is-active", m.dataset.tab === this._osxTab));
  }

  /* ================================================================== КОЛЬЦА О.О */

  /** Кольцо на canvas: заполненные сегменты цветом игрока, следующий чуть светлее */
  _drawCircle(canvas, filledSegments, totalSegments, fx = null) {
    if (!canvas?.getContext) return;
    const total = Math.max(1, Number(totalSegments) || 1);
    const filled = clamp(Number(filledSegments) || 0, 0, total);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = canvas.clientWidth || 44;
    const px = Math.round(size * dpr), k = size / 44;
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    const c = canvas.getContext("2d");
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    c.clearRect(0, 0, 44, 44);
    const color = playerColor();
    const cx = 22, cy = 22, r = 18.6, step = (Math.PI * 2) / total, gap = Math.min(step * 0.42, 1.7 / r);
    c.lineCap = "butt";
    for (let i = 0; i < total; i++) {
      const a0 = -Math.PI / 2 + i * step + gap / 2, a1 = a0 + step - gap;
      c.beginPath();
      c.arc(cx, cy, r, a0, a1);
      c.lineWidth = 4;
      c.strokeStyle = i < filled ? color : i === filled ? "rgba(255,240,244,0.32)" : "rgba(255,240,244,0.12)";
      c.stroke();
      if (fx && fx.i === i && fx.a > 0) {
        c.beginPath();
        c.arc(cx, cy, r, a0, a1);
        c.lineWidth = 4 + 3 * fx.a;
        c.strokeStyle = `rgba(255,255,255,${fx.a.toFixed(3)})`;
        c.stroke();
      }
    }
    c.beginPath();
    c.arc(cx, cy, 14.2, 0, Math.PI * 2);
    c.lineWidth = 1;
    c.strokeStyle = "rgba(255,240,244,0.09)";
    c.stroke();
    canvas.setAttribute("aria-valuenow", String(filled));
    canvas.setAttribute("aria-valuemax", String(total));
  }

  _osxRedrawRings(form) {
    form?.querySelectorAll("canvas.circle-progress").forEach((cv) => {
      const d = this.actor.system?.[cv.dataset.attribute];
      if (!d) return;
      const value = num(d.value);
      this._drawCircle(cv, num(d.filledSegments), this._calculateSegments(value));
    });
  }

  _osxFlashSegment(cv, filled, total, idx) {
    if (!cv) return;
    if (calm()) { this._drawCircle(cv, filled, total); return; }
    const t0 = performance.now();
    const tick = (t) => {
      if (!cv.isConnected) return;
      const k = Math.min(1, (t - t0) / 300);
      this._drawCircle(cv, filled, total, { i: idx, a: 1 - k });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ================================================================== ПОРТРЕТ */

  /** Смена картинки только в режиме Edit и не во время выбора кадра */
  _onEditImage(event) {
    if (this._osxCropDraft) return;
    if (!this._osCanEditActor()) return;
    return super._onEditImage(event);
  }

  _osxApplyCrop(img, c) {
    if (!img) return;
    img.style.setProperty("--pc-x", `${c.x}%`);
    img.style.setProperty("--pc-y", `${c.y}%`);
    img.style.setProperty("--pc-s", String(c.s));
  }

  _osxBindPortrait(form) {
    const p1 = form.querySelector(".osx-p1");
    const img = form.querySelector(".osx-portrait-img");
    const stage = form.querySelector(".osx-stage");
    if (!img || !p1 || !stage) return;

    img.addEventListener("load", () => this._osxApplyCrop(img, this._osxCropDraft || this._osxSavedCrop()));

    // Параллакс: сдвиг не больше запаса от масштаба, без пустых краёв
    const par = this._osxPar;
    const parTick = () => {
      par.x += (par.tx - par.x) * 0.12;
      par.y += (par.ty - par.y) * 0.12;
      img.style.setProperty("--px", `${par.x.toFixed(2)}px`);
      img.style.setProperty("--py", `${par.y.toFixed(2)}px`);
      par.raf = img.isConnected && Math.abs(par.tx - par.x) + Math.abs(par.ty - par.y) > 0.05 ? requestAnimationFrame(parTick) : 0;
    };
    stage.addEventListener("pointermove", (e) => {
      if (calm() || this._osxCropDraft) return;
      const r = stage.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = (e.clientY - r.top) / r.height * 2 - 1;
      const room = Math.min(7, Math.max(0, ((this._osxSavedCrop().s || 1) - 1) * 60));
      par.tx = -nx * room;
      par.ty = -ny * room * 0.6;
      if (!par.raf) par.raf = requestAnimationFrame(parTick);
    });

    // Кнопки есть в разметке только в режиме Edit
    form.querySelector(".osx-crop-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (this._osxCropDraft) this._osxEndCrop(true); else this._osxStartCrop();
    });
    form.querySelector(".osx-crop-done")?.addEventListener("click", (e) => { e.preventDefault(); this._osxEndCrop(true); });
    form.querySelector(".osx-crop-reset")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!this._osxCropDraft) return;
      this._osxCropDraft = { ...DEFAULT_CROP };
      this._osxApplyCrop(img, this._osxCropDraft);
      sfx("swoosh");
    });
    form.querySelector(".osx-swap-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (this._osxCropDraft) this._osxEndCrop(false);
      img.click();
    });

    // Кадрирование: тянуть, колесо, двойной клик
    let drag = null;
    const coverSize = () => {
      const fw = img.clientWidth, fh = img.clientHeight;
      const ar = (img.naturalWidth || 3) / (img.naturalHeight || 4);
      return ar > fw / fh ? { fw, fh, cw: fh * ar, ch: fh } : { fw, fh, cw: fw, ch: fw / ar };
    };
    img.addEventListener("pointerdown", (e) => {
      if (!this._osxCropDraft) return;
      e.preventDefault();
      img.setPointerCapture?.(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: this._osxCropDraft.x, cy: this._osxCropDraft.y };
    });
    img.addEventListener("pointermove", (e) => {
      const d = this._osxCropDraft;
      if (!drag || !d) return;
      // object-position с масштабом: left = x·(W − s·cw), отсюда сдвиг в % на пиксель курсора
      const { fw, fh, cw, ch } = coverSize();
      const roomX = fw - d.s * cw, roomY = fh - d.s * ch;
      if (Math.abs(roomX) > 1) d.x = clamp(drag.cx + ((e.clientX - drag.x) / roomX) * 100, 0, 100);
      if (Math.abs(roomY) > 1) d.y = clamp(drag.cy + ((e.clientY - drag.y) / roomY) * 100, 0, 100);
      this._osxApplyCrop(img, d);
    });
    const up = () => { if (drag) { drag = null; sfx("drop"); } };
    img.addEventListener("pointerup", up);
    img.addEventListener("pointercancel", up);
    img.addEventListener("wheel", (e) => {
      const d = this._osxCropDraft;
      if (!d) return;
      e.preventDefault();
      d.s = clamp(+(d.s - e.deltaY * 0.0012).toFixed(3), 1, 2.4);
      this._osxApplyCrop(img, d);
      sfx(e.deltaY < 0 ? "tickUp" : "tickDown", (d.s - 1) / 1.4);
    }, { passive: false });
    img.addEventListener("dblclick", () => {
      if (!this._osxCropDraft) return;
      this._osxCropDraft = { ...DEFAULT_CROP };
      this._osxApplyCrop(img, this._osxCropDraft);
      sfx("swoosh");
    });
  }

  _osxSetCropUi(on) {
    const form = this.form;
    if (!form) return;
    form.querySelector(".osx-p1")?.classList.toggle("is-cropping", on);
    const ui = form.querySelector(".osx-crop-ui");
    if (ui) ui.hidden = !on;
    form.querySelector(".osx-crop-btn")?.setAttribute("aria-pressed", String(on));
  }

  _osxStartCrop() {
    if (!this._osCanEditActor()) return;
    this._osxCropDraft = { ...this._osxSavedCrop() };
    this._osxSetCropUi(true);
    const par = this._osxPar;
    par.tx = par.ty = par.x = par.y = 0;
    const img = this.form?.querySelector(".osx-portrait-img");
    img?.style.setProperty("--px", "0px");
    img?.style.setProperty("--py", "0px");
    sfx("toggleOn");
  }

  _osxEndCrop(save) {
    const draft = this._osxCropDraft;
    if (!draft) return;
    this._osxCropDraft = null;
    this._osxSetCropUi(false);
    const img = this.form?.querySelector(".osx-portrait-img");
    if (save) {
      sfx("confirm");
      this._osxApplyCrop(img, draft);
      this.actor.setFlag("Order", "portraitCrop", normCrop(draft)).catch((err) => console.warn("[Order] OSX: crop not saved", err));
    } else {
      sfx("cancel");
      this._osxApplyCrop(img, this._osxSavedCrop());
    }
  }

  /* ================================================================== FX ПО РАЗНИЦЕ РЕНДЕРОВ */

  _osxSnapshot() {
    const s = this.actor.system || {};
    const res = {};
    for (const r of RES) res[r.key] = { value: num(s[r.key]?.value), max: num(s[r.key]?.max) };
    const stats = {};
    for (const k of STAT_KEYS) stats[k] = { value: num(s[k]?.value), filled: num(s[k]?.filledSegments) };
    const effects = new Map();
    for (const e of this.actor.effects ?? []) effects.set(e.id, num(e.flags?.Order?.stateKey));
    return { res, stats, effects, rank: num(s.Rank), gacs: num(s.gacs), img: this.actor.img, edit: !!this._osEditMode };
  }

  _osxDiff(prev, now, form) {
    const quiet = calm();

    if (prev.edit !== now.edit) sfx(now.edit ? "toggleOn" : "toggleOff");

    // портрет сменился
    if (prev.img !== now.img) {
      sfx("glitch");
      const img = form.querySelector(".osx-portrait-img");
      if (img && !quiet) {
        img.classList.add("is-glitch");
        setTimeout(() => img.classList.remove("is-glitch"), 340);
      }
    }

    // ранг
    if (now.rank > prev.rank) {
      const from = prev.rank, to = now.rank;
      this._osxEnqueue((done) => this._osxCelebrate(from, to, done));
    } else if (now.rank < prev.rank) {
      this._osxStampRank();
      sfx("stamp");
    }

    // характеристики: один звук на весь рендер, всплывашки на каждую строку
    let statSound = null;
    for (const k of STAT_KEYS) {
      const a = prev.stats[k], b = now.stats[k];
      if (!a || !b) continue;
      const row = form.querySelector(`.osx-stat[data-key="${k}"]`);
      if (!row) continue;
      const ring = row.querySelector(".osx-ring");
      const cv = row.querySelector("canvas.circle-progress");
      if (b.value !== a.value) {
        const dir = b.value > a.value ? 1 : -1;
        const val = row.querySelector(".osx-ring-value");
        if (!quiet && val) val.classList.add(dir > 0 ? "is-roll-up" : "is-roll-down");
        if (dir > 0) {
          statSound = "levelSmall";
          if (!quiet && ring) { ring.classList.add("is-burst"); setTimeout(() => ring.classList.remove("is-burst"), 560); }
          this._osxFloat(form, ring, `${STAT_LABELS[k]} ${b.value}`, "lvl");
        } else {
          statSound = statSound || "levelDown";
          this._osxFloat(form, ring, `${b.value}`, "dmg");
        }
      } else if (b.filled !== a.filled) {
        const total = this._calculateSegments(b.value);
        if (b.filled > a.filled) {
          statSound = statSound || ["tickUp", b.filled / total];
          this._osxFlashSegment(cv, b.filled, total, b.filled - 1);
        } else {
          statSound = statSound || "tickDown";
        }
      }
    }
    if (statSound) Array.isArray(statSound) ? sfx(...statSound) : sfx(statSound);

    // ресурсы
    for (const r of RES) this._osxResourceFx(form, r.key, prev.res[r.key], now.res[r.key]);

    // алерты: порог пересечён в этом обновлении
    const alerts = [];
    const crossedUp = (a, b) => b.max > 0 && a.value < (a.max || b.max) && b.value >= b.max;
    const hp0 = prev.res.Health, hp1 = now.res.Health;
    if (hp1.max > 0 && hp0.value / (hp0.max || hp1.max) > 0.25 && hp1.value / hp1.max <= 0.25) alerts.push(["crit", hp1]);
    if (crossedUp(prev.res.ManaFatigue, now.res.ManaFatigue)) alerts.push(["fatigue", now.res.ManaFatigue]);
    if (crossedUp(prev.res.Stress, now.res.Stress)) alerts.push(["break", now.res.Stress]);
    alerts.forEach(([kind, v], i) => {
      setTimeout(() => this._osxEnqueue((done) => this._osxAlert(kind, v, done)), quiet ? 0 : 420 + i * 40);
    });

    // эффекты
    let effSound = null;
    for (const [id, stage] of now.effects) {
      const li = form.querySelector(`.effect-item[data-effect-id="${id}"]`);
      if (!prev.effects.has(id)) {
        if (li && !quiet) li.classList.add("is-stamp");
        effSound = "stamp";
      } else if (stage > prev.effects.get(id)) {
        const was = prev.effects.get(id);
        if (li && !quiet) {
          li.querySelectorAll(".osx-pips i").forEach((p, i) => {
            if (i >= was && i < stage) p.animate([{ transform: "skewX(-12deg) scaleY(2)" }, { transform: "skewX(-12deg)" }], { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" });
          });
        }
        effSound = effSound || "stamp";
      } else if (stage < prev.effects.get(id)) {
        effSound = effSound || "tickDown";
      }
    }
    if (!effSound && [...prev.effects.keys()].some((id) => !now.effects.has(id))) effSound = "rip";
    if (effSound) {
      sfx(effSound);
      if (effSound === "stamp") this._osxTrauma(0.12);
    }

    // ГАЦ
    if (now.gacs !== prev.gacs) {
      sfx(now.gacs > prev.gacs ? "pick" : "drop");
      const b = form.querySelector(".osx-gacs b");
      if (b && !quiet) {
        const from = prev.gacs, to = now.gacs, t0 = performance.now();
        const tick = (t) => {
          if (!b.isConnected) return;
          const k = Math.min(1, (t - t0) / 520), e = 1 - Math.pow(1 - k, 3);
          b.textContent = Math.round(from + (to - from) * e).toLocaleString("ru-RU");
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }
  }

  _osxResourceFx(form, key, was, cur) {
    if (!was || !cur || was.value === cur.value) return;
    const row = form.querySelector(`.osx-res[data-res="${key}"]`);
    if (!row) return;
    const quiet = calm();
    const from = was.value, to = cur.value, delta = to - from;
    const max = cur.max || was.max || 1;
    const pFrom = clamp(from / max, 0, 1), pTo = clamp(to / max, 0, 1);
    const input = row.querySelector(".osx-res-value");
    const anchor = row.querySelector(".os-resource-values");
    const fill = row.querySelector(".os-bar-fill"), ghost = row.querySelector(".osx-bar-ghost");
    const ease = "cubic-bezier(.19,1,.22,1)";

    // урон: заливка сразу на новом месте, белый «призрак» держится и стекает следом
    if (key === "Health" && delta < 0) {
      const frac = -delta / max;
      const tier = frac >= 0.25 ? 3 : frac >= 0.1 ? 2 : 1;
      const stop = quiet ? 0 : (tier === 3 ? 120 : tier === 2 ? 50 : 0);
      sfx("damage", tier);
      this._osxFlash(form, "dmg");
      if (ghost) { ghost.style.transition = "none"; ghost.style.setProperty("--p", pFrom); }
      this._osxCountTo(input, from, to, 380, stop);
      setTimeout(() => {
        this._osxTrauma(tier === 3 ? 0.8 : tier === 2 ? 0.42 : 0.16);
        if (ghost) {
          reflow(ghost);
          ghost.style.transition = `transform 520ms ${ease} ${quiet ? 0 : 360}ms`;
          ghost.style.setProperty("--p", pTo);
        }
        this._osxFloat(form, anchor, `−${-delta}`, "dmg");
      }, stop);
      return;
    }

    // рост и прочие изменения: заливка и призрак едут вместе от прошлого значения
    if (fill && !quiet) {
      fill.style.transition = "none";
      fill.style.setProperty("--p", pFrom);
      if (ghost) { ghost.style.transition = "none"; ghost.style.setProperty("--p", pFrom); }
      reflow(fill);
      fill.style.transition = `transform 520ms ${ease}`;
      fill.style.setProperty("--p", pTo);
      if (ghost) { ghost.style.transition = `transform 520ms ${ease}`; ghost.style.setProperty("--p", pTo); }
    }

    if (key === "Health") {
      sfx("heal");
      this._osxFlash(form, "heal");
      if (!quiet) row.classList.add("is-heal");
      this._osxFloat(form, anchor, `+${delta}`, "heal");
    } else if (key === "Stress") {
      const crossed = from / max < 0.75 && to / max >= 0.75;
      sfx(delta > 0 ? "stress" : "tickDown");
      if (crossed) { setTimeout(() => sfx("glitch"), 120); this._osxTrauma(0.28); }
      this._osxFloat(form, anchor, delta > 0 ? `+${delta}` : `−${-delta}`, "stress");
    } else {
      // маг. усталость: рост это плохо, звук тревожный; спад звучит облегчением
      sfx(delta > 0 ? "fatigueUp" : "fatigueDown");
      if (delta > 0 && !quiet) {
        row.querySelectorAll(".osx-pipbar i").forEach((pip, i) => { if (i >= from && i < to) pip.classList.add("is-pop"); });
        this._osxTrauma(0.1);
      }
      this._osxFloat(form, anchor, delta > 0 ? `+${delta}` : `−${-delta}`, "mana");
    }
    this._osxCountTo(input, from, to, 420);
  }

  /**
   * Счётчик в поле ресурса. Пока он идёт, в поле промежуточное число, поэтому каждый
   * счётчик записан в _osxCounters: перед отправкой формы _getSubmitData ставит итог.
   */
  _osxCountTo(input, from, to, dur = 420, delay = 0) {
    if (!input) return;
    if (calm() || document.activeElement === input) { input.value = to; return; }
    const counters = (this._osxCounters ??= new Map());
    counters.set(input, to);
    input.value = from;
    const start = () => {
      if (!counters.has(input)) return;
      const t0 = performance.now();
      const step = (t) => {
        if (!counters.has(input)) return;
        if (!input.isConnected || document.activeElement === input) { input.value = to; counters.delete(input); return; }
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        input.value = Math.round(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step);
        else counters.delete(input);
      };
      requestAnimationFrame(step);
    };
    if (delay > 0) setTimeout(start, delay); else start();
  }

  /** Все счётчики сразу в итог: в форму не попадёт промежуточное значение */
  _osxFinishCounters() {
    const counters = this._osxCounters;
    if (!counters?.size) return;
    for (const [input, to] of counters) input.value = to;
    counters.clear();
  }

  _getSubmitData(updateData = {}) {
    try { this._osxFinishCounters(); } catch (e) { /* ignore */ }
    return super._getSubmitData(updateData);
  }

  _osxFlash(form, kind) {
    const f = form.querySelector(".osx-flash");
    if (!f || calm()) return;
    f.classList.remove("is-dmg", "is-heal");
    reflow(f);
    f.classList.add(kind === "heal" ? "is-heal" : "is-dmg");
  }

  _osxFloat(form, anchor, text, kind) {
    const stage = form.querySelector(".osx-stage");
    if (!stage || !anchor || calm()) return;
    const s = stage.getBoundingClientRect(), r = anchor.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = `osx-float osx-float--${kind}`;
    el.textContent = text;
    el.style.left = `${r.left - s.left + r.width / 2}px`;
    el.style.top = `${r.top - s.top - 6}px`;
    el.style.setProperty("--dx", `${Math.round(Math.random() * 24 - 12)}px`);
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  _osxStampRank() {
    const r = this.form?.querySelector(".osx-rank");
    if (!r || calm()) return;
    r.classList.remove("is-stamped");
    reflow(r);
    r.classList.add("is-stamped");
  }

  /* --- тряска окна по «травме»: смещение = травма², травма гаснет сама --- */
  _osxTrauma(v) {
    if (calm()) return;
    const sh = this._osxShake;
    sh.trauma = Math.min(1, sh.trauma + v);
    if (!sh.raf) { sh.last = performance.now(); sh.raf = requestAnimationFrame((t) => this._osxShakeTick(t)); }
  }

  _osxShakeTick(now) {
    const sh = this._osxShake;
    const app = this.element?.[0];
    if (!app) { sh.raf = 0; sh.trauma = 0; return; }
    const dt = Math.min(0.05, (now - sh.last) / 1000);
    sh.last = now;
    sh.trauma = Math.max(0, sh.trauma - dt * 1.8);
    const s = sh.trauma * sh.trauma, t = now / 1000;
    const n = (k) => Math.sin(t * 53 + k) * 0.6 + Math.sin(t * 91 + k * 2.7) * 0.4;
    app.style.translate = `${(11 * s * n(1)).toFixed(2)}px ${(8 * s * n(7)).toFixed(2)}px`;
    app.style.rotate = `${(0.8 * s * n(13)).toFixed(3)}deg`;
    if (sh.trauma > 0) sh.raf = requestAnimationFrame((tt) => this._osxShakeTick(tt));
    else { app.style.translate = ""; app.style.rotate = ""; sh.raf = 0; }
  }

  /* ================================================================== ЦЕНТРАЛЬНЫЕ СООБЩЕНИЯ */
  // Слой живёт на уровне окна (.osx-fxhost): перерисовка формы не обрывает анимацию

  _osxFxHost() {
    const app = this.element?.[0];
    if (!app) return null;
    let host = app.querySelector(":scope > .osx-fxhost");
    if (!host) {
      host = document.createElement("div");
      host.className = "osx-fxhost";
      app.appendChild(host);
    }
    return host;
  }

  _osxEnqueue(job) {
    this._osxQueue.push(job);
    if (!this._osxOverlayBusy) this._osxNextOverlay();
  }

  _osxNextOverlay() {
    const job = this._osxQueue.shift();
    if (!job || !this.rendered) { this._osxOverlayBusy = false; return; }
    this._osxOverlayBusy = true;
    let finished = false;
    const done = () => { if (finished) return; finished = true; this._osxNextOverlay(); };
    try { job(done); } catch (err) { console.warn("[Order] OSX overlay", err); done(); }
  }

  _osxOverlay(className, inner, { ms = 2700, onClose } = {}, done) {
    const host = this._osxFxHost();
    if (!host || this._minimized) { done(); return; }
    const el = document.createElement("div");
    el.className = className;
    el.setAttribute("role", "status");
    el.innerHTML = inner;
    host.appendChild(el);
    let closed = false, timer = 0;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const finish = () => { el.remove(); try { onClose?.(); } catch (e) { /* ignore */ } done(); };
      if (calm()) finish();
      else { el.classList.add("is-out"); setTimeout(finish, 200); }
    };
    el.addEventListener("click", close);
    timer = setTimeout(close, calm() ? 1600 : ms);
  }

  _osxCelebrate(from, to, done) {
    let sparks = "";
    for (let i = 0; i < 16; i++) sparks += `<i class="osx-spark" style="--a:${i * 22.5 + (i % 2) * 8}deg;--d:${150 + (i % 3) * 60}px"></i>`;
    const inner = `<div class="osx-lu-band"></div><div class="osx-lu-band"></div><div class="osx-lu-band"></div>
      <div class="osx-lu-text">
        <span class="osx-lu-title">Новый ранг</span>
        <span class="osx-lu-rank"><s>${esc(from)}</s><i class="fas fa-arrow-right" aria-hidden="true"></i>${esc(to)}</span>
        <span class="osx-lu-kicker">${esc(this.actor.name)}</span>
      </div>${sparks}`;
    sfx("rankUp");
    this._osxTrauma(0.3);
    this._osxOverlay("osx-levelup", inner, {
      onClose: () => { this._osxStampRank(); sfx("stamp"); }
    }, done);
  }

  _osxAlert(kind, v, done) {
    const a = ALERTS[kind];
    if (!a) { done(); return; }
    const inner = `<div class="osx-al-veil"></div><div class="osx-al-band"></div><div class="osx-al-band"></div><div class="osx-al-band"></div>
      <div class="osx-al-text">
        ${a.icon}
        <span class="osx-al-title">${a.title}</span>
        <span class="osx-al-line">${esc(v.value)} / ${esc(v.max)}<small>${a.label}</small></span>
        <span class="osx-al-kicker">${esc(this.actor.name)}</span>
      </div>`;
    sfx(a.sound);
    this._osxTrauma(a.trauma);
    this._osxOverlay(`osx-alert osx-alert--${kind}`, inner, { ms: 2900 }, done);
  }

  /* --- баннер броска из чата --- */
  _osxOnChat(msg) {
    if (!this.rendered || this._minimized) return;
    if (msg?.speaker?.actor !== this.actor?.id) return;
    const rolls = msg.rolls ?? [];
    if (!rolls.length || msg.isContentVisible === false) return;
    const roll = rolls.find((r) => r.dice?.some((d) => d.faces === 20));
    if (!roll) return;
    const die = roll.dice.find((d) => d.faces === 20);
    const results = die.results ?? [];
    const active = results.filter((r) => r.active !== false && !r.discarded);
    const other = results.filter((r) => r.active === false || r.discarded);
    const nat = active[0]?.result;
    if (!Number.isFinite(nat)) return;
    const title = (stripHtml(msg.flavor) || "Бросок").slice(0, 48);
    this._osxBanner({ title, kind: this.actor.name, nat, other: other[0]?.result, math: roll.formula, total: roll.total });
  }

  async _osxBanner({ title, kind, nat, other, math, total }) {
    const host = this._osxFxHost();
    if (!host) return;
    host.querySelectorAll(".osx-banner").forEach((b) => b.remove());
    const banner = document.createElement("div");
    banner.className = "osx-banner";
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = `<div class="osx-bn">
        <div class="osx-bn-title">${esc(title)}</div>
        <div class="osx-bn-kind">${esc(kind)}</div>
        <div class="osx-bn-roll"><span class="osx-bn-die">20</span><span class="osx-bn-math">${esc(math)}</span><span class="osx-bn-total">…</span></div>
      </div>`;
    host.appendChild(banner);
    const dieEl = banner.querySelector(".osx-bn-die"), totEl = banner.querySelector(".osx-bn-total"), bn = banner.querySelector(".osx-bn");
    sfx("diceRattle");
    if (!calm()) {
      for (let i = 0; i < 8; i++) {
        dieEl.textContent = String(1 + Math.floor(Math.random() * 20));
        if (i % 3 === 2) sfx("diceRattle");
        await new Promise((r) => setTimeout(r, 42 + i * 7));
        if (!banner.isConnected) return;
      }
    }
    dieEl.innerHTML = Number.isFinite(other) ? `${nat}<small>${other}</small>` : `${nat}`;
    totEl.textContent = String(total ?? "");
    totEl.classList.add("is-land");
    if (nat === 20) {
      sfx("diceCrit");
      this._osxTrauma(0.32);
      bn.insertAdjacentHTML("beforeend", `<span class="osx-bn-stamp">Крит!</span>`);
    } else if (nat === 1) {
      sfx("diceFail");
      this._osxTrauma(0.22);
      bn.insertAdjacentHTML("beforeend", `<span class="osx-bn-stamp is-fail">Провал</span>`);
    } else sfx("diceLand");
    setTimeout(() => {
      if (!banner.isConnected) return;
      banner.classList.add("is-out");
      setTimeout(() => banner.remove(), 180);
    }, 2600);
  }

  /* ================================================================== ИНТРО, РАЗМЕР */

  _osxPlayIntro(stage) {
    if (calm()) return;
    stage.classList.add("is-intro");
    const slash = document.createElement("div");
    slash.className = "osx-intro-slash";
    stage.appendChild(slash);
    setTimeout(() => slash.remove(), 620);
    setTimeout(() => stage.classList.remove("is-intro"), 1400);
    sfx("open");
    setTimeout(() => sfx("swoosh"), 140);
  }

  /** Углы швов зависят от пропорций окна: строки характеристик наклоняются ровно по шву */
  _osxObserve(stage) {
    this._osxRO?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    this._osxRO = new ResizeObserver(() => {
      const app = this.element?.[0];
      if (!app || !stage.isConnected) return;
      const W = stage.clientWidth, H = stage.clientHeight || 1;
      if (W < 50) return;
      app.style.setProperty("--skL", `${(Math.atan((0.11 * W) / H) * 180 / Math.PI).toFixed(2)}deg`);
      app.style.setProperty("--skR", `${(Math.atan((0.10 * W) / H) * 180 / Math.PI).toFixed(2)}deg`);
      this._osxMoveCursor(this.form, true);
      this._osxRedrawRings(this.form);
    });
    this._osxRO.observe(stage);
  }

  /* ================================================================== ГАЙД */
  // Заменяет отдельное окно гайда: подсвечивает зоны прямо на листе

  _openGuide() {
    const app = this.element?.[0];
    if (!app) return null;
    let guide = app.querySelector(":scope > .osx-guide");
    if (guide && !guide.hidden) { this._osxGuideClose(); return null; }
    if (!guide) {
      guide = document.createElement("div");
      guide.className = "osx-guide";
      guide.innerHTML = `<div class="osx-guide-hole"></div>`;
      guide.addEventListener("click", (e) => {
        const b = e.target.closest("[data-g]");
        if (!b) return;
        if (b.dataset.g === "close") this._osxGuideClose();
        else if (b.dataset.g === "prev") this._osxGuideShow(this._osxGuideStep - 1);
        else if (this._osxGuideStep >= GUIDE.length - 1) this._osxGuideClose();
        else this._osxGuideShow(this._osxGuideStep + 1);
      });
      app.appendChild(guide);
    }
    guide.hidden = false;
    this._osxGuideShow(0, true);
    sfx("open");
    guide.querySelector("[data-g=next]")?.focus();
    return null;
  }

  _osxGuideClose() {
    const guide = this.element?.[0]?.querySelector(":scope > .osx-guide");
    if (guide) guide.hidden = true;
    this._osxGuideStep = -1;
    sfx("close");
  }

  _osxGuideShow(i, silent = false) {
    const app = this.element?.[0];
    const guide = app?.querySelector(":scope > .osx-guide");
    if (!guide || guide.hidden) return;
    this._osxGuideStep = clamp(i, 0, GUIDE.length - 1);
    const [sel, title, text] = GUIDE[this._osxGuideStep];
    const target = app.querySelector(sel);
    const ar = app.getBoundingClientRect();
    const tr = target ? target.getBoundingClientRect() : ar;
    const r = { x: tr.left - ar.left, y: tr.top - ar.top, w: tr.width, h: tr.height };
    const hole = guide.querySelector(".osx-guide-hole");
    hole.style.setProperty("--gx", `${r.x - 4}px`);
    hole.style.setProperty("--gy", `${r.y - 4}px`);
    hole.style.setProperty("--gw", `${r.w + 8}px`);
    hole.style.setProperty("--gh", `${r.h + 8}px`);
    let card = guide.querySelector(".osx-guide-card");
    if (!card) {
      guide.insertAdjacentHTML("beforeend", `<div class="osx-guide-card" role="dialog" aria-live="polite"><h4></h4><p></p><footer><span></span><div class="osx-guide-btns"><button type="button" class="osx-btn osx-btn--ghost osx-btn--sm" data-g="close">Закрыть</button><button type="button" class="osx-btn osx-btn--ghost osx-btn--sm" data-g="prev">Назад</button><button type="button" class="osx-btn osx-btn--sm" data-g="next">Дальше</button></div></footer></div>`);
      card = guide.querySelector(".osx-guide-card");
    }
    card.querySelector("h4").textContent = title;
    card.querySelector("p").textContent = text;
    card.querySelector("footer span").textContent = `${this._osxGuideStep + 1} / ${GUIDE.length}`;
    card.querySelector("[data-g=prev]").disabled = this._osxGuideStep === 0;
    card.querySelector("[data-g=next]").textContent = this._osxGuideStep === GUIDE.length - 1 ? "Готово" : "Дальше";
    const W = app.clientWidth, H = app.clientHeight, cw = 300, ch = card.offsetHeight || 150;
    let tx = r.x + r.w + 18, ty = r.y + 10;
    if (tx + cw > W - 12) tx = r.x - cw - 18;
    if (tx < 12) {
      tx = clamp(r.x + r.w / 2 - cw / 2, 12, Math.max(12, W - cw - 12));
      ty = r.y > H / 2 ? r.y - ch - 18 : r.y + r.h + 18;
    }
    card.style.setProperty("--tx", `${Math.round(tx)}px`);
    card.style.setProperty("--ty", `${Math.round(clamp(ty, 40, Math.max(40, H - ch - 12)))}px`);
    if (!silent) sfx("move");
  }
}
