/* =========================================================================
   ОПБСАН · Скин окон и чата «Арсенал II» (JRPG)
   Та же дизайн-система, что лист бойца X, HUD токена и листы предметов «Арсенал».
   Заменяет первый скин диалогов (OrderDialogSkin.js). Механику не трогает: вызовы
   new Dialog(...), приложения и ChatMessage.create(...) остаются как есть. Хуки только
   добавляют классы и декор к готовой разметке, а эффекты считают из разницы состояний
   между рендерами. Стили: styles/order-ui-x.css.
   ========================================================================= */

import OrderSfx from "./OrderSfx.js";
import { ensureOsiSprite, osiIcon, osiCalm, osiApplyScheme, auTokens, SIGIL_RINGS } from "../sheets/OrderItemSheetX.js";

const sfx = (name, arg) => { try { OrderSfx.play(name, arg); } catch (e) { /* звук не ломает окно */ } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const reflow = (el) => void el?.offsetWidth;
const later = (ms, fn) => setTimeout(fn, ms);

/* =========================================================================
   ОКНА
   ========================================================================= */

/* Диалоги со своим видом из чужих модулей можно исключить классом окна */
const SKIP_DIALOG_CLASSES = [];
/* Приложения системы, которые получают скин */
const APP_CLASSES = ["os-ccw", "os-tagmgr", "os-ability-tag-picker", "os-player-guide"];
const DIALOG_MIN_W = 540;

/* значок и подпись под кнопкой по ключу data-button */
const BUTTON_SKIN = {
  normal: { icon: "dice", sub: "1d20" },
  adv: { icon: "up", sub: "2d20 · лучший" },
  dis: { icon: "down", sub: "2d20 · худший" },
  roll: { icon: "dice" },
  reload: { icon: "reload" },
  save: { icon: "check" },
  ok: { icon: "check" },
  apply: { icon: "check" },
  show: { icon: "eye" },
  add: { icon: "plus" },
  no: { icon: "x" },
  cancel: { icon: "x" },
  worse: { icon: "down" },
  base: { icon: "check" },
  better: { icon: "up" }
};
const yesSkin = (v) => ({ icon: v.isDelete ? "trash" : v.isDanger ? "alert" : "check" });

const appState = new WeakMap();
const stateOf = (app) => { let s = appState.get(app); if (!s) { s = {}; appState.set(app, s); } return s; };

function appElement(app, html) {
  const el = app?.element?.[0] ?? app?.element;
  if (el instanceof HTMLElement) return el;
  const raw = html?.[0] ?? html;
  return raw instanceof HTMLElement ? raw.closest(".app") : null;
}

function splitTitle(title) {
  const m = title.match(/^(.+?)\s+[—–•-]\s+(.+)$/) || title.match(/^([^:]+):\s+(.+)$/);
  return m ? [m[1], m[2]] : [title, ""];
}

function dialogVariant(app, el) {
  const title = String(app?.data?.title ?? "");
  const buttons = app?.data?.buttons ?? {};
  const keys = Object.keys(buttons);
  const isDelete = /^(Удалить|Подтверждение удаления)/i.test(title);
  const isDanger = (isDelete || /превышена|^Сброс перезарядки/i.test(title)) && keys.includes("yes");
  const list = [];
  if (isDanger) list.push("osw--danger");
  if (/^Испытание духа/.test(title)) list.push("osw--cutin", "osw--spirit", "osw--choices");
  else if (/^Получен перк|^Повышение уровня/.test(title) || el.classList.contains("os-levelup-dialog")) list.push("osw--cutin", "osw--gold");
  if (el.querySelector(".dialog-content .os-ccw")) list.push("osw--ccw");
  if (!list.includes("osw--choices")) {
    const long = Object.values(buttons).some((b) => String(b?.label ?? "").length > 22);
    if (keys.length >= 3 && !keys.includes("normal")) list.push("osw--choices");
    else if (!keys.includes("normal")) list.push(long ? "osw--choices" : "osw--compact");
  }
  return { list, isDelete, isDanger, cut: list.includes("osw--spirit") ? "spirit" : list.includes("osw--gold") ? "gold" : "" };
}

/* живой фон: знак Ордена (три кольца) и бегущие полосы. Висит на окне, перерисовку переживает */
function ensureBg(el) {
  if (el.querySelector(":scope > .osu-bg")) return;
  const ring = (k) => `<svg class="osu-ring ${k}" viewBox="0 0 200 200" aria-hidden="true">${SIGIL_RINGS[k]}</svg>`;
  const bg = document.createElement("div");
  bg.className = "osu-bg";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = `<div class="osu-stripes"></div><div class="osu-stripes"></div><div class="osu-sigil">${ring("r1")}${ring("r2")}${ring("r3")}</div>`;
  el.querySelector(":scope > .window-content")?.before(bg);
}

/* полоса-разрез поверх экрана по прямоугольнику окна */
function slash(el, mode, tone = "") {
  if (osiCalm() || !el?.isConnected) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const s = document.createElement("div");
  s.className = `osu-fx osu-slash ${mode}${tone ? ` is-${tone}` : ""}`;
  const z = (Number.parseInt(getComputedStyle(el).zIndex, 10) || 100) + 1;
  Object.assign(s.style, { left: `${r.left - 60}px`, top: `${r.top - 20}px`, width: `${r.width + 120}px`, height: `${r.height + 40}px`, zIndex: String(z) });
  s.innerHTML = "<i></i><i></i>";
  s.setAttribute("aria-hidden", "true");
  document.body.append(s);
  later(720, () => s.remove());
}

/* разрез внутри окна при смене шага: слой на окне, поверх формы */
function wipe(el, dir) {
  if (osiCalm()) return;
  let w = el.querySelector(":scope > .osu-wipe");
  if (!w) {
    w = document.createElement("div");
    w.className = "osu-wipe";
    w.setAttribute("aria-hidden", "true");
    w.innerHTML = "<i></i><i></i>";
    el.append(w);
  }
  w.classList.remove("is-fwd", "is-back");
  reflow(w);
  w.classList.add(dir > 0 ? "is-fwd" : "is-back");
}

/* знак на фоне доворачивается в сторону шага */
function kickSigil(el, dir) {
  const s = el.querySelector(":scope > .osu-bg .osu-sigil");
  if (!s) return;
  const k = (Number(s.dataset.kick) || 0) + 40 * dir;
  s.dataset.kick = String(k);
  s.style.setProperty("--kick", `${k}deg`);
}

function stagger(nodes) { [...nodes].forEach((n, i) => n.style?.setProperty?.("--i", i)); }

function focusFirst(el) {
  const target = el.querySelector('.window-content input[type="text"]:not([readonly]):not([disabled]), .window-content input[type="number"]:not([readonly]):not([disabled])')
    || el.querySelector(".dialog-button.default:not([disabled]), .os-ccw-primary:not([disabled])")
    || el.querySelector(".window-content select, .window-content button:not([disabled])");
  try { target?.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}

/* ---------- диалог: плашка заголовка, кнопки, содержимое ---------- */
function decorateDialog(app, el, v) {
  const content = el.querySelector(".window-content");
  if (!content) return;
  const title = String(app?.data?.title ?? "");

  if (!v.list.includes("osw--ccw") && !content.querySelector(":scope > .osd-plate")) {
    const [big, sub] = splitTitle(title);
    const plate = document.createElement("div");
    plate.className = "osd-plate";
    plate.innerHTML = `<div class="osd-title">${esc(big)}</div>${sub ? `<div class="osd-sub">${esc(sub)}</div>` : ""}`;
    content.prepend(plate);
  }

  el.querySelectorAll(".dialog-buttons .dialog-button").forEach((btn, i) => {
    btn.style.setProperty("--i", i);
    if (btn.dataset.osdSkin) return;
    btn.dataset.osdSkin = "1";
    const key = btn.dataset.button;
    const skin = key === "yes" ? yesSkin(v) : (BUTTON_SKIN[key] ?? {});
    const label = btn.textContent.replace(/\s+/g, " ").trim();
    const fa = btn.querySelector("i[class*='fa-']");
    const icon = skin.icon ? osiIcon(skin.icon) : (fa ? fa.outerHTML : "");
    btn.innerHTML = `<span class="dialog-button-row">${icon}<span>${esc(label)}</span></span>${skin.sub ? `<small>${esc(skin.sub)}</small>` : ""}`;
  });

  /* испытание духа: блок исхода с картинкой из таблицы */
  el.querySelectorAll(".dialog-content div:has(> img[src*='icons/svg'])").forEach((box) => {
    box.classList.add("osu-outcome");
    const txt = box.querySelector(":scope > div");
    txt?.firstElementChild?.classList.add("osu-outcome-name");
    txt?.lastElementChild?.classList.add("osu-outcome-desc");
  });
  /* крестик «убрать цель» — значок вместо символа */
  el.querySelectorAll(".order-mt-remove").forEach((b) => { if (!b.querySelector("svg")) b.innerHTML = osiIcon("x"); });

  stagger(el.querySelectorAll(".dialog-content .form-group, .dialog-content form > p, .dialog-content > p, .dialog-content > hr, .dialog-content > div, .dialog-content form > div"));
}

/* Высота окна под содержимое.
   AppV1 меряет высоту ДО хука renderDialog — то есть до плашки заголовка и новых кнопок
   скина — и записывает её в style.height. Дальше setPosition её не трогает, поэтому окно
   открывалось обрезанным и его приходилось прокручивать колесом. Если окно само не просило
   фиксированную высоту, после оформления просим Foundry перемерить («auto»). */
function wantsAutoHeight(app) {
  const h = app?.options?.height;
  return h == null || h === "auto";
}
function fitDialogHeight(app, el) {
  if (!wantsAutoHeight(app) || app?._minimized || !el?.isConnected) return;
  try { app.setPosition({ height: "auto" }); } catch (e) { /* позиция не критична */ }
}

function placeDialog(app, el) {
  const s = stateOf(app);
  if (s.placed) return;
  s.placed = true;
  const w = Number(app.position?.width) || el.offsetWidth;
  if (w < DIALOG_MIN_W) {
    const pos = { width: DIALOG_MIN_W };
    if (wantsAutoHeight(app)) pos.height = "auto"; // уже окно → выше текст
    if (app.options?.left == null) pos.left = Math.max(12, Math.round((window.innerWidth - DIALOG_MIN_W) / 2));
    try { app.setPosition(pos); } catch (e) { /* позиция не критична */ }
  }
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    /* к следующему кадру догружаются шрифты и иконки — перемеряем ещё раз */
    fitDialogHeight(app, el);
    if (app.options?.top != null) return;
    try { app.setPosition({ top: Math.max(12, Math.round((window.innerHeight - el.offsetHeight) / 2.4)) }); } catch (e) { /* ignore */ }
  });
}

