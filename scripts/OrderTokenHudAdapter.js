/* ============================================================================
   OrderTokenHudAdapter.js — сторона Foundry для HUD токена.
   Ядро HUD (OrderTokenHud.js) обращается к Foundry только через объект F:
   флаги и листы актёра, чат, использование предметов, базовые действия,
   выбор картинки портрета, данные дебаффов.
   ============================================================================ */
import { getActorArmorDefenseBonus } from "./OrderArmorDefenseBuff.js";
import { getSkillCooldownView } from "./OrderSkillCooldown.js";
import { loadBaseActions, useBaseActionItem, openBaseActionSheet } from "./OrderTokenHudActions.js";

const ORDER_RED = "#e3172f";
const PORTRAIT_FLAG = "tokenHudPortrait";
const DEBUFFS_URL = "systems/Order/module/debuffs.json";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* --- дебаффы: module/debuffs.json, читаем один раз --- */
let DEBUFFS = {};
let debuffsPromise = null;
export function loadDebuffs() {
  debuffsPromise ??= fetch(DEBUFFS_URL)
    .then((r) => { if (!r.ok) throw new Error(`Failed to load ${DEBUFFS_URL}`); return r.json(); })
    .then((d) => { DEBUFFS = d && typeof d === "object" ? d : {}; return DEBUFFS; })
    .catch((e) => { console.error("Order | TokenHud debuffs", e); debuffsPromise = null; return DEBUFFS; });
  return debuffsPromise;
}

/* --- броня: паритет со старым OrderTokenHud.js (_arm) --- */
function armorOf(a) {
  let best = 0;
  for (const i of a?.items ?? []) {
    if (i?.type !== "Armor") continue;
    const s = i.system ?? {};
    if (!(s.isEquiped && s.isUsed)) continue;
    const v = Number(s.Deffensepotential ?? 0) || 0;
    if (v > best) best = v;
  }
  return best + (Number(a?.system?._perkBonuses?.Armor ?? 0) || 0) + getActorArmorDefenseBonus(a);
}

/* --- выбор картинки: FilePicker, а без права на просмотр файлов — поле пути --- */
function filePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker ?? null;
}
async function promptPath(current) {
  const Dialog = foundry.applications?.api?.DialogV2;
  if (!Dialog) return null;
  try {
    const v = await Dialog.prompt({
      window: { title: "Портрет HUD" },
      content: `<p>Нет доступа к браузеру файлов. Вставьте путь к картинке или URL.</p>
        <input type="text" name="src" value="${esc(current ?? "")}" spellcheck="false" autofocus>`,
      ok: { label: "Выбрать", callback: (event, button) => String(button.form?.elements?.src?.value ?? "").trim() },
      rejectClose: false
    });
    return typeof v === "string" && v ? v : null;
  } catch { return null; }
}
function pickImage(current) {
  const FP = filePickerClass();
  const canBrowse = (() => { try { return game.user?.can?.("FILES_BROWSE") ?? true; } catch { return true; } })();
  if (!FP || !canBrowse) return promptPath(current);
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v || null); } };
    try {
      const fp = new FP({ type: "image", current: current || "", callback: (path) => fin(path) });
      // закрыли без выбора: callback уже не придёт
      const close = fp.close.bind(fp);
      fp.close = async (...args) => { const r = await close(...args); setTimeout(() => fin(null), 0); return r; };
      const shown = typeof fp.browse === "function" ? fp.browse(current || "") : fp.render(true);
      Promise.resolve(shown).catch((e) => { console.warn("Order | TokenHud FilePicker", e); fin(null); });
    } catch (e) {
      console.warn("Order | TokenHud FilePicker", e);
      fin(null);
    }
  });
}

/* --- использование предмета: game.Order.macros.useItem, иначе лист --- */
const useMacro = () => (typeof game?.Order?.macros?.useItem === "function" ? game.Order.macros.useItem : null);
function syncUuid(uuid) {
  try { return (foundry.utils?.fromUuidSync ?? globalThis.fromUuidSync)?.(uuid) ?? null; } catch { return null; }
}

export const F = {
  isGM: () => !!game.user?.isGM,
  playerColor: () => String(game.user?.color ?? ORDER_RED),
  canView: (actor) => !!actor && (!!game.user?.isGM || !!actor.isOwner),
  hotbar: () => document.getElementById("hotbar"),
  sidebar: () => document.getElementById("sidebar"),
  fromUuidSync: syncUuid,
  chat(actor, html) {
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html, style: CONST.CHAT_MESSAGE_STYLES.OTHER });
  },
  openSheet: (doc) => doc?.sheet?.render(true),

  /* портрет HUD: флаг актёра Order.tokenHudPortrait = { src, x, y, zoom }; null — снять флаг */
  portrait: (actor) => { try { return actor?.getFlag("Order", PORTRAIT_FLAG) ?? null; } catch { return null; } },
  canEditPortrait: (actor) => !!actor?.isOwner,
  setPortrait: (actor, data) => (data ? actor.setFlag("Order", PORTRAIT_FLAG, data) : actor.unsetFlag("Order", PORTRAIT_FLAG)),
  pickImage,

  /* true — предмет использован макросом системы, false — открыт лист */
  async useItem(item) {
    if (!item) return false;
    const use = useMacro();
    if (!use) { item.sheet?.render(true); return false; }
    try { await use(item.uuid); } catch (e) { console.warn("Order | TokenHud useItem", e); }
    return true;
  },
  async useUuid(uuid) {
    if (!uuid) return false;
    const use = useMacro();
    if (!use) { syncUuid(uuid)?.sheet?.render(true); return false; }
    try { await use(uuid); } catch (e) { console.warn("Order | TokenHud useItem", e); }
    return true;
  },
  skillCooldown: (actor, item) => { try { return getSkillCooldownView({ actor, skillItem: item }); } catch { return null; } },
  armor: armorOf,

  /* бросок и тренировка: окно листа; если лист ещё не открывался — отрисовать и повторить */
  async roll(actor, attr, { training = false } = {}) {
    const m = training ? "_openTrainingDialog" : "_openRollDialog";
    const sheet = actor?.sheet;
    if (typeof sheet?.[m] === "function") return sheet[m](attr);
    try { await sheet?.render?.(true); } catch { /* лист не открылся */ }
    setTimeout(() => actor?.sheet?.[m]?.(attr), 350);
  },

  baseActions: () => loadBaseActions(),
  useBaseAction: (actor, uuid) => useBaseActionItem(actor, uuid),
  openBaseActionSheet: (uuid) => openBaseActionSheet(uuid),

  /* «Анимации» в меню HUD — та же клиентская настройка, что и в листе */
  async setAnimations(on) {
    document.body.classList.toggle("order-no-animations", !on);
    try {
      if (game.settings.settings.has("Order.enableSheetAnimations")) await game.settings.set("Order", "enableSheetAnimations", !!on);
    } catch { /* настройка недоступна */ }
  },
  hudEnabled: () => { try { return game.settings.get("Order", "enableTokenHud") !== false; } catch { return true; } },
  get debuffs() { return DEBUFFS; }
};
