/**
 * OrderTokenHudActions.js — Базовые действия tab for Token HUD (Foundry VTT v11)
 *
 * Replaces the "Заметки" (notes) tab in OrderTokenHud with "Базовые действия".
 * Loads items from the "Базовые действия" compendium (Order.bazovye-dejstviya),
 * grouped by actual compendium folders.
 *
 * Folder names are read dynamically from the compendium.
 * Action type (main/bonus) is detected by keyword in the folder name.
 *
 * Fully self-contained: loaded via system.json esmodules. No changes to OrderTokenHud.js needed.
 */

const COMPENDIUM_NAME = "Order.bazovye-dejstviya";
const TEMPLATE_RE = /\/\s*_+\s*действие шаблон/i;

/* Keyword → action type mapping (checked via .includes on lowercase folder name) */
const ACTION_TYPE_KEYWORDS = [
  { kw: "основн", type: "main",  icon: "fa-solid fa-fist-raised",    color: "#3cb44b" },
  { kw: "бонусн", type: "bonus", icon: "fa-solid fa-plus-circle",    color: "#38b9e9" },
  { kw: "мгновен", type: "instant", icon: "fa-solid fa-bolt-lightning", color: "#ffe119" },
  { kw: "защит",  type: "defense", icon: "fa-solid fa-shield-alt",    color: "#f58231" }
];

function _detectActionType(folderName) {
  const lower = (folderName || "").toLowerCase();
  for (const entry of ACTION_TYPE_KEYWORDS) {
    if (lower.includes(entry.kw)) return entry;
  }
  return { kw: "", type: "other", icon: "fa-solid fa-folder", color: "#888" };
}

let _cache = null;       // { folderName: { items: [...], meta: {...} } }
let _folderOrder = [];   // sorted folder names
let _loading = false;
let _currentFolder = null;
let _patchRAF = 0;
let _patching = false;

/* ═══════════════════════════════════════════════════════════════════════════
   COMPENDIUM LOADING (Foundry v11 LevelDB)
   ═══════════════════════════════════════════════════════════════════════════ */

