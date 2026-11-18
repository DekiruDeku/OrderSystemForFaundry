/* =========================================================================
   Order | Окно «Прокачка»: все заклинания и навыки персонажа в одном месте.
   Слева круги со способностями и прогрессом, справа выбранная способность:
   лестница уровней, шкала О.О., тренировка, характеристики, история улучшений.
   При новом уровне — кат-ин и выбор улучшения; Эволюция и «Другое» уходят ГМу.

   Устройство: шаблон даёт только каркас, содержимое рисует JS (как в прототипе),
   чтобы анимации переживали обновления документов. Слои эффектов, живой регион
   и справка висят на элементе окна, а не в форме. Запись — в actions.js.
   Стили: styles/order-leveling.css. Звуки: OrderSfx (lv*).
   ========================================================================= */

import * as R from "./rules.js";
import * as A from "./actions.js";
import OrderSfx from "../ui/OrderSfx.js";
import { osiCalm } from "../sheets/OrderItemSheetX.js";

const Application = foundry.appv1?.api?.Application ?? globalThis.Application;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "+0");
const sfx = (name, arg) => { try { OrderSfx.play(name, arg); } catch (e) { /* звук не ломает окно */ } };
const TYPE_LABEL = { Spell: "Заклинание", Skill: "Навык" };
const L = (key, fallback) => { try { const s = game.i18n.localize(key); return s && s !== key ? s : fallback; } catch (e) { return fallback; } };

