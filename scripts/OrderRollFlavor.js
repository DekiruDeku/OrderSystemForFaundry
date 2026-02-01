// scripts/OrderRollFlavor.js

export function modeLabel(rollMode) {
  if (rollMode === "adv") return "Преимущество";
  if (rollMode === "dis") return "Помеха";
  return "Обычный";
}

export function formatSigned(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : `${v}`;
}

export function buildCombatRollFlavor({
  scene,
  action = "Бросок",
  source = null,
  rollMode = "normal",
  characteristic = null,
  applyModifiers = true,
  manualMod = 0,
  effectsMod = 0,
  extra = [],
  isCrit = false
} = {}) {
  const parts = [];

  const sceneText = (scene && String(scene).trim()) ? String(scene).trim() : "Бой";
  parts.push(sceneText);

  parts.push(String(action));
  if (source) parts.push(String(source));

  parts.push(modeLabel(rollMode));

  if (characteristic) {
    parts.push(applyModifiers ? `моды: да (${characteristic})` : `моды: нет (${characteristic})`);
  } else {
    parts.push("без характеристики");
  }

  const eff = Number(effectsMod) || 0;
  if (eff) parts.push(`эффекты: ${formatSigned(eff)}`);

  const man = Number(manualMod) || 0;
  if (man) parts.push(`ручн. мод: ${formatSigned(man)}`);

  if (Array.isArray(extra)) for (const e of extra) if (e) parts.push(String(e));

  if (isCrit) parts.push("КРИТ 20");

  return parts.join(" | ");
}