/* выбор: механика Foundry срабатывает сама, скин только отмечает кнопку (захват раньше обработчика окна) */
function bindChoice(app, el) {
  if (el.dataset.osuBound) return;
  el.dataset.osuBound = "1";
  const mark = (key) => {
    const s = stateOf(app);
    if (!key || s.chosen) return;
    const btn = el.querySelector(`.dialog-button[data-button="${CSS.escape(key)}"]`);
    if (!btn || btn.disabled) return;
    s.chosen = key;
    btn.classList.add("is-chosen");
    el.querySelector(".dialog-buttons")?.classList.add("has-choice");
    sfx(key === "cancel" || key === "no" ? "dialogOut" : "choose");
    if (el.classList.contains("osw--cutin")) shake(el.querySelector(":scope > .window-content"), 8);
  };
  el.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.(".dialog-button");
    if (btn && el.contains(btn)) mark(btn.dataset.button);
  }, true);
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.target?.tagName === "TEXTAREA") return;
    if (ev.target?.classList?.contains("dialog-button")) return;
    mark(app?.data?.default);
  }, true);
}

/* мелкие реакции полей: ± шаги, чекбоксы. Только звук и короткий отскок числа */
function bindFields(el) {
  if (el.dataset.osuFields) return;
  el.dataset.osuFields = "1";
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest?.(".requires-modifier button, .advantage-modifier button, .order-mass-roll-dice__button");
    if (!b) return;
    const box = b.closest(".requires-modifier, .advantage-modifier, .order-mass-roll-dice");
    setTimeout(() => {
      const out = box?.querySelector("input, .order-mass-roll-dice-count");
      if (!out || osiCalm()) return;
      out.classList.remove("is-bump"); reflow(out); out.classList.add("is-bump");
    }, 0);
    sfx("segment", /plus|\+/.test(b.className + b.textContent + (b.dataset.action ?? "")) ? 0.7 : 0.2);
  });
  el.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t?.type === "checkbox") sfx("toggleLow", t.checked ? 1 : -1);
  });
}

