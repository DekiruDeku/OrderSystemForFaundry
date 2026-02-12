import { applyComputedDamageToItem } from "./OrderDamageFormula.js";

export class OrderActor extends Actor {

  prepareData() {
    super.prepareData();
    this._prepareOrderActorData();
  }

  async _prepareOrderActorData() {
    if (this.type !== "Player") return;

    const system = this.system;

    // ------------------------------
    // 0b. Perk bonuses (Skill items marked as perks)
    // ------------------------------
    const perkSummary = {};
    try {
      const perkItems = (this.items?.contents ?? this.items ?? []).filter(i => i?.type === "Skill" && i?.system?.isPerk);
      for (const p of perkItems) {
        const bonuses = p?.system?.perkBonuses;
        if (!Array.isArray(bonuses)) continue;
        for (const b of bonuses) {
          const target = String(b?.target ?? "").trim();
          if (!target) continue;
          const val = Number(b?.value) || 0;
          if (!val) continue;
          perkSummary[target] = (Number(perkSummary[target]) || 0) + val;
        }
      }
    } catch (err) {
      console.warn("Order | perk bonuses collection failed", err);
    }

    // Expose for other scripts (combat, etc.)
    system._perkBonuses = perkSummary;

    // ------------------------------
    // 0c. Perk: characteristic value bonuses (derived, affects formulas)
    // ------------------------------
    try {
      const charKeys = [
        "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge", "Charisma",
        "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
      ];
      for (const k of charKeys) {
        const add = Number(perkSummary?.[`${k}Value`] ?? 0) || 0;
        if (!add) continue;
        const c = system?.[k];
        if (!c) continue;
        c.value = (Number(c.value) || 0) + add;
      }
    } catch (err) {
      console.warn("Order | perk characteristic value injection failed", err);
    }

    const rank = system.Rank || 1;
    const staminaVal = Number(system?.Stamina?.value ?? 0) || 0;

    // Базовая формула HP от выносливости: +5 HP за 1 выносливости (если выносливость >= 0)
    // Класс может:
    //  - дать плоский бонус к максимуму HP
    //  - дать дополнительный бонус к максимуму HP за каждую 1 выносливости
    const BASE_HP_PER_STAMINA = 5;

    let classFlatHpBonus = 0;          // +HP за сам класс
    let classHpPerStaminaBonus = 0;   // +HP за каждую 1 выносливости
    let startBonusManaFatigue = 0;    // legacy/optional

    // Ищем класс (если классов несколько — берём первый, как и раньше)
    const classItem = this.items.find(i => i.type === "Class");
    if (classItem) {
      // Новый формат (актуальные поля с листа класса)
      classFlatHpBonus = Number(classItem.system?.HpBonus ?? 0) || 0;
      classHpPerStaminaBonus = Number(classItem.system?.HpBonusPerStamina ?? 0) || 0;

      // Совместимость со старым/черновым форматом, который мог использоваться в коде ранее
      // 1) startBonusHp -> плоский бонус
      if (!classFlatHpBonus) {
        classFlatHpBonus = Number(classItem.system?.startBonusHp ?? 0) || 0;
      }

      // 2) bonusHp (коэффициент HP за 1 выносливости) -> переводим в "добавку к базовым 5"
      //    Раньше bonusHp заменял базовые 5. Теперь мы храним именно добавку.
      if (!classHpPerStaminaBonus && classItem.system?.bonusHp !== undefined) {
        const legacyCoeff = Number(classItem.system?.bonusHp ?? BASE_HP_PER_STAMINA) || BASE_HP_PER_STAMINA;
        classHpPerStaminaBonus = Math.max(0, legacyCoeff - BASE_HP_PER_STAMINA);
      }

      startBonusManaFatigue = Number(classItem.system?.startBonusManaFatigue ?? 0) || 0;
    }

    // База 100
    let baseHP = 100;

    // +10 за каждый ранг
    let rankHP = rank * 10;

    // Подсчёт HP от выносливости:
    // - если выносливость >= 0: (5 + бонус_класса_за_1_выносливости) * выносливость
    // - если выносливость < 0: по старому правилу -5 за каждую единицу (без бонусов класса)
    let staminaHP = 0;
    if (staminaVal >= 0) {
      staminaHP = staminaVal * (BASE_HP_PER_STAMINA + classHpPerStaminaBonus);
    } else {
      staminaHP = staminaVal * BASE_HP_PER_STAMINA;
    }

    // Суммарный итог:
    const finalMax = baseHP + rankHP + staminaHP + classFlatHpBonus;
    system.Health.max = finalMax;

    // Perk: max health
    const perkHp = Number(perkSummary?.HealthMax ?? 0) || 0;
    if (perkHp) {
      const oldMax = Number(system.Health.max) || 0;
      system.Health.max = oldMax + perkHp;
      if (Number(system.Health.value) === oldMax) system.Health.value = system.Health.max;
    }



    // ------------------------------
    // 2. Расчёт ManaFatigue.max
    // ------------------------------
    // Формула: 3 + Magic + Stamina
    // (если стамина отрицательная, она уменьшит максимальную маг. усталость)
    const magicVal = system?.Magic?.value || 0;
    const manaFatigueFormula = 3 + magicVal + staminaVal + startBonusManaFatigue;
    system.ManaFatigue.max = Math.max(0, manaFatigueFormula);

    // Perk: max mana fatigue
    const perkMana = Number(perkSummary?.ManaFatigueMax ?? 0) || 0;
    if (perkMana) {
      const oldMax = Number(system.ManaFatigue.max) || 0;
      system.ManaFatigue.max = Math.max(0, oldMax + perkMana);
      if (Number(system.ManaFatigue.value) === oldMax) system.ManaFatigue.value = system.ManaFatigue.max;
    }



    // Perk: max stress
    const perkStress = Number(perkSummary?.StressMax ?? 0) || 0;
    if (perkStress && system.Stress) {
      const oldMax = Number(system.Stress.max) || 0;
      system.Stress.max = Math.max(0, oldMax + perkStress);
      if (Number(system.Stress.value) === oldMax) system.Stress.value = system.Stress.max;
    }

    // ------------------------------
    // 3. Расчёт Movement.value
    // ------------------------------
    // Формула: 3 + Dexterity / 2
    const dexVal = system?.Dexterity?.value || 0;
    system.Movement.value = 3 + Math.ceil(dexVal / 2);

    // ------------------------------
    // 4. Inventory and Carrying Capacity
    // ------------------------------
    const equippedArmor = this.items.find(i => i.type === "Armor" && i.system?.isUsed);
    const inventorySlots = equippedArmor ? Number(equippedArmor.system.inventorySlots || 0) : 0;
    const quickSlots = equippedArmor ? Number(equippedArmor.system.quickAccessSlots || 0) : 0;
    system.inventorySlots = inventorySlots;
    system.quickAccessSlots = quickSlots;
    const maxInventory = inventorySlots + quickSlots;
    const inventoryItems = this.items.filter(i => ["weapon", "meleeweapon", "rangeweapon", "Armor", "Consumables", "RegularItem"].includes(i.type));

    const countedItems = inventoryItems.filter(i => {
      const slot = i.getFlag("Order", "slotType");
      const isEquipped =
        i.type === "Armor" ? i.system?.isEquiped : i.system?.isEquiped || i.system?.isUsed;
      const weaponUsed = ["weapon", "meleeweapon", "rangeweapon"].includes(i.type) && i.system?.inHand;
      return slot !== "storage" && !(isEquipped || weaponUsed);
    });
    const itemCount = countedItems.length;
    system.inventoryCount = itemCount;
    system.inventoryOver = itemCount > maxInventory;

    const carryingCapacity = Math.max(5, 5 + staminaVal);
    system.carryingCapacity = carryingCapacity;
    const exceed = itemCount - carryingCapacity;

    // ------------------------------
    // 4b. Spirit Trial ("Испытание духа") modifiers
    // ------------------------------
    // Some Spirit Trial outcomes apply "all actions" modifiers. Characteristic rolls in this system
    // sum modifiers from system[Characteristic].modifiers, so we inject effect-driven modifiers there.
    // These modifiers are recalculated on every prepareData() call.
    this._applySpiritTrialActionModifiers();

    // ------------------------------
    // 5. Clear derived debuffs/mods before recalculating
    // ------------------------------
    for (const key of Object.keys(this.system)) {
      const charData = this.system[key];
      if (Array.isArray(charData?.modifiers)) {
        // Remove previously derived penalties/mods (recalculated every prepareData)
        charData.modifiers = charData.modifiers.filter(m => !m?.armorPenalty && !m?.weaponRequirementPenalty && !m?.perkBonus);
      }
      // Reset previously calculated weapon penalties (legacy display-only)
      if (Array.isArray(charData?.weaponPenalties)) {
        charData.weaponPenalties = [];
      }
    }


    // ------------------------------
    // 5a. Perk: characteristic & movement modifiers (derived)
    // ------------------------------
    try {
      // Characteristics: inject as modifiers (does not overwrite base values)
      const charKeys = [
        "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge", "Charisma",
        "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
      ];

      for (const k of charKeys) {
        const v = Number(perkSummary?.[k] ?? 0) || 0;
        if (!v) continue;
        const c = system?.[k];
        if (!c) continue;
        c.modifiers = Array.isArray(c.modifiers) ? c.modifiers : [];
        c.modifiers.push({ effectName: "Перк", value: v, perkBonus: true });
      }

      // Movement: inject into Movement.modifiers (sheet uses sumModifiers)
      const mv = Number(perkSummary?.Movement ?? 0) || 0;
      if (mv && system?.Movement) {
        system.Movement.modifiers = Array.isArray(system.Movement.modifiers) ? system.Movement.modifiers : [];
        system.Movement.modifiers.push({ effectName: "Перк", value: mv, perkBonus: true });
      }
    } catch (err) {
      console.warn("Order | perk modifier injection failed", err);
    }


    // ------------------------------
    // 5b. Equipment parameter modifiers (weapons in hand / armor worn)
    // ------------------------------
    // Weapons and Armor can provide "Параметры" (additionalAdvantages) that should
    // affect characteristic modifiers while the item is in hand / worn.
    // These modifiers are derived and recalculated on every prepareData().
    this._applyEquipmentParameterModifiers();

    const wornArmors = this.items.filter(
      (i) => i.type === "Armor" && i.system?.isEquiped
    );

    for (const armor of wornArmors) {
      const reqs = Array.isArray(armor.system?.RequiresArray)
        ? armor.system.RequiresArray
        : [];

      for (const req of reqs) {
        const required = Number(req?.Requires) || 0;
        const c1 = String(req?.RequiresCharacteristic ?? "").trim();
        const c2 = String(req?.RequiresCharacteristicAlt ?? req?.RequiresCharacteristic2 ?? "").trim();
        const useOr = Boolean(req?.RequiresOr ?? req?.useOr ?? req?.or);

        if (!c1) continue;

        // OR requirement: satisfied if either characteristic meets the threshold.
        if (useOr && c2) {
          const have1 = Number(this.system?.[c1]?.value ?? 0) || 0;
          const have2 = Number(this.system?.[c2]?.value ?? 0) || 0;
          const best = Math.max(have1, have2);
          const diff = best - required;
          if (diff < 0) {
            const keys = [...new Set([c1, c2])];
            for (const k of keys) {
              const charData = this.system?.[k];
              if (!charData) continue;
              const entry = { effectName: armor.name, value: diff, armorPenalty: true };
              charData.modifiers = Array.isArray(charData.modifiers)
                ? [...charData.modifiers, entry]
                : [entry];
            }
          }
          continue;
        }

        // Legacy/simple requirement
        const charData = this.system[c1];
        if (!charData) continue;
        const current = Number(charData.value) || 0;
        const diff = current - required;
        if (diff < 0) {
          const entry = { effectName: armor.name, value: diff, armorPenalty: true };
          charData.modifiers = Array.isArray(charData.modifiers)
            ? [...charData.modifiers, entry]
            : [entry];
        }
      }
    }
    // ------------------------------
    // 6. Weapon requirement debuffs (affect modifiers while in hand)
    // ------------------------------
    // Requirements should directly influence characteristic modifiers when the weapon is in hand.
    // This matches how Armor requirements work and ensures the penalty is visible in the modifier tooltip.
    const usedWeapons = this.items.filter(
      (i) => ["weapon", "meleeweapon", "rangeweapon"].includes(i.type) && i.system?.inHand
    );

    for (const weapon of usedWeapons) {
      const reqs = Array.isArray(weapon.system?.RequiresArray)
        ? weapon.system.RequiresArray
        : [];

      for (const req of reqs) {
        const required = Number(req?.Requires) || 0;
        const c1 = String(req?.RequiresCharacteristic ?? "").trim();
        const c2 = String(req?.RequiresCharacteristicAlt ?? req?.RequiresCharacteristic2 ?? "").trim();
        const useOr = Boolean(req?.RequiresOr ?? req?.useOr ?? req?.or);

        if (!c1) continue;

        // OR requirement: satisfied if either characteristic meets the threshold.
        if (useOr && c2) {
          const have1 = Number(this.system?.[c1]?.value ?? 0) || 0;
          const have2 = Number(this.system?.[c2]?.value ?? 0) || 0;
          const best = Math.max(have1, have2);
          const diff = best - required;
          if (diff < 0) {
            const keys = [...new Set([c1, c2])];
            for (const k of keys) {
              const charData = this.system?.[k];
              if (!charData) continue;
              const entry = {
                effectName: `Требование: ${weapon.name}`,
                value: diff,
                weaponRequirementPenalty: true
              };
              charData.modifiers = Array.isArray(charData.modifiers)
                ? [...charData.modifiers, entry]
                : [entry];
            }
          }
          continue;
        }

        // Legacy/simple requirement
        const charData = this.system[c1];
        if (!charData) continue;
        const current = Number(charData.value) || 0;
        const diff = current - required;
        if (diff < 0) {
          const entry = {
            effectName: `Требование: ${weapon.name}`,
            value: diff,
            weaponRequirementPenalty: true
          };
          charData.modifiers = Array.isArray(charData.modifiers)
            ? [...charData.modifiers, entry]
            : [entry];
        }
      }
    }

    // ------------------------------
    // 6c. Derived damage from DamageFormula (Skill/Spell)
    // ------------------------------
    // Evaluated after all characteristic modifiers are injected (perk/equipment/requirements).
    this._applyDamageFormulasToEmbeddedItems();
    // ------------------------------
    // 7. Overload effects (async, does not affect derived modifiers above)
    // ------------------------------
    await this._handleOverloadEffects(exceed, itemCount, maxInventory);

  }

