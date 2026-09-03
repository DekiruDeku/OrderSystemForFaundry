import { evaluateRollFormula } from "./OrderDamageFormula.js";

const Dialog = foundry.appv1?.api?.Dialog ?? globalThis.Dialog;

let _dialog = null;
let _registered = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSelectedTokens() {
  const controlled = canvas?.tokens?.controlled ?? [];
  const seen = new Set();
  return controlled.filter((token) => {
    const actor = token?.actor;
    if (!actor) return false;
    const key = String(token?.id ?? actor?.id ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getPortrait(token) {
  return String(token?.actor?.img || token?.document?.texture?.src || token?.texture?.src || "icons/svg/mystery-man.svg");
}

function renderParticipantCard(token, index) {
  const actor = token.actor;
  return `
    <article class="order-mass-roll-card" data-index="${index}" data-token-id="${escapeHtml(token.id)}">
      <div class="order-mass-roll-card__head">
        <div class="order-mass-roll-card__name" title="${escapeHtml(actor.name)}">${escapeHtml(actor.name)}</div>
        <div class="order-mass-roll-card__portrait">
          <img src="${escapeHtml(getPortrait(token))}" alt="${escapeHtml(actor.name)}">
        </div>
      </div>
      <div class="order-mass-roll-card__body">
        <div class="order-mass-roll-dice" aria-label="Количество d20">
          <button type="button" class="order-mass-roll-dice__button" data-action="dice-minus" title="Уменьшить количество d20">−</button>
          <div class="order-mass-roll-dice__value"><span class="order-mass-roll-dice-count">1</span><small>d20</small></div>
          <button type="button" class="order-mass-roll-dice__button" data-action="dice-plus" title="Увеличить количество d20">+</button>
        </div>
        <label class="order-mass-roll-formula-label">
          <span>Формула</span>
          <input class="order-mass-roll-formula" type="text" placeholder="Сила / Сила/2+Знания/2 / Магия*2" autocomplete="off" spellcheck="false">
        </label>
        <div class="order-mass-roll-preview">1d20</div>
      </div>
    </article>`;
}

function buildContent(tokens) {
  return `
    <div class="order-mass-roll-app">
      <div class="order-mass-roll-toolbar">
        <label class="order-mass-roll-global">
          <span>Формула всем</span>
          <input type="text" class="order-mass-roll-global-formula" placeholder="Например: Сила или Сила/2+Знания/2" autocomplete="off" spellcheck="false">
        </label>
        <button type="button" class="order-mass-roll-apply" title="Заполнить этой формулой все карточки">Применить всем</button>
      </div>
      <div class="order-mass-roll-hint">Формула считается отдельно по характеристикам каждого персонажа. Пустая формула = только d20.</div>
      <div class="order-mass-roll-grid">
        ${tokens.map(renderParticipantCard).join("")}
      </div>
    </div>`;
}

function readDiceCount(card) {
  const raw = Number(card.querySelector(".order-mass-roll-dice-count")?.textContent ?? 1);
  return Math.min(20, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 1));
}

function setDiceCount(card, value) {
  const next = Math.min(20, Math.max(1, Number(value) || 1));
  const el = card.querySelector(".order-mass-roll-dice-count");
  if (el) el.textContent = String(next);
  updatePreview(card);
}

function getFormulaValue(actor, rawFormula) {
  const formula = String(rawFormula ?? "").trim();
  if (!formula) return 0;
  return Number(evaluateRollFormula(formula, actor, null)) || 0;
}

function buildFinalRollFormula(diceCount, modifier) {
  let formula = `${diceCount}d20`;
  if (modifier > 0) formula += ` + ${modifier}`;
  else if (modifier < 0) formula += ` - ${Math.abs(modifier)}`;
  return formula;
}

function updatePreview(card) {
  const tokenId = String(card.dataset.tokenId ?? "");
  const token = canvas?.tokens?.get(tokenId) ?? canvas?.tokens?.placeables?.find((t) => String(t.id) === tokenId);
  const actor = token?.actor;
  if (!actor) return;

  const diceCount = readDiceCount(card);
  const rawFormula = String(card.querySelector(".order-mass-roll-formula")?.value ?? "").trim();
  const preview = card.querySelector(".order-mass-roll-preview");

  try {
    const modifier = getFormulaValue(actor, rawFormula);
    if (preview) {
      preview.classList.remove("is-error");
      preview.textContent = rawFormula
        ? `${buildFinalRollFormula(diceCount, modifier)}  •  ${rawFormula} = ${modifier}`
        : `${diceCount}d20`;
    }
  } catch (error) {
    if (preview) {
      preview.classList.add("is-error");
      preview.textContent = "Ошибка формулы";
    }
  }
}

function activateListeners(html, tokens) {
  const root = html?.[0] ?? html;
  if (!root) return;

  root.querySelectorAll(".order-mass-roll-card").forEach((card) => updatePreview(card));

  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-action]");
    if (!button) return;
    const card = button.closest(".order-mass-roll-card");
    if (!card) return;

    const current = readDiceCount(card);
    if (button.dataset.action === "dice-minus") setDiceCount(card, current - 1);
    if (button.dataset.action === "dice-plus") setDiceCount(card, current + 1);
  });

  root.addEventListener("input", (event) => {
    if (event.target?.classList?.contains("order-mass-roll-formula")) {
      const card = event.target.closest(".order-mass-roll-card");
      if (card) updatePreview(card);
    }
  });

  const globalInput = root.querySelector(".order-mass-roll-global-formula");
  const applyButton = root.querySelector(".order-mass-roll-apply");
  const applyGlobal = () => {
    const value = String(globalInput?.value ?? "");
    root.querySelectorAll(".order-mass-roll-card").forEach((card) => {
      const input = card.querySelector(".order-mass-roll-formula");
      if (input) input.value = value;
      updatePreview(card);
    });
  };

  applyButton?.addEventListener("click", applyGlobal);
  globalInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyGlobal();
  });
}

