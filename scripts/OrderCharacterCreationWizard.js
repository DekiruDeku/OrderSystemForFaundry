/*
 * Character Creation Wizard for Order system (Foundry VTT v11).
 * Non-invasive: only runs when user opts in.
 */

export function registerOrderCharacterCreationWizard() {
  Hooks.on("createActor", async (actor, options, userId) => {
    try {
      // Only prompt the user who created the actor.
      if (userId !== game.user.id) return;
      if (!actor) return;
      if (actor.type !== "Player") return;

      // Avoid triggering on compendium imports / system migrations where possible.
      if (options?.fromCompendium || options?.pack || options?.temporary) return;

      // Small delay to let Foundry finish initial creation.
      await new Promise(r => setTimeout(r, 50));

      const content = `
        <p>Открыть помощник создания персонажа?</p>
        <p class="notes">Вы сможете выбрать/перетащить расу и класс, распределить очки Академии и ранга, а также определить магический потенциал.</p>
      `;

      new Dialog({
        title: "Помощь в создании персонажа",
        content,
        buttons: {
          yes: {
            icon: '<i class="fas fa-hat-wizard"></i>',
            label: "Да, конечно",
            callback: () => new OrderCharacterCreationWizard(actor).render(true)
          },
          no: {
            icon: '<i class="fas fa-check"></i>',
            label: "Я знаю, что я делаю",
            callback: () => {}
          }
        },
        default: "yes"
      }).render(true);
    } catch (err) {
      console.error("[Order] Character creation wizard hook failed", err);
    }
  });
}

