/*
 * Character Creation Wizard for Order system (Foundry VTT v11).
 * Non-invasive: only runs when user opts in.
 */

const CCW_STEPS = {
  INTRO: 0,
  MAG_POTENTIAL: 1,
  MAG_AFFINITY: 2,
  RACE: 3,
  CLASS: 4,
  PERK_POINTS: 5,
  BASE_EQUIPMENT: 6,
  SPECIALIZED_EQUIPMENT: 7,
  ACADEMY: 8,
  RANK_UP: 9,
  SUMMARY: 10
};

export class OrderCharacterCreationWizard extends FormApplication {
  static _globalHelpTooltipBound = false;
  static _globalHelpTooltipEl = null;
  static _globalHelpTooltipButton = null;

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
      classUsesBaseEquipment: false,
      classUsesSpecializedEquipment: false,

      academy1: "",
      academy2: "",
      academy3: "",
      academySpellNewUuid: "",
      academySpellNewName: "",
      academySpellUpgradeId: "",
      academyMagicSkipped: false,
      academyMagicResult: "",

      rank1: "",
      rank2: "",
      rankSpellNewUuid: "",
      rankSpellNewName: "",
      rankSpellUpgradeId: "",
      rankMagicSkipped: false,
      rankMagicResult: "",
      rankSkillNewUuid: "",
      rankSkillNewName: "",
      rankSkillUpgradeId: "",
      rankSkillSkipped: false,
      rankSkillResult: "",

      specializedCourseSelections: {},
      baseEquipmentSelections: {},
      specializedEquipmentSelections: {},
      allocatedPerkNames: [],
      allocatedBaseEquipmentNames: [],
      allocatedSpecializedEquipmentNames: [],

      magPotentialRoll: null,
      magPotentialTier: null,
      magPotentialBonus: 0,
      magAffinityRoll: null,
      magAffinity: null,
      magicSchoolName: "",
      magicGrantedSpellNames: [],

