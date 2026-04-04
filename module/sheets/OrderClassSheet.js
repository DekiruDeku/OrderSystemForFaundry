import OrderItemSheet from "./OrderItemSheet.js";

export default class OrderClassSheet extends OrderItemSheet {

  get template() {
    return `systems/Order/templates/sheets/class-sheet.hbs`;
  }

  async getData() {
    const sheetData = await super.getData();
    const perkPackOptions = this._getPerkCompendiumOptions();

    const specializedCourseRows = await this._buildSelectionRows(
      this._getSpecializedCourseEntries(this.item?.system),
      { includeCost: true }
    );

    const baseEquipmentRows = await this._buildSelectionRows(
      this._getBaseEquipmentEntries(this.item?.system),
      { includeExchange: true }
    );

    const specializedEquipmentRows = await this._buildSelectionRows(
      this._getSpecializedEquipmentEntries(this.item?.system),
      { includeCost: true }
    );

    sheetData.perkPackOptions = perkPackOptions;
    sheetData.specializedCourseRows = specializedCourseRows;
    sheetData.baseEquipmentRows = baseEquipmentRows;
    sheetData.specializedEquipmentRows = specializedEquipmentRows;
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    const skillsDropArea = html.find(".skills-drop");
    skillsDropArea.on("dragenter", this._onDragEnter.bind(this));
    skillsDropArea.on("dragover", this._onDragOver.bind(this));
    skillsDropArea.on("drop", (event) => this._onDrop(event, "Skills"));

    const perksDropArea = html.find(".perks-drop");
    perksDropArea.on("dragenter", this._onDragEnter.bind(this));
    perksDropArea.on("dragover", this._onDragOver.bind(this));
    perksDropArea.on("drop", (event) => this._onDrop(event, "basePerks"));

    html.find(".skill-link").click(this._onSkillLinkClick.bind(this));
    html.find(".perk-link").click(this._onPerkLinkClick.bind(this));

    html.find(".delete-skill-button").click(this._onDeleteSkillClick.bind(this));
    html.find(".delete-perk-button").click(this._onDeleteSkillClick.bind(this));

    html.find(".os-course-add").on("click", (event) => this._onAddSelection(event, "course"));
    html.find(".os-course-remove").on("click", (event) => this._onRemoveSelection(event, "course"));
    html.find(".os-course-pack-select").on("change", (event) => this._onSelectionPackChange(event, "course"));
    html.find(".os-course-folder-select").on("change", (event) => this._onSelectionFolderChange(event, "course"));
    html.find(".os-course-cost-input").on("change", (event) => this._onSelectionCostChange(event, "course"));
    html.find(".os-course-grantall").on("change", (event) => this._onSelectionGrantAllChange(event, "course"));
    html.find(".os-course-allow-folder-choice").on("change", (event) => this._onSelectionAllowFolderChoiceChange(event, "course"));

    html.find(".os-baseeq-add").on("click", (event) => this._onAddSelection(event, "baseEquipment"));
    html.find(".os-baseeq-remove").on("click", (event) => this._onRemoveSelection(event, "baseEquipment"));
    html.find(".os-baseeq-pack-select").on("change", (event) => this._onSelectionPackChange(event, "baseEquipment"));
    html.find(".os-baseeq-folder-select").on("change", (event) => this._onSelectionFolderChange(event, "baseEquipment"));
    html.find(".os-baseeq-grantall").on("change", (event) => this._onSelectionGrantAllChange(event, "baseEquipment"));
    html.find(".os-baseeq-allow-folder-choice").on("change", (event) => this._onSelectionAllowFolderChoiceChange(event, "baseEquipment"));
    html.find(".os-baseeq-exchange-toggle").on("change", (event) => this._onSelectionExchangeToggleChange(event, "baseEquipment"));
    html.find(".os-baseeq-exchange-points").on("change", (event) => this._onSelectionExchangePointsChange(event, "baseEquipment"));

    html.find(".os-speceq-add").on("click", (event) => this._onAddSelection(event, "specializedEquipment"));
    html.find(".os-speceq-remove").on("click", (event) => this._onRemoveSelection(event, "specializedEquipment"));
    html.find(".os-speceq-pack-select").on("change", (event) => this._onSelectionPackChange(event, "specializedEquipment"));
    html.find(".os-speceq-folder-select").on("change", (event) => this._onSelectionFolderChange(event, "specializedEquipment"));
    html.find(".os-speceq-cost-input").on("change", (event) => this._onSelectionCostChange(event, "specializedEquipment"));
    html.find(".os-speceq-grantall").on("change", (event) => this._onSelectionGrantAllChange(event, "specializedEquipment"));
    html.find(".os-speceq-allow-folder-choice").on("change", (event) => this._onSelectionAllowFolderChoiceChange(event, "specializedEquipment"));
  }

