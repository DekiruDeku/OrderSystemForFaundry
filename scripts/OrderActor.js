export class OrderActor extends Actor {

  prepareData() {
    super.prepareData();
    this._prepareOrderActorData();
  }

  async _prepareOrderActorData() {
    if (this.type !== "Player") return;

    const system = this.system;
    const rank = system.Rank || 1;
    const staminaVal = system?.Stamina?.value || 0;

    // По умолчанию 5 за одну положительную единицу стамины
    let bonusHpPerStamina = 5;
    // Одноразовый бонус из класса
    let startBonusHp = 0;
    let startBonusManaFatigue = 0;

    // Ищем класс
    const classItem = this.items.find(i => i.type === "Class");
    if (classItem) {
      bonusHpPerStamina = classItem.system?.bonusHp ?? 5;
      startBonusHp = classItem.system?.startBonusHp ?? 0;
      startBonusManaFatigue = classItem.system?.startBonusManaFatigue ?? 0;
    }

    // База 100
    let baseHP = 100;

    // +10 за каждый ранг
    let rankHP = rank * 10;

    // Подсчёт HP от выносливости:
    let staminaHP = 0;
    if (staminaVal >= 0) {
      // Положительная стамина: умножаем на bonusHpPerStamina
      staminaHP = staminaVal * bonusHpPerStamina;
    } else {
      // Отрицательная стамина: -5 за каждую единицу
      // Если staminaVal = -3 -> добавим -15
      staminaHP = staminaVal * 5;
    }

    // Суммарный итог:
    const finalMax = baseHP + rankHP + staminaHP + startBonusHp;
    system.Health.max = finalMax;


    // ------------------------------
    // 2. Расчёт ManaFatigue.max
    // ------------------------------
    // Формула: 3 + Magic + Stamina
    // (если стамина отрицательная, она уменьшит максимальную маг. усталость)
    const magicVal = system?.Magic?.value || 0;
    const manaFatigueFormula = 3 + magicVal + staminaVal + startBonusManaFatigue;
    system.ManaFatigue.max = Math.max(0, manaFatigueFormula);

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
    const inventoryItems = this.items.filter(i => ["weapon","meleeweapon","rangeweapon","Armor","Consumables","RegularItem"].includes(i.type));

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
        charData.modifiers = charData.modifiers.filter(m => !m?.armorPenalty && !m?.weaponRequirementPenalty);
      }
      // Reset previously calculated weapon penalties (legacy display-only)
      if (Array.isArray(charData?.weaponPenalties)) {
        charData.weaponPenalties = [];
      }
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
        const charKey = req.RequiresCharacteristic;
        const required = Number(req.Requires) || 0;
        const charData = this.system[charKey];
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
        const charKey = req.RequiresCharacteristic;
        const required = Number(req.Requires) || 0;
        const charData = this.system[charKey];
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
}