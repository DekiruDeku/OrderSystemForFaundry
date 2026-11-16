/* ============================================================================
   tokenDebuffHud.js — колонка дебаффов выбранного токена (#order-debuff-hud)
   у левого края сайдбара.
   ЛКМ — уровень +1 (до числа состояний в module/debuffs.json), ПКМ — уровень −1,
   ниже 1 — эффект снимается. Клавиатура: + / − / Delete.
   Перерисовка по debuffKey: новые чипы влетают, уровни «штампуются», снятые отрываются.
   ============================================================================ */
import { OrderSfx } from "./OrderSfx.js";
import { F, loadDebuffs } from "./OrderTokenHudAdapter.js";

const HUD_ID = "order-debuff-hud";
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plain = (s) => { const d = document.createElement("div"); d.innerHTML = String(s ?? ""); return String(d.textContent ?? "").trim(); };
const calm = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("order-no-animations"); } catch { return false; } };
const sfx = (n) => { try { OrderSfx.play(n); } catch { /* звук не ломает HUD */ } };
const reflow = (el) => void el?.offsetWidth;

let actor = null;
let refreshT = 0;
let sidebarObserver = null;
let sidebarResizeObserver = null;

function ensureHud() {
  let hud = document.getElementById(HUD_ID);
  if (hud) return hud;
  hud = document.createElement("div");
  hud.id = HUD_ID;
  hud.className = "oth-surface order-debuff-hud is-hidden";
  hud.setAttribute("role", "list");
  hud.setAttribute("aria-label", "Дебаффы");
  document.body.appendChild(hud);
  hud.addEventListener("click", (e) => { const b = e.target.closest(".order-debuff-icon"); if (b) { e.preventDefault(); changeLevel(b, 1); } });
  hud.addEventListener("contextmenu", (e) => { const b = e.target.closest(".order-debuff-icon"); if (b) { e.preventDefault(); changeLevel(b, -1); } });
  hud.addEventListener("keydown", (e) => {
    const b = e.target.closest(".order-debuff-icon");
    if (!b) return;
    if (e.key === "-" || e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); changeLevel(b, -1); }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); changeLevel(b, 1); }
  });
  position(hud);
  return hud;
}

function position(hud = document.getElementById(HUD_ID)) {
  if (!(hud instanceof HTMLElement)) return;
  const sb = F.sidebar()?.getBoundingClientRect();
  hud.style.right = sb ? `${Math.max(10, innerWidth - sb.left + 10)}px` : "10px";
}

const effectsOf = (a) => (a?.effects ? a.effects.filter((ef) => ef.getFlag("Order", "debuffKey")) : []);
const maxOf = (ef) => Object.keys(F.debuffs[ef.getFlag("Order", "debuffKey")]?.states ?? {}).length || Number(ef.getFlag("Order", "maxState")) || 1;
function descOf(ef) {
  const legacy = ef?.flags?.description;
  return plain(ef?.description || (typeof legacy === "string" ? legacy : "") || "");
}