  _emptyLegacyCourse() {
    return {
      packCollection: "",
      folderId: "",
      folderName: "",
      folderPath: [],
      grantAllFromFolder: false,
      allowFolderChoiceInWizard: false,
      cost: 0
    };
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

  _normalizeCourseEntry(course = {}) {
    return this._normalizeSelectionEntry(course, { includeCost: true });
  }

  _normalizeBaseEquipmentEntry(entry = {}) {
    return this._normalizeSelectionEntry(entry, { includeExchange: true });
  }

  _normalizeSpecializedEquipmentEntry(entry = {}) {
    return this._normalizeSelectionEntry(entry, { includeCost: true });
  }

  _getSpecializedCourseEntries(system = {}) {
    const rows = Array.isArray(system?.specializedFighterCourses)
      ? system.specializedFighterCourses.map(course => this._normalizeCourseEntry(course))
      : [];

    if (rows.length) return rows;

    const legacy = system?.specializedFighterCourse;
    if (!legacy) return [];

    const hasLegacyData = !!(
      legacy.packCollection ||
      legacy.folderId ||
      legacy.folderName ||
      legacy.grantAllFromFolder ||
      legacy.allowFolderChoiceInWizard ||
      Number(legacy.cost ?? 0)
    );

    return hasLegacyData ? [this._normalizeCourseEntry(legacy)] : [];
  }

  _getBaseEquipmentEntries(system = {}) {
    return Array.isArray(system?.baseFighterEquipment)
      ? system.baseFighterEquipment.map(entry => this._normalizeBaseEquipmentEntry(entry))
      : [];
  }

  _getSpecializedEquipmentEntries(system = {}) {
    return Array.isArray(system?.specializedFighterEquipment)
      ? system.specializedFighterEquipment.map(entry => this._normalizeSpecializedEquipmentEntry(entry))
      : [];
  }

  async _saveSpecializedCourses(courses) {
    await this.item.update({
      "system.specializedFighterCourses": courses,
      "system.specializedFighterCourse": this._emptyLegacyCourse()
    });
  }

  async _saveBaseEquipmentEntries(entries) {
    await this.item.update({
      "system.baseFighterEquipment": entries
    });
  }

  async _saveSpecializedEquipmentEntries(entries) {
    await this.item.update({
      "system.specializedFighterEquipment": entries
    });
  }

  _selectionConfig(type) {
    switch (type) {
      case "course":
        return {
          datasetKey: "courseId",
          getter: (system) => this._getSpecializedCourseEntries(system),
          saver: (entries) => this._saveSpecializedCourses(entries),
          normalizer: (entry) => this._normalizeCourseEntry(entry),
          includeCost: true,
          includeExchange: false
        };
      case "baseEquipment":
        return {
          datasetKey: "equipmentId",
          getter: (system) => this._getBaseEquipmentEntries(system),
          saver: (entries) => this._saveBaseEquipmentEntries(entries),
          normalizer: (entry) => this._normalizeBaseEquipmentEntry(entry),
          includeCost: false,
          includeExchange: true
        };
      case "specializedEquipment":
        return {
          datasetKey: "equipmentId",
          getter: (system) => this._getSpecializedEquipmentEntries(system),
          saver: (entries) => this._saveSpecializedEquipmentEntries(entries),
          normalizer: (entry) => this._normalizeSpecializedEquipmentEntry(entry),
          includeCost: true,
          includeExchange: false
        };
      default:
        throw new Error(`[Order] Unknown selection config type: ${type}`);
    }
  }

  async _buildSelectionRows(entries, options = {}) {
    return await Promise.all((entries || []).map(async (entry, index) => {
      const folderState = await this._getCompendiumFolderState(
        entry.packCollection || "",
        entry.folderPath || [],
        entry.folderId || "",
        entry.folderName || ""
      );
      return {
        ...entry,
        __index: index + 1,
        __folderLevels: folderState.levels,
        __folderSummary: folderState.summary,
        __hasFolderChoices: folderState.levels.length > 0,
        __includeCost: !!options.includeCost,
        __includeExchange: !!options.includeExchange
      };
    }));
  }

  _getPerkCompendiumOptions() {
    return Array.from(game.packs)
      .filter(pack => pack.documentName === "Item")
      .map(pack => ({
        value: pack.collection,
        label: pack.metadata?.label || pack.title || pack.collection
      }))
      .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"));
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

  async _getCompendiumFolderTree(packCollection) {
    if (!packCollection) return { hasRootDocs: false, byParent: new Map(), byId: new Map() };
    const pack = game.packs.get(packCollection);
    if (!pack) return { hasRootDocs: false, byParent: new Map(), byId: new Map() };

    try {
      const docs = await pack.getDocuments();
      const byId = new Map();
      const hasRootDocs = docs.some(doc => !doc.folder);

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

      return { hasRootDocs, byParent, byId };
    } catch (err) {
      console.warn("[Order] Failed to load class selection folders", err);
      return { hasRootDocs: false, byParent: new Map(), byId: new Map() };
    }
  }

  async _getCompendiumFolderState(packCollection, folderPath = [], folderId = "", folderName = "") {
    const tree = await this._getCompendiumFolderTree(packCollection);
    const levels = [];

    const normalizedPath = Array.isArray(folderPath)
      ? folderPath.map(v => String(v || "")).filter(Boolean)
      : (folderId ? [String(folderId)] : []);

    let parentId = "";
    let depth = 0;

    while (true) {
      const options = [];
      if (depth === 0 && tree.hasRootDocs) options.push({ value: "__root__", label: "Без папки" });
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

    let summary = "";
    const pickedPath = levels.map(level => level.selectedValue).filter(Boolean);
    if (pickedPath[0] === "__root__") {
      summary = "Без папки";
    } else if (pickedPath.length) {
      summary = pickedPath.map(id => tree.byId.get(id)?.name || "").filter(Boolean).join(" / ");
    } else if (folderName) {
      summary = folderName;
    }

    return { levels, summary };
  }

  async _onAddSelection(event, type) {
    event.preventDefault();
    const cfg = this._selectionConfig(type);
    const entries = cfg.getter(this.item?.system);
    entries.push(cfg.normalizer({}));
    await cfg.saver(entries);
    this.render(false);
  }

  async _onRemoveSelection(event, type) {
    event.preventDefault();
    const cfg = this._selectionConfig(type);
    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const entries = cfg.getter(this.item?.system)
      .filter(entry => entry.id !== selectionId);

    await cfg.saver(entries);
    this.render(false);
  }

  async _onSelectionPackChange(event, type) {
    const cfg = this._selectionConfig(type);
    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const value = String(event.currentTarget?.value || "");
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].packCollection = value;
    entries[idx].folderId = "";
    entries[idx].folderName = "";
    entries[idx].folderPath = [];

    await cfg.saver(entries);
    this.render(false);
  }

  async _onSelectionFolderChange(event, type) {
    const cfg = this._selectionConfig(type);
    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const level = Math.max(0, Number(event.currentTarget?.dataset?.level ?? 0) || 0);
    const value = String(event.currentTarget?.value || "");
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    const nextPath = Array.isArray(entries[idx].folderPath)
      ? [...entries[idx].folderPath]
      : (entries[idx].folderId ? [entries[idx].folderId] : []);

    nextPath.length = level;
    if (value) nextPath.push(value);

    const folderState = await this._getCompendiumFolderState(entries[idx].packCollection || "", nextPath, "", "");
    const pickedPath = folderState.levels.map(row => row.selectedValue).filter(Boolean);
    const terminal = pickedPath[pickedPath.length - 1] || "";

    entries[idx].folderPath = pickedPath;
    entries[idx].folderId = terminal;
    entries[idx].folderName = folderState.summary || "";

    await cfg.saver(entries);
    this.render(false);
  }

  async _onSelectionCostChange(event, type) {
    const cfg = this._selectionConfig(type);
    if (!cfg.includeCost) return;

    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const value = Math.max(0, Number(event.currentTarget?.value ?? 0) || 0);
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].cost = value;
    await cfg.saver(entries);
  }

  async _onSelectionGrantAllChange(event, type) {
    const cfg = this._selectionConfig(type);
    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const checked = !!event.currentTarget?.checked;
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].grantAllFromFolder = checked;
    await cfg.saver(entries);
  }