async function _loadActions() {
  if (_cache) return _cache;
  if (_loading) return null;
  _loading = true;
  try {
    const pack = game.packs.get(COMPENDIUM_NAME);
    if (!pack) {
      console.warn("OrderTokenHudActions | Compendium not found:", COMPENDIUM_NAME);
      _loading = false;
      return null;
    }

    const docs = await pack.getDocuments();

    // Collect all folder names from documents
    const folderNames = new Map(); // id → name
    for (const item of docs) {
      const folder = item.folder;
      if (folder && typeof folder === "object" && folder.id && folder.name) {
        folderNames.set(folder.id, folder.name);
      }
    }

    // Also try pack.folders
    try {
      const pf = pack.folders?.contents ?? pack.folders ?? [];
      const iter = typeof pf[Symbol.iterator] === "function" ? pf
        : (typeof pf.values === "function" ? Array.from(pf.values()) : []);
      for (const f of iter) {
        if (f?.id && f?.name) folderNames.set(f.id, f.name);
      }
    } catch (e) { /* ok */ }

    console.log("OrderTokenHudActions | Found folders:", [...folderNames.values()]);

    // Build cache keyed by folder name
    _cache = {};
    for (const [, name] of folderNames) {
      if (!_cache[name]) {
        _cache[name] = { items: [], meta: _detectActionType(name) };
      }
    }

    // Sort folder order to match ACTION_TYPE_KEYWORDS order
    _folderOrder = Object.keys(_cache).sort((a, b) => {
      const ai = ACTION_TYPE_KEYWORDS.findIndex(e => a.toLowerCase().includes(e.kw));
      const bi = ACTION_TYPE_KEYWORDS.findIndex(e => b.toLowerCase().includes(e.kw));
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    // Fill items
    for (const item of docs) {
      if (TEMPLATE_RE.test(item.name)) continue;

      let folderName = null;
      const folder = item.folder;
      if (folder && typeof folder === "object") {
        folderName = folder.name || folderNames.get(folder.id) || null;
      } else if (typeof folder === "string") {
        folderName = folderNames.get(folder) || null;
      }

      if (folderName && _cache[folderName]) {
        _cache[folderName].items.push({
          name: item.name,
          img: item.img || "icons/svg/item-bag.svg",
          uuid: item.uuid,
          desc: String(item.system?.Description || item.system?.description || "")
        });
      }
    }

    console.log("OrderTokenHudActions | Loaded:", Object.fromEntries(
      Object.entries(_cache).map(([k, v]) => [k, v.items.length])
    ));
    _loading = false;
    return _cache;
  } catch (e) {
    console.error("OrderTokenHudActions | Failed to load compendium", e);
    _loading = false;
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function _getControlledActor() {
  return canvas?.tokens?.controlled?.[0]?.actor ?? null;
}

function _escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function _showTip(ev, html) {
  const t = document.getElementById("oth-tt-el");
  if (!t) return;
  t.innerHTML = html;
  t.classList.add("v");
  _moveTip(ev);
}
function _moveTip(ev) {
  const t = document.getElementById("oth-tt-el");
  if (!t) return;
  let x = ev.clientX + 12, y = ev.clientY - t.offsetHeight - 8;
  if (x + t.offsetWidth > window.innerWidth - 6) x = ev.clientX - t.offsetWidth - 12;
  if (y < 4) y = ev.clientY + 16;
  t.style.left = x + "px";
  t.style.top = y + "px";
}
function _hideTip() {
  document.getElementById("oth-tt-el")?.classList.remove("v");
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════════════ */

function _renderFolders() {
  if (!_cache || !_folderOrder.length) return '<div class="oth-empty">Загрузка...</div>';
  let h = '<div class="oth-ba-folders">';
  for (const fn of _folderOrder) {
    const meta = _cache[fn]?.meta || _detectActionType(fn);
    h += `<div class="oth-ba-folder" data-afolder="${_escHtml(fn)}">`;
    h += `<i class="${meta.icon}" style="color:${meta.color};font-size:16px;"></i>`;
    h += `<span>${_escHtml(fn)}</span>`;
    h += `</div>`;
  }
  h += '</div>';
  return h;
}

function _renderActions(folderName) {
  if (!_cache?.[folderName]) return '<div class="oth-empty">Загрузка...</div>';
  const items = _cache[folderName].items;
  if (!items.length) return '<div class="oth-empty">Пусто</div>';
  let h = '<div class="oth-g5">';
  for (const it of items) {
    h += `<div class="oth-c oth-cf oth-ba-item" data-auuid="${it.uuid}" data-afname="${_escHtml(folderName)}"><img src="${it.img}"/></div>`;
  }
  h += '</div>';
  return h;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LISTENERS
   ═══════════════════════════════════════════════════════════════════════════ */

function _attachListeners(area) {
  const actor = _getControlledActor();

  area.querySelectorAll(".oth-ba-folder").forEach(btn => {
    btn.addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      _currentFolder = btn.dataset.afolder;
      if (!_cache) await _loadActions();
      _fillArea();
    });
    btn.addEventListener("mouseenter", ev => {
      const fn = btn.dataset.afolder;
      const meta = _cache?.[fn]?.meta || _detectActionType(fn);
      _showTip(ev, `<span class="oth-tip-t" style="color:${meta.color};">${_escHtml(fn)}</span>`);
    });
    btn.addEventListener("mousemove", _moveTip);
    btn.addEventListener("mouseleave", _hideTip);
  });

  area.querySelectorAll(".oth-ba-item").forEach(card => {
    const uuid = card.dataset.auuid;
    const folderName = card.dataset.afname;
    const meta = _cache?.[folderName]?.meta || _detectActionType(folderName);

    card.addEventListener("click", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!actor) return;

      // Toggle action status for main / bonus folders
      if (meta.type === "main") {
        try {
          const cur = actor.getFlag("Order", "othMainAction");
          const avail = cur !== false;
          await actor.setFlag("Order", "othMainAction", !avail);
          _updateActionButton("mainAction", !avail);
        } catch (e) { console.warn("OrderTokenHudActions | toggle mainAction", e); }
      } else if (meta.type === "bonus") {
        try {
          const cur = actor.getFlag("Order", "othBonusAction");
          const avail = cur !== false;
          await actor.setFlag("Order", "othBonusAction", !avail);
          _updateActionButton("bonusAction", !avail);
        } catch (e) { console.warn("OrderTokenHudActions | toggle bonusAction", e); }
      }

      // Post to chat
      try {
        const item = await fromUuid(uuid);
        if (item) {
          const desc = String(item.system?.Description || item.system?.description || "").substring(0, 400);
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div style="display:flex;gap:8px;align-items:flex-start;">
              <img src="${item.img}" width="36" height="36" style="border:0;border-radius:3px;flex-shrink:0;"/>
              <div>
                <strong>${_escHtml(item.name)}</strong>
                ${desc ? `<br/><span style="font-size:11px;opacity:0.8;">${_escHtml(desc)}</span>` : ""}
              </div>
            </div>`,
            type: CONST.CHAT_MESSAGE_TYPES.OTHER
          });
        }
      } catch (e) { console.warn("OrderTokenHudActions | chat error", e); }
    });

    card.addEventListener("contextmenu", async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      try { (await fromUuid(uuid))?.sheet?.render(true); } catch {}
    });

    card.addEventListener("mouseenter", ev => {
      const cached = _cache?.[folderName]?.items?.find(i => i.uuid === uuid);
      if (!cached) return;
      let tt = `<div class="oth-tip-t">${_escHtml(cached.name)}</div>`;
      if (cached.desc) tt += `<div style="font-size:10px;color:rgba(238,243,255,0.6);margin:3px 0;">${_escHtml(cached.desc.substring(0, 200))}</div>`;
      const hint = meta.type === "main" ? "ЛКМ — использ. (осн. действие)"
        : meta.type === "bonus" ? "ЛКМ — использ. (бон. действие)"
        : "ЛКМ — использовать в чат";
      tt += `<div class="oth-tip-h">${hint} · ПКМ — лист</div>`;
      _showTip(ev, tt);
    });
    card.addEventListener("mousemove", _moveTip);
    card.addEventListener("mouseleave", _hideTip);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOM
   ═══════════════════════════════════════════════════════════════════════════ */

function _updateActionButton(actName, isAvailable) {
  const hud = document.getElementById("order-token-hud");
  if (!hud) return;
  const btn = hud.querySelector(`[data-act="${actName}"]`);
  if (!btn) return;
  btn.classList.toggle("oth-act-on", isAvailable);
  btn.classList.toggle("oth-act-off", !isAvailable);
  const icon = btn.querySelector("i");
  if (icon) icon.className = isAvailable ? "fa-solid fa-check" : "fa-solid fa-xmark";
}

function _fillArea() {
  const hud = document.getElementById("order-token-hud");
  if (!hud) return;
  const area = hud.querySelector(".oth-area");
  if (!area) return;
  _patching = true;
  area.dataset._baState = _currentFolder || "__folders__";
  area.innerHTML = _currentFolder ? _renderActions(_currentFolder) : _renderFolders();
  _attachListeners(area);
  _patching = false;
}

function _isNotesTabActive() {
  const hud = document.getElementById("order-token-hud");
  if (!hud) return false;
  const tab = hud.querySelector('.oth-tb[data-t="notes"]');
  return tab && tab.classList.contains("on");
}

function _patchTabButton(hud) {
  const notesTab = hud.querySelector('.oth-tb[data-t="notes"]');
  if (!notesTab || notesTab.dataset._baPatched) return;
  notesTab.dataset._baPatched = "1";
  notesTab.dataset.tt = "Базовые действия";
  const icon = notesTab.querySelector("i");
  if (icon) icon.className = "fa-solid fa-bolt";

  notesTab.addEventListener("click", ev => {
    if (_currentFolder && _isNotesTabActive()) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      _currentFolder = null;
      _fillArea();
    }
  }, true);
}

function _patchArea() {
  const hud = document.getElementById("order-token-hud");
  if (!hud) return;
  _patchTabButton(hud);
  if (!_isNotesTabActive()) return;
  const area = hud.querySelector(".oth-area");
  if (!area) return;
  const stateKey = _currentFolder || "__folders__";
  if (area.dataset._baState === stateKey) return;
  _fillArea();
}

function _schedulePatch() {
  if (_patchRAF || _patching) return;
  _patchRAF = requestAnimationFrame(() => {
    _patchRAF = 0;
    if (_patching) return;
    _patchArea();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.once("ready", () => {
  setTimeout(() => _loadActions(), 1500);

  const observer = new MutationObserver(() => {
    if (document.getElementById("order-token-hud")) _schedulePatch();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  Hooks.on("controlToken", () => { _currentFolder = null; });

  console.log("OrderTokenHudActions | Registered");
});
