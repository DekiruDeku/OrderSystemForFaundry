/**
 * OrderPlayerRating.js — Player Reaction Buttons (Foundry VTT v11)
 *
 * Adds four small buttons to the bottom-right of the screen, left of the sidebar:
 *   👍  — "(Имя персонажа) — одобряет это."
 *   👎  — "(Имя персонажа) — не одобряет это."
 *   💭  — "(Имя персонажа) — запомнит это."
 *   !   — "(Имя персонажа) — хочет что-то сказать!"
 *
 * Styled to match the Order system UI/UX (dark panels, cyan accents, ALS_HAUSS fonts).
 * Fully self-contained: registers its own hooks, no changes to Order.js needed.
 */

const MODULE_LABEL = "OrderPlayerRating";

Hooks.once("ready", () => {
  try {
    _injectRatingStyles();
    _injectRatingButtons();
    _positionRatingPanel();
    // Переставляем панель при сворачивании сайдбара и изменении окна (v13 layout)
    Hooks.on("collapseSidebar", () => setTimeout(_positionRatingPanel, 350));
    window.addEventListener("resize", _positionRatingPanel);
    Hooks.on("renderChatLog", () => setTimeout(_positionRatingPanel, 100));
    setInterval(_positionRatingPanel, 3000);
    setTimeout(_positionRatingPanel, 1000);
    console.log(`${MODULE_LABEL} | Reaction buttons injected`);
  } catch (err) {
    console.error(`${MODULE_LABEL} | Failed to inject buttons`, err);
  }
});

/**
 * Позиционирование панели реакций относительно фактического интерфейса:
 * прижимаемся к левому краю сайдбара; при свёрнутом сайдбаре (v13) поднимаемся
 * над плавающим полем ввода чата, чтобы не перекрывать его.
 */
function _positionRatingPanel() {
  const el = document.getElementById("order-player-rating");
  if (!el) return;
  let right = 310;
  let bottom = 14;
  try {
    const sidebar = document.getElementById("sidebar");
    const sb = sidebar?.getBoundingClientRect?.();
    const expanded = sb && sb.width > 80 && sb.left < window.innerWidth;
    if (expanded) {
      right = Math.max(20, Math.round(window.innerWidth - sb.left + 10));
    } else {
      // Свёрнутый сайдбар (v13): поле ввода чата плавает внизу справа —
      // ставим панель СЛЕВА от него, выровняв по вертикали (не перекрывая ни поле, ни колонку иконок).
      const fr = _findFloatingChatRect();
      if (fr) {
        right = Math.max(20, Math.round(window.innerWidth - fr.left + 12));
        bottom = Math.max(10, Math.round(window.innerHeight - fr.bottom + Math.max(0, (fr.height - 44) / 2)));
      } else {
        right = 110;
        bottom = 14;
      }
    }
  } catch (e) { /* ignore */ }
  el.style.right = right + "px";
  el.style.bottom = bottom + "px";
}

/** Найти прямоугольник плавающего поля ввода чата (v13, свёрнутый сайдбар). */
function _findFloatingChatRect() {
  const isGood = (r) =>
    r && r.width > 120 && r.height > 20 && r.height < 160 &&
    r.top > window.innerHeight * 0.55 && r.right > window.innerWidth * 0.4;
  try {
    // Известные контейнеры v13
    for (const sel of ["#chat-notifications", ".chat-notifications", "#chat-message"]) {
      const el = document.querySelector(sel);
      if (el && !el.closest("#sidebar")) {
        const r = el.getBoundingClientRect();
        if (isGood(r)) return r;
      }
    }
    // Фолбэк: любое видимое поле ввода чата вне сайдбара в правом нижнем углу
    for (const el of document.querySelectorAll("textarea, input[type='text']")) {
      if (el.closest("#sidebar")) continue;
      const cls = String(el.className || "");
      const ph = String(el.getAttribute?.("placeholder") || "");
      if (!/chat/i.test(cls) && !/message/i.test(ph + " " + String(el.id || ""))) continue;
      const r = (el.closest(".chat-form, .chat-controls, [class*='chat']") || el).getBoundingClientRect();
      if (isGood(r)) return r;
    }
  } catch (e) { /* ignore */ }
  return null;
}

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
      min-width: 38px;
      max-width: 38px;
      height: 38px;
      min-height: 38px;
      max-height: 38px;
      flex: 0 0 38px;
      box-sizing: border-box;
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

    /* Red attention button — same size as the other three */
    #order-player-rating .opr-btn[data-action="speak"] {
      border-color: rgba(220, 55, 55, 0.90);
      color: rgba(255, 80, 80, 1);
      font-size: 17px;
      font-weight: 900;
      line-height: 1;
      text-shadow: 0 0 6px rgba(255, 45, 45, 0.38);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.55) inset,
        0 0 10px rgba(220, 35, 35, 0.12);
    }

    #order-player-rating .opr-btn[data-action="speak"]:hover {
      border-color: rgba(255, 90, 90, 1);
      background: rgba(220, 35, 35, 0.12);
      box-shadow:
        0 0 0 1px rgba(255, 80, 80, 0.16) inset,
        0 0 14px rgba(255, 45, 45, 0.18);
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
    { icon: "💭", tooltip: "Запомню!",   action: "remember"   },
    { icon: "!",  tooltip: "Хочу что-то сказать!", action: "speak" }
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
      remember:   `<b>${name}</b> — запомнит это. 💭`,
      speak:      `<b>${name}</b> — хочет что-то сказать!`
    };
    text = messages[action];
  } else {
    const messages = {
      approve:    `Одобряет это. 👍`,
      disapprove: `Не одобряет это. 👎`,
      remember:   `Запомнит это. 💭`,
      speak:      `Хочет что-то сказать!`
    };
    text = messages[action];
  }

  if (!text) return;

  ChatMessage.create({
    content: text,
    style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
    speaker: ChatMessage.getSpeaker()
  });
}
