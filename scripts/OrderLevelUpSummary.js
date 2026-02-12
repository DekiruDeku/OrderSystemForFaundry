/**
 * Global Level-Up Summary (Skills/Spells)
 *
 * Shows a themed summary dialog whenever an embedded Skill/Spell item increases its system.Level,
 * regardless of the source (training, manual edit, other systems).
 */

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function getItemMaxLevelForCircle(circle) {
  const maxLevels = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
  return maxLevels[num(circle)] ?? 0;
}

function getLevelUpOptionsByCircle(circle) {
  const c = num(circle);
  const damage = { 1: 5, 2: 10, 3: 15, 4: 20 };
  const mult = { 1: 1, 2: 1, 3: 2, 4: 2 };
  const range = { 1: 1, 2: 2, 3: 3, 4: 4 };
  const aoe = { 1: 1, 2: 1, 3: 2, 4: 2 };
  const down = { 1: 1, 2: 1, 3: 2, 4: 2 };
  return {
    damage: damage[c] ?? 0,
    mult: mult[c] ?? 0,
    range: range[c] ?? 0,
    aoe: aoe[c] ?? 0,
    down: down[c] ?? 0,
  };
}

function buildLevelUpDialogContent(item, oldLevel, newLevel) {
  const circle = num(item?.system?.Circle ?? 0);
  const max = getItemMaxLevelForCircle(circle);
  const opts = getLevelUpOptionsByCircle(circle);
  const gained = Math.max(1, num(newLevel) - num(oldLevel));

  const img = item?.img ? `<img class="os-levelup-img" src="${item.img}" alt="${item.name}">` : "";
  const gainedLine = gained > 1
    ? `<div class="os-levelup-gained">Получено <strong>${gained}</strong> уров${gained === 2 ? "ня" : (gained >= 3 && gained <= 4 ? "ня" : "ней")} — выбери <strong>${gained}</strong> улучшени${gained === 1 ? "е" : (gained >= 2 && gained <= 4 ? "я" : "й")} (по одному за уровень).</div>`
    : "";

  let listBlock = "";
  if (circle >= 1 && circle <= 4) {
    const maxMult = max || "?";
    listBlock = `
      <div class="os-levelup-subtitle">Выбери одно улучшение (обычно при повышении уровня):</div>
      <ul class="os-levelup-list">
        <li>+${opts.damage} к одному значению урона/исцеления/щита</li>
        <li>+${opts.mult} к одному множителю характеристики (не выше макс. уровня ${maxMult})</li>
        <li>+${opts.range} к дальности (в клетках)</li>
        <li>+${opts.aoe} к зоне поражения (в клетках)</li>
        <li>+1 к сложности проверки для врагов</li>
        <li>−${opts.down} к порогу срабатывания эффекта / условию применения</li>
        <li>+1 к выбранному бонусу (например, блок/броня/и т.д.)</li>
      </ul>
      <div class="os-levelup-note">Внести в лист руками с помощью мастера</div>
    `;
  } else {
    listBlock = `
      <div class="os-levelup-note">Круг ${circle}: список улучшений для левел-апа задаётся правилами/мастером вручную.</div>
    `;
  }

  return `
    <div class="os-levelup">
      <div class="os-levelup-header">
        ${img}
        <div class="os-levelup-headtext">
          <div class="os-levelup-title">${item.name} — новый уровень!</div>
          <div class="os-levelup-meta">Круг ${circle} · Уровень ${oldLevel} → <strong>${newLevel}</strong></div>
        </div>
      </div>
      ${gainedLine}
      <div class="os-levelup-divider"></div>
      ${listBlock}
    </div>
  `;
}

function isWatchedItem(item) {
  if (!item) return false;
  // Only embedded items on an Actor (avoid directory items).
  if (!item.parent) return false;
  return item.type === "Skill" || item.type === "Spell";
}

export function registerOrderLevelUpSummaryHooks() {
  // Capture old levels per update batch.
  Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    try {
      if (!isWatchedItem(item)) return;
      const newLevel = foundry.utils.getProperty(changes, "system.Level");
      if (newLevel === undefined) return;
      options.osLevelUp = options.osLevelUp || {};
      options.osLevelUp[item.id] = {
        oldLevel: num(item?.system?.Level ?? 0),
      };
    } catch (e) {
      // noop
    }
  });

  Hooks.on("updateItem", (item, changes, options, userId) => {
    try {
      if (!isWatchedItem(item)) return;
      if (userId !== game.user?.id) return;

      const stored = options?.osLevelUp?.[item.id];
      if (!stored) return;

      const oldLevel = num(stored.oldLevel ?? 0);
      const newLevel = num(item?.system?.Level ?? 0);
      if (newLevel <= oldLevel) return;

      const content = buildLevelUpDialogContent(item, oldLevel, newLevel);

      new Dialog(
        {
          title: `Повышение уровня: ${item.name}`,
          content,
          buttons: {
            ok: { label: "ОК" },
          },
          default: "ok",
        },
        {
          classes: ["os-levelup-dialog"],
          width: 520,
          resizable: true,
        }
      ).render(true);
    } catch (e) {
      console.error("Order | LevelUpSummary hook error", e);
    }
  });
}
