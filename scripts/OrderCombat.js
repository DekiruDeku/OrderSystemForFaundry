export class OrderCombat extends Combat {
  static FLAG_SCOPE = "Order";
  static FLAG_KEY = "teamInitiative";

  /* -----------------------------
   * Helpers: flags + teams
   * ----------------------------- */

  _getTeamKey(combatant) {
    return combatant?.actor?.hasPlayerOwner ? "players" : "enemies";
  }

  _otherTeam(teamKey) {
    return teamKey === "players" ? "enemies" : "players";
  }

  async _getState() {
    const st = this.getFlag(OrderCombat.FLAG_SCOPE, OrderCombat.FLAG_KEY);
    return st ?? null;
  }

  async _setState(patch) {
    const prev = (await this._getState()) ?? {};
    const next = foundry.utils.mergeObject(prev, patch, { inplace: false });
    // setFlag — штатный метод Document v11
    return this.setFlag(OrderCombat.FLAG_SCOPE, OrderCombat.FLAG_KEY, next);
  }

  _getTeamCombatants(teamKey) {
    return this.combatants.filter(c => this._getTeamKey(c) === teamKey);
  }

  _getUnactedCombatants(teamKey, actedIds) {
    const team = this._getTeamCombatants(teamKey);
    return team.filter(c => !actedIds.includes(c.id));
  }

  async _promptChooseNextCombatant(teamKey, candidates) {
    if (!candidates.length) return null;

    // удобный список
    const opts = candidates
      .map(c => `<option value="${c.id}">${c.name ?? c.actor?.name ?? c.id}</option>`)
      .join("");

    return new Promise(resolve => {
      new Dialog({
        title: teamKey === "players" ? "Передать инициативу: Игроки" : "Передать инициативу: Враги",
        content: `
          <form>
            <div class="form-group">
              <label>Кто ходит следующим?</label>
              <select name="next" style="width:100%">${opts}</select>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            label: "Передать ход",
            callback: html => {
              const id = html.find('select[name="next"]').val();
              resolve(id || null);
            }
          }
        },
        default: "ok",
        close: () => resolve(null)
      }).render(true);
    });
  }

  async _jumpToCombatantId(combatantId) {
    const idx = this.turns.findIndex(t => t.id === combatantId);
    if (idx < 0) return;
    // update({turn}) — штатно для Combat/Document
    await this.update({ turn: idx }); // :contentReference[oaicite:1]{index=1}
  }

  /* -----------------------------
   * Start Combat
   * ----------------------------- */

  async startCombat(ids, { updateTurn = true } = {}) {
    const combatants = this.combatants;
    const playerCombatants = combatants.filter(c => c.actor?.hasPlayerOwner);
    const enemyCombatants = combatants.filter(c => !c.actor?.hasPlayerOwner);

    const firstTeam = await new Promise((resolve) => {
      new Dialog({
        title: "Выбор команды",
        content: `
        <p>Выберите, какая команда ходит первой:</p>
        <div>
          <label><input type="radio" name="team" value="players" checked /> Игроки</label><br/>
          <label><input type="radio" name="team" value="enemies" /> Враги</label>
        </div>
      `,
        buttons: {
          ok: { label: "Подтвердить", callback: (html) => resolve(html.find('input[name="team"]:checked').val()) },
          cancel: { label: "Отмена", callback: () => resolve(null) }
        },
        default: "ok",
      }).render(true);
    });

    if (!firstTeam) return;

    const secondTeam = firstTeam === "players" ? "enemies" : "players";

    const firstInitiative = 10;
    const secondInitiative = 9;

    await this._setInitiativeForTeam(firstTeam === "players" ? playerCombatants : enemyCombatants, firstInitiative);
    await this._setInitiativeForTeam(secondTeam === "players" ? playerCombatants : enemyCombatants, secondInitiative);

    // ВАЖНО: state НЕ ставим здесь (round еще не финальный)

    await super.startCombat(ids, { updateTurn });

    // ВАЖНО: после super.startCombat round уже корректный (обычно 1)
    await this._setState({
      firstTeam,
      activeTeam: firstTeam,
      round: this.round ?? 1,
      acted: { players: [], enemies: [] },
      initialized: true
    });

    // первый выбор в команде — сразу показываем
    if (game.user.isGM) {
      const candidates = this._getUnactedCombatants(firstTeam, []);
      const nextId = await this._promptChooseNextCombatant(firstTeam, candidates);
      if (nextId) await this._jumpToCombatantId(nextId);
    }
  }


  async _setInitiativeForTeam(teamCombatants, initiative) {
    for (const combatant of teamCombatants) {
      await combatant.update({ initiative });
    }
  }

  /* -----------------------------
   * Core: dynamic team passing
   * ----------------------------- */

  async nextTurn(...args) {
    // Обычно Combat двигает turn сам, но мы берём управление на себя
    if (!game.user.isGM) return super.nextTurn(...args); // пусть GM рулит

    const st = (await this._getState()) ?? {};
    const firstTeam = st.firstTeam ?? "players";
    const activeTeam = st.activeTeam ?? firstTeam;

    // если раунд сменился руками/модулем — синхронизируем
    const currentRound = this.round ?? 1;

    // Если раунд реально поменялся (после nextRound/ручного изменения) — синхронизируем,
    // но НЕ делаем super.nextTurn (иначе снова перескочит по инициативе).
    if (st.round !== currentRound) {
      await this._setState({
        round: currentRound,
        activeTeam: firstTeam,
        acted: { players: [], enemies: [] },
        initialized: true
      });

      // Сразу выбираем первого в firstTeam
      const candidates = this._getUnactedCombatants(firstTeam, []);
      const nextId = await this._promptChooseNextCombatant(firstTeam, candidates);
      if (nextId) await this._jumpToCombatantId(nextId);
      return this;
    }


    // текущий комбатант
    const current = this.combatant;
    if (current) {
      const team = this._getTeamKey(current);
      const acted = st.acted ?? { players: [], enemies: [] };

      // отмечаем "сходил" только если он из активной команды
      if (team === activeTeam) {
        const list = Array.from(acted[team] ?? []);
        if (!list.includes(current.id)) list.push(current.id);
        acted[team] = list;
        await this._setState({ acted });
      }
    }

    // обновляем state после возможной записи
    const st2 = (await this._getState()) ?? {};
    const acted2 = st2.acted ?? { players: [], enemies: [] };

    // 1) пробуем продолжить ход в той же команде
    const remainSameTeam = this._getUnactedCombatants(activeTeam, acted2[activeTeam] ?? []);
    if (remainSameTeam.length) {
      const nextId = await this._promptChooseNextCombatant(activeTeam, remainSameTeam);
      if (nextId) {
        await this._jumpToCombatantId(nextId);
        return this;
      }
      // если диалог закрыли — fallback на стандартный nextTurn
      return super.nextTurn(...args);
    }

    // 2) команда закончила — переключаемся на другую
    const other = this._otherTeam(activeTeam);
    const remainOther = this._getUnactedCombatants(other, acted2[other] ?? []);

    if (remainOther.length) {
      await this._setState({ activeTeam: other });
      const nextId = await this._promptChooseNextCombatant(other, remainOther);
      if (nextId) {
        await this._jumpToCombatantId(nextId);
        return this;
      }
      return super.nextTurn(...args);
    }

    // 3) обе команды сходили — следующий раунд
    return this.nextRound();
  }

  async nextRound(...args) {
    // стандартно увеличиваем раунд
    await super.nextRound(...args); // :contentReference[oaicite:3]{index=3}

    // сбрасываем "кто сходил" и начинаем снова с firstTeam
    const st = (await this._getState()) ?? {};
    const firstTeam = st.firstTeam ?? "players";

    await this._setState({
      round: this.round ?? 0,
      activeTeam: firstTeam,
      acted: { players: [], enemies: [] }
    });

    if (game.user.isGM) {
      const candidates = this._getUnactedCombatants(firstTeam, []);
      const nextId = await this._promptChooseNextCombatant(firstTeam, candidates);
      if (nextId) await this._jumpToCombatantId(nextId);
    }

    return this;
  }
}