export class OrderCharacterCreationWizard extends FormApplication {
  constructor(actor, options = {}) {
    super(actor, options);
    this.actor = actor;
    this.step = 0;

    // Undo handlers keyed by step index (to prevent abuse when navigating back).
    this._undo = {};

    this._indexed = false;
    this._races = [];
    this._classes = [];

    this.state = {
      raceUuid: "",
      classUuid: "",
      raceName: "",
      className: "",

      academy1: "",
      academy2: "",
      academy3: "",

      rank1: "",
      rank2: "",

      magPotentialRoll: null,
      magPotentialTier: null,
      magPotentialBonus: 0,
      magAffinityRoll: null,
      magAffinity: null,

      manualD20: "",
      manualD12: ""
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "order-character-creation-wizard",
      classes: ["Order", "app", "os-ccw"],
      title: "Помощь в создании персонажа",
      template: "systems/Order/templates/apps/character-creation-wizard.hbs",
      width: 560,
      height: 460,
      minWidth: 520,
      minHeight: 360,
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: true
    });
  }

  async render(force = false, options = {}) {
    await this._ensureIndexes();
    const r = await super.render(force, options);
    this._clampCCWPosition();
    return r;
  }

  async _ensureIndexes() {
    if (this._indexed) return;
    this._indexed = true;

    // World items
    this._races = game.items.filter(i => i.type === "Race").map(i => ({ uuid: i.uuid, name: i.name }));
    this._classes = game.items.filter(i => i.type === "Class").map(i => ({ uuid: i.uuid, name: i.name }));

    // Compendiums
    try {
      for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;
        const index = await pack.getIndex();
        for (const e of index) {
          if (e.type === "Race") {
            this._races.push({ uuid: `Compendium.${pack.collection}.${e._id}`, name: e.name });
          } else if (e.type === "Class") {
            this._classes.push({ uuid: `Compendium.${pack.collection}.${e._id}`, name: e.name });
          }
        }
      }
    } catch (e) {
      console.warn("[Order] Could not index compendiums for CCW", e);
    }

    const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "ru");
    this._races.sort(byName);
    this._classes.sort(byName);
  }

  _nameFromIndex(uuid, list) {
    if (!uuid) return "";
    const hit = list.find(e => e.uuid === uuid);
    return hit?.name || "";
  }

  async _updateObject(event, formData) {
    // Keep local state up to date when submitOnChange is enabled.
    if (typeof formData !== "object" || !formData) return;

    const prevRace = this.state.raceUuid;
    const prevClass = this.state.classUuid;

    for (const k of Object.keys(this.state)) {
      if (k in formData) this.state[k] = formData[k];
    }

    if (this.state.raceUuid !== prevRace) this.state.raceName = "";
    if (this.state.classUuid !== prevClass) this.state.className = "";

    // Do not re-render aggressively; Foundry will do it when needed.
  }

  get stepTotal() {
    // 0 Intro, 1 Race, 2 Class, 3 Academy, 4 Rank, 5 MagPotential, 6 MagAffinity, 7 Summary
    return 7;
  }

  getData(options = {}) {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const rank = Number(systemData.Rank ?? 0) || 0;
    const rankForLimiter = this._rankLimiter(rank);

    const characteristicsKeys = [
      "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge",
      "Charisma", "Seduction", "Leadership", "Faith", "Obligation", "Medicine", "Magic", "Stealth"
    ];
    const characteristics = characteristicsKeys
      .filter(k => systemData[k] && typeof systemData[k] === "object")
      .map(k => ({
        key: k,
        label: game.i18n?.localize?.(k) ?? k,
        value: Number(systemData[k]?.value ?? 0) || 0
      }));

    const magPotentialText = this.state.magPotentialTier
      ? `${this.state.magPotentialTier}${this.state.magPotentialBonus ? ` (+${this.state.magPotentialBonus} к Магии)` : ""}`
      : "—";

    const magAffinityText = this.state.magAffinity ? this.state.magAffinity : "—";

    const isNoMagic = this.state.magPotentialTier === "Без магии";

    const stepTitleMap = {
      0: "Старт",
      1: "Раса",
      2: "Класс",
      3: "Академия",
      4: "Повышение ранга",
      5: "Магический потенциал",
      6: "Предрасположенность",
      7: "Итог"
    };

    const stepTitle = this.step === 6 && isNoMagic ? "Итог" : (stepTitleMap[this.step] ?? "");
    const stepHuman = Math.min(this.step + 1, this.stepTotal);

    const nextLabel = this.step >= 7 ? "Готово" : (this.step === 0 ? "Начать" : "Далее");

    const summary = this._buildSummary();

    return {
      ...super.getData(options),
      step: this.step,
      stepTotal: this.stepTotal,
      stepHuman,
      stepTitle,

      canBack: this.step > 0,
      nextLabel,

      isIntro: this.step === 0,
      isRace: this.step === 1,
      isClass: this.step === 2,
      isAcademy: this.step === 3,
      isRankUp: this.step === 4,
      isMagPotential: this.step === 5,
      isMagAffinity: this.step === 6 && !isNoMagic,
      isSummary: this.step === 7,

      races: this._races,
      classes: this._classes,
      raceUuid: this.state.raceUuid,
      classUuid: this.state.classUuid,
      academy1: this.state.academy1,
      academy2: this.state.academy2,
      academy3: this.state.academy3,
      rank1: this.state.rank1,
      rank2: this.state.rank2,
      selectedRaceName: this._nameFromIndex(this.state.raceUuid, this._races) || this.state.raceName || "",
      selectedClassName: this._nameFromIndex(this.state.classUuid, this._classes) || this.state.className || "",

      characteristics,
      rankForLimiter,

      manualD20: this.state.manualD20,
      manualD12: this.state.manualD12,
      magPotentialText,
      magAffinityText,
      summary
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="next"]').on("click", (ev) => this._onNext(ev));
    html.find('[data-action="back"]').on("click", (ev) => this._onBack(ev));
    html.find('[data-action="cancel"]').on("click", (ev) => this._onCancel(ev));

    html.find('[data-action="roll-d20"]').on("click", (ev) => this._rollD20(ev));
    html.find('[data-action="roll-d12"]').on("click", (ev) => this._rollD12(ev));

    html.find('[data-action="clear-race"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.raceUuid = "";
      this.state.raceName = "";
      this.render(false);
    });

    html.find('[data-action="clear-class"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.classUuid = "";
      this.state.className = "";
      this.render(false);
    });

    this._bindDropzone(html, '[data-drop="race"]', (ev) => this._onDropItem(ev, "Race"));
    this._bindDropzone(html, '[data-drop="class"]', (ev) => this._onDropItem(ev, "Class"));
  }


  _clampCCWPosition() {
    try {
      const p = this.position || {};
      const h = Number(p.height);
      const w = Number(p.width);
      const tooTall = !Number.isFinite(h) || h > 650 || h < 300;
      const tooWide = !Number.isFinite(w) || w > 900 || w < 420;
      if (tooTall || tooWide) this.setPosition({ width: 560, height: 460 });
    } catch (e) {
      // ignore
    }
  }

  _registerUndo(step, fn) {
    this._undo[step] = fn;
  }

  async _undoStep(step) {
    const fn = this._undo?.[step];
    if (typeof fn === "function") {
      try {
        await fn();
      } catch (err) {
        console.error("[Order] CCW undo failed", err);
      }
    }
    if (this._undo) delete this._undo[step];
  }

  _clearLaterStateForStep(step) {
    // When rewinding, clear dependent selections from later steps to avoid stale state.
    if (step <= 2) {
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.manualD20 = "";
      this.state.manualD12 = "";
      this.state.magPotentialRoll = null;
      this.state.magPotentialTier = null;
      this.state.magPotentialBonus = 0;
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
    } else if (step <= 3) {
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.manualD20 = "";
      this.state.manualD12 = "";
      this.state.magPotentialRoll = null;
      this.state.magPotentialTier = null;
      this.state.magPotentialBonus = 0;
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
    } else if (step <= 4) {
      this.state.manualD20 = "";
      this.state.manualD12 = "";
      this.state.magPotentialRoll = null;
      this.state.magPotentialTier = null;
      this.state.magPotentialBonus = 0;
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
    } else if (step <= 5) {
      this.state.manualD12 = "";
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
    }
  }

  _bindDropzone(html, selector, handler) {
    const el = html.find(selector);
    if (!el.length) return;

    el.on("dragover", (ev) => {
      ev.preventDefault();
      el.addClass("is-hover");
    });
    el.on("dragleave", () => el.removeClass("is-hover"));
    el.on("drop", async (ev) => {
      ev.preventDefault();
      el.removeClass("is-hover");
      await handler(ev);
    });
  }

  async _onDropItem(event, expectedType) {
    try {
      const raw = event.originalEvent?.dataTransfer?.getData("text/plain") || event.dataTransfer?.getData("text/plain");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type !== "Item" || !data.uuid) return;

      const doc = await fromUuid(data.uuid);
      if (!doc) return;
      if (doc.type !== expectedType) {
        ui.notifications.warn(`Нужно перетащить Item типа ${expectedType}.`);
        return;
      }

      if (expectedType === "Race") {
        this.state.raceUuid = doc.uuid;
        this.state.raceName = doc.name;
      } else {
        this.state.classUuid = doc.uuid;
        this.state.className = doc.name;
      }
      this.render(false);
    } catch (err) {
      console.error("[Order] Drop failed", err);
    }
  }

  async _onCancel(event) {
    event.preventDefault();
    this.close();
  }

  async _onBack(event) {
    event.preventDefault();

    const noMagic = this.state.magPotentialTier === "Без магии";
    let targetStep;

    // Special case: when магии нет, шаг 6 пропускается, а итог (7) ведёт назад сразу к потенциалу (5).
    if (this.step === 7 && noMagic) targetStep = 5;
    else targetStep = Math.max(0, this.step - 1);

    if (targetStep === 6 && noMagic) targetStep = 5;

    // Roll back any actor-side changes that were applied by the step we're returning to.
    await this._undoStep(targetStep);

    // Clear dependent state from later steps to avoid stale values.
    this._clearLaterStateForStep(targetStep);

    this.step = targetStep;
    return this.render(false);
  }

  async _onNext(event) {
    event.preventDefault();

    // Sync form -> state
    const fd = this._getSubmitData();
    for (const k of Object.keys(this.state)) {
      if (k in fd) this.state[k] = fd[k];
    }

    switch (this.step) {
      case 0:
        this.step = 1;
        return this.render(false);

      case 1:
        if (!this.state.raceUuid) {
          ui.notifications.warn("Сначала выберите или перетащите расу.");
          return;
        }
        await this._applyRace(this.state.raceUuid);
        this.step = 2;
        return this.render(false);

      case 2:
        if (!this.state.classUuid) {
          ui.notifications.warn("Сначала выберите или перетащите класс.");
          return;
        }
        await this._applyClass(this.state.classUuid);
        this.step = 3;
        return this.render(false);

      case 3:
        {
          const picks = [this.state.academy1, this.state.academy2, this.state.academy3];
          const ok = await this._applyAttributePicks(picks, 3);
          if (!ok) return;

          const chosen = picks.filter(Boolean);
          this._registerUndo(3, async () => {
            for (const c of chosen) await this._changeCharacteristic(c, -1);
          });

          this.step = 4;
          return this.render(false);
        }

      case 4:
        {
          // Rank 0 -> 1
          const prevRank = Number(this.actor.system?.Rank ?? this.actor.data?.system?.Rank ?? 0) || 0;
          const rankWasSet = prevRank < 1;
          if (rankWasSet) {
            await this.actor.update({ "data.Rank": 1 });
          }

          const picks = [this.state.rank1, this.state.rank2];
          const ok = await this._applyAttributePicks(picks, 2);
          if (!ok) return;

          const chosen = picks.filter(Boolean);
          this._registerUndo(4, async () => {
            for (const c of chosen) await this._changeCharacteristic(c, -1);
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank });
          });

          this.step = 5;
          return this.render(false);
        }

      case 5:
        {
          const roll = this._readManualRoll(this.state.manualD20, 20) ?? this.state.magPotentialRoll;
          if (!roll) {
            ui.notifications.warn("Сначала киньте d20 или введите значение.");
            return;
          }
          const { tier, bonus } = this._magPotentialFromRoll(roll);
          this.state.magPotentialTier = tier;
          this.state.magPotentialBonus = bonus;

          if (bonus > 0) {
            await this._changeCharacteristic("Magic", bonus);
          }

          const appliedBonus = bonus;
          this._registerUndo(5, async () => {
            if (appliedBonus > 0) await this._changeCharacteristic("Magic", -appliedBonus);
          });

          if (tier === "Без магии") {
            // No affinity roll
            this.state.magAffinityRoll = null;
            this.state.magAffinity = null;
            this.state.manualD12 = "";
            this.step = 7;
          } else {
            this.step = 6;
          }
          return this.render(false);
        }

      case 6:
        {
          // This step should not be reachable when tier is "Без магии".
          if (this.state.magPotentialTier === "Без магии") {
            this.step = 7;
            return this.render(false);
          }

          const roll = this._readManualRoll(this.state.manualD12, 12) ?? this.state.magAffinityRoll;
          if (!roll) {
            ui.notifications.warn("Сначала киньте d12 или введите значение.");
            return;
          }
          this.state.magAffinity = this._magAffinityFromRoll(roll);
          this.step = 7;
          return this.render(false);
        }

      case 7:
        return this.close();
    }
  }

  async _rollD20(event) {
    event.preventDefault();
    const r = await (new Roll("1d20")).roll({ async: true });
    await r.toMessage({ flavor: "Магический потенциал (d20)" });
    const v = Number(r.total) || 0;
    this.state.magPotentialRoll = v;
    this.state.manualD20 = String(v);
    const { tier, bonus } = this._magPotentialFromRoll(v);
    this.state.magPotentialTier = tier;
    this.state.magPotentialBonus = bonus;
    this.render(false);
  }

  async _rollD12(event) {
    event.preventDefault();
    const r = await (new Roll("1d12")).roll({ async: true });
    await r.toMessage({ flavor: "Магическая предрасположенность (d12)" });
    const v = Number(r.total) || 0;
    this.state.magAffinityRoll = v;
    this.state.manualD12 = String(v);
    this.state.magAffinity = this._magAffinityFromRoll(v);
    this.render(false);
  }

  _readManualRoll(value, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < 1 || n > max) return null;
    return Math.floor(n);
  }

  _magPotentialFromRoll(r) {
    if (r >= 1 && r <= 6) return { tier: "Без магии", bonus: 0 };
    if (r >= 7 && r <= 14) return { tier: "Нормальный", bonus: 1 };
    if (r >= 15 && r <= 18) return { tier: "Достойный", bonus: 2 };
    if (r >= 19 && r <= 20) return { tier: "Одаренный", bonus: 3 };
    return { tier: null, bonus: 0 };
  }

  _magAffinityFromRoll(r) {
    const map = {
      1: "Магия Огня",
      2: "Магия Воды",
      3: "Магия Земли",
      4: "Магия Воздуха",
      5: "Магия Молнии",
      6: "Магия Музыки",
      7: "Магия Телекинеза",
      8: "Магия Света",
      9: "Магия Тьмы",
      10: "Магия Колдовства",
      11: "Магия Хаоса",
      12: "Любая (на выбор)"
    };
    return map[r] || null;
  }

  _rankLimiter(rank) {
    const r = Number(rank ?? 0);
    const rr = Number.isFinite(r) ? r : 0;
    return 5 + Math.max(0, rr - 1);
  }

  async _applyAttributePicks(picks, expectedCount) {
    // Validate
    const chosen = picks.filter(Boolean);
    if (chosen.length !== expectedCount) {
      ui.notifications.warn("Заполните все выборы характеристик.");
      return false;
    }
    const unique = new Set(chosen);
    if (unique.size !== chosen.length) {
      ui.notifications.warn("Нельзя выбрать одну и ту же характеристику несколько раз за шаг.");
      return false;
    }

    // Limiter enforcement
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const rank = Number(systemData.Rank ?? 0) || 0;
    const limit = this._rankLimiter(rank);

    for (const char of chosen) {
      const current = Number((this.actor.system?.[char]?.value) ?? (this.actor.data?.system?.[char]?.value) ?? 0) || 0;
      if (current >= limit) {
        const label = game.i18n?.localize?.(char) ?? char;
        ui.notifications.warn(`${label} уже достиг(ла) лимитера +${limit}. Выберите другую характеристику.`);
        return false;
      }
      await this._changeCharacteristic(char, 1);
    }
    return true;
  }

  async _changeCharacteristic(charName, delta) {
    const current = Number((this.actor.system?.[charName]?.value) ?? (this.actor.data?.system?.[charName]?.value) ?? 0) || 0;
    await this.actor.update({ [`data.${charName}.value`]: current + delta });
  }

  async _applyRace(uuid) {
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui.notifications.error("Не удалось найти Item расы.");
      return;
    }
    this.state.raceName = doc.name;

    await this._deleteItemsOfType("Race");

    const data = doc.toObject();
    delete data._id;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if (!created) return;

    await this._applyRaceBonuses(created);
  }

  async _applyClass(uuid) {
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui.notifications.error("Не удалось найти Item класса.");
      return;
    }
    this.state.className = doc.name;

    await this._deleteItemsOfType("Class");

    const data = doc.toObject();
    delete data._id;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if (!created) return;

    // If class has selectable skills
    if (Array.isArray(created.system?.Skills) && created.system.Skills.length > 0) {
      await this._openSkillSelectionDialog(created);
    } else {
      await this._applyClassBonuses(null, created);
    }
  }

  async _deleteItemsOfType(type) {
    const items = this.actor.items.filter(i => i.type === type);
    for (const it of items) {
      await this._revertItemBonuses(it);
      await this.actor.deleteEmbeddedDocuments("Item", [it.id]);
    }
  }

  async _applyRaceBonuses(item) {
    const skills = Array.isArray(item.system?.Skills) ? item.system.Skills : [];
    const selectOne = !!item.system?.selectOneSkill;

    // Add skills from race (all, or one if the flag is enabled)
    if (selectOne && skills.length > 0) {
      const selectedSkill = (skills.length === 1) ? skills[0] : await this._openRaceSkillSelectionDialog(item);
      if (!selectedSkill) {
        // Cancelled: remove the created race to avoid half-applied state
        await this.actor.deleteEmbeddedDocuments("Item", [item.id]);
        return;
      }

      const skillData = foundry.utils.duplicate(selectedSkill);
      delete skillData._id;
      await this.actor.createEmbeddedDocuments("Item", [skillData]);
    } else {
      for (const skill of skills) {
        const skillData = foundry.utils.duplicate(skill);
        delete skillData._id;
        await this.actor.createEmbeddedDocuments("Item", [skillData]);
      }
    }

    const applied = [];
    const bonuses = Array.isArray(item.system?.additionalAdvantages) ? item.system.additionalAdvantages : [];

    for (const bonus of bonuses) {
      if (bonus?.flexible) {
        const res = await this._applyFlexibleRaceBonus(bonus);
        applied.push(...res);
        continue;
      }
      if (bonus?.characters) {
        const res = await this._applyFixedPairBonus(bonus);
        applied.push(...res);
        continue;
      }
      const charName = bonus?.Characteristic;
      const charValue = Number(bonus?.Value) || 0;
      if (!charName || !Number.isFinite(charValue)) continue;
      await this._changeCharacteristic(charName, charValue);
      applied.push({ char: charName, value: charValue });
    }

    await item.update({ "system.appliedBonuses": applied });
  }

  async _applyFlexibleRaceBonus(bonus) {
    const count = Number(bonus?.count ?? 1) || 1;
    const value = Number(bonus?.value ?? 0) || 0;
    const characteristics = [
      "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge",
      "Charisma", "Seduction", "Leadership", "Faith", "Obligation", "Medicine", "Magic", "Stealth"
    ];

    let selects = "";
    for (let i = 0; i < count; i++) {
      selects += `<select class="flex-char" data-index="${i}">` +
        characteristics.map(c => {
          const label = game.i18n?.localize?.(c) ?? c;
          return `<option value="${c}">${label}</option>`;
        }).join("") +
        `</select>`;
    }

    const action = value >= 0 ? "бонус" : "штраф";
    const content = `<form><p>Выберите характеристики, на которые будет применён ${action}:</p>${selects}</form>`;

    return new Promise(resolve => {
      new Dialog({
        title: "Выбор характеристик",
        content,
        buttons: {
          ok: {
            label: "OK",
            callback: async (html) => {
              const result = [];
              const chosen = [];

              for (let i = 0; i < count; i++) {
                const char = html.find(`select[data-index='${i}']`).val();
                if (chosen.includes(char)) {
                  ui.notifications.warn("Выберите разные характеристики.");
                  return false;
                }
                chosen.push(char);
              }

              for (const char of chosen) {
                await this._changeCharacteristic(char, value);
                result.push({ char, value });
              }
              resolve(result);
            }
          }
        },
        default: "ok"
      }).render(true);
    });
  }

  async _applyFixedPairBonus(bonus) {
    const chars = bonus?.characters;
    if (!Array.isArray(chars) || chars.length < 2) return [];
    const [c1, c2] = chars;
    const value = Number(bonus?.value ?? 0) || 0;

    return new Promise(resolve => {
      new Dialog({
        title: "Бонус расы",
        content: `<p>Выберите распределение бонуса:</p>`,
        buttons: {
          first: {
            label: `${value >= 0 ? "+" : ""}${value} к ${c1}`,
            callback: async () => { await this._changeCharacteristic(c1, value); resolve([{ char: c1, value }]); }
          },
          second: {
            label: `${value >= 0 ? "+" : ""}${value} к ${c2}`,
            callback: async () => { await this._changeCharacteristic(c2, value); resolve([{ char: c2, value }]); }
          },
          both: {
            label: `${value >= 0 ? "+" : ""}${value / 2} к ${c1} и ${c2}`,
            callback: async () => {
              await this._changeCharacteristic(c1, value / 2);
              await this._changeCharacteristic(c2, value / 2);
              resolve([{ char: c1, value: value / 2 }, { char: c2, value: value / 2 }]);
            }
          }
        },
        default: "first"
      }).render(true);
    });
  }

  async _revertItemBonuses(item) {
    const applied = item.system?.appliedBonuses;
    if (Array.isArray(applied)) {
      for (const b of applied) {
        await this._changeCharacteristic(b.char, -Number(b.value || 0));
      }
      return;
    }

    const bonuses = Array.isArray(item.system?.additionalAdvantages) ? item.system.additionalAdvantages : [];
    for (const bonus of bonuses) {
      const charName = bonus?.Characteristic;
      const charValue = Number(bonus?.Value) || 0;
      if (!charName) continue;
      await this._changeCharacteristic(charName, -charValue);
    }
  }

  async _openSkillSelectionDialog(classItem) {
    const skills = Array.isArray(classItem.system?.Skills) ? classItem.system.Skills : [];
    const content = `<form>
      <div class="form-group">
        <label for="skills">Выберите навык</label>
        <select id="skills" name="skills">
          ${skills.map(s => `<option value="${s._id}">${s.name}</option>`).join("")}
        </select>
      </div>
    </form>`;

    return new Promise(resolve => {
      new Dialog({
        title: "Выбор навыка",
        content,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: "OK",
            callback: async (html) => {
              await this._applyClassBonuses(html, classItem);
              resolve(true);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Отмена",
            callback: async () => {
              // If player cancels skill selection, remove the created class to avoid half-applied state.
              await this._revertItemBonuses(classItem);
              await this.actor.deleteEmbeddedDocuments("Item", [classItem.id]);
              resolve(false);
            }
          }
        },
        default: "ok"
      }).render(true);
    });
  }

  async _openRaceSkillSelectionDialog(raceItem) {
    const skills = Array.isArray(raceItem.system?.Skills) ? raceItem.system.Skills : [];
    if (!skills.length) return null;

    const content = `<form>
      <div class="form-group">
        <label for="race-skill">Выберите навык расы</label>
        <select id="race-skill" name="race-skill">
          ${skills.map(s => `<option value="${s._id}">${s.name}</option>`).join("")}
        </select>
      </div>
    </form>`;

    return new Promise(resolve => {
      let resolved = false;
      new Dialog({
        title: "Выбор навыка расы",
        content,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: "OK",
            callback: (html) => {
              const selectedId = html.find('select[name="race-skill"]').val();
              resolved = true;
              resolve(skills.find(s => s._id === selectedId) || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Отмена",
            callback: () => {
              resolved = true;
              resolve(null);
            }
          }
        },
        default: "ok",
        close: () => {
          if (!resolved) resolve(null);
        }
      }).render(true);
    });
  }

  async _applyClassBonuses(html, classItem) {
    // Selected skill (optional)
    const skills = Array.isArray(classItem.system?.Skills) ? classItem.system.Skills : [];
    if (html && skills.length > 0) {
      const selectedSkillId = html.find('select[name="skills"]').val();
      const selectedSkill = skills.find(s => s._id === selectedSkillId);
      if (selectedSkill) {
        const skillData = foundry.utils.duplicate(selectedSkill);
        delete skillData._id;
        await this.actor.createEmbeddedDocuments("Item", [skillData]);
      }
    }

    // base perks
    const basePerks = Array.isArray(classItem.system?.basePerks) ? classItem.system.basePerks : [];
    for (const perk of basePerks) {
      const perkData = foundry.utils.duplicate(perk);
      delete perkData._id;
      await this.actor.createEmbeddedDocuments("Item", [perkData]);
    }

    // characteristic bonuses
    const bonuses = Array.isArray(classItem.system?.additionalAdvantages) ? classItem.system.additionalAdvantages : [];
    for (const bonus of bonuses) {
      const charName = bonus?.Characteristic;
      const charValue = Number(bonus?.Value) || 0;
      if (!charName) continue;
      await this._changeCharacteristic(charName, charValue);
    }
  }

  _buildSummary() {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const rank = Number(systemData.Rank ?? 0) || 0;
    const race = this.state.raceName || this._nameFromIndex(this.state.raceUuid, this._races) || "—";
    const cls = this.state.className || this._nameFromIndex(this.state.classUuid, this._classes) || "—";

    const academy = "3 очка характеристик + 1 очко маг. прокачки (текстом)";
    const rankText = `Ранг ${rank} (2 очка характеристик + 1 маг. прокачка + 1 классовый навык — текстом)`;

    const magPotential = this.state.magPotentialTier
      ? `${this.state.magPotentialTier}${this.state.magPotentialBonus ? ` (+${this.state.magPotentialBonus} к Магии)` : ""}`
      : "—";

    const magAffinity = this.state.magPotentialTier === "Без магии"
      ? "Без магии"
      : (this.state.magAffinity || "—");

    return {
      race,
      class: cls,
      academy,
      rank: rankText,
      magPotential,
      magAffinity
    };
  }
}
