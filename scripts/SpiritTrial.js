/**
 * Spirit Trial ("Испытание духа")
 *
 * Triggers when Stress reaches max.
 * Roll: d20 + floor(Will/2)
 * - Will >= 7: advantage
 * - Will >= 10: may shift outcome by +/-1 step in the table
 *
 * Applies an ActiveEffect shown in the Actor sheet "Активные эффекты" block.
 * The effect can be removed manually.
 */

const SPIRIT_FLAG_KEY = "OrderSpiritTrial"; // stored at effect.flags[SPIRIT_FLAG_KEY]

const OUTCOMES = [
  {
    key: "madness",
    name: "Безумие",
    icon: "icons/svg/terror.svg",
    description: "Вы начинаете творить лютую дичь, часто во вред себе и своей команде.",
    allActionsMod: 0,
    changes: []
  },
  {
    key: "recklessness",
    name: "Безрассудство",
    icon: "icons/svg/sword.svg",
    description: "Вы несётесь на врага: +3 к Атаке, но не защищаетесь.",
    allActionsMod: 0,
    changes: [
      { key: "flags.Order.roll.attack", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 3 }
    ]
  },
  {
    key: "panic",
    name: "Паника",
    icon: "icons/svg/downgrade.svg",
    description: "Вы бросаете позицию и убегаете, по пути атакуя всех. -10 к атаке.",
    allActionsMod: 0,
    changes: [
      { key: "flags.Order.roll.attack", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -10 }
    ]
  },
  {
    key: "doom",
    name: "Обречённость",
    icon: "icons/svg/skull.svg",
    description: "-3 ко всем действиям. Каждый ход товарищи слышат, что все вы обречены. Вы излучаете стресс — товарищам от этого не лучше.",
    allActionsMod: -3,
    changes: []
  },
  {
    key: "addiction",
    name: "Зависимость",
    icon: "icons/svg/acid.svg",
    description: "Вы используете все медикаменты, даже если полностью здоровы.",
    allActionsMod: 0,
    changes: []
  },
  {
    key: "apathy",
    name: "Апатия",
    icon: "icons/svg/sleep.svg",
    description: "-2 ко всем действиям. Сердце наполняется безразличием.",
    allActionsMod: -2,
    changes: []
  },
  {
    key: "inspiration",
    name: "Воодушевление",
    icon: "icons/svg/upgrade.svg",
    description: "Снимите себе 50 стресса, а также 25 всем товарищам.",
    allActionsMod: 0,
    changes: []
  },
  {
    key: "righteousWrath",
    name: "Праведный гнев",
    icon: "icons/svg/fire.svg",
    description: "+3 к любому действию Атаки. Враги поплатятся за всё.",
    allActionsMod: 0,
    changes: [
      { key: "flags.Order.roll.attack", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: 3 }
    ]
  },
  {
    key: "invulnerability",
    name: "Неуязвимость",
    icon: "icons/svg/shield.svg",
    description: "Следующие 3 хода вы не сможете умереть, даже если здоровье опустится в 0.",
    allActionsMod: 0,
    durationRounds: 3,
    changes: []
  },
  {
    key: "heroism",
    name: "Героизм",
    icon: "icons/svg/aura.svg",
    description: "+5 на любые действия. Все союзники в радиусе 3 клеток получают +3 на любые действия. Держится 3 хода.",
    allActionsMod: 5,
    durationRounds: 3,
    changes: []
  }
];

const _spiritTrialState = {
  lastStressByActorId: new Map(),   // actorId -> number
  pendingByActorId: new Set(),      // actorId
  cooldownUntilByActorId: new Map() // actorId -> timestamp (ms)
};

const SPIRIT_TRIAL_COOLDOWN_MS = 400;

function _stressValueWasUpdated(changed) {
  const v = extractNewStress(changed);
  return v !== undefined && v !== null;
}

