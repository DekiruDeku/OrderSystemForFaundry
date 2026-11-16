/* =========================================================================
   ОПБСАН · Скин окон-диалогов «Арсенал» (JRPG)
   Та же дизайн-система, что лист предмета «Арсенал», лист бойца X и HUD токена.

   Ничего в вызовах new Dialog(...) не меняется. Хук renderDialog по заголовку
   выбирает окна первой партии и только оформляет готовую разметку:
   - класс окна .osd (+ вариант: опасное удаление, компактное без броска);
   - плашка заголовка «крупное слово + подпись» над содержимым;
   - значки и подписи внутри кнопок по ключу data-button (сами <button> не пересоздаются,
     поэтому обработчики Foundry и хуки системы на кнопках продолжают работать);
   - вход «разрез-катин», звук выбора и ухода, фокус на первое поле ввода.
   ========================================================================= */

import OrderSfx from "./OrderSfx.js";
import { ensureOsiSprite, osiIcon, osiCalm, osiApplyScheme } from "../module/sheets/OrderItemSheetX.js";

/* Окна первой партии. Остальные диалоги системы пока выглядят как раньше. */
const TITLE_RULES = [
  /^Бросок атаки\s+[—–-]\s+/,
  /^Применить (навык|заклинание):/,
  /^Формула (броска|воздействия):/,
  /^Перезарядить:/,
  /^Удалить/,
  /^Добавление новых параметров$/,
  /^Порог условия применения$/,
  /^Скрытые поля$/,
  /^Новое поле$/
];
/* у этих окон своё оформление в Order.css */
const SKIP_CLASSES = ["order-mt-dialog", "os-levelup-dialog"];

/* Подписи и значки по ключу кнопки */
const BUTTON_SKIN = {
  normal: { icon: "dice", sub: "1d20" },
  adv: { icon: "up", sub: "2d20 · лучший" },
  dis: { icon: "down", sub: "2d20 · худший" },
  reload: { icon: "reload" },
  save: { icon: "check" },
  ok: { icon: "check" },
  show: { icon: "eye" },
  add: { icon: "plus" },
  yes: { icon: "trash" },
  no: { icon: "x" },
  cancel: { icon: "x" }
};

const DIALOG_MIN_W = 520;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sfx = (name) => { try { OrderSfx.play(name); } catch (e) { /* звук не ломает окно */ } };

/* «Бросок атаки — Тесак», «Применить навык: Рассекающий удар» → крупное слово и плашка */
function splitTitle(title) {
  const m = title.match(/^(.+?)\s+[—–-]\s+(.+)$/) || title.match(/^([^:]+):\s+(.+)$/);
  return m ? [m[1], m[2]] : [title, ""];
}

function appElement(app, html) {
  const el = app?.element?.[0] ?? app?.element;
  if (el instanceof HTMLElement) return el;
  const raw = html?.[0] ?? html;
  return raw instanceof HTMLElement ? raw.closest(".app") : null;
}

function wants(app, el) {
  const title = String(app?.data?.title ?? app?.title ?? "");
  if (!title || !TITLE_RULES.some((re) => re.test(title))) return false;
  return !SKIP_CLASSES.some((c) => el.classList.contains(c));
}

function variantOf(app) {
  const keys = Object.keys(app?.data?.buttons ?? {});
  const title = String(app?.data?.title ?? "");
  if (/^Удалить/i.test(title) && keys.includes("yes")) return "osd--danger";
  if (!keys.includes("normal")) return "osd--compact";
  return "";
}

/* Полоса разреза: отдельный слой поверх окна по его прямоугольнику */
function slash(el, mode, danger) {
  if (osiCalm() || !el?.isConnected) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const s = document.createElement("div");
  s.className = `osd-slash ${mode}${danger ? " is-danger" : ""}`;
  const z = (Number.parseInt(getComputedStyle(el).zIndex, 10) || 100) + 1;
  Object.assign(s.style, { left: `${r.left - 60}px`, top: `${r.top - 20}px`, width: `${r.width + 120}px`, height: `${r.height + 40}px`, zIndex: String(z) });
  s.innerHTML = "<i></i><i></i>";
  s.setAttribute("aria-hidden", "true");
  document.body.append(s);
  setTimeout(() => s.remove(), 700);
}

