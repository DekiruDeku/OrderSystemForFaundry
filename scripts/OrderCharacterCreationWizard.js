/*
 * Character Creation Wizard for Order system (Foundry VTT v11).
 * Non-invasive: only runs when user opts in.
 */

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
      classUsesPerkPoints: false,

      academy1: "",
      academy2: "",
      academy3: "",

      rank1: "",
      rank2: "",

      specializedCourseSelections: {},
      allocatedPerkNames: [],

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

    // Classes: world items + compendiums (как раньше)
    this._classes = game.items.filter(i => i.type === "Class").map(i => ({ uuid: i.uuid, name: i.name }));

    // Races: prefer the dedicated races compendium (Order.rasy) for the dropdown in the wizard.
    let racePack =
      game.packs.get("Order.rasy") ||
      game.packs.get("world.rasy") ||
      Array.from(game.packs).find(p =>
        p.documentName === "Item" &&
        (p.metadata?.name === "rasy" || /расы/i.test(p.metadata?.label ?? ""))
      );

    const raceSet = new Set();
    this._races = [];

    if (racePack) {
      const index = await racePack.getIndex();
      for (const e of index) {
        if (e.type !== "Race") continue;
        if (raceSet.has(e.uuid)) continue;
        raceSet.add(e.uuid);
        this._races.push({ uuid: e.uuid, name: e.name });
      }
    }

    // Fallback (so the wizard does not break if the compendium pack is absent or empty)
    if (!racePack || this._races.length === 0) {
      if (racePack && this._races.length === 0) {
        console.warn("[Order] CCW: races compendium pack is empty, falling back to world/other packs");
        racePack = null;
      }

      this._races = [];
      raceSet.clear();

      for (const i of game.items.filter(i => i.type === "Race")) {
        if (raceSet.has(i.uuid)) continue;
        raceSet.add(i.uuid);
        this._races.push({ uuid: i.uuid, name: i.name });
      }
    }

    // Compendiums
    try {
      const classSet = new Set(this._classes.map(e => e.uuid));

      for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;
        if (racePack && pack.collection === racePack.collection) {
          // we already indexed races from the dedicated pack above
          continue;
        }

        const index = await pack.getIndex();
        for (const e of index) {
          if (e.type === "Class") {
            if (classSet.has(e.uuid)) continue;
            classSet.add(e.uuid);
            this._classes.push({ uuid: e.uuid, name: e.name });
            continue;
          }

          // Only add races from other sources if we don't have a dedicated races pack.
          if (!racePack && e.type === "Race") {
            if (raceSet.has(e.uuid)) continue;
            raceSet.add(e.uuid);
            this._races.push({ uuid: e.uuid, name: e.name });
          }
        }
      }
    } catch (err) {
      console.warn("[Order] CCW index compendiums failed", err);
    }

    this._races.sort((a, b) => a.name.localeCompare(b.name));
    this._classes.sort((a, b) => a.name.localeCompare(b.name));
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

  get stepFlow() {
    const noMagic = this.state.magPotentialTier === "Без магии";
    const withPerks = !!this.state.classUsesPerkPoints;
    // 0 Intro, 1 MagPotential, 2 MagAffinity (optional), 3 Race, 4 Class, 5 PerkPoints (optional), 6 Academy, 7 Rank, 8 Summary
    if (noMagic) return withPerks ? [0, 1, 3, 4, 5, 6, 7, 8] : [0, 1, 3, 4, 6, 7, 8];
    return withPerks ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 6, 7, 8];
  }

  get stepTotal() {
    return this.stepFlow.length;
  }

  async getData(options = {}) {
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
    const perkAllocation = await this._getPerkAllocationData();

    const stepTitleMap = {
      0: "Старт",
      1: "Магический потенциал",
      2: "Предрасположенность",
      3: "Раса",
      4: "Класс",
      5: "Распределение О.П.",
      6: "Академия",
      7: "Повышение ранга",
      8: "Итог"
    };

    const stepTitle = stepTitleMap[this.step] ?? "";
    const flow = this.stepFlow;
    const idx = flow.indexOf(this.step);
    const stepHuman = idx >= 0 ? (idx + 1) : Math.min(this.step + 1, flow.length);
    const nextLabel = this.step >= 8 ? "Готово" : (this.step === 0 ? "Начать" : "Далее");
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
      isMagPotential: this.step === 1,
      isMagAffinity: this.step === 2 && !isNoMagic,
      isRace: this.step === 3,
      isClass: this.step === 4,
      isPerkPoints: this.step === 5 && this.state.classUsesPerkPoints,
      isAcademy: this.step === 6,
      isRankUp: this.step === 7,
      isSummary: this.step === 8,

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
      perkAllocation,
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
      this.state.classUsesPerkPoints = false;
      this.state.specializedCourseSelections = {};
      this.render(false);
    });

    html.find('[data-action="skip-perk-points"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.specializedCourseSelections = {};
      this._onNext(ev);
    });

    html.find('[data-action="course-entry-add"]').on("click", async (ev) => {
      ev.preventDefault();
      const courseId = String(ev.currentTarget?.dataset?.courseId || "");
      if (!courseId) return;

      const allocation = await this._getPerkAllocationData();
      const course = (allocation.courses || []).find(entry => entry.id === courseId);
      if (!course) return;

      const cost = Number(course.cost) || 0;
      if (cost > allocation.remaining) {
        ui.notifications.warn("Недостаточно О.П. для этого выбора.");
        return;
      }

      const next = foundry.utils.duplicate(this.state.specializedCourseSelections || {});
      const current = next[courseId] || { count: 0, picks: [] };
      if (course.grantAll && current.count >= 1) {
        ui.notifications.warn("Этот вариант можно взять только один раз.");
        return;
      }

      current.count = Math.max(0, Number(current.count || 0)) + 1;
      current.picks = Array.isArray(current.picks) ? current.picks : [];
      while (current.picks.length < current.count) current.picks.push("");
      next[courseId] = current;
      this.state.specializedCourseSelections = next;
      this.render(false);
    });

    html.find('[data-action="course-entry-remove"]').on("click", (ev) => {
      ev.preventDefault();
      const courseId = String(ev.currentTarget?.dataset?.courseId || "");
      if (!courseId) return;

      const next = foundry.utils.duplicate(this.state.specializedCourseSelections || {});
      const current = next[courseId];
      if (!current) return;

      const count = Math.max(0, Number(current.count || 0) - 1);
      if (count <= 0) {
        delete next[courseId];
      } else {
        current.count = count;
        current.picks = Array.isArray(current.picks) ? current.picks.slice(0, count) : [];
        next[courseId] = current;
      }

      this.state.specializedCourseSelections = next;
      this.render(false);
    });

    html.find('[data-action="course-entry-pick"]').on("change", (ev) => {
      const courseId = String(ev.currentTarget?.dataset?.courseId || "");
      if (!courseId) return;
      const pickIndex = Math.max(0, Number(ev.currentTarget?.dataset?.pickIndex ?? 0) || 0);
      const next = foundry.utils.duplicate(this.state.specializedCourseSelections || {});
      const current = next[courseId] || { count: pickIndex + 1, picks: [] };
      current.count = Math.max(Number(current.count || 0), pickIndex + 1);
      current.picks = Array.isArray(current.picks) ? current.picks : [];
      while (current.picks.length < current.count) current.picks.push("");
      current.picks[pickIndex] = String(ev.currentTarget?.value || "");
      next[courseId] = current;
      this.state.specializedCourseSelections = next;
    });

    html.find('[data-action="course-folder-pick"]').on("change", async (ev) => {
      const courseId = String(ev.currentTarget?.dataset?.courseId || "");
      if (!courseId) return;

      const level = Math.max(0, Number(ev.currentTarget?.dataset?.level ?? 0) || 0);
      const value = String(ev.currentTarget?.value || "");
      const courseRaw = this._getSpecializedCourseEntries().find(entry => entry.id === courseId);
      if (!courseRaw) return;

      const next = foundry.utils.duplicate(this.state.specializedCourseSelections || {});
      const current = next[courseId] || { count: 0, picks: [] };
      const basePath = Array.isArray(current.folderPath)
        ? current.folderPath.map(v => String(v || "")).filter(Boolean)
        : (Array.isArray(courseRaw.folderPath) ? courseRaw.folderPath.map(v => String(v || "")).filter(Boolean) : []);

      const path = basePath.slice(0, level);
      if (level === 0) {
        if (value === "__root__") path.push("__root__");
        else if (value) path.push(value);
      } else if (value && value !== "__stay__") {
        path.push(value);
      }

      current.folderPath = path;
      current.picks = [];
      next[courseId] = current;
      this.state.specializedCourseSelections = next;
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
    if (step <= 0) {
      this.state.raceUuid = "";
      this.state.classUuid = "";
      this.state.raceName = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";

      this.state.rank1 = "";
      this.state.rank2 = "";

      this.state.specializedCourseSelections = {};
      this.state.allocatedPerkNames = [];

      this.state.magPotentialRoll = null;
      this.state.magPotentialTier = null;
      this.state.magPotentialBonus = 0;
      this.state.manualD20 = "";

      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
      this.state.manualD12 = "";
      return;
    }

    if (step <= 1) {
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
      this.state.manualD12 = "";

      this.state.raceUuid = "";
      this.state.raceName = "";
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;

      this.state.specializedCourseSelections = {};
      this.state.allocatedPerkNames = [];

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      return;
    }

    if (step <= 2) {
      this.state.raceUuid = "";
      this.state.raceName = "";
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;

      this.state.specializedCourseSelections = {};
      this.state.allocatedPerkNames = [];

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      return;
    }

    if (step <= 3) {
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;
      this.state.specializedCourseSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      return;
    }

    if (step <= 4) {
      this.state.specializedCourseSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      return;
    }

    if (step <= 5) {
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      return;
    }

    if (step <= 6) {
      this.state.rank1 = "";
      this.state.rank2 = "";
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

    const flow = this.stepFlow;
    const idx = flow.indexOf(this.step);
    const targetStep = idx > 0 ? flow[idx - 1] : 0;

    await this._undoStep(targetStep);
    this._clearLaterStateForStep(targetStep);

    this.step = targetStep;
    return this.render(false);
  }

  async _onNext(event) {
    event.preventDefault();

    const fd = this._getSubmitData();
    for (const k of Object.keys(this.state)) {
      if (k in fd) this.state[k] = fd[k];
    }

    switch (this.step) {
      case 0:
        this.step = 1;
        return this.render(false);

      case 1:
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
          this._registerUndo(1, async () => {
            if (appliedBonus > 0) await this._changeCharacteristic("Magic", -appliedBonus);
          });

          if (tier === "Без магии") {
            this.state.magAffinityRoll = null;
            this.state.magAffinity = null;
            this.state.manualD12 = "";
            this.step = 3;
          } else {
            this.step = 2;
          }
          return this.render(false);
        }

      case 2:
        {
          if (this.state.magPotentialTier === "Без магии") {
            this.step = 3;
            return this.render(false);
          }

          const roll = this._readManualRoll(this.state.manualD12, 12) ?? this.state.magAffinityRoll;
          if (!roll) {
            ui.notifications.warn("Сначала киньте d12 или введите значение.");
            return;
          }
          this.state.magAffinity = this._magAffinityFromRoll(roll);
          this.step = 3;
          return this.render(false);
        }

      case 3:
        if (!this.state.raceUuid) {
          ui.notifications.warn("Сначала выберите или перетащите расу.");
          return;
        }
        await this._applyRace(this.state.raceUuid);
        this.step = 4;
        return this.render(false);

      case 4:
        if (!this.state.classUuid) {
          ui.notifications.warn("Сначала выберите или перетащите класс.");
          return;
        }
        {
          const applied = await this._applyClass(this.state.classUuid);
          if (!applied) return;
          this.step = this.state.classUsesPerkPoints ? 5 : 6;
          return this.render(false);
        }

      case 5:
        {
          const created = await this._applyPerkPointSelections();
          if (created === false) return;

          const createdIds = Array.isArray(created) ? created.map(i => i.id).filter(Boolean) : [];
          const createdNames = Array.isArray(created) ? created.map(i => i.name).filter(Boolean) : [];
          this.state.allocatedPerkNames = createdNames;

          this._registerUndo(5, async () => {
            if (createdIds.length) {
              await this.actor.deleteEmbeddedDocuments("Item", createdIds);
            }
          });

          this.step = 6;
          return this.render(false);
        }

      case 6:
        {
          const picks = [this.state.academy1, this.state.academy2, this.state.academy3];
          const ok = await this._applyAttributePicks(picks, 3);
          if (!ok) return;

          const chosen = picks.filter(Boolean);
          this._registerUndo(6, async () => {
            for (const c of chosen) await this._changeCharacteristic(c, -1);
          });

          this.step = 7;
          return this.render(false);
        }

      case 7:
        {
          const prevRank = Number(this.actor.system?.Rank ?? this.actor.data?.system?.Rank ?? 0) || 0;
          const rankWasSet = prevRank < 1;
          if (rankWasSet) {
            await this.actor.update({ "data.Rank": 1 });
          }

          const picks = [this.state.rank1, this.state.rank2];
          const ok = await this._applyAttributePicks(picks, 2);
          if (!ok) return;

          const chosen = picks.filter(Boolean);
          this._registerUndo(7, async () => {
            for (const c of chosen) await this._changeCharacteristic(c, -1);
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank });
          });

          this.step = 8;
          return this.render(false);
        }

      case 8:
        try {
          await this.actor.setFlag("Order", "characterCreationWizardUsed", true);
        } catch (err) {
          console.warn("[Order] Failed to mark Character Creation wizard as used", err);
        }
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
      return false;
    }
    this.state.className = doc.name;
    this.state.classUsesPerkPoints = this._classHasPerkAllocation(doc);
    this.state.specializedCourseSelections = {};
    this.state.allocatedPerkNames = [];

    await this._deleteItemsOfType("Class");

    const data = doc.toObject();
    delete data._id;
    const [created] = await this.actor.createEmbeddedDocuments("Item", [data]);
    if (!created) return false;

    if (Array.isArray(created.system?.Skills) && created.system.Skills.length > 0) {
      return await this._openSkillSelectionDialog(created);
    }

    await this._applyClassBonuses(null, created);
    return true;
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
      if (Array.isArray(bonus?.options) && bonus.options.length) {
        const res = await this._applyAlternativeRaceBonus(bonus);
        applied.push(...res);
        continue;
      }

      // "Выбрать при переносе" (flexible bonus): ask the player to pick N characteristics.
      // In the Race sheet this is stored as a single bonus object with { flexible: true, value, count }.
      // (Alternative bonuses are handled above via bonus.options.)
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

  
  _formatRaceBonusOption(option) {
    const o = option || {};
    const sign = (v) => (Number(v) >= 0 ? "+" : "");

    if (o.flexible) {
      const value = Number(o.value ?? o.Value ?? 0) || 0;
      const count = Number(o.count ?? 1) || 1;
      const word = count === 1 ? "характеристику" : (count >= 2 && count <= 4 ? "характеристики" : "характеристик");
      return `${sign(value)}${value} к ${count} ${word}`;
    }

    if (Array.isArray(o.characters) && o.characters.length) {
      const value = Number(o.value ?? o.Value ?? 0) || 0;
      const [c1, c2] = o.characters;
      const l1 = game.i18n?.localize?.(c1) ?? c1;
      const l2 = game.i18n?.localize?.(c2) ?? c2;
      return `${sign(value)}${value} к ${l1}${l2 ? ` / ${l2}` : ""}`;
    }

    if (o.Characteristic) {
      const value = Number(o.Value ?? o.value ?? 0) || 0;
      const label = game.i18n?.localize?.(o.Characteristic) ?? o.Characteristic;
      return `${label} ${sign(value)}${value}`;
    }

    return String(o?.label ?? o?.name ?? "Вариант");
  }

  async _applyAlternativeRaceBonus(bonus) {
    const options = Array.isArray(bonus?.options) ? bonus.options : (Array.isArray(bonus?.alternative) ? bonus.alternative : []);
    if (!options.length) return [];

    const content = `<p>Выберите вариант бонуса:</p>`;

    return new Promise(resolve => {
      const buttons = {};
      options.forEach((opt, idx) => {
        buttons[`opt_${idx}`] = {
          label: this._formatRaceBonusOption(opt),
          callback: async () => {
            let res = [];
            if (opt?.flexible) res = await this._applyFlexibleRaceBonus(opt);
            else if (opt?.characters) res = await this._applyFixedPairBonus(opt);
            else if (opt?.Characteristic) {
              const charName = opt.Characteristic;
              const charValue = Number(opt.Value ?? opt.value ?? 0) || 0;
              if (charName && Number.isFinite(charValue)) {
                await this._changeCharacteristic(charName, charValue);
                res = [{ char: charName, value: charValue }];
              }
            }
            resolve(res);
          }
        };
      });

      new Dialog({
        title: "Бонус расы",
        content,
        buttons,
        default: Object.keys(buttons)[0]
      }).render(true);
    });
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

    const basePerks = Array.isArray(classItem.system?.basePerks) ? classItem.system.basePerks : [];
    for (const perk of basePerks) {
      const perkData = foundry.utils.duplicate(perk);
      delete perkData._id;
      await this.actor.createEmbeddedDocuments("Item", [perkData]);
    }

    const bonuses = Array.isArray(classItem.system?.additionalAdvantages) ? classItem.system.additionalAdvantages : [];
    for (const bonus of bonuses) {
      const charName = bonus?.Characteristic;
      const charValue = Number(bonus?.Value) || 0;
      if (!charName) continue;
      await this._changeCharacteristic(charName, charValue);
    }
  }

  _getClassItem() {
    return this.actor.items.find(i => i.type === "Class") || null;
  }

  _normalizeSpecializedCourseEntry(course = {}) {
    const folderPath = Array.isArray(course.folderPath)
      ? course.folderPath.map(v => String(v || "")).filter(Boolean)
      : (course.folderId ? [String(course.folderId)] : []);

    return {
      id: String(course.id || foundry.utils.randomID()),
      packCollection: String(course.packCollection || ""),
      folderId: String(course.folderId || folderPath[folderPath.length - 1] || ""),
      folderName: String(course.folderName || ""),
      folderPath,
      grantAllFromFolder: !!course.grantAllFromFolder,
      allowFolderChoiceInWizard: !!course.allowFolderChoiceInWizard,
      cost: Math.max(0, Number(course.cost ?? 0) || 0)
    };
  }

  _getSpecializedCourseEntries(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    const rows = Array.isArray(system?.specializedFighterCourses)
      ? system.specializedFighterCourses.map(course => this._normalizeSpecializedCourseEntry(course))
      : [];

    if (rows.length) return rows;

    const legacy = system?.specializedFighterCourse ?? {};
    const hasLegacyData = !!(
      legacy.packCollection ||
      legacy.folderId ||
      legacy.folderName ||
      legacy.grantAllFromFolder ||
      legacy.allowFolderChoiceInWizard ||
      Number(legacy.cost ?? 0)
    );

    return hasLegacyData ? [this._normalizeSpecializedCourseEntry(legacy)] : [];
  }

  _classHasPerkAllocation(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    const budget = Number(system?.perkPointBudget ?? 0) || 0;
    return budget > 0 || this._getSpecializedCourseEntries(system).length > 0;
  }

  _getPackLabel(collection) {
    if (!collection) return "";
    const pack = game.packs.get(collection);
    return pack?.metadata?.label || pack?.title || collection;
  }

  _getFolderParentId(folder) {
    const rawParent = folder?.folder ?? folder?.parentFolder ?? folder?.parent ?? null;
    if (!rawParent) return "";
    if (typeof rawParent === "string") return String(rawParent || "");
    return String(rawParent.id || "");
  }

  _registerFolderMeta(metaMap, folder) {
    let current = folder;
    while (current) {
      const currentId = String(current.id || "");
      if (!currentId) break;
      if (!metaMap.has(currentId)) {
        metaMap.set(currentId, {
          id: currentId,
          name: String(current.name || "Без названия"),
          parentId: this._getFolderParentId(current)
        });
      }
      current = current.folder ?? current.parentFolder ?? current.parent ?? null;
      if (typeof current === "string") break;
    }
  }

  async _getPerkCompendiumFolderTree(packCollection) {
    if (!packCollection) return { hasRootPerks: false, byParent: new Map(), byId: new Map() };
    const pack = game.packs.get(packCollection);
    if (!pack) return { hasRootPerks: false, byParent: new Map(), byId: new Map() };

    try {
      const docs = await pack.getDocuments();
      const perkDocs = docs.filter(doc => doc?.type === "Skill" && doc?.system?.isPerk);
      const byId = new Map();
      const hasRootPerks = perkDocs.some(doc => !doc.folder);

      for (const doc of perkDocs) {
        if (doc.folder) this._registerFolderMeta(byId, doc.folder);
      }

      const packFolders = Array.isArray(pack.folders?.contents)
        ? pack.folders.contents
        : (Array.isArray(pack.folders) ? pack.folders : []);

      for (const folder of packFolders) {
        this._registerFolderMeta(byId, folder);
      }

      const byParent = new Map();
      for (const folder of byId.values()) {
        const parentId = String(folder.parentId || "");
        if (!byParent.has(parentId)) byParent.set(parentId, []);
        byParent.get(parentId).push({ value: folder.id, label: folder.name });
      }

      for (const arr of byParent.values()) {
        arr.sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"));
      }

      return { hasRootPerks, byParent, byId };
    } catch (err) {
      console.warn("[Order] Failed to load course folder tree", err);
      return { hasRootPerks: false, byParent: new Map(), byId: new Map() };
    }
  }

  async _getPerkCompendiumFolderState(packCollection, folderPath = []) {
    const tree = await this._getPerkCompendiumFolderTree(packCollection);
    const normalizedPath = Array.isArray(folderPath)
      ? folderPath.map(v => String(v || "")).filter(Boolean)
      : [];

    const levels = [];
    let parentId = "";
    let depth = 0;

    while (true) {
      const options = [];
      if (depth === 0 && tree.hasRootPerks) options.push({ value: "__root__", label: "Без папки" });
      const childOptions = tree.byParent.get(parentId) || [];
      options.push(...childOptions);
      if (!options.length) break;

      const selectedValue = options.some(opt => opt.value === normalizedPath[depth]) ? normalizedPath[depth] : "";
      levels.push({
        level: depth,
        selectedValue,
        options
      });

      if (!selectedValue || selectedValue === "__root__") break;
      if (!(tree.byParent.get(selectedValue) || []).length) break;

      parentId = selectedValue;
      depth += 1;
    }

    const pickedPath = levels.map(level => level.selectedValue).filter(Boolean);
    let summary = "";
    if (pickedPath[0] === "__root__") summary = "Без папки";
    else if (pickedPath.length) summary = pickedPath.map(id => tree.byId.get(id)?.name || "").filter(Boolean).join(" / ");

    const hasOpenChoice = levels.some((level, index) => index === 0 ? !level.selectedValue : !level.selectedValue);

    return { levels, summary, hasOpenChoice, tree };
  }

  _getEffectiveCourseFolderPath(courseRaw, selectedState = {}) {
    const selectedPath = Array.isArray(selectedState?.folderPath)
      ? selectedState.folderPath.map(v => String(v || "")).filter(Boolean)
      : [];
    if (selectedPath.length) return selectedPath;
    return Array.isArray(courseRaw?.folderPath)
      ? courseRaw.folderPath.map(v => String(v || "")).filter(Boolean)
      : [];
  }

  _hasExplicitCourseFolder(course = {}) {
    const folderPath = Array.isArray(course.folderPath)
      ? course.folderPath.map(v => String(v || "")).filter(Boolean)
      : [];
    if (folderPath.length) return true;
    if (String(course.folderId || "") === "__root__") return true;
    if (String(course.folderName || "") === "Без папки") return true;
    return false;
  }

  async _loadCoursePerkDocuments(course) {
    if (!course?.packCollection) return [];
    const pack = game.packs.get(course.packCollection);
    if (!pack) return [];

    try {
      const docs = await pack.getDocuments();
      const folderPath = Array.isArray(course.folderPath)
        ? course.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const targetFolderId = String(course.folderId || folderPath[folderPath.length - 1] || "");
      const targetFolderName = String(course.folderName || "");

      if (!targetFolderId && !targetFolderName) return [];

      return docs
        .filter(doc => {
          if (targetFolderId && targetFolderId !== "__root__") {
            return (doc.folder?.id || "") === targetFolderId;
          }
          if (targetFolderId === "__root__") {
            return !doc.folder;
          }
          if (targetFolderName === "Без папки") {
            return !doc.folder;
          }
          if (targetFolderName) {
            return String(doc.folder?.name || "").trim() === targetFolderName.trim();
          }
          return false;
        })
        .sort((a, b) => {
          const typeA = String(CONFIG.Item?.typeLabels?.[a.type] || a.type || "");
          const typeB = String(CONFIG.Item?.typeLabels?.[b.type] || b.type || "");
          const byType = typeA.localeCompare(typeB, "ru");
          if (byType !== 0) return byType;
          return String(a.name).localeCompare(String(b.name), "ru");
        });
    } catch (err) {
      console.warn("[Order] Failed to load course perks", err);
      return [];
    }
  }

  async _getPerkAllocationData() {
    if (!this.state.classUsesPerkPoints) {
      return {
        budget: 0,
        spent: 0,
        remaining: 0,
        courses: []
      };
    }

    const classItem = this._getClassItem();
    if (!classItem) {
      return {
        budget: 0,
        spent: 0,
        remaining: 0,
        courses: []
      };
    }

    const budget = Math.max(0, Number(classItem.system?.perkPointBudget ?? 0) || 0);
    const coursesRaw = this._getSpecializedCourseEntries(classItem);
    const courses = [];
    let spent = 0;

    for (let index = 0; index < coursesRaw.length; index++) {
      const courseRaw = coursesRaw[index];
      const selectedState = this.state.specializedCourseSelections?.[courseRaw.id] || {};
      const classConfiguredFolderPath = Array.isArray(courseRaw.folderPath)
        ? courseRaw.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const canChooseFolderInWizard = !!courseRaw.allowFolderChoiceInWizard;
      const effectiveFolderPath = canChooseFolderInWizard
        ? this._getEffectiveCourseFolderPath(courseRaw, selectedState)
        : classConfiguredFolderPath;
      const effectiveFolderState = await this._getPerkCompendiumFolderState(courseRaw.packCollection, effectiveFolderPath);
      const rawFolderState = await this._getPerkCompendiumFolderState(courseRaw.packCollection, classConfiguredFolderPath);
      const classHasConfiguredFolder = this._hasExplicitCourseFolder(courseRaw);

      const effectiveFolderId = String(courseRaw.folderId || effectiveFolderPath[effectiveFolderPath.length - 1] || "");
      const effectiveFolderName = effectiveFolderId === "__root__"
        ? "Без папки"
        : (effectiveFolderState.summary || courseRaw.folderName || "");
      const docsCourse = {
        ...courseRaw,
        folderPath: effectiveFolderPath,
        folderId: effectiveFolderId,
        folderName: effectiveFolderName
      };
      const courseDocs = await this._loadCoursePerkDocuments(docsCourse);

      const cost = Math.max(0, Number(courseRaw.cost ?? 0) || 0);
      const selectedCount = courseRaw.grantAllFromFolder
        ? Math.min(1, Math.max(0, Number(selectedState.count || 0)))
        : Math.max(0, Number(selectedState.count || 0));
      spent += selectedCount * cost;

      const picks = Array.isArray(selectedState.picks)
        ? selectedState.picks.map(v => String(v || ""))
        : [];
      while (picks.length < selectedCount) picks.push("");

      const needsFolderSelection = canChooseFolderInWizard && !!effectiveFolderState.levels.length && !effectiveFolderState.levels[0]?.selectedValue;
      const missingConfiguredFolder = !canChooseFolderInWizard && !classHasConfiguredFolder;

      courses.push({
        id: courseRaw.id,
        label: `${this._getPackLabel(courseRaw.packCollection) || "Специализированный курс"} ${coursesRaw.length > 1 ? `#${index + 1}` : ""}`.trim(),
        packLabel: this._getPackLabel(courseRaw.packCollection),
        folderName: effectiveFolderName,
        folderSummary: effectiveFolderState.summary || courseRaw.folderName || "",
        folderLevels: effectiveFolderState.levels.map((levelData, levelIndex) => ({
          ...levelData,
          placeholder: levelIndex === 0 ? "— Выберите папку —" : "— Оставить текущую папку —"
        })),
        allowFolderSelection: canChooseFolderInWizard,
        missingConfiguredFolder,
        needsFolderSelection,
        cost,
        grantAll: !!courseRaw.grantAllFromFolder,
        selected: selectedCount > 0,
        selectedCount,
        picks,
        purchases: Array.from({ length: selectedCount }, (_, pickIndex) => ({
          pickIndex,
          labelNumber: pickIndex + 1,
          selectedUuid: String(picks[pickIndex] || "")
        })),
        choices: courseDocs.map(doc => ({ uuid: doc.uuid, name: doc.name })),
        count: courseDocs.length,
        raw: docsCourse
      });
    }

    return {
      budget,
      spent,
      remaining: budget - spent,
      courses
    };
  }

  _toPerkSourceFromDoc(doc) {
    const source = doc.toObject();
    delete source._id;
    source.flags = source.flags || {};
    source.flags.Order = source.flags.Order || {};
    source.flags.Order.sourceUuid = doc.uuid;
    return source;
  }

  async _applyPerkPointSelections() {
    if (!this.state.classUsesPerkPoints) return [];

    const allocation = await this._getPerkAllocationData();
    if (allocation.spent > allocation.budget) {
      ui.notifications.warn("Вы выбрали больше вариантов, чем позволяет запас О.П.");
      return false;
    }

    const sources = [];

    for (const course of allocation.courses || []) {
      if (!course.selectedCount) continue;

      if (course.missingConfiguredFolder) {
        ui.notifications.warn(`Для варианта «${course.label}» в классе не настроена папка.`);
        return false;
      }

      if (course.needsFolderSelection) {
        ui.notifications.warn(`Для варианта «${course.label}» нужно выбрать папку или подпапку.`);
        return false;
      }

      const docs = await this._loadCoursePerkDocuments(course.raw);
      if (!docs.length) {
        ui.notifications.warn(`В выбранной папке курса «${course.label}» не найдено ни одного элемента.`);
        return false;
      }

      if (course.grantAll) {
        for (const doc of docs) sources.push(this._toPerkSourceFromDoc(doc));
        continue;
      }

      for (const purchase of course.purchases || []) {
        if (!purchase.selectedUuid) {
          ui.notifications.warn(`Для варианта «${course.label}» нужно выбрать элемент для каждой покупки.`);
          return false;
        }

        const picked = docs.find(doc => doc.uuid === purchase.selectedUuid);
        if (!picked) {
          ui.notifications.warn(`Не удалось найти выбранный элемент для варианта «${course.label}».`);
          return false;
        }

        sources.push(this._toPerkSourceFromDoc(picked));
      }
    }

    const seen = new Set();
    const actorSeen = new Set(
      this.actor.items
        .map(i => i.flags?.Order?.sourceUuid || `${i.type}:${i.name}`)
    );

    const uniqueSources = [];
    for (const source of sources) {
      const key = source?.flags?.Order?.sourceUuid || `${source?.type || "Skill"}:${source?.name || foundry.utils.randomID()}`;
      if (seen.has(key) || actorSeen.has(key)) continue;
      seen.add(key);
      uniqueSources.push(source);
    }

    if (!uniqueSources.length) return [];
    return await this.actor.createEmbeddedDocuments("Item", uniqueSources);
  }

  _buildSummary() {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const rank = Number(systemData.Rank ?? 0) || 0;
    const race = this.state.raceName || this._nameFromIndex(this.state.raceUuid, this._races) || "—";
    const cls = this.state.className || this._nameFromIndex(this.state.classUuid, this._classes) || "—";

    const academy = "3 очка характеристик + 1 очко маг. прокачки (текстом)";
    const rankText = `Ранг ${rank} (2 очка характеристик + 1 маг. прокачка + 1 классовый навык — текстом)`;
    const perkText = this.state.classUsesPerkPoints
      ? (this.state.allocatedPerkNames.length ? this.state.allocatedPerkNames.join(", ") : "Пропущено")
      : "Не используется";

    const magPotential = this.state.magPotentialTier
      ? `${this.state.magPotentialTier}${this.state.magPotentialBonus ? ` (+${this.state.magPotentialBonus} к Магии)` : ""}`
      : "—";

    const magAffinity = this.state.magPotentialTier === "Без магии"
      ? "Без магии"
      : (this.state.magAffinity || "—");

    return {
      race,
      class: cls,
      perks: perkText,
      academy,
      rank: rankText,
      magPotential,
      magAffinity
    };
  }
}