/* ---------- приложения: мастера, менеджер тегов, выбор тегов, гайд ---------- */

/* «Шаг 2 из 4 — Маг. прокачка» или «Шаг 2 / 7» */
function readStep(el) {
  const ccw = el.querySelector(".os-ccw-progress");
  if (ccw) {
    const m = ccw.textContent.trim().match(/Шаг\s+(\d+)\s+из\s+(\d+)\s*[—–-]?\s*(.*)$/i);
    if (m) return { node: ccw, n: +m[1], total: +m[2], name: m[3].trim(), kind: "ccw" };
  }
  const guide = el.querySelector(".os-guide-kicker");
  if (guide) {
    const m = guide.textContent.trim().match(/(\d+)\s*\/\s*(\d+)/);
    if (m) return { node: guide, n: +m[1], total: +m[2], name: "", kind: "guide" };
  }
  return null;
}

function decorateSteps(el, step) {
  if (!step || step.kind !== "ccw") return;
  const head = el.querySelector(".os-ccw-header");
  if (!head || head.querySelector(".osu-steps")) return;
  step.node.classList.add("osu-sr");
  const segs = Array.from({ length: step.total }, (_, i) => `<i class="${i + 1 < step.n ? "is-done" : i + 1 === step.n ? "is-now" : ""}" style="--i:${i}"></i>`).join("");
  step.node.insertAdjacentHTML("afterend",
    `<div class="osu-steps" aria-hidden="true">${segs}<b>${String(step.n).padStart(2, "0")}<span> / ${String(step.total).padStart(2, "0")}</span></b></div>${step.name ? `<div class="osu-stepname" aria-hidden="true">${esc(step.name)}</div>` : ""}`);
}

function decorateGuide(el) {
  const dots = [...el.querySelectorAll(".os-guide-dot")];
  const a = dots.findIndex((d) => d.classList.contains("active"));
  dots.forEach((d, i) => d.classList.toggle("is-done", a >= 0 && i < a));
  el.querySelectorAll(".os-guide-footer [data-action='prev'] i, .os-guide-footer [data-action='next'] i").forEach((i) => {
    i.outerHTML = osiIcon(i.classList.contains("fa-arrow-left") ? "arrowL" : "arrowR");
  });
}

/* шаг изменился: разрез, тело въезжает со стороны направления, сегмент вспыхивает */
function onStepChange(el, step, dir) {
  wipe(el, dir);
  kickSigil(el, dir);
  sfx(dir > 0 ? "wipeLow" : "pageBack");
  if (osiCalm()) return;
  const body = el.querySelector(".os-ccw-body, .os-guide-body");
  if (body) {
    stagger(body.children);
    body.classList.add(dir > 0 ? "osu-in-fwd" : "osu-in-back", "is-stagger");
  }
  el.querySelector(".osu-steps i.is-now")?.classList.add("is-pop");
  el.querySelector(".osu-stepname, .os-guide-focus-label")?.classList.add("is-swap");
  el.querySelector(".os-guide-title")?.classList.add("osu-title-swap");
}

/* менеджер тегов: новые строки подсвечиваются; выбор тегов: щелчок плашки */
function diffRows(app, el) {
  const s = stateOf(app);
  const rows = [...el.querySelectorAll(".tagmgr-row[data-row-id]")];
  if (rows.length) {
    const ids = new Set(rows.map((r) => r.dataset.rowId));
    if (s.rows) {
      const added = rows.filter((r) => !s.rows.has(r.dataset.rowId));
      added.forEach((r) => r.classList.add("is-new"));
      if (added.length) { sfx("pillAdd"); added[0].scrollIntoView?.({ block: "nearest" }); }
      else if (ids.size < s.rows.size) sfx("pillRemove");
    }
    s.rows = ids;
  }
  const picks = [...el.querySelectorAll(".ability-tag-picker-row")];
  if (picks.length) {
    const sel = new Set(picks.filter((r) => r.classList.contains("is-selected")).map((r) => r.querySelector("[data-tag-key]")?.dataset.tagKey));
    if (s.sel) {
      const on = [...sel].filter((k) => !s.sel.has(k));
      const off = [...s.sel].filter((k) => !sel.has(k));
      on.forEach((k) => el.querySelector(`[data-tag-key="${CSS.escape(k)}"]`)?.closest(".ability-tag-picker-row")?.classList.add("is-flash"));
      if (on.length) sfx("pillAdd"); else if (off.length) sfx("pillRemove");
      if (on.length || off.length) el.querySelector(".ability-tag-picker-header p strong")?.classList.add("is-bump");
    }
    s.sel = sel;
  }
}