function _stressMaxWasUpdated(changed) {
  const v =
    getUpdateValue(changed, "system.Stress.max") ??
    getUpdateValue(changed, "data.Stress.max") ??
    changed?.system?.Stress?.max ??
    changed?.data?.Stress?.max ??
    changed?.["system.Stress.max"] ??
    changed?.["data.Stress.max"];
  return v !== undefined && v !== null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getUpdateValue(updateData, path) {
  try {
    return foundry.utils.getProperty(updateData, path);
  } catch (e) {
    return undefined;
  }
}

function extractNewStress(updateData) {
  return (
    getUpdateValue(updateData, "system.Stress.value") ??
    getUpdateValue(updateData, "data.Stress.value") ??
    updateData?.system?.Stress?.value ??
    updateData?.data?.Stress?.value ??
    updateData?.["system.Stress.value"] ??
    updateData?.["data.Stress.value"]
  );
}

function resolveOutcomeIndexFromTotal(total) {
  const t = clamp(Number(total) || 1, 1, 20);
  if (t <= 2) return 0;
  if (t <= 4) return 1;
  if (t <= 6) return 2;
  if (t <= 8) return 3;
  if (t <= 10) return 4;
  if (t <= 16) return 5;
  if (t === 17) return 6;
  if (t === 18) return 7;
  if (t === 19) return 8;
  return 9;
}

function getResponsibleUserId(actor) {
  const owners = game.users
    .filter(u => u.active && !u.isGM && actor?.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))
    .map(u => u.id)
    .sort();
  if (owners.length) return owners[0];

  const gms = game.users
    .filter(u => u.active && u.isGM)
    .map(u => u.id)
    .sort();
  if (gms.length) return gms[0];

  // Fallback: whoever is owner on this client
  return actor?.isOwner ? game.user.id : null;
}

