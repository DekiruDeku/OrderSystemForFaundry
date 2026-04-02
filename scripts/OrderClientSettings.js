/**
 * OrderClientSettings.js — Client-side visual settings (Foundry VTT v11)
 *
 * Registers client-scoped settings visible in System Settings:
 *   1. enableSheetAnimations    — toggle CSS animations on character sheets (default: true)
 *   2. enableWindowTransparency — toggle backdrop-filter / transparency on ALL windows (default: true)
 *   3. showRatingCharacterName  — show character name on approve/disapprove/remember (default: true)
 *   4. enableTokenHud           — show/hide the Token HUD panels (default: true)
 *   5. alwaysShowCooldownIcon   — always show cooldown reset icon in skills tab (default: false)
 *
 * Body CSS classes applied:
 *   - body.order-no-animations        (when animations OFF)
 *   - body.order-no-transparency      (when transparency OFF)
 *   - body.order-no-token-hud         (when token HUD OFF)
 *
 * Fully self-contained: loaded via system.json esmodules. No changes to Order.js needed.
 */

const SETTINGS_LABEL = "OrderClientSettings";

/* ─────────────────────────── INIT: register settings ─────────────────────── */

Hooks.once("init", () => {
  try {
    game.settings.register("Order", "enableSheetAnimations", {
      name: "Анимации на листе персонажа",
      hint: "Включает или отключает все CSS-анимации на листах персонажей (полосы, свечения, блеск ресурсов, мерцания и т.д.).",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => _applyAnimationClass(value)
    });

    game.settings.register("Order", "enableWindowTransparency", {
      name: "Прозрачность окон",
      hint: "Включает или отключает эффект прозрачности (backdrop-filter / blur) на ВСЕХ окнах системы, включая диалоги, листы предметов, листы персонажей и всплывающие окна.",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => _applyTransparencyClass(value)
    });

    game.settings.register("Order", "showRatingCharacterName", {
      name: "Имя персонажа в реакциях",
      hint: "Показывать имя персонажа в сообщениях «Одобряет / Не одобряет / Запомнит это».",
      scope: "client",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register("Order", "enableTokenHud", {
      name: "Token HUD",
      hint: "Показывать или скрывать Token HUD (панель токена с характеристиками, ресурсами, инвентарём и дебаффами).",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: (value) => _applyTokenHudClass(value)
    });

    game.settings.register("Order", "alwaysShowCooldownIcon", {
      name: "Всегда показывать иконку перезарядки",
      hint: "Если включено, иконка часов в разделе «Способности» отображается всегда, даже если активных перезарядок нет. При наведении будет подсказка «Нет перезарядок».",
      scope: "client",
      config: true,
      type: Boolean,
      default: false
    });

    console.log(`${SETTINGS_LABEL} | Settings registered`);
  } catch (err) {
    console.error(`${SETTINGS_LABEL} | Failed to register settings`, err);
  }
});

/* ─────────────────────────── READY: apply classes ────────────────────────── */

Hooks.once("ready", () => {
  try {
    const animations = game.settings.get("Order", "enableSheetAnimations");
    const transparency = game.settings.get("Order", "enableWindowTransparency");
    const tokenHud = game.settings.get("Order", "enableTokenHud");

    _applyAnimationClass(animations);
    _applyTransparencyClass(transparency);
    _applyTokenHudClass(tokenHud);

    console.log(`${SETTINGS_LABEL} | Body classes applied (animations=${animations}, transparency=${transparency}, tokenHud=${tokenHud})`);
  } catch (err) {
    console.error(`${SETTINGS_LABEL} | Failed to apply body classes`, err);
  }
});

/* ─────────────────────────── Helpers ─────────────────────────────────────── */

function _applyAnimationClass(enabled) {
  try {
    document.body?.classList?.toggle("order-no-animations", !enabled);
  } catch (e) { /* noop */ }
}

function _applyTransparencyClass(enabled) {
  try {
    document.body?.classList?.toggle("order-no-transparency", !enabled);
  } catch (e) { /* noop */ }
}

function _applyTokenHudClass(enabled) {
  try {
    document.body?.classList?.toggle("order-no-token-hud", !enabled);
  } catch (e) { /* noop */ }
}
