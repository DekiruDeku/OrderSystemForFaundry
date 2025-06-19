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
    system.ManaFatigue.max = 3 + magicVal + staminaVal + startBonusManaFatigue;
    
    // ------------------------------
    // 3. Расчёт Movement.value
    // ------------------------------
    // Формула: 3 + Dexterity / 2
    const dexVal = system?.Dexterity?.value || 0;
    system.Movement.value = 3 + Math.ceil(dexVal / 2);

        // ------------------------------
    // 4. Inventory and Carrying Capacity
    // ------------------------------
    const equippedArmor = this.items.find(i => i.type === "Armor" && i.system.isEquiped);
    const inventorySlots = equippedArmor ? Number(equippedArmor.system.inventorySlots || 0) : 0;
    const quickSlots = equippedArmor ? Number(equippedArmor.system.quickAccessSlots || 0) : 0;
    system.inventorySlots = inventorySlots;
    system.quickAccessSlots = quickSlots;
    const maxInventory = inventorySlots + quickSlots;

    const inventoryItems = this.items.filter(i => ["weapon","meleeweapon","rangeweapon","Armor","Consumables","RegularItem"].includes(i.type));
    const itemCount = inventoryItems.length;
    system.inventoryCount = itemCount;
    system.inventoryOver = itemCount > maxInventory;

    const carryingCapacity = 5 + staminaVal;
    system.carryingCapacity = carryingCapacity;
    const exceed = itemCount - carryingCapacity;

    await this._handleOverloadEffects(exceed, itemCount, maxInventory);
    }

    async _handleOverloadEffects(exceed, itemCount, maxInventory) {
      if (this._processingOverload) return;

      const flags = this.flags?.Order || {};
      let level = flags.overloadLevel || 0;

      let newLevel = 0;
      if (exceed >= 1 && exceed <= 2) newLevel = 1;
      else if (exceed >= 3 && exceed <= 6) newLevel = 2;
      else if (exceed >= 7 && exceed <= 12) newLevel = 3;
      else if (exceed >= 13) newLevel = 4;

      if (level === newLevel && this.getFlag("Order", "inventoryOver") === (itemCount > maxInventory)) return;

      this._processingOverload = true;

      // Remove previous effects if level changed or inventory notification changed
      const remove = this.effects.filter(e => ["Увязший","Схваченный","Ошеломление"].includes(e.label)).map(e => e.id);
      if (remove.length) await this.deleteEmbeddedDocuments("ActiveEffect", remove);

      // Apply new effects based on newLevel
      if (newLevel === 1) {
        await this._applyDebuff("Stuck", "1");
      } else if (newLevel === 2) {
        await this._applyDebuff("Captured", "1");
      } else if (newLevel === 3) {
        await this._applyDebuff("Captured", "2");
      } else if (newLevel === 4) {
        await this._applyDebuff("Captured", "2");
        await this._applyDebuff("Dizziness", "1");
      }

      await this.update({ "flags.Order.overloadLevel": newLevel, "flags.Order.inventoryOver": itemCount > maxInventory });

      this._processingOverload = false;
    }

    async _applyDebuff(key, state) {
      try {
        const response = await fetch("systems/Order/module/debuffs.json");
        if (!response.ok) throw new Error("Failed to load debuffs");
        const data = await response.json();
        const debuff = data[key];
        if (!debuff || !debuff.states[state]) return;
        const effectData = {
          label: debuff.name,
          icon: "icons/svg/skull.svg",
          changes: debuff.changes[state] || [],
          duration: { rounds: 1 },
          flags: { description: debuff.states[state], debuff: key, state }
        };
        await this.createEmbeddedDocuments("ActiveEffect", [effectData]);
      } catch (err) {
        console.error(err);
      }
  
  }
}