  /**
   * Injects "all actions" modifiers from Spirit Trial ActiveEffects into every characteristic.
   * The effect stores the numeric modifier in effect.flags.OrderSpiritTrial.allActionsMod.
   */
  _applySpiritTrialActionModifiers() {
    try {
      const system = this.system;

      // ------------------------------
      // 0b. Perk bonuses (Skill items marked as perks)
      // ------------------------------
      const perkSummary = {};
      try {
        const perkItems = (this.items?.contents ?? this.items ?? []).filter(i => i?.type === "Skill" && i?.system?.isPerk);
        for (const p of perkItems) {
          const bonuses = p?.system?.perkBonuses;
          if (!Array.isArray(bonuses)) continue;
          for (const b of bonuses) {
            const target = String(b?.target ?? "").trim();
            if (!target) continue;
            const val = Number(b?.value) || 0;
            if (!val) continue;
            perkSummary[target] = (Number(perkSummary[target]) || 0) + val;
          }
        }
      } catch (err) {
        console.warn("Order | perk bonuses collection failed", err);
      }

      // Expose for other scripts (combat, etc.)
      system._perkBonuses = perkSummary;

      const keys = [
        "Strength",
        "Dexterity",
        "Stamina",
        "Accuracy",
        "Will",
        "Knowledge",
        "Charisma",
        "Seduction",
        "Leadership",
        "Faith",
        "Medicine",
        "Magic",
        "Stealth"
      ];

      // 1) Clear previously injected mods
      for (const k of keys) {
        const c = system?.[k];
        if (Array.isArray(c?.modifiers)) {
          c.modifiers = c.modifiers.filter(m => !m?.spiritTrialMod);
        }
      }

      // 2) Collect mods from effects
      const effectMods = [];
      for (const ef of this.effects) {
        const st = ef?.flags?.OrderSpiritTrial;
        const v = Number(st?.allActionsMod ?? 0);
        const eligible = Boolean(st?.isSpiritTrial || st?.isAura);
        if (!eligible || !Number.isFinite(v) || v === 0) continue;
        effectMods.push({ effectName: ef.label, value: v, spiritTrialMod: true });
      }
      if (!effectMods.length) return;

      // 3) Inject into every characteristic
      for (const k of keys) {
        const c = system?.[k];
        if (!c) continue;
        c.modifiers = Array.isArray(c.modifiers) ? c.modifiers : [];
        for (const m of effectMods) c.modifiers.push({ ...m });
      }
    } catch (err) {
      console.warn("Order | SpiritTrial modifiers injection failed", err);
    }
  }