function enter(app, el, tone) {
  el.classList.add("is-enter");
  if (tone === "spirit") sfx("cutinDrone");
  else if (tone === "gold") sfx("levelUpLow");
  else sfx("slash");
  if (!osiCalm()) requestAnimationFrame(() => slash(el, "is-run", el.classList.contains("osw--danger") ? "danger" : tone === "gold" ? "gold" : ""));
  if (tone && !osiCalm()) cutIn(el, tone);
  later(osiCalm() ? 300 : 1300, () => el.classList.remove("is-enter"));
  focusFirst(el);
}

/* праздничное окно: на окне на миг встаёт широкая плашка-катин */
function cutIn(el, tone) {
  const title = el.querySelector(".osd-title")?.textContent ?? "";
  const c = document.createElement("div");
  c.className = `osu-cut is-${tone}`;
  c.setAttribute("aria-hidden", "true");
  c.innerHTML = `<i></i><b>${esc(title)}</b>`;
  el.append(c);
  later(1150, () => c.remove());
}

function onRenderDialog(app, html) {
  const el = appElement(app, html);
  if (!el || SKIP_DIALOG_CLASSES.some((c) => el.classList.contains(c))) return;
  ensureOsiSprite();
  const first = !el.classList.contains("osw");
  el.classList.add("osw", "osw--dialog");
  const v = dialogVariant(app, el);
  el.classList.remove("osw--danger", "osw--compact", "osw--choices", "osw--cutin", "osw--gold", "osw--spirit", "osw--ccw");
  el.classList.add(...v.list);
  osiApplyScheme(el);
  ensureBg(el);
  decorateDialog(app, el, v);
  bindChoice(app, el);
  bindFields(el);
  fitDialogHeight(app, el);
  if (!first) return;
  placeDialog(app, el);
  enter(app, el, v.cut);
}

function onRenderApp(app, html) {
  const el = appElement(app, html);
  if (!el || el.classList.contains("dialog")) return;
  if (!APP_CLASSES.some((c) => el.classList.contains(c))) return;
  ensureOsiSprite();
  const first = !el.classList.contains("osw");
  el.classList.add("osw", "osw--app");
  osiApplyScheme(el);
  ensureBg(el);
  bindFields(el);

  const step = readStep(el);
  decorateSteps(el, step);
  decorateGuide(el);
  stagger(el.querySelectorAll(".os-ccw-body > *, .tagmgr-row, .ability-tag-picker-row, .os-guide-body > *"));
  el.querySelectorAll(".os-ccw-footer button, .os-guide-footer button, .tagmgr-footer button").forEach((b, i) => b.style.setProperty("--i", i));

  const s = stateOf(app);
  if (step && s.step && step.n !== s.step) onStepChange(el, step, step.n > s.step ? 1 : -1);
  if (step) s.step = step.n;
  diffRows(app, el);
  if (first) enter(app, el, "");
}

function onClose(app, html) {
  const el = appElement(app, html);
  if (!el || !el.classList.contains("osw")) return;
  const s = stateOf(app);
  if (!s.chosen) sfx("dialogOut");
  slash(el, "is-out", el.classList.contains("osw--danger") ? "danger" : "");
  /* jQuery slideUp сминает окно по высоте: высота фиксируется, вместо смятия — уход вбок */
  el.style.setProperty("--osu-h", `${el.offsetHeight}px`);
  el.classList.remove("is-enter");
  el.classList.add("is-leave");
  appState.delete(app);
}

/* =========================================================================
   ЧАТ
   ========================================================================= */

const FRESH_MS = 20000;          // моложе — считается пришедшим «сейчас»: анимация и звук
const seen = new Set();          // сообщения, уже показанные этому клиенту
const snaps = new Map();         // id → снимок состояния: из разницы считаются эффекты
const openDesc = new Set();      // развёрнутые описания переживают перерисовку
const alarms = new Map();        // id → таймер напоминания «тебя атакуют»

const DEF_ICON = { dodge: "dodge", block: "shield", "block-stamina": "shieldBolt", preempt: "strike", spell: "wand", skill: "fist" };
const DMG_ICON = { armor: "vest", true: "pierce", pierce: "pierce", half: "half", effects: "bolt", crit: "star" };
const KIND_BY_CLASS = { "order-melee": "Ближний бой", "order-ranged": "Дальний бой", "order-spell": "Заклинание", "order-skill": "Навык" };

/* «мой персонаж»: игрок владеет токеном; мастер — токен без игрока-владельца */
function tokenMine(tokenId) {
  if (!tokenId) return false;
  const t = globalThis.canvas?.tokens?.get?.(tokenId);
  if (!t) return false;
  if (globalThis.game?.user?.isGM) return !t.actor?.hasPlayerOwner;
  return !!(t.isOwner ?? t.actor?.isOwner);
}
function speakerMine(message) {
  if (message?.speaker?.token && tokenMine(message.speaker.token)) return true;
  const a = globalThis.game?.actors?.get?.(message?.speaker?.actor);
  if (!a) return false;
  return globalThis.game?.user?.isGM ? !a.hasPlayerOwner : !!a.isOwner;
}