async function rollAll(html, tokens) {
  const root = html?.[0] ?? html;
  if (!root) return false;

  const cards = Array.from(root.querySelectorAll(".order-mass-roll-card"));
  if (!cards.length) return false;

  const jobs = [];
  for (const card of cards) {
    const tokenId = String(card.dataset.tokenId ?? "");
    const token = tokens.find((t) => String(t.id) === tokenId)
      ?? canvas?.tokens?.get(tokenId)
      ?? canvas?.tokens?.placeables?.find((t) => String(t.id) === tokenId);
    const actor = token?.actor;
    if (!actor) continue;

    const diceCount = readDiceCount(card);
    const rawFormula = String(card.querySelector(".order-mass-roll-formula")?.value ?? "").trim();
    const modifier = getFormulaValue(actor, rawFormula);
    const finalFormula = buildFinalRollFormula(diceCount, modifier);

    jobs.push({ token, actor, diceCount, rawFormula, modifier, finalFormula });
  }

  if (!jobs.length) {
    ui.notifications?.warn?.("Не найдено участников для массового броска.");
    return false;
  }

  for (const job of jobs) {
    try {
      const roll = await new Roll(job.finalFormula, job.actor.getRollData?.() ?? {}).roll();
      const formulaText = job.rawFormula
        ? `<div class="order-mass-roll-chat-formula">${escapeHtml(job.rawFormula)} = <strong>${job.modifier}</strong></div>`
        : `<div class="order-mass-roll-chat-formula">Без модификатора</div>`;

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: job.actor, token: job.token?.document ?? job.token }),
        flavor: `<div class="order-mass-roll-chat"><strong>Массовый бросок — ${escapeHtml(job.actor.name)}</strong>${formulaText}</div>`,
        flags: {
          Order: {
            massRoll: {
              formula: job.rawFormula,
              modifier: job.modifier,
              diceCount: job.diceCount,
              tokenId: job.token?.id ?? null,
              actorId: job.actor?.id ?? null
            }
          }
        }
      });
    } catch (error) {
      console.error("Order | Mass roll failed", job, error);
      ui.notifications?.error?.(`Не удалось бросить за ${job.actor?.name ?? "персонажа"}. Проверьте формулу.`);
    }
  }

  return true;
}