  /**
   * Applies equipment "Параметры" (system.additionalAdvantages) as characteristic modifiers.
   *
   * - Weapons contribute while system.inHand = true
   * - Armor contributes while system.isEquiped = true
   *
   * These are derived (not persisted) and are recalculated on every prepareData().
   */
  _applyEquipmentParameterModifiers() {
    try {
      const system = this.system;

      // ------------------------------
      // 0b. Perk bonuses (Skill items marked as perks)
      // ------------------------------
      const perkSummary = {};
      try {
        const perkItems = (this.items?.contents ?? this.items ?? []).filter(i => i?.type === "Skill" && i?.system?.isPerk);
        for (const p of perkItems) {
          const bonuses = p?.system?.perkBonuses;
          if (!Array.isArray(bonuses)) continue;
          for (const b of bonuses) {
            const target = String(b?.target ?? "").trim();
            if (!target) continue;
            const val = Number(b?.value) || 0;
            if (!val) continue;
            perkSummary[target] = (Number(perkSummary[target]) || 0) + val;
          }
        }
      } catch (err) {
        console.warn("Order | perk bonuses collection failed", err);
      }

      // Expose for other scripts (combat, etc.)
      system._perkBonuses = perkSummary;

      const keys = [
        "Strength",
        "Dexterity",
        "Stamina",
        "Accuracy",
        "Will",
        "Knowledge",
        "Charisma",
        "Seduction",
        "Leadership",
        "Faith",
        "Medicine",
        "Magic",
        "Stealth"
      ];

      // 1) Clear previously injected equipment mods
      for (const k of keys) {
        const c = system?.[k];
        if (Array.isArray(c?.modifiers)) {
          c.modifiers = c.modifiers.filter(m => !m?.equipmentMod);
        }
      }

      // 2) Collect equipped items (armor worn + weapons in hand)
      const equippedItems = this.items.filter(i =>
        (i.type === "Armor" && i.system?.isEquiped) ||
        (["weapon", "meleeweapon", "rangeweapon"].includes(i.type) && i.system?.inHand)
      );
      if (!equippedItems.length) return;

      // 3) Inject item "additionalAdvantages" into corresponding characteristic modifiers
      for (const item of equippedItems) {
        const bonuses = Array.isArray(item.system?.additionalAdvantages)
          ? item.system.additionalAdvantages
          : [];
        if (!bonuses.length) continue;

        for (const b of bonuses) {
          const charKey = b?.Characteristic;
          const value = Number(b?.Value ?? 0);
          if (!charKey || !Number.isFinite(value) || value === 0) continue;

          const c = system?.[charKey];
          if (!c) continue;
          c.modifiers = Array.isArray(c.modifiers) ? c.modifiers : [];
          c.modifiers.push({ effectName: item.name, value, equipmentMod: true });
        }
      }
    } catch (err) {
      console.warn("Order | Equipment parameter modifiers injection failed", err);
    }
  }