const labelOf = (p) => {
  const first = [...p.childNodes].find((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
  if (!first || first.nodeType !== 1 || !/^(STRONG|B)$/.test(first.tagName)) return null;
  const t = first.textContent.trim();
  return t.endsWith(":") ? { el: first, text: t.slice(0, -1).trim() } : null;
};
const moveRest = (p, after, cls) => {
  const v = document.createElement("span");
  v.className = cls;
  while (after.nextSibling) v.append(after.nextSibling);
  p.append(v);
  return v;
};
/* первое число в узле оборачивается в <b class="osc-num">, чтобы его можно было «докрутить» */
function wrapNumber(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const m = t.textContent.match(/-?\d+/);
    if (!m) continue;
    const after = t.splitText(m.index);
    after.splitText(m[0].length);
    const b = document.createElement("b");
    b.className = "osc-num";
    b.textContent = m[0];
    after.replaceWith(b);
    return b;
  }
  return null;
}

function decorateChat(message, li, content) {
  const f = { crit: false, autoFail: false, critFail: false, verdict: null, critAvail: false, damage: null, spirit: false, total: null, attack: null };
  const flags = message?.flags?.Order ?? {};
  const attack = flags.attack ?? null;
  f.attack = attack;

  /* шапка карточки: картинка в рамке, имя, плашка типа */
  const flavorText = content.querySelector(".order-roll-flavor")?.textContent ?? "";
  const card = content.querySelector(".chat-attack-message, .chat-item-message");
  const kind = flavorText.split(" | ")[0]?.trim() || Object.entries(KIND_BY_CLASS).find(([c]) => card?.classList.contains(c))?.[1] || "";
  content.querySelectorAll(".attack-header, .item-header").forEach((head) => {
    const h3 = head.querySelector("h3");
    if (!h3 || head.querySelector(".osc-headtext")) return;
    const wrap = document.createElement("div");
    wrap.className = "osc-headtext";
    h3.before(wrap);
    wrap.append(h3);
    if (kind) wrap.insertAdjacentHTML("beforeend", `<span class="osc-kind">${esc(kind)}</span>`);
  });

  /* строки «Подпись: значение» */
  content.querySelectorAll("p").forEach((p) => {
    if (p.closest(".defense-buttons, .order-damage-panel")) return;
    const lab = labelOf(p);
    if (!lab) return;
    const t = lab.text;
    if (t === "Цель") {
      p.classList.add("osc-target");
      lab.el.classList.add("osu-sr");
      p.insertAdjacentHTML("afterbegin", osiIcon("target"));
      return;
    }
    if (t === "Описание") {
      p.classList.add("osc-desc");
      moveRest(p, lab.el, "osc-desc-body");
      p.insertAdjacentHTML("beforeend", `<button type="button" class="osc-more" aria-expanded="false"><span>Подробнее</span>${osiIcon("down")}</button>`);
      if (openDesc.has(message.id)) { p.classList.add("is-open", "is-long"); p.querySelector(".osc-more").setAttribute("aria-expanded", "true"); p.querySelector(".osc-more span").textContent = "Свернуть"; }
      return;
    }
    if (t === "Итог атаки") {
      const s = p.textContent;
      f.verdict = /ПОПАДАНИЕ/.test(s) ? "hit" : /ПРОМАХ/.test(s) ? "miss" : null;
      f.critAvail = /ДОСТУПЕН КРИТ/.test(s);
      if (f.verdict) p.classList.add("osu-sr");
      return;
    }
    if (t === "Авто-провал") { f.autoFail = true; p.classList.add("osc-kv", "is-wide", "is-text", "osc-warnline"); moveRest(p, lab.el, "osc-v"); return; }
    if (p.classList.contains("order-crit-fail")) { f.critFail = true; p.classList.add("osc-kv", "is-wide", "is-text", "osc-warnline"); moveRest(p, lab.el, "osc-v"); return; }
    const rest = p.textContent.slice(lab.el.textContent.length).trim();
    if (/^(Результат (атаки|броска)|Бросок атаки)$/.test(t) && /^-?\d/.test(rest)) {
      p.classList.add("osc-total");
      const v = moveRest(p, lab.el, "osc-v");
      /* «[КРИТ. ПРОВАЛ]» проверяем раньше «КРИТ», иначе провал засчитался бы как крит */
      if (v.querySelector(".order-crit-fail-tag") || /КРИТ\. ПРОВАЛ/.test(rest)) f.critFail = true;
      else if (/КРИТ/.test(rest)) f.crit = true;
      if (/Провал|авто-промах/i.test(rest)) f.autoFail = true;
      const num = wrapNumber(v);
      if (num) f.total = { el: num, value: Number(num.textContent) };
      return;
    }
    p.classList.add("osc-kv");
    const v = moveRest(p, lab.el, "osc-v");
    if (v.textContent.trim().length > 24) p.classList.add("is-wide", "is-text");
  });

  /* соседние плитки собираются в сетку */
  [...content.querySelectorAll("p.osc-kv")].forEach((p) => {
    if (p.parentElement.classList.contains("osc-stats")) return;
    const group = [p];
    let n = p.nextElementSibling;
    while (n && n.matches("p.osc-kv")) { group.push(n); n = n.nextElementSibling; }
    const g = document.createElement("div");
    g.className = "osc-stats";
    p.before(g);
    g.append(...group);
  });

  /* строка режима броска → фишки */
  content.querySelectorAll(".order-roll-flavor").forEach((fl) => {
    const parts = fl.textContent.split(" | ").map((s) => s.trim()).filter(Boolean);
    fl.textContent = "";
    parts.forEach((s) => {
      const c = document.createElement("span");
      c.className = "osc-chip";
      if (/ПРОВАЛ/.test(s)) { c.classList.add("is-critfail"); f.critFail = true; }
      else if (/КРИТ/.test(s)) { c.classList.add("is-crit"); f.crit = true; }
      if (/^Преимущество/.test(s)) c.classList.add("is-adv");
      if (/^Помеха/.test(s)) c.classList.add("is-dis");
      c.textContent = s;
      fl.append(c);
    });
  });
  if (card && content.querySelector(".dice-total.critical")) f.crit = true;
  if (content.querySelector(".order-crit-fail-tag")) f.critFail = true;
  if (attack?.autoFail) f.autoFail = true;

  /* значки на кнопках защиты и урона: кнопка остаётся той же, обработчик системы не теряется */
  content.querySelectorAll("button.order-defense[data-defense]").forEach((b) => {
    if (b.querySelector("svg.ic")) return;
    b.insertAdjacentHTML("afterbegin", osiIcon(DEF_ICON[b.dataset.defense] ?? "shield"));
    if (b.classList.contains("order-aoe-btn")) b.classList.add("osc-iconized");
  });
  content.querySelectorAll("button.order-apply-damage[data-mode]").forEach((b) => {
    if (b.querySelector("svg.ic")) return;
    b.insertAdjacentHTML("afterbegin", osiIcon(b.dataset.crit === "1" ? "star" : (DMG_ICON[b.dataset.mode] ?? "vest")));
    if (b.classList.contains("order-aoe-btn")) b.classList.add("osc-iconized");
  });
  content.querySelectorAll(".order-aoe-damage-applied i").forEach((i) => { i.outerHTML = osiIcon("check"); });

  /* урон применён: большое число и штамп */
  const dm = content.textContent.match(/получает урон:\s*(\d+)/);
  if (dm && !content.querySelector(".order-damage-panel")) {
    const value = Number(dm[1]);
    const who = content.querySelector("p strong")?.textContent ?? "";
    const tags = [/половина/.test(content.textContent) ? "половина" : "", /КРИТ x2/.test(content.textContent) ? "крит ×2" : "", (content.textContent.match(/броня[^).]*/) ?? [""])[0]].filter(Boolean).join(" · ");
    content.insertAdjacentHTML("afterbegin", `<div class="osc-damage" aria-hidden="true"><b>−${value}</b><span><em>${esc(who)}</em>${tags ? esc(tags) : "получает урон"}</span></div>`);
    li.insertAdjacentHTML("beforeend", `<div class="osc-stamp is-dmg" aria-hidden="true">Урон применён</div>`);
    li.classList.add("osc--damage");
    f.damage = value;
  }

  /* вердикт защиты */
  if (f.verdict) {
    const name = content.querySelector("p strong")?.textContent ?? "";
    content.insertAdjacentHTML("beforeend", `<div class="osc-verdict is-${f.verdict}${f.critAvail ? " is-crit" : ""}" aria-hidden="true"><div class="osc-verdict-text">${f.verdict === "hit" ? "Попадание" : "Промах"}</div><small>${esc(name)}<br>${f.verdict === "hit" ? "защита пробита" : "защита выдержала"}</small></div>`);
    li.classList.add(`osc--${f.verdict}`);
  }

  /* испытание духа: катин на карточке броска */
  const flavor = String(message?.flavor ?? "");
  if (/^Испытание духа/.test(flavor)) {
    f.spirit = true;
    const total = (flavor.match(/итог[^:]*:\s*(\d+)/) ?? [])[1];
    const sub = flavor.replace(/^Испытание духа:\s*/, "").replace(/\s*→.*$/, "");
    content.insertAdjacentHTML("afterbegin", `<div class="osc-cutin" aria-hidden="true"><div class="osc-cutin-title">Испытание духа</div><div class="osc-cutin-sub">${esc(sub)}${total ? ` · итог ${esc(total)}` : ""}</div></div>`);
    li.classList.add("osc--spirit");
  }

  if (f.crit) { li.classList.add("osc--crit"); li.insertAdjacentHTML("beforeend", `<div class="osc-stamp" aria-hidden="true">Крит</div>`); }
  if (f.autoFail && card) { li.classList.add("osc--fail"); li.insertAdjacentHTML("beforeend", `<div class="osc-stamp is-fail" aria-hidden="true">Провал</div>`); }
  if (f.critFail && !f.crit) { li.classList.add("osc--critfail"); li.insertAdjacentHTML("beforeend", `<div class="osc-stamp is-fail" aria-hidden="true">Крит. провал</div>`); }

  /* разрешённая атака: кнопки защиты гаснут (обработчик всё равно уже ничего не делает), внизу итог */
  if (attack && !content.querySelector(".order-aoe-row") && attack.state === "resolved" && !attack.autoFail) {
    li.classList.add("is-resolved");
    const def = { dodge: "уворот", block: "блок", "block-stamina": "блок (stamina)", spell: "заклинание", skill: "навык", preempt: "удар на опережение" }[attack.defenseType] ?? attack.defenseType ?? "";
    const hit = attack.hit === true ? "попадание" : attack.hit === false ? "промах" : "";
    content.insertAdjacentHTML("beforeend", `<div class="osc-resolved"><span>Защита: ${esc(def)}</span><b class="is-${attack.hit ? "hit" : "miss"}">${esc(hit)}</b></div>`);
  }

  /* AoE: мои строки отмечены */
  content.querySelectorAll(".order-aoe-row[data-token-id]").forEach((row) => row.classList.toggle("is-me", tokenMine(row.dataset.tokenId)));

  stagger(content.children);
  return f;
}