  async _onSelectionAllowFolderChoiceChange(event, type) {
    const cfg = this._selectionConfig(type);
    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const checked = !!event.currentTarget?.checked;
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].allowFolderChoiceInWizard = checked;
    await cfg.saver(entries);
  }

  async _onSelectionExchangeToggleChange(event, type) {
    const cfg = this._selectionConfig(type);
    if (!cfg.includeExchange) return;

    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const checked = !!event.currentTarget?.checked;
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].canExchangeForEquipmentPoints = checked;
    if (!checked) entries[idx].exchangeEquipmentPoints = 0;
    await cfg.saver(entries);
    this.render(false);
  }

  async _onSelectionExchangePointsChange(event, type) {
    const cfg = this._selectionConfig(type);
    if (!cfg.includeExchange) return;

    const selectionId = String(event.currentTarget?.dataset?.[cfg.datasetKey] || "");
    if (!selectionId) return;

    const value = Math.max(0, Number(event.currentTarget?.value ?? 0) || 0);
    const entries = cfg.getter(this.item?.system);
    const idx = entries.findIndex(entry => entry.id === selectionId);
    if (idx === -1) return;

    entries[idx].exchangeEquipmentPoints = value;
    await cfg.saver(entries);
  }

  async _onDeleteSkillClick(event) {
    event.preventDefault();

    const targetArray = event.currentTarget.dataset.array;
    const itemId = event.currentTarget.dataset.id;
    if (!targetArray || !itemId) return;

    const isPerk = targetArray === "basePerks";

    const confirmed = await Dialog.confirm({
      title: "Подтверждение удаления",
      content: `<p>Вы уверены, что хотите удалить этот ${isPerk ? "перк" : "навык"}?</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    const path = `system.${targetArray}`;
    const itemsArray = foundry.utils.getProperty(this.item, path) || [];
    const updatedArray = itemsArray.filter(item => item._id !== itemId);

    await this.item.update({ [path]: updatedArray });
    ui.notifications.info(isPerk ? "Перк успешно удален." : "Навык успешно удален.");
  }

  async _onSkillLinkClick(event) {
    event.preventDefault();
    const skillId = event.currentTarget.dataset.skillId;
    if (!skillId) return;
    await this._openLinkedItem(skillId, "Skills", "Навык");
  }

  async _onPerkLinkClick(event) {
    event.preventDefault();
    const perkId = event.currentTarget.dataset.perkId;
    if (!perkId) return;
    await this._openLinkedItem(perkId, "basePerks", "Перк");
  }

  async _openLinkedItem(sourceId, arrayKey, label) {
    const doc = game.items.get(sourceId) || this.actor?.items.get(sourceId);
    if (doc) {
      doc.sheet.render(true);
      return;
    }

    const arr = Array.isArray(this.item.system?.[arrayKey]) ? this.item.system[arrayKey] : [];
    const entry = arr.find(e => e?._id === sourceId);
    const uuid = entry?.flags?.Order?.sourceUuid;
    if (uuid) {
      try {
        const from = await fromUuid(uuid);
        if (from?.sheet) {
          from.sheet.render(true);
          return;
        }
      } catch (e) {
        // ignore
      }
    }

    ui.notifications.warn(`${label} не найден.`);
  }

  _onDragEnter(event) {
    event.preventDefault();
    event.currentTarget.classList.add("dragging");
  }

  _onDragOver(event) {
    event.preventDefault();
  }

  async _onDrop(event, targetArray) {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");

    const dt = event.originalEvent?.dataTransfer ?? event.dataTransfer;
    const raw = dt?.getData("text/plain");
    if (!raw) return;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return ui.notifications.warn("Не удалось прочитать данные перетаскивания.");
    }

    if (data.type !== "Item") return ui.notifications.warn("Можно перетаскивать только предметы.");

    const droppedItem = await Item.fromDropData(data);
    if (!droppedItem) return;

    const allowedTypes = targetArray === "Skills" ? ["Skill", "Spell"] : ["Skill"];
    if (!allowedTypes.includes(droppedItem.type)) {
      if (targetArray === "Skills") {
        return ui.notifications.warn("В этот раздел можно перетаскивать только предметы типа 'Skill' или 'Spell'.");
      }
      return ui.notifications.warn("Можно перетаскивать только предметы типа 'Skill'.");
    }

    if (targetArray === "basePerks" && !droppedItem.system?.isPerk) {
      return ui.notifications.warn("В секцию 'Перки' можно перетаскивать только навыки с флагом 'Перк'.");
    }

    const target = `system.${targetArray}`;
    const itemsArray = foundry.utils.getProperty(this.item, target) || [];

    const source = droppedItem.toObject();
    if (!source._id) source._id = foundry.utils.randomID();
    source.flags = source.flags || {};
    source.flags.Order = source.flags.Order || {};
    source.flags.Order.sourceUuid = droppedItem.uuid;

    const isDup = itemsArray.some(e => {
      const eu = e?.flags?.Order?.sourceUuid;
      return (eu && eu === droppedItem.uuid) || e?._id === source._id;
    });
    if (isDup) {
      return ui.notifications.warn("Этот предмет уже добавлен.");
    }

    itemsArray.push(source);
    await this.item.update({ [target]: itemsArray });
    ui.notifications.info(`${droppedItem.name} добавлен в класс.`);
  }
}