  async _handleOverloadEffects(exceed, itemCount, maxInventory) {
    if (this._processingOverload) return;

    const flags = this.flags?.Order || {};
    const level = flags.overloadLevel || 0;
    const wasOverloaded = Boolean(flags.weightOverloaded);

    let newLevel = 0;
    if (exceed >= 1 && exceed <= 2) newLevel = 1;
    else if (exceed >= 3 && exceed <= 6) newLevel = 2;
    else if (exceed >= 7 && exceed <= 12) newLevel = 3;
    else if (exceed >= 13) newLevel = 4;

    const isOverloaded = exceed > 0;
    const inventoryOver = itemCount > maxInventory;
    const levelChanged = level !== newLevel;
    const inventoryChanged = this.getFlag("Order", "inventoryOver") !== inventoryOver;
    const overloadChanged = wasOverloaded !== isOverloaded;
    if (!levelChanged && !inventoryChanged && !overloadChanged) return;

    this._processingOverload = true;

    if (overloadChanged) {
      const stuckEffect = this.effects.find(
        e => e.getFlag("Order", "debuffKey") === "Stuck" || e.label === "Увязший"
      );
      const currentState = Number(stuckEffect?.getFlag("Order", "stateKey")) || 0;
      const maxState = Number(stuckEffect?.getFlag("Order", "maxState")) || currentState || 1;

      if (isOverloaded) {
        const nextState = Math.min(currentState + 1, maxState || 1);
        if (nextState > currentState) {
          await this._applyDebuff("Stuck", String(nextState || 1));
        }
      } else if (stuckEffect) {
        const nextState = currentState - 1;
        if (nextState <= 0) {
          await this.deleteEmbeddedDocuments("ActiveEffect", [stuckEffect.id]);
        } else {
          await this._applyDebuff("Stuck", String(nextState));
        }
      }
    }

    if (levelChanged) {
      const remove = this.effects
        .filter(e => ["Captured", "Dizziness"].includes(e.getFlag("Order", "debuffKey"))
          || ["Схваченный", "Ошеломление"].includes(e.label))
        .map(e => e.id);
      if (remove.length) await this.deleteEmbeddedDocuments("ActiveEffect", remove);

      if (newLevel === 2) {
        await this._applyDebuff("Captured", "1");
      } else if (newLevel === 3) {
        await this._applyDebuff("Captured", "2");
      } else if (newLevel === 4) {
        await this._applyDebuff("Captured", "2");
        await this._applyDebuff("Dizziness", "1");
      }
    }

    const updateData = {
      "flags.Order.overloadLevel": newLevel,
      "flags.Order.inventoryOver": inventoryOver,
      "flags.Order.weightOverloaded": isOverloaded
    };

    if (this.id) {
      await this.update(updateData);
    } else {
      this.updateSource(updateData);
    }
    this._processingOverload = false;
  }

