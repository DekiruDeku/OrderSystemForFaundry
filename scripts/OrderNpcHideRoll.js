/**
 * OrderNpcHideRoll.js — Hide roll bonuses for NPC actors (Foundry VTT v11)
 *
 * When an NPC actor has flags.Order.hideRollBonuses === true,
 * ALL dice rolls from that actor are displayed with hidden formula/bonus details.
 * Natural 1 and 20 are always announced.
 *
 * Works for: characteristic rolls, spells, skills, weapons, consumables, etc.
 *
 * Approach: renderChatMessage hook modifies the rendered HTML DOM.
 */

const MODULE = "OrderNpcHideRoll";

function _getActorFromMessage(message) {
  try {
    const actorId = message?.speaker?.actor;
    if (!actorId) return null;
    return game.actors?.get(actorId) ?? null;
  } catch { return null; }
}

function _shouldHide(message) {
  const actor = _getActorFromMessage(message);
  if (!actor) return false;
  if (actor.type !== "NPC") return false;
  return !!actor.getFlag("Order", "hideRollBonuses");
}

/**
 * Strip formula to just the d20 component.
 *  "2d20kh1 + 5 + 3 - 1"  →  "2d20kh1"
 *  "1d20 + 12"             →  "1d20"
 */
function _stripToD20(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(\d*d20(?:k[hl]\d*)?)/i);
  return m ? m[1] : "1d20";
}

/**
 * Extract natural d20 from rolls stored on the message.
 */
function _getNatD20(message) {
  try {
    const rolls = message?.rolls ?? [];
    for (const roll of rolls) {
      const dice = roll?.dice ?? roll?.terms?.filter(t => t?.faces) ?? [];
      for (const die of dice) {
        if (Number(die?.faces) !== 20) continue;
        const results = die?.results ?? [];
        for (const r of results) {
          if (r.active !== false && r.discarded !== true) return Number(r.result) || null;
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

Hooks.on("renderChatMessage", (message, jqHtml, data) => {
  try {
    if (!_shouldHide(message)) return;

    // Get the raw DOM element from jQuery wrapper
    const el = jqHtml instanceof $ ? jqHtml[0] : jqHtml;
    if (!el) return;

    const nat = _getNatD20(message);

    // ═══════════════════════════════════════════════
    // 1. Foundry standard dice rolls (.dice-roll)
    // ═══════════════════════════════════════════════

    // 1a. Replace formula text (shows "1d20 + bonuses" → "1d20")
    el.querySelectorAll(".dice-formula").forEach(node => {
      node.textContent = _stripToD20(node.textContent);
    });

    // 1b. Remove dice tooltip (breakdown of each term)
    el.querySelectorAll(".dice-tooltip").forEach(node => {
      node.style.display = "none";
      node.innerHTML = "";
    });

    // 1c. Prevent tooltip from expanding on click
    el.querySelectorAll(".dice-total").forEach(node => {
      // Clone to remove event listeners
      const clone = node.cloneNode(true);
      node.parentNode?.replaceChild(clone, node);
    });

    // 1d. Add natural 1/20 badge
    if (nat === 1 || nat === 20) {
      const label = nat === 1 ? "ЧИСТАЯ 1" : "ЧИСТАЯ 20";
      const color = nat === 1 ? "#ff3b3b" : "#00cc44";
      const totals = el.querySelectorAll(".dice-total");
      const lastTotal = totals[totals.length - 1];
      if (lastTotal) {
        const badge = document.createElement("div");
        badge.style.cssText = `text-align:center; font-weight:700; color:${color}; font-size:13px; margin-top:2px;`;
        badge.textContent = `[${label}]`;
        lastTotal.insertAdjacentElement("afterend", badge);
      }
    }

    // ═══════════════════════════════════════════════
    // 2. Flavor text (often reveals modifier info)
    // ═══════════════════════════════════════════════

    el.querySelectorAll(".flavor-text, .dice-flavor").forEach(node => {
      const text = (node.textContent || "").trim();
      // OrderRollFlavor pipe-separated format: keep only first 2 parts
      if (text.includes(" | ")) {
        const parts = text.split(" | ").map(s => s.trim());
        // Keep scene + action, strip everything about mods/characteristics
        const safe = parts.filter(p => {
          const lower = p.toLowerCase();
          return !lower.includes("моды:")
            && !lower.includes("эффекты:")
            && !lower.includes("ручн.")
            && !lower.includes("формула:")
            && !lower.includes("без характеристики")
            && !/^(strength|dexterity|stamina|accuracy|will|knowledge|charisma|seduction|leadership|faith|medicine|magic|stealth)/i.test(lower)
            && !/характеристик/i.test(lower);
        });
        node.textContent = safe.length ? safe.join(" | ") : parts[0] || "Бросок";
      }
      // Old-style flavor mentioning bonuses
      else if (/бонус|модификатор/i.test(text) && !/чистая/i.test(text)) {
        node.textContent = "Бросок";
      }
    });

    // ═══════════════════════════════════════════════
    // 3. System custom messages (spells/skills/weapons)
    // ═══════════════════════════════════════════════

    // 3a. Hide the order-roll-flavor line (detailed roll info)
    el.querySelectorAll(".order-roll-flavor").forEach(node => {
      node.style.display = "none";
    });

    // 3b. Hide inline-roll displays within item/attack details
    el.querySelectorAll(".item-details .inline-roll, .attack-details .inline-roll").forEach(node => {
      node.style.display = "none";
    });

    // 3c. In system messages, hide paragraphs that contain formula/mod details
    el.querySelectorAll(".item-details p, .attack-details p").forEach(node => {
      const text = node.textContent || "";
      // Hide lines containing mod/formula metadata
      if (/моды.*да|моды.*нет|без характеристики|формула:|характеристика.*моды/i.test(text)) {
        node.style.display = "none";
      }
    });

  } catch (err) {
    console.warn(`${MODULE} | renderChatMessage error`, err);
  }
});

Hooks.once("ready", () => {
  console.log(`${MODULE} | Loaded — renderChatMessage hook active`);
});
