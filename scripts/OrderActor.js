export class OrderActor extends Actor {

    prepareData() {
      super.prepareData();
      this._prepareOrderActorData();
    }
  
    _prepareOrderActorData() {
      if (this.type !== "Player") return;
  
      const system = this.system;
      const rank = system.Rank || 1;
      const staminaVal = system?.Stamina?.value || 0;
  
      // По умолчанию 5 за одну положительную единицу стамины
      let bonusHpPerStamina = 5;
      // Одноразовый бонус из класса
      let startBonusHp = 0;
  
      // Ищем класс
      const classItem = this.items.find(i => i.type === "Class");
      if (classItem) {
        bonusHpPerStamina = classItem.system?.bonusHp ?? 5;
        startBonusHp = classItem.system?.startBonusHp ?? 0;
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
    }
  }
  