import OrderItemSheet from "./OrderItemSheet.js";

export default class OrderClassSheet extends OrderItemSheet {

  get template() {
    return `systems/Order/templates/sheets/class-sheet.hbs`;
  }

  async getData() {
    const sheetData = await super.getData();
    const perkPackOptions = this._getPerkCompendiumOptions();
    const courses = this._getSpecializedCourseEntries(this.item?.system);

    const specializedCourseRows = await Promise.all(courses.map(async (course, index) => {
      const folderState = await this._getPerkCompendiumFolderState(course.packCollection || "", course.folderPath || [], course.folderId || "", course.folderName || "");
      return {
        ...course,
        __index: index + 1,
        __folderLevels: folderState.levels,
        __folderSummary: folderState.summary,
        __hasFolderChoices: folderState.levels.length > 0
      };
    }));

    sheetData.perkPackOptions = perkPackOptions;
    sheetData.specializedCourseRows = specializedCourseRows;
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

    html.find(".os-course-add").on("click", this._onAddCourse.bind(this));
    html.find(".os-course-remove").on("click", this._onRemoveCourse.bind(this));
    html.find(".os-course-pack-select").on("change", this._onCoursePackChange.bind(this));
    html.find(".os-course-folder-select").on("change", this._onCourseFolderChange.bind(this));
    html.find(".os-course-cost-input").on("change", this._onCourseCostChange.bind(this));
    html.find(".os-course-grantall").on("change", this._onCourseGrantAllChange.bind(this));
    html.find(".os-course-allow-folder-choice").on("change", this._onCourseAllowFolderChoiceChange.bind(this));
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

  _normalizeCourseEntry(course = {}) {
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

  async _saveSpecializedCourses(courses) {
    await this.item.update({
      "system.specializedFighterCourses": courses,
      "system.specializedFighterCourse": this._emptyLegacyCourse()
    });
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
      console.warn("[Order] Failed to load class course folders", err);
      return { hasRootPerks: false, byParent: new Map(), byId: new Map() };
    }
  }

  async _getPerkCompendiumFolderState(packCollection, folderPath = [], folderId = "", folderName = "") {
    const tree = await this._getPerkCompendiumFolderTree(packCollection);
    const levels = [];

    const normalizedPath = Array.isArray(folderPath)
      ? folderPath.map(v => String(v || "")).filter(Boolean)
      : (folderId ? [String(folderId)] : []);

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

  async _onAddCourse(event) {
    event.preventDefault();
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    courses.push(this._normalizeCourseEntry());
    await this._saveSpecializedCourses(courses);
    this.render(false);
  }

  async _onRemoveCourse(event) {
    event.preventDefault();
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const courses = this._getSpecializedCourseEntries(this.item?.system)
      .filter(course => course.id !== courseId);

    await this._saveSpecializedCourses(courses);
    this.render(false);
  }

  async _onCoursePackChange(event) {
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const value = String(event.currentTarget?.value || "");
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    const idx = courses.findIndex(course => course.id === courseId);
    if (idx === -1) return;

    courses[idx].packCollection = value;
    courses[idx].folderId = "";
    courses[idx].folderName = "";
    courses[idx].folderPath = [];

    await this._saveSpecializedCourses(courses);
    this.render(false);
  }

  async _onCourseFolderChange(event) {
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const level = Math.max(0, Number(event.currentTarget?.dataset?.level ?? 0) || 0);
    const value = String(event.currentTarget?.value || "");
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    const idx = courses.findIndex(course => course.id === courseId);
    if (idx === -1) return;

    const nextPath = Array.isArray(courses[idx].folderPath)
      ? [...courses[idx].folderPath]
      : (courses[idx].folderId ? [courses[idx].folderId] : []);

    nextPath.length = level;
    if (value) nextPath.push(value);

    const folderState = await this._getPerkCompendiumFolderState(courses[idx].packCollection || "", nextPath, "", "");
    const pickedPath = folderState.levels.map(row => row.selectedValue).filter(Boolean);
    const terminal = pickedPath[pickedPath.length - 1] || "";

    courses[idx].folderPath = pickedPath;
    courses[idx].folderId = terminal;
    courses[idx].folderName = folderState.summary || "";

    await this._saveSpecializedCourses(courses);
    this.render(false);
  }

  async _onCourseCostChange(event) {
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const value = Math.max(0, Number(event.currentTarget?.value ?? 0) || 0);
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    const idx = courses.findIndex(course => course.id === courseId);
    if (idx === -1) return;

    courses[idx].cost = value;
    await this._saveSpecializedCourses(courses);
  }

  async _onCourseGrantAllChange(event) {
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const checked = !!event.currentTarget?.checked;
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    const idx = courses.findIndex(course => course.id === courseId);
    if (idx === -1) return;

    courses[idx].grantAllFromFolder = checked;
    await this._saveSpecializedCourses(courses);
  }

  async _onCourseAllowFolderChoiceChange(event) {
    const courseId = String(event.currentTarget?.dataset?.courseId || "");
    if (!courseId) return;

    const checked = !!event.currentTarget?.checked;
    const courses = this._getSpecializedCourseEntries(this.item?.system);
    const idx = courses.findIndex(course => course.id === courseId);
    if (idx === -1) return;

    courses[idx].allowFolderChoiceInWizard = checked;
    await this._saveSpecializedCourses(courses);
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

    if (droppedItem.type !== "Skill") {
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