/* состояние для разницы между рендерами одного сообщения */
function snapshot(message, content, f) {
  const rows = {};
  content.querySelectorAll(".order-aoe-row[data-token-id]").forEach((r) => {
    const res = r.querySelector(".order-aoe-result");
    rows[r.dataset.tokenId] = res?.classList.contains("order-aoe-result--hit") ? "hit" : res?.classList.contains("order-aoe-result--miss") ? "miss" : "pending";
  });
  return { state: f.attack?.state ?? null, hit: f.attack?.hit, rows };
}

function waitingForMe(message, content, f) {
  if (f.autoFail) return false;
  const a = f.attack;
  const rows = [...content.querySelectorAll(".order-aoe-row.is-me")];
  if (rows.length) return rows.some((r) => r.querySelector(".order-aoe-result--pending"));
  if (!a || !/^awaiting/.test(String(a.state))) return false;
  /* после успешного «Удара на опережение» защищается исходный атакующий */
  return tokenMine(a.state === "awaitingPreemptDefense" ? a.attackerTokenId : a.defenderTokenId);
}

/* ---------- сочность: тряска, вспышка, искры, докрутка числа ---------- */
/* Тряска идёт через Web Animations и отдельные свойства translate/rotate. Раньше это был
   CSS-класс с тем же свойством animation, что и у появления карточки: когда класс снимали,
   браузер запускал появление заново, и карточка мигала. Затухание детерминированное. */