/* ---------- значки окна ---------- */
const ICONS = {
  "i-d20": '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 6.6l6 9.6H6z"/><path d="M12 2v4.6M3 7l3 9.2M21 7l-3 9.2M12 22l-6-5.8M12 22l6-5.8M3 7l9-.4 9 .4"/>',
  "i-check": '<path d="M5 12.5l4.5 4.5L19 7"/>',
  "i-plus": '<path d="M12 5v14M5 12h14"/>',
  "i-minus": '<path d="M5 12h14"/>',
  "i-reset": '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v5h5"/>',
  "i-up": '<path d="M6 15l6-6 6 6"/>',
  "i-branch": '<path d="M6 3v18M6 9c0 4 4 4 8 4h1M6 9c0-1 0-3 0-3"/><circle cx="18" cy="13" r="2.6"/>',
  "i-send": '<path d="M3 11.5L21 4l-6.5 17-3.2-7.3z"/><path d="M11.3 13.7L21 4"/>',
  "u-burst": '<path d="M12 2.5l2.2 6 6.3-1.6-4.3 4.9 4.3 4.9-6.3-1.6L12 21.5l-2.2-6.4-6.3 1.6 4.3-4.9-4.3-4.9 6.3 1.6z"/>',
  "u-times": '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/><path d="M3 3h4M17 21h4"/>',
  "u-range": '<path d="M3 12h17M15 7l5 5-5 5"/><path d="M3 9v6M8 10.5v3M12 10.5v3"/>',
  "u-aoe": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 11.5v1"/>',
  "u-shield": '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M12 8.5v7M8.5 12h7"/>',
  "u-down": '<path d="M12 4v15M6 13l6 6 6-6"/>',
  "u-hourglass": '<path d="M6.5 3h11M6.5 21h11M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"/>',
  "u-plus": '<path d="M12 4.5v15M4.5 12h15"/><path d="M3 3h5M16 21h5"/>',
  "u-pen": '<path d="M4 20l1-4.2L16.2 4.6l3.2 3.2L8.2 19 4 20zM13.8 7l3.2 3.2"/>'
};
export function ensureLvxSprite() {
  if (document.getElementById("lvx-sprite")) return;
  const box = document.createElement("div");
  box.innerHTML = `<svg id="lvx-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${Object.entries(ICONS).map(([k, p]) => `<symbol id="lvx-${k}" viewBox="0 0 24 24">${p}</symbol>`).join("")}</defs></svg>`;
  document.body.prepend(box.firstElementChild);
}
const ic = (name) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="#lvx-${name}"/></svg>`;

/* ========================================================================= */

export default class OrderLevelingApp extends Application {
  static instances = new Map();

  /** Открыть окно персонажа (одно на персонажа) и, если надо, сразу показать способность или новый уровень */
  static open(actor, request = {}) {
    if (!actor) return null;
    let app = OrderLevelingApp.instances.get(actor.uuid);
    if (!app) {
      app = new OrderLevelingApp(actor);
      OrderLevelingApp.instances.set(actor.uuid, app);
    }
    app._request(request);
    if (!app.rendered) app.render(true);
    else {
      if (app._minimized) app.maximize();
      app.bringToTop();
      app._consumeRequests();
    }
    return app;
  }

  constructor(actor, options = {}) {
    super({ ...options, id: `order-leveling-${actor.id}${actor.isToken ? `-${actor.token?.id}` : ""}` });
    this.actor = actor;
    this._lv = {
      tab: "Spell",
      sel: { Spell: null, Skill: null },
      busy: false,
      picker: null,
      train: { char: {}, mod: 0 },
      help: false,
      queue: [],
      requests: [],
      suppress: 0,
      dirty: false,
      refreshTimer: null
    };
    this._hookIds = [];
    this._timers = new Set();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["Order", "os-leveling"],
      template: "systems/Order/templates/apps/leveling.hbs",
      width: 1040,
      height: 720,
      resizable: true,
      minimizable: true,
      popOut: true
    });
  }

  get title() { return `${L("ORDER.Leveling.Title", "Прокачка")} · ${this.actor?.name ?? ""}`; }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    buttons.unshift(
      { label: "", class: "lvx-hb-sound", icon: OrderSfx.enabled ? "fas fa-volume-high" : "fas fa-volume-xmark", onclick: () => this._toggleSound() },
      { label: "", class: "lvx-hb-help", icon: "fas fa-circle-question", onclick: () => this._toggleHelp() }
    );
    return buttons;
  }

  getData() { return { actorName: this.actor?.name ?? "", appId: this.id }; }

  setPosition(pos = {}) {
    if (pos.width !== undefined) pos.width = Math.max(560, pos.width);
    if (pos.height !== undefined) pos.height = Math.max(520, pos.height);
    return super.setPosition(pos);
  }

  /* ---------- жизненный цикл ---------- */
  activateListeners(html) {
    super.activateListeners(html);
    ensureLvxSprite();
    const root = html?.[0] ?? html;
    this._form = root?.closest?.(".lvx-form") ?? root?.querySelector?.(".lvx-form") ?? root;
    this._win = this.element?.[0] ?? this._form?.closest(".app");
    if (!this._form || !this._win) return;
    this._rail = this._form.querySelector(".lvx-rail");
    this._focus = this._form.querySelector(".lvx-focus");
    this._body = this._form.querySelector(".lvx-body");
    this._ensureLayers();
    this._bindDom();
    this._bindHooks();
    this._renderAll();
    this._consumeRequests();
  }

  async close(options = {}) {
    for (const [hook, id] of this._hookIds) Hooks.off(hook, id);
    this._hookIds = [];
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    clearTimeout(this._lv.refreshTimer);
    this._lv.picker = null;
    this._lv.busy = false;
    this._win?.querySelector(":scope > .lvx-help")?.remove();
    OrderLevelingApp.instances.delete(this.actor?.uuid);
    if (this._bound) {
      this._win?.removeEventListener("keydown", this._bound.key, true);
      this._bound = null;
    }
    return super.close(options);
  }

  _later(ms, fn) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  }

  _ensureLayers() {
    const win = this._win;
    if (!win.querySelector(":scope > .lvx-fx")) {
      const fx = document.createElement("div");
      fx.className = "lvx-fx";
      fx.setAttribute("aria-hidden", "true");
      win.append(fx);
    }
    if (!win.querySelector(":scope > .lvx-live")) {
      const live = document.createElement("div");
      live.className = "lvx-live lvx-sr";
      live.setAttribute("aria-live", "polite");
      win.append(live);
    }
    this._fx = win.querySelector(":scope > .lvx-fx");
    this._live = win.querySelector(":scope > .lvx-live");
  }

  /* ---------- запросы снаружи: показать способность, новый уровень ---------- */
  _request(req) { if (req && (req.itemId || req.levelUp)) this._lv.requests.push(req); }

  _consumeRequests() {
    if (!this._form?.isConnected) return;
    const reqs = this._lv.requests.splice(0);
    for (const r of reqs) {
      const it = r.itemId ? this.actor.items.get(r.itemId) : null;
      if (it && R.isLevelable(it)) {
        if (!this._lv.picker && !this._lv.busy) this._select(it, { quiet: true });
        if (r.levelUp) this._lv.queue.push({ itemId: it.id, cutin: r.levelUp.cutin !== false, notice: r.levelUp.notice ?? "" });
      }
    }
    if (reqs.length) { this._renderAll(); this._drain(); }
  }

  _select(it, { quiet = false } = {}) {
    this._lv.tab = it.type;
    this._lv.sel[it.type] = it.id;
    if (!quiet) sfx("lvSelect");
  }

  /* ---------- хуки документов ---------- */
  _bindHooks() {
    if (this._hookIds.length) return;
    const mine = (doc) => (doc?.parent ?? doc) === this.actor || doc?.parent?.uuid === this.actor.uuid || doc?.uuid === this.actor.uuid;
    const onDoc = (doc) => { if (mine(doc)) this._onDocChange(); };
    for (const h of ["updateItem", "createItem", "deleteItem"]) this._hookIds.push([h, Hooks.on(h, onDoc)]);
    this._hookIds.push(["updateActor", Hooks.on("updateActor", (a) => { if (a === this.actor || a?.uuid === this.actor.uuid) this._onDocChange(); })]);
  }

  _onDocChange() {
    if (this._lv.suppress > 0) return;
    clearTimeout(this._lv.refreshTimer);
    this._lv.refreshTimer = setTimeout(() => this._refresh(), 40);
  }

  _refresh() {
    if (!this._form?.isConnected) return;
    if (this._lv.busy) { this._lv.dirty = true; return; }
    const p = this._lv.picker;
    if (p) {
      const it = this._byId(p.itemId);
      const stillPending = it && R.lvFlags(it).pending.some((x) => x.level === p.level);
      if (!stillPending) { this._lv.picker = null; this._body?.querySelector(".lvx-picker")?.remove(); }
    }
    this._renderTabs(); this._renderDay(); this._renderRail();
    if (!this._lv.picker) this._renderFocus();
    else this._renderPicker();
    this._renderHint();
    this._lv.dirty = false;
    this._drain();
  }

  async _quiet(fn) {
    this._lv.suppress += 1;
    try { return await fn(); }
    finally { this._lv.suppress = Math.max(0, this._lv.suppress - 1); }
  }

  /* ---------- данные ---------- */
  _motionOn() { return !osiCalm(); }
  _isGM() { return !!game.user?.isGM; }
  _canAct() { return !!this.actor?.isOwner; }
  _items(type) {
    return (this.actor?.items?.contents ?? [])
      .filter((i) => i.type === type && R.isLevelable(i))
      .sort((a, b) => (R.num(a.system.Circle) - R.num(b.system.Circle)) || ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, "ru"));
  }
  _byId(id) { return id ? this.actor?.items?.get(id) ?? null : null; }
  _selected() {
    const t = this._lv.tab;
    const cur = this._byId(this._lv.sel[t]);
    if (cur && cur.type === t && R.isLevelable(cur)) return cur;
    const first = this._items(t).find((i) => !R.isVariant(i)) ?? this._items(t)[0] ?? null;
    this._lv.sel[t] = first?.id ?? null;
    return first;
  }
  _say(t) {
    if (!this._live) return;
    this._live.textContent = "";
    this._later(30, () => { if (this._live) this._live.textContent = t; });
  }
  _waitingForPlayer() { return this._isGM() && A.activePlayerOwners(this.actor).length > 0; }

  /* =========================================================================
     Вкладки, день, список
     ========================================================================= */
  _renderAll(opts) { this._renderTabs(); this._renderDay(); this._renderRail(); this._renderFocus(opts); this._renderHint(); }

  _renderTabs() {
    this._form.querySelectorAll(".lvx-tab").forEach((b) => {
      const type = b.dataset.tab;
      const on = type === this._lv.tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      const list = this._items(type);
      const n = list.filter((i) => !R.isVariant(i)).length;
      const pend = list.some((i) => R.lvFlags(i).pending.length);
      b.innerHTML = `${type === "Spell" ? "Заклинания" : "Навыки"}<span class="n">${n}</span>${pend ? `<span class="lvx-tab-dot" title="Есть уровень без улучшения"></span>` : ""}`;
    });
    this._body?.setAttribute("aria-labelledby", `${this.id}-tab-${this._lv.tab}`);
  }

  _renderDay() {
    const box = this._form.querySelector(".lvx-day");
    if (!box) return;
    const used = A.dayCount(this.actor);
    const pips = Array.from({ length: Math.max(R.DAY_LIMIT, used) }, (_, i) =>
      `<i class="lvx-day-pip ${i < used ? (i >= R.DAY_LIMIT ? "is-over" : "is-used") : ""}"></i>`).join("");
    box.innerHTML = `
      <span>Тренировки сегодня</span>
      <span class="lvx-day-pips" aria-hidden="true">${pips}</span>
      <b>${used} из ${R.DAY_LIMIT}</b>
      ${this._isGM() ? `<button type="button" class="lvx-mini-btn" data-act="new-day" title="Новый социальный день: счётчик тренировок обнулится">${ic("i-reset")}Новый день</button>` : ""}`;
  }

  _rowHtml(it) {
    const s = it.system, max = R.maxLevel(it), lvl = R.num(s.Level), need = R.segmentsFor(it);
    const lv = R.lvFlags(it);
    const isMax = lvl >= max;
    const filled = R.num(s.filledSegments);
    const p = isMax ? 1 : need ? filled / need : 0;
    const pending = lv.pending.length;
    const variant = !!lv.evolutionOf;
    const nextEvo = !variant && !isMax && R.isEvolutionLevel(lvl + 1);
    const cur = this._lv.sel[this._lv.tab] === it.id;
    return `<li><button type="button" class="lvx-row ${isMax ? "is-max" : ""} ${variant ? "lvx-variant" : ""}" data-id="${it.id}" aria-current="${cur}">
      ${variant ? ic("i-branch") : ""}
      <img src="${esc(it.img)}" alt="" loading="lazy">
      <span class="lvx-row-name">${esc(it.name)}${pending || nextEvo || R.isRacial(it) ? `<span class="lvx-row-flags">${pending ? `<span class="lvx-flag-pending">Выбор</span>` : ""}${nextEvo && !pending ? `<span class="lvx-flag-evo" title="Следующий уровень даёт Эволюцию"></span>` : ""}${R.isRacial(it) ? `<span class="lvx-flag-note">расовый</span>` : ""}</span>` : ""}</span>
      <span class="lvx-row-lvl"><b>${lvl}</b>/${max}</span>
      <span class="lvx-row-bar" aria-hidden="true"><i style="--p:${p.toFixed(3)}"></i></span>
      <span class="lvx-sr">${isMax ? "максимальный уровень" : `прогресс ${filled} из ${need} О.О.`}${pending ? ", ждёт выбора улучшения" : ""}</span>
    </button></li>`;
  }

  _renderRail() {
    const rail = this._rail;
    if (!rail) return;
    const t = this._lv.tab;
    const list = this._items(t);
    if (!list.length) {
      rail.innerHTML = `<div class="lvx-empty"><strong>${t === "Spell" ? "Заклинаний нет" : "Навыков нет"}</strong>
        ${t === "Spell" ? "Открой школу магии: маг сразу получает одно заклинание 0 круга." : "Перетащи классовый навык на лист бойца или возьми его при повышении ранга."}</div>`;
      return;
    }
    const circles = [...new Set(list.map((i) => R.num(i.system.Circle)))].sort((a, b) => a - b);
    rail.innerHTML = circles.map((c) => {
      const inCircle = list.filter((i) => R.num(i.system.Circle) === c);
      const roots = inCircle.filter((i) => !R.isVariant(i));
      const orphans = inCircle.filter((i) => R.isVariant(i) && !roots.some((r) => r.id === R.lvFlags(i).evolutionOf));
      const ordered = roots.flatMap((r) => [r, ...inCircle.filter((v) => R.lvFlags(v).evolutionOf === r.id)]).concat(orphans);
      const invested = R.circleInvested(list, c);
      const gate = t === "Spell" ? R.CIRCLE_GATE[c] : null;
      let gateHtml;
      if (gate) {
        const open = invested >= gate;
        gateHtml = `<span class="lvx-circle-gate ${open ? "is-open" : ""}" title="Изучение и каждое повышение уровня на круге = 1 очко (рулбук, с. 129)">
          ${open ? `Круг ${c + 1} открыт` : `До круга ${c + 1}`}: <b>${Math.min(invested, gate)}/${gate}</b>
          <span class="lvx-gate-bar"><i style="--p:${Math.min(1, invested / gate).toFixed(3)}"></i></span></span>`;
      } else if (t === "Spell" && c === 0) {
        gateHtml = `<span class="lvx-circle-gate">Без перезарядки и затрат</span>`;
      } else {
        gateHtml = `<span class="lvx-circle-gate">Вложено очков: <b>${invested}</b></span>`;
      }
      return `<section class="lvx-circle" aria-label="Круг ${c}">
        <div class="lvx-circle-head"><span class="lvx-circle-num"><span>${c}</span></span><span class="lvx-circle-name">Круг ${c}</span>${gateHtml}</div>
        <ul class="lvx-list">${ordered.map((i) => this._rowHtml(i)).join("")}</ul></section>`;
    }).join("");
  }

  /* =========================================================================
     Фокус: выбранная способность
     ========================================================================= */
  _statList(it) {
    const s = it.system, a = this.actor, out = [];
    const word = s.DamageMode === "heal" ? "Лечение" : "Урон";
    const forms = R.damageFormulas(s);
    if (!R.hidden(s, "DamageFormula")) {
      forms.forEach((f, i) => out.push({ key: `damage:${i}`, label: forms.length > 1 ? `${word} ${i + 1}` : word, value: R.evalDamage(f, a, s), note: R.hasLetters(f) ? R.prettyFormula(f) : "" }));
      if (!forms.length && R.num(s.Damage) > 0) out.push({ key: "damage:value", label: word, value: R.num(s.Damage) });
      const mi = R.multInfo(s);
      if (mi) out.push({ key: "mult", label: "Множитель", value: `×${R.fmtNum(mi.value)}`, note: `потолок ×${R.maxLevel(it)}` });
    }
    const rf = String(s.RangeFormula ?? "").trim();
    if (!R.hidden(s, "Range") && (rf || R.num(s.Range) > 0)) out.push({ key: "range", label: "Дальность", value: `${rf ? R.evalRange(rf, a, s) : R.num(s.Range)} кл.`, note: R.hasLetters(rf) ? R.prettyFormula(rf) : "" });
    if (!R.hidden(s, "AreaSize") && R.num(s.AreaSize) > 0) out.push({ key: "aoe", label: "Зона", value: `${R.fmtNum(R.num(s.AreaSize))} кл.` });
    if (!R.hidden(s, "SaveDCFormula") && String(s.SaveDCFormula ?? "").trim()) out.push({ key: "dc", label: "Сложность проверки", value: R.evalDC(s.SaveDCFormula, a, s), note: R.hasLetters(s.SaveDCFormula) ? R.prettyFormula(s.SaveDCFormula) : "" });
    if (!R.hidden(s, "EffectThreshold") && R.num(s.EffectThreshold) > 0) out.push({ key: "effect", label: "Порог эффекта", value: R.num(s.EffectThreshold), note: "эффект срабатывает от" });
    if (!R.hidden(s, "UsageThreshold") && R.num(s.UsageThreshold) > 0) out.push({ key: "usage", label: "Условие применения", value: R.num(s.UsageThreshold), note: "минимум на броске" });
    if (!R.hidden(s, "Duration") && String(s.Duration ?? "").trim()) out.push({ key: "duration", label: "Длительность", value: String(s.Duration).trim() });
    R.additionalFields(s).forEach((f, i) => { if (!f.hidden && String(f.value ?? "").trim()) out.push({ key: `bonus:${i}`, label: String(f.name || `Поле ${i + 1}`), value: String(f.value) }); });
    return out;
  }

  _shortPick(p) {
    if (p.key === "custom") return "Другое";
    const map = { damage: "урон", mult: "множитель", range: "дальность", aoe: "зона", dc: "КС", effect: "порог", usage: "условие", duration: "длит.", bonus: String(p.label ?? "").toLowerCase() };
    const k = String(p.key).split(":")[0];
    return `${p.delta || ""} ${map[k] || p.label}`.trim();
  }

  _ladderHtml(it) {
    const s = it.system, max = R.maxLevel(it), lvl = R.num(s.Level), need = R.segmentsFor(it), filled = R.num(s.filledSegments);
    const lv = R.lvFlags(it);
    const steps = [];
    for (let n = 1; n <= max; n++) {
      const done = n <= lvl, current = n === lvl, target = n === lvl + 1;
      const isPending = lv.pending.some((p) => p.level === n);
      const evo = R.isEvolutionLevel(n);
      const h = lv.history.find((x) => x.level === n);
      let tag;
      if (isPending) tag = `<span class="lvx-step-tag is-pending">выбрать</span>`;
      else if (n === 1 && done) tag = `<span class="lvx-step-tag">изучено</span>`;
      else if (h?.evolution && h.evolution.status !== "declined") tag = `<span class="lvx-step-tag is-evo">${esc(h.evolution.name)}</span>`;
      else if (h) tag = `<span class="lvx-step-tag">${esc((h.picks ?? []).filter((p) => p.status !== "declined").map((p) => this._shortPick(p)).join(", "))}</span>`;
      else if (target) tag = `<span class="lvx-step-tag">ещё ${Math.max(0, need - filled)} О.О.</span>`;
      else tag = `<span class="lvx-step-tag"></span>`;
      const lineP = done ? 1 : target && need ? filled / need : 0;
      steps.push(`<li class="lvx-step ${done ? "is-done" : ""} ${current ? "is-current" : ""} ${target ? "is-target" : ""} ${isPending ? "is-pending" : ""}" data-level="${n}">
        <span class="lvx-step-line"><i style="--p:${lineP.toFixed(3)}"></i></span>
        <span class="lvx-node">${evo ? `<span class="lvx-evo-mark" title="Уровень Эволюции"></span>` : ""}${n}</span>
        ${tag}
        <span class="lvx-sr">Уровень ${n}${evo ? ", Эволюция" : ""}${done ? ", получен" : ""}${isPending ? ", ждёт выбора" : ""}</span>
      </li>`);
    }
    return `<div class="lvx-ladder-wrap"><ol class="lvx-ladder" aria-label="Уровни">${steps.join("")}</ol>
      <div class="lvx-ladder-legend"><span><i class="lvx-flag-evo"></i>Эволюция: два улучшения или улучшение и новая версия</span></div></div>`;
  }

  _trainHtml(it) {
    const a = this.actor, s = it.system;
    const charKey = this._lv.train.char[it.id] || R.defaultTrainingChar(it);
    const base = R.trainingBonus(R.charValue(a, charKey)), bonus = base + this._lv.train.mod;
    const dc = R.trainingDC(it), n = R.diceCount(a);
    const used = A.dayCount(a), over = used >= R.DAY_LIMIT;
    const opts = R.CHAR_KEYS.map((k) => {
      const v = R.charValue(a, k), b = R.trainingBonus(v);
      return `<option value="${k}" ${k === charKey ? "selected" : ""}>${R.CHAR[k]} ${sign(v)}${b !== v ? ` → ${sign(b)}` : ""}</option>`;
    }).join("");
    const nextEvo = R.isEvolutionLevel(R.num(s.Level) + 1);
    const can = this._canAct();
    return `<section class="lvx-train" aria-label="Тренировка">
      <div class="lvx-train-params">
        <div class="lvx-param"><span>Сложность</span><b>${dc}</b></div>
        <label class="lvx-param"><span>Бонус обучения</span>
          <select class="lvx-select" data-act="char" title="По правилам — характеристика из условий применения. Бонус режется: 4–6 вдвое, 7–10 втрое" ${can ? "" : "disabled"}>${opts}</select></label>
        <div class="lvx-param"><span>Условия и учитель</span>
          <span class="lvx-step-input" role="group" aria-label="Модификатор условий">
            <button type="button" data-act="mod" data-v="-1" aria-label="Минус 1" ${can ? "" : "disabled"}>${ic("i-minus")}</button>
            <output aria-live="polite">${sign(this._lv.train.mod)}</output>
            <button type="button" data-act="mod" data-v="1" aria-label="Плюс 1" ${can ? "" : "disabled"}>${ic("i-plus")}</button>
          </span></div>
        <div class="lvx-param"><span>Бросок</span><b>${n}d20 ${sign(bonus)}</b></div>
      </div>
      <button type="button" class="lvx-go ${over ? "is-over" : ""}" data-act="train" ${this._lv.busy || !can ? "disabled" : ""}>
        ${ic("i-d20")}<span class="lvx-go-label">${over ? "Сверх лимита" : "Тренироваться"}</span></button>
      <span class="lvx-go-sub">${over ? "Три тренировки за день уже были. Дальше — с согласия ГМа" : `Успех ≥ ${dc} · чистая 20 даёт 2 О.О.`}</span>
      <div class="lvx-tray" data-empty="Кубики появятся здесь. Броски уйдут в чат одной карточкой."></div>
      <p class="lvx-result">${nextEvo ? `Следующий уровень — <b>${R.num(s.Level) + 1}</b>, уровень Эволюции.` : ""}</p>
      ${this._isGM() ? this._gmToolsHtml() : ""}
    </section>`;
  }

  _gmToolsHtml() {
    return `<div class="lvx-gm" role="group" aria-label="Инструменты ГМа">
      <span class="lvx-gm-label">ГМ</span>
      <span>Очки обучения</span>
      <span class="lvx-step-input" role="group" aria-label="Выдать или снять О.О.">
        <button type="button" data-act="gm-pts" data-v="-1" aria-label="Снять 1 О.О.">${ic("i-minus")}</button>
        <output>О.О.</output>
        <button type="button" data-act="gm-pts" data-v="1" aria-label="Выдать 1 О.О.">${ic("i-plus")}</button>
      </span>
      <button type="button" class="lvx-btn lvx-btn--gold" data-act="gm-level">${ic("i-up")}Уровень за О.М.П.</button>
    </div>`;
  }

  _chip(st) {
    if (!st) return "";
    return st === "pending" ? `<span class="lvx-chip lvx-chip--wait">ждёт ГМа</span>`
      : st === "approved" ? `<span class="lvx-chip lvx-chip--ok">одобрено</span>`
        : `<span class="lvx-chip lvx-chip--no">отклонено</span>`;
  }

  _historyHtml(it) {
    const hist = [...R.lvFlags(it).history].sort((a, b) => b.level - a.level);
    if (!hist.length) return `<section class="lvx-history"><h3>История улучшений</h3><p class="lvx-hist-empty">Улучшений пока не было. Первое появится на уровне 2.</p></section>`;
    const latest = Math.max(...hist.map((h) => h.level));
    return `<section class="lvx-history"><h3>История улучшений</h3><ol>${hist.map((h) => {
      const evo = h.evolution;
      const lines = (h.picks ?? []).map((p) => (p.key === "custom"
        ? `<p>Другое: ${esc(p.to)}${this._chip(p.status)}</p>`
        : `<p>${esc(p.label)}${p.times > 1 ? " (дважды)" : ""}: <span class="from">${esc(p.from)}</span> → <span class="to">${esc(p.to)}</span></p>`)).join("");
      const evoLine = evo ? `<p class="evo">Эволюция «${esc(evo.name)}»${this._chip(evo.status)}</p>` : "";
      const canRevert = this._isGM() && h.level === latest && h.before;
      return `<li class="lvx-hist">
        <span class="lvx-hist-lvl ${R.isEvolutionLevel(h.level) ? "is-evo" : ""}">ур. ${h.level}</span>
        <div class="lvx-hist-body">${lines}${evoLine}<p class="lvx-hist-src">${esc(h.by)}${h.user ? ` · ${esc(h.user)}` : ""} · ${esc(h.at)}</p></div>
        ${canRevert ? `<button type="button" class="lvx-btn lvx-btn--ghost" data-act="revert" data-level="${h.level}" title="Вернуть значения и дать игроку выбрать заново">${ic("i-reset")}Откатить</button>` : "<span></span>"}
      </li>`;
    }).join("")}</ol></section>`;
  }

  _variantNote(it, parent) {
    const lv = R.lvFlags(it);
    const h = parent ? R.lvFlags(parent).history.find((x) => x.level === lv.evoLevel) : null;
    const text = h?.evolution?.text ? `Эволюция на уровне ${lv.evoLevel}: ${h.evolution.text}` : `Эволюция на уровне ${lv.evoLevel ?? "?"}.`;
    return `<div class="lvx-maxed lvx-variant-plate"><strong>Вариант способности</strong><p>${esc(text)}</p>
      <p>Уровень и тренировки — у исходной способности. Поля, которые совпадают с ней, растут вместе с ней: улучшили дальность у исходной — она выросла и здесь.</p>
      ${parent ? `<p class="lvx-plate-act"><button type="button" class="lvx-btn" data-act="goto" data-id="${parent.id}">Открыть «${esc(parent.name)}»</button></p>` : ""}</div>`;
  }

  _renderFocus({ changed = null } = {}) {
    const focus = this._focus;
    if (!focus) return;
    const it = this._selected();
    if (!it) {
      focus.innerHTML = `<div class="lvx-empty"><strong>Здесь будет способность</strong>Выбери её в списке слева.</div>`;
      return;
    }
    const s = it.system, max = R.maxLevel(it), lvl = R.num(s.Level), need = R.segmentsFor(it), filled = R.num(s.filledSegments);
    const isMax = lvl >= max;
    const lv = R.lvFlags(it);
    const parent = A.parentOf(this.actor, it);
    const isVar = !!lv.evolutionOf;
    const stats = this._statList(it);
    const nextEvo = !isMax && R.isEvolutionLevel(lvl + 1);
    const p = isMax ? 1 : need ? filled / need : 0;
    const statsHtml = `<section class="lvx-stats-wrap" aria-label="Характеристики способности"><h3 class="lvx-sec-title">Сейчас</h3>
      <dl class="lvx-stats">${stats.map((st) => `<div class="lvx-stat ${changed?.has(st.key) ? "is-changed is-flash" : ""}" data-key="${esc(st.key)}"><dt>${esc(st.label)}</dt><dd>${esc(st.value)}</dd>${st.note ? `<small>${esc(st.note)}</small>` : ""}</div>`).join("")
        || `<div class="lvx-stat"><dt>Характеристики</dt><dd>—</dd><small>У способности нет числовых полей. Подойдёт «Другое улучшение».</small></div>`}</dl></section>`;

    const pend = lv.pending[0];
    let pendHtml = "";
    if (pend && !isVar) {
      const evoLvl = R.isEvolutionLevel(pend.level) && !pend.replace;
      const what = pend.replace ? "ГМ отклонил заявку: выбери обычное улучшение вместо неё." : evoLvl ? "Выбери два улучшения или улучшение и Эволюцию." : "Выбери одно улучшение.";
      if (this._waitingForPlayer()) {
        pendHtml = `<div class="lvx-pending is-wait"><p>Уровень ${pend.level}: ждёт выбора игрока. <span>${what}</span></p>
          <button type="button" class="lvx-btn" data-act="open-picker">Выбрать за игрока</button></div>`;
      } else if (this._canAct()) {
        pendHtml = `<div class="lvx-pending"><p>Уровень ${pend.level} получен. <span>${what}</span></p>
          <button type="button" class="lvx-btn lvx-btn--accent" data-act="open-picker">Выбрать улучшение</button></div>`;
      }
    }

    let body;
    if (isVar) {
      body = `${statsHtml}${this._variantNote(it, parent)}`;
    } else if (isMax) {
      body = `${statsHtml}
        <div class="lvx-maxed"><strong>Максимальный уровень круга</strong><p>${TYPE_LABEL[it.type]} ${R.num(s.Circle)} круга прокачан до ${max}. Дальше — новые способности на следующем круге.</p></div>
        ${this._isGM() ? `<section class="lvx-train">${this._gmToolsHtml()}</section>` : ""}`;
    } else {
      const progress = `<section class="lvx-progress" aria-label="Процесс обучения">
        <div class="lvx-progress-head"><h3>Процесс обучения</h3>
          <span class="lvx-progress-val"><span class="lvx-pnow">${filled}</span><small>/${need}</small><span class="unit">О.О.</span></span></div>
        <div class="lvx-bar ${need > 40 ? "is-dense" : ""}" style="--n:${need}" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${filled}" aria-label="Очки обучения до уровня ${lvl + 1}">
          <i class="lvx-bar-ghost" style="--p:${p.toFixed(4)}"></i><i class="lvx-bar-fill" style="--p:${p.toFixed(4)}"></i><span class="lvx-bar-ticks"></span></div>
        <div class="lvx-progress-foot"><span>До уровня ${lvl + 1}${nextEvo ? " · уровень Эволюции" : ""}</span><span>Лишние очки переходят на следующий уровень</span></div>
      </section>`;
      const train = R.isRacial(it)
        ? `<div class="lvx-maxed lvx-note-plate"><strong>Расовый навык</strong><p>Расовые навыки не тренируются. Уровень растёт по решению ГМа${this._isGM() ? " — инструменты ниже" : ""}.</p></div>${this._isGM() ? `<section class="lvx-train">${this._gmToolsHtml()}</section>` : ""}`
        : this._trainHtml(it);
      body = `${progress}${train}${statsHtml}`;
    }

    const variants = isVar ? [] : A.variantsOf(this.actor, it);
    focus.innerHTML = `
      <div class="lvx-ghost" aria-hidden="true">${R.num(s.Circle)}</div>
      <header class="lvx-head">
        <img class="lvx-head-img" src="${esc(it.img)}" alt="">
        <h2 class="lvx-name">${esc(it.name)}</h2>
        <div class="lvx-lvl" aria-label="Уровень ${lvl} из ${max}"><span class="lvx-lvl-num">${lvl}</span><span class="lvx-lvl-max">/${max}</span><span class="lvx-lvl-cap">уровень</span></div>
        <div class="lvx-meta">
          <span>${TYPE_LABEL[it.type]}</span><span>Круг ${R.num(s.Circle)}</span>
          ${parent ? `<span class="is-variant">${ic("i-branch")}Эволюция «${esc(parent.name)}», не заменяет её</span>` : ""}
          ${variants.length ? `<span class="is-variant">${ic("i-branch")}Вариантов Эволюции: ${variants.length}, растут вместе с ней</span>` : ""}
          ${R.num(s.Circle) === 0 ? `<span>Шаг улучшения как у 1 круга</span>` : ""}
          <button type="button" class="lvx-link" data-act="open-sheet">Открыть лист</button>
        </div>
      </header>
      ${isVar ? "" : this._ladderHtml(it)}
      ${pendHtml}
      ${body}
      ${isVar ? "" : this._historyHtml(it)}`;
    if (changed && changed.size) this._countUp(changed);
  }

  _countUp(keys) {
    if (!this._motionOn()) return;
    keys.forEach((k) => {
      const dd = this._focus.querySelector(`.lvx-stat[data-key="${CSS.escape(k)}"] dd`);
      if (!dd) return;
      const m = dd.textContent.match(/^(×?)(\d+)(.*)$/);
      if (!m) return;
      const end = Number(m[2]), start = Math.max(0, end - Math.max(1, Math.round(end * 0.35)));
      const t0 = performance.now(), dur = 620;
      const step = (t) => {
        if (!dd.isConnected) return;
        const k2 = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k2, 4);
        dd.textContent = `${m[1]}${Math.round(start + (end - start) * e)}${m[3]}`;
        if (k2 < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      dd.animate([{ transform: "scale(1.35)", transformOrigin: "left center" }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    });
  }

  _renderHint() {
    const box = this._form.querySelector(".lvx-hint");
    if (!box) return;
    box.innerHTML = this._lv.picker
      ? `<span><kbd>1</kbd>–<kbd>9</kbd>выбрать улучшение</span><span><kbd>Enter</kbd>подтвердить</span><span><kbd>Esc</kbd>отложить выбор, уровень не пропадёт</span>`
      : `<span><kbd>↑</kbd><kbd>↓</kbd>способность</span><span><kbd>T</kbd>тренироваться</span><span>Наведи на «Бонус обучения» — правило бонуса</span>${this._isGM() ? `<span>ГМ: откат выбора — в истории или в карточке чата</span>` : ""}`;
  }

  /* =========================================================================
     Тренировка
     ========================================================================= */
  async _doTraining() {
    const it = this._selected();
    if (!it || this._lv.busy || !this._canAct() || !R.isTrainable(it) || R.num(it.system.Level) >= R.maxLevel(it)) { if (it) sfx("lvDeny"); return; }
    this._lv.busy = true;
    const motion = this._motionOn();
    const charKey = this._lv.train.char[it.id] || R.defaultTrainingChar(it);
    const go = this._focus.querySelector('[data-act="train"]');
    if (go) go.disabled = true;
    let t;
    try {
      t = await A.rollTraining(this.actor, it, charKey, this._lv.train.mod);
    } catch (err) {
      console.error("Order | Leveling | бросок тренировки", err);
      ui.notifications?.error?.("Не удалось бросить кубики тренировки.");
      this._lv.busy = false;
      if (go) go.disabled = false;
      return;
    }
    const need = R.segmentsFor(it);
    const startFilled = R.num(it.system.filledSegments);
    const tray = this._focus.querySelector(".lvx-tray"), result = this._focus.querySelector(".lvx-result");
    tray.innerHTML = t.rolls.map((_, i) => `<div class="lvx-die" data-i="${i}"><span>?</span></div>`).join("");
    if (result) result.textContent = "";
    sfx("lvRattle", t.n);

    const dice = [...tray.querySelectorAll(".lvx-die")];
    const spins = dice.map((d, i) => {
      const span = d.firstElementChild;
      const iv = setInterval(() => { span.textContent = 1 + Math.floor(Math.random() * 20); }, 55);
      const anim = motion ? d.animate([
        { transform: "translateY(-26px) rotate(-30deg) scale(0.8)", opacity: 0 },
        { transform: "translateY(4px) rotate(14deg) scale(1.05)", opacity: 1, offset: 0.45 },
        { transform: "translateY(-6px) rotate(-8deg)", offset: 0.75 },
        { transform: "translateY(0) rotate(4deg)" }
      ], { duration: 420 + i * 90, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }) : null;
      return { iv, anim };
    });

    for (let i = 0; i < t.rolls.length; i++) {
      await wait(motion ? (i === 0 ? 520 : 300) : 60);
      clearInterval(spins[i].iv);
      const r = t.rolls[i];
      const d = dice[i];
      d.firstElementChild.textContent = r.nat;
      d.classList.add(r.crit ? "is-crit" : r.one ? "is-fail" : r.ok ? "is-ok" : "is-miss");
      d.insertAdjacentHTML("beforeend", `<small>${r.nat} ${sign(t.bonus)} = ${r.total}</small>${r.pts ? `<span class="lvx-die-pts">+${r.pts}</span>` : r.one ? `<span class="lvx-die-pts">−1</span>` : ""}`);
      d.setAttribute("aria-label", `Бросок ${i + 1}: ${r.nat}, итог ${r.total}, ${r.crit ? "крит. успех" : r.one ? "крит. провал" : r.ok ? "успех" : "провал"}`);
      spins[i].anim?.cancel();
      if (motion) {
        d.animate([{ transform: "scale(1.28, 0.74)" }, { transform: "scale(0.92, 1.1)", offset: 0.45 }, { transform: "scale(1)" }],
          { duration: r.crit ? 460 : 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
        if (r.crit) this._shake(0.35);
        if (r.one) this._shake(0.3);
      }
      sfx("lvLand");
      if (r.crit) this._later(60, () => sfx("lvCrit"));
      else if (r.one) this._later(40, () => sfx("lvFail"));
      else if (!r.ok) sfx("lvMiss");
      const incoming = t.rolls.slice(0, i + 1).reduce((s, x) => s + x.pts, 0);
      this._setBar(startFilled, startFilled + incoming, need);
    }
    spins.forEach((s) => clearInterval(s.iv));

    const gained = t.rolls.reduce((s, r) => s + r.pts, 0);
    const ones = t.rolls.filter((r) => r.one).length;
    let loss = 0;
    if (ones) {
      const choice = await this._critFailChoice(ones);
      if (choice === "abort") {
        await this._finishTraining(it, t, { net: 0, aborted: true, need });
        return;
      }
      loss = ones;
    }
    /* ниже нуля О.О. не теряются */
    const net = Math.max(-startFilled, gained - loss);
    await this._flyPoints(dice, t.rolls, loss, startFilled, need);
    await this._finishTraining(it, t, { net, aborted: false, need });
  }

  _critFailChoice(ones) {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.className = "lvx-alarm";
      box.setAttribute("role", "alert");
      box.innerHTML = `<p><strong>Чистая 1${ones > 1 ? ` ×${ones}` : ""}.</strong> По правилам ГМ решает: ученик теряет ${ones} О.О. или тренировка срывается${this._isGM() ? "" : ". Спроси ГМа"}.</p>
        <button type="button" class="lvx-btn lvx-btn--danger" data-c="lose">Потерять ${ones} О.О.</button>
        <button type="button" class="lvx-btn" data-c="abort">Сорвать тренировку</button>`;
      const anchor = this._focus.querySelector(".lvx-result");
      if (anchor) anchor.after(box); else this._focus.append(box);
      if (this._motionOn()) box.animate([{ transform: "translateX(-14px) skewX(-4deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      sfx("lvDeny");
      box.querySelector("button")?.focus({ preventScroll: true });
      box.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-c]");
        if (!b) return;
        box.remove();
        resolve(b.dataset.c);
      });
    });
  }

  _setBar(solid, ghost, need) {
    const bar = this._focus?.querySelector(".lvx-bar");
    if (!bar || !need) return;
    bar.querySelector(".lvx-bar-fill")?.style.setProperty("--p", Math.min(1, Math.max(0, solid) / need).toFixed(4));
    bar.querySelector(".lvx-bar-ghost")?.style.setProperty("--p", Math.min(1, Math.max(solid, ghost) / need).toFixed(4));
    const now = this._focus.querySelector(".lvx-pnow");
    if (now) now.textContent = Math.max(0, solid);
    bar.setAttribute("aria-valuenow", String(Math.max(0, Math.min(need, solid))));
    const line = this._focus.querySelector(".lvx-step.is-target .lvx-step-line > i");
    if (line) line.style.setProperty("--p", Math.min(1, Math.max(0, solid) / need).toFixed(4));
  }

  async _flyPoints(dice, rolls, loss, start, need) {
    const bar = this._focus.querySelector(".lvx-bar");
    if (!bar) return;
    let cur = start, tick = 0;
    const target = () => {
      const wr = this._win.getBoundingClientRect();
      const r = bar.getBoundingClientRect();
      const x = r.left + Math.min(1, cur / need) * r.width - wr.left;
      return { x: Math.max(r.left - wr.left + 6, x - 14), y: r.top - wr.top - 12 };
    };
    for (let i = 0; i < rolls.length; i++) {
      const r = rolls[i];
      for (let k = 0; k < r.pts; k++) {
        await this._popTo(dice[i], "+1", r.crit ? "is-crit" : "", target());
        cur += 1; tick += 1;
        sfx("lvTick", tick);
        this._setBar(cur, cur, need);
        bar.classList.remove("is-hot"); void bar.offsetWidth; bar.classList.add("is-hot");
      }
    }
    if (loss) {
      const lose = Math.min(loss, cur);
      const d = dice[rolls.findIndex((r) => r.one)];
      for (let k = 0; k < lose; k++) {
        await this._popTo(d, "−1", "is-loss", target());
        cur -= 1;
        sfx("lvMiss");
        this._setBar(cur, cur, need);
      }
    }
  }

  _popTo(fromEl, text, cls, to) {
    if (!this._motionOn() || !fromEl || !this._fx) return wait(70);
    const wr = this._win.getBoundingClientRect(), fr = fromEl.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = `lvx-pop ${cls}`;
    el.textContent = text;
    this._fx.append(el);
    const x0 = fr.left - wr.left + fr.width / 2 - 12, y0 = fr.top - wr.top - 6;
    const mx = (x0 + to.x) / 2, my = Math.min(y0, to.y) - 70;
    const a = el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 16}px) scale(1.15)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${mx}px, ${my}px) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(0.7)`, opacity: 0.2 }
    ], { duration: 520, easing: "cubic-bezier(0.45, 0, 0.2, 1)" });
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; el.remove(); res(); };
      a.onfinish = fin;
      setTimeout(fin, 900);
    }).then(() => wait(40));
  }

  async _finishTraining(it, t, { net, aborted, need }) {
    let res;
    try {
      res = await this._quiet(() => A.commitTraining(this.actor, it, t, { net, aborted }));
    } catch (err) {
      console.error("Order | Leveling | запись тренировки", err);
      ui.notifications?.error?.("Не удалось записать итог тренировки.");
      this._lv.busy = false;
      this._renderAll();
      return;
    }
    const fresh = this._byId(it.id) ?? it;
    const won = t.rolls.reduce((s, r) => s + r.pts, 0), lost = won - net;
    const scale = res.gained.length ? ` Уровень ${res.level}!` : res.level >= R.maxLevel(fresh) ? "" : ` Шкала: ${res.filled} из ${R.segmentsFor(fresh) || need}.`;
    const msg = aborted ? "Тренировка сорвана, очки не начислены."
      : net > 0 ? `+${net} О.О.${lost ? ` (${won} за успехи, −${lost} за чистую 1)` : ""}${scale}`
        : net < 0 ? `−${-net} О.О. за чистую 1.${scale}`
          : won ? `+${won} О.О. и −${lost} за чистую 1: шкала не изменилась.`
            : `Ни одного успеха.${scale}`;
    const resultEl = this._focus.querySelector(".lvx-result");
    if (resultEl) resultEl.innerHTML = aborted ? esc(msg) : esc(msg).replace(/([+−-]?\d+ О\.О\.)/, "<b>$1</b>");
    this._say(`${fresh.name}. ${msg}`);

    this._lv.busy = false;
    if (res.gained.length) {
      await wait(this._motionOn() ? 260 : 0);
      this._lv.busy = true;
      await this._levelUpMoment(fresh, res.gained[0]);
      this._lv.busy = false;
      this._openPicker(fresh.id);
    } else {
      this._renderTabs(); this._renderDay(); this._renderRail();
      const go = this._focus.querySelector('[data-act="train"]');
      if (go) {
        go.disabled = !this._canAct();
        if (res.day >= R.DAY_LIMIT) {
          go.classList.add("is-over");
          const lbl = go.querySelector(".lvx-go-label");
          if (lbl) lbl.textContent = "Сверх лимита";
          const sub = this._focus.querySelector(".lvx-go-sub");
          if (sub) sub.textContent = "Три тренировки за день уже были. Дальше — с согласия ГМа";
        }
      }
      if (this._lv.dirty) this._refresh();
      else this._drain();
    }
  }

  /* =========================================================================
     Момент повышения уровня: hit-stop, тряска, осколки, кат-ин
     ========================================================================= */
  _shake(trauma) {
    if (!this._motionOn() || !this._win) return;
    const frames = [], N = 14;
    for (let i = 0; i <= N; i++) {
      const k = (1 - i / N) * (1 - i / N) * trauma;
      frames.push({ transform: `translate(${(Math.sin(i * 2.1) * 14 * k).toFixed(2)}px, ${(Math.cos(i * 2.9) * 9 * k).toFixed(2)}px) rotate(${(Math.sin(i * 1.3) * 0.6 * k).toFixed(3)}deg)` });
    }
    frames[N] = { transform: "none" };
    this._win.animate(frames, { duration: 300 + trauma * 300, easing: "linear" });
  }

  _shards(x, y, gold) {
    if (!this._motionOn() || !this._fx) return;
    for (let i = 0; i < 26; i++) {
      const el = document.createElement("i");
      el.className = `lvx-shard ${gold && i % 2 ? "is-gold" : ""}`;
      this._fx.append(el);
      const ang = (Math.PI * 2 * i) / 26 + Math.random() * 0.4, dist = 90 + Math.random() * 160;
      const rot = Math.random() * 360;
      const a = el.animate([
        { transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(1.4)`, opacity: 1 },
        { transform: `translate(${x + Math.cos(ang) * dist}px, ${y + Math.sin(ang) * dist * 0.7}px) rotate(${rot + 200}deg) scale(0.3)`, opacity: 0 }
      ], { duration: 650 + Math.random() * 350, easing: "cubic-bezier(0.19, 1, 0.22, 1)" });
      a.onfinish = () => el.remove();
      setTimeout(() => el.remove(), 1200);
    }
  }

  async _levelUpMoment(it, level) {
    if (!this._fx) return;
    const evo = R.isEvolutionLevel(level);
    const bar = this._focus?.querySelector(".lvx-bar");
    const wr = this._win.getBoundingClientRect();
    let bx = wr.width / 2, by = wr.height / 2;
    if (bar) { const r = bar.getBoundingClientRect(); bx = r.right - wr.left - 10; by = r.top - wr.top + 8; }
    sfx("lvLevelUp");
    this._say(`${it.name}: уровень ${level}${evo ? ", уровень Эволюции" : ""}`);

    if (!this._motionOn()) {
      const c = this._cutinEl(it, level, evo);
      c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "forwards" });
      await wait(1100);
      c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      await wait(200);
      c.remove();
      return;
    }
    if (bar) {
      const prevNeed = R.segmentsFor(it, level - 1) || 1;
      this._setBar(prevNeed, 0, prevNeed);
      bar.classList.add("is-hot");
    }
    await wait(110);
    this._shake(evo ? 0.9 : 0.6);
    this._shards(bx, by, evo);
    const c = this._cutinEl(it, level, evo);
    const scrim = c.querySelector(".lvx-cutin-scrim"), slab = c.querySelector(".lvx-cutin-slab"),
      big = c.querySelector(".lvx-cutin-big"), name = c.querySelector(".lvx-cutin-name"), stamp = c.querySelector(".lvx-cutin-stamp");
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: "forwards" });
    slab.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 300, easing: "cubic-bezier(0.19, 1, 0.22, 1)", fill: "forwards" });
    big.animate([
      { transform: "translateX(-60px) scale(1.7)", opacity: 0, filter: "blur(10px)" },
      { transform: "translateX(6px) scale(0.96)", opacity: 1, filter: "blur(0)", offset: 0.6 },
      { transform: "none", opacity: 1 }
    ], { duration: 420, delay: 120, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
    name.animate([{ transform: "translateX(40px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, delay: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" });
    if (stamp) {
      stamp.animate([
        { transform: "translateX(-50%) rotate(-4deg) scale(2.4)", opacity: 0 },
        { transform: "translateX(-50%) rotate(-4deg) scale(0.92)", opacity: 1, offset: 0.7 },
        { transform: "translateX(-50%) rotate(-4deg) scale(1)", opacity: 1 }
      ], { duration: 360, delay: 640, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "backwards" });
      this._later(860, () => { sfx("lvEvolve"); this._shake(0.5); });
    }
    await wait(evo ? 1700 : 1300);
    c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" });
    slab.animate([{ transform: "skewY(-6deg)" }, { transform: "skewY(-6deg) translateX(30%)" }], { duration: 260, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" });
    await wait(260);
    c.remove();
  }

  _cutinEl(it, level, evo) {
    const c = document.createElement("div");
    c.className = `lvx-cutin ${evo ? "is-evo" : ""}`;
    c.innerHTML = `<div class="lvx-cutin-scrim"></div><div class="lvx-cutin-slab"></div>
      <div class="lvx-cutin-text">${evo ? `<span class="lvx-cutin-stamp">Эволюция</span>` : ""}
        <span class="lvx-cutin-big">Уровень <b>${level}</b></span><span class="lvx-cutin-name">${esc(it.name)}</span></div>`;
    this._fx.append(c);
    return c;
  }

  /* очередь новых уровней, пришедших снаружи (мастер ранга, кольцо в листе, ГМ) */
  async _drain() {
    if (this._lv.busy || this._lv.picker || !this._form?.isConnected) return;
    const next = this._lv.queue.shift();
    if (!next) return;
    const it = this._byId(next.itemId);
    const pend = it ? R.lvFlags(it).pending[0] : null;
    if (!it || !pend) { this._drain(); return; }
    this._lv.tab = it.type;
    this._lv.sel[it.type] = it.id;
    this._renderAll();
    if (next.notice) this._say(next.notice);
    if (next.cutin) {
      this._lv.busy = true;
      await this._levelUpMoment(it, pend.level);
      this._lv.busy = false;
    }
    if (this._waitingForPlayer()) { this._renderAll(); this._drain(); return; }
    if (!this._canAct()) return;
    this._openPicker(it.id);
  }

  /* =========================================================================
     Выбор улучшения
     ========================================================================= */
  _openPicker(itemId) {
    const it = this._byId(itemId);
    const pend = it ? R.lvFlags(it).pending[0] : null;
    if (!it || !pend || !this._canAct()) { this._renderAll(); return; }
    this._lv.picker = {
      itemId, level: pend.level, source: pend.source || A.SOURCE.manual, replacing: !!pend.replace,
      mode: !pend.replace && R.isEvolutionLevel(pend.level) ? "double" : "single",
      picks: {}, custom: "", evoName: "", evoText: ""
    };
    this._lv.tab = it.type;
    this._lv.sel[it.type] = it.id;
    this._renderAll();
    this._renderPicker(true);
  }

  _need() { return this._lv.picker?.mode === "double" ? 2 : 1; }
  _pickedCount() { return Object.values(this._lv.picker?.picks ?? {}).reduce((s, v) => s + v, 0); }
  _canApply() {
    const p = this._lv.picker;
    if (!p || this._pickedCount() !== this._need()) return false;
    if (p.picks.custom && !p.custom.trim()) return false;
    if (p.mode === "evo" && (!p.evoName.trim() || !p.evoText.trim())) return false;
    return true;
  }

  _renderPicker(enter = false) {
    const p = this._lv.picker;
    this._body?.querySelector(".lvx-picker")?.remove();
    if (!p) return;
    const it = this._byId(p.itemId);
    if (!it) { this._lv.picker = null; return; }
    const opts = R.buildOptions(it, this.actor);
    /* выбор, который исчез вместе с полем (ГМ правил лист), снимаем */
    for (const k of Object.keys(p.picks)) if (!opts.some((o) => o.key === k)) delete p.picks[k];
    const evo = R.isEvolutionLevel(p.level) && !p.replacing;
    const el = document.createElement("section");
    el.className = "lvx-picker";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", `${this.id}-pk-title`);
    const goal = p.mode === "double" ? "Выбери два улучшения. Одно можно взять дважды — нажми на карточку второй раз."
      : p.mode === "evo" ? "Выбери одно улучшение и опиши Эволюцию."
        : p.replacing ? "ГМ отклонил заявку. Выбери обычное улучшение вместо неё." : "Выбери одно улучшение.";
    const needsReq = p.picks.custom || p.mode === "evo";
    const synced = A.variantsOf(this.actor, it);
    el.innerHTML = `
      <header class="lvx-picker-head">
        <span class="lvx-picker-lvl ${evo ? "is-evo" : ""}">Ур. <b>${p.level}</b></span>
        <h2 class="lvx-picker-name" id="${this.id}-pk-title">${esc(it.name)}</h2>
        <p class="lvx-picker-sub">${goal} Выбрано <b>${this._pickedCount()}</b> из ${this._need()}.</p>
      </header>
      ${evo ? `<div class="lvx-modes" role="group" aria-label="Что даёт уровень Эволюции">
        <button type="button" class="lvx-mode" data-mode="double" aria-pressed="${p.mode === "double"}"><strong>Два улучшения</strong><span>Два разных или одно дважды: например, множитель ×3 → ×5.</span></button>
        <button type="button" class="lvx-mode" data-mode="evo" aria-pressed="${p.mode === "evo"}"><strong>Улучшение и Эволюция</strong><span>Новая версия способности. Старая остаётся, ГМ согласует.</span></button>
      </div>` : ""}
      <div class="lvx-cards">${opts.map((o, i) => this._cardHtml(it, o, i, p)).join("")}</div>
      ${p.picks.custom ? `<div class="lvx-free lvx-free--custom"><h4>Другое улучшение</h4>
        <label>Что меняется<textarea rows="2" data-f="custom" placeholder="Например: эффект «Горение» длится на 1 ход дольше">${esc(p.custom)}</textarea></label>
        <p class="lvx-free-note">Уйдёт ГМу заявкой. Значения в листе он поправит сам после одобрения.</p></div>` : ""}
      ${p.mode === "evo" ? `<div class="lvx-free"><h4>Эволюция</h4>
        <label>Название версии<input type="text" data-f="evoName" maxlength="60" value="${esc(p.evoName)}" placeholder="Например: Разделение"></label>
        <label>Что меняется в работе способности<textarea rows="3" data-f="evoText" placeholder="Например: шар делится на два шарика поменьше и бьёт две цели за одно действие">${esc(p.evoText)}</textarea></label>
        <p class="lvx-free-note">Эволюция не заменяет способность: после одобрения ГМом в списке появится её вариант. Поля, общие с исходной, будут расти вместе с ней. Перед заявкой поищи похожее свойство в рулбуке.</p></div>` : ""}
      <footer class="lvx-picker-foot">
        <p>${needsReq ? "Обычные улучшения применятся сразу, заявка уйдёт ГМу в чат." : "Значения в листе поменяются сразу. ГМ может откатить выбор из истории."}${synced.length ? ` Варианты Эволюции (${synced.length}) получат то же улучшение там, где поля совпадают.` : ""}</p>
        <button type="button" class="lvx-btn lvx-btn--ghost" data-act="later">Отложить</button>
        <button type="button" class="lvx-btn lvx-btn--accent" data-act="apply" ${this._canApply() ? "" : "disabled"}>
          ${ic(needsReq ? "i-send" : "i-check")}${needsReq ? "Улучшить и отправить ГМу" : "Улучшить"}</button>
      </footer>`;
    this._body.append(el);
    this._renderHint();
    if (enter) {
      sfx("lvOpen");
      if (this._motionOn()) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "linear" });
        el.querySelector(".lvx-picker-lvl")?.animate([{ transform: "translateX(-40px) scale(1.3)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
        el.querySelectorAll(".lvx-card, .lvx-mode").forEach((c, i) => c.animate([
          { transform: "translate(-36px, 22px) rotate(-5deg) scale(0.92)", opacity: 0 },
          { transform: "none", opacity: 1 }
        ], { duration: 420, delay: 60 + i * 45, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }));
      }
      this._later(30, () => (el.querySelector(".lvx-mode[aria-pressed='true']") || el.querySelector(".lvx-card:not(:disabled)"))?.focus({ preventScroll: true }));
    }
  }

  _cardHtml(it, o, i, p) {
    const times = p.picks[o.key] || 0;
    const twice = times === 2 ? (R.pickResult(it, this.actor, o.key, 2) ?? o.to) : null;
    const fromTo = o.custom ? `<span class="lvx-card-note">${esc(o.note)}</span>`
      : `<span class="lvx-card-ft"><span class="from">${esc(o.from)}</span><span class="arr">→</span>${esc(times === 2 ? twice : o.to)}</span>${o.fromNote || o.toNote ? `<span class="lvx-card-note">${esc(times === 2 ? "" : o.toNote || o.fromNote)}</span>` : ""}`;
    return `<button type="button" class="lvx-card" data-key="${esc(o.key)}" aria-pressed="${times > 0}" ${o.disabled ? `disabled aria-describedby="${this.id}-why-${i}"` : ""}>
      <span class="lvx-card-check">${times === 2 ? "×2" : ic("i-check")}</span>
      <span class="lvx-card-top">${ic(`u-${o.icon}`)}<span class="lvx-card-title">${esc(o.title)}</span></span>
      <span class="lvx-card-delta ${o.custom ? "is-text" : ""}">${esc(times === 2 ? R.doubleDelta(o.delta) : o.delta)}</span>
      ${fromTo}
      ${o.disabled ? `<span class="lvx-card-why" id="${this.id}-why-${i}">${esc(o.disabled)}</span>` : ""}
      <span class="lvx-sr">Клавиша ${i + 1}</span>
    </button>`;
  }

  _togglePick(key) {
    const p = this._lv.picker;
    const it = this._byId(p?.itemId);
    if (!p || !it) return;
    const o = R.buildOptions(it, this.actor).find((x) => x.key === key);
    if (!o) return;
    if (o.disabled) { sfx("lvDeny"); return; }
    const cur = p.picks[key] || 0, room = this._need() - this._pickedCount();
    const maxT = p.mode === "double" ? (o.maxTimes ?? 2) : 1;
    if (this._need() === 1) {
      p.picks = cur ? {} : { [key]: 1 };
      sfx(cur ? "lvUnpick" : "lvPick");
    } else if (cur === 0) {
      if (room <= 0) { sfx("lvDeny"); this._flashSub(); return; }
      p.picks[key] = 1; sfx("lvPick");
    } else if (cur === 1 && room > 0 && maxT >= 2) {
      p.picks[key] = 2; sfx("lvPick");
    } else {
      delete p.picks[key]; sfx("lvUnpick");
    }
    this._renderPicker();
    const card = this._body.querySelector(`.lvx-card[data-key="${CSS.escape(key)}"]`);
    card?.focus({ preventScroll: true });
    if (card && this._motionOn() && p.picks[key]) card.animate([{ transform: "translateY(-4px) skewX(-2deg) scale(1.06)" }, { transform: "translateY(-4px) skewX(-2deg)" }], { duration: 260, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }

  _flashSub() {
    const s = this._body?.querySelector(".lvx-picker-sub");
    if (s && this._motionOn()) s.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }], { duration: 260 });
  }

  async _applyPicker() {
    const p = this._lv.picker;
    if (!p || !this._canApply() || this._lv.busy) { sfx("lvDeny"); return; }
    const it = this._byId(p.itemId);
    if (!it) return;
    this._lv.busy = true;
    const statsBefore = this._statList(it);
    const motion = this._motionOn();

    if (motion) {
      this._body.querySelectorAll(".lvx-card").forEach((c) => {
        const on = c.getAttribute("aria-pressed") === "true";
        c.animate(on
          ? [{ transform: "translateY(-4px) skewX(-2deg) scale(1)" }, { transform: "translateY(-10px) skewX(-2deg) scale(1.08)", offset: 0.4 }, { transform: "translateY(-4px) skewX(-2deg) scale(1)" }]
          : [{ transform: "none", opacity: 1 }, { transform: "translateY(30px) rotate(3deg)", opacity: 0 }],
        { duration: on ? 360 : 260, easing: on ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" });
      });
      this._shake(0.25);
    }
    sfx("lvStamp");
    const btn = this._body.querySelector('[data-act="apply"]');
    if (btn) btn.disabled = true;

    let result;
    try {
      [result] = await Promise.all([
        this._quiet(() => A.applyChoice(this.actor, it, {
          level: p.level, picks: { ...p.picks }, mode: p.mode, custom: p.custom, evoName: p.evoName, evoText: p.evoText,
          replace: p.replacing, source: p.source
        })),
        wait(motion ? 380 : 0)
      ]);
    } catch (err) {
      console.error("Order | Leveling | применение улучшения", err);
      ui.notifications?.error?.("Не удалось применить улучшение.");
      this._lv.busy = false;
      this._renderPicker();
      return;
    }
    if (p.mode === "evo" || p.picks.custom) this._later(260, () => sfx("lvSend"));

    const fresh = this._byId(it.id) ?? it;
    const statsAfter = this._statList(fresh);
    const changed = new Set(statsAfter.filter((sa) => String(statsBefore.find((sb) => sb.key === sa.key)?.value) !== String(sa.value)).map((sa) => sa.key));

    const el = this._body.querySelector(".lvx-picker");
    this._lv.picker = null;
    if (el && motion) {
      el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(24px)" }], { duration: 240, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" });
      await wait(240);
    }
    el?.remove();
    this._lv.busy = false;
    this._renderAll({ changed });
    const node = this._focus.querySelector(`.lvx-step[data-level="${p.level}"] .lvx-node`);
    if (node && motion) node.animate([{ transform: "scale(1.6)", filter: "brightness(2)" }, { transform: "scale(1)", filter: "none" }], { duration: 520, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
    this._say(`Уровень ${p.level}: ${result.pickRecs.map((x) => x.label).join(", ")}${result.synced.length ? `. Вместе с ним выросли: ${result.synced.join(", ")}` : ""}`);
    this._focus.querySelector('[data-act="train"]')?.focus({ preventScroll: true });
    if (R.lvFlags(fresh).pending.length) this._later(500, () => { if (!this._lv.picker && !this._lv.busy) this._openPicker(fresh.id); });
    else this._drain();
  }

  _closePicker() {
    if (!this._lv.picker) return;
    const el = this._body.querySelector(".lvx-picker");
    this._lv.picker = null;
    sfx("lvClose");
    if (el && this._motionOn()) {
      el.style.pointerEvents = "none";
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }).onfinish = () => el.remove();
      /* фоновая вкладка не доигрывает анимации: убираем по таймеру */
      this._later(260, () => el.remove());
    } else el?.remove();
    this._renderAll();
    this._focus.querySelector('[data-act="open-picker"]')?.focus({ preventScroll: true });
    this._drain();
  }

  /* =========================================================================
     ГМ
     ========================================================================= */
  async _gmPoints(delta) {
    const it = this._selected();
    if (!it || this._lv.busy || !this._isGM()) return;
    if (delta < 0 && R.num(it.system.filledSegments) <= 0) { sfx("lvDeny"); return; }
    const res = await this._quiet(() => A.gmAddPoints(this.actor, it, delta));
    if (!res) { sfx("lvDeny"); return; }
    sfx(delta > 0 ? "lvTick" : "lvMiss", 4);
    const fresh = this._byId(it.id) ?? it;
    if (res.gained.length) {
      this._renderAll();
      this._lv.busy = true;
      await this._levelUpMoment(fresh, res.gained[0]);
      this._lv.busy = false;
      if (this._waitingForPlayer()) this._renderAll();
      else this._openPicker(fresh.id);
    } else {
      const need = R.segmentsFor(fresh);
      this._setBar(res.filled, res.filled, need);
      const tag = this._focus.querySelector(".lvx-step.is-target .lvx-step-tag");
      if (tag) tag.textContent = `ещё ${need - res.filled} О.О.`;
      this._renderRail();
    }
  }

  async _gmLevel() {
    const it = this._selected();
    if (!it || this._lv.busy || !this._isGM()) return;
    const res = await this._quiet(() => A.gmAwardLevel(this.actor, it));
    if (!res) { sfx("lvDeny"); return; }
    const fresh = this._byId(it.id) ?? it;
    this._renderAll();
    this._lv.busy = true;
    await this._levelUpMoment(fresh, res.level);
    this._lv.busy = false;
    if (this._waitingForPlayer()) {
      this._renderAll();
      ui.notifications?.info?.(`${fresh.name}: игрок выберет улучшение за уровень ${res.level} в окне «Прокачка».`);
    } else this._openPicker(fresh.id);
  }

  async _revert(level) {
    const it = this._selected();
    if (!it || !this._isGM() || this._lv.busy) return;
    const ok = await this._quiet(() => A.revertLevel(this.actor, it, level));
    if (!ok) { sfx("lvDeny"); return; }
    sfx("lvRevert");
    this._renderAll();
    this._say(`ГМ откатил выбор уровня ${level}. Выбор снова доступен.`);
  }

  /* =========================================================================
     Звук и справка (кнопки в шапке окна)
     ========================================================================= */
  _toggleSound() {
    OrderSfx.setEnabled(!OrderSfx.enabled);
    const i = this._win?.querySelector(".window-header .lvx-hb-sound i");
    if (i) i.className = OrderSfx.enabled ? "fas fa-volume-high" : "fas fa-volume-xmark";
    const b = this._win?.querySelector(".window-header .lvx-hb-sound");
    if (b) b.setAttribute("aria-label", OrderSfx.enabled ? "Выключить звук" : "Включить звук");
    if (OrderSfx.enabled) sfx("lvSelect");
  }

  _toggleHelp() {
    this._lv.help = !this._lv.help;
    this._win?.querySelector(":scope > .lvx-help")?.remove();
    if (!this._lv.help) return;
    const h = document.createElement("div");
    h.className = "lvx-help";
    h.setAttribute("role", "note");
    h.innerHTML = `<h3>Как растут способности</h3><ul>
      <li><b>Тренировка</b>: ${R.diceCount(this.actor)}d20 с бонусом характеристики против сложности обучения. Успех — 1 О.О., чистая 20 — 2, чистая 1 — потеря 1 О.О. или срыв по решению ГМа.</li>
      <li><b>Шкала</b> заполнилась — уровень вырос, лишние очки переходят дальше.</li>
      <li><b>Улучшение</b> на каждом уровне: одно из списка. Шаг зависит от круга.</li>
      <li><b>Эволюция</b> на уровнях 3, 5, 7, 9, 11: два улучшения или улучшение и новая версия способности.</li>
      <li><b>Варианты Эволюции</b> растут вместе с исходной: одинаковые поля меняются у обеих.</li>
      <li><b>Круг</b>: каждое изучение и повышение — очко круга. 5 очков на 1 круге открывают 2-й, 8 на 2-м — 3-й.</li></ul>`;
    this._win.append(h);
    if (this._motionOn()) h.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }

  /* =========================================================================
     События
     ========================================================================= */
  _bindDom() {
    const form = this._form;
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("click", (e) => this._onClick(e));
    form.addEventListener("change", (e) => {
      if (e.target.matches('[data-act="char"]')) {
        const it = this._selected();
        if (!it) return;
        this._lv.train.char[it.id] = e.target.value;
        sfx("lvSelect");
        this._renderFocus();
        this._focus.querySelector('[data-act="char"]')?.focus();
      }
    });
    form.addEventListener("input", (e) => {
      const f = e.target.dataset?.f;
      if (!f || !this._lv.picker) return;
      this._lv.picker[f] = e.target.value;
      const btn = this._body.querySelector('[data-act="apply"]');
      if (btn) btn.disabled = !this._canApply();
    });
    /* клавиатура — на окне, в фазе захвата: Escape и стрелки не уходят в Foundry */
    if (!this._bound) {
      this._bound = { key: (e) => this._onKey(e) };
      this._win.addEventListener("keydown", this._bound.key, true);
    }
  }

  _onClick(e) {
    const t = e.target;
    const tab = t.closest(".lvx-tab");
    if (tab) {
      if (tab.dataset.tab === this._lv.tab) return;
      if (this._lv.picker || this._lv.busy) { sfx("lvDeny"); this._flashSub(); return; }
      this._lv.tab = tab.dataset.tab;
      sfx("lvTab");
      this._renderAll();
      if (this._motionOn()) this._focus.animate([{ opacity: 0, transform: "translateX(16px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      return;
    }
    const row = t.closest(".lvx-row");
    if (row) {
      if (this._lv.busy) return;
      if (this._lv.picker) this._closePicker();
      if (this._lv.sel[this._lv.tab] === row.dataset.id) return;
      this._lv.sel[this._lv.tab] = row.dataset.id;
      sfx("lvSelect");
      this._renderRail(); this._renderFocus();
      this._rail.querySelector(`.lvx-row[data-id="${CSS.escape(row.dataset.id)}"]`)?.focus({ preventScroll: true });
      if (this._motionOn()) {
        this._focus.querySelector(".lvx-head")?.animate([{ opacity: 0, transform: "translateX(-18px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        this._focus.querySelectorAll(".lvx-node").forEach((n, i) => n.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 22, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }));
      }
      return;
    }
    const card = t.closest(".lvx-card");
    if (card && this._lv.picker) { this._togglePick(card.dataset.key); return; }
    const mode = t.closest(".lvx-mode");
    if (mode && this._lv.picker) {
      if (this._lv.picker.mode !== mode.dataset.mode) {
        this._lv.picker.mode = mode.dataset.mode;
        this._lv.picker.picks = {};
        sfx("lvTab");
        this._renderPicker();
        this._body.querySelector(`.lvx-mode[data-mode="${mode.dataset.mode}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    const actEl = t.closest("[data-act]");
    const act = actEl?.dataset.act;
    if (!act || act === "char") return;
    if (act === "train") this._doTraining();
    else if (act === "mod") {
      const v = Number(actEl.dataset.v);
      this._lv.train.mod = Math.max(-5, Math.min(5, this._lv.train.mod + v));
      sfx("lvSelect");
      this._renderFocus();
      this._focus.querySelector(`[data-act="mod"][data-v="${actEl.dataset.v}"]`)?.focus();
    }
    else if (act === "open-picker") { const it = this._selected(); if (it) this._openPicker(it.id); }
    else if (act === "later") this._closePicker();
    else if (act === "apply") this._applyPicker();
    else if (act === "gm-pts") this._gmPoints(Number(actEl.dataset.v));
    else if (act === "gm-level") this._gmLevel();
    else if (act === "revert") this._revert(Number(actEl.dataset.level));
    else if (act === "new-day") {
      if (!this._isGM()) return;
      this._quiet(() => A.newDay(this.actor)).then(() => { sfx("lvTab"); this._renderDay(); this._renderFocus(); });
    }
    else if (act === "goto") {
      const target = this._byId(actEl.dataset.id);
      if (!target) return;
      this._lv.tab = target.type;
      this._lv.sel[target.type] = target.id;
      sfx("lvSelect");
      this._renderAll();
    }
    else if (act === "open-sheet") { this._selected()?.sheet?.render(true); }
  }

  _onKey(e) {
    if (!this._form?.isConnected) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "");
    if (this._lv.picker) {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); this._closePicker(); return; }
      if (typing) return;
      if (/^[1-9]$/.test(e.key)) {
        const c = this._body.querySelectorAll(".lvx-card")[Number(e.key) - 1];
        if (c) { e.preventDefault(); e.stopPropagation(); this._togglePick(c.dataset.key); }
        return;
      }
      if (e.key === "Enter" && !e.target.closest?.(".lvx-card, .lvx-mode, button")) { e.preventDefault(); e.stopPropagation(); this._applyPicker(); }
      return;
    }
    if (e.key === "Escape" && this._lv.help) { e.stopPropagation(); e.preventDefault(); this._toggleHelp(); return; }
    if (typing) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest?.(".lvx-row")) {
      e.preventDefault(); e.stopPropagation();
      const rows = [...this._rail.querySelectorAll(".lvx-row")];
      const i = rows.indexOf(e.target.closest(".lvx-row"));
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.click();
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.target.closest?.(".lvx-tab")) {
      e.preventDefault(); e.stopPropagation();
      const other = [...this._form.querySelectorAll(".lvx-tab")].find((b) => b.dataset.tab !== this._lv.tab);
      other?.click(); other?.focus();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key.toLowerCase() === "t" || e.key.toLowerCase() === "е")) {
      e.preventDefault(); e.stopPropagation();
      this._doTraining();
    }
  }
}
