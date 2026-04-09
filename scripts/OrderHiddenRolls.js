const ORDER_HIDE_ROLL_FLAG = "hideRollBonuses";
const ORDER_HIDDEN_MESSAGE_FLAG_PATH = "Order.hiddenRollBonuses";

function _normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function _getActorFlagValue(actor) {
  try {
    return !!actor?.getFlag?.("Order", ORDER_HIDE_ROLL_FLAG);
  } catch (_err) {
    return false;
  }
}

function _collectActorCandidates(actor) {
  const list = [];
  const push = (value) => {
    if (!value || list.includes(value)) return;
    list.push(value);
  };

  push(actor);
  push(actor?.actor);
  push(actor?.baseActor);
  push(actor?.parent?.actor);
  push(actor?.token?.actor);
  push(actor?.document?.actor);

  const actorId = String(actor?.id || actor?._id || "").trim();
  if (actorId) push(game?.actors?.get?.(actorId));

  return list;
}

function _resolveActorFromSpeaker(speaker = {}) {
  try {
    const tokenId = String(speaker?.token || "").trim();
    if (tokenId) {
      const sceneId = String(speaker?.scene || canvas?.scene?.id || "").trim();
      const scene = (sceneId && game?.scenes?.get?.(sceneId)) || canvas?.scene || null;
      const sceneToken = scene?.tokens?.get?.(tokenId);
      const sceneActor = sceneToken?.actor;
      if (sceneActor) return sceneActor;

      const placeableActor = canvas?.tokens?.get?.(tokenId)?.actor;
      if (placeableActor) return placeableActor;
    }

    const actorId = String(speaker?.actor || "").trim();
    if (actorId) {
      const actor = game?.actors?.get?.(actorId);
      if (actor) return actor;
    }
  } catch (err) {
    console.warn("OrderHiddenRolls | Failed to resolve actor from speaker", err);
  }
  return null;
}

export function shouldHideOrderRollBonuses(actor) {
  try {
    for (const candidate of _collectActorCandidates(actor)) {
      if (_getActorFlagValue(candidate)) return true;
    }
    return false;
  } catch (_err) {
    return false;
  }
}

export function getOrderHideRollFlag(actor) {
  return shouldHideOrderRollBonuses(actor);
}

function _shouldHideBySpeaker(speaker = {}) {
  return shouldHideOrderRollBonuses(_resolveActorFromSpeaker(speaker));
}

function _extractDiceOnlyFormulaFromText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const matches = raw.match(/\d*d\d+(?:kh\d+|kl\d+|k\d+|x\d+|r(?:[<>]=?)?\d+|cs(?:[<>]=?)?\d+|cf(?:[<>]=?)?\d+|min\d+|max\d+|!+|p(?:[<>]=?)?\d+|s)?/gi);
  return Array.isArray(matches) ? matches.join(" + ") : "";
}

function _sectionHasDice(section) {
  if (!section) return false;
  return !!section.querySelector('.dice-rolls li.roll, li.roll, .die, .dice');
}

function _sanitizeTooltipParts(diceRollEl) {
  const tooltip = diceRollEl?.querySelector?.('.dice-tooltip');
  if (!tooltip) return;

  const sections = Array.from(tooltip.querySelectorAll('.tooltip-part'));
  if (!sections.length) return;

  let keptSections = 0;
  for (const section of sections) {
    if (!_sectionHasDice(section)) {
      section.remove();
      continue;
    }

    keptSections += 1;
    const partFormula = section.querySelector('.part-formula');
    if (partFormula) {
      const clean = _extractDiceOnlyFormulaFromText(partFormula.textContent) || _extractDiceOnlyFormulaFromText(diceRollEl.querySelector('.dice-formula')?.textContent);
      if (clean) partFormula.textContent = clean;
    }
  }

  if (!keptSections) tooltip.remove();
}

