const FLAG_SCOPE = "Order";
const FLAG_KEY = "skillCooldowns";

/**
 * Семантика:
 * - cooldown=0 -> можно каждый ход
 * - cooldown=1 -> нельзя в следующий раунд, доступно через раунд
 * => availableFromRound = currentRound + cooldown + 1
 */

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function getCombatState() {
  const c = game.combat;
  if (!c) return null;
  const round = Number(c.round ?? 0) || 0;
  return { combat: c, combatId: c.id, round };
}

export async function markSkillUsed({ actor, skillItem }) {
  if (!actor || !skillItem) return;

  const cs = getCombatState();
  if (!cs) return; // вне боя не отслеживаем

  const cooldown = Number(getSystem(skillItem)?.Cooldown ?? 0) || 0;
  if (cooldown <= 0) return;

  const availableFromRound = cs.round + cooldown + 1;

  const cur = foundry.utils.duplicate(actor.getFlag(FLAG_SCOPE, FLAG_KEY) || {});
  cur[skillItem.id] = {
    combatId: cs.combatId,
    availableFromRound
  };

  await actor.setFlag(FLAG_SCOPE, FLAG_KEY, cur);
}

export function getSkillCooldownView({ actor, skillItem }) {
  const cs = getCombatState();
  if (!actor || !skillItem || !cs) return { inCombat: false, active: false };

  const all = actor.getFlag(FLAG_SCOPE, FLAG_KEY) || {};
  const entry = all?.[skillItem.id];
  if (!entry) return { inCombat: true, active: false };

  if (entry.combatId !== cs.combatId) return { inCombat: true, active: false };

  const availableFromRound = Number(entry.availableFromRound ?? 0) || 0;
  const active = cs.round < availableFromRound;

  const remainingRounds = active ? Math.max(0, availableFromRound - cs.round) : 0;

  if (!cs) return { inCombat: false, active: false };
  return {
    inCombat: true,
    active,
    availableFromRound,
    remainingRounds
  };
}

/* =========================================================================
   NEW: Cooldown reset helpers (icon + dialog in skills tab)
   ========================================================================= */

/**
 * Returns an array of { skillId, name, remainingRounds } for every skill/perk
 * on this actor that currently has an active cooldown in the current combat.
 */
export function getActiveCooldownsList(actor) {
  if (!actor) return [];
  const cs = getCombatState();
  if (!cs) return [];

  const all = actor.getFlag(FLAG_SCOPE, FLAG_KEY) || {};
  const result = [];

  for (const [skillId, entry] of Object.entries(all)) {
    if (!entry) continue;
    if (entry.combatId !== cs.combatId) continue;

    const availableFromRound = Number(entry.availableFromRound ?? 0) || 0;
    if (cs.round >= availableFromRound) continue; // already available

    const item = actor.items.get(skillId);
    const name = item?.name ?? `(id: ${skillId})`;
    const remainingRounds = Math.max(0, availableFromRound - cs.round);

    result.push({ skillId, name, remainingRounds });
  }

  return result;
}

/**
 * Reset cooldown for a single skill on the given actor.
 */
export async function resetSkillCooldown(actor, skillId) {
  if (!actor || !skillId) return;
  const all = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!all || !all[skillId]) return;

  const next = foundry.utils.duplicate(all);
  delete next[skillId];

  // If nothing left, unset the flag entirely to keep things clean.
  if (Object.keys(next).length === 0) {
    await actor.unsetFlag(FLAG_SCOPE, FLAG_KEY);
  } else {
    await actor.setFlag(FLAG_SCOPE, FLAG_KEY, next);
  }
}

/**
 * Reset ALL active cooldowns on the given actor.
 */
export async function resetAllCooldowns(actor) {
  if (!actor) return;
  const all = actor.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!all) return;
  await actor.unsetFlag(FLAG_SCOPE, FLAG_KEY);
}

/**
 * Shows the cooldown-reset dialog.
 *
 * - If exactly 1 skill on cooldown → confirm dialog for that skill.
 * - If multiple skills on cooldown → choice: reset all OR pick specific one.
 */