  /**
 * Добавляет стадии дебаффа (стакание), с капом (по умолчанию 3).
 * Пример: если уже Dizziness 1 и добавить 1 => станет 2.
 * Использовать везде, где "накладываем" дебафф повторно от эффектов/атак.
 */
  async _addDebuff(key, addStates = 1, { cap = 3 } = {}) {
    const delta = Number(addStates) || 0;
    if (!delta) return;

    const existingEffect = this.effects.find(e => e.getFlag("Order", "debuffKey") === key);

    const currentState = Number(existingEffect?.getFlag("Order", "stateKey")) || 0;
    const effectMax = Number(existingEffect?.getFlag("Order", "maxState")) || 3;

    const hardCap = Math.min(Number(cap) || 3, effectMax || 3);
    const nextState = Math.min(hardCap, Math.max(1, currentState + delta));

    // _applyDebuff остаётся "установить стадию" — мы вычислили нужную стадию сами
    await this._applyDebuff(key, String(nextState));
  }

  async _applyDebuff(key, state) {
    try {
      const response = await fetch("systems/Order/module/debuffs.json");
      if (!response.ok) throw new Error("Failed to load debuffs");
      const data = await response.json();
      const debuff = data[key];
      if (!debuff || !debuff.states[state]) return;

      const baseChanges = Array.isArray(debuff.changes?.[state])
        ? debuff.changes[state].map(change => ({ ...change }))
        : [];

      const stageChanges = baseChanges.map(change => {
        if (change.key === "myCustomEffect.MovementMod") {
          const movementValue = Number(this.system?.Movement?.value) || 0;
          if (change.value === "@halfMovement") {
            return { ...change, value: -movementValue / 2 };
          }
          if (change.value === "@fullMovement") {
            return { ...change, value: -movementValue };
          }
        }
        return change;
      });

      const maxState = Object.keys(debuff.states || {}).length || 1;
      const existingEffect = this.effects.find(e => e.getFlag("Order", "debuffKey") === key);
      const updateData = {
        changes: stageChanges,
        label: debuff.name,
        icon: debuff.icon || "icons/svg/skull.svg",
        "flags.description": debuff.states[state],
        "flags.Order.debuffKey": key,
        "flags.Order.stateKey": Number(state),
        "flags.Order.maxState": maxState
      };

      if (existingEffect) {
        await existingEffect.update(updateData);
      } else {
        const effectData = {
          label: debuff.name,
          icon: debuff.icon || "icons/svg/skull.svg",
          changes: stageChanges,
          duration: { rounds: 1 },
          flags: {
            description: debuff.states[state],
            Order: { debuffKey: key, stateKey: Number(state), maxState }
          }
        };
        await this.createEmbeddedDocuments("ActiveEffect", [effectData]);
      }
    } catch (err) {
      console.error(err);
    }
  }

  /**
 * Applies DamageFormula -> Damage (derived, not persisted) for embedded Skill/Spell items.
 */
  _applyDamageFormulasToEmbeddedItems() {
    try {
      const items = (this.items?.contents ?? this.items ?? []);
      for (const it of items) {
        if (!it) continue;
        if (it.type !== "Skill" && it.type !== "Spell") continue;
        applyComputedDamageToItem({ item: it, actor: this });
      }
    } catch (err) {
      console.warn("Order | DamageFormula evaluation failed", err);
    }
  }
}