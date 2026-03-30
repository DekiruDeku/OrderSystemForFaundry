/**
 * OrderPlayerRating.js — Player Reaction Buttons (Foundry VTT v11)
 *
 * Adds three small buttons to the bottom-right of the screen, left of the sidebar:
 *   👍  — "(Имя персонажа) — одобряет это."
 *   👎  — "(Имя персонажа) — не одобряет это."
 *   💭  — "(Имя персонажа) — запомнит это."
 *
 * Styled to match the Order system UI/UX (dark panels, cyan accents, ALS_HAUSS fonts).
 * Fully self-contained: registers its own hooks, no changes to Order.js needed.
 */

const MODULE_LABEL = "OrderPlayerRating";

Hooks.once("ready", () => {
  try {
    _injectRatingStyles();
    _injectRatingButtons();
    console.log(`${MODULE_LABEL} | Reaction buttons injected`);
  } catch (err) {
    console.error(`${MODULE_LABEL} | Failed to inject buttons`, err);
  }
});

/* ----------------------------- CSS injection ------------------------------ */

function _injectRatingStyles() {
  if (document.getElementById("order-player-rating-styles")) return;

  const css = `
    /* ── Order Player Rating Panel ── */
    #order-player-rating {
      position: fixed;
      bottom: 14px;
      right: 310px;
      display: flex;
      flex-direction: row;
      gap: 0;
      z-index: 60;

      /* Panel shell — matches .os-panel look */
      background:
        radial-gradient(320px 180px at 20% 10%, rgba(56, 185, 233, 0.10), transparent 60%),
        rgba(15, 16, 19, 0.88);
      border: 1px solid rgba(238, 243, 255, 0.14);
      border-radius: 8px;
      box-shadow:
        0 6px 22px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(0, 0, 0, 0.65) inset;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 4px;
      overflow: hidden;
    }

    /* Subtle top-edge accent line */
    #order-player-rating::before {
      content: "";
      position: absolute;
      top: 0;
      left: 12px;
      right: 12px;
      height: 1px;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(81, 238, 252, 0.35) 30%,
        rgba(81, 238, 252, 0.35) 70%,
        transparent
      );
      pointer-events: none;
    }

    #order-player-rating .opr-btn {
      position: relative;
      width: 38px;
      height: 38px;
      margin: 0;
      padding: 0;

      display: inline-flex;
      align-items: center;
      justify-content: center;

      /* Order button style */
      border: 2px solid rgba(109, 154, 199, 0.65);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.42);
      color: rgba(238, 243, 255, 0.96);
      font-family: var(--os-font-body, "ALS_HAUSS_BOOK", system-ui, sans-serif);
      font-size: 17px;
      line-height: 1;
      cursor: pointer;

      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.55) inset,
        0 0 10px rgba(18, 105, 204, 0.08);

      transition:
        transform 160ms ease,
        background 160ms ease,
        border-color 160ms ease,
        box-shadow 160ms ease;
    }

    #order-player-rating .opr-btn:hover {
      transform: translateY(-2px);
      border-color: rgba(81, 238, 252, 1);
      background: rgba(81, 238, 252, 0.10);
      box-shadow:
        0 0 0 1px rgba(81, 238, 252, 0.16) inset,
        0 0 16px rgba(81, 238, 252, 0.14);
    }

    #order-player-rating .opr-btn:active {
      transform: translateY(0px);
      filter: brightness(1.08);
    }

    /* Tooltip */
    #order-player-rating .opr-btn[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.4px;
      color: rgba(238, 243, 255, 0.94);
      background: rgba(15, 16, 19, 0.94);
      border: 1px solid rgba(109, 154, 199, 0.55);
      border-radius: 5px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      z-index: 100;
    }

    /* Arrow for tooltip */
    #order-player-rating .opr-btn[data-tooltip]:hover::before {
      content: "";
      position: absolute;
      bottom: calc(100% + 3px);
      left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: rgba(109, 154, 199, 0.55);
      pointer-events: none;
      z-index: 100;
    }

    /* Collapsed sidebar: shift buttons closer to the right edge */
    #sidebar.collapsed ~ #order-player-rating,
    body.sidebar-collapsed #order-player-rating {
      right: 42px;
    }
  `;

  const style = document.createElement("style");
  style.id = "order-player-rating-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

/* ----------------------------- DOM injection ------------------------------ */

function _injectRatingButtons() {
  if (document.getElementById("order-player-rating")) return;

  const container = document.createElement("div");
  container.id = "order-player-rating";

  const buttons = [
    { icon: "👍", tooltip: "Одобряю!",  action: "approve"   },
    { icon: "👎", tooltip: "Не одобряю!", action: "disapprove" },
    { icon: "💭", tooltip: "Запомню!",   action: "remember"   }
  ];

  for (const btn of buttons) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "opr-btn";
    el.dataset.action = btn.action;
    el.dataset.tooltip = btn.tooltip;
    el.textContent = btn.icon;
    el.addEventListener("click", () => _onRatingClick(btn.action));
    container.appendChild(el);
  }

  document.body.appendChild(container);
}

/* ----------------------------- Chat message ------------------------------ */

function _getCharacterName() {
  const charName = game.user?.character?.name;
  if (charName) return charName;

  const token = canvas?.tokens?.controlled?.[0];
  if (token?.name) return token.name;

  return game.user?.name ?? "Неизвестный";
}

function _onRatingClick(action) {
  // Check client setting: show character name or not
  let showName = true;
  try {
    showName = game.settings.get("Order", "showRatingCharacterName");
  } catch (e) {
    // Setting not registered yet or other error — default to showing name
    showName = true;
  }

  const name = _getCharacterName();

  let text;
  if (showName) {
    const messages = {
      approve:    `<b>${name}</b> — одобряет это. 👍`,
      disapprove: `<b>${name}</b> — не одобряет это. 👎`,
      remember:   `<b>${name}</b> — запомнит это. 💭`
    };
    text = messages[action];
  } else {
    const messages = {
      approve:    `Одобряет это. 👍`,
      disapprove: `Не одобряет это. 👎`,
      remember:   `Запомнит это. 💭`
    };
    text = messages[action];
  }

  if (!text) return;

  ChatMessage.create({
    content: text,
    type: CONST.CHAT_MESSAGE_TYPES.EMOTE,
    speaker: ChatMessage.getSpeaker()
  });
}
