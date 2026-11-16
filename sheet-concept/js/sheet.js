/* Лист бойца ОПБСАН: поведение концепта.

   Всё, что здесь кликается, повторяет обработчики OrderPlayerSheet.activateListeners:
   те же классы-триггеры, те же правила сегментов (_calculateSegments), та же формула
   тренировки (СЛ 10 + значение, бонус по ступеням, 3–4 d20). Окна Foundry (Dialog, лист
   предмета, мастер ранга) заменены моками с теми же полями и кнопками.

   FX ресурсов считаются по разнице «было → стало». В Foundry каждый update актора заново
   рисует лист, поэтому прошлые значения хранятся на экземпляре листа, а интро играет
   один раз на открытие окна. Кнопка «Ре-рендер» в демо-пульте показывает именно это. */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ утилиты */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sfx = (name, arg) => { try { if (window.OrderSfx) window.OrderSfx.play(name, arg); } catch (e) { /* звук не ломает лист */ } };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ic = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
  const mask = (name) => `<span class="osx-mask" style="--m:url(../assets/icons/${name}.svg)" aria-hidden="true"></span>`;
  const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
  const fmt = (n) => Number(n).toLocaleString("ru-RU");
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const toInt = (v, d = 0) => { const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : d; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d20 = () => 1 + Math.floor(Math.random() * 20);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим: просто не помним */ } }
  };
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const calm = () => motionQuery.matches || document.body.classList.contains("order-no-animations");

  /* ------------------------------------------------------------------ данные */
  const INITIAL = clone(window.ORDER_ACTOR);
  let A = clone(INITIAL);
  const DEBUFFS = window.ORDER_DEBUFFS;

  // _calculateSegments из OrderPlayerSheet: длина круга обучения по значению характеристики
  const SEGMENTS = { "-9": 24, "-8": 20, "-7": 18, "-6": 16, "-5": 14, "-4": 12, "-3": 10, "-2": 8, "-1": 6, "0": 6, "1": 8, "2": 10, "3": 12, "4": 14, "5": 16, "6": 18, "7": 20, "8": 24, "9": 28 };
  const calcSeg = (v) => SEGMENTS[String(v)] ?? 35;
  const stat = (k) => A.stats.find((s) => s.key === k);
  const sumMods = (list) => (list || []).reduce((a, m) => a + (Number(m.value) || 0), 0);
  const statByLabel = (label) => A.stats.find((s) => s.label.toLowerCase() === String(label).trim().toLowerCase());
  const trainingBonus = (v) => (v <= 3 ? v : v <= 6 ? Math.floor(v / 2) : Math.floor(v / 3));
  const trainingDice = () => ((stat("Knowledge")?.value ?? 0) >= 7 ? 4 : 3);

  const TABS = {
    biography: { giant: "Досье" },
    inventory: { giant: "Груз" },
    equipment: { giant: "Арсенал" },
    skills: { giant: "Техники" }
  };
  const MENU_TILT = [-3, -1.5, -3.5, -2];

  /* ------------------------------------------------------------------ DOM */
  const win = $("#sheet");
  const stage = $("#stage");
  const form = $(".osx-form");
  const p1 = $(".osx-p1");
  const portrait = $(".osx-portrait-img");
  const content = $(".osx-content");
  const hintBox = $(".osx-hint");
  const tip = $(".osx-tooltip");
  const layer = $(".osx-dialog-layer");
  const dlg = $(".osx-dialog");
  const banner = $(".osx-banner");
  const chat = $(".osx-chat");
  const guide = $(".osx-guide");
  win.appendChild(guide); // гайд подсвечивает и строку-хинт, поэтому живёт на уровне окна

  const ui = {
    tab: "biography", edit: false, fit: 1, w: 1256, h: 715,
    query: "", tags: new Set(), filterOpen: false, scroll: {},
    cropDraft: null, introPlayed: false
  };

  /* ================================================================== ОКНО */
  function applySize() {
    ui.w = clamp(ui.w, 1000, 1800);
    ui.h = clamp(ui.h, 650, 1100);
    win.style.setProperty("--win-w", ui.w + "px");
    win.style.setProperty("--win-h", ui.h + "px");
    // скрытая вкладка или iframe без размера: оставляем прошлый масштаб
    if (window.innerWidth < 200 || window.innerHeight < 200) return;
    // справа колонка как сайдбар Foundry (демо-пульт и чат); если места мало, окно уступает ей
    const side = window.innerWidth >= ui.w + 2 * 300 ? 0 : 300;
    document.documentElement.style.setProperty("--side", `${side}px`);
    ui.fit = Math.min(1, (window.innerWidth - side - 16) / ui.w, (window.innerHeight - 16) / ui.h);
    win.style.setProperty("--fit", ui.fit.toFixed(4));
  }
  window.addEventListener("resize", applySize);

  // Углы швов зависят от пропорций окна: строки характеристик наклоняются ровно по шву
  const ro = new ResizeObserver(() => {
    const W = stage.clientWidth, H = stage.clientHeight || 1;
    win.style.setProperty("--skL", (Math.atan((0.11 * W) / H) * 180 / Math.PI).toFixed(2) + "deg");
    win.style.setProperty("--skR", (Math.atan((0.10 * W) / H) * 180 / Math.PI).toFixed(2) + "deg");
    moveCursor(true);
    drawAllRings();
  });
  ro.observe(stage);

  // Свой ресайз-хэндл (в Foundry это штатный .window-resizable-handle)
  (function resizeHandle() {
    const h = $(".window-resizable-handle");
    let st = null;
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      st = { x: e.clientX, y: e.clientY, w: ui.w, h: ui.h };
    });
    h.addEventListener("pointermove", (e) => {
      if (!st) return;
      // окно центрировано, поэтому растёт в обе стороны: множитель 2 держит хэндл под курсором
      ui.w = st.w + ((e.clientX - st.x) * 2) / ui.fit;
      ui.h = st.h + ((e.clientY - st.y) * 2) / ui.fit;
      applySize();
    });
    const end = () => { st = null; };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
  })();

  // Координаты элемента внутри сцены (окно масштабируется под экран, делим на fit)
  function localRect(el, root = stage) {
    const s = root.getBoundingClientRect(), r = el.getBoundingClientRect(), f = ui.fit || 1;
    return { x: (r.left - s.left) / f, y: (r.top - s.top) / f, w: r.width / f, h: r.height / f };
  }

  /* ================================================================== GAME FEEL: тряска */
  // Тряска по «травме»: смещение = травма², травма гаснет сама. Двигаем окно через
  // отдельные свойства translate/rotate, чтобы не трогать transform (центровка и fit).
  const shake = { trauma: 0, raf: 0, last: 0 };
  function addTrauma(v) {
    if (calm()) return;
    shake.trauma = Math.min(1, shake.trauma + v);
    if (!shake.raf) { shake.last = performance.now(); shake.raf = requestAnimationFrame(shakeTick); }
  }
  function shakeTick(now) {
    const dt = Math.min(0.05, (now - shake.last) / 1000);
    shake.last = now;
    shake.trauma = Math.max(0, shake.trauma - dt * 1.8);
    const s = shake.trauma * shake.trauma, t = now / 1000;
    const n = (k) => Math.sin(t * 53 + k) * 0.6 + Math.sin(t * 91 + k * 2.7) * 0.4;
    win.style.translate = `${(11 * s * n(1)).toFixed(2)}px ${(8 * s * n(7)).toFixed(2)}px`;
    win.style.rotate = `${(0.8 * s * n(13)).toFixed(3)}deg`;
    if (shake.trauma > 0) shake.raf = requestAnimationFrame(shakeTick);
    else { win.style.translate = ""; win.style.rotate = ""; shake.raf = 0; }
  }

  function flash(kind) {
    const f = $(".osx-flash");
    f.classList.remove("is-dmg", "is-heal");
    void f.offsetWidth;
    f.classList.add(kind === "heal" ? "is-heal" : "is-dmg");
  }

  function floatNum(anchor, text, kind) {
    const r = localRect(anchor);
    const el = document.createElement("div");
    el.className = `osx-float osx-float--${kind}`;
    el.textContent = text;
    el.style.left = `${r.x + r.w / 2}px`;
    el.style.top = `${r.y - 6}px`;
    el.style.setProperty("--dx", `${Math.round(Math.random() * 24 - 12)}px`);
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function countTo(input, from, to, dur = 420) {
    if (calm() || document.activeElement === input) { input.value = to; return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      input.value = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ================================================================== СТРОКА-ХИНТ */
  // data-hint="Ключ~текст|Ключ2~текст2". Элемент внутри с data-hint-key подсвечивает свой чип.
  let hintSrc = null;
  function parseHint(str) {
    return String(str || "").split("|").filter(Boolean).map((p) => {
      const [k, ...rest] = p.split("~");
      return { key: k.trim(), text: rest.join("~").trim() };
    });
  }
  function renderHint(src) {
    const str = src ? (ui.edit && src.dataset.hintEdit) || src.dataset.hint : "";
    const line = document.createElement("div");
    line.className = "osx-hint-line";
    line.innerHTML = str
      ? parseHint(str).map((c) => `<span class="osx-hint-chip" data-key="${esc(c.key)}"><span class="osx-key">${esc(c.key)}</span><span>${esc(c.text)}</span></span>`).join('<span class="osx-hint-sep" aria-hidden="true">/</span>')
      : `<span class="osx-hint-default">Наведите курсор на элемент листа: здесь появится, что сделает клик</span>`;
    $$(".osx-hint-line:not(.is-out)", hintBox).forEach((o) => { o.classList.add("is-out"); setTimeout(() => o.remove(), 130); });
    if (!calm()) line.classList.add("is-in");
    hintBox.appendChild(line);
  }
  function setHot(key) {
    $$(".osx-hint-line:not(.is-out) .osx-hint-chip", hintBox).forEach((ch) => ch.classList.toggle("is-hot", !!key && ch.dataset.key === key));
  }
  function hintFrom(target) {
    const src = target.closest ? target.closest("[data-hint]") : null;
    if (src !== hintSrc) { hintSrc = src; renderHint(src); }
    const k = target.closest ? target.closest("[data-hint-key]") : null;
    setHot(k && src && src.contains(k) ? k.dataset.hintKey : null);
  }
  win.addEventListener("pointerover", (e) => hintFrom(e.target));
  win.addEventListener("focusin", (e) => hintFrom(e.target));
  win.addEventListener("pointerleave", () => { hintSrc = null; renderHint(null); });

  /* ================================================================== ВСПЛЫВАШКИ */
  // Как в системе: содержимое лежит рядом с триггером (.modifiers-tooltip и т.п.),
  // при наведении клонируется в один плавающий слой в body.
  const TIP_SEL = ".modifiers-wrapper, .weapon-penalty-wrapper, .order-tag-pill, .inventory-slot[data-item-id], .ability-card, [data-tooltip]";
  let tipFor = null, tipTimer = 0;
  function tipHtml(el) {
    const src = el.querySelector(":scope > .modifiers-tooltip, :scope > .weapon-penalty-tooltip, :scope > .osx-tip-src, :scope > .inventory-tooltip, :scope > .skill-tooltip, :scope > .spell-tooltip");
    if (src) return src.innerHTML;
    return el.dataset.tooltip ? esc(el.dataset.tooltip) : "";
  }
  function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.hidden = true; }
  function showTip(el) {
    const html = tipHtml(el);
    if (!html || !el.isConnected) return;
    tip.innerHTML = html;
    tip.hidden = false;
    tip.style.animation = "none"; void tip.offsetWidth; tip.style.animation = "";
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2, y = r.top - tr.height - 10;
    if (y < 8) y = r.bottom + 10;
    tip.style.left = `${Math.round(clamp(x, 8, window.innerWidth - tr.width - 8))}px`;
    tip.style.top = `${Math.round(clamp(y, 8, window.innerHeight - tr.height - 8))}px`;
  }
  win.addEventListener("pointerover", (e) => {
    const t = e.target.closest(TIP_SEL);
    if (t === tipFor) return;
    hideTip();
    if (!t || document.body.classList.contains("is-dragging-inv")) return;
    tipFor = t;
    tipTimer = setTimeout(() => showTip(t), t.classList.contains("ability-card") ? 420 : 110);
  });
  win.addEventListener("pointerleave", hideTip);
  content.addEventListener("scroll", () => { hideTip(); ui.scroll[ui.tab] = content.scrollTop; }, { passive: true });

  /* ================================================================== ДИАЛОГИ (моки окон Foundry) */
  let dlgSeq = 0, dlgCurrent = null;
  function openDialog({ title, lead = "", body = "", buttons = [{ label: "Закрыть", value: null, ghost: true }], trigger = null, onMount = null, wide = false }) {
    if (dlgCurrent) dlgCurrent.close(null, true);
    hideTip();
    const seq = ++dlgSeq;
    return new Promise((resolve) => {
      let done = false;
      dlg.classList.toggle("is-wide", wide);
      dlg.setAttribute("aria-label", title);
      dlg.innerHTML = `
        <div class="osx-dlg-head"><h3>${esc(title)}</h3>${lead ? `<p>${lead}</p>` : ""}</div>
        <div class="osx-dlg-body">${body}</div>
        <div class="osx-dlg-foot">${buttons.map((b, i) => `<button type="button" class="osx-btn ${b.ghost ? "osx-btn--ghost" : ""}" data-i="${i}">${b.icon ? ic(b.icon) : ""}${esc(b.label)}</button>`).join("")}</div>`;
      layer.hidden = false;
      layer.classList.remove("is-out");
      // окно раскрывается из того места, где был клик (transform-origin у триггера)
      if (trigger && trigger.getBoundingClientRect) {
        const dr = dlg.getBoundingClientRect(), tr = trigger.getBoundingClientRect();
        dlg.style.setProperty("--ox", `${((tr.left + tr.width / 2 - dr.left) / ui.fit).toFixed(0)}px`);
        dlg.style.setProperty("--oy", `${((tr.top + tr.height / 2 - dr.top) / ui.fit).toFixed(0)}px`);
      } else { dlg.style.removeProperty("--ox"); dlg.style.removeProperty("--oy"); }

      const api = {
        el: dlg,
        close(v, silent) {
          if (done) return;
          done = true;
          dlgCurrent = null;
          if (!silent) sfx(v == null ? "close" : "confirm");
          if (silent) { resolve(v); return; }
          layer.classList.add("is-out");
          setTimeout(() => { if (seq === dlgSeq) { layer.hidden = true; layer.classList.remove("is-out"); dlg.innerHTML = ""; } }, calm() ? 0 : 150);
          if (trigger && trigger.isConnected && trigger.focus) trigger.focus({ preventScroll: true });
          resolve(v);
        }
      };
      dlgCurrent = api;
      $(".osx-dlg-foot", dlg).addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (!b) return;
        const def = buttons[+b.dataset.i];
        const v = typeof def.value === "function" ? def.value(api) : def.value;
        if (v === undefined) return;
        api.close(v);
      });
      if (onMount) onMount(api);
      sfx("open");
      const first = $(".osx-dlg-body [autofocus]", dlg) || $(".osx-dlg-foot .osx-btn:last-child", dlg);
      if (first) first.focus({ preventScroll: true });
    });
  }
  layer.addEventListener("pointerdown", (e) => { if (e.target === layer && dlgCurrent) dlgCurrent.close(null); });

  function notify(text) {
    postChat({ head: "Уведомление", html: `<p>${esc(text)}</p>`, note: true });
  }

  /* ================================================================== ЧАТ (мок) */
  function postChat({ head = A.name, title = "", lines = [], total = null, html = "", note = false }) {
    const m = document.createElement("article");
    m.className = "osx-msg" + (note ? " is-note" : "");
    const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    m.innerHTML = `<header><span>${esc(head)}</span><span>${time}</span></header>${title ? `<h5>${esc(title)}</h5>` : ""}${html}${lines.map((l) => `<p>${l}</p>`).join("")}${total != null ? `<div class="osx-msg-total">${esc(total)}</div>` : ""}`;
    chat.append(m);
    $$(".osx-msg", chat).slice(0, -4).forEach((o) => o.remove());
    if (!note) sfx("chat");
    setTimeout(() => { m.classList.add("is-out"); setTimeout(() => m.remove(), 240); }, 8000);
  }

  /* ================================================================== БАННЕР БРОСКА */
  let bannerTimer = 0;
  function hideBanner() {
    banner.classList.add("is-out");
    setTimeout(() => { if (banner.classList.contains("is-out")) { banner.hidden = true; banner.classList.remove("is-out"); } }, 180);
  }
  // mode: normal | adv | dis. parts: [{label, v}]
  async function showRoll({ title, kind, mode = "normal", parts = [], chatLines = [] }) {
    const a = d20(), b = d20();
    const nat = mode === "adv" ? Math.max(a, b) : mode === "dis" ? Math.min(a, b) : a;
    const other = mode === "adv" ? Math.min(a, b) : Math.max(a, b);
    const bonus = parts.reduce((s, p) => s + p.v, 0);
    const total = nat + bonus;
    const modeTxt = mode === "adv" ? "преимущество" : mode === "dis" ? "помеха" : "";
    const math = parts.filter((p) => p.v).map((p) => `${signed(p.v)} ${esc(p.label)}`).join(" ");

    clearTimeout(bannerTimer);
    banner.hidden = false;
    banner.classList.remove("is-out");
    banner.innerHTML = `<div class="osx-bn">
        <div class="osx-bn-title">${esc(title)}</div>
        <div class="osx-bn-kind">${esc(kind)}${modeTxt ? ` · ${modeTxt}` : ""}</div>
        <div class="osx-bn-roll"><span class="osx-bn-die">20</span><span class="osx-bn-math">d20 ${math}</span><span class="osx-bn-total">…</span></div>
      </div>`;
    const dieEl = $(".osx-bn-die", banner), totEl = $(".osx-bn-total", banner), bn = $(".osx-bn", banner);
    sfx("diceRattle");
    if (!calm()) {
      for (let i = 0; i < 8; i++) {
        dieEl.textContent = d20();
        if (i % 3 === 2) sfx("diceRattle");
        await sleep(42 + i * 7);
      }
    }
    dieEl.innerHTML = mode === "normal" ? `${nat}` : `${nat}<small>${other}</small>`;
    totEl.textContent = total;
    totEl.classList.add("is-land");
    if (nat === 20) {
      sfx("diceCrit");
      addTrauma(0.32);
      bn.insertAdjacentHTML("beforeend", `<span class="osx-bn-stamp">Крит!</span>`);
    } else if (nat === 1) {
      sfx("diceFail");
      addTrauma(0.22);
      bn.insertAdjacentHTML("beforeend", `<span class="osx-bn-stamp is-fail">Провал</span>`);
    } else sfx("diceLand");

    postChat({
      title: `${title}${modeTxt ? ` (${modeTxt})` : ""}`,
      lines: [`${esc(kind)}: d20${mode === "normal" ? "" : ` [${a}, ${b}]`} ${math}`, ...chatLines],
      total: nat === 20 ? `${total} · крит` : nat === 1 ? `${total} · провал` : total
    });
    bannerTimer = setTimeout(hideBanner, 2600);
    return { nat, total };
  }

  function spinDie(btn) {
    if (calm() || !btn) return;
    btn.classList.remove("is-rolling"); void btn.offsetWidth; btn.classList.add("is-rolling");
    setTimeout(() => btn.classList.remove("is-rolling"), 600);
  }

  // Диалог броска: как _openRollDialog (ручной модификатор с типом, три варианта броска)
  function rollModeDialog({ title, trigger, lead = "", extra = "" }) {
    const custom = [];
    const TYPE = { circumstance: "Обстоятельства", item: "Предмет", other: "Другое" };
    return openDialog({
      title, trigger, lead,
      body: `${extra}
        <div class="osx-form-row">
          <label class="osx-label" for="osx-mod">Ручной модификатор</label>
          <div class="osx-mod-add">
            <input id="osx-mod" class="osx-num" type="number" value="0" step="1" />
            <select id="osx-mod-type" class="osx-select">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <button type="button" class="osx-btn osx-btn--ghost osx-btn--sm" data-add>${ic("i-plus")}Добавить</button>
          </div>
          <ul class="osx-mod-list"></ul>
        </div>
        <p class="osx-dlg-note">Выберите вариант броска:</p>`,
      buttons: [
        { label: "Помеха", ghost: true, value: (api) => ({ mode: "dis", custom, pick: ($("select[data-pick]", api.el) || {}).value }) },
        { label: "Преимущество", ghost: true, value: (api) => ({ mode: "adv", custom, pick: ($("select[data-pick]", api.el) || {}).value }) },
        { label: "Обычный", icon: "i-d20", value: (api) => ({ mode: "normal", custom, pick: ($("select[data-pick]", api.el) || {}).value }) }
      ],
      onMount(api) {
        const inp = $("#osx-mod", api.el), sel = $("#osx-mod-type", api.el), list = $(".osx-mod-list", api.el);
        $("[data-add]", api.el).addEventListener("click", () => {
          const v = toInt(inp.value, 0);
          if (v) {
            custom.push({ v, label: TYPE[sel.value] });
            list.insertAdjacentHTML("beforeend", `<li><b>${signed(v)}</b> ${esc(TYPE[sel.value])}</li>`);
            sfx("select");
          } else sfx("error");
          inp.value = 0;
        });
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("[data-add]", api.el).click(); } });
      }
    });
  }

  /* ================================================================== ЗОНА 1: портрет */
  const DEFAULT_CROP = { x: 50, y: 15, s: 1 };
  function applyCrop(c) {
    portrait.style.setProperty("--pc-x", `${c.x}%`);
    portrait.style.setProperty("--pc-y", `${c.y}%`);
    portrait.style.setProperty("--pc-s", c.s);
  }

  // Параллакс портрета: смещение не больше, чем позволяет запас от масштаба (без пустых краёв)
  const par = { tx: 0, ty: 0, x: 0, y: 0, raf: 0 };
  stage.addEventListener("pointermove", (e) => {
    if (calm() || p1.classList.contains("is-cropping")) return;
    const r = stage.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width * 2 - 1, ny = (e.clientY - r.top) / r.height * 2 - 1;
    const room = Math.min(7, Math.max(0, ((A.crop.s || 1) - 1) * 60));
    par.tx = -nx * room; par.ty = -ny * room * 0.6;
    if (!par.raf) par.raf = requestAnimationFrame(parTick);
  });
  function parTick() {
    par.x += (par.tx - par.x) * 0.12; par.y += (par.ty - par.y) * 0.12;
    portrait.style.setProperty("--px", `${par.x.toFixed(2)}px`);
    portrait.style.setProperty("--py", `${par.y.toFixed(2)}px`);
    par.raf = Math.abs(par.tx - par.x) + Math.abs(par.ty - par.y) > 0.05 ? requestAnimationFrame(parTick) : 0;
  }

  function renderNameplate() {
    const name = $(".osx-name");
    name.value = A.name;
    name.readOnly = !ui.edit;
    $(".window-title").textContent = A.name;
    const rank = $(".osx-rank-input");
    rank.value = A.rank;
    rank.readOnly = !ui.edit;
    $("[data-bind=rank-title]").textContent = A.bio.rankTitle;
    $("[data-bind=squad]").textContent = A.squad;
    $("[data-bind=race-word]").textContent = A.race ? A.race.name : "";
    $("[data-bind=gacs]").textContent = fmt(A.gacs);
    if (portrait.getAttribute("src") !== A.img) portrait.src = A.img;
    applyCrop(A.crop);
  }

  function renderTags() {
    const race = $(".RaceSection"), klass = $(".ClassSection");
    race.innerHTML = A.race
      ? `<div class="item" data-item-id="${A.race._id}" data-kind="race">
          <img src="${esc(A.race.img)}" alt="" />
          <div class="osx-tag-text"><small>Раса</small><a class="item-edit" role="button" tabindex="0" data-hint-key="Название">${esc(A.race.name)}</a></div>
          <button type="button" class="item-delete" aria-label="Удалить расу" data-hint-key="Крестик">${ic("i-close")}</button>
        </div>`
      : `<div class="osx-tag-empty">Перетащите расу на лист</div>`;
    klass.innerHTML = A.klass
      ? `<div class="item" data-item-id="${A.klass._id}" data-kind="class">
          <span class="osx-tag-ic">${mask(A.klass.icon)}</span>
          <div class="osx-tag-text"><small>Класс</small><a class="item-edit" role="button" tabindex="0" data-hint-key="Название">${esc(A.klass.name)}</a></div>
          <button type="button" class="item-delete" aria-label="Удалить класс" data-hint-key="Крестик">${ic("i-close")}</button>
        </div>`
      : `<div class="osx-tag-empty">Перетащите класс на лист</div>`;
  }
  $(".osj-tag--race").dataset.hintEdit = "Название~открыть лист расы|Крестик~убрать расу|Перетащить~новую расу на лист";
  $(".osj-tag--class").dataset.hintEdit = "Название~открыть лист класса|Крестик~убрать класс|Перетащить~новый класс на лист";

  /* --- кадрирование: будущий flags.Order.portraitCrop --- */
  let cropDrag = null;
  function startCrop() {
    ui.cropDraft = { ...A.crop };
    p1.classList.add("is-cropping");
    $(".osx-crop-ui").hidden = false;
    $(".osx-crop-btn").setAttribute("aria-pressed", "true");
    par.tx = par.ty = 0; parTick();
    sfx("toggleOn");
  }
  function endCrop(save) {
    if (!ui.cropDraft) return;
    if (save) { A.crop = { ...ui.cropDraft }; sfx("confirm"); }
    else { sfx("cancel"); }
    applyCrop(A.crop);
    ui.cropDraft = null;
    p1.classList.remove("is-cropping");
    $(".osx-crop-ui").hidden = true;
    $(".osx-crop-btn").setAttribute("aria-pressed", "false");
  }
  function coverSize() {
    const fw = portrait.clientWidth, fh = portrait.clientHeight;
    const ar = (portrait.naturalWidth || 3) / (portrait.naturalHeight || 4);
    return ar > fw / fh ? { fw, fh, cw: fh * ar, ch: fh } : { fw, fh, cw: fw, ch: fw / ar };
  }
  portrait.addEventListener("pointerdown", (e) => {
    if (!ui.cropDraft) return;
    e.preventDefault();
    portrait.setPointerCapture(e.pointerId);
    cropDrag = { x: e.clientX, y: e.clientY, cx: ui.cropDraft.x, cy: ui.cropDraft.y };
  });
  portrait.addEventListener("pointermove", (e) => {
    if (!cropDrag || !ui.cropDraft) return;
    // object-position с масштабом: left = x·(W − s·cw). Отсюда сдвиг в % на пиксель курсора.
    const { fw, fh, cw, ch } = coverSize(), s = ui.cropDraft.s;
    const roomX = fw - s * cw, roomY = fh - s * ch;
    const dx = (e.clientX - cropDrag.x) / ui.fit, dy = (e.clientY - cropDrag.y) / ui.fit;
    if (Math.abs(roomX) > 1) ui.cropDraft.x = clamp(cropDrag.cx + (dx / roomX) * 100, 0, 100);
    if (Math.abs(roomY) > 1) ui.cropDraft.y = clamp(cropDrag.cy + (dy / roomY) * 100, 0, 100);
    applyCrop(ui.cropDraft);
  });
  const cropUp = () => { if (cropDrag) { cropDrag = null; sfx("drop"); } };
  portrait.addEventListener("pointerup", cropUp);
  portrait.addEventListener("pointercancel", cropUp);
  portrait.addEventListener("wheel", (e) => {
    if (!ui.cropDraft) return;
    e.preventDefault();
    ui.cropDraft.s = clamp(+(ui.cropDraft.s - e.deltaY * 0.0012).toFixed(3), 1, 2.4);
    applyCrop(ui.cropDraft);
    sfx(e.deltaY < 0 ? "tickUp" : "tickDown", (ui.cropDraft.s - 1) / 1.4);
  }, { passive: false });
  portrait.addEventListener("dblclick", () => {
    if (!ui.cropDraft) return;
    ui.cropDraft = { ...DEFAULT_CROP };
    applyCrop(ui.cropDraft);
    sfx("swoosh");
  });

  async function pickPortrait(trigger) {
    let chosen = A.img;
    const v = await openDialog({
      title: "Портрет бойца", trigger,
      lead: "В Foundry здесь открывается FilePicker. Выберите картинку:",
      body: `<div class="osx-portrait-pick">${A.portraits.map((p) => `<button type="button" data-src="${esc(p.src)}" aria-pressed="${p.src === A.img}" aria-label="${esc(p.label)}"><img src="${esc(p.src)}" alt="" /></button>`).join("")}</div>`,
      buttons: [{ label: "Отмена", ghost: true, value: null }, { label: "Выбрать", icon: "i-check", value: () => chosen }],
      onMount(api) {
        $(".osx-portrait-pick", api.el).addEventListener("click", (e) => {
          const b = e.target.closest("[data-src]");
          if (!b) return;
          chosen = b.dataset.src;
          $$("[data-src]", api.el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          sfx("select");
        });
      }
    });
    if (!v || v === A.img) return;
    A.img = v;
    sfx("glitch");
    if (calm()) { portrait.src = v; return; }
    portrait.classList.remove("is-glitch"); void portrait.offsetWidth; portrait.classList.add("is-glitch");
    setTimeout(() => { portrait.src = v; }, 150);
    setTimeout(() => portrait.classList.remove("is-glitch"), 340);
  }

  /* --- ранг --- */
  async function rankUp(trigger) {
    const from = A.rank, to = from + 1;
    const ok = await openDialog({
      title: "Повышение ранга", trigger,
      lead: `Ранг ${from} → ${to}. В Foundry откроется мастер повышения ранга (OrderRankUpWizard) со всеми его шагами.`,
      body: `<div class="osx-steps"><span>Ранг</span>${ic("i-next")}<span>Характеристики</span>${ic("i-next")}<span>Способности</span>${ic("i-next")}<span>Итог</span></div>`,
      buttons: [{ label: "Отмена", ghost: true, value: null }, { label: "Повысить", icon: "i-up", value: true }]
    });
    if (!ok) return;
    A.rank = to;
    celebrate(from, to);
  }

  function celebrate(from, to) {
    const lu = $(".osx-levelup");
    let sparks = "";
    for (let i = 0; i < 16; i++) sparks += `<i class="osx-spark" style="--a:${i * 22.5 + (i % 2) * 8}deg;--d:${150 + (i % 3) * 60}px"></i>`;
    lu.innerHTML = `<div class="osx-lu-band"></div><div class="osx-lu-band"></div><div class="osx-lu-band"></div>
      <div class="osx-lu-text">
        <span class="osx-lu-title">Новый ранг</span>
        <span class="osx-lu-rank"><s>${from}</s>${ic("i-next")}${to}</span>
        <span class="osx-lu-kicker">${esc(A.name)}</span>
      </div>${sparks}`;
    lu.hidden = false;
    sfx("rankUp");
    addTrauma(0.3);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      lu.hidden = true;
      lu.innerHTML = "";
      renderNameplate();
      const r = $(".osx-rank");
      r.classList.remove("is-stamped"); void r.offsetWidth; r.classList.add("is-stamped");
      sfx("stamp");
    };
    lu.onclick = close;
    setTimeout(close, calm() ? 1600 : 2700);
  }

  /* ================================================================== ЗОНА 2: характеристики */
  let accent = "#e3172f";

  function statRow(s, i) {
    const col = i < 7 ? "l" : "r", row = i % 7;
    const f = ((5.6 + (row + 0.5) * (54 / 7)) / 100).toFixed(4);
    const total = calcSeg(s.value);
    const mods = sumMods(s.modifiers);
    const pens = s.weaponPenalties || [];
    const modList = (s.modifiers || []).map((m) => `<li><strong>${signed(m.value)}</strong> ${esc(m.effectName)}</li>`).join("") || "<li>Модификаторов нет</li>";
    const hint = "Кольцо~ЛКМ добавляет сегмент, ПКМ убирает|Название~тренировка|Кубик~бросок|Модификаторы~состав при наведении";
    return `<div class="osx-stat" data-key="${s.key}" style="--f:${f};--n:${i};--from:${col === "l" ? "-18px" : "18px"}"
        data-hint="${hint}" data-hint-edit="Число~ввести значение, сегменты сбросятся|${hint}">
      <div class="osx-ring" data-hint-key="Кольцо">
        <canvas class="circle-progress" data-attribute="${s.key}" tabindex="0" role="slider"
          aria-label="${esc(s.label)}: круг обучения" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${s.filled}"></canvas>
        <input class="osx-ring-value" type="text" inputmode="numeric" name="data.${s.key}.value" value="${s.value}" data-dtype="Number"
          ${ui.edit ? "" : "readonly"} aria-label="${esc(s.label)}: значение" data-hint-key="Число" />
      </div>
      <div class="osx-stat-body">
        <span class="train-characteristic ${s.label.length > 12 ? "is-long" : ""}" data-attribute="${s.key}" role="button" tabindex="0" data-hint-key="Название">${esc(s.label)}</span>
        <div class="osx-stat-sub">
          ${mask(s.icon)}
          <span class="modifiers-wrapper" data-hint-key="Модификаторы">
            <span class="modifiers-total ${mods < 0 ? "is-neg" : mods === 0 ? "is-zero" : ""}">${mods === 0 ? "±0" : signed(mods)}</span>
            <div class="modifiers-tooltip"><span class="osx-tip-title">Модификаторы: ${esc(s.label)}</span><ul>${modList}</ul></div>
          </span>
          ${pens.length ? `<span class="weapon-penalty-wrapper" data-hint-key="Модификаторы"><span class="weapon-penalty-star" aria-label="Штраф оружия">!</span>
            <div class="weapon-penalty-tooltip"><span class="osx-tip-title">Штраф требований оружия</span><ul>${pens.map((m) => `<li><strong>${signed(m.value)}</strong> ${esc(m.effectName)}</li>`).join("")}</ul></div></span>` : ""}
          <span class="osx-seg" title="Очки обучения в круге">${s.filled}/${total}</span>
        </div>
      </div>
      <button type="button" class="osx-d20 roll-characteristic" data-attribute="${s.key}" aria-label="Бросок: ${esc(s.label)}" data-hint-key="Кубик">${ic("i-d20")}</button>
    </div>`;
  }

  function speedRow(i) {
    const row = i % 7;
    const f = ((5.6 + (row + 0.5) * (54 / 7)) / 100).toFixed(4);
    const mv = A.Movement;
    const mods = sumMods(mv.modifiers);
    const modList = mv.modifiers.map((m) => `<li><strong>${signed(m.value)}</strong> ${esc(m.effectName)} <span class="osx-tip-muted">${esc(m.source)}</span></li>`).join("") || "<li>Модификаторов нет</li>";
    return `<div class="osx-stat osx-stat--speed" style="--f:${f};--n:${i};--from:18px"
        data-hint="Скорость~считает система, вручную не меняется|Модификаторы~состав при наведении">
      <div class="osx-speed-ic">${ic("i-speed")}</div>
      <div class="osx-stat-body">
        <span class="osx-speed-name">Скорость</span>
        <div class="osx-stat-sub">
          <span class="modifiers-wrapper" data-hint-key="Модификаторы">
            <span class="modifiers-total ${mods < 0 ? "is-neg" : mods === 0 ? "is-zero" : ""}">${mods === 0 ? "±0" : signed(mods)}</span>
            <div class="modifiers-tooltip"><span class="osx-tip-title">Модификаторы скорости</span><ul>${modList}</ul></div>
          </span>
        </div>
      </div>
      <div class="osx-speed-val"><input class="osx-speed-value" type="text" name="data.Movement.value" value="${mv.value}" readonly tabindex="-1" aria-label="Скорость" /></div>
    </div>`;
  }

  function renderStats() {
    const rows = A.stats.map(statRow);
    rows.push(speedRow(13));
    $(".osx-col--l").innerHTML = rows.slice(0, 7).join("");
    $(".osx-col--r").innerHTML = rows.slice(7).join("");
    drawAllRings();
  }

  // Кольцо О.О на canvas: заполненные сегменты цветом игрока, следующий чуть светлее
  function drawRing(cv, filled, total, fx = null) {
    // рисуем в базовых 44px и масштабируем под фактический размер (в узком окне кольцо меньше)
    const dpr = Math.min(2, window.devicePixelRatio || 1), size = cv.clientWidth || 44, k = size / 44;
    if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
    const c = cv.getContext("2d");
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    c.clearRect(0, 0, 44, 44);
    const cx = 22, cy = 22, r = 18.6, step = (Math.PI * 2) / total, gap = Math.min(step * 0.42, 1.7 / r);
    c.lineCap = "butt";
    for (let i = 0; i < total; i++) {
      const a0 = -Math.PI / 2 + i * step + gap / 2, a1 = a0 + step - gap;
      c.beginPath();
      c.arc(cx, cy, r, a0, a1);
      c.lineWidth = 4;
      c.strokeStyle = i < filled ? accent : i === filled ? "rgba(255,240,244,0.32)" : "rgba(255,240,244,0.12)";
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
  }
  function drawAllRings() {
    $$("canvas.circle-progress").forEach((cv) => {
      const s = stat(cv.dataset.attribute);
      if (s) drawRing(cv, s.filled, calcSeg(s.value));
    });
  }
  function flashSegment(cv, s, idx) {
    if (calm()) { drawRing(cv, s.filled, calcSeg(s.value)); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 300);
      drawRing(cv, s.filled, calcSeg(s.value), { i: idx, a: 1 - k });
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Точечное обновление строки (в Foundry её перерисует render, а FX дорисует diff)
  function updateStatRow(s, dir = 0) {
    const row = $(`.osx-stat[data-key="${s.key}"]`);
    if (!row) return;
    const total = calcSeg(s.value);
    const cv = $("canvas.circle-progress", row), val = $(".osx-ring-value", row);
    cv.setAttribute("aria-valuemax", total);
    cv.setAttribute("aria-valuenow", s.filled);
    $(".osx-seg", row).textContent = `${s.filled}/${total}`;
    if (String(val.value) !== String(s.value)) {
      val.value = s.value;
      if (!calm() && dir) {
        val.classList.remove("is-roll-up", "is-roll-down"); void val.offsetWidth;
        val.classList.add(dir > 0 ? "is-roll-up" : "is-roll-down");
      }
    }
    drawRing(cv, s.filled, total);
  }

  function levelBurst(s, dir) {
    const row = $(`.osx-stat[data-key="${s.key}"]`);
    if (!row) return;
    const ring = $(".osx-ring", row);
    if (dir > 0) {
      sfx("levelSmall");
      if (!calm()) { ring.classList.remove("is-burst"); void ring.offsetWidth; ring.classList.add("is-burst"); setTimeout(() => ring.classList.remove("is-burst"), 560); }
      floatNum(ring, `${s.label} ${s.value}`, "lvl");
    } else {
      sfx("levelDown");
      floatNum(ring, `${s.value}`, "dmg");
    }
    if (s.key === "Stamina" || s.key === "Knowledge") renderInventory(); // вместимость и число кубиков тренировки
  }

  // ЛКМ: filled++ и при заполнении круга значение +1 (ровно как в системе)
  function addSegment(key) {
    const s = stat(key);
    const total = calcSeg(s.value);
    s.filled += 1;
    if (s.filled >= total) {
      s.filled = 0;
      s.value += 1;
      updateStatRow(s, +1);
      levelBurst(s, +1);
    } else {
      sfx("tickUp", s.filled / total);
      updateStatRow(s);
      flashSegment($(`canvas.circle-progress[data-attribute="${key}"]`), s, s.filled - 1);
    }
  }
  // ПКМ: filled-- или, если круг пуст, значение −1 и круг предыдущего значения почти полон
  function removeSegment(key) {
    const s = stat(key);
    if (s.filled > 0) {
      s.filled -= 1;
      sfx("tickDown");
      updateStatRow(s);
    } else {
      s.value -= 1;
      s.filled = calcSeg(s.value) - 1;
      updateStatRow(s, -1);
      levelBurst(s, -1);
    }
  }

  /* --- тренировка: _openTrainingDialog → _rollTraining → _openTrainingResultDialog --- */
  async function openTraining(key, trigger) {
    const s = stat(key);
    const value = s.value, total = calcSeg(value);
    const dc = 10 + Math.max(0, value), bonus = trainingBonus(value), dice = trainingDice();
    const go = await openDialog({
      title: `Тренировка: ${s.label}`, trigger,
      body: `<div class="osx-chips">
          <span class="osx-chip">Показатель <b>${value}</b></span>
          <span class="osx-chip">Круг <b>${s.filled}/${total}</b></span>
          <span class="osx-chip">Кубики <b>${dice}d20</b></span>
          <span class="osx-chip">СЛ <b>${dc}</b></span>
          <span class="osx-chip">Бонус <b>${signed(bonus)}</b></span>
        </div>
        <p>Серия бросков: за удачные попытки начисляются очки обучения (О.О).</p>
        <p class="osx-dlg-note"><b>Успех</b> даёт +1 О.О, <b>чистая 20</b> даёт +2 О.О, <b>чистая 1</b> грозит потерей О.О или срывом тренировки.</p>`,
      buttons: [{ label: "Отмена", ghost: true, value: null }, { label: "Бросить", icon: "i-d20", value: true }]
    });
    if (!go) return;

    const results = [];
    for (let i = 1; i <= dice; i++) {
      const nat = d20(), tot = nat + bonus;
      const crit = nat === 20, fail = nat === 1, ok = crit || (!fail && tot >= dc);
      results.push({ i, nat, tot, crit, fail, ok, pts: crit ? 2 : ok ? 1 : 0 });
    }
    for (const r of results) {
      sfx(r.crit ? "diceCrit" : r.fail ? "diceFail" : "diceLand");
      postChat({ title: `Тренировка: ${s.label} (${r.i}/${dice})`, lines: [`СЛ ${dc} · Бонус ${signed(bonus)}`], total: r.tot });
      await sleep(calm() ? 0 : 260);
    }
    const pts = results.reduce((a, r) => a + r.pts, 0);
    const critFails = results.filter((r) => r.fail).length;
    const rows = results.map((r) => `<li>
        <span>Бросок ${r.i}</span><code>${r.nat} ${signed(bonus)} = ${r.tot}</code>
        <b class="${r.crit || r.ok ? "is-ok" : r.fail ? "is-bad" : ""}">${r.crit ? "Крит. успех" : r.fail ? "Крит. провал" : r.ok ? "Успех" : "Провал"}</b>
        <span>О.О ${r.pts ? "+" + r.pts : "0"}</span></li>`).join("");
    const crit = critFails ? `<fieldset class="osx-radio"><legend>Чистых единиц: ${critFails}. Решает мастер:</legend>
        <label><input type="radio" name="cf" value="lose" checked /> Потерять ${critFails} О.О</label>
        <label><input type="radio" name="cf" value="abort" /> Прервать тренировку (О.О не получать)</label></fieldset>` : "";
    const mode = await openDialog({
      title: `Тренировка: результат — ${s.label}`,
      lead: `СЛ ${dc} · Бонус ${signed(bonus)} · текущий круг ${s.filled}/${calcSeg(s.value)} · О.О до штрафов: <b>${pts}</b>`,
      body: `<ol class="osx-roll-list">${rows}</ol>${crit}`,
      buttons: [{ label: "Не применять", ghost: true, value: null }, { label: "Применить", icon: "i-check", value: (api) => ($("input[name=cf]:checked", api.el) || {}).value || "none" }]
    });
    if (!mode) return;
    if (mode === "abort") { notify("Тренировка прервана: очки обучения не применены."); return; }
    const net = pts - (mode === "lose" ? critFails : 0);
    if (!net) { notify("Очки обучения не изменились."); return; }
    // _applyTrainingProgress: сегменты добавляются по одному, с переносом через круг
    for (let k = 0; k < Math.abs(net); k++) {
      if (net > 0) addSegment(key); else removeSegment(key);
      await sleep(calm() ? 0 : 140);
    }
  }

  async function rollCharacteristic(key, trigger) {
    const s = stat(key);
    const res = await rollModeDialog({ title: `Бросок кубика: ${s.label}`, trigger });
    if (!res) return;
    const parts = [{ label: s.label, v: s.value }];
    const mods = sumMods(s.modifiers);
    if (mods) parts.push({ label: "мод.", v: mods });
    const pen = sumMods(s.weaponPenalties);
    if (pen) parts.push({ label: "штраф оружия", v: pen });
    res.custom.forEach((c) => parts.push({ label: c.label.toLowerCase(), v: c.v }));
    showRoll({ title: s.label, kind: "Проверка характеристики", mode: res.mode, parts });
  }

  /* ================================================================== ЗОНА 2: ресурсы */
  const RES = [
    { key: "Health", kind: "hp", label: "Здоровье", top: 0, flag: "Критично", hint: "Число~введите новое здоровье|Полоса~белым показана потеря, зелёным лечение" },
    { key: "ManaFatigue", kind: "mana", label: "Маг. усталость", top: 7.4, flag: "Предел", hint: "Число~введите значение|Деления~одно деление = 1 очко усталости" },
    { key: "Stress", kind: "stress", label: "Стресс", top: 14.8, flag: "Срыв близко", hint: "Число~введите значение|Риски~четверти шкалы, от 75 фон тревожится" }
  ];
  const prev = {}; // значения прошлого рендера: из них считается FX

  function renderResources() {
    $(".osx-resources").innerHTML = RES.map((r) => {
      const d = A[r.key];
      const fb = ((61 + r.top + 6.8) / 100).toFixed(3);
      const bar = r.kind === "mana"
        ? `<div class="osx-pipbar" style="--n:${d.max}">${Array.from({ length: d.max }, () => "<i></i>").join("")}</div>`
        : `<div class="os-bar"><i class="osx-bar-ghost"></i><i class="os-bar-fill"></i></div>`;
      return `<div class="osx-res osx-res--${r.kind} os-resource" data-res="${r.key}" style="--top:${r.top}cqh;--fb:${fb}" data-hint="${r.hint}">
        <span class="osx-res-label">${r.label}</span>
        <span class="osx-res-flag">${r.flag}</span>
        <div class="os-resource-values">
          <input class="osx-res-value" type="text" inputmode="numeric" name="data.${r.key}.value" value="${d.value}" data-dtype="Number" aria-label="${r.label}: текущее" data-hint-key="Число" />
          <span class="os-split">/</span>
          <input class="osx-res-max" type="text" name="data.${r.key}.max" value="${d.max}" readonly tabindex="-1" aria-label="${r.label}: максимум" />
        </div>
        ${bar}
      </div>`;
    }).join("");
    RES.forEach((r) => paintResource(r.key, false));
    RES.forEach((r) => { prev[r.key] = A[r.key].value; });
    syncDanger();
  }

  function paintResource(key, animate, opts = {}) {
    const row = $(`.osx-res[data-res="${key}"]`);
    if (!row) return;
    const d = A[key], p = clamp(d.value / (d.max || 1), 0, 1);
    if (key === "ManaFatigue") {
      $$(".osx-pipbar i", row).forEach((pip, i) => {
        const on = i < d.value, was = pip.classList.contains("is-on");
        pip.classList.toggle("is-on", on);
        if (animate && on && !was && !calm()) { pip.classList.remove("is-pop"); void pip.offsetWidth; pip.classList.add("is-pop"); }
      });
    } else {
      const fill = $(".os-bar-fill", row), ghost = $(".osx-bar-ghost", row);
      if (!animate) {
        fill.style.transition = ghost.style.transition = "none";
        fill.style.setProperty("--p", p);
        ghost.style.setProperty("--p", p);
      } else if (opts.drain) {
        // урон: заливка падает сразу, белый «призрак» держится и стекает следом
        fill.style.transition = "none";
        fill.style.setProperty("--p", p);
        requestAnimationFrame(() => {
          ghost.style.transition = `transform 520ms cubic-bezier(.19,1,.22,1) ${calm() ? 0 : 360}ms`;
          ghost.style.setProperty("--p", p);
        });
      } else {
        // рост: заливка и призрак едут вместе, белая полоса означает только потерю
        fill.style.transition = ghost.style.transition = `transform ${calm() ? 80 : 520}ms cubic-bezier(.19,1,.22,1)`;
        fill.style.setProperty("--p", p);
        ghost.style.setProperty("--p", p);
      }
    }
    const warn = key === "Health" ? p <= 0.25 : key === "Stress" ? p >= 0.75 : d.value >= d.max;
    row.classList.toggle("is-warn", warn);
  }

  function syncDanger() {
    const hp = A.Health, st = A.Stress;
    stage.classList.toggle("is-critical", hp.value / (hp.max || 1) <= 0.25);
    stage.classList.toggle("is-stressed", st.value / (st.max || 1) >= 0.75);
  }

  // Новое значение ресурса: FX по разнице с прошлым рендером
  function commitResource(key, value) {
    const d = A[key];
    const to = clamp(Math.round(value), 0, d.max);
    const from = prev[key] ?? d.value;
    d.value = to;
    const row = $(`.osx-res[data-res="${key}"]`);
    const input = row && $(".osx-res-value", row);
    prev[key] = to;
    if (!row) return;
    if (to === from) { input.value = to; return; }
    const delta = to - from;
    const anchor = $(".os-resource-values", row);

    if (key === "Health" && delta < 0) {
      const frac = -delta / d.max;
      const tier = frac >= 0.25 ? 3 : frac >= 0.1 ? 2 : 1;
      const stop = tier === 3 ? 120 : tier === 2 ? 50 : 0;
      sfx("damage", tier);
      flash("dmg");
      // hit-stop: короткая заморозка перед откликом, потом тряска и падение полосы
      setTimeout(() => {
        addTrauma(tier === 3 ? 0.8 : tier === 2 ? 0.42 : 0.16);
        paintResource(key, true, { drain: true });
        floatNum(anchor, `−${-delta}`, "dmg");
        countTo(input, from, to, 380);
        syncDanger();
      }, calm() ? 0 : stop);
      return;
    }
    if (key === "Health") {
      sfx("heal");
      flash("heal");
      if (!calm()) { row.classList.remove("is-heal"); void row.offsetWidth; row.classList.add("is-heal"); }
      paintResource(key, true);
      floatNum(anchor, `+${delta}`, "heal");
    } else if (key === "Stress") {
      const crossed = from / d.max < 0.75 && to / d.max >= 0.75;
      sfx(delta > 0 ? "stress" : "tickDown");
      if (crossed) { setTimeout(() => sfx("glitch"), 120); addTrauma(0.28); }
      paintResource(key, true);
      floatNum(anchor, delta > 0 ? `+${delta}` : `−${-delta}`, "stress");
    } else {
      sfx(delta > 0 ? "mana" : "tickDown");
      paintResource(key, true);
      floatNum(anchor, delta > 0 ? `+${delta}` : `−${-delta}`, "mana");
    }
    countTo(input, from, to, 420);
    syncDanger();
  }

  /* ================================================================== ЗОНА 2: активные эффекты */
  function effectItem(ef) {
    const d = DEBUFFS[ef.key];
    const max = Object.keys(d.states).length;
    return `<li class="effect-item" data-effect-id="${ef._id}" tabindex="0"
        data-hint="Наведение~описание стадии|Плюс и минус~стадия эффекта|Снять~убрать эффект">
      <span class="effect-icon"><img src="assets/debuffs/${d.icon}" alt="" /></span>
      <span class="osx-effect-name">${esc(d.name)}</span>
      <span class="osx-pips" aria-label="Стадия ${ef.stage} из ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < ef.stage ? "is-on" : ""}"></i>`).join("")}</span>
      <div class="osx-effect-pop" role="group" aria-label="${esc(d.name)}">
        <div class="effect-details"><strong>${esc(d.name)}</strong><p>${esc(d.states[ef.stage])}</p></div>
        <div class="osx-effect-ctrl">
          <button type="button" class="osx-mini effect-level-decrease" ${ef.stage <= 1 ? "disabled" : ""} aria-label="Понизить стадию" data-hint-key="Плюс и минус">${ic("i-minus")}</button>
          <span class="effect-level-display">Стадия ${ef.stage}/${max}</span>
          <button type="button" class="osx-mini effect-level-increase" ${ef.stage >= max ? "disabled" : ""} aria-label="Повысить стадию" data-hint-key="Плюс и минус">${ic("i-plus")}</button>
          <button type="button" class="osx-mini remove-effect" data-hint-key="Снять">${ic("i-trash")}Снять</button>
        </div>
      </div>
    </li>`;
  }
  function renderEffects() {
    const list = $(".osx-effects-list");
    $("ul", list).innerHTML = A.effects.map(effectItem).join("");
    list.classList.toggle("is-compact", A.effects.length > 3);
    $(".osx-effects-count").textContent = A.effects.length;
  }
  // Обновление стадии на месте: поповер остаётся открытым под курсором
  function updateEffect(li, ef) {
    const d = DEBUFFS[ef.key], max = Object.keys(d.states).length;
    $$(".osx-pips i", li).forEach((p, i) => {
      const on = i < ef.stage;
      if (on && !p.classList.contains("is-on") && !calm()) p.animate([{ transform: "skewX(-12deg) scaleY(2)" }, { transform: "skewX(-12deg)" }], { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" });
      p.classList.toggle("is-on", on);
    });
    $(".osx-pips", li).setAttribute("aria-label", `Стадия ${ef.stage} из ${max}`);
    $(".effect-details p", li).textContent = d.states[ef.stage];
    $(".effect-level-display", li).textContent = `Стадия ${ef.stage}/${max}`;
    $(".effect-level-decrease", li).disabled = ef.stage <= 1;
    $(".effect-level-increase", li).disabled = ef.stage >= max;
  }
  // Поповер не вылезает за ширину блока эффектов
  $(".osx-effects-list").addEventListener("pointerover", (e) => {
    const li = e.target.closest(".effect-item");
    if (!li || li.dataset.popPlaced) return;
    const list = $(".osx-effects-list"), W = list.clientWidth, x = li.offsetLeft, popW = 252;
    li.style.setProperty("--pop-x", `${Math.max(-x, Math.min(0, W - popW - x))}px`);
    li.dataset.popPlaced = "1";
  });

  async function applyDebuffDialog(trigger) {
    let pick = null, stg = 1;
    const ok = await openDialog({
      title: "Наложить дебафф", trigger, wide: true,
      lead: "Выберите состояние и стадию. Если такой эффект уже висит, стадия обновится.",
      body: `<div class="osx-debuff-grid">${Object.entries(DEBUFFS).map(([k, d]) => `<button type="button" class="osx-debuff-opt" data-key="${k}" aria-pressed="false"><img src="assets/debuffs/${d.icon}" alt="" />${esc(d.name)}</button>`).join("")}</div>
        <div class="osx-stage-pick">${[1, 2, 3].map((n) => `<button type="button" data-stage="${n}" aria-pressed="${n === 1}">Стадия ${n}</button>`).join("")}</div>
        <p class="osx-stage-desc">Состояние не выбрано</p>`,
      buttons: [{ label: "Отмена", ghost: true, value: null }, { label: "Наложить", icon: "i-plus", value: () => (pick ? { key: pick, stage: stg } : (sfx("error"), undefined)) }],
      onMount(api) {
        const desc = $(".osx-stage-desc", api.el);
        const sync = () => {
          const d = pick && DEBUFFS[pick];
          const max = d ? Object.keys(d.states).length : 3;
          stg = Math.min(stg, max);
          $$("[data-stage]", api.el).forEach((b) => { const n = +b.dataset.stage; b.disabled = n > max; b.setAttribute("aria-pressed", String(n === stg)); });
          desc.textContent = d ? d.states[stg] : "Состояние не выбрано";
        };
        api.el.addEventListener("click", (e) => {
          const o = e.target.closest(".osx-debuff-opt");
          if (o) {
            pick = o.dataset.key;
            $$(".osx-debuff-opt", api.el).forEach((x) => x.setAttribute("aria-pressed", String(x === o)));
            sfx("select");
            sync();
            return;
          }
          const sb = e.target.closest("[data-stage]");
          if (sb && !sb.disabled) { stg = +sb.dataset.stage; sfx("move"); sync(); }
        });
      }
    });
    if (!ok) return;
    let ef = A.effects.find((x) => x.key === ok.key);
    if (ef) ef.stage = ok.stage;
    else { ef = { _id: "ef" + Date.now().toString(36), key: ok.key, stage: ok.stage }; A.effects.push(ef); }
    renderEffects();
    const li = $(`.effect-item[data-effect-id="${ef._id}"]`);
    if (li && !calm()) li.classList.add("is-stamp");
    sfx("stamp");
    addTrauma(0.12);
  }

  /* ================================================================== ЗОНА 3: вкладки */
  function moveCursor(instant) {
    const a = $(".osx-menu .navbar.active"), cur = $(".osx-menu-cursor");
    if (!a || !cur) return;
    const i = +a.style.getPropertyValue("--i") || 0;
    const step = parseFloat(getComputedStyle(win).getPropertyValue("--step")) || 7;
    const x = a.offsetLeft - i * step - 10 - 8, y = a.offsetTop + 3;
    if (instant || calm()) cur.style.transition = "none";
    cur.style.setProperty("--cx", `${x}px`);
    cur.style.setProperty("--cy", `${y}px`);
    cur.style.setProperty("--cw", `${a.offsetWidth + 16}px`);
    cur.style.setProperty("--ch", `${a.offsetHeight - 6}px`);
    cur.style.setProperty("--cr", `${MENU_TILT[i] || 0}deg`);
    if (instant || calm()) { void cur.offsetWidth; cur.style.transition = ""; }
  }

  function setMotif(tab) { $$(".osx-motif").forEach((m) => m.classList.toggle("is-active", m.dataset.tab === tab)); }
  function setGiant(tab, instant) {
    const g = $(".osx-giant");
    const old = $$("span:not(.is-leaving)", g);
    const s = document.createElement("span");
    s.textContent = TABS[tab].giant;
    g.appendChild(s);
    old.forEach((o) => {
      if (instant || calm()) { o.remove(); return; }
      o.classList.add("is-leaving");
      o.animate([{ transform: "none", opacity: 1 }, { transform: "translateX(-5%)", opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" }).onfinish = () => o.remove();
    });
    if (!instant && !calm()) s.animate([{ transform: "translateX(7%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 640, easing: "cubic-bezier(.19,1,.22,1)" });
  }
  function updateRule() {
    const a = $(`.osx-menu .navbar[data-tab="${ui.tab}"]`);
    $(".osx-rule-caption").textContent = a ? a.dataset.caption : "";
    const inv = A.inventory;
    const count = [...inv.usedGrid, ...inv.inventoryGrid].filter(Boolean).length;
    const data = {
      biography: `Досье ${A.dossier}`,
      inventory: `Груз ${count} / ${Math.max(8, 8 + stat("Stamina").value)}`,
      equipment: `В руках и на теле: ${A.equipment.filter((e) => e.inHand).length}`,
      skills: `Способностей: ${A.abilities.length}`
    };
    $(".osx-rule-data").textContent = data[ui.tab] || "";
  }

  function switchTab(tab, { instant = false } = {}) {
    if (!TABS[tab]) tab = "biography";
    const before = ui.tab;
    ui.tab = tab;
    store.set("lastActiveTab", tab);
    win.dataset.tab = tab;
    $$(".osx-menu .navbar").forEach((a) => {
      const on = a.dataset.tab === tab;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    moveCursor(instant);
    const swap = () => {
      $$(".osx-content .tab-bar").forEach((t) => t.classList.toggle("active", t.id === tab));
      content.scrollTop = ui.scroll[tab] || 0;
      updateRule();
      setMotif(tab);
      setGiant(tab, instant);
      const pane = $(`#${tab}`);
      if (!instant && !calm()) pane.animate([{ opacity: 0, transform: "translateX(18px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" });
    };
    if (instant || before === tab || calm()) { swap(); if (!instant && before !== tab) sfx("tab"); return; }
    sfx("tab");
    sfx("swoosh");
    const [a, b] = $$(".osx-wipe i");
    const kf = [{ transform: "translateX(-160%) skewX(-18deg)" }, { transform: "translateX(260%) skewX(-18deg)" }];
    a.animate(kf, { duration: 440, easing: "cubic-bezier(.76,0,.24,1)", fill: "both" });
    b.animate(kf, { duration: 440, delay: 50, easing: "cubic-bezier(.76,0,.24,1)", fill: "both" });
    setTimeout(swap, 200);
  }

  /* ================================================================== ВКЛАДКА: биография */
  const BIO_FIELDS = [["nickname", "Позывной"], ["faction", "Фракция"], ["rankTitle", "Звание"], ["age", "Возраст"], ["birthday", "День рождения"], ["height", "Рост"], ["weight", "Вес"], ["orientation", "Ориентация"]];
  const BIO_TEXTS = [["biography", "История"], ["positiveTraits", "Положительные черты"], ["negativeTraits", "Отрицательные черты"], ["fears", "Страхи"], ["additionalInfo", "Дополнительно"]];
  function renderBio() {
    const ro = ui.edit ? "" : "readonly";
    $("#biography").innerHTML = `
      <div class="osx-fields" data-hint="Поля~меняются в режиме Edit">
        ${BIO_FIELDS.map(([k, l]) => `<div class="osx-field"><label for="bio-${k}">${l}</label><input id="bio-${k}" class="osx-in" type="text" name="system.bio.${k}" data-bio="${k}" value="${esc(A.bio[k])}" ${ro} /></div>`).join("")}
      </div>
      ${BIO_TEXTS.map(([k, l]) => `<div class="osx-entry" data-hint="Текст~меняется в режиме Edit"><h4>${l}</h4><textarea name="system.${k}" data-bio-text="${k}" rows="2" ${ro} aria-label="${l}">${esc(A[k])}</textarea></div>`).join("")}`;
  }

  /* ================================================================== ВКЛАДКА: инвентарь */
  const GRIDS = { used: "usedGrid", inventory: "inventoryGrid", storage: "storageGrid" };
  function slotHtml(type, idx, id) {
    const it = id && A.inventory.items[id];
    if (!it) return `<div class="inventory-slot empty" data-slot-type="${type}" data-slot-index="${idx}"><span class="osx-slot-n">${idx + 1}</span></div>`;
    return `<div class="inventory-slot item" data-slot-type="${type}" data-slot-index="${idx}" data-item-id="${id}" draggable="true" tabindex="0"
        data-hint="Перетащить~в другую ячейку|2×ЛКМ~открыть предмет|Наведение~описание"
        data-hint-edit="Крестик~удалить предмет|Перетащить~в другую ячейку|2×ЛКМ~открыть предмет">
      <span class="osx-slot-n">${idx + 1}</span>
      <svg class="inventory-icon" item-draggable viewBox="0 0 48 48" aria-hidden="true"><use href="#it-${it.icon}"/></svg>
      ${it.qty > 1 ? `<span class="osx-qty">×${it.qty}</span>` : ""}
      <button type="button" class="item-delete" aria-label="Удалить ${esc(it.name)}" data-hint-key="Крестик">${ic("i-close")}</button>
      <div class="inventory-tooltip"><span class="osx-tip-title">${esc(it.name)}</span><p class="osx-tip-muted">${esc(it.type)} · ${it.qty} шт.</p><p>${esc(it.desc)}</p></div>
    </div>`;
  }
  function renderInventory() {
    const inv = A.inventory;
    const cap = Math.max(8, 8 + stat("Stamina").value); // OrderActor: max(8, 8 + Выносливость)
    const maxSlots = inv.inventorySlots + inv.quickAccessSlots;
    const count = [...inv.usedGrid, ...inv.inventoryGrid].filter(Boolean).length;
    const filled = (g) => g.filter(Boolean).length;
    $("#inventory").innerHTML = `
      <div class="inventory-capacity">
        <div class="inventory-gacs osx-cap-card" data-hint="ГАЦ~введите сумму, валюта Ордена">
          <label class="osx-label" for="osx-gacs">ГАЦ</label>
          <input id="osx-gacs" type="text" inputmode="numeric" name="data.gacs" value="${A.gacs}" data-dtype="Number" />
        </div>
        <div class="osx-cap-card ${count > cap ? "is-over" : ""}" data-hint="Грузоподъёмность~8 + Выносливость, считаются предметы вне хранилища">
          <span class="osx-label">Грузоподъёмность</span>
          <span class="osx-cap-val">${count}<small> / ${cap}</small></span>
          <span class="osx-cap-bar"><i style="--p:${Math.min(1, count / cap).toFixed(3)}"></i></span>
        </div>
        <div class="osx-cap-card ${count > maxSlots ? "is-over" : ""}" data-hint="Вместимость~ячейки «Используется» и «Ячейки»">
          <span class="osx-label">Вместимость</span>
          <span class="osx-cap-val">${count}<small> / ${maxSlots}</small></span>
          <span class="osx-cap-bar"><i style="--p:${Math.min(1, count / maxSlots).toFixed(3)}"></i></span>
        </div>
        ${count > maxSlots ? `<p class="inventory-warning">Инвентарь переполнен!</p>` : ""}
      </div>
      <h3 class="osx-h3">Используется <b>${filled(inv.usedGrid)} / ${inv.usedGrid.length}</b></h3>
      <div class="inventory-grid used-grid">${inv.usedGrid.map((id, i) => slotHtml("used", i, id)).join("")}</div>
      <h3 class="osx-h3">Ячейки <b>${filled(inv.inventoryGrid)} / ${inv.inventoryGrid.length}</b></h3>
      <div class="inventory-grid">${inv.inventoryGrid.map((id, i) => slotHtml("inventory", i, id)).join("")}</div>
      <h3 class="osx-h3">Хранилище <b>${filled(inv.storageGrid)} / ${inv.storageGrid.length}</b></h3>
      <div class="inventory-grid storage-grid">${inv.storageGrid.map((id, i) => slotHtml("storage", i, id)).join("")}</div>`;
    if (ui.tab === "inventory") updateRule();
  }

  // Перетаскивание: нативный DnD, как в Foundry (тот же dataTransfer уйдёт на хотбар и другие листы)
  let drag = null;
  content.addEventListener("dragstart", (e) => {
    const slot = e.target.closest(".inventory-slot[data-item-id]");
    if (!slot) return;
    drag = { type: slot.dataset.slotType, idx: +slot.dataset.slotIndex, id: slot.dataset.itemId };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: `Actor.demo.Item.${drag.id}` }));
    hideTip();
    sfx("pick");
    requestAnimationFrame(() => { slot.classList.add("is-lifting"); document.body.classList.add("is-dragging-inv"); });
  });
  content.addEventListener("dragover", (e) => {
    if (!drag) return;
    const slot = e.target.closest(".inventory-slot");
    if (!slot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!slot.classList.contains("is-over")) {
      $$(".inventory-slot.is-over", content).forEach((s) => s.classList.remove("is-over"));
      slot.classList.add("is-over");
      sfx("move");
    }
  });
  content.addEventListener("drop", (e) => {
    if (!drag) return;
    const slot = e.target.closest(".inventory-slot");
    if (!slot) return;
    e.preventDefault();
    const to = { type: slot.dataset.slotType, idx: +slot.dataset.slotIndex };
    const gFrom = A.inventory[GRIDS[drag.type]], gTo = A.inventory[GRIDS[to.type]];
    const other = gTo[to.idx];
    gTo[to.idx] = drag.id;
    gFrom[drag.idx] = other || null;
    const id = drag.id;
    endDrag();
    renderInventory();
    const placed = $(`.inventory-slot[data-item-id="${id}"]`, content);
    if (placed && !calm()) placed.classList.add("is-dropped");
    sfx("drop");
  });
  function endDrag() {
    drag = null;
    document.body.classList.remove("is-dragging-inv");
    $$(".inventory-slot.is-over, .inventory-slot.is-lifting", content).forEach((s) => s.classList.remove("is-over", "is-lifting"));
  }
  content.addEventListener("dragend", endDrag);

  /* ================================================================== ВКЛАДКА: снаряжение */
  const EQ_SECTIONS = [["MainWeapon", "Основное оружие"], ["SecondaryWeapon", "Дополнительное оружие"], ["MeleeWeapon", "Ближний бой"], ["Armor", "Броня"]];
  function eqCard(w) {
    const isArmor = w.kind === "armor";
    const rollCls = w.type === "meleeweapon" ? "roll-attack" : "roll-ranged-attack";
    const stateLabel = isArmor ? "Надета" : "В руках";
    return `<div class="osx-eq-card ${isArmor ? "armor-card" : "weapon-card"} item ${w.inHand ? "is-equipped" : ""}" data-item-id="${w._id}" data-state-label="${stateLabel}"
        data-hint="${isArmor ? "Переключатель~надеть или снять" : "Переключатель~взять в руки или убрать|Кубик~бросок атаки"}|Ключ~модификации|Название~открыть предмет">
      <a class="osx-eq-media item-edit" role="button" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 200 70"><use href="#eq-${w.art}"/></svg></a>
      <div class="osx-eq-main">
        <a class="os-equipment-name item-edit" role="button" tabindex="0" data-hint-key="Название">${esc(w.name)}</a>
        <div class="os-eq-tags">${(w.tags || []).map(([n, d]) => `<span class="order-tag-pill">${esc(n)}<span class="osx-tip-src"><span class="osx-tip-title">${esc(n)}</span>${esc(d)}</span></span>`).join("")}</div>
        <div class="os-equipment-metrics">${(w.metrics || []).map(([k, v]) => `<div class="os-equipment-metric"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
      </div>
      ${w.secondary ? `<div class="os-equipment-secondary-metrics">${w.secondary.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join("")}</div>` : ""}
      ${w.onHit ? `<div class="os-equipment-effects">При попадании: ${esc(w.onHit)}</div>` : ""}
      <div class="os-equipment-card-actions">
        <button type="button" class="equipment-state-toggle ${w.inHand ? "is-active" : ""}" data-equipment-kind="${isArmor ? "armor" : "weapon"}" aria-pressed="${!!w.inHand}" data-hint-key="Переключатель"><span class="os-equipment-state-dot"></span>${stateLabel}</button>
        <span class="osx-eq-spacer"></span>
        <button type="button" class="osx-iconbtn equipment-modifications-open" aria-label="Модификации: ${esc(w.name)}" data-hint-key="Ключ">${ic("i-wrench")}</button>
        ${isArmor ? "" : `<button type="button" class="osx-d20 osx-d20--sm ${rollCls}" aria-label="Атака: ${esc(w.name)}" data-hint-key="Кубик">${ic("i-d20")}</button>`}
      </div>
    </div>`;
  }
  function renderEquipment() {
    $("#equipment").innerHTML = `
      <div class="osx-eq-top" data-hint="Кулак~импровизированная атака подручным предметом">
        <button type="button" class="osx-btn osx-btn--ghost roll-improvised-attack" data-hint-key="Кулак">${ic("i-fist")}Импровизированная атака</button>
      </div>
      ${EQ_SECTIONS.map(([sec, title]) => {
        const list = A.equipment.filter((e) => e.section === sec);
        return `<section class="os-equipment-section"><h3 class="osx-h3">${title}</h3>${list.length ? list.map(eqCard).join("") : `<p class="osx-dlg-note">Пусто: перетащите предмет на лист</p>`}</section>`;
      }).join("")}`;
    if (ui.tab === "equipment") updateRule();
  }

  async function attackRoll(w, trigger) {
    const ranged = w.type !== "meleeweapon";
    const st = stat(ranged ? "Accuracy" : "Strength");
    const res = await rollModeDialog({ title: `Бросок атаки — ${w.name}`, trigger, lead: `${ranged ? "Дальний" : "Ближний"} бой · ${st.label} ${signed(st.value)}` });
    if (!res) return;
    const parts = [{ label: st.label, v: st.value }];
    const m = sumMods(st.modifiers);
    if (m) parts.push({ label: "мод.", v: m });
    res.custom.forEach((c) => parts.push({ label: c.label.toLowerCase(), v: c.v }));
    const dmg = (w.metrics.find(([k]) => k === "Урон") || [])[1];
    showRoll({ title: w.name, kind: ranged ? "Атака дальнего боя" : "Атака ближнего боя", mode: res.mode, parts, chatLines: dmg ? [`Урон: ${esc(dmg)}`] : [] });
  }

  async function improvisedAttack(trigger) {
    const SIZES = ["Маленькое импровизированное оружие", "Стандартное импровизированное оружие", "Тяжелое импровизированное оружие", "Сверхтяжелое импровизированное оружие"];
    const res = await rollModeDialog({
      title: "Импровизированная атака", trigger,
      extra: `<div class="osx-form-row"><label class="osx-label" for="osx-impro">Предмет в руке</label><select id="osx-impro" class="osx-select osx-select--wide" data-pick>${SIZES.map((s, i) => `<option ${i === 1 ? "selected" : ""}>${s}</option>`).join("")}</select></div>`
    });
    if (!res) return;
    const size = res.pick || SIZES[1];
    const st = stat("Strength");
    showRoll({ title: "Импровизированная атака", kind: size, mode: res.mode, parts: [{ label: st.label, v: st.value }, ...res.custom.map((c) => ({ label: c.label.toLowerCase(), v: c.v }))] });
  }

  /* ================================================================== ВКЛАДКА: способности */
  const GROUPS = [
    ["skills", "Навыки", (a) => a.kind === "skills" && !a.racial, true],
    ["racial", "Расовые", (a) => a.racial, false],
    ["spells", "Заклинания", (a) => a.kind === "spells", true],
    ["perks", "Перки", (a) => a.kind === "perks", false]
  ];
  function abilityCard(a) {
    const spell = a.kind === "spells", perk = a.kind === "perks";
    const tags = a.tags.map((t) => A.abilityTags[t]).filter(Boolean).join(" · ");
    const keys = `${a.roll ? "Кубик~бросок|" : ""}${perk ? "" : "Книга~тренировка|"}ПКМ~карточка в чат|2×ЛКМ~открыть`;
    return `<div class="ability-card ${spell ? "spell-card" : "skill-card"} item" data-item-id="${a._id}" tabindex="0"
        data-hint="${keys}" data-hint-edit="Крестик~удалить|${keys}">
      <div class="osx-ab-ic">${mask(a.icon)}</div>
      <div class="osx-ab-main">
        <span class="ability-card-name">${esc(a.name)}</span>
        <div class="osx-ab-meta">
          ${perk ? "" : `<span class="ability-level-badge">Ур. ${a.level}${itemMax(a) ? `/${itemMax(a)}` : ""}</span>`}
          <span class="osx-ab-tag">${esc(tags)}</span>
          ${a.cooldown ? `<span class="osx-cd">КД ${a.cooldown}</span>` : ""}
        </div>
        ${perk ? "" : `<div class="ability-training-progress ${a.max ? "is-max" : ""}" style="--ability-progress:${itemProgress(a)}" aria-label="Прогресс обучения ${itemProgress(a)}%"></div>`}
      </div>
      <div class="osx-ab-actions">
        ${perk ? "" : `<button type="button" class="osx-iconbtn train-item" aria-label="Тренировка: ${esc(a.name)}" data-hint-key="Книга">${ic("i-book")}</button>`}
        ${a.roll ? `<button type="button" class="osx-d20 osx-d20--sm roll-dice" aria-label="Бросок: ${esc(a.name)}" data-hint-key="Кубик">${ic("i-d20")}</button>` : ""}
        <button type="button" class="osx-x ${spell ? "delete-spell" : "delete-skill"}" aria-label="Удалить ${esc(a.name)}" data-hint-key="Крестик">${ic("i-close")}</button>
      </div>
      <div class="${spell ? "spell-tooltip" : "skill-tooltip"}">${a.info.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("")}</div>
    </div>`;
  }
  function renderAbilities() {
    const tags = Object.entries(A.abilityTags);
    const groups = GROUPS.map(([key, title, test, byCircle]) => {
      const list = A.abilities.filter(test);
      if (!list.length) return "";
      let body;
      if (byCircle) {
        const circles = [...new Set(list.map((a) => a.circle))].sort((x, y) => x - y);
        body = circles.map((c) => `<div class="skills-circle-group" data-circle="${c}"><div class="osx-circle">Круг ${c}</div>${list.filter((a) => a.circle === c).map(abilityCard).join("")}</div>`).join("");
      } else body = list.map(abilityCard).join("");
      return `<section class="osx-ab-group" data-group="${key}"><h3 class="osx-h3">${title} <b>${list.length}</b></h3>${body}</section>`;
    }).join("");
    $("#skills").innerHTML = `
      <div class="os-ability-browser">
        <div class="ability-browser-toolbar">
          <label class="ability-search-wrap">${ic("i-search")}<input type="search" class="ability-search-input" placeholder="Поиск по названию" value="${esc(ui.query)}" aria-label="Поиск способностей" /></label>
          <button type="button" class="ability-filter-toggle ${ui.filterOpen ? "active" : ""}" aria-expanded="${ui.filterOpen}" data-hint="Фильтры~по типу применения">${ic("i-filter")}Фильтры<span class="ability-filter-count"></span></button>
        </div>
        <div class="ability-filter-panel ${ui.filterOpen ? "is-open" : ""}">
          <div class="ability-filter-heading-row"><span class="osx-label">Тип применения</span><button type="button" class="osx-btn osx-btn--ghost osx-btn--sm ability-filter-reset">Сбросить</button></div>
          <div class="ability-filter-options">${tags.map(([k, l]) => `<button type="button" class="ability-filter-option" data-filter-tag="${k}" aria-pressed="false">${mask(k)}${esc(l)}</button>`).join("")}</div>
          <div class="ability-active-filters-list"></div>
        </div>
        <p class="ability-results-row is-hidden"></p>
        <div class="ability-groups">${groups}</div>
        <p class="ability-no-results">Ничего не найдено</p>
      </div>`;
    applyAbilityFilter();
    if (ui.tab === "skills") updateRule();
  }
  function applyAbilityFilter() {
    const root = $("#skills");
    const q = ui.query.trim().toLowerCase(), tags = [...ui.tags];
    let shown = 0;
    $$(".ability-card", root).forEach((c) => {
      const a = A.abilities.find((x) => x._id === c.dataset.itemId);
      const ok = !!a && (!q || a.name.toLowerCase().includes(q)) && tags.every((t) => a.tags.includes(t));
      c.hidden = !ok;
      if (ok) shown++;
    });
    $$(".skills-circle-group, .osx-ab-group", root).forEach((g) => { g.hidden = !g.querySelector(".ability-card:not([hidden])"); });
    const filtering = !!q || tags.length > 0;
    const row = $(".ability-results-row", root);
    row.classList.toggle("is-hidden", !filtering);
    row.textContent = `Найдено: ${shown} из ${A.abilities.length}`;
    $(".ability-no-results", root).classList.toggle("is-visible", shown === 0);
    $$(".ability-filter-option", root).forEach((o) => { const on = ui.tags.has(o.dataset.filterTag); o.classList.toggle("active", on); o.setAttribute("aria-pressed", String(on)); });
    const cnt = $(".ability-filter-count", root);
    cnt.textContent = tags.length;
    cnt.classList.toggle("is-visible", tags.length > 0);
    $(".ability-active-filters-list", root).innerHTML = tags.length
      ? tags.map((t) => `<button type="button" class="ability-active-filter" data-remove-tag="${t}">${esc(A.abilityTags[t])}${ic("i-close")}</button>`).join("")
      : `<span class="ability-no-active-filters">Фильтры не выбраны</span>`;
  }

  function abilityRoll(a, trigger) {
    // Разбираем «Формула броска» вида «d20 + Меткость + 2»
    const formula = (a.info.find(([k]) => k === "Формула броска") || [])[1] || "d20";
    const parts = [];
    formula.split("+").map((t) => t.trim()).forEach((t) => {
      if (/^d20$/i.test(t)) return;
      if (/^-?\d+$/.test(t)) { parts.push({ label: "бонус", v: +t }); return; }
      const s = statByLabel(t);
      if (s) { parts.push({ label: s.label, v: s.value }); const m = sumMods(s.modifiers); if (m) parts.push({ label: "мод.", v: m }); }
    });
    spinDie(trigger);
    showRoll({ title: a.name, kind: (a.info.find(([k]) => k === "Тип применения") || [])[1] || "Способность", parts });
  }

  function abilityToChat(a, card) {
    postChat({ title: a.name, html: a.info.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("") });
    if (calm()) return;
    card.classList.remove("is-sent"); void card.offsetWidth; card.classList.add("is-sent");
    setTimeout(() => card.classList.remove("is-sent"), 950);
  }

  /* --- тренировка навыка/заклинания: _openItemTrainingDialog и его помощники --- */
  const ITEM_MAX_LEVEL = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
  const ITEM_SEGMENTS = { 0: [8, 10, 12], 1: [12, 12, 14, 16, 18], 2: [14, 16, 18, 22, 26, 32, 38], 3: [16, 20, 24, 30, 36, 44, 52, 62, 72], 4: [18, 24, 30, 38, 46, 56, 66, 78, 90, 104, 118] };
  const itemMax = (a) => ITEM_MAX_LEVEL[a.circle] ?? 0;
  const itemSeg = (a) => (itemMax(a) && a.level >= itemMax(a) ? 0 : ITEM_SEGMENTS[a.circle]?.[a.level] ?? 0);
  const itemDC = (a) => 10 + 2 * a.circle + 2 * Math.floor(Math.max(0, a.level) / 2);
  function itemProgress(a) {
    if (a.filled == null) a.filled = Math.round(((a.progress || 0) / 100) * itemSeg(a));
    const total = itemSeg(a);
    return total ? Math.round((a.filled / total) * 100) : 100;
  }

  async function trainItem(a, trigger) {
    if (itemMax(a) && a.level >= itemMax(a)) { notify("Максимальный уровень: тренировка не требуется."); return; }
    itemProgress(a);
    const total = itemSeg(a), dc = itemDC(a), dice = trainingDice();
    const opts = A.stats.map((s) => `<option value="${s.key}">${esc(s.label)} (${signed(s.value)} → бонус ${signed(trainingBonus(s.value))})</option>`).join("");
    const pickKey = await openDialog({
      title: `Тренировка: ${a.name}`, trigger,
      lead: `СЛ ${dc} · ${dice} броска`,
      body: `<div class="osx-chips">
          <span class="osx-chip">Круг <b>${a.circle}</b></span>
          <span class="osx-chip">Уровень <b>${a.level}/${itemMax(a)}</b></span>
          <span class="osx-chip">Прогресс <b>${a.filled}/${total}</b></span>
          <span class="osx-chip">Кубики <b>${dice}d20</b></span>
        </div>
        <p>Выберите характеристику для бонуса обучения. Успех даёт +1 О.О, чистая 20 даёт +2 О.О.</p>
        <p class="osx-dlg-note">За чистую 1 мастер решает: −1 О.О или тренировка прерывается.</p>
        <div class="osx-form-row"><label class="osx-label" for="osx-train-attr">Бонус обучения</label><select id="osx-train-attr" class="osx-select osx-select--wide">${opts}</select></div>`,
      buttons: [{ label: "Отмена", ghost: true, value: null }, { label: "Бросить", icon: "i-d20", value: (api) => $("#osx-train-attr", api.el).value }],
      onMount(api) { const s = $("#osx-train-attr", api.el); s.value = a.kind === "spells" ? "Magic" : "Accuracy"; }
    });
    if (!pickKey) return;
    const st = stat(pickKey), bonus = trainingBonus(st.value);
    const results = [];
    for (let i = 1; i <= dice; i++) {
      const nat = d20(), tot = nat + bonus, crit = nat === 20, fail = nat === 1, ok = crit || (!fail && tot >= dc);
      results.push({ i, nat, tot, crit, fail, ok, pts: crit ? 2 : ok ? 1 : 0 });
      sfx(crit ? "diceCrit" : fail ? "diceFail" : "diceLand");
      postChat({ title: `Тренировка: ${a.name} (${i}/${dice})`, lines: [`СЛ ${dc} · ${esc(st.label)} ${signed(bonus)}`], total: tot });
      await sleep(calm() ? 0 : 260);
    }
    const pts = results.reduce((s, r) => s + r.pts, 0), critFails = results.filter((r) => r.fail).length;
    const rows = results.map((r) => `<li><span>Бросок ${r.i}</span><code>${r.nat} ${signed(bonus)} = ${r.tot}</code>
        <b class="${r.crit || r.ok ? "is-ok" : r.fail ? "is-bad" : ""}">${r.crit ? "Крит. успех" : r.fail ? "Крит. провал" : r.ok ? "Успех" : "Провал"}</b><span>О.О ${r.pts ? "+" + r.pts : "0"}</span></li>`).join("");
    const crit = critFails ? `<fieldset class="osx-radio"><legend>Чистых единиц: ${critFails}. Решает мастер:</legend>
        <label><input type="radio" name="cf" value="lose" checked /> Потерять ${critFails} О.О</label>
        <label><input type="radio" name="cf" value="abort" /> Прервать тренировку</label></fieldset>` : "";
    const mode = await openDialog({
      title: `Тренировка: результат — ${a.name}`,
      lead: `Прогресс ${a.filled}/${total} · О.О до штрафов: <b>${pts}</b>`,
      body: `<ol class="osx-roll-list">${rows}</ol>${crit}`,
      buttons: [{ label: "Не применять", ghost: true, value: null }, { label: "Применить", icon: "i-check", value: (api) => ($("input[name=cf]:checked", api.el) || {}).value || "none" }]
    });
    if (!mode) return;
    if (mode === "abort") { notify("Тренировка прервана: очки обучения не применены."); return; }
    const net = pts - (mode === "lose" ? critFails : 0);
    if (!net) { notify("Очки обучения не изменились."); return; }
    // _applyItemTrainingProgress: перенос через уровень, пока круг заполняется
    a.filled = Math.max(0, a.filled + net);
    let levels = 0;
    while (itemSeg(a) && a.filled >= itemSeg(a)) { a.filled -= itemSeg(a); a.level += 1; levels++; }
    if (itemMax(a) && a.level >= itemMax(a)) { a.level = itemMax(a); a.filled = 0; a.max = true; }
    const card = $(`.ability-card[data-item-id="${a._id}"]`);
    if (levels) {
      renderAbilities();
      const fresh = $(`.ability-card[data-item-id="${a._id}"]`);
      if (fresh) floatNum($(".osx-ab-ic", fresh), `Ур. ${a.level}`, "lvl");
      sfx("levelSmall");
    } else if (card) {
      $(".ability-training-progress", card).style.setProperty("--ability-progress", itemProgress(a));
      floatNum($(".osx-ab-ic", card), `${signed(net)} О.О`, net > 0 ? "lvl" : "dmg");
      sfx(net > 0 ? "tickUp" : "tickDown", 0.6);
    }
  }

  /* ================================================================== МОК ЛИСТА ПРЕДМЕТА */
  function openItemSheet(title, rows, trigger) {
    openDialog({
      title, trigger,
      lead: "В Foundry откроется лист предмета (item.sheet.render).",
      body: `<dl class="osx-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
    });
  }

  async function confirmDelete(name, trigger) {
    return openDialog({
      title: `Удалить «${name}»?`, trigger,
      body: `<p>Предмет исчезнет с листа. Отменить это нельзя.</p>`,
      buttons: [{ label: "Нет", ghost: true, value: null }, { label: "Да", icon: "i-trash", value: true }]
    });
  }
  function tearOut(el, after) {
    sfx("rip");
    if (calm() || !el) { after(); return; }
    el.classList.add("is-tear");
    el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate(14px,-12px) rotate(4deg)" }], { duration: 260, easing: "cubic-bezier(.55,0,1,.45)", fill: "forwards" }).onfinish = after;
  }

  /* ================================================================== ФОНОВЫЕ МОТИВЫ */
  function buildMotifs() {
    const st = "rgba(255,240,244,0.075)", red = "rgba(255,45,70,0.22)";
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

    $(".osx-motifs").innerHTML = `
      <svg class="osx-motif" data-tab="biography" viewBox="0 0 400 400">
        <g class="spin" fill="none" stroke="${st}" stroke-width="2.4">${fp}</g>
        <circle class="spin-rev" cx="200" cy="200" r="194" fill="none" stroke="${red}" stroke-width="1.2" stroke-dasharray="2 9"/>
        <path d="M200 0v34M200 366v34M0 200h34M366 200h34" stroke="${st}" stroke-width="2"/>
      </svg>
      <div class="osx-motif" data-tab="inventory"><div class="osx-motif-mesh"></div></div>
      <svg class="osx-motif" data-tab="equipment" viewBox="0 0 400 400">
        <g fill="none" stroke="${st}" stroke-width="2"><circle cx="200" cy="200" r="140"/><circle cx="200" cy="200" r="96" stroke-dasharray="6 10"/><circle cx="200" cy="200" r="34"/><path d="M200 30v120M200 250v120M30 200h120M250 200h120"/></g>
        <g class="spin-rev" stroke="${st}" stroke-width="2">${ticks}</g>
        <path d="M186 188h28l-14 24z" fill="${red}"/>
      </svg>
      <svg class="osx-motif" data-tab="skills" viewBox="0 0 400 400">
        <g fill="none" stroke="${red}" stroke-width="1.6"><circle cx="200" cy="200" r="188"/><circle cx="200" cy="200" r="150"/></g>
        <g class="spin" fill="rgba(255,45,70,0.2)">${runes}</g>
        <g class="spin-rev" fill="none" stroke="${st}" stroke-width="2">${tri(150, 0)}${tri(150, 180)}<circle cx="200" cy="200" r="76"/></g>
        <g class="spin-fast" fill="none" stroke="${red}" stroke-width="1.4"><rect x="146" y="146" width="108" height="108" transform="rotate(45 200 200)"/></g>
      </svg>`;
  }

  /* ================================================================== РЕЖИМ EDIT */
  function setEdit(on) {
    ui.edit = on;
    win.classList.toggle("is-edit", on);
    $(".os-edit-toggle").setAttribute("aria-pressed", String(on));
    $(".osx-name").readOnly = !on;
    $(".osx-rank-input").readOnly = !on;
    $$(".osx-ring-value").forEach((i) => { i.readOnly = !on; });
    $$("#biography .osx-in, #biography textarea").forEach((i) => { i.readOnly = !on; });
    sfx(on ? "toggleOn" : "toggleOff");
    if (hintSrc) renderHint(hintSrc);
  }

  /* ================================================================== ГАЙД */
  const GUIDE = [
    [".osx-p1", "Портрет", "Портрет, ранг, имя, раса и класс. Кнопки справа вверху меняют картинку и выбирают её кадр. Стрелка у ранга открывает мастер повышения."],
    ["#stats", "Характеристики", "Кольцо О.О: ЛКМ добавляет сегмент, ПКМ убирает. Название запускает тренировку, кубик открывает бросок. Скорость в конце списка."],
    [".osx-resources", "Показатели", "Здоровье, магическая усталость и стресс. Введите новое число: лист покажет урон, лечение или нагрузку."],
    [".osx-effects", "Активные эффекты", "«Дебафф» накладывает состояние со стадией. Наведите на эффект, чтобы сменить стадию или снять его."],
    [".osx-menu", "Разделы", "Биография, инвентарь, снаряжение и способности. С клавиатуры меню листается стрелками."],
    [".osx-hintbar", "Строка подсказок", "Показывает, что сделает клик по элементу под курсором. Справа баланс ГАЦ."]
  ];
  let guideStep = -1;
  function guideShow(i) {
    guideStep = clamp(i, 0, GUIDE.length - 1);
    const [sel, title, text] = GUIDE[guideStep];
    const target = $(sel, win);
    const r = localRect(target, win);
    const hole = $(".osx-guide-hole", guide);
    hole.style.setProperty("--gx", `${r.x - 4}px`);
    hole.style.setProperty("--gy", `${r.y - 4}px`);
    hole.style.setProperty("--gw", `${r.w + 8}px`);
    hole.style.setProperty("--gh", `${r.h + 8}px`);
    let card = $(".osx-guide-card", guide);
    if (!card) {
      guide.insertAdjacentHTML("beforeend", `<div class="osx-guide-card" role="dialog" aria-live="polite"><h4></h4><p></p><footer><span></span><div class="osx-guide-btns"><button type="button" class="osx-btn osx-btn--ghost osx-btn--sm" data-g="close">Закрыть</button><button type="button" class="osx-btn osx-btn--ghost osx-btn--sm" data-g="prev">Назад</button><button type="button" class="osx-btn osx-btn--sm" data-g="next">Дальше</button></div></footer></div>`);
      card = $(".osx-guide-card", guide);
    }
    $("h4", card).textContent = title;
    $("p", card).textContent = text;
    $("footer span", card).textContent = `${guideStep + 1} / ${GUIDE.length}`;
    $("[data-g=prev]", card).disabled = guideStep === 0;
    $("[data-g=next]", card).textContent = guideStep === GUIDE.length - 1 ? "Готово" : "Дальше";
    const W = win.clientWidth, H = win.clientHeight, cw = 300, ch = card.offsetHeight || 150;
    let tx = r.x + r.w + 18, ty = r.y + 10;
    if (tx + cw > W - 12) tx = r.x - cw - 18;
    if (tx < 12) { tx = clamp(r.x + r.w / 2 - cw / 2, 12, W - cw - 12); ty = r.y > H / 2 ? r.y - ch - 18 : r.y + r.h + 18; }
    card.style.setProperty("--tx", `${Math.round(tx)}px`);
    card.style.setProperty("--ty", `${Math.round(clamp(ty, 40, H - ch - 12))}px`);
    sfx("move");
  }
  function guideOpen() { guide.hidden = false; guideShow(0); sfx("open"); }
  function guideClose() { guide.hidden = true; guideStep = -1; sfx("close"); }
  guide.addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    if (b.dataset.g === "close") guideClose();
    else if (b.dataset.g === "prev") guideShow(guideStep - 1);
    else if (guideStep >= GUIDE.length - 1) guideClose();
    else guideShow(guideStep + 1);
  });

  /* ================================================================== НАСТРОЙКИ */
  const settings = $("#osx-settings");
  function toggleSettings(force) {
    const open = force ?? settings.hidden;
    settings.hidden = !open;
    $(".osx-settings-toggle").setAttribute("aria-expanded", String(open));
    sfx(open ? "open" : "close");
  }
  function setAccent(c, silent) {
    accent = c;
    document.documentElement.style.setProperty("--accent", c);
    $$(".osx-swatches [data-accent]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.accent === c)));
    store.set("osx-accent", c);
    drawAllRings();
    if (!silent) sfx("select");
  }
  function setMotion(on) {
    document.body.classList.toggle("order-no-animations", !on);
    $(".osx-set-motion").checked = on;
    store.set("osx-motion", on ? "1" : "0");
  }

  /* ================================================================== ОТКРЫТИЕ, ЗАКРЫТИЕ, ИНТРО */
  function playIntro() {
    if (calm()) return;
    stage.classList.remove("is-intro");
    void stage.offsetWidth;
    stage.classList.add("is-intro");
    const slash = document.createElement("div");
    slash.className = "osx-intro-slash";
    stage.appendChild(slash);
    setTimeout(() => slash.remove(), 620);
    setTimeout(() => stage.classList.remove("is-intro"), 1400);
    sfx("open");
    setTimeout(() => sfx("swoosh"), 140);
  }
  function closeSheet() {
    if (dlgCurrent) dlgCurrent.close(null, true);
    layer.hidden = true;
    hideTip();
    sfx("close");
    const done = () => { win.classList.add("is-closed"); $(".osx-reopen").hidden = false; ui.introPlayed = false; };
    if (calm()) { done(); return; }
    win.animate([{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.97" }], { duration: 180, easing: "ease-in" }).onfinish = done;
  }
  function openSheet() {
    $(".osx-reopen").hidden = true;
    win.classList.remove("is-closed");
    if (!calm()) win.animate([{ opacity: 0, scale: "0.98" }, { opacity: 1, scale: "1" }], { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" });
    moveCursor(true);
    if (!ui.introPlayed) { ui.introPlayed = true; playIntro(); }
  }

  /* ================================================================== ПОЛНЫЙ РЕНДЕР (как sheet.render в Foundry) */
  function renderAll() {
    renderNameplate();
    renderTags();
    renderStats();
    renderResources();
    renderEffects();
    renderBio();
    renderInventory();
    renderEquipment();
    renderAbilities();
    updateRule();
    $$(".osx-content .tab-bar").forEach((t) => t.classList.toggle("active", t.id === ui.tab));
    content.scrollTop = ui.scroll[ui.tab] || 0;
  }

  /* ================================================================== СОБЫТИЯ */
  form.addEventListener("submit", (e) => e.preventDefault());

  win.addEventListener("click", (e) => {
    const t = e.target;
    let el;

    // шапка
    if ((el = t.closest(".os-edit-toggle"))) { setEdit(!ui.edit); return; }
    if ((el = t.closest(".os-guide-toggle"))) { guide.hidden ? guideOpen() : guideClose(); return; }
    if ((el = t.closest(".osx-settings-toggle"))) { toggleSettings(); return; }
    if ((el = t.closest(".osx-swatches [data-accent]"))) { setAccent(el.dataset.accent); return; }
    if ((el = t.closest(".osx-close"))) { closeSheet(); return; }
    if ((el = t.closest("[data-mock]"))) { notify(el.dataset.mock === "sheet" ? "Foundry: окно выбора класса листа." : "Foundry: настройки прототипа токена."); sfx("select"); return; }

    // зона 1
    if ((el = t.closest(".osx-crop-btn"))) { ui.cropDraft ? endCrop(true) : startCrop(); return; }
    if ((el = t.closest(".osx-crop-done"))) { endCrop(true); return; }
    if ((el = t.closest(".osx-crop-reset"))) { ui.cropDraft = { ...DEFAULT_CROP }; applyCrop(ui.cropDraft); sfx("swoosh"); return; }
    if ((el = t.closest(".osx-swap-btn"))) { pickPortrait(el); return; }
    if ((el = t.closest("img[data-edit=img]"))) { if (!ui.cropDraft) pickPortrait(el); return; }
    if ((el = t.closest("[data-action=rank-up]"))) { rankUp(el); return; }
    if ((el = t.closest("[data-action=open-character-creation-wizard]"))) {
      openDialog({ title: "Помощь в создании", trigger: el, lead: "Мастер создания персонажа проведёт по шагам. Его можно пройти один раз на персонажа.", body: `<div class="osx-steps"><span>Раса</span>${ic("i-next")}<span>Класс</span>${ic("i-next")}<span>Характеристики</span>${ic("i-next")}<span>Навыки</span></div>` });
      return;
    }
    if ((el = t.closest(".osx-tags .item-edit"))) {
      const kind = el.closest(".item").dataset.kind;
      if (kind === "race") openItemSheet(A.race.name, [["Тип", "Раса"], ["Бонус", "+1 к Ловкости"], ["Расовый навык", "Звериное чутьё"]], el);
      else openItemSheet(A.klass.name, [["Тип", "Класс"], ["Бонус", "+1 к Меткости"], ["Стартовое оружие", "Снайперская винтовка"]], el);
      return;
    }
    if ((el = t.closest(".osx-tags .item-delete"))) {
      const kind = el.closest(".item").dataset.kind;
      confirmDelete(kind === "race" ? A.race.name : A.klass.name, el).then((ok) => {
        if (!ok) return;
        tearOut(el.closest(".item"), () => { if (kind === "race") A.race = null; else A.klass = null; renderTags(); renderNameplate(); });
      });
      return;
    }

    // характеристики
    if ((el = t.closest("canvas.circle-progress"))) { addSegment(el.dataset.attribute); return; }
    if ((el = t.closest(".train-characteristic"))) { openTraining(el.dataset.attribute, el); return; }
    if ((el = t.closest(".roll-characteristic"))) { spinDie(el); rollCharacteristic(el.dataset.attribute, el); return; }

    // эффекты
    if ((el = t.closest(".apply-debuff"))) { applyDebuffDialog(el); return; }
    if ((el = t.closest(".effect-level-increase, .effect-level-decrease"))) {
      const li = el.closest(".effect-item"), ef = A.effects.find((x) => x._id === li.dataset.effectId);
      const max = Object.keys(DEBUFFS[ef.key].states).length, up = el.classList.contains("effect-level-increase");
      ef.stage = clamp(ef.stage + (up ? 1 : -1), 1, max);
      updateEffect(li, ef);
      sfx(up ? "tickUp" : "tickDown", ef.stage / max);
      if (up) addTrauma(0.08);
      return;
    }
    if ((el = t.closest(".remove-effect"))) {
      const li = el.closest(".effect-item");
      tearOut(li, () => { A.effects = A.effects.filter((x) => x._id !== li.dataset.effectId); renderEffects(); });
      return;
    }

    // меню разделов
    if ((el = t.closest(".navbar"))) { e.preventDefault(); switchTab(el.dataset.tab); return; }
    if ((el = t.closest(".osx-gacs"))) { switchTab("inventory"); setTimeout(() => { const g = $("#osx-gacs"); if (g) { g.focus(); g.select(); } }, 260); return; }

    // инвентарь
    if ((el = t.closest(".inventory-slot .item-delete"))) {
      const slot = el.closest(".inventory-slot"), it = A.inventory.items[slot.dataset.itemId];
      confirmDelete(it.name, el).then((ok) => {
        if (!ok) return;
        tearOut($(".inventory-icon", slot), () => { A.inventory[GRIDS[slot.dataset.slotType]][+slot.dataset.slotIndex] = null; renderInventory(); });
      });
      return;
    }

    // снаряжение
    if ((el = t.closest(".equipment-state-toggle"))) {
      const card = el.closest(".item"), w = A.equipment.find((x) => x._id === card.dataset.itemId);
      w.inHand = !w.inHand;
      card.classList.toggle("is-equipped", w.inHand);
      el.classList.toggle("is-active", w.inHand);
      el.setAttribute("aria-pressed", String(w.inHand));
      sfx(w.inHand ? "toggleOn" : "toggleOff");
      if (!calm()) { card.classList.remove("is-snap"); void card.offsetWidth; card.classList.add("is-snap"); }
      updateRule();
      return;
    }
    if ((el = t.closest(".equipment-modifications-open"))) {
      const w = A.equipment.find((x) => x._id === el.closest(".item").dataset.itemId);
      openDialog({
        title: `Модификации: ${w.name}`, trigger: el,
        lead: "В Foundry откроется окно модификаций предмета системы.",
        body: `<dl class="osx-kv"><dt>Ствол</dt><dd>Свободно · подходит «Глушитель «Шёпот»» из инвентаря</dd><dt>Прицел</dt><dd>${w.kind === "armor" ? "Нет слота" : "Оптика «Сова-12»"}</dd><dt>Корпус</dt><dd>Свободно</dd></dl>`
      });
      return;
    }
    if ((el = t.closest(".roll-attack, .roll-ranged-attack"))) {
      spinDie(el);
      attackRoll(A.equipment.find((x) => x._id === el.closest(".item").dataset.itemId), el);
      return;
    }
    if ((el = t.closest(".roll-improvised-attack"))) { improvisedAttack(el); return; }
    if ((el = t.closest(".osx-eq-card .item-edit"))) {
      const w = A.equipment.find((x) => x._id === el.closest(".item").dataset.itemId);
      openItemSheet(w.name, [...w.metrics, ...(w.secondary || [])], el);
      return;
    }

    // способности
    if ((el = t.closest(".ability-filter-toggle"))) {
      ui.filterOpen = !ui.filterOpen;
      el.classList.toggle("active", ui.filterOpen);
      el.setAttribute("aria-expanded", String(ui.filterOpen));
      $(".ability-filter-panel").classList.toggle("is-open", ui.filterOpen);
      sfx(ui.filterOpen ? "open" : "close");
      return;
    }
    if ((el = t.closest(".ability-filter-option"))) {
      const k = el.dataset.filterTag;
      ui.tags.has(k) ? ui.tags.delete(k) : ui.tags.add(k);
      sfx(ui.tags.has(k) ? "toggleOn" : "toggleOff");
      applyAbilityFilter();
      return;
    }
    if ((el = t.closest(".ability-active-filter"))) { ui.tags.delete(el.dataset.removeTag); sfx("toggleOff"); applyAbilityFilter(); return; }
    if ((el = t.closest(".ability-filter-reset"))) { ui.tags.clear(); ui.query = ""; $(".ability-search-input").value = ""; sfx("swoosh"); applyAbilityFilter(); return; }
    if ((el = t.closest(".roll-dice"))) { abilityRoll(A.abilities.find((x) => x._id === el.closest(".item").dataset.itemId), el); return; }
    if ((el = t.closest(".train-item"))) { trainItem(A.abilities.find((x) => x._id === el.closest(".item").dataset.itemId), el); return; }
    if ((el = t.closest(".delete-skill, .delete-spell"))) {
      const card = el.closest(".item"), a = A.abilities.find((x) => x._id === card.dataset.itemId);
      openDialog({
        title: el.classList.contains("delete-spell") ? "Удалить заклинание" : "Удалить скилл", trigger: el,
        body: `<p>Удалить «${esc(a.name)}» с листа?</p>`,
        buttons: [{ label: "Нет", ghost: true, value: null }, { label: "Да", icon: "i-trash", value: true }]
      }).then((ok) => {
        if (!ok) return;
        tearOut(card, () => { A.abilities = A.abilities.filter((x) => x._id !== a._id); renderAbilities(); updateRule(); });
      });
    }
  });

  // ПКМ: снимает сегмент с кольца, отправляет карточку способности в чат
  win.addEventListener("contextmenu", (e) => {
    const cv = e.target.closest("canvas.circle-progress");
    if (cv) { e.preventDefault(); removeSegment(cv.dataset.attribute); return; }
    const card = e.target.closest(".ability-card");
    if (card) {
      e.preventDefault();
      const a = A.abilities.find((x) => x._id === card.dataset.itemId);
      if (a) abilityToChat(a, card);
    }
  });

  win.addEventListener("dblclick", (e) => {
    const card = e.target.closest(".ability-card");
    if (card && !e.target.closest("button")) {
      const a = A.abilities.find((x) => x._id === card.dataset.itemId);
      openItemSheet(a.name, a.info, card);
      return;
    }
    const slot = e.target.closest(".inventory-slot[data-item-id]");
    if (slot && !e.target.closest("button")) {
      const it = A.inventory.items[slot.dataset.itemId];
      openItemSheet(it.name, [["Тип", it.type], ["Количество", it.qty], ["Описание", it.desc]], slot);
    }
  });

  win.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches(".osx-res-value")) { commitResource(t.name.split(".")[1], toInt(t.value, A[t.name.split(".")[1]].value)); return; }
    if (t.matches(".osx-ring-value")) {
      // ручное значение сбрасывает сегменты в 0 (как в системе)
      const s = stat(t.name.split(".")[1]);
      const v = clamp(toInt(t.value, s.value), -9, 12);
      const dir = Math.sign(v - s.value);
      s.value = v;
      s.filled = 0;
      updateStatRow(s, dir);
      sfx(dir >= 0 ? "levelSmall" : "levelDown");
      return;
    }
    if (t.matches(".osx-name")) {
      A.name = t.value.trim() || A.name;
      renderNameplate();
      if (!calm()) { t.classList.remove("is-slam"); void t.offsetWidth; t.classList.add("is-slam"); }
      sfx("stamp");
      return;
    }
    if (t.matches(".osx-rank-input")) {
      const v = clamp(toInt(t.value, A.rank), 0, 99);
      const up = v > A.rank;
      A.rank = v;
      renderNameplate();
      const r = $(".osx-rank");
      r.classList.remove("is-stamped"); void r.offsetWidth; r.classList.add("is-stamped");
      sfx(up ? "levelSmall" : "stamp");
      return;
    }
    if (t.matches("[name='data.gacs']")) {
      const from = A.gacs, to = Math.max(0, toInt(t.value, from));
      A.gacs = to;
      t.value = to;
      const b = $("[data-bind=gacs]");
      if (calm() || from === to) { b.textContent = fmt(to); return; }
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / 520), ease = 1 - Math.pow(1 - k, 3);
        b.textContent = fmt(Math.round(from + (to - from) * ease));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      sfx(to > from ? "pick" : "drop");
      return;
    }
    if (t.matches("[data-bio]")) {
      A.bio[t.dataset.bio] = t.value;
      if (t.dataset.bio === "rankTitle") renderNameplate();
      return;
    }
    if (t.matches("[data-bio-text]")) { A[t.dataset.bioText] = t.value; return; }
    if (t.matches(".osx-set-sound")) { window.OrderSfx && window.OrderSfx.setEnabled(t.checked); if (t.checked) sfx("toggleOn"); return; }
    if (t.matches(".osx-set-motion")) { setMotion(t.checked); sfx(t.checked ? "toggleOn" : "toggleOff"); }
  });

  win.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches(".osx-set-volume")) { window.OrderSfx && window.OrderSfx.setVolume(+t.value); sfx("tickUp", +t.value); return; }
    if (t.matches(".ability-search-input")) { ui.query = t.value; applyAbilityFilter(); }
  });

  win.addEventListener("keydown", (e) => {
    const t = e.target;
    // Enter в однострочных полях фиксирует значение, а не отправляет форму
    if (e.key === "Enter" && (t.matches("input[type=text], input:not([type])") || t.matches(".osx-name"))) { e.preventDefault(); t.blur(); return; }
    if ((e.key === "Enter" || e.key === " ") && t.matches(".train-characteristic, .osx-tags .item-edit, .os-equipment-name")) { e.preventDefault(); t.click(); return; }
    // кольцо с клавиатуры: стрелки как ЛКМ/ПКМ
    if (t.matches("canvas.circle-progress")) {
      if (["ArrowUp", "ArrowRight", "+", "="].includes(e.key)) { e.preventDefault(); addSegment(t.dataset.attribute); }
      if (["ArrowDown", "ArrowLeft", "-"].includes(e.key)) { e.preventDefault(); removeSegment(t.dataset.attribute); }
      return;
    }
    // меню разделов листается стрелками, как в игре
    if (t.matches(".osx-menu .navbar") && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const items = $$(".osx-menu .navbar");
      const i = (items.indexOf(t) + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[i].focus();
      switchTab(items[i].dataset.tab);
    }
  });

  win.addEventListener("pointerover", (e) => {
    // курсорный «тик» JRPG-меню: только пункты меню и строки характеристик, остальное молчит
    const nav = e.target.closest(".osx-menu .navbar");
    if (nav && !nav.contains(e.relatedTarget)) { sfx("move"); return; }
    const row = e.target.closest(".osx-stat");
    if (row && !row.contains(e.relatedTarget)) sfx("hover");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dlgCurrent) { dlgCurrent.close(null); return; }
    if (!guide.hidden) { guideClose(); return; }
    if (ui.cropDraft) { endCrop(false); return; }
    if (!settings.hidden) { toggleSettings(false); return; }
  });
  document.addEventListener("keydown", (e) => {
    if (guide.hidden || dlgCurrent) return;
    if (e.key === "ArrowRight") guideShow(guideStep + 1);
    if (e.key === "ArrowLeft") guideShow(guideStep - 1);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!settings.hidden && !e.target.closest("#osx-settings, .osx-settings-toggle")) toggleSettings(false);
  });

  // Пункты меню: ступени и наклон, как у курсора
  $$(".osx-menu .navbar").forEach((a, i) => {
    a.style.setProperty("--i", i);
    a.style.setProperty("--rot", `${MENU_TILT[i]}deg`);
  });

  /* ================================================================== ДЕМО-ПУЛЬТ */
  $(".osx-dock-toggle").addEventListener("click", (e) => {
    const b = e.currentTarget, open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(open));
    sfx(open ? "open" : "close");
  });
  $(".osx-dock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-demo]");
    if (!b) return;
    if (win.classList.contains("is-closed")) openSheet();
    const d = b.dataset.demo;
    if (d === "dmg-small") commitResource("Health", A.Health.value - 8);
    else if (d === "dmg-big") commitResource("Health", A.Health.value - 38);
    else if (d === "heal") commitResource("Health", A.Health.value + 15);
    else if (d === "stress") commitResource("Stress", A.Stress.value + 15);
    else if (d === "mana") commitResource("ManaFatigue", A.ManaFatigue.value + 1);
    else if (d === "rerender") { renderAll(); postChat({ head: "Foundry", html: "<p>actor.update → sheet.render(): лист перерисован, вкладка, прокрутка и фильтры на месте, интро не повторилось.</p>", note: true }); }
    else if (d === "intro") playIntro();
    else if (d === "reset") {
      A = clone(INITIAL);
      ui.tags.clear(); ui.query = "";
      renderAll();
      sfx("swoosh");
    }
  });
  $(".osx-reopen").addEventListener("click", openSheet);

  /* ================================================================== СТАРТ */
  applySize();
  buildMotifs();
  const savedAccent = store.get("osx-accent", null);
  if (savedAccent) setAccent(savedAccent, true);
  if (store.get("osx-motion", "1") === "0") setMotion(false);
  if (window.OrderSfx) {
    $(".osx-set-sound").checked = window.OrderSfx.enabled;
    $(".osx-set-volume").value = window.OrderSfx.volume;
  }
  renderAll();
  renderHint(null);
  const startTab = store.get("lastActiveTab", "biography");
  switchTab(TABS[startTab] ? startTab : "biography", { instant: true });
  portrait.addEventListener("load", () => applyCrop(ui.cropDraft || A.crop));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveCursor(true));
  ui.introPlayed = true;
  requestAnimationFrame(playIntro);
  motionQuery.addEventListener("change", () => moveCursor(true));
})();
