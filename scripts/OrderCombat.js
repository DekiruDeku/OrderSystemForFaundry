export class OrderCombat extends Combat {
    /**
     * Автоматизация распределения инициативы
     */
    async startCombat(ids, { updateTurn = true } = {}) {
      // Получить все combatants
      const combatants = this.combatants;
  
      // Разделяем на команды
      const playerCombatants = combatants.filter(c => c.actor?.hasPlayerOwner);
      const enemyCombatants = combatants.filter(c => !c.actor?.hasPlayerOwner);
  
      // Ожидаем выбора команды мастером
      const firstTeam = await new Promise((resolve) => {
        new Dialog({
          title: "Выбор команды",
          content: `
            <p>Выберите, какая команда ходит первой:</p>
            <div>
              <label>
                <input type="radio" name="team" value="players" checked />
                Игроки
              </label>
              <br />
              <label>
                <input type="radio" name="team" value="enemies" />
                Враги
              </label>
            </div>
          `,
          buttons: {
            ok: {
              label: "Подтвердить",
              callback: (html) => {
                const selectedTeam = html.find('input[name="team"]:checked').val();
                resolve(selectedTeam);
              },
            },
            cancel: {
              label: "Отмена",
              callback: () => resolve(null),
            },
          },
          default: "ok",
        }).render(true);
      });
      const secondTeam = firstTeam === "players" ? "enemies" : "players";
  
      // Устанавливаем инициативу для команд
      const firstInitiative = 10; // Фиксированное значение для первой команды
      const secondInitiative = firstInitiative - 1;

      console.log(playerCombatants);
      console.log(enemyCombatants);
  
      await this._setInitiativeForTeam(firstTeam === "players" ? playerCombatants : enemyCombatants, firstInitiative);
      await this._setInitiativeForTeam(secondTeam === "players" ? playerCombatants : enemyCombatants, secondInitiative);
  
      // Обновляем порядок хода
      if (updateTurn) {
        this.update({ turn: 0 });
      }
      super.startCombat();
    }
  
    /**
     * Установка инициативы для команды
     * @param {Array} teamCombatants - список Combatant для команды
     * @param {Number} initiative - значение инициативы
     */
    async _setInitiativeForTeam(teamCombatants, initiative) {
      for (const combatant of teamCombatants) {
        await combatant.update({ initiative });
      }
    }
  }
  