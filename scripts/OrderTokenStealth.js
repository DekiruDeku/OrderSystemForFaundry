/**
 * OrderTokenStealth.js — Token Stealth Hide feature (Foundry VTT v11)
 *
 * Adds a "Спрятать токен" button to the Token HUD (right-click on token).
 * When activated:
 *   1. Token becomes invisible to all players EXCEPT the owner and GM.
 *   2. Token appears semi-transparent (alpha 0.5) to owner and GM.
 *   3. Attack dialogs auto-check "Скрытная атака" / "Скрытая атака" checkboxes.
 *
 * Uses flag: flags.Order.stealthHidden (boolean)
 *
 * Fully self-contained: loaded via system.json esmodules. No changes to other scripts needed.
 */

const FLAG_SCOPE  = "Order";
const FLAG_KEY    = "stealthHidden";
const STEALTH_ALPHA = 0.5;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function isStealthHidden(tokenDoc) {
  try {
    return !!tokenDoc?.getFlag(FLAG_SCOPE, FLAG_KEY);
  } catch {
    return false;
  }
}

/**
 * Check if the current user should be able to see a stealth-hidden token.
 */
function canSeeStealthToken(tokenDoc) {
  if (game.user.isGM) return true;
  if (tokenDoc?.isOwner) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOGGLE
   ═══════════════════════════════════════════════════════════════════════════ */

async function toggleStealthHidden(tokenDoc) {
  if (!tokenDoc) return;
  const current = isStealthHidden(tokenDoc);
  await tokenDoc.setFlag(FLAG_SCOPE, FLAG_KEY, !current);
}

/* ═══════════════════════════════════════════════════════════════════════════
   VISIBILITY OVERRIDE — wrap Token.prototype.isVisible
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.once("init", () => {
  try {
    // Find the original isVisible getter on Token.prototype (Foundry v11)
    const descriptor = Object.getOwnPropertyDescriptor(Token.prototype, "isVisible");
    if (!descriptor || !descriptor.get) {
      console.warn("OrderTokenStealth | Token.isVisible getter not found — skipping override.");
      return;
    }

    const _origGet = descriptor.get;

    Object.defineProperty(Token.prototype, "isVisible", {
      get() {
        // If our stealth flag is set, override visibility logic
        if (isStealthHidden(this.document)) {
          return canSeeStealthToken(this.document);
        }
        // Otherwise use Foundry's default logic
        return _origGet.call(this);
      },
      configurable: true,
      enumerable: false
    });

    console.log("OrderTokenStealth | Token.isVisible wrapped successfully.");
  } catch (err) {
    console.error("OrderTokenStealth | Failed to wrap Token.isVisible:", err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   VISUAL: Semi-transparent token for owner / GM
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.on("refreshToken", (token) => {
  try {
    if (!token?.document) return;

    if (isStealthHidden(token.document)) {
      if (canSeeStealthToken(token.document)) {
        // Make it semi-transparent so owner/GM sees it's hidden
        token.alpha = STEALTH_ALPHA;
      } else {
        // Shouldn't normally reach here (isVisible would already be false)
        // but just in case — hide it
        token.alpha = 0;
      }
    }
    // If NOT stealth-hidden, do nothing — let Foundry manage alpha normally
  } catch (err) {
    // Silently ignore
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   SYNC: When flag changes — refresh perception for all clients
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
  try {
    const flagPath = `flags.${FLAG_SCOPE}.${FLAG_KEY}`;
    if (!foundry.utils.hasProperty(changes, flagPath)) return;

    const token = tokenDoc.object;
    if (token) {
      // Force visibility recalculation
      token.visible = token.isVisible;
      token.refresh();
    }

    // Refresh perception for vision-dependent scenes
    if (canvas?.perception) {
      canvas.perception.update({ refreshVision: true, refreshLighting: true });
    }
  } catch (err) {
    console.warn("OrderTokenStealth | updateToken handler error:", err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN HUD BUTTON — appears in the right column of the Token HUD
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.on("renderTokenHUD", (hud, html, data) => {
  try {
    const tokenDoc = hud?.object?.document;
    if (!tokenDoc) return;

    // Only show the button to token owner or GM
    if (!tokenDoc.isOwner && !game.user.isGM) return;

    const hidden = isStealthHidden(tokenDoc);
    const title   = hidden ? "Показать токен" : "Спрятать токен";
    const icon    = hidden ? "fa-eye" : "fa-eye-slash";
    const active  = hidden ? " active" : "";

    const btnHtml = `<div class="control-icon${active}" data-action="order-stealth-hide" title="${title}">
      <i class="fas ${icon}"></i>
    </div>`;

    const $btn = $(btnHtml);

    $btn.on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await toggleStealthHidden(tokenDoc);

      // Re-render the HUD so button state updates
      hud.render(true);
    });

    // Append to the right column of the Token HUD
    html.find(".col.right").append($btn);
  } catch (err) {
    console.error("OrderTokenStealth | renderTokenHUD error:", err);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-CHECK "Скрытная атака" IN ATTACK DIALOGS
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.on("renderDialog", (dialog, html) => {
  try {
    // Only auto-check if the currently controlled token is stealth-hidden
    const controlled = canvas?.tokens?.controlled?.[0];
    if (!controlled) return;
    if (!isStealthHidden(controlled.document)) return;

    // Melee attack dialog uses #stealthAttack
    const $stealthCheck = html.find("#stealthAttack");
    if ($stealthCheck.length && !$stealthCheck.prop("checked")) {
      $stealthCheck.prop("checked", true);
    }

    // Ranged attack dialog uses #hiddenAttack
    const $hiddenCheck = html.find("#hiddenAttack");
    if ($hiddenCheck.length && !$hiddenCheck.prop("checked")) {
      $hiddenCheck.prop("checked", true);
    }
  } catch (err) {
    // Silently ignore — don't break other dialogs
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   KEYBINDING (optional): Ctrl+H to toggle stealth on selected token
   ═══════════════════════════════════════════════════════════════════════════ */

Hooks.once("ready", () => {
  try {
    game.keybindings?.register?.(FLAG_SCOPE, "toggleTokenStealth", {
      name: "Спрятать / Показать токен",
      hint: "Переключает режим скрытности на выбранном токене (видимость только для владельца и ГМа).",
      editable: [{ key: "KeyH", modifiers: ["Control"] }],
      onDown: () => {
        const token = canvas?.tokens?.controlled?.[0];
        if (!token?.document) return;
        if (!token.document.isOwner && !game.user.isGM) return;
        toggleStealthHidden(token.document);
      },
      restricted: false,
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
  } catch (err) {
    console.warn("OrderTokenStealth | Keybinding registration failed (non-critical):", err);
  }
});