function _getNatResult(diceRollEl) {
  const rolls = Array.from(diceRollEl?.querySelectorAll?.('.dice-tooltip li.roll') || []);
  if (!rolls.length) return null;

  const d20Rolls = rolls.filter((li) => /(^|\s)d20(\s|$)/i.test(String(li.className || "")));
  if (!d20Rolls.length) return null;

  let chosen = d20Rolls.find((li) => li.classList.contains('active') && !li.classList.contains('discarded'));
  if (!chosen) chosen = d20Rolls.find((li) => !li.classList.contains('discarded'));
  if (!chosen) chosen = d20Rolls[0];

  const value = Number(String(chosen.textContent || "").trim());
  if (value === 1) {
    return { total: '1', note: 'Критическая неудача' };
  }
  if (value === 20) {
    return { total: '20', note: 'Критический успех' };
  }
  return null;
}

function _sanitizeSingleDiceRoll(diceRollEl) {
  if (!diceRollEl) return;

  _sanitizeTooltipParts(diceRollEl);

  const formulaEl = diceRollEl.querySelector('.dice-formula');
  if (formulaEl) {
    const cleanFormula = _extractDiceOnlyFormulaFromText(formulaEl.textContent) || 'Скрытый бросок';
    formulaEl.textContent = cleanFormula;
  }

  const natResult = _getNatResult(diceRollEl);
  const oldNote = diceRollEl.querySelector('.order-hidden-roll-note');
  if (oldNote) oldNote.remove();

  if (natResult) {
    const totalEl = diceRollEl.querySelector('.dice-total');
    if (totalEl) totalEl.textContent = natResult.total;

    const noteEl = document.createElement('div');
    noteEl.className = 'order-hidden-roll-note';
    noteEl.textContent = natResult.note;
    if (totalEl?.parentElement) totalEl.insertAdjacentElement('afterend', noteEl);
    else diceRollEl.appendChild(noteEl);
  }
}