      manualD20: "",
      manualD12: ""
    };

    this._ccwCache = {
      packDocs: new Map(),
      folderTrees: new Map(),
      courseDocs: new Map(),
      choiceMetaByUuid: new Map()
    };

    this._pendingScroll = null;
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
    this._restorePendingScroll();
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

    if (this.state.academySpellUpgradeId) {
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academyMagicSkipped = false;
    }
    if (this.state.rankSpellUpgradeId) {
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankMagicSkipped = false;
    }
    if (this.state.rankSkillUpgradeId) {
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillSkipped = false;
    }

    if (this.state.academySpellNewUuid || this.state.academySpellNewName) this.state.academyMagicSkipped = false;
    if (this.state.rankSpellNewUuid || this.state.rankSpellNewName) this.state.rankMagicSkipped = false;
    if (this.state.rankSkillNewUuid || this.state.rankSkillNewName) this.state.rankSkillSkipped = false;

    // Do not re-render aggressively; Foundry will do it when needed.
  }

  get stepFlow() {
    const noMagic = this.state.magPotentialTier === "Без магии";
    const flow = [CCW_STEPS.INTRO, CCW_STEPS.MAG_POTENTIAL];

    if (!noMagic) flow.push(CCW_STEPS.MAG_AFFINITY);

    flow.push(CCW_STEPS.RACE, CCW_STEPS.CLASS);

    if (this.state.classUsesPerkPoints) flow.push(CCW_STEPS.PERK_POINTS);
    if (this.state.classUsesBaseEquipment) flow.push(CCW_STEPS.BASE_EQUIPMENT);
    if (this.state.classUsesSpecializedEquipment) flow.push(CCW_STEPS.SPECIALIZED_EQUIPMENT);

    flow.push(CCW_STEPS.ACADEMY, CCW_STEPS.RANK_UP, CCW_STEPS.SUMMARY);
    return flow;
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

    const spells = this._getSpellProgressionChoices();
    const skills = this._getSkillProgressionChoices();
    const currentMagicAvailable = this._canUseMagicProgression();

    const magPotentialText = this.state.magPotentialTier
      ? `${this.state.magPotentialTier}${this.state.magPotentialBonus ? ` (+${this.state.magPotentialBonus} к Магии)` : ""}`
      : "—";

    const magAffinityText = this.state.magAffinity ? this.state.magAffinity : "—";
    const isNoMagic = this.state.magPotentialTier === "Без магии";
    const perkAllocation = await this._getPerkAllocationData();
    const baseEquipmentAllocation = await this._getBaseEquipmentAllocationData();
    const specializedEquipmentAllocation = await this._getSpecializedEquipmentAllocationData();

    const stepTitleMap = {
      [CCW_STEPS.INTRO]: "Старт",
      [CCW_STEPS.MAG_POTENTIAL]: "Магический потенциал",
      [CCW_STEPS.MAG_AFFINITY]: "Предрасположенность",
      [CCW_STEPS.RACE]: "Раса",
      [CCW_STEPS.CLASS]: "Класс",
      [CCW_STEPS.PERK_POINTS]: "Распределение О.П.",
      [CCW_STEPS.BASE_EQUIPMENT]: "Базовая экипировка",
      [CCW_STEPS.SPECIALIZED_EQUIPMENT]: "Специализированная экипировка",
      [CCW_STEPS.ACADEMY]: "Академия",
      [CCW_STEPS.RANK_UP]: "Повышение ранга",
      [CCW_STEPS.SUMMARY]: "Итог"
    };

    const stepTitle = stepTitleMap[this.step] ?? "";
    const flow = this.stepFlow;
    const idx = flow.indexOf(this.step);
    const stepHuman = idx >= 0 ? (idx + 1) : Math.min(this.step + 1, flow.length);
    const nextLabel = this.step >= CCW_STEPS.SUMMARY ? "Готово" : (this.step === CCW_STEPS.INTRO ? "Начать" : "Далее");
    const summary = this._buildSummary();

    return {
      ...super.getData(options),
      step: this.step,
      stepTotal: this.stepTotal,
      stepHuman,
      stepTitle,

      canBack: this.step > CCW_STEPS.INTRO,
      nextLabel,

      isIntro: this.step === CCW_STEPS.INTRO,
      isMagPotential: this.step === CCW_STEPS.MAG_POTENTIAL,
      isMagAffinity: this.step === CCW_STEPS.MAG_AFFINITY && !isNoMagic,
      isRace: this.step === CCW_STEPS.RACE,
      isClass: this.step === CCW_STEPS.CLASS,
      isPerkPoints: this.step === CCW_STEPS.PERK_POINTS && this.state.classUsesPerkPoints,
      isBaseEquipment: this.step === CCW_STEPS.BASE_EQUIPMENT && this.state.classUsesBaseEquipment,
      isSpecializedEquipment: this.step === CCW_STEPS.SPECIALIZED_EQUIPMENT && this.state.classUsesSpecializedEquipment,
      isAcademy: this.step === CCW_STEPS.ACADEMY,
      isRankUp: this.step === CCW_STEPS.RANK_UP,
      isSummary: this.step === CCW_STEPS.SUMMARY,

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
      spells,
      skills,
      rankForLimiter,
      academyRankLimiter: this._rankLimiter(rank),
      rankUpNewRankLimiter: this._rankLimiter(Math.max(rank, 0) + 1),
      academyMagicAvailable: currentMagicAvailable,
      rankMagicAvailable: currentMagicAvailable,
      academySpellNewName: this.state.academySpellNewName,
      academySpellUpgradeId: this.state.academySpellUpgradeId,
      academyMagicSkipped: !!this.state.academyMagicSkipped,
      rankSpellNewName: this.state.rankSpellNewName,
      rankSpellUpgradeId: this.state.rankSpellUpgradeId,
      rankMagicSkipped: !!this.state.rankMagicSkipped,
      rankSkillNewName: this.state.rankSkillNewName,
      rankSkillUpgradeId: this.state.rankSkillUpgradeId,
      rankSkillSkipped: !!this.state.rankSkillSkipped,
      manualD20: this.state.manualD20,
      manualD12: this.state.manualD12,
      magPotentialText,
      magAffinityText,
      perkAllocation,
      baseEquipmentAllocation,
      specializedEquipmentAllocation,
      summary
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    this._ensureGlobalHelpTooltipBinding();

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
      this.state.classUsesBaseEquipment = false;
      this.state.classUsesSpecializedEquipment = false;
      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];
      this.render(false);
    });

    html.find('[data-action="clear-academy-spell"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.render(false);
    });
    html.find('[data-action="clear-rank-spell"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.render(false);
    });
    html.find('[data-action="clear-rank-skill"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.render(false);
    });

    html.find('[data-action="skip-academy-magic"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = true;
      this.render(false);
    });
    html.find('[data-action="skip-rank-magic"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = true;
      this.render(false);
    });
    html.find('[data-action="skip-rank-skill"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = true;
      this.render(false);
    });

    html.find('[data-action="skip-perk-points"]').on("click", (ev) => {
      ev.preventDefault();
      this.state.specializedCourseSelections = {};
      this._onNext(ev);
    });

    html.find('[data-action="course-entry-add"]').on("click", (ev) => this._onGenericPurchaseAdd(ev, {
      stateKey: "specializedCourseSelections",
      allocationLoader: () => this._getPerkAllocationData(),
      collectionKey: "courses",
      remainingLabel: "О.П.",
      warningText: "Недостаточно О.П. для этого выбора."
    }));

    html.find('[data-action="course-entry-remove"]').on("click", (ev) => this._onGenericPurchaseRemove(ev, {
      stateKey: "specializedCourseSelections"
    }));

    html.find('[data-action="course-entry-pick"]').on("change", (ev) => this._onGenericPurchasePick(ev, {
      stateKey: "specializedCourseSelections",
      helpButtonAction: "course-choice-help"
    }));

    html.find('[data-action="course-folder-pick"]').on("change", (ev) => this._onGenericFolderPick(ev, {
      entriesGetter: () => this._getSpecializedCourseEntries(),
      stateKey: "specializedCourseSelections"
    }));

    html.find('[data-action="base-equipment-pick"]').on("change", (ev) => this._onBaseEquipmentPick(ev));
    html.find('[data-action="base-equipment-folder-pick"]').on("change", (ev) => this._onBaseEquipmentFolderPick(ev));
    html.find('[data-action="base-equipment-exchange-toggle"]').on("change", (ev) => this._onBaseEquipmentExchangeToggle(ev));

    html.find('[data-action="specialized-equipment-entry-add"]').on("click", (ev) => this._onGenericPurchaseAdd(ev, {
      stateKey: "specializedEquipmentSelections",
      allocationLoader: () => this._getSpecializedEquipmentAllocationData(),
      collectionKey: "entries",
      remainingLabel: "О.Э.",
      warningText: "Недостаточно О.Э. для этого выбора."
    }));

    html.find('[data-action="specialized-equipment-entry-remove"]').on("click", (ev) => this._onGenericPurchaseRemove(ev, {
      stateKey: "specializedEquipmentSelections"
    }));

    html.find('[data-action="specialized-equipment-entry-pick"]').on("change", (ev) => this._onGenericPurchasePick(ev, {
      stateKey: "specializedEquipmentSelections",
      helpButtonAction: "specialized-equipment-choice-help"
    }));

    html.find('[data-action="specialized-equipment-folder-pick"]').on("change", (ev) => this._onGenericFolderPick(ev, {
      entriesGetter: () => this._getSpecializedEquipmentEntries(),
      stateKey: "specializedEquipmentSelections"
    }));

    html.find('[data-action="course-choice-help"], [data-action="base-equipment-choice-help"], [data-action="specialized-equipment-choice-help"]').each((_, el) => {
      this._applyHelpButtonState($(el), {
        uuid: String(el.dataset.choiceUuid || ""),
        description: String(el.dataset.description || el.dataset.choiceDescription || ""),
        name: String(el.dataset.choiceName || "")
      });
    });

    html.find('[data-action="course-choice-help"], [data-action="base-equipment-choice-help"], [data-action="specialized-equipment-choice-help"]').on("mouseenter focus", async (ev) => {
      await this._ensureHelpButtonDescription(ev.currentTarget);
    });

    html.find('[data-action="course-choice-help"], [data-action="base-equipment-choice-help"], [data-action="specialized-equipment-choice-help"]').on("dblclick", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._ensureHelpButtonDescription(ev.currentTarget);
      const uuid = String(ev.currentTarget?.dataset?.choiceUuid || "");
      if (!uuid) {
        ui.notifications.info("Сначала выберите элемент, чтобы открыть его лист.");
        return;
      }
      await this._openDocumentByUuid(uuid);
    });

    this._bindDropzone(html, '[data-drop="race"]', (ev) => this._onDropItem(ev, "Race"));
    this._bindDropzone(html, '[data-drop="class"]', (ev) => this._onDropItem(ev, "Class"));
    this._bindDropzone(html, '[data-drop="academy-spell"]', (ev) => this._onProgressionDrop(ev, {
      expectedType: "Spell",
      newUuidKey: "academySpellNewUuid",
      newNameKey: "academySpellNewName",
      upgradeIdKey: "academySpellUpgradeId",
      skippedKey: "academyMagicSkipped"
    }));
    this._bindDropzone(html, '[data-drop="rank-spell"]', (ev) => this._onProgressionDrop(ev, {
      expectedType: "Spell",
      newUuidKey: "rankSpellNewUuid",
      newNameKey: "rankSpellNewName",
      upgradeIdKey: "rankSpellUpgradeId",
      skippedKey: "rankMagicSkipped"
    }));
    this._bindDropzone(html, '[data-drop="rank-skill"]', (ev) => this._onProgressionDrop(ev, {
      expectedType: "Skill",
      newUuidKey: "rankSkillNewUuid",
      newNameKey: "rankSkillNewName",
      upgradeIdKey: "rankSkillUpgradeId",
      skippedKey: "rankSkillSkipped"
    }));

    this._restorePendingScroll();
  }

  _getSelectionIdFromEvent(event) {
    return String(
      event?.currentTarget?.dataset?.courseId ||
      event?.currentTarget?.dataset?.entryId ||
      event?.currentTarget?.dataset?.equipmentId ||
      ""
    );
  }

  async _onGenericPurchaseAdd(event, { stateKey, allocationLoader, collectionKey, remainingLabel, warningText } = {}) {
    event.preventDefault();
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const allocation = await allocationLoader();
    const collection = Array.isArray(allocation?.[collectionKey]) ? allocation[collectionKey] : [];
    const entry = collection.find(row => row.id === entryId);
    if (!entry) return;

    const cost = Number(entry.cost) || 0;
    if (cost > Number(allocation?.remaining ?? 0)) {
      ui.notifications.warn(warningText || `Недостаточно ${remainingLabel || "очков"} для этого выбора.`);
      return;
    }

    const next = foundry.utils.duplicate(this.state?.[stateKey] || {});
    const current = next[entryId] || { count: 0, picks: [] };
    if (entry.grantAll && current.count >= 1) {
      ui.notifications.warn("Этот вариант можно взять только один раз.");
      return;
    }

    current.count = Math.max(0, Number(current.count || 0)) + 1;
    current.picks = Array.isArray(current.picks) ? current.picks : [];
    while (current.picks.length < current.count) current.picks.push("");
    next[entryId] = current;
    this.state[stateKey] = next;
    this._capturePendingScroll();
    this.render(false);
  }

  _onGenericPurchaseRemove(event, { stateKey } = {}) {
    event.preventDefault();
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const next = foundry.utils.duplicate(this.state?.[stateKey] || {});
    const current = next[entryId];
    if (!current) return;

    const count = Math.max(0, Number(current.count || 0) - 1);
    if (count <= 0) {
      delete next[entryId];
    } else {
      current.count = count;
      current.picks = Array.isArray(current.picks) ? current.picks.slice(0, count) : [];
      next[entryId] = current;
    }

    this.state[stateKey] = next;
    this._capturePendingScroll();
    this.render(false);
  }

  _onGenericPurchasePick(event, { stateKey, helpButtonAction } = {}) {
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const pickIndex = Math.max(0, Number(event.currentTarget?.dataset?.pickIndex ?? 0) || 0);
    const next = foundry.utils.duplicate(this.state?.[stateKey] || {});
    const current = next[entryId] || { count: pickIndex + 1, picks: [] };
    current.count = Math.max(Number(current.count || 0), pickIndex + 1);
    current.picks = Array.isArray(current.picks) ? current.picks : [];
    while (current.picks.length < current.count) current.picks.push("");
    current.picks[pickIndex] = String(event.currentTarget?.value || "");
    next[entryId] = current;
    this.state[stateKey] = next;

    const row = $(event.currentTarget).closest('.os-ccw-choice-row');
    if (row.length && helpButtonAction) {
      const button = row.find(`[data-action="${helpButtonAction}"]`);
      const selectedOption = event.currentTarget.selectedOptions?.[0] || null;
      const selectedUuid = String(event.currentTarget?.value || "");
      const desc = String(
        selectedOption?.dataset?.description ||
        selectedOption?.dataset?.choiceDescription ||
        ""
      );
      const name = String(
        selectedOption?.dataset?.choiceName ||
        selectedOption?.textContent ||
        ""
      ).trim();
      this._applyHelpButtonState(button, {
        uuid: selectedUuid,
        description: desc,
        name
      });
    }
  }

  async _onGenericFolderPick(event, { entriesGetter, stateKey } = {}) {
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const level = Math.max(0, Number(event.currentTarget?.dataset?.level ?? 0) || 0);
    const value = String(event.currentTarget?.value || "");
    const entryRaw = (entriesGetter?.() || []).find(entry => entry.id === entryId);
    if (!entryRaw) return;

    const next = foundry.utils.duplicate(this.state?.[stateKey] || {});
    const current = next[entryId] || { count: 0, picks: [] };
    const basePath = Array.isArray(current.folderPath)
      ? current.folderPath.map(v => String(v || "")).filter(Boolean)
      : (Array.isArray(entryRaw.folderPath) ? entryRaw.folderPath.map(v => String(v || "")).filter(Boolean) : []);

    const path = basePath.slice(0, level);
    if (level === 0) {
      if (value === "__root__") path.push("__root__");
      else if (value) path.push(value);
    } else if (value && value !== "__stay__") {
      path.push(value);
    }

    current.folderPath = path;
    current.picks = [];
    next[entryId] = current;
    this.state[stateKey] = next;
    this._capturePendingScroll();
    this.render(false);
  }

  _onBaseEquipmentPick(event) {
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const next = foundry.utils.duplicate(this.state.baseEquipmentSelections || {});
    const current = next[entryId] || { exchanged: false, pick: "", folderPath: [] };
    current.pick = String(event.currentTarget?.value || "");
    next[entryId] = current;
    this.state.baseEquipmentSelections = next;

    const row = $(event.currentTarget).closest('.os-ccw-choice-row');
    if (row.length) {
      const button = row.find('[data-action="base-equipment-choice-help"]');
      const selectedOption = event.currentTarget.selectedOptions?.[0] || null;
      const selectedUuid = String(event.currentTarget?.value || "");
      const desc = String(
        selectedOption?.dataset?.description ||
        selectedOption?.dataset?.choiceDescription ||
        ""
      );
      const name = String(
        selectedOption?.dataset?.choiceName ||
        selectedOption?.textContent ||
        ""
      ).trim();
      this._applyHelpButtonState(button, {
        uuid: selectedUuid,
        description: desc,
        name
      });
    }
  }

  _onBaseEquipmentExchangeToggle(event) {
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const next = foundry.utils.duplicate(this.state.baseEquipmentSelections || {});
    const current = next[entryId] || { exchanged: false, pick: "", folderPath: [] };
    current.exchanged = !!event.currentTarget?.checked;
    next[entryId] = current;
    this.state.baseEquipmentSelections = next;
    this._capturePendingScroll();
    this.render(false);
  }

  _onBaseEquipmentFolderPick(event) {
    const entryId = this._getSelectionIdFromEvent(event);
    if (!entryId) return;

    const level = Math.max(0, Number(event.currentTarget?.dataset?.level ?? 0) || 0);
    const value = String(event.currentTarget?.value || "");
    const entryRaw = this._getBaseEquipmentEntries().find(entry => entry.id === entryId);
    if (!entryRaw) return;

    const next = foundry.utils.duplicate(this.state.baseEquipmentSelections || {});
    const current = next[entryId] || { exchanged: false, pick: "", folderPath: [] };
    const basePath = Array.isArray(current.folderPath)
      ? current.folderPath.map(v => String(v || "")).filter(Boolean)
      : (Array.isArray(entryRaw.folderPath) ? entryRaw.folderPath.map(v => String(v || "")).filter(Boolean) : []);

    const path = basePath.slice(0, level);
    if (level === 0) {
      if (value === "__root__") path.push("__root__");
      else if (value) path.push(value);
    } else if (value && value !== "__stay__") {
      path.push(value);
    }

    current.folderPath = path;
    current.pick = "";
    next[entryId] = current;
    this.state.baseEquipmentSelections = next;
    this._capturePendingScroll();
    this.render(false);
  }

  _stripHtmlToText(value) {
    if (value == null) return "";
    const raw = String(value);
    const withBreaks = raw
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<li>/gi, "• " );
    return $('<div>').html(withBreaks).text().replace(/\n{3,}/g, "\n\n").trim();
  }

  _getChoiceDescription(choice = {}) {
    const directSystem = choice?.system ?? {};
    const legacyData = choice?.data ?? {};
    const objectView = typeof choice?.toObject === "function" ? choice.toObject() : {};
    const objectSystem = objectView?.system ?? {};
    const objectData = objectView?.data ?? {};

    return this._stripHtmlToText(
      directSystem?.Description ??
      directSystem?.description ??
      directSystem?.data?.Description ??
      directSystem?.data?.description ??
      choice?.Description ??
      choice?.description ??
      legacyData?.Description ??
      legacyData?.description ??
      objectSystem?.Description ??
      objectSystem?.description ??
      objectSystem?.data?.Description ??
      objectSystem?.data?.description ??
      objectData?.Description ??
      objectData?.description ??
      choice?.flags?.description ??
      ""
    );
  }

  _getChoiceMeta(choice = {}) {
    const meta = {
      uuid: String(choice?.uuid || choice?.flags?.Order?.sourceUuid || ""),
      name: String(choice?.name || "Без названия"),
      description: this._getChoiceDescription(choice)
    };

    if (meta.uuid) this._ccwCache.choiceMetaByUuid.set(meta.uuid, meta);
    return meta;
  }

  _applyHelpButtonState(button, { uuid = "", description = "", name = "" } = {}) {
    const btn = button?.jquery ? button : $(button);
    if (!btn?.length) return;

    const cleanName = String(name || "").trim();
    const cleanDescription = String(description || "").trim();
    const tooltip = cleanName
      ? `${cleanName}${cleanDescription ? `\n\n${cleanDescription}` : "\n\nОписание отсутствует."}`
      : "Сначала выберите элемент.";

    btn.removeAttr('title');
    btn.removeAttr('aria-label');
    btn.attr('data-help-tooltip', tooltip);
    btn.removeAttr('data-tooltip');
    btn.attr('data-choice-uuid', String(uuid || ""));
    btn.attr('data-description', cleanDescription);
    btn.attr('data-choice-name', cleanName);
    btn.toggleClass('is-empty', !cleanName);
    btn.toggleClass('has-description', !!cleanDescription);

    if (OrderCharacterCreationWizard._globalHelpTooltipButton === btn.get(0)) {
      OrderCharacterCreationWizard._updateGlobalHelpTooltipContent(btn);
      OrderCharacterCreationWizard._positionGlobalHelpTooltip(btn);
    }
  }


  _ensureGlobalHelpTooltipBinding() {
    if (OrderCharacterCreationWizard._globalHelpTooltipBound) return;
    OrderCharacterCreationWizard._globalHelpTooltipBound = true;

    $(document)
      .on('mouseenter.osCcwHelpTooltip focusin.osCcwHelpTooltip', 'button.os-ccw-help', async (ev) => {
        const button = $(ev.currentTarget);
        if (!button.length) return;
        await this._ensureHelpButtonDescription(button);
        OrderCharacterCreationWizard._showGlobalHelpTooltip(button);
      })
      .on('mousemove.osCcwHelpTooltip', 'button.os-ccw-help', (ev) => {
        const button = $(ev.currentTarget);
        if (!button.length) return;
        if (OrderCharacterCreationWizard._globalHelpTooltipButton !== button.get(0)) return;
        OrderCharacterCreationWizard._positionGlobalHelpTooltip(button);
      })
      .on('mouseleave.osCcwHelpTooltip focusout.osCcwHelpTooltip mousedown.osCcwHelpTooltip click.osCcwHelpTooltip', 'button.os-ccw-help', () => {
        OrderCharacterCreationWizard._hideGlobalHelpTooltip();
      });

    $(window).on('scroll.osCcwHelpTooltip resize.osCcwHelpTooltip', () => {
      if (!OrderCharacterCreationWizard._globalHelpTooltipButton) return;
      OrderCharacterCreationWizard._positionGlobalHelpTooltip($(OrderCharacterCreationWizard._globalHelpTooltipButton));
    });
  }

  static _ensureGlobalHelpTooltipElement() {
    let el = OrderCharacterCreationWizard._globalHelpTooltipEl;
    if (el?.length) return el;
    el = $('<div class="os-ccw-floating-tooltip" aria-hidden="true"></div>').hide();
    $('body').append(el);
    OrderCharacterCreationWizard._globalHelpTooltipEl = el;
    return el;
  }

  static _updateGlobalHelpTooltipContent(button) {
    const btn = button?.jquery ? button : $(button);
    const el = OrderCharacterCreationWizard._ensureGlobalHelpTooltipElement();
    el.text(String(btn.attr('data-help-tooltip') || '').trim());
  }

  static _positionGlobalHelpTooltip(button) {
    const btn = button?.jquery ? button : $(button);
    const el = OrderCharacterCreationWizard._ensureGlobalHelpTooltipElement();
    if (!btn?.length || !el?.length || !el.is(':visible')) return;

    const rect = btn.get(0).getBoundingClientRect();
    const margin = 12;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    el.css({ left: '0px', top: '0px', visibility: 'hidden', display: 'block' });
    const tooltipWidth = el.outerWidth() || 0;
    const tooltipHeight = el.outerHeight() || 0;

    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
    left = Math.max(margin, Math.min(left, Math.max(margin, viewportWidth - tooltipWidth - margin)));

    let top = rect.bottom + margin;
    if (top + tooltipHeight > viewportHeight - margin) {
      top = rect.top - tooltipHeight - margin;
    }
    top = Math.max(margin, top);

    el.css({ left: `${left}px`, top: `${top}px`, visibility: 'visible' });
  }

  static _showGlobalHelpTooltip(button) {
    const btn = button?.jquery ? button : $(button);
    if (!btn?.length) return;
    const text = String(btn.attr('data-help-tooltip') || '').trim();
    if (!text) {
      OrderCharacterCreationWizard._hideGlobalHelpTooltip();
      return;
    }

    const el = OrderCharacterCreationWizard._ensureGlobalHelpTooltipElement();
    OrderCharacterCreationWizard._globalHelpTooltipButton = btn.get(0);
    el.text(text).show();
    OrderCharacterCreationWizard._positionGlobalHelpTooltip(btn);
  }

  static _hideGlobalHelpTooltip() {
    OrderCharacterCreationWizard._globalHelpTooltipButton = null;
    const el = OrderCharacterCreationWizard._globalHelpTooltipEl;
    if (el?.length) el.hide();
  }

  _capturePendingScroll() {
    try {
      const windowContent = this.element?.find?.('.window-content');
      const body = this.element?.find?.('.os-ccw-body');
      this._pendingScroll = {
        windowContent: windowContent?.length ? Number(windowContent.scrollTop() || 0) : null,
        body: body?.length ? Number(body.scrollTop() || 0) : null
      };
    } catch (err) {
      this._pendingScroll = null;
    }
  }

  _restorePendingScroll() {
    if (!this._pendingScroll) return;
    const pending = foundry.utils.duplicate(this._pendingScroll);
    this._pendingScroll = null;

    requestAnimationFrame(() => {
      try {
        const windowContent = this.element?.find?.('.window-content');
        const body = this.element?.find?.('.os-ccw-body');
        if (windowContent?.length && Number.isFinite(pending.windowContent)) windowContent.scrollTop(pending.windowContent);
        if (body?.length && Number.isFinite(pending.body)) body.scrollTop(pending.body);
      } catch (err) {
        // ignore
      }
    });
  }

  async _ensureHelpButtonDescription(button) {
    const btn = button?.jquery ? button : $(button);
    if (!btn?.length) return;

    const uuid = String(btn.attr('data-choice-uuid') || "");
    const currentDescription = String(btn.attr('data-description') || "").trim();
    const currentName = String(btn.attr('data-choice-name') || "").trim();

    if (!uuid) {
      this._applyHelpButtonState(btn, { uuid: "", description: "", name: currentName });
      return;
    }

    if (currentDescription) {
      this._applyHelpButtonState(btn, { uuid, description: currentDescription, name: currentName });
      return;
    }

    let meta = this._ccwCache.choiceMetaByUuid.get(uuid) || null;
    if (!meta) {
      const doc = await fromUuid(uuid);
      if (!doc) return;
      meta = this._getChoiceMeta(doc);
      this._ccwCache.choiceMetaByUuid.set(uuid, meta);
    }

    this._applyHelpButtonState(btn, {
      uuid,
      description: meta?.description || "",
      name: meta?.name || currentName
    });
  }

  async _openDocumentByUuid(uuid) {
    const doc = await fromUuid(String(uuid || ""));
    if (!doc) {
      ui.notifications.warn("Не удалось открыть выбранный элемент.");
      return null;
    }
    doc.sheet?.render(true);
    return doc;
  }

  async _openTemporaryChoiceSheet(choice = {}) {
    try {
      const source = foundry.utils.duplicate(choice);
      if (!source?.type) {
        ui.notifications.warn("У выбранного элемента нет типа документа, лист открыть нельзя.");
        return null;
      }
      delete source._id;
      const ItemCls = CONFIG.Item?.documentClass || Item;
      const tempItem = new ItemCls(source, { parent: this.actor });
      tempItem.sheet?.render(true);
      return tempItem;
    } catch (err) {
      console.warn("[Order] Failed to open temporary item sheet", err);
      ui.notifications.warn("Не удалось открыть лист выбранного элемента.");
      return null;
    }
  }

  _bindChoiceHelpInDialog(html, { selectSelector, buttonSelector, choices = [] } = {}) {
    const select = html.find(selectSelector);
    const button = html.find(buttonSelector);
    if (!select.length || !button.length) return;

    const resolveChoice = (value) => {
      const stringValue = String(value || "");
      const selectedOption = select.find('option:selected');
      const optionUuid = String(selectedOption.attr('data-choice-uuid') || stringValue || '');
      const optionName = String(selectedOption.attr('data-choice-name') || selectedOption.text() || '').trim();
      const optionDescription = String(selectedOption.attr('data-description') || '').trim();

      const choice = choices.find(entry => {
        const entryUuid = String(entry?.uuid || '');
        const entryId = String(entry?._id || '');
        return (optionUuid && entryUuid === optionUuid) || (stringValue && entryId === stringValue) || (stringValue && entryUuid === stringValue);
      }) || null;

      if (choice) {
        const meta = this._getChoiceMeta(choice);
        return {
          choice,
          meta: {
            uuid: String(meta?.uuid || optionUuid || ''),
            name: String(meta?.name || optionName || ''),
            description: String(meta?.description || optionDescription || '')
          }
        };
      }

      if (optionUuid || optionName || optionDescription) {
        return {
          choice: null,
          meta: {
            uuid: optionUuid,
            name: optionName,
            description: optionDescription
          }
        };
      }

      return { choice: choices[0] || null, meta: choices[0] ? this._getChoiceMeta(choices[0]) : null };
    };

    const update = () => {
      const { choice, meta } = resolveChoice(select.val());
      if (!meta) {
        this._applyHelpButtonState(button, {});
        button.removeAttr('data-choice-index');
        return;
      }
      this._applyHelpButtonState(button, meta);
      const choiceIndex = choice ? Math.max(0, choices.indexOf(choice)) : -1;
      if (choiceIndex >= 0) button.attr('data-choice-index', choiceIndex);
      else button.removeAttr('data-choice-index');
    };

    update();
    select.on('change input', update);
    button.on('mouseenter focus', async () => {
      await this._ensureHelpButtonDescription(button);
    });

    button.on('dblclick', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._ensureHelpButtonDescription(button);
      const directUuid = String(button.attr('data-choice-uuid') || '');
      if (directUuid) {
        await this._openDocumentByUuid(directUuid);
        return;
      }
      const index = Math.max(-1, Number(button.attr('data-choice-index') ?? -1) || -1);
      const choice = index >= 0 ? choices[index] : null;
      if (!choice) {
        ui.notifications.info("Сначала выберите элемент, чтобы открыть его лист.");
        return;
      }
      if (choice.uuid) await this._openDocumentByUuid(choice.uuid);
      else await this._openTemporaryChoiceSheet(choice);
    });
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
    if (step <= CCW_STEPS.INTRO) {
      this.state.raceUuid = "";
      this.state.classUuid = "";
      this.state.raceName = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;
      this.state.classUsesBaseEquipment = false;
      this.state.classUsesSpecializedEquipment = false;

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";

      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";

      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];

      this.state.magPotentialRoll = null;
      this.state.magPotentialTier = null;
      this.state.magPotentialBonus = 0;
      this.state.manualD20 = "";

      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
      this.state.magicSchoolName = "";
      this.state.magicGrantedSpellNames = [];
      this.state.manualD12 = "";
      return;
    }

    if (step <= CCW_STEPS.MAG_POTENTIAL) {
      this.state.magAffinityRoll = null;
      this.state.magAffinity = null;
      this.state.magicSchoolName = "";
      this.state.magicGrantedSpellNames = [];
      this.state.manualD12 = "";

      this.state.raceUuid = "";
      this.state.raceName = "";
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;
      this.state.classUsesBaseEquipment = false;
      this.state.classUsesSpecializedEquipment = false;

      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.MAG_AFFINITY) {
      this.state.magicSchoolName = "";
      this.state.magicGrantedSpellNames = [];

      this.state.raceUuid = "";
      this.state.raceName = "";
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;
      this.state.classUsesBaseEquipment = false;
      this.state.classUsesSpecializedEquipment = false;

      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];

      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.RACE) {
      this.state.classUuid = "";
      this.state.className = "";
      this.state.classUsesPerkPoints = false;
      this.state.classUsesBaseEquipment = false;
      this.state.classUsesSpecializedEquipment = false;
      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.CLASS) {
      this.state.specializedCourseSelections = {};
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedPerkNames = [];
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.PERK_POINTS) {
      this.state.baseEquipmentSelections = {};
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedBaseEquipmentNames = [];
      this.state.allocatedSpecializedEquipmentNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.BASE_EQUIPMENT) {
      this.state.specializedEquipmentSelections = {};
      this.state.allocatedSpecializedEquipmentNames = [];
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.SPECIALIZED_EQUIPMENT) {
      this.state.academy1 = "";
      this.state.academy2 = "";
      this.state.academy3 = "";
      this.state.academySpellNewUuid = "";
      this.state.academySpellNewName = "";
      this.state.academySpellUpgradeId = "";
      this.state.academyMagicSkipped = false;
      this.state.academyMagicResult = "";
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
      return;
    }

    if (step <= CCW_STEPS.ACADEMY) {
      this.state.rank1 = "";
      this.state.rank2 = "";
      this.state.rankSpellNewUuid = "";
      this.state.rankSpellNewName = "";
      this.state.rankSpellUpgradeId = "";
      this.state.rankMagicSkipped = false;
      this.state.rankMagicResult = "";
      this.state.rankSkillNewUuid = "";
      this.state.rankSkillNewName = "";
      this.state.rankSkillUpgradeId = "";
      this.state.rankSkillSkipped = false;
      this.state.rankSkillResult = "";
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

  async _onProgressionDrop(event, { expectedType, newUuidKey, newNameKey, upgradeIdKey, skippedKey } = {}) {
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

      this.state[newUuidKey] = doc.uuid;
      this.state[newNameKey] = doc.name;
      if (upgradeIdKey) this.state[upgradeIdKey] = "";
      if (skippedKey) this.state[skippedKey] = false;
      this.render(false);
    } catch (err) {
      console.error("[Order] Progression drop failed", err);
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
    const targetStep = idx > 0 ? flow[idx - 1] : CCW_STEPS.INTRO;

    await this._undoStep(targetStep);
    this._clearLaterStateForStep(targetStep);

    this.step = targetStep;
    return this.render(false);
  }

  _getNextFlowStep(step) {
    const flow = this.stepFlow;
    const idx = flow.indexOf(step);
    if (idx < 0 || idx >= flow.length - 1) return step;
    return flow[idx + 1];
  }

  async _onNext(event) {
    event.preventDefault();

    const fd = this._getSubmitData();
    for (const k of Object.keys(this.state)) {
      if (k in fd) this.state[k] = fd[k];
    }

    switch (this.step) {
      case CCW_STEPS.INTRO:
        this.step = this._getNextFlowStep(CCW_STEPS.INTRO);
        return this.render(false);

      case CCW_STEPS.MAG_POTENTIAL:
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
          this._registerUndo(CCW_STEPS.MAG_POTENTIAL, async () => {
            if (appliedBonus > 0) await this._changeCharacteristic("Magic", -appliedBonus);
          });

          if (tier === "Без магии") {
            this.state.magAffinityRoll = null;
            this.state.magAffinity = null;
            this.state.manualD12 = "";
            this.step = CCW_STEPS.RACE;
          } else {
            this.step = this._getNextFlowStep(CCW_STEPS.MAG_POTENTIAL);
          }
          return this.render(false);
        }

      case CCW_STEPS.MAG_AFFINITY:
        {
          if (this.state.magPotentialTier === "Без магии") {
            this.step = CCW_STEPS.RACE;
            return this.render(false);
          }

          const roll = this._readManualRoll(this.state.manualD12, 12) ?? this.state.magAffinityRoll;
          if (!roll) {
            ui.notifications.warn("Сначала киньте d12 или введите значение.");
            return;
          }
          this.state.magAffinity = this._magAffinityFromRoll(roll);

          const createdMagicItems = await this._applyMagicAffinitySelection();
          if (createdMagicItems === false) return;

          const createdMagicIds = Array.isArray(createdMagicItems)
            ? createdMagicItems.map(item => item.id).filter(Boolean)
            : [];
          this._registerUndo(CCW_STEPS.MAG_AFFINITY, async () => {
            if (createdMagicIds.length) {
              await this.actor.deleteEmbeddedDocuments("Item", createdMagicIds);
            }
          });

          this.step = this._getNextFlowStep(CCW_STEPS.MAG_AFFINITY);
          return this.render(false);
        }

      case CCW_STEPS.RACE:
        if (!this.state.raceUuid) {
          ui.notifications.warn("Сначала выберите или перетащите расу.");
          return;
        }
        await this._applyRace(this.state.raceUuid);
        this.step = this._getNextFlowStep(CCW_STEPS.RACE);
        return this.render(false);

      case CCW_STEPS.CLASS:
        if (!this.state.classUuid) {
          ui.notifications.warn("Сначала выберите или перетащите класс.");
          return;
        }
        {
          const applied = await this._applyClass(this.state.classUuid);
          if (!applied) return;
          this.step = this._getNextFlowStep(CCW_STEPS.CLASS);
          return this.render(false);
        }

      case CCW_STEPS.PERK_POINTS:
        {
          const created = await this._applyPerkPointSelections();
          if (created === false) return;

          const createdIds = Array.isArray(created) ? created.map(i => i.id).filter(Boolean) : [];
          const createdNames = Array.isArray(created) ? created.map(i => i.name).filter(Boolean) : [];
          this.state.allocatedPerkNames = createdNames;

          this._registerUndo(CCW_STEPS.PERK_POINTS, async () => {
            if (createdIds.length) {
              await this.actor.deleteEmbeddedDocuments("Item", createdIds);
            }
          });

          this.step = this._getNextFlowStep(CCW_STEPS.PERK_POINTS);
          return this.render(false);
        }

      case CCW_STEPS.BASE_EQUIPMENT:
        {
          const created = await this._applyBaseEquipmentSelections();
          if (created === false) return;

          const createdIds = Array.isArray(created) ? created.map(i => i.id).filter(Boolean) : [];
          const createdNames = Array.isArray(created) ? created.map(i => i.name).filter(Boolean) : [];
          this.state.allocatedBaseEquipmentNames = createdNames;

          this._registerUndo(CCW_STEPS.BASE_EQUIPMENT, async () => {
            if (createdIds.length) {
              await this.actor.deleteEmbeddedDocuments("Item", createdIds);
            }
          });

          this.step = this._getNextFlowStep(CCW_STEPS.BASE_EQUIPMENT);
          return this.render(false);
        }

      case CCW_STEPS.SPECIALIZED_EQUIPMENT:
        {
          const created = await this._applySpecializedEquipmentSelections();
          if (created === false) return;

          const createdIds = Array.isArray(created) ? created.map(i => i.id).filter(Boolean) : [];
          const createdNames = Array.isArray(created) ? created.map(i => i.name).filter(Boolean) : [];
          this.state.allocatedSpecializedEquipmentNames = createdNames;

          this._registerUndo(CCW_STEPS.SPECIALIZED_EQUIPMENT, async () => {
            if (createdIds.length) {
              await this.actor.deleteEmbeddedDocuments("Item", createdIds);
            }
          });

          this.step = this._getNextFlowStep(CCW_STEPS.SPECIALIZED_EQUIPMENT);
          return this.render(false);
        }

      case CCW_STEPS.ACADEMY:
        {
          const picks = [this.state.academy1, this.state.academy2, this.state.academy3];
          const ok = await this._applyAttributePicks(picks, 3);
          if (!ok) return;

          const magic = await this._applyMagicProgression({
            newUuid: this.state.academySpellNewUuid,
            upgradeId: this.state.academySpellUpgradeId,
            skipped: !!this.state.academyMagicSkipped,
            unavailableResult: "Недоступно (без магии)"
          });
          if (!magic?.ok) {
            for (const c of picks.filter(Boolean)) await this._changeCharacteristic(c, -1);
            return;
          }

          this.state.academyMagicResult = magic.result || "—";
          const chosen = picks.filter(Boolean);
          this._registerUndo(CCW_STEPS.ACADEMY, async () => {
            if (typeof magic.undo === "function") await magic.undo();
            for (const c of chosen) await this._changeCharacteristic(c, -1);
          });

          this.step = this._getNextFlowStep(CCW_STEPS.ACADEMY);
          return this.render(false);
        }

      case CCW_STEPS.RANK_UP:
        {
          const prevRank = Number(this.actor.system?.Rank ?? this.actor.data?.system?.Rank ?? 0) || 0;
          const rankWasSet = prevRank < 1;
          if (rankWasSet) {
            await this.actor.update({ "data.Rank": 1, "system.Rank": 1 });
          }

          const picks = [this.state.rank1, this.state.rank2];
          const ok = await this._applyAttributePicks(picks, 2, { rankOverride: 1 });
          if (!ok) {
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank, "system.Rank": prevRank });
            return;
          }

          const magic = await this._applyMagicProgression({
            newUuid: this.state.rankSpellNewUuid,
            upgradeId: this.state.rankSpellUpgradeId,
            skipped: !!this.state.rankMagicSkipped,
            unavailableResult: "Недоступно (без магии)"
          });
          if (!magic?.ok) {
            for (const c of picks.filter(Boolean)) await this._changeCharacteristic(c, -1);
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank, "system.Rank": prevRank });
            return;
          }

          const skill = await this._applySkillProgression({
            newUuid: this.state.rankSkillNewUuid,
            upgradeId: this.state.rankSkillUpgradeId,
            skipped: !!this.state.rankSkillSkipped
          });
          if (!skill?.ok) {
            if (typeof magic.undo === "function") await magic.undo();
            for (const c of picks.filter(Boolean)) await this._changeCharacteristic(c, -1);
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank, "system.Rank": prevRank });
            return;
          }

          this.state.rankMagicResult = magic.result || "—";
          this.state.rankSkillResult = skill.result || "—";
          const chosen = picks.filter(Boolean);
          this._registerUndo(CCW_STEPS.RANK_UP, async () => {
            if (typeof skill.undo === "function") await skill.undo();
            if (typeof magic.undo === "function") await magic.undo();
            for (const c of chosen) await this._changeCharacteristic(c, -1);
            if (rankWasSet) await this.actor.update({ "data.Rank": prevRank, "system.Rank": prevRank });
          });

          this.step = this._getNextFlowStep(CCW_STEPS.RANK_UP);
          return this.render(false);
        }

      case CCW_STEPS.SUMMARY:
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

  _normalizeCompendiumLabel(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, " ")
      .trim();
  }

  _escapeHtml(value) {
    const text = String(value ?? "");

    const foundryEscape = globalThis?.foundry?.utils?.escapeHTML;
    if (typeof foundryEscape === "function") return foundryEscape(text);

    const hbsEscape = globalThis?.Handlebars?.escapeExpression;
    if (typeof hbsEscape === "function") return hbsEscape(text);

    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _getMagicPackCollection() {
    const preferredCollections = ["Order.magiya", "world.magiya"];
    for (const collection of preferredCollections) {
      if (game.packs.get(collection)) return collection;
    }

    const fallback = Array.from(game.packs).find(pack => {
      if (pack.documentName !== "Item") return false;
      const name = String(pack.metadata?.name || "");
      const label = String(pack.metadata?.label || pack.title || "");
      return name === "magiya" || /магия/i.test(label);
    });

    return fallback?.collection || "";
  }

  _getFolderDepth(folderId, byId) {
    let depth = 0;
    let current = byId.get(String(folderId || "")) || null;
    const visited = new Set();

    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      depth += 1;
      current = byId.get(String(current.parentId || "")) || null;
    }

    return depth;
  }

  async _findMagicSchoolFolder(packCollection, affinityLabel) {
    const tree = await this._getPerkCompendiumFolderTree(packCollection);
    const folders = Array.from(tree.byId.values());
    if (!folders.length) return null;

    const affinity = String(affinityLabel || "").trim();
    const strippedAffinity = affinity.replace(/^магия\s+/i, "").trim();
    const candidates = [affinity, strippedAffinity]
      .map(value => this._normalizeCompendiumLabel(value))
      .filter(Boolean);

    let best = null;
    let bestScore = -1;

    for (const folder of folders) {
      const normalizedName = this._normalizeCompendiumLabel(folder.name);
      if (!normalizedName) continue;

      let score = 0;
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (normalizedName === candidate) score = Math.max(score, candidate === candidates[0] ? 300 : 280);
        else if (normalizedName.includes(candidate)) score = Math.max(score, 220);
        else if (candidate.includes(normalizedName)) score = Math.max(score, 180);
      }

      if (!score) continue;

      const depthPenalty = this._getFolderDepth(folder.id, tree.byId) * 5;
      score -= depthPenalty;
      if (score > bestScore) {
        best = folder;
        bestScore = score;
      }
    }

    return best;
  }

  async _openMagicSchoolSelectionDialog(packCollection) {
    const tree = await this._getPerkCompendiumFolderTree(packCollection);
    const rootOptions = tree.byParent.get("") || [];
    const schools = rootOptions
      .map(option => tree.byId.get(String(option.value || "")))
      .filter(Boolean)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));

    if (!schools.length) {
      ui.notifications.warn("В компендиуме «Магия» не найдены папки школ магии.");
      return null;
    }

    const escape = value => this._escapeHtml(value);
    const content = `<form class="os-ccw-choice-form os-ccw-magic-form">
      <div class="form-group">
        <label for="magic-school">Выберите школу магии</label>
        <select id="magic-school" name="magic-school">
          ${schools.map(folder => `<option value="${escape(folder.id)}">${escape(folder.name)}</option>`).join("")}
        </select>
      </div>
      <p class="notes">Для результата «Любая (на выбор)» выберите нужную папку школы прямо из компендиума «Магия».</p>
    </form>`;

    return new Promise(resolve => {
      let resolved = false;
      const dialog = new Dialog({
        title: "Выбор школы магии",
        content,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: "OK",
            callback: (html) => {
              const selectedId = String(html.find('select[name="magic-school"]').val() || "");
              resolved = true;
              resolve(schools.find(folder => folder.id === selectedId) || null);
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
      });
      dialog.render(true);
    });
  }

  async _findMagicCircleFolder(packCollection, schoolFolderId, circleNumber) {
    const tree = await this._getPerkCompendiumFolderTree(packCollection);
    const targetId = String(schoolFolderId || "");
    if (!targetId) return null;

    const candidates = Array.from(tree.byId.values()).filter(folder => {
      let current = folder;
      const visited = new Set();
      while (current?.parentId && !visited.has(current.parentId)) {
        if (current.parentId === targetId) return true;
        visited.add(current.parentId);
        current = tree.byId.get(String(current.parentId || "")) || null;
      }
      return false;
    });

    let best = null;
    let bestScore = -1;
    const circleToken = String(circleNumber);

    for (const folder of candidates) {
      const normalizedName = this._normalizeCompendiumLabel(folder.name);
      if (!normalizedName) continue;

      const hasCircleNumber = new RegExp(`(?:^|\\s)${circleToken}(?:$|\\s)`).test(normalizedName) || normalizedName.startsWith(`${circleToken} `);
      const hasCircleWord = normalizedName.includes("круг");
      const hasSpellWord = normalizedName.includes("заклин");

      let score = 0;
      if (hasCircleNumber) score += 220;
      if (hasCircleWord) score += 100;
      if (hasSpellWord) score += 25;
      if (!score) continue;

      const parentBonus = folder.parentId === targetId ? 30 : 0;
      score += parentBonus;
      score -= this._getFolderDepth(folder.id, tree.byId);

      if (score > bestScore) {
        best = folder;
        bestScore = score;
      }
    }

    return best;
  }

  async _openMagicSpellSelectionDialog({ packCollection, schoolFolder, zeroCircleFolder, firstCircleFolder }) {
    const zeroDocs = zeroCircleFolder
      ? await this._loadCoursePerkDocuments({ packCollection, folderId: zeroCircleFolder.id, folderName: zeroCircleFolder.name })
      : [];
    const firstDocs = firstCircleFolder
      ? await this._loadCoursePerkDocuments({ packCollection, folderId: firstCircleFolder.id, folderName: firstCircleFolder.name })
      : [];

    const zeroChoices = zeroDocs.map(doc => this._getChoiceMeta(doc));
    const firstChoices = firstDocs.map(doc => this._getChoiceMeta(doc));
    const escape = value => this._escapeHtml(value);

    const zeroOptions = zeroChoices.length
      ? zeroChoices.map(choice => `<option value="${escape(choice.uuid)}" data-choice-uuid="${escape(choice.uuid)}" data-choice-name="${escape(choice.name)}" data-description="${escape(choice.description || "")}">${escape(choice.name)}</option>`).join("")
      : '<option value="">— Папка 0 круга пуста —</option>';
    const firstOptions = firstChoices.length
      ? firstChoices.map(choice => `<option value="${escape(choice.uuid)}" data-choice-uuid="${escape(choice.uuid)}" data-choice-name="${escape(choice.name)}" data-description="${escape(choice.description || "")}">${escape(choice.name)}</option>`).join("")
      : '<option value="">— Папка 1 круга пуста —</option>';

    const content = `<form>
      <div class="os-ccw-chip" style="margin-bottom:10px;">Школа: ${escape(schoolFolder?.name || "—")}</div>

      <div class="form-group">
        <label class="checkbox" style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="grant-all-zero" ${zeroChoices.length ? "" : "disabled"}>
          <span>Получить все заклинания из папки 0 круга</span>
        </label>
        <p class="notes" style="margin-top:6px;">Если галочка включена, все заговоры из папки 0 круга будут выданы сразу.</p>
      </div>

      <div class="form-group">
        <label for="zero-spell">0 круг</label>
        <div class="os-ccw-choice-row">
          <button type="button" class="os-ccw-help" data-spell-help="zero" data-help-tooltip="${escape(zeroChoices.length ? "Выберите заговор." : "Папка 0 круга пуста.")}">?</button>
          <select id="zero-spell" name="zero-spell" ${zeroChoices.length ? "" : "disabled"}>
            ${zeroOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label for="first-spell">1 круг</label>
        <div class="os-ccw-choice-row">
          <button type="button" class="os-ccw-help" data-spell-help="first" data-help-tooltip="${escape(firstChoices.length ? "Выберите заклинание 1 круга." : "Папка 1 круга пуста.")}">?</button>
          <select id="first-spell" name="first-spell" ${firstChoices.length ? "" : "disabled"}>
            ${firstOptions}
          </select>
        </div>
      </div>

      <p class="notes">Наведи на ? чтобы увидеть описание. Двойной клик по ? откроет лист выбранного заклинания.</p>
    </form>`;

    return new Promise(resolve => {
      let resolved = false;
      const dialog = new Dialog({
        title: "Выбор магии",
        content,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: "OK",
            callback: (html) => {
              const grantAllZero = !!html.find('input[name="grant-all-zero"]').prop('checked');
              const zeroSpellUuid = String(html.find('select[name="zero-spell"]').val() || "");
              const firstSpellUuid = String(html.find('select[name="first-spell"]').val() || "");
              resolved = true;
              resolve({ grantAllZero, zeroSpellUuid, firstSpellUuid, zeroDocs, firstDocs });
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
      });
      dialog.render(true);
      setTimeout(() => {
        const windowEl = dialog.element.closest('.window-app');
        windowEl.addClass('os-ccw-choice-dialog os-ccw-magic-dialog');
        this._bindChoiceHelpInDialog(dialog.element, {
          selectSelector: 'select[name="zero-spell"]',
          buttonSelector: '[data-spell-help="zero"]',
          choices: zeroChoices
        });
        this._bindChoiceHelpInDialog(dialog.element, {
          selectSelector: 'select[name="first-spell"]',
          buttonSelector: '[data-spell-help="first"]',
          choices: firstChoices
        });

        const checkbox = dialog.element.find('input[name="grant-all-zero"]');
        const zeroSelect = dialog.element.find('select[name="zero-spell"]');
        const zeroHelp = dialog.element.find('[data-spell-help="zero"]');
        const syncZeroState = () => {
          const grantAll = !!checkbox.prop('checked');
          zeroSelect.prop('disabled', grantAll || !zeroChoices.length);
          zeroHelp.prop('disabled', grantAll || !zeroChoices.length);
          zeroHelp.toggleClass('is-empty', grantAll || !zeroChoices.length);
          if (grantAll) {
            this._applyHelpButtonState(zeroHelp, {
              uuid: "",
              name: "Все заклинания 0 круга",
              description: zeroCircleFolder?.name
                ? `Будут выданы все заклинания из папки «${zeroCircleFolder.name}».`
                : "Будут выданы все заклинания 0 круга."
            });
          } else if (zeroChoices.length) {
            zeroSelect.trigger('change');
          } else {
            this._applyHelpButtonState(zeroHelp, { uuid: "", name: "", description: "" });
          }
          if (grantAll || !zeroChoices.length) OrderCharacterCreationWizard._hideGlobalHelpTooltip();
        };
        checkbox.on('change', syncZeroState);
        syncZeroState();
      }, 0);
    });
  }

  async _createUniqueActorItemsFromDocs(docs = []) {
    const seenDocs = new Set();
    const sources = [];
    for (const doc of docs || []) {
      if (!doc) continue;
      const uuid = String(doc.uuid || "");
      const key = uuid || `${doc.type || "Item"}:${doc.name || foundry.utils.randomID()}`;
      if (seenDocs.has(key)) continue;
      seenDocs.add(key);
      sources.push(this._toPerkSourceFromDoc(doc));
    }

    const seen = new Set();
    const actorSeen = new Set(
      this.actor.items
        .map(item => item.flags?.Order?.sourceUuid || `${item.type}:${item.name}`)
    );

    const uniqueSources = [];
    for (const source of sources) {
      const key = source?.flags?.Order?.sourceUuid || `${source?.type || "Item"}:${source?.name || foundry.utils.randomID()}`;
      if (seen.has(key) || actorSeen.has(key)) continue;
      seen.add(key);
      uniqueSources.push(source);
    }

    if (!uniqueSources.length) return [];
    return await this.actor.createEmbeddedDocuments("Item", uniqueSources);
  }

  async _applyMagicAffinitySelection() {
    this.state.magicSchoolName = "";
    this.state.magicGrantedSpellNames = [];

    const packCollection = this._getMagicPackCollection();
    if (!packCollection) {
      ui.notifications.warn("Не найден компендиум «Магия». Шаг выбора заклинаний пропущен.");
      return [];
    }

    let schoolFolder = null;
    const affinity = String(this.state.magAffinity || "");
    const needsManualSchoolChoice = /любая/i.test(affinity);

    if (needsManualSchoolChoice) {
      schoolFolder = await this._openMagicSchoolSelectionDialog(packCollection);
      if (!schoolFolder) return false;
    } else {
      schoolFolder = await this._findMagicSchoolFolder(packCollection, affinity);
      if (!schoolFolder) {
        ui.notifications.warn(`Не удалось автоматически найти папку для «${affinity}». Выберите школу вручную.`);
        schoolFolder = await this._openMagicSchoolSelectionDialog(packCollection);
        if (!schoolFolder) return false;
      }
    }

    this.state.magicSchoolName = String(schoolFolder?.name || affinity || "");

    const zeroCircleFolder = await this._findMagicCircleFolder(packCollection, schoolFolder?.id, 0);
    const firstCircleFolder = await this._findMagicCircleFolder(packCollection, schoolFolder?.id, 1);

    if (!zeroCircleFolder && !firstCircleFolder) {
      ui.notifications.warn(`В школе «${this.state.magicSchoolName || affinity}» не найдены папки 0 или 1 круга.`);
      return [];
    }

    const selection = await this._openMagicSpellSelectionDialog({
      packCollection,
      schoolFolder,
      zeroCircleFolder,
      firstCircleFolder
    });

    if (!selection) return false;

    const docsToCreate = [];
    if (selection.grantAllZero) {
      docsToCreate.push(...(selection.zeroDocs || []));
    } else if (selection.zeroSpellUuid) {
      const zeroDoc = (selection.zeroDocs || []).find(doc => doc.uuid === selection.zeroSpellUuid);
      if (zeroDoc) docsToCreate.push(zeroDoc);
    }

    if (selection.firstSpellUuid) {
      const firstDoc = (selection.firstDocs || []).find(doc => doc.uuid === selection.firstSpellUuid);
      if (firstDoc) docsToCreate.push(firstDoc);
    }

    const uniqueDocs = [];
    const docSeen = new Set();
    for (const doc of docsToCreate) {
      const key = String(doc?.uuid || "");
      if (!doc || docSeen.has(key)) continue;
      docSeen.add(key);
      uniqueDocs.push(doc);
    }

    this.state.magicGrantedSpellNames = uniqueDocs.map(doc => String(doc.name || "")).filter(Boolean);
    return await this._createUniqueActorItemsFromDocs(uniqueDocs);
  }

  _canUseMagicProgression() {
    if (this.state.magPotentialTier !== "Без магии") return true;
    return (this.actor.items?.some(i => i.type === "Spell") ?? false);
  }

  _getMaxLevelForCircle(circle) {
    const map = { 0: 3, 1: 5, 2: 7, 3: 9, 4: 11 };
    const c = Number(circle ?? 0);
    return map[Number.isFinite(c) ? c : 0] ?? 0;
  }

  _calculateSegmentsForItem(item, level, circle) {
    const c = Number(circle ?? 0);
    const lvl = Number(level ?? 0);
    if (!Number.isFinite(c) || !Number.isFinite(lvl) || lvl < 0) return 0;

    const max = this._getMaxLevelForCircle(c);
    if (max > 0 && lvl >= max) return 0;

    const isPerkSkill = item?.type === "Skill" && !!item.system?.isPerk;
    if (isPerkSkill && lvl === 0) {
      const raw = Number(item.system?.perkTrainingPoints ?? 0) || 0;
      if (raw > 0) return Math.trunc(raw);
    }

    if (c === 0) {
      const table0 = [8, 10, 12];
      return table0[lvl] ?? 0;
    }

    const base = 10 + 2 * c;
    return base + 2 * Math.floor(lvl / 2);
  }

  _getSpellProgressionChoices() {
    return (this.actor.items?.filter(i => i.type === "Spell") ?? []).map(sp => {
      const circle = Number(sp.system?.Circle ?? 0) || 0;
      const level = Number(sp.system?.Level ?? 0) || 0;
      const max = this._getMaxLevelForCircle(circle);
      const filled = Number(sp.system?.filledSegments ?? 0) || 0;
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
  }

  _getSkillProgressionChoices() {
    return (this.actor.items?.filter(i => i.type === "Skill") ?? [])
      .filter(sk => !sk.system?.isRacial)
      .map(sk => {
        const circle = Number(sk.system?.Circle ?? 0) || 0;
        const level = Number(sk.system?.Level ?? 0) || 0;
        const max = this._getMaxLevelForCircle(circle);
        const filled = Number(sk.system?.filledSegments ?? 0) || 0;
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
      console.error("[Order] CCW createEmbeddedItemFromUuid failed", e);
      ui.notifications.error("Ошибка при добавлении Item.");
      return null;
    }
  }

  async _levelUpEmbeddedItemKeepingProgress(item) {
    try {
      const circle = Number(item.system?.Circle ?? 0) || 0;
      const max = this._getMaxLevelForCircle(circle);
      const oldLevel = Number(item.system?.Level ?? 0) || 0;
      const oldFilled = Number(item.system?.filledSegments ?? 0) || 0;

      if (max > 0 && oldLevel >= max) {
        ui.notifications.warn("Этот предмет уже достиг максимального уровня.");
        return null;
      }

      const newLevel = oldLevel + 1;
      const filled = (max > 0 && newLevel >= max) ? 0 : oldFilled;

      await item.update(
        {
          "system.Level": Math.min(newLevel, max || newLevel),
          "system.filledSegments": filled
        },
        { osRankUpOpenSheet: true }
      );

      return async () => {
        const current = this.actor.items?.get(item.id);
        if (!current) return;
        await current.update({
          "system.Level": oldLevel,
          "system.filledSegments": oldFilled
        });
      };
    } catch (e) {
      console.error("[Order] CCW levelUpEmbeddedItemKeepingProgress failed", e);
      ui.notifications.error("Ошибка при повышении уровня.");
      return null;
    }
  }

  async _applyMagicProgression({ newUuid = "", upgradeId = "", skipped = false, unavailableResult = "Недоступно" } = {}) {
    if (!this._canUseMagicProgression()) {
      return { ok: true, result: unavailableResult, undo: null };
    }

    if (newUuid && upgradeId) {
      ui.notifications.warn("Выберите: либо новое заклинание, либо повышение существующего.");
      return { ok: false };
    }

    if (skipped) return { ok: true, result: "Пропущено", undo: null };

    if (!newUuid && !upgradeId) {
      ui.notifications.warn("Выберите действие для маг. прокачки или нажмите «Пропустить маг. прокачку».");
      return { ok: false };
    }

    if (newUuid) {
      const created = await this._createEmbeddedItemFromUuid(newUuid, "Spell");
      if (!created) return { ok: false };
      return {
        ok: true,
        result: `Новое заклинание: ${created.name}`,
        undo: async () => {
          if (this.actor.items?.get(created.id)) await this.actor.deleteEmbeddedDocuments("Item", [created.id]);
        }
      };
    }

    const item = this.actor.items?.get(upgradeId);
    if (!item || item.type !== "Spell") {
      ui.notifications.warn("Не удалось найти выбранное заклинание.");
      return { ok: false };
    }
    const undo = await this._levelUpEmbeddedItemKeepingProgress(item);
    if (!undo) return { ok: false };
    return { ok: true, result: `Повышен уровень: ${item.name}`, undo };
  }

  async _applySkillProgression({ newUuid = "", upgradeId = "", skipped = false } = {}) {
    if (newUuid && upgradeId) {
      ui.notifications.warn("Выберите: либо новый навык/перк, либо повышение существующего.");
      return { ok: false };
    }

    if (skipped) return { ok: true, result: "Пропущено", undo: null };

    if (!newUuid && !upgradeId) {
      ui.notifications.warn("Выберите действие для классового навыка или нажмите «Пропустить классовый навык».");
      return { ok: false };
    }

    if (newUuid) {
      const created = await this._createEmbeddedItemFromUuid(newUuid, "Skill");
      if (!created) return { ok: false };
      return {
        ok: true,
        result: `Новый навык/перк: ${created.name}`,
        undo: async () => {
          if (this.actor.items?.get(created.id)) await this.actor.deleteEmbeddedDocuments("Item", [created.id]);
        }
      };
    }

    const item = this.actor.items?.get(upgradeId);
    if (!item || item.type !== "Skill") {
      ui.notifications.warn("Не удалось найти выбранный навык/перк.");
      return { ok: false };
    }
    if (item.system?.isRacial) {
      ui.notifications.warn("Расовые навыки нельзя повышать за очко классового навыка.");
      return { ok: false };
    }
    const undo = await this._levelUpEmbeddedItemKeepingProgress(item);
    if (!undo) return { ok: false };
    return { ok: true, result: `Повышен уровень: ${item.name}`, undo };
  }

  _rankLimiter(rank) {
    const r = Number(rank ?? 0);
    const rr = Number.isFinite(r) ? r : 0;
    return 5 + Math.max(0, rr - 1);
  }

  async _applyAttributePicks(picks, expectedCount, { rankOverride = null } = {}) {
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
    const rank = rankOverride === null ? (Number(systemData.Rank ?? 0) || 0) : (Number(rankOverride) || 0);
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
    this.state.classUsesBaseEquipment = this._classHasBaseEquipmentAllocation(doc);
    this.state.classUsesSpecializedEquipment = this._classHasSpecializedEquipmentAllocation(doc);
    this.state.specializedCourseSelections = {};
    this.state.baseEquipmentSelections = {};
    this.state.specializedEquipmentSelections = {};
    this.state.allocatedPerkNames = [];
    this.state.allocatedBaseEquipmentNames = [];
    this.state.allocatedSpecializedEquipmentNames = [];

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
    const content = `<form class="os-ccw-choice-form">
      <div class="form-group">
        <label for="skills">Выберите навык</label>
        <div class="os-ccw-choice-row">
          <button type="button" class="os-ccw-help" data-skill-help="class" data-help-tooltip="Сначала выберите навык.">?</button>
          <select id="skills" name="skills">
            ${skills.map(s => `<option value="${s._id}">${s.name}</option>`).join("")}
          </select>
        </div>
        <p class="notes" style="margin-top:6px;">Наведи на ? чтобы увидеть описание. Двойной клик по ? откроет лист навыка.</p>
      </div>
    </form>`;

    return new Promise(resolve => {
      const dialog = new Dialog({
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
      });
      dialog.render(true);
      setTimeout(() => {
        dialog.element.closest('.window-app').addClass('os-ccw-choice-dialog os-ccw-skill-dialog');
        this._bindChoiceHelpInDialog(dialog.element, {
          selectSelector: 'select[name="skills"]',
          buttonSelector: '[data-skill-help="class"]',
          choices: skills
        });
      }, 0);
    });
  }


  async _openRaceSkillSelectionDialog(raceItem) {
    const skills = Array.isArray(raceItem.system?.Skills) ? raceItem.system.Skills : [];
    if (!skills.length) return null;

    const content = `<form class="os-ccw-choice-form">
      <div class="form-group">
        <label for="race-skill">Выберите навык расы</label>
        <div class="os-ccw-choice-row">
          <button type="button" class="os-ccw-help" data-skill-help="race" data-help-tooltip="Сначала выберите навык.">?</button>
          <select id="race-skill" name="race-skill">
            ${skills.map(s => `<option value="${s._id}">${s.name}</option>`).join("")}
          </select>
        </div>
        <p class="notes" style="margin-top:6px;">Наведи на ? чтобы увидеть описание. Двойной клик по ? откроет лист навыка.</p>
      </div>
    </form>`;

    return new Promise(resolve => {
      let resolved = false;
      const dialog = new Dialog({
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
      });
      dialog.render(true);
      setTimeout(() => {
        dialog.element.closest('.window-app').addClass('os-ccw-choice-dialog os-ccw-skill-dialog');
        this._bindChoiceHelpInDialog(dialog.element, {
          selectSelector: 'select[name="race-skill"]',
          buttonSelector: '[data-skill-help="race"]',
          choices: skills
        });
      }, 0);
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

  _normalizeSelectionEntry(entry = {}, { includeCost = false, includeExchange = false } = {}) {
    const folderPath = Array.isArray(entry.folderPath)
      ? entry.folderPath.map(v => String(v || "")).filter(Boolean)
      : (entry.folderId ? [String(entry.folderId)] : []);

    return {
      id: String(entry.id || foundry.utils.randomID()),
      packCollection: String(entry.packCollection || ""),
      folderId: String(entry.folderId || folderPath[folderPath.length - 1] || ""),
      folderName: String(entry.folderName || ""),
      folderPath,
      grantAllFromFolder: !!entry.grantAllFromFolder,
      allowFolderChoiceInWizard: !!entry.allowFolderChoiceInWizard,
      ...(includeCost ? { cost: Math.max(0, Number(entry.cost ?? 0) || 0) } : {}),
      ...(includeExchange ? {
        canExchangeForEquipmentPoints: !!entry.canExchangeForEquipmentPoints,
        exchangeEquipmentPoints: Math.max(0, Number(entry.exchangeEquipmentPoints ?? 0) || 0)
      } : {})
    };
  }

  _normalizeSpecializedCourseEntry(course = {}) {
    return this._normalizeSelectionEntry(course, { includeCost: true });
  }

  _normalizeBaseEquipmentEntry(entry = {}) {
    return this._normalizeSelectionEntry(entry, { includeExchange: true });
  }

  _normalizeSpecializedEquipmentEntry(entry = {}) {
    return this._normalizeSelectionEntry(entry, { includeCost: true });
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

  _getBaseEquipmentEntries(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    return Array.isArray(system?.baseFighterEquipment)
      ? system.baseFighterEquipment.map(entry => this._normalizeBaseEquipmentEntry(entry))
      : [];
  }

  _getSpecializedEquipmentEntries(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    return Array.isArray(system?.specializedFighterEquipment)
      ? system.specializedFighterEquipment.map(entry => this._normalizeSpecializedEquipmentEntry(entry))
      : [];
  }

  _classHasPerkAllocation(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    const budget = Number(system?.perkPointBudget ?? 0) || 0;
    return budget > 0 || this._getSpecializedCourseEntries(system).length > 0;
  }

  _classHasBaseEquipmentAllocation(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    return this._getBaseEquipmentEntries(system).length > 0;
  }

  _classHasSpecializedEquipmentAllocation(classLike = null) {
    const system = classLike?.system ?? classLike ?? this._getClassItem()?.system ?? {};
    return this._getSpecializedEquipmentEntries(system).length > 0;
  }

  _getPackLabel(collection) {
    if (!collection) return "";
    const pack = game.packs.get(collection);
    return pack?.metadata?.label || pack?.title || collection;
  }

  async _getPackDocumentsCached(packCollection) {
    const key = String(packCollection || "");
    if (!key) return [];
    if (this._ccwCache.packDocs.has(key)) return this._ccwCache.packDocs.get(key);

    const pack = game.packs.get(key);
    if (!pack) return [];

    const docs = await pack.getDocuments();
    this._ccwCache.packDocs.set(key, docs);
    return docs;
  }

  _getCourseDocsCacheKey(course = {}) {
    const packCollection = String(course?.packCollection || "");
    const folderPath = Array.isArray(course?.folderPath)
      ? course.folderPath.map(v => String(v || "")).filter(Boolean)
      : [];
    const folderId = String(course?.folderId || folderPath[folderPath.length - 1] || "");
    const folderName = String(course?.folderName || "");
    return JSON.stringify({ packCollection, folderId, folderName, folderPath });
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
    const key = String(packCollection || "");
    if (!key) return { hasRootPerks: false, byParent: new Map(), byId: new Map() };
    if (this._ccwCache.folderTrees.has(key)) return this._ccwCache.folderTrees.get(key);

    const pack = game.packs.get(key);
    if (!pack) return { hasRootPerks: false, byParent: new Map(), byId: new Map() };

    try {
      const docs = await this._getPackDocumentsCached(key);
      const byId = new Map();
      const hasRootPerks = docs.some(doc => !doc.folder);

      for (const doc of docs) {
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

      const tree = { hasRootPerks, byParent, byId };
      this._ccwCache.folderTrees.set(key, tree);
      return tree;
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

    const cacheKey = this._getCourseDocsCacheKey(course);
    if (this._ccwCache.courseDocs.has(cacheKey)) return this._ccwCache.courseDocs.get(cacheKey);

    const pack = game.packs.get(course.packCollection);
    if (!pack) return [];

    try {
      const docs = await this._getPackDocumentsCached(course.packCollection);
      const folderPath = Array.isArray(course.folderPath)
        ? course.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const targetFolderId = String(course.folderId || folderPath[folderPath.length - 1] || "");
      const targetFolderName = String(course.folderName || "");

      if (!targetFolderId && !targetFolderName) return [];

      const result = docs
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

      this._ccwCache.courseDocs.set(cacheKey, result);
      return result;
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

    const builtCourses = await Promise.all(coursesRaw.map(async (courseRaw, index) => {
      const selectedState = this.state.specializedCourseSelections?.[courseRaw.id] || {};
      const classConfiguredFolderPath = Array.isArray(courseRaw.folderPath)
        ? courseRaw.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const canChooseFolderInWizard = !!courseRaw.allowFolderChoiceInWizard;
      const effectiveFolderPath = canChooseFolderInWizard
        ? this._getEffectiveCourseFolderPath(courseRaw, selectedState)
        : classConfiguredFolderPath;
      const effectiveFolderState = await this._getPerkCompendiumFolderState(courseRaw.packCollection, effectiveFolderPath);
      const classHasConfiguredFolder = this._hasExplicitCourseFolder(courseRaw);

      const effectiveFolderId = String(effectiveFolderPath[effectiveFolderPath.length - 1] || courseRaw.folderId || "");
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

      const picks = Array.isArray(selectedState.picks)
        ? selectedState.picks.map(v => String(v || ""))
        : [];
      while (picks.length < selectedCount) picks.push("");

      const needsFolderSelection = canChooseFolderInWizard && !!effectiveFolderState.levels.length && !effectiveFolderState.levels[0]?.selectedValue;
      const missingConfiguredFolder = !canChooseFolderInWizard && !classHasConfiguredFolder;
      const choiceMetas = courseDocs.map(doc => this._getChoiceMeta(doc));
      const choiceMap = new Map(choiceMetas.map(choice => [choice.uuid, choice]));

      return {
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
        purchases: Array.from({ length: selectedCount }, (_, pickIndex) => {
          const selectedUuid = String(picks[pickIndex] || "");
          const selectedChoice = choiceMap.get(selectedUuid) || null;
          return {
            pickIndex,
            labelNumber: pickIndex + 1,
            selectedUuid,
            selectedChoiceName: selectedChoice?.name || "",
            selectedChoiceDescription: selectedChoice?.description || ""
          };
        }),
        choices: choiceMetas,
        grantedChoices: choiceMetas,
        count: courseDocs.length,
        raw: docsCourse,
        spent: selectedCount * cost
      };
    }));

    const spent = builtCourses.reduce((sum, course) => sum + (Number(course.spent) || 0), 0);

    return {
      budget,
      spent,
      remaining: budget - spent,
      courses: builtCourses
    };
  }


  async _getBaseEquipmentAllocationData() {
    if (!this.state.classUsesBaseEquipment) {
      return {
        exchangeTotal: 0,
        entries: []
      };
    }

    const classItem = this._getClassItem();
    if (!classItem) {
      return {
        exchangeTotal: 0,
        entries: []
      };
    }

    const entriesRaw = this._getBaseEquipmentEntries(classItem);

    const entries = await Promise.all(entriesRaw.map(async (entryRaw, index) => {
      const selectedState = this.state.baseEquipmentSelections?.[entryRaw.id] || {};
      const classConfiguredFolderPath = Array.isArray(entryRaw.folderPath)
        ? entryRaw.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const canChooseFolderInWizard = !!entryRaw.allowFolderChoiceInWizard;
      const effectiveFolderPath = canChooseFolderInWizard
        ? this._getEffectiveCourseFolderPath(entryRaw, selectedState)
        : classConfiguredFolderPath;
      const effectiveFolderState = await this._getPerkCompendiumFolderState(entryRaw.packCollection, effectiveFolderPath);
      const classHasConfiguredFolder = this._hasExplicitCourseFolder(entryRaw);

      const effectiveFolderId = String(effectiveFolderPath[effectiveFolderPath.length - 1] || entryRaw.folderId || "");
      const effectiveFolderName = effectiveFolderId === "__root__"
        ? "Без папки"
        : (effectiveFolderState.summary || entryRaw.folderName || "");
      const docsEntry = {
        ...entryRaw,
        folderPath: effectiveFolderPath,
        folderId: effectiveFolderId,
        folderName: effectiveFolderName
      };
      const entryDocs = await this._loadCoursePerkDocuments(docsEntry);
      const choiceMetas = entryDocs.map(doc => this._getChoiceMeta(doc));
      const choiceMap = new Map(choiceMetas.map(choice => [choice.uuid, choice]));

      const needsFolderSelection = canChooseFolderInWizard && !!effectiveFolderState.levels.length && !effectiveFolderState.levels[0]?.selectedValue;
      const missingConfiguredFolder = !canChooseFolderInWizard && !classHasConfiguredFolder;
      const selectedUuid = String(selectedState.pick || "");
      const selectedChoice = choiceMap.get(selectedUuid) || null;
      const exchanged = !!selectedState.exchanged && !!entryRaw.canExchangeForEquipmentPoints;
      const exchangePoints = Math.max(0, Number(entryRaw.exchangeEquipmentPoints ?? 0) || 0);

      return {
        id: entryRaw.id,
        label: `${this._getPackLabel(entryRaw.packCollection) || "Базовая экипировка"} ${entriesRaw.length > 1 ? `#${index + 1}` : ""}`.trim(),
        packLabel: this._getPackLabel(entryRaw.packCollection),
        folderName: effectiveFolderName,
        folderSummary: effectiveFolderState.summary || entryRaw.folderName || "",
        folderLevels: effectiveFolderState.levels.map((levelData, levelIndex) => ({
          ...levelData,
          placeholder: levelIndex === 0 ? "— Выберите папку —" : "— Оставить текущую папку —"
        })),
        allowFolderSelection: canChooseFolderInWizard,
        missingConfiguredFolder,
        needsFolderSelection,
        grantAll: !!entryRaw.grantAllFromFolder,
        exchangeable: !!entryRaw.canExchangeForEquipmentPoints,
        exchangePoints,
        exchanged,
        selectedUuid,
        selectedChoiceName: selectedChoice?.name || "",
        selectedChoiceDescription: selectedChoice?.description || "",
        choices: choiceMetas,
        grantedChoices: choiceMetas,
        count: entryDocs.length,
        raw: docsEntry,
        exchangeGain: exchanged ? exchangePoints : 0
      };
    }));

    return {
      exchangeTotal: entries.reduce((sum, entry) => sum + (Number(entry.exchangeGain) || 0), 0),
      entries
    };
  }

  async _getSpecializedEquipmentAllocationData() {
    if (!this.state.classUsesSpecializedEquipment) {
      return {
        budget: 0,
        spent: 0,
        remaining: 0,
        entries: []
      };
    }

    const classItem = this._getClassItem();
    if (!classItem) {
      return {
        budget: 0,
        spent: 0,
        remaining: 0,
        entries: []
      };
    }

    const baseEquipmentData = await this._getBaseEquipmentAllocationData();
    const budget = Math.max(0, Number(classItem.system?.equipmentPointBudget ?? 0) || 0) + Math.max(0, Number(baseEquipmentData.exchangeTotal ?? 0) || 0);
    const entriesRaw = this._getSpecializedEquipmentEntries(classItem);

    const entries = await Promise.all(entriesRaw.map(async (entryRaw, index) => {
      const selectedState = this.state.specializedEquipmentSelections?.[entryRaw.id] || {};
      const classConfiguredFolderPath = Array.isArray(entryRaw.folderPath)
        ? entryRaw.folderPath.map(v => String(v || "")).filter(Boolean)
        : [];
      const canChooseFolderInWizard = !!entryRaw.allowFolderChoiceInWizard;
      const effectiveFolderPath = canChooseFolderInWizard
        ? this._getEffectiveCourseFolderPath(entryRaw, selectedState)
        : classConfiguredFolderPath;
      const effectiveFolderState = await this._getPerkCompendiumFolderState(entryRaw.packCollection, effectiveFolderPath);
      const classHasConfiguredFolder = this._hasExplicitCourseFolder(entryRaw);

      const effectiveFolderId = String(effectiveFolderPath[effectiveFolderPath.length - 1] || entryRaw.folderId || "");
      const effectiveFolderName = effectiveFolderId === "__root__"
        ? "Без папки"
        : (effectiveFolderState.summary || entryRaw.folderName || "");
      const docsEntry = {
        ...entryRaw,
        folderPath: effectiveFolderPath,
        folderId: effectiveFolderId,
        folderName: effectiveFolderName
      };
      const entryDocs = await this._loadCoursePerkDocuments(docsEntry);

      const cost = Math.max(0, Number(entryRaw.cost ?? 0) || 0);
      const selectedCount = entryRaw.grantAllFromFolder
        ? Math.min(1, Math.max(0, Number(selectedState.count || 0)))
        : Math.max(0, Number(selectedState.count || 0));

      const picks = Array.isArray(selectedState.picks)
        ? selectedState.picks.map(v => String(v || ""))
        : [];
      while (picks.length < selectedCount) picks.push("");

      const needsFolderSelection = canChooseFolderInWizard && !!effectiveFolderState.levels.length && !effectiveFolderState.levels[0]?.selectedValue;
      const missingConfiguredFolder = !canChooseFolderInWizard && !classHasConfiguredFolder;
      const choiceMetas = entryDocs.map(doc => this._getChoiceMeta(doc));
      const choiceMap = new Map(choiceMetas.map(choice => [choice.uuid, choice]));

      return {
        id: entryRaw.id,
        label: `${this._getPackLabel(entryRaw.packCollection) || "Специализированная экипировка"} ${entriesRaw.length > 1 ? `#${index + 1}` : ""}`.trim(),
        packLabel: this._getPackLabel(entryRaw.packCollection),
        folderName: effectiveFolderName,
        folderSummary: effectiveFolderState.summary || entryRaw.folderName || "",
        folderLevels: effectiveFolderState.levels.map((levelData, levelIndex) => ({
          ...levelData,
          placeholder: levelIndex === 0 ? "— Выберите папку —" : "— Оставить текущую папку —"
        })),
        allowFolderSelection: canChooseFolderInWizard,
        missingConfiguredFolder,
        needsFolderSelection,
        cost,
        grantAll: !!entryRaw.grantAllFromFolder,
        selectedCount,
        picks,
        purchases: Array.from({ length: selectedCount }, (_, pickIndex) => {
          const selectedUuid = String(picks[pickIndex] || "");
          const selectedChoice = choiceMap.get(selectedUuid) || null;
          return {
            pickIndex,
            labelNumber: pickIndex + 1,
            selectedUuid,
            selectedChoiceName: selectedChoice?.name || "",
            selectedChoiceDescription: selectedChoice?.description || ""
          };
        }),
        choices: choiceMetas,
        grantedChoices: choiceMetas,
        count: entryDocs.length,
        raw: docsEntry,
        spent: selectedCount * cost
      };
    }));

    const spent = entries.reduce((sum, entry) => sum + (Number(entry.spent) || 0), 0);
    return {
      budget,
      spent,
      remaining: budget - spent,
      entries
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

  async _applyBaseEquipmentSelections() {
    if (!this.state.classUsesBaseEquipment) return [];

    const allocation = await this._getBaseEquipmentAllocationData();
    const sources = [];

    for (const entry of allocation.entries || []) {
      if (entry.exchanged) continue;

      if (entry.missingConfiguredFolder) {
        ui.notifications.warn(`Для варианта «${entry.label}» в классе не настроена папка.`);
        return false;
      }

      if (entry.needsFolderSelection) {
        ui.notifications.warn(`Для варианта «${entry.label}» нужно выбрать папку или подпапку.`);
        return false;
      }

      const docs = await this._loadCoursePerkDocuments(entry.raw);
      if (!docs.length) {
        ui.notifications.warn(`В выбранной папке базовой экипировки «${entry.label}» не найдено ни одного элемента.`);
        return false;
      }

      if (entry.grantAll) {
        for (const doc of docs) sources.push(this._toPerkSourceFromDoc(doc));
        continue;
      }

      if (!entry.selectedUuid) {
        ui.notifications.warn(`Для варианта «${entry.label}» нужно выбрать предмет или обменять его на О.Э.`);
        return false;
      }

      const picked = docs.find(doc => doc.uuid === entry.selectedUuid);
      if (!picked) {
        ui.notifications.warn(`Не удалось найти выбранный предмет для варианта «${entry.label}».`);
        return false;
      }

      sources.push(this._toPerkSourceFromDoc(picked));
    }

    if (!sources.length) return [];
    return await this.actor.createEmbeddedDocuments("Item", sources);
  }

  async _applySpecializedEquipmentSelections() {
    if (!this.state.classUsesSpecializedEquipment) return [];

    const allocation = await this._getSpecializedEquipmentAllocationData();
    if (allocation.spent > allocation.budget) {
      ui.notifications.warn("Вы выбрали больше вариантов, чем позволяет запас О.Э.");
      return false;
    }

    const sources = [];

    for (const entry of allocation.entries || []) {
      if (!entry.selectedCount) continue;

      if (entry.missingConfiguredFolder) {
        ui.notifications.warn(`Для варианта «${entry.label}» в классе не настроена папка.`);
        return false;
      }

      if (entry.needsFolderSelection) {
        ui.notifications.warn(`Для варианта «${entry.label}» нужно выбрать папку или подпапку.`);
        return false;
      }

      const docs = await this._loadCoursePerkDocuments(entry.raw);
      if (!docs.length) {
        ui.notifications.warn(`В выбранной папке специализированной экипировки «${entry.label}» не найдено ни одного элемента.`);
        return false;
      }

      if (entry.grantAll) {
        for (const doc of docs) sources.push(this._toPerkSourceFromDoc(doc));
        continue;
      }

      for (const purchase of entry.purchases || []) {
        if (!purchase.selectedUuid) {
          ui.notifications.warn(`Для варианта «${entry.label}» нужно выбрать предмет для каждой покупки.`);
          return false;
        }

        const picked = docs.find(doc => doc.uuid === purchase.selectedUuid);
        if (!picked) {
          ui.notifications.warn(`Не удалось найти выбранный предмет для варианта «${entry.label}».`);
          return false;
        }

        sources.push(this._toPerkSourceFromDoc(picked));
      }
    }

    if (!sources.length) return [];
    return await this.actor.createEmbeddedDocuments("Item", sources);
  }

  _buildSummary() {
    const systemData = this.actor.system ?? this.actor.data?.system ?? {};
    const rank = Number(systemData.Rank ?? 0) || 0;
    const race = this.state.raceName || this._nameFromIndex(this.state.raceUuid, this._races) || "—";
    const cls = this.state.className || this._nameFromIndex(this.state.classUuid, this._classes) || "—";

    const academyMagic = this.state.academyMagicResult || (this._canUseMagicProgression() ? "Не выбрано" : "Недоступно (без магии)");
    const academy = `3 очка характеристик + маг. прокачка: ${academyMagic}`;
    const rankMagic = this.state.rankMagicResult || (this._canUseMagicProgression() ? "Не выбрано" : "Недоступно (без магии)");
    const rankSkill = this.state.rankSkillResult || "Не выбрано";
    const rankText = `Ранг ${rank} (2 очка характеристик + маг. прокачка: ${rankMagic} + классовый навык: ${rankSkill})`;
    const perkText = this.state.classUsesPerkPoints
      ? (this.state.allocatedPerkNames.length ? this.state.allocatedPerkNames.join(", ") : "Пропущено")
      : "Не используется";
    const baseEquipmentText = this.state.classUsesBaseEquipment
      ? (this.state.allocatedBaseEquipmentNames.length ? this.state.allocatedBaseEquipmentNames.join(", ") : "Обмен / пропуск")
      : "Не используется";
    const specializedEquipmentText = this.state.classUsesSpecializedEquipment
      ? (this.state.allocatedSpecializedEquipmentNames.length ? this.state.allocatedSpecializedEquipmentNames.join(", ") : "Пропущено")
      : "Не используется";

    const magPotential = this.state.magPotentialTier
      ? `${this.state.magPotentialTier}${this.state.magPotentialBonus ? ` (+${this.state.magPotentialBonus} к Магии)` : ""}`
      : "—";

    const magAffinityBase = this.state.magPotentialTier === "Без магии"
      ? "Без магии"
      : (this.state.magicSchoolName || this.state.magAffinity || "—");
    const magicSpellsText = this.state.magicGrantedSpellNames.length
      ? ` · ${this.state.magicGrantedSpellNames.join(", ")}`
      : "";
    const magAffinity = `${magAffinityBase}${magicSpellsText}`;

    return {
      race,
      class: cls,
      perks: perkText,
      baseEquipment: baseEquipmentText,
      specializedEquipment: specializedEquipmentText,
      academy,
      rank: rankText,
      magPotential,
      magAffinity
    };
  }
}