async function _showCooldownResetDialog(actor, sheet) {
  const list = getActiveCooldownsList(actor);
  if (!list.length) {
    ui.notifications?.info?.("Нет активных перезарядок.");
    return;
  }

  // --- Case: exactly 1 cooldown ---
  if (list.length === 1) {
    const item = list[0];
    const confirmed = await Dialog.confirm({
      title: "Сброс перезарядки",
      content: `<p>Обнулить перезарядку у способности <strong>${item.name}</strong>?</p>
                <p style="opacity:0.7;font-size:12px;">Осталось раундов: ${item.remainingRounds}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    if (confirmed) {
      await resetSkillCooldown(actor, item.skillId);
      ui.notifications?.info?.(`Перезарядка «${item.name}» сброшена.`);
      sheet?.render(false);
    }
    return;
  }

  // --- Case: multiple cooldowns ---
  const optionsHtml = list.map(
    s => `<option value="${s.skillId}">${s.name} (осталось ${s.remainingRounds} р.)</option>`
  ).join("");

  const content = `
    <form>
      <div style="margin-bottom:8px;">
        <label>
          <input type="radio" name="reset-mode" value="all" checked />
          Сбросить перезарядку у <strong>всех</strong> способностей (${list.length})
        </label>
      </div>
      <div style="margin-bottom:8px;">
        <label>
          <input type="radio" name="reset-mode" value="single" />
          Сбросить у конкретной способности:
        </label>
        <select name="skill-id" style="width:100%;margin-top:4px;">
          ${optionsHtml}
        </select>
      </div>
    </form>
  `;

  new Dialog({
    title: "Сброс перезарядки",
    content,
    buttons: {
      ok: {
        icon: '<i class="fas fa-check"></i>',
        label: "Сбросить",
        callback: async (html) => {
          const mode = html.find('input[name="reset-mode"]:checked').val();
          if (mode === "all") {
            await resetAllCooldowns(actor);
            ui.notifications?.info?.("Все перезарядки сброшены.");
          } else {
            const skillId = html.find('select[name="skill-id"]').val();
            if (skillId) {
              const entry = list.find(s => s.skillId === skillId);
              await resetSkillCooldown(actor, skillId);
              ui.notifications?.info?.(`Перезарядка «${entry?.name ?? skillId}» сброшена.`);
            }
          }
          sheet?.render(false);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Отмена"
      }
    },
    default: "ok"
  }).render(true);
}

/* =========================================================================
   Render-hook: inject clock icon into skills tab <h1>
   ========================================================================= */

/** CSS for the cooldown-reset icon (injected once). */
let _cooldownCssInjected = false;
function _ensureCooldownResetCss() {
  if (_cooldownCssInjected) return;
  _cooldownCssInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .os-cooldown-reset-icon {
      cursor: pointer;
      margin-left: 6px;
      font-size: 0.65em;
      opacity: 0.6;
      vertical-align: middle;
      transition: opacity 140ms ease, color 140ms ease;
    }
    .os-cooldown-reset-icon:hover {
      opacity: 1;
      color: #38b9e9;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Hook handler: injects the clock icon into the skills tab on every render.
 *
 * Behaviour depends on the "alwaysShowCooldownIcon" client setting:
 *   - OFF (default): icon only appears when there are active cooldowns.
 *   - ON:            icon is always visible; when inactive it is dimmed and
 *                    the tooltip reads "Нет перезарядок".
 */
function _onRenderPlayerSheet(sheet, html) {
  const actor = sheet?.actor;
  if (!actor) return;

  const list = getActiveCooldownsList(actor);
  const hasCooldowns = list.length > 0;

  // Read the client setting (safe fallback to false if not yet registered).
  let alwaysShow = false;
  try {
    alwaysShow = !!game.settings.get("Order", "alwaysShowCooldownIcon");
  } catch (e) { /* setting not registered yet — keep default */ }

  // If no cooldowns AND not "always show" → skip entirely.
  if (!hasCooldowns && !alwaysShow) return;

  _ensureCooldownResetCss();

  // Find the <h1>Способности</h1> inside the skills tab.
  const skillsTab = html.find('#skills');
  if (!skillsTab.length) return;

  const h1 = skillsTab.find('h1').first();
  if (!h1.length) return;

  // Don't duplicate if already injected (e.g. partial re-render).
  if (h1.find('.os-cooldown-reset-icon').length) return;

  const tooltip = hasCooldowns
    ? `Сбросить перезарядку (${list.length})`
    : "Нет перезарядок";

  const icon = $(`<i class="fas fa-clock os-cooldown-reset-icon" title="${tooltip}"></i>`);

  // When no active cooldowns, make the icon visually inactive.
  if (!hasCooldowns) {
    icon.css({ opacity: "0.25", cursor: "default" });
  }

  h1.append(icon);

  icon.on('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!hasCooldowns) {
      ui.notifications?.info?.("Нет активных перезарядок.");
      return;
    }
    await _showCooldownResetDialog(actor, sheet);
  });
}

/* =========================================================================
   Hooks registration (existing + new)
   ========================================================================= */

/**
 * Чистка:
 * - если бой закончился -> сбрасываем флаг
 * - если прошло время -> можем удалить записи (не обязательно, но держит флаги чистыми)
 */
export function registerOrderSkillCooldownHooks() {
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user?.isGM) return;
    const combatId = combat?.id;

    for (const a of (game.actors?.contents ?? [])) {
      const all = a.getFlag(FLAG_SCOPE, FLAG_KEY);
      if (!all) continue;

      const next = {};
      for (const [k, v] of Object.entries(all)) {
        if (v?.combatId && v.combatId !== combatId) next[k] = v;
      }
      // проще всего просто очистить, относящееся к combatId
      await a.unsetFlag(FLAG_SCOPE, FLAG_KEY);
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM) return;
    if (!("round" in changed)) return;
    if (!game.user?.isGM) return;

    // Бой завершили (active -> false) => чистим кулдауны у всех
    if ("active" in changed && changed.active === false) {
      for (const a of (game.actors?.contents ?? [])) {
        const all = a.getFlag("Order", "skillCooldowns");
        if (all) await a.unsetFlag("Order", "skillCooldowns");
      }
      return;
    }
    const round = Number(combat.round ?? 0) || 0;
    const combatId = combat.id;

    for (const a of (game.actors?.contents ?? [])) {
      const all = a.getFlag(FLAG_SCOPE, FLAG_KEY);
      if (!all) continue;

      let dirty = false;
      const next = { ...all };

      for (const [skillId, entry] of Object.entries(all)) {
        if (!entry) continue;
        if (entry.combatId !== combatId) {
          // старый бой
          delete next[skillId];
          dirty = true;
          continue;
        }
        const afr = Number(entry.availableFromRound ?? 0) || 0;
        if (afr && round >= afr) {
          // уже откатилось — можно удалить запись
          delete next[skillId];
          dirty = true;
        }
      }

      if (dirty) {
        await a.setFlag(FLAG_SCOPE, FLAG_KEY, next);
      }
    }
  });

  // NEW: Inject cooldown-reset clock icon into Player sheet skills tab.
  Hooks.on("renderOrderPlayerSheet", _onRenderPlayerSheet);

  console.log("OrderSkillCooldown | Hooks registered");
}