function _cleanFormulaText(text) {
  let cleaned = String(text ?? "");
  cleaned = cleaned.replace(/\s*\|\s*формула\s*:[^|]+/gi, "");
  cleaned = cleaned.replace(/\s*\([^)]*формула[^)]*\)\s*/gi, " ");
  cleaned = cleaned.replace(/\s*\|\s*моды\s*:[^|]+\(формула\)/gi, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

function _stripFormulaHints(root) {
  const selectors = ['p', 'div', 'span', 'li'];
  for (const selector of selectors) {
    const nodes = Array.from(root.querySelectorAll(selector));
    for (const node of nodes) {
      const text = _normalizeText(node.textContent);
      if (!text) continue;

      if (/^Формула броска:/i.test(text) || /^Формула воздействия:/i.test(text)) {
        node.remove();
        continue;
      }

      if (/формула\s*:/i.test(text) || /\(формула\)/i.test(text)) {
        const cleaned = _cleanFormulaText(text);
        if (!cleaned) {
          node.remove();
          continue;
        }
        if (cleaned !== text) {
          node.textContent = cleaned;
        }
      }

      if (node.classList?.contains('dice-flavor')) {
        if (/^Бросок с бонусами/i.test(text)) {
          node.textContent = 'Бросок';
          continue;
        }
        if (/модификатор|формула/i.test(text)) {
          node.textContent = _cleanFormulaText(text)
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim() || 'Бросок';
        }
      }
    }
  }
}

export function sanitizeHiddenRollContent(content = "") {
  const raw = String(content ?? "");
  if (!raw) return raw;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = raw;

  _stripFormulaHints(wrapper);
  const diceRolls = Array.from(wrapper.querySelectorAll('.dice-roll'));
  for (const diceRollEl of diceRolls) _sanitizeSingleDiceRoll(diceRollEl);

  return wrapper.innerHTML;
}

function _messageHasHiddenFlag(source = {}) {
  return !!(source?.flags?.Order?.hiddenRollBonuses);
}

function _markMessageAsHidden(source = {}) {
  source.flags ??= {};
  source.flags.Order ??= {};
  source.flags.Order.hiddenRollBonuses = true;
}

function _sanitizeMessageSource(doc, source = {}) {
  const shouldHide = _messageHasHiddenFlag(source)
    || _shouldHideBySpeaker(source?.speaker ?? doc?.speaker ?? {});

  if (!shouldHide) return;

  const original = String(source?.content ?? doc?.content ?? "");
  if (!original) return;

  const sanitized = sanitizeHiddenRollContent(original);
  if (sanitized && sanitized !== original) {
    doc.updateSource({ content: sanitized });
  }

  if (!_messageHasHiddenFlag(doc)) {
    doc.updateSource({ flags: { ...(doc.flags ?? {}), Order: { ...(doc.flags?.Order ?? {}), hiddenRollBonuses: true } } });
  }
}

function _sanitizeRenderedMessage(message, html) {
  const shouldHide = _messageHasHiddenFlag(message)
    || _shouldHideBySpeaker(message?.speaker ?? {});

  if (!shouldHide) return;

  const root = html?.[0] ?? html;
  if (!root) return;

  const contentRoot = root.querySelector?.('.message-content') || root;
  const original = String(contentRoot.innerHTML || "");
  if (!original) return;

  const sanitized = sanitizeHiddenRollContent(original);
  if (sanitized && sanitized !== original) {
    contentRoot.innerHTML = sanitized;
  }
}

let _orderHiddenRollPatchesApplied = false;

function _patchChatMessageCreate() {
  if (ChatMessage.__orderHiddenRollCreateWrapped) return;
  ChatMessage.__orderHiddenRollCreateWrapped = true;

  const originalCreate = ChatMessage.create.bind(ChatMessage);
  ChatMessage.create = async function orderHiddenRollCreate(data = {}, options = {}) {
    try {
      const shouldHide = _messageHasHiddenFlag(data) || _shouldHideBySpeaker(data?.speaker ?? {});
      if (shouldHide) {
        const clone = foundry.utils.deepClone(data);
        _markMessageAsHidden(clone);
        if (typeof clone.content === 'string' && clone.content) {
          clone.content = sanitizeHiddenRollContent(clone.content);
        }
        return await originalCreate(clone, options);
      }
    } catch (err) {
      console.warn('OrderHiddenRolls | ChatMessage.create patch failed', err);
    }
    return await originalCreate(data, options);
  };
}

function _patchRollToMessage() {
  if (Roll.prototype.__orderHiddenRollToMessageWrapped) return;
  Roll.prototype.__orderHiddenRollToMessageWrapped = true;

  const originalToMessage = Roll.prototype.toMessage;
  Roll.prototype.toMessage = async function orderHiddenRollToMessage(messageData = {}, options = {}) {
    try {
      if (_shouldHideBySpeaker(messageData?.speaker ?? {})) {
        const clone = foundry.utils.deepClone(messageData ?? {});
        _markMessageAsHidden(clone);
        return await originalToMessage.call(this, clone, options);
      }
    } catch (err) {
      console.warn('OrderHiddenRolls | Roll.toMessage patch failed', err);
    }
    return await originalToMessage.call(this, messageData, options);
  };
}

export function registerOrderHiddenRollHooks() {
  if (_orderHiddenRollPatchesApplied) return;
  _orderHiddenRollPatchesApplied = true;

  _patchChatMessageCreate();
  _patchRollToMessage();

  Hooks.on('preCreateChatMessage', (doc, data) => {
    try {
      _sanitizeMessageSource(doc, data);
    } catch (err) {
      console.warn('OrderHiddenRolls | preCreateChatMessage sanitize failed', err);
    }
  });

  Hooks.on('renderChatMessage', (message, html) => {
    try {
      _sanitizeRenderedMessage(message, html);
    } catch (err) {
      console.warn('OrderHiddenRolls | renderChatMessage sanitize failed', err);
    }
  });
}