/* Плашка заголовка и кнопки: идемпотентно, переживает повторный render */
function decorate(app, el) {
  const content = el.querySelector(".window-content");
  if (!content) return;
  const title = String(app?.data?.title ?? "");

  if (!content.querySelector(":scope > .osd-plate")) {
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
    const skin = BUTTON_SKIN[btn.dataset.button] ?? {};
    const label = btn.textContent.replace(/\s+/g, " ").trim();
    const fa = btn.querySelector("i[class*='fa-']");
    const icon = skin.icon ? osiIcon(skin.icon) : (fa ? fa.outerHTML : "");
    btn.innerHTML = `<span class="dialog-button-row">${icon}${esc(label)}</span>${skin.sub ? `<small>${esc(skin.sub)}</small>` : ""}`;
  });

  el.querySelectorAll(".dialog-content .form-group, .dialog-content form > p, .dialog-content .osd-note")
    .forEach((n, i) => n.style.setProperty("--i", i));
}

/* Окно шире стандартных 400px: подписи под кнопками броска помещаются в строку */
function place(app, el) {
  if (app._osdPlaced) return;
  app._osdPlaced = true;
  const w = Number(app.position?.width) || el.offsetWidth;
  const pos = {};
  if (w < DIALOG_MIN_W) {
    pos.width = DIALOG_MIN_W;
    if (app.options?.left == null) pos.left = Math.max(12, Math.round((window.innerWidth - DIALOG_MIN_W) / 2));
  }
  if (Object.keys(pos).length) { try { app.setPosition(pos); } catch (e) { /* позиция не критична */ } }
  if (app.options?.top == null) {
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const h = el.offsetHeight;
      try { app.setPosition({ top: Math.max(12, Math.round((window.innerHeight - h) / 2.4)) }); } catch (e) { /* ignore */ }
    });
  }
}

function focusFirst(el) {
  const target = el.querySelector('.dialog-content input[type="text"]:not([readonly]):not([disabled]), .dialog-content input[type="number"]:not([readonly]):not([disabled])')
    || el.querySelector(".dialog-button.default:not([disabled])")
    || el.querySelector(".dialog-content select, .dialog-button:not([disabled])");
  try { target?.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}

/* Выбор: механика Foundry срабатывает сама, скин только отмечает кнопку (захват идёт раньше обработчика окна) */
function bindChoice(app, el) {
  if (el.dataset.osdBound) return;
  el.dataset.osdBound = "1";
  const mark = (key) => {
    if (!key || app._osdChosen) return;
    const btn = el.querySelector(`.dialog-button[data-button="${CSS.escape(key)}"]`);
    if (!btn || btn.disabled) return;
    app._osdChosen = key;
    btn.classList.add("is-chosen");
    el.querySelector(".dialog-buttons")?.classList.add("has-choice");
    sfx(key === "cancel" || key === "no" ? "dialogOut" : "choose");
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

function onRender(app, html) {
  const el = appElement(app, html);
  if (!el || !wants(app, el)) return;
  ensureOsiSprite();

  const first = !el.classList.contains("osd");
  el.classList.add("osd");
  const v = variantOf(app);
  el.classList.remove("osd--danger", "osd--compact");
  if (v) el.classList.add(v);
  osiApplyScheme(el);
  decorate(app, el);
  bindChoice(app, el);

  if (!first) return;
  place(app, el);
  el.classList.add("is-enter");
  sfx("slash");
  if (!osiCalm()) requestAnimationFrame(() => slash(el, "is-run", v === "osd--danger"));
  setTimeout(() => el.classList.remove("is-enter"), osiCalm() ? 300 : 1000);
  focusFirst(el);
}

/* Закрытие: jQuery slideUp сминает окно по высоте, поэтому высота фиксируется и окно уходит вбок */
function onClose(app, html) {
  const el = appElement(app, html);
  if (!el || !el.classList.contains("osd")) return;
  if (!app._osdChosen) sfx("dialogOut");
  slash(el, "is-out", el.classList.contains("osd--danger"));
  el.style.setProperty("--osd-h", `${el.offsetHeight}px`);
  el.classList.remove("is-enter");
  el.classList.add("is-leave");
  app._osdChosen = null;
  app._osdPlaced = false;
}

export function registerOrderDialogSkin() {
  if (globalThis.__orderDialogSkin) return;
  globalThis.__orderDialogSkin = true;
  Hooks.on("renderDialog", (app, html) => { try { onRender(app, html); } catch (e) { console.warn("[Order] Скин диалога", e); } });
  Hooks.on("closeDialog", (app, html) => { try { onClose(app, html); } catch (e) { console.warn("[Order] Скин диалога", e); } });
}

export default registerOrderDialogSkin;
