export class OrderCombat extends Combat {
  static FLAG_SCOPE = "Order";
  static FLAG_KEY = "teamInitiative";
  static END_TURN_DAMAGE_BY_DEBUFF = Object.freeze({
    Poisoned: Object.freeze({ 1: 10, 2: 20, 3: 30 }),
    Bleeding: Object.freeze({ 1: 10, 2: 20, 3: 30 }),
    Burning: Object.freeze({ 1: 15, 2: 30, 3: 50 })
  });
  static END_TURN_STRESS_BY_DEBUFF = Object.freeze({
    Fear: Object.freeze({ 1: 5, 2: 10, 3: 15 })
  });
  static DEBUFF_LABELS = Object.freeze({
    Poisoned: "Отравление",
    Bleeding: "Кровотечение",
    Burning: "Горение",
    Fear: "Страх"
  });

  /* -----------------------------
   * Helpers: flags + teams
   * ----------------------------- */

  _getDisposition(combatant) {
    // Prefer token disposition (combatants are token-based in encounters)
    const disp = combatant?.token?.disposition;
    if (disp !== undefined && disp !== null) return disp;
    // Fallback: try token document if available
    const docDisp = combatant?.token?.document?.disposition;
    if (docDisp !== undefined && docDisp !== null) return docDisp;
    return null;
  }

  _getTeamKey(combatant) {
    const disp = this._getDisposition(combatant);
    if (disp === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "enemies";
    if (disp === CONST.TOKEN_DISPOSITIONS.SECRET) return "enemies";
    if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "players";
    if (disp === CONST.TOKEN_DISPOSITIONS.NEUTRAL) return "players";

    // Fallback to ownership if disposition not available (safety)
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

  _getDebuffStage(actor, debuffKey) {
    if (!actor || !debuffKey) return 0;
    const effect = (actor.effects ?? []).find(e => e?.getFlag?.("Order", "debuffKey") === debuffKey);
    const stage = Number(effect?.getFlag?.("Order", "stateKey") ?? 0) || 0;
    return Math.max(0, Math.min(3, stage));
  }

  _collectEndTurnDebuffPayload(actor) {
    const details = [];
    let totalDamage = 0;
    let totalStress = 0;

    for (const [key, byStage] of Object.entries(OrderCombat.END_TURN_DAMAGE_BY_DEBUFF)) {
      const stage = this._getDebuffStage(actor, key);
      const amount = Number(byStage?.[stage] ?? 0) || 0;
      if (!amount) continue;
      totalDamage += amount;
      details.push(`${OrderCombat.DEBUFF_LABELS[key] || key} ${stage}: -${amount} HP`);
    }

    for (const [key, byStage] of Object.entries(OrderCombat.END_TURN_STRESS_BY_DEBUFF)) {
      const stage = this._getDebuffStage(actor, key);
      const amount = Number(byStage?.[stage] ?? 0) || 0;
      if (!amount) continue;
      totalStress += amount;
      details.push(`${OrderCombat.DEBUFF_LABELS[key] || key} ${stage}: +${amount} Stress`);
    }

    return { totalDamage, totalStress, details };
  }

  async _applyEndTurnDebuffsForCombatant(combatant) {
    const actor = combatant?.actor ?? game.actors?.get(combatant?.actorId ?? null) ?? null;
    if (!actor) return;

    const payload = this._collectEndTurnDebuffPayload(actor);
    if (!payload.totalDamage && !payload.totalStress) return;

    const hpObj = actor.system?.Health ?? null;
    const stressObj = actor.system?.Stress ?? null;
    const hpCur = Number(hpObj?.value ?? 0) || 0;
    const stressCur = Number(stressObj?.value ?? 0) || 0;
    const stressMax = Number(stressObj?.max ?? 0) || 0;

    const updateData = {};
    let hpNext = hpCur;
    let stressNext = stressCur;

    if (hpObj && payload.totalDamage > 0) {
      hpNext = Math.max(0, hpCur - payload.totalDamage);
      updateData["system.Health.value"] = hpNext;
    }

    if (stressObj && payload.totalStress > 0) {
      stressNext = stressMax > 0
        ? Math.min(stressMax, stressCur + payload.totalStress)
        : (stressCur + payload.totalStress);
      updateData["system.Stress.value"] = stressNext;
    }

    if (!Object.keys(updateData).length) return;
    await actor.update(updateData);

    const token = combatant?.tokenId ? canvas.tokens?.get(combatant.tokenId) : null;
    const name = combatant?.name ?? token?.name ?? actor?.name ?? "Actor";
    const summary = [];
    if (payload.totalDamage > 0) summary.push(`HP ${hpCur} -> ${hpNext}`);
    if (payload.totalStress > 0) summary.push(`Stress ${stressCur} -> ${stressNext}`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor, token }),
      content: `<p><strong>${name}</strong>: эффекты конца хода (${payload.details.join(", ")}). ${summary.join(", ")}.</p>`,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }

  /* -----------------------------
   * Start Combat
   * ----------------------------- */

  async startCombat(ids, { updateTurn = true } = {}) {
    const combatants = this.combatants;
    const playerCombatants = combatants.filter(c => this._getTeamKey(c) === "players");
    const enemyCombatants = combatants.filter(c => this._getTeamKey(c) === "enemies");

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
        await this._applyEndTurnDebuffsForCombatant(current);
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
    this._suppressEndTurnInNextRound = true;
    try {
      return await this.nextRound();
    } finally {
      this._suppressEndTurnInNextRound = false;
    }
  }

  async nextRound(...args) {
    if (game.user.isGM && !this._suppressEndTurnInNextRound) {
      const current = this.combatant;
      if (current) await this._applyEndTurnDebuffsForCombatant(current);
    }
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

  manageTurnEvents() {
    // До старта боя или при пустом энкаунтере
    if (!this.started) return;

    // turns может быть пустым/не готовым сразу после добавления combatant
    const turns = this.turns ?? [];
    if (!turns.length) return;

    // Combat.combatant в v11 может быть null/undefined если turn невалидный
    const current = this.combatant;
    const currentId = current?.id ?? current?._id ?? null;
    if (!currentId) return;

    // дальше твоя логика, где раньше было this.combatant.combatantId / this.combatant.id
    // ...
  }

}