export function openOrderMassRollDialog() {
  const tokens = getSelectedTokens();
  if (!tokens.length) {
    ui.notifications?.warn?.("Для массового броска выделите один или несколько токенов.");
    return;
  }

  try {
    _dialog?.close?.();
  } catch (_error) {
    // noop
  }

  _dialog = new Dialog({
    title: `Массовый бросок • участников: ${tokens.length}`,
    content: buildContent(tokens),
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice-d20"></i>',
        label: "Бросить всем",
        callback: async (html) => rollAll(html, tokens)
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Отмена"
      }
    },
    default: "roll",
    render: (html) => activateListeners(html, tokens),
    close: () => { _dialog = null; }
  }, {
    width: Math.min(1180, Math.max(520, 320 * Math.min(tokens.length, 3) + 80)),
    height: "auto",
    classes: ["order-mass-roll-dialog"],
    resizable: true
  });

  _dialog.render(true);
}

function isTextEntryTarget(target) {
  const tag = String(target?.tagName ?? "").toLowerCase();
  return Boolean(
    target?.isContentEditable
    || tag === "input"
    || tag === "textarea"
    || tag === "select"
  );
}

function isCtrlR(event) {
  if (!event?.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;

  // IMPORTANT: use KeyboardEvent.code, not only event.key.
  // On a Russian keyboard layout the physical R key reports key="к",
  // while code remains "KeyR". Foundry's own KeyboardManager also works
  // with KeyboardEvent.code values for layout-independent keybindings.
  const code = String(event.code ?? "");
  if (code === "KeyR") return true;

  // Fallback for unusual embedded browsers which do not expose `code`.
  const key = String(event.key ?? "").toLowerCase();
  return key === "r" || key === "к";
}

function shouldHandleHotkey(event) {
  if (!isCtrlR(event)) return false;
  if (isTextEntryTarget(event.target)) return false;
  return getSelectedTokens().length > 0;
}

function consumeAndOpenMassRoll(event) {
  if (!shouldHandleHotkey(event)) return false;

  // Ctrl+R is normally browser reload. Suppress it only while one or more
  // canvas tokens are controlled and the user is not typing into a field.
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
  openOrderMassRollDialog();
  return true;
}

export function registerOrderMassRoll() {
  if (_registered) return;
  _registered = true;

  // Primary low-level capture listener. `window` capture runs before Foundry's
  // normal document keyboard processing and reliably blocks the browser's
  // reload action for Ctrl+R. Detection is based on physical KeyR, so EN/RU
  // keyboard layouts behave identically.
  window.addEventListener("keydown", consumeAndOpenMassRoll, true);

  // Also register the action in Foundry VTT 14's official keybinding system.
  // The capture listener above is the safety net for browser-reserved Ctrl+R;
  // this registration makes the hotkey known to Foundry's KeyboardManager as
  // well and provides a second path in clients where native propagation differs.
  try {
    game.keybindings?.register?.("Order", "massRoll", {
      name: "Массовый бросок",
      hint: "Открыть массовый бросок для выделенных токенов (Ctrl+R)",
      uneditable: [{ key: "KeyR", modifiers: ["Control"] }],
      onDown: (context) => {
        const event = context?.event;
        if (!event || !shouldHandleHotkey(event)) return false;
        openOrderMassRollDialog();
        return true;
      },
      restricted: false,
      repeat: false,
      precedence: CONST?.KEYBINDING_PRECEDENCE?.PRIORITY ?? 0
    });
  } catch (error) {
    // Never let a keybinding registration problem interrupt system init.
    // The native capture listener above remains fully functional.
    console.warn("Order | Could not register Foundry mass-roll keybinding; native Ctrl+R fallback remains active.", error);
  }

  try {
    game.OrderMassRoll = { open: openOrderMassRollDialog };
  } catch (_error) {
    globalThis.OrderMassRoll = { open: openOrderMassRollDialog };
  }

  console.log("Order | Mass roll Ctrl+R registered (KeyboardEvent.code=KeyR)");
}
