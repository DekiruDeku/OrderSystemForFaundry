/*
 * Rank-Up Wizard for Order system (Foundry VTT v11).
 *
 * Flow:
 *  1) Choose 2 different characteristics (+1 each, preserves filledSegments)
 *  2) 1 point of magic progression: add a new Spell OR level up an existing Spell
 *  3) 1 point of class skill: add a new Skill/Perk OR level up an existing one (excluding racial)
 *
 * Notes:
 *  - For Skills/Spells, filledSegments are preserved on level-up except when reaching max level.
 */

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export class OrderRankUpWizard extends FormApplication {
  constructor(actor, options = {}) {
    super(actor, options);
    this.actor = actor;
    this.step = 0;

    this.state = {
      // step 0
      stat1: "",
      stat2: "",

      // step 1
      spellNewUuid: "",
      spellNewName: "",
      spellUpgradeId: "",
      magicResult: "",

      // step 2
      skillNewUuid: "",
      skillNewName: "",
      skillUpgradeId: "",
      skillResult: "",

      // summary
      oldRank: null,
      newRank: null,
      statsResult: "",
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "order-rank-up-wizard",
      classes: ["Order", "app", "os-ccw", "os-rankup"],
      title: "Повышение ранга",
      template: "systems/Order/templates/apps/rank-up-wizard.hbs",
      width: 600,
      height: 520,
      minWidth: 540,
      minHeight: 420,
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: true
    });
  }

  get stepTotal() {
    return 4;
  }

  _rankLimiter(rank) {
    const r = num(rank, 0);
    return 5 + Math.max(0, r - 1);
  }

  _getMaxLevelForCircle(circle) {
    const map = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
    return map[num(circle, 0)] ?? 0;
  }

  _calculateSegmentsForItem(item, level, circle) {
    const c = num(circle, 0);
    const lvl = num(level, 0);
    if (!Number.isFinite(c) || !Number.isFinite(lvl) || lvl < 0) return 0;

    const max = this._getMaxLevelForCircle(c);
    if (max > 0 && lvl >= max) return 0;

    // Perk skills can define a custom training requirement for level 0.
    const isPerkSkill = item?.type === "Skill" && !!item.system?.isPerk;
    if (isPerkSkill && lvl === 0) {
      const raw = num(item.system?.perkTrainingPoints ?? 0, 0);
      if (raw > 0) return Math.trunc(raw);
    }

    if (c === 0) {
      const table0 = [8, 10, 12];
      return table0[lvl] ?? 0;
    }

    const base = 10 + 2 * c;
    return base + 2 * Math.floor(lvl / 2);
  }

  getData(options = {}) {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const currentRank = num(systemData.Rank ?? 0, 0);
    const newRank = currentRank + 1;

    if (this.state.oldRank === null) this.state.oldRank = currentRank;
    if (this.state.newRank === null) this.state.newRank = newRank;

    const characteristicsKeys = [
      "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge",
      "Charisma", "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
    ];
    const characteristics = characteristicsKeys
      .filter(k => systemData[k] && typeof systemData[k] === "object")
      .map(k => ({
        key: k,
        label: game.i18n?.localize?.(k) ?? k,
        value: num(systemData[k]?.value ?? 0, 0)
      }));

    const spells = (this.actor.items?.filter(i => i.type === "Spell") ?? []).map(sp => {
      const circle = num(sp.system?.Circle ?? 0, 0);
      const level = num(sp.system?.Level ?? 0, 0);
      const max = this._getMaxLevelForCircle(circle);
      const filled = num(sp.system?.filledSegments ?? 0, 0);
      const total = this._calculateSegmentsForItem(sp, level, circle);
      return {
        id: sp.id,
        name: sp.name,
        circle,
        level,
        max,
        filled,
        total,
        isMax: max > 0 && level >= max
      };
    });

    const skills = (this.actor.items?.filter(i => i.type === "Skill") ?? [])
      .filter(sk => !sk.system?.isRacial)
      .map(sk => {
        const circle = num(sk.system?.Circle ?? 0, 0);
        const level = num(sk.system?.Level ?? 0, 0);
        const max = this._getMaxLevelForCircle(circle);
        const filled = num(sk.system?.filledSegments ?? 0, 0);
        const total = this._calculateSegmentsForItem(sk, level, circle);
        return {
          id: sk.id,
          name: sk.name,
          circle,
          level,
          max,
          filled,
          total,
          isPerk: !!sk.system?.isPerk,
          isMax: max > 0 && level >= max
        };
      });

    const stepTitleMap = {
      0: "Характеристики",
      1: "Маг. прокачка",
      2: "Классовый навык",
      3: "Итог"
    };

    const nextLabel = this.step >= 3 ? "Готово" : "Далее";

    return {
      ...super.getData(options),
      step: this.step,
      stepTotal: this.stepTotal,
      stepHuman: this.step + 1,
      stepTitle: stepTitleMap[this.step] ?? "",

      nextLabel,
      canSkip: this.step === 1 || this.step === 2,

      isStats: this.step === 0,
      isMagic: this.step === 1,
      isSkill: this.step === 2,
      isSummary: this.step === 3,

      oldRank: currentRank,
      newRank,
      limiterNow: this._rankLimiter(currentRank),
      limiterNew: this._rankLimiter(newRank),

      characteristics,
      stat1: this.state.stat1,
      stat2: this.state.stat2,

      spells,
      spellNewName: this.state.spellNewName,
      spellUpgradeId: this.state.spellUpgradeId,

      skills,
      skillNewName: this.state.skillNewName,
      skillUpgradeId: this.state.skillUpgradeId,

      summary: {
        stats: this.state.statsResult || "—",
        magic: this.state.magicResult || "—",
        skill: this.state.skillResult || "—",
      }
    };
  }

  async _updateObject(event, formData) {
    // Keep local state up to date when submitOnChange is enabled.
    if (typeof formData !== "object" || !formData) return;

    for (const k of Object.keys(this.state)) {
      if (k in formData) this.state[k] = formData[k];
    }

    // Mutual exclusion UX: selecting an upgrade clears the drop selection and vice versa.
    if ("spellUpgradeId" in formData && this.state.spellUpgradeId) {
      this.state.spellNewUuid = "";
      this.state.spellNewName = "";
    }
    if ("skillUpgradeId" in formData && this.state.skillUpgradeId) {
      this.state.skillNewUuid = "";
      this.state.skillNewName = "";
    }
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="next"]').on("click", (ev) => this._onNext(ev));
    html.find('[data-action="skip"]').on("click", (ev) => this._onSkip(ev));
    html.find('[data-action="cancel"]').on("click", (ev) => this._onCancel(ev));

    html.find('[data-action="clear-spell"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.spellNewUuid = "";
      this.state.spellNewName = "";
      this.render(false);
    });
    html.find('[data-action="clear-skill"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.skillNewUuid = "";
      this.state.skillNewName = "";
      this.render(false);
    });

    this._bindDropzone(html, '.os-ccw-dropzone[data-drop="spell"]', (ev) => this._onDropItem(ev, "Spell"));
    this._bindDropzone(html, '.os-ccw-dropzone[data-drop="skill"]', (ev) => this._onDropItem(ev, "Skill"));
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

      if (expectedType === "Spell") {
        this.state.spellNewUuid = doc.uuid;
        this.state.spellNewName = doc.name;
        // If new spell selected, clear upgrade selection.
        this.state.spellUpgradeId = "";
      } else {
        this.state.skillNewUuid = doc.uuid;
        this.state.skillNewName = doc.name;
        this.state.skillUpgradeId = "";
      }

      this.render(false);
    } catch (err) {
      console.error("[Order] RankUp drop failed", err);
    }
  }

  async _onCancel(event) {
    event.preventDefault();
    this.close();
  }

  async _onSkip(event) {
    event.preventDefault();

    if (this.step === 1) {
      this.state.spellNewUuid = "";
      this.state.spellNewName = "";
      this.state.spellUpgradeId = "";
      this.state.magicResult = "Пропущено";
      this.step = 2;
      return this.render(false);
    }

    if (this.step === 2) {
      this.state.skillNewUuid = "";
      this.state.skillNewName = "";
      this.state.skillUpgradeId = "";
      this.state.skillResult = "Пропущено";
      this.step = 3;
      return this.render(false);
    }
  }

  async _onNext(event) {
    event.preventDefault();
    if (!this.actor?.isOwner) {
      ui.notifications.warn("Недостаточно прав для изменения персонажа.");
      return;
    }

    switch (this.step) {
      case 0:
        return this._applyStatsAndRank();
      case 1:
        return this._applyMagicPoint();
      case 2:
        return this._applySkillPoint();
      case 3:
      default:
        return this.close();
    }
  }

  async _applyStatsAndRank() {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const oldRank = num(systemData.Rank ?? 0, 0);
    const newRank = oldRank + 1;

    const picks = [String(this.state.stat1 || ""), String(this.state.stat2 || "")].filter(Boolean);
    if (picks.length !== 2) {
      ui.notifications.warn("Выберите 2 разные характеристики.");
      return;
    }
    const unique = new Set(picks);
    if (unique.size !== 2) {
      ui.notifications.warn("Нельзя вложить оба очка в одну характеристику.");
      return;
    }

    // Enforce limiter for the NEW rank.
    const limit = this._rankLimiter(newRank);
    for (const key of picks) {
      const current = num(systemData?.[key]?.value ?? 0, 0);
      if (current >= limit) {
        const label = game.i18n?.localize?.(key) ?? key;
        ui.notifications.warn(`${label} уже достиг(ла) лимитера +${limit}. Выберите другую характеристику.`);
        return;
      }
    }

    // 1) Increase Rank
    const update = {
      "data.Rank": newRank,
      "system.Rank": newRank
    };

    // 2) Apply +1 to each chosen characteristic (keeps filledSegments unchanged)
    for (const key of picks) {
      const current = num(systemData?.[key]?.value ?? 0, 0);
      update[`data.${key}.value`] = current + 1;
      update[`system.${key}.value`] = current + 1;
    }

    await this.actor.update(update);

    const labels = picks.map(k => game.i18n?.localize?.(k) ?? k);
    this.state.statsResult = `Ранг ${oldRank} → ${newRank}; +1 к ${labels[0]} и +1 к ${labels[1]}`;

    this.step = 1;
    return this.render(false);
  }

  async _applyMagicPoint() {
    // Mutually exclusive
    if (this.state.spellNewUuid && this.state.spellUpgradeId) {
      ui.notifications.warn("Выберите: либо новое заклинание (перетащить), либо повышение существующего.");
      return;
    }

    if (!this.state.spellNewUuid && !this.state.spellUpgradeId) {
      ui.notifications.warn("Выберите действие для маг. прокачки или нажмите «Пропустить». ");
      return;
    }

    if (this.state.spellNewUuid) {
      const created = await this._createEmbeddedItemFromUuid(this.state.spellNewUuid, "Spell");
      if (!created) return;
      this.state.magicResult = `Новое заклинание: ${created.name}`;
      this.step = 2;
      return this.render(false);
    }

    if (this.state.spellUpgradeId) {
      const item = this.actor.items?.get(this.state.spellUpgradeId);
      if (!item || item.type !== "Spell") {
        ui.notifications.warn("Не удалось найти выбранное заклинание.");
        return;
      }
      const ok = await this._levelUpEmbeddedItemKeepingProgress(item);
      if (!ok) return;
      this.state.magicResult = `Повышен уровень: ${item.name}`;
      this.step = 2;
      return this.render(false);
    }
  }

  async _applySkillPoint() {
    if (this.state.skillNewUuid && this.state.skillUpgradeId) {
      ui.notifications.warn("Выберите: либо новый навык/перк (перетащить), либо повышение существующего.");
      return;
    }

    if (!this.state.skillNewUuid && !this.state.skillUpgradeId) {
      ui.notifications.warn("Выберите действие для классового навыка или нажмите «Пропустить». ");
      return;
    }

    if (this.state.skillNewUuid) {
      const created = await this._createEmbeddedItemFromUuid(this.state.skillNewUuid, "Skill");
      if (!created) return;
      this.state.skillResult = `Новый навык/перк: ${created.name}`;
      this.step = 3;
      return this.render(false);
    }

    if (this.state.skillUpgradeId) {
      const item = this.actor.items?.get(this.state.skillUpgradeId);
      if (!item || item.type !== "Skill") {
        ui.notifications.warn("Не удалось найти выбранный навык/перк.");
        return;
      }
      if (item.system?.isRacial) {
        ui.notifications.warn("Расовые навыки нельзя повышать за очко классового навыка.");
        return;
      }
      const ok = await this._levelUpEmbeddedItemKeepingProgress(item);
      if (!ok) return;
      this.state.skillResult = `Повышен уровень: ${item.name}`;
      this.step = 3;
      return this.render(false);
    }
  }

  async _createEmbeddedItemFromUuid(uuid, expectedType) {
    try {
      const doc = await fromUuid(uuid);
      if (!doc) {
        ui.notifications.warn("Не удалось найти Item по UUID.");
        return null;
      }
      if (doc.type !== expectedType) {
        ui.notifications.warn(`Нужно выбрать Item типа ${expectedType}.`);
        return null;
      }

      const data = doc.toObject();
      delete data._id;

      const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
      if (!created) {
        ui.notifications.warn("Не удалось добавить Item в персонажа.");
        return null;
      }
      return created;
    } catch (e) {
      console.error("[Order] createEmbeddedItemFromUuid failed", e);
      ui.notifications.error("Ошибка при добавлении Item.");
      return null;
    }
  }

  async _levelUpEmbeddedItemKeepingProgress(item) {
    try {
      const circle = num(item.system?.Circle ?? 0, 0);
      const max = this._getMaxLevelForCircle(circle);
      const oldLevel = num(item.system?.Level ?? 0, 0);

      if (max > 0 && oldLevel >= max) {
        ui.notifications.warn("Этот предмет уже достиг максимального уровня.");
        return false;
      }

      const newLevel = oldLevel + 1;
      const oldFilled = num(item.system?.filledSegments ?? 0, 0);
      const filled = (max > 0 && newLevel >= max) ? 0 : oldFilled;

      // IMPORTANT:
      // We update the item first to let the global LevelUpSummary dialog appear.
      // The item sheet must open only AFTER the level-up summary; otherwise the summary
      // can be hidden/never shown due to focus order.
      await item.update(
        {
          "system.Level": Math.min(newLevel, max || newLevel),
          "system.filledSegments": filled
        },
        { osRankUpOpenSheet: true }
      );

      return true;
    } catch (e) {
      console.error("[Order] levelUpEmbeddedItemKeepingProgress failed", e);
      ui.notifications.error("Ошибка при повышении уровня.");
      return false;
    }
  }
}