const SHAKE_KEYS = [[0, 0, 0, 0], [0.1, -1, 2, -0.4], [0.22, 0.8, -2, 0.3], [0.36, -0.55, 1, 0], [0.52, 0.35, -1, 0], [0.7, -0.18, 0, 0], [1, 0, 0, 0]];
const SHAKE_EASE = "cubic-bezier(0.19, 1, 0.22, 1)";
function shake(el, amp) {
  if (osiCalm() || !el?.isConnected || typeof el.animate !== "function") return;
  el.__osuShake?.cancel();
  el.__osuShake = el.animate(
    SHAKE_KEYS.map(([offset, x, y, r]) => ({ offset, easing: SHAKE_EASE, translate: `${(x * amp).toFixed(2)}px ${y}px`, rotate: `${r}deg` })),
    { duration: 420 }
  );
}
function flash(li, blood) {
  if (!li?.isConnected) return;
  const d = document.createElement("div");
  d.className = `osc-flash${blood ? " is-blood" : ""}`;
  li.append(d);
  later(280, () => d.remove());
}
function sparks(li) {
  if (osiCalm() || !li?.isConnected) return;
  const st = li.querySelector(".osc-stamp:not(.is-dmg)");
  if (!st) return;
  const x = st.offsetLeft + st.offsetWidth / 2, y = st.offsetTop + st.offsetHeight / 2;
  for (let i = 0; i < 9; i++) {
    const s = document.createElement("i");
    s.className = "osc-spark";
    s.style.left = `${x}px`; s.style.top = `${y - 16}px`;
    s.style.setProperty("--a", `${i * 40 + 8}deg`);
    s.style.setProperty("--d", `${34 + (i % 3) * 12}px`);
    li.append(s);
    later(560, () => s.remove());
  }
}
function countUp(el, to, ms = 620) {
  if (!el || osiCalm()) return;
  const t0 = performance.now();
  el.classList.add("is-count");
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = String(Math.round(to * e));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  el.textContent = "0";
  requestAnimationFrame(step);
  /* кадры могут стоять (вкладка в фоне): итог всё равно встаёт на место */
  later(ms + 120, () => { el.textContent = String(to); });
}

function clearAlarm(id) { const t = alarms.get(id); if (t) { clearTimeout(t); alarms.delete(id); } }
/* «пока не выбрана реакция»: тревога сразу и два напоминания, пока карточка ждёт */
function armAlarm(message, li, n = 0) {
  clearAlarm(message.id);
  if (n > 2) return;
  if (n > 0) {
    const live = document.querySelector(`.chat-message.osc[data-message-id="${CSS.escape(message.id)}"].is-waiting`);
    if (!live) return;
    sfx("attackAlarm");
    shake(live, 4);
  }
  alarms.set(message.id, later(9000, () => armAlarm(message, li, n + 1)));
}