function chipHtml(ef) {
  const level = Number(ef.getFlag("Order", "stateKey")) || 1;
  const max = maxOf(ef);
  const pips = max > 1 ? `<span class="order-debuff-pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < level ? "on" : ""}"></i>`).join("")}</span>` : "";
  const lvl = max > 1 ? `<em>Уровень ${ROMAN[level] ?? level} из ${ROMAN[max] ?? max}</em>` : "";
  return `<img src="${esc(ef.img)}" alt="">${pips}<span class="order-debuff-tooltip" role="tooltip"><b>${esc(ef.name)}</b>${lvl}${esc(descOf(ef))}<span class="oth-tip-h"><span><kbd>ЛКМ</kbd>уровень +1</span><span><kbd>ПКМ</kbd>−1 / снять</span></span></span>`;
}

function render(a) {
  const switching = (actor?.uuid ?? null) !== (a?.uuid ?? null);
  actor = a;
  const hud = ensureHud();
  if (switching) hud.innerHTML = "";
  position(hud);
  const effects = effectsOf(a);
  if (!a || !effects.length) {
    // уходящие чипы отрываются, затем колонка прячется
    const left = [...hud.querySelectorAll(".order-debuff-icon:not(.is-out)")];
    if (!left.length || calm()) { hud.innerHTML = ""; hud.classList.add("is-hidden"); return; }
    left.forEach((el) => el.classList.add("is-out"));
    setTimeout(() => { if (!effectsOf(actor).length) { hud.innerHTML = ""; hud.classList.add("is-hidden"); } }, 300);
    return;
  }
  hud.classList.remove("is-hidden");
  const seen = new Set();
  effects.forEach((ef, i) => {
    const key = ef.getFlag("Order", "debuffKey");
    seen.add(key);
    const level = Number(ef.getFlag("Order", "stateKey")) || 1;
    let el = [...hud.querySelectorAll(".order-debuff-icon:not(.is-out)")].find((x) => x.dataset.key === key);
    const fresh = !el;
    if (fresh) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "order-debuff-icon";
      el.dataset.key = key;
      el.setAttribute("role", "listitem");
    }
    const was = Number(el.dataset.level || 0);
    el.dataset.level = String(level);
    el.dataset.effectId = ef.id;
    el.innerHTML = chipHtml(ef);
    el.setAttribute("aria-label", `${ef.name}, уровень ${level}`);
    const at = hud.children[i];
    if (at !== el) hud.insertBefore(el, at ?? null);
    if (calm()) return;
    if (fresh && !switching) { el.classList.add("is-new"); setTimeout(() => el.classList.remove("is-new"), 480); }
    else if (was && level > was) { el.classList.remove("is-up"); reflow(el); el.classList.add("is-up"); setTimeout(() => el.classList.remove("is-up"), 440); }
    else if (was && level < was) { el.classList.remove("is-down"); reflow(el); el.classList.add("is-down"); setTimeout(() => el.classList.remove("is-down"), 340); }
  });
  hud.querySelectorAll(".order-debuff-icon").forEach((el) => {
    if (seen.has(el.dataset.key) || el.classList.contains("is-out")) return;
    if (calm()) { el.remove(); return; }
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 300);
  });
}

/* паритет с updateDebuffEffectLevel */
async function changeLevel(el, delta) {
  const ef = actor?.effects?.get?.(el.dataset.effectId);
  const owner = ef?.parent ?? actor;
  if (!ef || !owner) return;
  const key = ef.getFlag("Order", "debuffKey");
  if (!key) return;
  const data = await loadDebuffs();
  const debuff = data?.[key];
  if (!debuff) return;
  const max = Object.keys(debuff.states || {}).length || Number(ef.getFlag("Order", "maxState")) || 1;
  const next = (Number(ef.getFlag("Order", "stateKey")) || 1) + delta;
  if (next < 1) {
    sfx("debuffDown");
    await owner.deleteEmbeddedDocuments("ActiveEffect", [ef.id]);
    return;
  }
  if (next > max) {
    sfx("errorLow");
    if (!calm()) { el.classList.remove("is-max"); reflow(el); el.classList.add("is-max"); setTimeout(() => el.classList.remove("is-max"), 300); }
    return;
  }
  sfx(delta > 0 ? "debuffUp" : "debuffDown");
  if (typeof owner._applyDebuff === "function") {
    await owner._applyDebuff(key, String(next));
    return;
  }
  const stageChanges = Array.isArray(debuff.changes?.[next]) ? debuff.changes[next].map((change) => ({ ...change })) : [];
  await ef.update({
    changes: stageChanges,
    description: debuff.states[next],
    "flags.Order.stateKey": next,
    "flags.Order.maxState": max
  });
}

const controlledToken = () => Array.from(canvas?.tokens?.controlled || [])[0] || null;
const refreshForControlled = () => render(controlledToken()?.actor ?? null);
/* снятие и выбор токена идут подряд — перерисовываем один раз */
function scheduleRefresh() {
  clearTimeout(refreshT);
  refreshT = setTimeout(refreshForControlled, 0);
}
const isControlledActor = (doc) => {
  const a = controlledToken()?.actor;
  return !!a && !!doc && (doc === a || doc.uuid === a.uuid || doc.id === a.id);
};

export const registerTokenDebuffHud = () => {
  Hooks.once("ready", async () => {
    ensureHud();
    position();
    await loadDebuffs();
    refreshForControlled();

    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebarObserver = new MutationObserver(() => position());
      sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ["class", "style"] });
      if (window.ResizeObserver) {
        sidebarResizeObserver = new ResizeObserver(() => position());
        sidebarResizeObserver.observe(sidebar);
      }
    }
    window.addEventListener("resize", () => position());
  });

  Hooks.on("controlToken", scheduleRefresh);
  for (const h of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(h, (effect) => { if (isControlledActor(effect?.parent)) refreshForControlled(); });
  }
  Hooks.on("updateToken", (doc, changed) => {
    const id = changed?._id ?? doc?.id;
    if (controlledToken()?.id === id) refreshForControlled();
  });
};