async function removeExistingSpiritTrialEffects(actor) {
  const ids = actor.effects
    .filter(e => e?.flags?.[SPIRIT_FLAG_KEY]?.isSpiritTrial)
    .map(e => e.id);
  if (ids.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

function buildEffectData(outcome, { allActionsMod = 0 } = {}) {
  const flags = {
    description: outcome.description,
    [SPIRIT_FLAG_KEY]: {
      isSpiritTrial: true,
      key: outcome.key,
      allActionsMod: Number(allActionsMod) || 0
    }
  };

  const effectData = {
    label: `Испытание духа: ${outcome.name}`,
    icon: outcome.icon || "icons/svg/skull.svg",
    changes: Array.isArray(outcome.changes) ? outcome.changes.map(c => ({ ...c })) : [],
    flags
  };

  if (Number(outcome.durationRounds) > 0) {
    effectData.duration = { rounds: Number(outcome.durationRounds) };
  }

  return effectData;
}

function getSceneTokenForActor(actor) {
  // Prefer an active token on the current canvas.
  if (!canvas?.ready) return null;
  const tokens = actor?.getActiveTokens?.(true, true) || [];
  const onScene = tokens.find(t => t?.scene?.id === canvas.scene?.id);
  return onScene || tokens[0] || null;
}

async function applyInspirationStressRelief(sourceActor) {
  const max = Number(sourceActor.system?.Stress?.max ?? 100);
  const cur = Number(sourceActor.system?.Stress?.value ?? 0);
  const newSelf = clamp(cur - 50, 0, max);
  await sourceActor.update({ "system.Stress.value": newSelf }, { OrderSpiritTrialInternal: true });

  const sourceToken = getSceneTokenForActor(sourceActor);
  if (!sourceToken) return;

  const allies = canvas.tokens.placeables
    .filter(t => t?.actor && t.id !== sourceToken.id && t.document.disposition === sourceToken.document.disposition)
    .map(t => t.actor);

  const seen = new Set();
  for (const a of allies) {
    if (!a?.id || seen.has(a.id)) continue;
    seen.add(a.id);
    const aMax = Number(a.system?.Stress?.max ?? 100);
    const aCur = Number(a.system?.Stress?.value ?? 0);
    const aNew = clamp(aCur - 25, 0, aMax);
    await a.update({ "system.Stress.value": aNew }, { OrderSpiritTrialInternal: true });
  }
}

async function applyHeroismAura(sourceActor) {
  const sourceToken = getSceneTokenForActor(sourceActor);
  if (!sourceToken) return;

  const radiusCells = 3;
  const gridUnit = Number(canvas.scene?.grid?.distance ?? 1);
  const radius = radiusCells * gridUnit;

  const allyTokens = canvas.tokens.placeables
    .filter(t => t?.actor && t.id !== sourceToken.id && t.document.disposition === sourceToken.document.disposition)
    .filter(t => {
      const dist = canvas.grid.measureDistance(sourceToken.center, t.center);
      return dist <= radius + 0.0001;
    });

  const effectData = {
    label: "Героизм: аура союзника",
    icon: "icons/svg/aura.svg",
    changes: [],
    duration: { rounds: 3 },
    flags: {
      description: "+3 на любые действия (аура героизма).",
      [SPIRIT_FLAG_KEY]: {
        isSpiritTrial: false,
        isAura: true,
        key: "heroismAura",
        allActionsMod: 3
      }
    }
  };

  const seen = new Set();
  for (const t of allyTokens) {
    const a = t.actor;
    if (!a?.id || seen.has(a.id)) continue;
    seen.add(a.id);

    // Replace existing aura if present
    const existing = a.effects.find(e => e?.flags?.[SPIRIT_FLAG_KEY]?.key === "heroismAura");
    if (existing) {
      await existing.update(effectData);
    } else {
      await a.createEmbeddedDocuments("ActiveEffect", [effectData]);
    }
  }
}

async function applyOutcome(actor, outcomeIndex) {
  const outcome = OUTCOMES[outcomeIndex];
  if (!outcome) return;

  // IMPORTANT: allow stacking multiple Spirit Trial outcomes.
  // The user can hit max Stress multiple times in a mission, so we do NOT remove
  // previous Spirit Trial effects here.

  // Add a running counter for clearer UI (so effects don't look "replaced").
  const curCount = Number(actor.getFlag?.("Order", "spiritTrialCount") ?? 0) || 0;
  const nextCount = curCount + 1;
  await actor.setFlag?.("Order", "spiritTrialCount", nextCount);

  const effectData = buildEffectData(outcome, { allActionsMod: outcome.allActionsMod });
  effectData.label = `Испытание духа #${nextCount}: ${outcome.name}`;
  await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

  if (outcome.key === "inspiration") {
    await applyInspirationStressRelief(actor);
  }
  if (outcome.key === "heroism") {
    await applyHeroismAura(actor);
  }
}

function outcomeHtml(outcomeIndex) {
  const o = OUTCOMES[outcomeIndex];
  if (!o) return "";
  return `
    <div style="display:flex; gap:10px; align-items:flex-start;">
      <img src="${o.icon}" style="width:48px; height:48px;"/>
      <div>
        <div style="font-weight:700; font-size:1.1em;">${o.name}</div>
        <div style="opacity:0.9;">${o.description}</div>
      </div>
    </div>
  `;
}

async function runSpiritTrial(actor) {
  if (!actor) return;

  const will = Number(actor.system?.Will?.value ?? 0);
  const bonus = Math.floor(will / 2);
  const dice = will >= 7 ? "2d20kh1" : "1d20";

  const roll = new Roll(`${dice} + ${bonus}`);
  await roll.evaluate({ async: true });

  const unclamped = Number(roll.total ?? 1);
  const total = clamp(unclamped, 1, 20);
  const baseIndex = resolveOutcomeIndexFromTotal(total);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Испытание духа: ${dice} + ⌊Will/2⌋ (Will=${will}, бонус=${bonus}) → итог (clamp 1..20): ${total}`
  });

  let applied = false;

  const allowShift = will >= 10;
  const worse = allowShift ? clamp(baseIndex - 1, 0, OUTCOMES.length - 1) : baseIndex;
  const better = allowShift ? clamp(baseIndex + 1, 0, OUTCOMES.length - 1) : baseIndex;

  const content = `
    <p><b>${actor.name}</b> достигает предела Стресса — начинается <b>Испытание духа</b>.</p>
    <hr/>
    <p><b>Бросок:</b> ${dice} + ${bonus} (половина стойкости духа)</p>
    <p><b>Результат:</b> ${unclamped} → <b>${total}</b> (по таблице 1–20)</p>
    <hr/>
    <p><b>Состояние по таблице:</b></p>
    ${outcomeHtml(baseIndex)}
    ${allowShift ? `<hr/><p>Will ≥ 10: можно <b>поднять</b> или <b>опустить</b> результат на 1 шаг по таблице.</p>` : ""}
  `;

  const buttons = {};
  if (allowShift && worse !== baseIndex) {
    buttons.worse = {
      label: `Хуже: ${OUTCOMES[worse].name}`,
      callback: async () => {
        applied = true;
        await applyOutcome(actor, worse);
      }
    };
  }
  buttons.base = {
    label: `Принять: ${OUTCOMES[baseIndex].name}`,
    callback: async () => {
      applied = true;
      await applyOutcome(actor, baseIndex);
    }
  };
  if (allowShift && better !== baseIndex) {
    buttons.better = {
      label: `Лучше: ${OUTCOMES[better].name}`,
      callback: async () => {
        applied = true;
        await applyOutcome(actor, better);
      }
    };
  }

  // Keep the "pending" lock until the dialog is closed.
  return await new Promise(resolve => {
    new Dialog({
      title: "Испытание духа",
      content,
      buttons,
      default: "base",
      close: async () => {
        try {
          if (!applied) {
            await applyOutcome(actor, baseIndex);
          }
        } finally {
          _spiritTrialState.pendingByActorId.delete(actor.id);
          resolve();
        }
      }
    }).render(true);
  });
}

export function registerSpiritTrialHooks() {
  Hooks.on("updateActor", async (actor, changed, options) => {
    if (!actor || actor.type !== "Player") return;

    // Only react to Stress changes (value or max)
    const stressUpdated = _stressValueWasUpdated(changed);
    const maxUpdated = _stressMaxWasUpdated(changed);
    if (!stressUpdated && !maxUpdated) return;

    const isInternal = Boolean(options?.OrderSpiritTrialInternal);

    const maxStress = Number(actor.system?.Stress?.max ?? 100);
    const newStress = Number(actor.system?.Stress?.value ?? 0);

    const last = _spiritTrialState.lastStressByActorId.has(actor.id)
      ? Number(_spiritTrialState.lastStressByActorId.get(actor.id))
      : newStress;

    // Always keep last-stress tracking correct (even for internal updates),
    // so the threshold-crossing logic stays reliable.
    _spiritTrialState.lastStressByActorId.set(actor.id, newStress);

    // Never trigger a new trial from internal updates (e.g., stress relief from outcomes)
    if (isInternal) return;

    // Don't open multiple dialogs for the same actor
    if (_spiritTrialState.pendingByActorId.has(actor.id)) return;

    // 1) Main rule: trigger on crossing the threshold upwards
    const crossed = last < maxStress && newStress >= maxStress;

    // 2) Reselect-at-max rule: if Stress is already at/above max and the user explicitly edits Stress.value
    // again (e.g., you removed an effect manually and typed 100 again), allow another Spirit Trial.
    // NOTE: we do NOT require that there are zero existing Spirit Trial effects, because stacking is allowed.
    const reselectionAtMax = stressUpdated && last >= maxStress && newStress >= maxStress;

    if (!(crossed || reselectionAtMax)) return;

    // Small cooldown to avoid multiple rapid-fire update cycles producing multiple dialogs
    const now = Date.now();
    const until = Number(_spiritTrialState.cooldownUntilByActorId.get(actor.id) ?? 0);
    if (now < until) return;
    _spiritTrialState.cooldownUntilByActorId.set(actor.id, now + SPIRIT_TRIAL_COOLDOWN_MS);

    // Elect a single responsible client (prefer active non-GM owner)
    const responsibleId = getResponsibleUserId(actor);
    if (!responsibleId || responsibleId !== game.user.id) return;

    _spiritTrialState.pendingByActorId.add(actor.id);

    try {
      await runSpiritTrial(actor);
    } catch (err) {
      console.error("Order | SpiritTrial failed", err);
      ui.notifications?.error("Ошибка при Испытании духа. Подробности в консоли.");
      _spiritTrialState.pendingByActorId.delete(actor.id);
    }
  });
}