function onRenderChat(message, html) {
  const li = html instanceof HTMLElement ? html : html?.[0];
  if (!li || li.style.display === "none") return;
  const content = li.querySelector(".message-content");
  if (!content) return;
  ensureOsiSprite();
  li.classList.remove("os-chat", "os-chat--player", "os-chat--gm");
  li.classList.add("osc");
  osiApplyScheme(li);
  auTokens(li, message?.author?.color);
  if (message?.whisper?.length) {
    li.classList.add("osc--whisper");
    li.querySelector(".whisper-to")?.insertAdjacentHTML("afterbegin", osiIcon("whisper"));
  }
  if (li.classList.contains("emote") || message?.style === 3) li.classList.add("osc--emote");
  /* длинное имя режется многоточием — полное в подсказке */
  const sender = li.querySelector(".message-sender");
  if (sender && !sender.title) sender.title = sender.textContent.trim();

  const f = decorateChat(message, li, content);
  const id = message.id;
  const fresh = !seen.has(id) && Date.now() - Number(message.timestamp ?? 0) < FRESH_MS;
  seen.add(id);
  const prev = snaps.get(id);
  const snap = snapshot(message, content, f);
  snaps.set(id, snap);

  /* тебя атакуют */
  const forMe = waitingForMe(message, content, f);
  if (forMe) {
    li.classList.add("osc--target-me", "is-waiting");
    li.querySelector(".message-header")?.insertAdjacentHTML("afterend", `<div class="osc-alarm" role="alert">${osiIcon("alert")}<span>Тебя атакуют · выбери защиту</span></div>`);
  }
  const wasWaiting = prev ? alarms.has(id) : false;
  if (!forMe) clearAlarm(id);

  /* описание: «Подробнее» только если текст правда длиннее трёх строк */
  requestAnimationFrame(() => {
    li.querySelectorAll(".osc-desc:not(.is-open)").forEach((p) => {
      const b = p.querySelector(".osc-desc-body");
      p.classList.toggle("is-long", !!b && b.scrollHeight > b.clientHeight + 2);
    });
  });

  if (fresh) {
    li.classList.add("is-new");
    later(1700, () => li.classList.remove("is-new"));
    if (f.total) countUp(f.total.el, f.total.value);
    let loud = false;
    if (forMe) { loud = true; sfx("attackAlarm"); armAlarm(message, li); }
    if (f.crit) {
      loud = true;
      later(osiCalm() ? 0 : 380, () => { sfx("critSlam"); flash(li); sparks(li); shake(li, 9); });
    } else if ((f.autoFail && content.querySelector(".chat-attack-message")) || f.critFail) {
      loud = true;
      later(osiCalm() ? 0 : 380, () => { sfx("failThud"); shake(li, 4); });
    }
    if (f.spirit) { loud = true; sfx("cutinDrone"); later(osiCalm() ? 0 : 380, () => shake(li, 6)); }
    if (f.verdict) {
      const mine = speakerMine(message);
      if (mine) { loud = true; sfx(f.verdict === "hit" ? "verdictHit" : "verdictMiss"); }
      if (f.verdict === "hit") later(osiCalm() ? 0 : 300, () => shake(li, 4));
    }
    if (f.damage != null) {
      const tier = f.damage <= 5 ? 1 : f.damage <= 12 ? 2 : 3;
      later(osiCalm() ? 0 : 220, () => { shake(li, [0, 3, 6, 10][tier]); if (tier === 3) flash(li, true); });
      if (speakerMine(message)) { loud = true; sfx("hurtLow", tier); }
    }
    if (!loud && message.isAuthor) sfx("cardIn");
  } else if (prev) {
    /* то же сообщение перерисовано: эффекты из разницы */
    const attackerMine = tokenMine(f.attack?.attackerTokenId);
    for (const [tid, now] of Object.entries(snap.rows)) {
      const was = prev.rows?.[tid];
      if (was === "pending" && now !== "pending") {
        const row = content.querySelector(`.order-aoe-row[data-token-id="${CSS.escape(tid)}"]`);
        row?.querySelector(".order-aoe-result")?.classList.add("is-pop");
        if (attackerMine || tokenMine(tid)) sfx(now === "hit" ? "verdictHit" : "verdictMiss");
      }
    }
    if (prev.state && /^awaiting/.test(prev.state) && snap.state === "resolved" && !Object.keys(snap.rows).length) {
      li.querySelector(".osc-resolved")?.classList.add("is-pop");
      if (attackerMine) sfx(snap.hit ? "verdictHit" : "verdictMiss");
    }
    if (forMe && !wasWaiting) { sfx("attackAlarm"); armAlarm(message, li); }
  }
}

/* «Подробнее» и отклик нажатия на кнопках карточек: делегирование на документ, один раз */
function bindChatDelegates() {
  document.addEventListener("click", (ev) => {
    const more = ev.target.closest?.(".chat-message.osc .osc-more");
    if (!more) return;
    ev.preventDefault();
    const p = more.closest(".osc-desc");
    const id = more.closest(".chat-message")?.dataset.messageId;
    const open = !p.classList.contains("is-open");
    p.classList.toggle("is-open", open);
    more.setAttribute("aria-expanded", String(open));
    more.querySelector("span").textContent = open ? "Свернуть" : "Подробнее";
    if (open) openDesc.add(id); else openDesc.delete(id);
  });
  document.addEventListener("pointerdown", (ev) => {
    const b = ev.target.closest?.(".chat-message.osc .message-content button:not(.osc-more):not(:disabled)");
    if (!b) return;
    if (!osiCalm()) { b.classList.remove("osc-pressed"); reflow(b); b.classList.add("osc-pressed"); }
    if (b.matches(".order-defense, .order-apply-damage")) sfx("choose");
  });
}

export function registerOrderUiSkin() {
  if (globalThis.__orderUiSkin) return;
  globalThis.__orderUiSkin = true;
  const guard = (fn, label) => (...a) => { try { fn(...a); } catch (e) { console.warn(`[Order] Скин: ${label}`, e); } };
  Hooks.on("renderDialog", guard(onRenderDialog, "диалог"));
  Hooks.on("closeDialog", guard(onClose, "закрытие"));
  Hooks.on("renderApplication", guard(onRenderApp, "окно"));
  Hooks.on("closeApplication", guard((app, html) => { if (!(appElement(app, html)?.classList.contains("dialog"))) onClose(app, html); }, "закрытие"));
  Hooks.on("renderChatMessageHTML", guard(onRenderChat, "чат"));
  Hooks.on("deleteChatMessage", guard((m) => { clearAlarm(m.id); snaps.delete(m.id); }, "чат"));
  /* поле ввода чата (prose-mirror#chat-message) в той же гамме */
  const markInput = guard(() => document.getElementById("chat-message")?.classList.add("osu-input"), "поле чата");
  Hooks.on("renderChatLog", markInput);
  Hooks.once("ready", markInput);
  bindChatDelegates();
}

export default registerOrderUiSkin;
