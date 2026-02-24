import { applyComputedDamageToItem, applyComputedRangeToItem } from "../../scripts/OrderDamageFormula.js";
import { startConsumableUse } from "../../scripts/OrderConsumable.js";

Handlebars.registerHelper('isSelected', function (value, selectedValue) {
  return value === selectedValue ? 'selected' : '';
});

const MASS_ATTACK_TAG_KEY = "массовая атака";
const L_SWING_TAG_KEY = "г-образный взмах";
const L_SWING_AOE_SHAPE = "l-swing";
const MASS_SAVE_CHECK_DELIVERY = "mass-save-check";


function parseDeliveryPipelineCsv(raw) {
  return String(raw ?? "")
    .split(",")
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasDeliveryStep(item, step) {
  const primary = String(item?.system?.DeliveryType || "").trim().toLowerCase();
  if (primary === step) return true;
  const extra = parseDeliveryPipelineCsv(item?.system?.DeliveryPipeline || "");
  if (step === "save-check" || step === "aoe-template") {
    if (primary === MASS_SAVE_CHECK_DELIVERY) return true;
    if (extra.includes(MASS_SAVE_CHECK_DELIVERY)) return true;
  }
  return extra.includes(step);
}


function getSpellPipelineTypeCatalog() {
  return [
    { value: "defensive-reaction", label: "Защитное (реакция)" },
    { value: "attack-ranged", label: "Взаимодействие заклинанием (дальнее)" },
    { value: "attack-melee", label: "Взаимодействие заклинанием (ближнее)" },
    { value: "aoe-template", label: "Область (шаблон)" },
    { value: MASS_SAVE_CHECK_DELIVERY, label: "Массовая проверка" },
    { value: "save-check", label: "Проверка цели" }
  ];
}

function getAllowedSecondarySpellTypes(primaryDelivery) {
  const primary = String(primaryDelivery || "utility").trim().toLowerCase();
  if (primary === "utility" || primary === "summon") return [];

  const all = getSpellPipelineTypeCatalog().map((v) => v.value);
  const forbidden = new Set([primary, "defensive-reaction"]);
  if (primary === "attack-ranged") forbidden.add("attack-melee");
  if (primary === "attack-melee") forbidden.add("attack-ranged");

  return all.filter((value) => !forbidden.has(value));
}

function getSkillPipelineTypeCatalog() {
  return [
    { value: "defensive-reaction", label: "\u0417\u0430\u0449\u0438\u0442\u043d\u043e\u0435 (\u0440\u0435\u0430\u043a\u0446\u0438\u044f)" },
    { value: "attack-ranged", label: "\u0412\u0437\u0430\u0438\u043c\u043e\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0430\u0432\u044b\u043a\u043e\u043c (\u0434\u0430\u043b\u044c\u043d\u0435\u0435)" },
    { value: "attack-melee", label: "\u0412\u0437\u0430\u0438\u043c\u043e\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0430\u0432\u044b\u043a\u043e\u043c (\u0431\u043b\u0438\u0436\u043d\u0435\u0435)" },
    { value: "aoe-template", label: "\u041e\u0431\u043b\u0430\u0441\u0442\u044c (\u0448\u0430\u0431\u043b\u043e\u043d)" },
    { value: MASS_SAVE_CHECK_DELIVERY, label: "Массовая проверка" },
    { value: "save-check", label: "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0446\u0435\u043b\u0438" }
  ];
}

function getAllowedSecondarySkillTypes(primaryDelivery) {
  const primary = String(primaryDelivery || "utility").trim().toLowerCase();
  if (primary === "utility") return [];

  const all = getSkillPipelineTypeCatalog().map((v) => v.value);
  const forbidden = new Set([primary, "defensive-reaction"]);
  if (primary === "attack-ranged") forbidden.add("attack-melee");
  if (primary === "attack-melee") forbidden.add("attack-ranged");

  return all.filter((value) => !forbidden.has(value));
}
function normalizeOrderTagKey(raw) {
  const fn = game?.OrderTags?.normalize;
  if (typeof fn === "function") return fn(raw);

  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasSystemTag(systemData, tagKey) {
  const tags = Array.isArray(systemData?.tags) ? systemData.tags : [];
  const wanted = normalizeOrderTagKey(tagKey);
  if (!wanted) return false;
  return tags.some((tag) => normalizeOrderTagKey(tag) === wanted);
}

function normalizeConsumableType(raw) {
  return String(raw ?? "")
    .normalize("NFKD")
    .trim()
    .toLowerCase();
}

function isAmmoConsumableType(raw) {
  const normalized = normalizeConsumableType(raw);
  return normalized === "ammo" || normalized.includes("\u043f\u0430\u0442\u0440\u043e\u043d");
}

function isGrenadeConsumableType(raw) {
  const normalized = normalizeConsumableType(raw);
  return normalized === "grenade" || normalized.includes("\u0433\u0440\u0430\u043d\u0430\u0442");
}

function normalizeAdditionalFields(rawFields) {
  const asArray = Array.isArray(rawFields)
    ? rawFields
    : (rawFields && typeof rawFields === "object")
      ? Object.keys(rawFields)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => rawFields[k])
      : [];

  return asArray.map((entry, index) => {
    const field = (entry && typeof entry === "object") ? entry : {};
    const fallbackName = `Поле ${index + 1}`;
    const normalizedName = String(field.name ?? "").trim() || fallbackName;

    return {
      ...field,
      name: normalizedName,
      value: field.value ?? "",
      hidden: !!field.hidden,
      show: !!field.show
    };
  });
}

const DEFAULT_FIELD_LABELS = {
  // Shared
  Circle: "Круг",
  Level: "Уровень",
  Description: "Описание",
  Effects: "Эффекты",
  Duration: "Длительность",

  // Skill
  SkillType: "Тип навыка",
  Damage: "Урон / лечение",
  DamageFormula: "Формула урона",
  RangeFormula: "Формула дальности",
  RollFormulas: "Формулы броска",
  Multiplier: "Множитель",
  UsageCost: "Стоимость применения",
  ActionCost: "Стоимость действий",
  Cooldown: "Перезарядка",
  DeliveryType: "Тип применения",
  DeliveryPipeline: "Доп. типы применения",
  SaveAbility: "Проверка цели (характеристика)",
  SaveDCFormula: "Сложность проверки (КС)",
  AreaShape: "Форма области",
  AreaSize: "Размер области",
  AreaWidth: "Ширина области",
  AreaAngle: "Угол области",
  AreaPersistent: "Постоянная область",
  AreaColor: "Цвет области",

  // Spell
  Range: "Дистанция",
  UsageThreshold: "Порог условия",
  SpellType: "Тип заклинания",
  TriggerType: "Триггер",
  EnemyInteractionType: "Взаимодействие с целью",
  DamageType: "Тип урона",
  DamageSubtype: "Подтип урона",
  EffectConditions: "Условие срабатывания эффекта",
  UsageConditions: "Условия применения",
  SummonActorUuid: "Сущность (UUID)",
  SummonCount: "Количество",
  SummonDisposition: "Отношение",
  SummonDeleteOnExpiry: "Удалять по окончании",

  // Other
  EffectThreshold: "Порог срабатывания эффекта",
};

export default class OrderItemSheet extends ItemSheet {

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "item"],
      width: 980,
      height: 740,
      resizable: true,
      // One predictable scroll container for the new layouts
      scrollY: [".os-item-body"]
    });
  }


  constructor(...args) {
    super(...args);
    /** @private */
    this._osEditMode = false;
    /** @private */
    this._osEditWarnTs = 0;
  }

  /**
   * Skill + Spell item sheets can be "locked" until the user explicitly toggles Edit.
   */
  _osIsLockableItemSheet() {
    const t = this.item?.type;
    // These item sheets should be view-only until the user explicitly toggles Edit.
    return [
      "Skill",
      "Spell",
      "meleeweapon",
      "rangeweapon",
      "Consumables",
      "Race",
      "Class",
      "RegularItem"
    ].includes(t);
  }

  _osCanEditItemSheet() {
    // Non-lockable items follow Foundry's normal permission rules.
    if (!this._osIsLockableItemSheet()) return !!this.isEditable;
    return !!(this.isEditable && this.item?.isOwner && this._osEditMode);
  }

  _osWarnItemEditLocked() {
    const now = Date.now();
    if (now - (this._osEditWarnTs || 0) < 900) return;
    this._osEditWarnTs = now;
    ui?.notifications?.warn?.("Редактирование заблокировано. Нажмите Edit (карандаш) в заголовке листа.");
  }
  _osApplyItemEditLock(html) {
    if (!this._osIsLockableItemSheet() || this._osCanEditItemSheet()) return;

    // Lock name editing and image editing
    html.find('[data-edit="img"]').removeAttr('data-edit');

    // Inputs: readonly for text-like; disabled for interactive controls.
    html.find('input, textarea, select, button').each((_, el) => {
      const $el = $(el);

      // Allow certain "use" actions even when locked
      if (
        $el.hasClass('train-item-sheet') ||
        $el.hasClass('roll-consumable-use') ||
        $el.hasClass('reload-rangeweapon') ||
        // Weapons: "В руке" checkbox must be clickable without Edit
        $el.hasClass('in-hand-checkbox')
      ) return;

      const tag = (el.tagName || "").toLowerCase();
      if (tag === "button") {
        el.disabled = true;
        return;
      }

      if (tag === "select") {
        el.disabled = true;
        // Prevent tab focus when locked
        el.tabIndex = -1;
        return;
      }

      if (tag === "textarea") {
        el.readOnly = true;
        // Prevent tab focus when locked
        el.tabIndex = -1;
        return;
      }

      if (tag === "input") {
        const type = String(el.getAttribute("type") || "text").toLowerCase();
        if (type === "hidden") return;
        if (type === "checkbox" || type === "radio" || type === "color" || type === "range" || type === "file") {
          el.disabled = true;
          // Prevent tab focus when locked
          el.tabIndex = -1;
        } else {
          el.readOnly = true;
          // Prevent tab focus when locked
          el.tabIndex = -1;
        }
      }
    });
  }



  /**
   * Hook into header buttons to add an Edit toggle for Skill/Spell item sheets.
   */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons ? super._getHeaderButtons() : super.getHeaderButtons();

    try {
      if (this._osIsLockableItemSheet() && this.item?.isOwner) {
        const editButton = {
          label: "Edit",
          // NOTE: Foundry expects a SINGLE class token here.
          class: "os-edit-toggle",
          icon: this._osEditMode
            ? "fa-solid fa-pen-to-square fas fa-pen-to-square"
            : "fa-solid fa-pen fas fa-pen",
          onclick: (ev) => {
            ev?.preventDefault?.();
            this._osEditMode = !this._osEditMode;
            this.render(false);
          }
        };

        const cfgIndex = buttons.findIndex((b) => String(b.class || "").includes("configure-sheet"));
        if (cfgIndex >= 0) buttons.splice(cfgIndex, 0, editButton);
        else buttons.unshift(editButton);
      }
    } catch (err) {
      console.error("[Order] Could not add Edit header button (item)", err);
    }

    // Hide Delete header button while Edit mode is OFF (Skill/Spell).
    if (this._osIsLockableItemSheet() && this.item?.isOwner && !this._osEditMode) {
      for (let i = buttons.length - 1; i >= 0; i--) {
        const cls = String(buttons[i]?.class || "");
        if (cls.includes("delete")) buttons.splice(i, 1);
      }
    }

    return buttons;
  }

  /**
   * Restore last used sheet size (per item type) while keeping requested default.
   */
  render(force, options = {}) {
    try {
      const all = game.user?.getFlag("Order", "itemSheetSize");
      const key = String(this.item?.type || "");
      const saved = all?.[key];
      if (saved && Number(saved.width) > 200 && Number(saved.height) > 200) {
        options = mergeObject(options, {
          width: Number(saved.width),
          height: Number(saved.height)
        }, { inplace: false });
      }
    } catch (e) {
      // ignore
    }
    return super.render(force, options);
  }

  /**
   * Persist size when user resizes the sheet.
   */
  setPosition(position = {}) {
    const pos = super.setPosition(position);
    if (position.width || position.height) {
      this._debouncedSaveItemSheetSize();
    }
    return pos;
  }

  _debouncedSaveItemSheetSize() {
    clearTimeout(this._saveItemSheetSizeTimeout);
    this._saveItemSheetSizeTimeout = setTimeout(() => {
      this._saveItemSheetSize();
    }, 250);
  }

  async _saveItemSheetSize() {
    try {
      if (!game.user) return;
      const width = Math.round(Number(this.position?.width) || 0);
      const height = Math.round(Number(this.position?.height) || 0);
      if (width < 200 || height < 200) return;

      const key = String(this.item?.type || "");
      const all = (game.user.getFlag("Order", "itemSheetSize") || {});
      all[key] = { width, height };
      await game.user.setFlag("Order", "itemSheetSize", all);
    } catch (e) {
      // ignore
    }
  }

  async close(options = {}) {
    await this._saveItemSheetSize();
    return super.close(options);
  }


  get template() {
    return `systems/Order/templates/sheets/${this.item.type}-sheet.hbs`; // 'data' больше не используется
  }

  getData() {
    const baseData = super.getData();

    const attackCharacteristics = baseData.item.system.AttackCharacteristics || [];

    baseData.item.system.additionalFields = normalizeAdditionalFields(baseData.item.system.additionalFields);
    baseData.item.system.displayFields = baseData.item.system.displayFields || {};
    baseData.item.system.hiddenDefaults = baseData.item.system.hiddenDefaults || {};
    // Progress/learning defaults (skills + spells)
    if (baseData.item.system.filledSegments === undefined || baseData.item.system.filledSegments === null) {
      baseData.item.system.filledSegments = 0;
    }
    if (baseData.item.system.perkTrainingPoints === undefined || baseData.item.system.perkTrainingPoints === null) {
      baseData.item.system.perkTrainingPoints = 0;
    }
    baseData.item.system.isPerk = !!baseData.item.system.isPerk;
    baseData.item.system.RollFormulas = this._getRollFormulasArray();
    if (!baseData.item.system.displayFields.RollFormulas && baseData.item.system.displayFields.RollFormula) {
      baseData.item.system.displayFields.RollFormulas = true;
    }
    // By design, perks have a dice icon by default unless explicitly disabled.
    if (baseData.item.system.perkCanRoll === undefined || baseData.item.system.perkCanRoll === null) {
      baseData.item.system.perkCanRoll = true;
    }
    baseData.item.system.perkBonuses = Array.isArray(baseData.item.system.perkBonuses) ? baseData.item.system.perkBonuses : [];
    if (!baseData.item.system.DamageMode) baseData.item.system.DamageMode = "damage";
    if (baseData.item.system.EffectThreshold === undefined || baseData.item.system.EffectThreshold === null) {
      baseData.item.system.EffectThreshold = 0;
    }

    // Keep derived formula fields synchronized in the sheet.
    if (["Skill", "Spell", "meleeweapon", "rangeweapon", "weapon", "Consumables"].includes(this.item.type)) {
      applyComputedDamageToItem({
        item: baseData.item,
        actor: this.item?.actor ?? this.item?.parent ?? null
      });
    }
    if (["Skill", "Spell"].includes(this.item.type)) {
      applyComputedRangeToItem({
        item: baseData.item,
        actor: this.item?.actor ?? this.item?.parent ?? null
      });
    }

    // Преобразуем объекты в строки
    baseData.item.system.AttackCharacteristics = attackCharacteristics.map((char) =>
      typeof char === "string" ? char : char.Characteristic || char.toString()
    );

    const selectedCharacteristic =
      this.item.system._selectedAttackCharacteristic || "";

    let sheetData = {
      owner: this.item.isOwner,
      editable: this.isEditable,
      osCanEdit: this._osCanEditItemSheet(),
      osIsEditLocked: this._osIsLockableItemSheet() && !this._osCanEditItemSheet(),
      item: baseData.item,
      data: baseData.item.system, // Используем 'system' вместо 'data'
      config: CONFIG.Order,
      userColor: game.user?.color || "#ffffff",
      characteristics: [
        "Strength",
        "Dexterity",
        "Stamina",
        "Accuracy",
        "Will",
        "Knowledge",
        "Charisma",
        "Seduction",
        "Leadership",
        "Faith",
        "Medicine",
        "Magic",
        "Stealth",
      ],
      advantages: this.additionalAdvantages,
      selectedCharacteristic, // Передаём временный выбор для отображения
      // Spell-specific selectors (stage 1.5)
      enemyInteractionTypes: [
        { value: "none", label: "—" },
        { value: "guaranteed", label: "Гарантированное" },
        { value: "contested", label: "Оспариваемое" }
      ],
      spellDeliveryTypes: [
        { value: "utility", label: "Утилити / без цели" },
        { value: "attack-ranged", label: "Взаимодействие заклинанием (дальнее)" },
        { value: "attack-melee", label: "Взаимодействие заклинанием (ближнее)" },
        { value: MASS_SAVE_CHECK_DELIVERY, label: "Массовая проверка" },
        { value: "save-check", label: "Проверка цели" },
        { value: "aoe-template", label: "Область (шаблон)" },
        { value: "defensive-reaction", label: "Защитное (реакция)" },
        { value: "summon", label: "Призыв" },
      ],
      spellPipelineTypes: [
        { value: "defensive-reaction", label: "Защитное (реакция)" },
        { value: "attack-ranged", label: "Взаимодействие заклинанием (дальнее)" },
        { value: "attack-melee", label: "Взаимодействие заклинанием (ближнее)" },
        { value: "aoe-template", label: "Область (шаблон)" },
        { value: "save-check", label: "Проверка цели" }
      ],
      spellPipelineTypes: getSpellPipelineTypeCatalog(),
      areaShapeTypes: [
        { value: "circle", label: "Круг" },
        { value: "cone", label: "Конус" },
        { value: "ray", label: "Линия" },
        { value: "rect", label: "Прямоугольник" },
        { value: "wall", label: "Стена" }
      ],
      weaponAoeShapeTypes: [
        { value: "circle", label: "Круг" },
        { value: "cone", label: "Конус" },
        { value: "ray", label: "Линия" }
      ],
      // Spell delivery "aoe-template": no wall/rect, ray is shown as rectangle.
      spellAoeTemplateShapeTypes: [
        { value: "circle", label: "Круг" },
        { value: "cone", label: "Конус" },
        { value: "ray", label: "Прямоугольник" }
      ],
      // Legacy support: keep full set for already saved spells with "create-object".
      spellCreateObjectShapeTypes: [
        { value: "circle", label: "Круг" },
        { value: "cone", label: "Конус" },
        { value: "ray", label: "Линия" },
        { value: "rect", label: "Прямоугольник" },
        { value: "wall", label: "Стена" }
      ],
      skillDeliveryTypes: [
        { value: "utility", label: "Утилити / без цели" },
        { value: "attack-ranged", label: "Взаимодействие навыком (дальнее)" },
        { value: "attack-melee", label: "Взаимодействие навыком (ближнее)" },
        { value: MASS_SAVE_CHECK_DELIVERY, label: "Массовая проверка" },
        { value: "save-check", label: "Проверка цели" },
        { value: "aoe-template", label: "Область (шаблон)" },
        { value: "defensive-reaction", label: "Защитный (реакция)" }
      ],
      skillPipelineTypes: getSkillPipelineTypeCatalog(),
      skillAoeTemplateShapeTypes: [
        { value: "circle", label: "\u041a\u0440\u0443\u0433" },
        { value: "cone", label: "\u041a\u043e\u043d\u0443\u0441" },
        { value: "ray", label: "\u041f\u0440\u044f\u043c\u043e\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a" }
      ],
    }

    const itemType = String(this.item?.type || "");
    const primaryDelivery = String(sheetData?.data?.DeliveryType || "utility").trim().toLowerCase();
    const pipelineRaw = parseDeliveryPipelineCsv(sheetData?.data?.DeliveryPipeline || "");
    const pipelineSecond = pipelineRaw[0] || "";
    if (itemType === "Spell") {
      const allowedSpellSecondary = new Set(getAllowedSecondarySpellTypes(primaryDelivery));
      sheetData.spellPipelineTypes = [
        { value: "", label: "-" },
        ...getSpellPipelineTypeCatalog().filter((opt) => allowedSpellSecondary.has(opt.value))
      ];
      sheetData.data.DeliveryPipeline = (pipelineSecond && allowedSpellSecondary.has(pipelineSecond))
        ? pipelineSecond
        : "";
    }

    if (itemType === "Skill") {
      const allowedSkillSecondary = new Set(getAllowedSecondarySkillTypes(primaryDelivery));
      sheetData.skillPipelineTypes = [
        { value: "", label: "-" },
        ...getSkillPipelineTypeCatalog().filter((opt) => allowedSkillSecondary.has(opt.value))
      ];
      sheetData.data.DeliveryPipeline = (pipelineSecond && allowedSkillSecondary.has(pipelineSecond))
        ? pipelineSecond
        : "";
    }

    const rawWeaponShape = String(sheetData?.data?.AoEShape || "").trim().toLowerCase();
    if (rawWeaponShape === "rect") {
      // Legacy cleanup: weapon AoE rectangles are no longer supported.
      sheetData.data.AoEShape = "ray";
    }

    sheetData.hasMassAttackTag = hasSystemTag(sheetData.data, MASS_ATTACK_TAG_KEY);
    sheetData.hasLSwingTag = hasSystemTag(sheetData.data, L_SWING_TAG_KEY);
    if (sheetData.hasLSwingTag) {
      sheetData.weaponAoeShapeTypes.push({ value: L_SWING_AOE_SHAPE, label: "Г-образный (3 клетки)" });
    } else if (String(sheetData?.data?.AoEShape || "").trim().toLowerCase() === L_SWING_AOE_SHAPE) {
      // Safety for old/stale data when the tag is removed.
      sheetData.data.AoEShape = "circle";
    }

    const tagDefs = game?.OrderTags?.getAll?.() ?? {};
    sheetData.weaponTagOptions = Object.entries(tagDefs)
      .map(([key, def]) => ({
        key,
        label: String(def?.label ?? key)
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));

    // ------------------------------
    // Perk bonus targets (Skill items marked as perks)
    // ------------------------------
    const perkBonusTargets = [];
    const chars = CONFIG?.Order?.Caracteristics || {};
    for (const [key, locKey] of Object.entries(chars)) {
      const labelBase = game.i18n?.localize?.(locKey) ?? key;
      perkBonusTargets.push({ value: `${key}Value`, label: `${labelBase} (характеристика)` });
      perkBonusTargets.push({ value: key, label: `${labelBase} (модификатор)` });
    }

    perkBonusTargets.push(
      { value: "HealthMax", label: "Макс. здоровье" },
      { value: "ManaFatigueMax", label: "Макс. маг. усталость" },
      { value: "StressMax", label: "Макс. стресс" },
      { value: "Movement", label: "Скорость" },
      { value: "Armor", label: "Броня" },
      { value: "WeaponDamage", label: "Урон от снаряжения" },
      { value: "SkillDamage", label: "Урон от навыков" },
      { value: "SpellDamage", label: "Урон от заклинаний" }
    );

    sheetData.perkBonusTargets = perkBonusTargets;
    ;

    // Debuffs: options for weapon "OnHitEffects" editor.
    // Loaded once on "ready" (see Order.js). If not available yet, keep an empty list.
    sheetData.debuffOptions = Array.isArray(game?.OrderDebuffOptions) ? game.OrderDebuffOptions : [];

    // Normalize weapon OnHitEffects to object-form expected by combat logic:
    //   [{ debuffKey: "Bleeding", stateKey: "1" }, ...]
    // Some items can be corrupted by core submit (numeric-key object instead of array).
    if (this.item.type === "meleeweapon" || this.item.type === "rangeweapon") {
      sheetData.data.OnHitEffects = this._getWeaponOnHitEffectsArray(sheetData?.data?.OnHitEffects);
    }

    // Spell: options for summon UI (world Actors list)
    if (this.item.type === "Spell") {
      const actors = (game?.actors?.contents ?? [])
        .map(a => ({ uuid: `Actor.${a.id}`, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
      sheetData.summonActorOptions = actors;

      // For AoE spells, legacy unsupported shapes are shown as ray ("Прямоугольник").
      const delivery = String(sheetData?.data?.DeliveryType || "").trim().toLowerCase();
      const areaShape = String(sheetData?.data?.AreaShape || "").trim().toLowerCase();
      if ((delivery === "aoe-template" || delivery === MASS_SAVE_CHECK_DELIVERY) && (areaShape === "rect" || areaShape === "wall")) {
        sheetData.data.AreaShape = "ray";
      }

      // Effects editor: normalize to array for Handlebars (handles legacy string storage)
      const effectsArr = this._getSpellEffectsArray();
      sheetData.spellEffects = effectsArr.length ? effectsArr : null;
    }

    if (this.item.type === "Skill") {
      // For AoE skills, legacy unsupported shapes are shown as ray ("Прямоугольник").
      const delivery = String(sheetData?.data?.DeliveryType || "").trim().toLowerCase();
      const areaShape = String(sheetData?.data?.AreaShape || "").trim().toLowerCase();
      if ((delivery === "aoe-template" || delivery === MASS_SAVE_CHECK_DELIVERY) && (areaShape === "rect" || areaShape === "wall")) {
        sheetData.data.AreaShape = "ray";
      }

      // Effects editor: normalize to array for Handlebars (handles legacy string storage)
      const effectsArr = this._getSpellEffectsArray();
      sheetData.skillEffects = effectsArr.length ? effectsArr : null;
    }


    if (this._supportsItemModifications()) {
      const modifications = this._getItemModificationsForSheet();
      const slots = Math.max(0, Number(sheetData?.data?.Modificationslots ?? 0) || 0);
      const count = modifications.length;
      sheetData.modifications = modifications;
      sheetData.modificationSlots = slots;
      sheetData.modificationCount = count;
      sheetData.modificationHasOverflow = count > slots;
      sheetData.modificationOverflow = Math.max(0, count - slots);
    }

    console.log("Data in getData():", baseData);
    console.log("Data after adding config:", sheetData);

    return sheetData;
  }


  activateListeners(html) {
    // NOTE: We intentionally attach our custom listeners BEFORE the base ItemSheet listeners.
    // The core sheet change handler may coerce numeric inputs (data-dtype="Number") which
    // breaks our "hide-by-dash" sentinel ("-") for numeric fields. By binding first we can
    // intercept the dash and stop propagation, keeping the old behavior intact.

    // Keep the header Edit button visually in sync with the current edit state.
    // (Do NOT add extra classes via header button config; Foundry uses the config class as a lookup key.)
    try {
      const headerBtn = this.element?.find?.('.window-header a.os-edit-toggle');
      if (headerBtn?.length) headerBtn.toggleClass('active', !!this._osEditMode);
    } catch (e) { /* ignore */ }

    // Слушатели для кругов навыков и заклинаний
    this._activateSkillListeners(html);

    const osLockable = this._osIsLockableItemSheet();
    const osCanEdit = this._osCanEditItemSheet();
    const osBindEdit = !osLockable || osCanEdit;

    if (this.item.type === "Consumables") {
      this._initializeConsumableTypeControls(html);
      const useButton = html.find(".roll-consumable-use");
      useButton.off("click.orderConsumableUse");
      useButton.on("click.orderConsumableUse", this._onUseConsumableFromSheet.bind(this));
    }

    // Training button inside Skill/Spell sheet (allowed even when Edit is OFF)
    html.find('.train-item-sheet').on('click', this._onTrainItemFromSheet.bind(this));

    if (osBindEdit) {
      html.find('.add-field').click(this._onAddField.bind(this));

      // Perk bonuses (Skill items marked as perks)
      html.find('.perk-bonus-add').click(this._onPerkBonusAdd.bind(this));
      html.find('.perk-bonus-remove').click(this._onPerkBonusRemove.bind(this));
      html.find('.perk-bonus-target').on('change', this._onPerkBonusChange.bind(this));
      html.find('.perk-bonus-value').on('change', this._onPerkBonusChange.bind(this));
      html.find('.additional-field-value').on('change', this._onAdditionalFieldChange.bind(this));

      // Roll formulas (Skill/Spell)
      html.find('.roll-formula-add').click(this._onRollFormulaAdd.bind(this));
      html.find('.roll-formula-remove').click(this._onRollFormulaRemove.bind(this));
      html.find('.roll-formula-value').on('change', this._onRollFormulaChange.bind(this));

      // Default-field hide-by-dash: for Skill/Spell we listen on ALL system fields (not only in the table).
      const fieldChangeSelector = (this.item.type === "Skill" || this.item.type === "Spell")
        ? 'input[name^="data."], select[name^="data."], textarea[name^="data."]'
        : '.fields-table input:not(.additional-field-value), .fields-table select, .fields-table textarea';

      html.find(fieldChangeSelector)
        .not('.additional-field-value')
        .not('.perk-bonus-target')
        .not('.perk-bonus-value')
        .not('.roll-formula-value')
        .not('.attack-select')
        .not('.skill-delivery-select')
        .not('.spell-delivery-select')
        .not('.summon-actor-pick')
        .on('change', this._onFieldChange.bind(this));
    }

    html.find('.field-label').on('click', this._onFieldLabelClick.bind(this));

    html.find('.in-hand-checkbox').change(this._onInHandChange.bind(this));
    html.find(".tag-add").on("click", (ev) => this._onAddWeaponTag(ev, html));
    html.find(".tag-add-select").on("click", (ev) => this._onAddWeaponTagFromSelect(ev, html));
    html.find(".tag-remove").on("click", (ev) => this._onRemoveWeaponTag(ev));

    // Слушатель для изменения dropdown
    html.find(".attack-select").change(async (ev) => {
      const selectedCharacteristic = $(ev.currentTarget).val();

      console.log("Selected characteristic:", selectedCharacteristic);

      // Немедленно обновляем значение в данных объекта
      await this.item.update({ "system._selectedAttackCharacteristic": selectedCharacteristic });

      console.log("Updated temporary selected characteristic:", selectedCharacteristic);
    });

    // Логика добавления характеристики
    html.find(".add-attack-characteristic").click(async (ev) => {
      const currentArray = this.item.system.AttackCharacteristics || [];
      const selectedCharacteristic = this.item.system._selectedAttackCharacteristic;

      if (!selectedCharacteristic) {
        ui.notifications.warn("Выберите характеристику перед добавлением.");
        return;
      }

      // Проверка на дубликаты
      if (!currentArray.includes(selectedCharacteristic)) {
        currentArray.push(selectedCharacteristic);

        // Обновляем список характеристик
        await this.item.update({ "system.AttackCharacteristics": currentArray });
      } else {
        ui.notifications.warn("Эта характеристика уже добавлена.");
      }

      // Перерендериваем интерфейс
      this.render(true);
    });
    // html.find(".remove-attack-characteristic").click(async ev => {
    //   const index = $(ev.currentTarget).closest(".attack-char").data("index");
    //   const currentArray = this.item.system.AttackCharacteristics || [];
    //   currentArray.splice(index, 1);
    //   await this.item.update({ "system.AttackCharacteristics": currentArray });
    //
    //   // Принудительное обновление интерфейса
    //   this.render(true);
    // });

    // Обработчик изменения уровня вручную
    html.find('input[name="data.Level"]').on('change', async event => {
      // allow hide-by-dash sentinel for numeric Level
      const raw = String(event?.currentTarget?.value ?? "").trim();
      if (raw === '-' || raw === '—' || raw === '–' || raw === '−') return;

      const input = event.currentTarget;
      const newLevel = parseInt(input.value, 10) || 0;
      const circleRaw = parseInt(this.object.system.Circle, 10);
      const circle = Number.isNaN(circleRaw) ? 1 : circleRaw;

      // Сбрасываем текущие заполненные сегменты
      await this.object.update({
        "system.Level": newLevel,
        "system.filledSegments": 0
      });

      // Перерисовываем круг
      const canvas = html.find('.circle-progress-skill')[0];
      if (canvas) {
        const totalSegments = this._calculateSkillSegments(newLevel, circle);
        const isMaxLevel = newLevel >= this._getMaxLevelForCircle(circle);
        canvas.title = isMaxLevel ? "Максимальный уровень" : `0 / ${totalSegments}`;
        this._drawCircle(canvas, 0, totalSegments, isMaxLevel);
      }
    });


    html.find(".requires-add-characteristic").click(ev => {
      const char = html.find(".requires-select").val();
      const currentArray = this.item.system.RequiresArray || [];
      currentArray.push({ Characteristic: char });
      this.item.update({ "system.RequiresArray": currentArray });
    });

    // Слушатели для других элементов
    html.find('.weapon-type').change(this._onWeaponTypeChange.bind(this));
    html.find('.advantage-modifier-minus').click(this._onModifierChange.bind(this, -1));
    html.find('.advantage-modifier-plus').click(this._onModifierChange.bind(this, 1));
    html.find('.advantage-add-characteristic').click(this._onAddAdvantage.bind(this));
    html.find('.advantage-remove-characteristic').click(this._onRemoveAdvantage.bind(this));
    html.find(".remove-attack-characteristic").click(this._onRemoveAttackCharacteristic.bind(this));
    html.find('.is-equiped-checkbox').change(this._onEquipChange.bind(this));
    html.find('.is-used-checkbox').change(this._onUsedChange.bind(this));
    html.find('.requires-modifier-minus').click(this._onModifierChange.bind(this, -1));
    html.find('.requires-modifier-plus').click(this._onModifierChange.bind(this, 1));
    html.find('.requires-add-characteristic').click(this._onAddRequire.bind(this));
    html.find('.requires-remove-characteristic').click(this._onRemoveRequire.bind(this));
    html.find('.modify-advantage-button').click(() => this._addingParameters());
    html.find('.modify-require-button').click(() => this._addingRequires());
    html.find(".open-attack-dialog").click(() => this._showAttackDialog());
    html.find(".add-weapon-effect").click(() => this._addWeaponOnHitEffect());
    html.find(".remove-weapon-effect").click(this._removeWeaponOnHitEffect.bind(this));
    html.find(".modification-open").off("click.orderMods").on("click.orderMods", this._onOpenModification.bind(this));
    html.find(".modification-remove").off("click.orderMods").on("click.orderMods", this._onRemoveModification.bind(this));

    if (this._supportsItemModifications()) {
      const dropArea = html.find(".modifications-drop-area");
      dropArea
        .off("dragenter.orderMods dragover.orderMods dragleave.orderMods drop.orderMods")
        .on("dragenter.orderMods", this._onModificationDragEnter.bind(this))
        .on("dragover.orderMods", this._onModificationDragOver.bind(this))
        .on("dragleave.orderMods", this._onModificationDragLeave.bind(this))
        .on("drop.orderMods", this._onModificationDrop.bind(this));
    }

    if (this.item.type === "meleeweapon" || this.item.type === "rangeweapon") {
      html.find(".weapon-effect-row select")
        .off("change.orderOnHit")
        .on("change.orderOnHit", this._onWeaponOnHitEffectSelectChange.bind(this));
    }
    if (this.item.type === "rangeweapon") {
      html.find(".reload-rangeweapon").click(this._onReloadRangeWeapon.bind(this));
    }


    if (this.item.type === "rangeweapon") {
      html.find(".add-accurate-effect").click(() => this._addAccurateHitEffectText());
      html.find(".remove-accurate-effect").click(this._removeAccurateHitEffectText.bind(this));
    }

    // Ограничение множителя в зависимости от круга
    const multiplierInput = html.find('input[name="data.Multiplier"]');
    if (multiplierInput.length) {
      const circleInput = html.find('input[name="data.Circle"]');
      const enforceMultiplierLimit = async () => {
        const circle = this._parseCircleValue(circleInput);
        const maxMultiplier = this._getMaxLevelForCircle(circle);
        const currentMultiplier = parseFloat(multiplierInput.val());

        if (maxMultiplier > 0 && currentMultiplier > maxMultiplier) {
          multiplierInput.val(maxMultiplier);
          await this.item.update({ "system.Multiplier": maxMultiplier });
          ui.notifications.warn(`Максимально допустимое значение множителя для круга ${circle} — ${maxMultiplier}.`);
        }
      };

      multiplierInput.on('change', enforceMultiplierLimit);

      if (circleInput.length) {
        circleInput.on('change', enforceMultiplierLimit);
      }
    }

    if (this.item.type === "Skill") {

      // DeliveryType controls
      this._toggleSkillDeliveryFields(html);
      html.find('.skill-delivery-select')
        .off('change')
        .on('change', this._onSkillDeliveryTypeChange.bind(this, html));
      html.find('.skill-delivery-pipeline')
        .off('change')
        .on('change', this._onSkillDeliveryPipelineChange.bind(this, html));

      // Area color picker/presets for skill AoE
      html.find(".skill-area-color-input").off("change").on("change", async (ev) => {
        const color = String($(ev.currentTarget).val() || "").trim();
        html.find('input[name="data.AreaColor"]').val(color);

        const presetSelect = html.find(".skill-area-color-preset");
        const hasPreset = presetSelect.find(`option[value="${color}"]`).length > 0;
        presetSelect.val(hasPreset ? color : "__custom__");

        await this.item.update({ "system.AreaColor": color });
      });

      html.find(".skill-area-color-preset").off("change").on("change", async (ev) => {
        const preset = String($(ev.currentTarget).val() || "").trim();
        const colorInput = html.find(".skill-area-color-input");

        if (preset === "__custom__") return;

        if (preset === "") {
          html.find('input[name="data.AreaColor"]').val("");
          colorInput.val(game.user?.color || "#ffffff");
          await this.item.update({ "system.AreaColor": "" });
          return;
        }

        html.find('input[name="data.AreaColor"]').val(preset);
        colorInput.val(preset);
        await this.item.update({ "system.AreaColor": preset });
      });

      // Effects editor (same format as spells)
      html.find(".effect-add").off("click").on("click", this._onSpellEffectAdd.bind(this));
      html.find(".effect-remove").off("click").on("click", this._onSpellEffectRemove.bind(this));
      html.find(".effect-type").off("change").on("change", this._onSpellEffectTypeChange.bind(this, html));
      html.find(".effect-text, .effect-debuffKey, .effect-stage, .effect-buffKind, .effect-buffValue, .effect-buffHits")
        .off("change")
        .on("change", this._onSpellEffectFieldChange.bind(this));
    }

    if (this.item.type === "Spell") {
      // Stage 1.5: DeliveryType controls which extra fields are visible.
      // We keep it client-side (no forced re-render) for smoother editing.
      this._toggleSpellDeliveryFields(html);
      this._refreshSpellAreaShapeSelect(html);
      html.find('.spell-delivery-select').off('change').on('change', this._onSpellDeliveryTypeChange.bind(this, html));
      html.find('.spell-delivery-pipeline').off('change').on('change', this._onSpellDeliveryPipelineChange.bind(this, html));
      html.find('.set-threshold').click(this._onSetThreshold.bind(this));

      // Effects editor (Stage 3.1)
      html.find(".effect-add").off("click").on("click", this._onSpellEffectAdd.bind(this));
      html.find(".effect-remove").off("click").on("click", this._onSpellEffectRemove.bind(this));
      html.find(".effect-type").off("change").on("change", this._onSpellEffectTypeChange.bind(this, html));
      html.find(".effect-text, .effect-debuffKey, .effect-stage, .effect-buffKind, .effect-buffValue, .effect-buffHits")
        .off("change")
        .on("change", this._onSpellEffectFieldChange.bind(this));

      // Summon helper: dropdown writes selected Actor UUID into the text field.
      html.find(".summon-actor-pick").off("change").on("change", async (ev) => {
        const uuid = String($(ev.currentTarget).val() || "");
        if (!uuid) return;
        // Update the input value for UX
        html.find('input[name="data.SummonActorUuid"]').val(uuid);
        // Persist to item immediately (so user doesn't forget to save)
        await this.item.update({ "system.SummonActorUuid": uuid });
      });

      // Area color picker/presets (used by AoE templates)
      html.find(".spell-area-color-input").off("change").on("change", async (ev) => {
        const color = String($(ev.currentTarget).val() || "").trim();
        html.find('input[name="data.AreaColor"]').val(color);

        const presetSelect = html.find(".spell-area-color-preset");
        const hasPreset = presetSelect.find(`option[value="${color}"]`).length > 0;

        if (hasPreset) presetSelect.val(color);
        else presetSelect.val("__custom__");

        await this.item.update({ "system.AreaColor": color });
      });


      html.find(".spell-area-color-preset").off("change").on("change", async (ev) => {
        const preset = String($(ev.currentTarget).val() || "").trim(); // "", "__custom__", or hex
        const colorInput = html.find(".spell-area-color-input");

        if (preset === "__custom__") {
          // ничего не меняем: кастомный цвет задаётся палитрой
          return;
        }

        if (preset === "") {
          // default player color: clear AreaColor
          html.find('input[name="data.AreaColor"]').val("");
          colorInput.val(game.user?.color || "#ffffff");
          await this.item.update({ "system.AreaColor": "" });
          return;
        }

        // preset hex selected
        html.find('input[name="data.AreaColor"]').val(preset);
        colorInput.val(preset);
        await this.item.update({ "system.AreaColor": preset });
      });

    }

    // Apply Edit-lock (readonly/disabled + disable image edit) when Edit mode is OFF.
    this._osApplyItemEditLock(html);

    // Attach base ItemSheet listeners LAST (drag & drop, image edit, etc.).
    // Important: our custom change handlers must run before the core handler to support hide-by-dash for numeric fields.
    super.activateListeners(html);
  }


  _toggleSkillDeliveryFields(html) {
    const all = html.find(".skill-delivery-row");
    all.hide().find("input, select, textarea").prop("disabled", true);

    const show = (selector) => {
      html.find(selector).show().find("input, select, textarea").prop("disabled", false);
    };

    if (hasDeliveryStep(this.item, "save-check")) {
      show(".skill-delivery-save");
    }

    if (hasDeliveryStep(this.item, "attack-ranged") || hasDeliveryStep(this.item, "attack-melee")) {
      show(".skill-delivery-attack");
    }

    if (hasDeliveryStep(this.item, "aoe-template")) {
      show(".skill-delivery-aoe");
    }
  }

  async _onSkillDeliveryTypeChange(html, ev) {
    ev.preventDefault();
    const value = String(ev.currentTarget.value || "utility").trim().toLowerCase();
    const updates = { "system.DeliveryType": value };

    const currentSecondary = parseDeliveryPipelineCsv(this.item.system?.DeliveryPipeline || "")[0] || "";
    const allowedSecondary = new Set(getAllowedSecondarySkillTypes(value));
    if (currentSecondary && !allowedSecondary.has(currentSecondary)) {
      updates["system.DeliveryPipeline"] = "";
    }

    const nextSecondary = (updates["system.DeliveryPipeline"] ?? currentSecondary);
    if (
      value === "aoe-template" ||
      value === MASS_SAVE_CHECK_DELIVERY ||
      nextSecondary === "aoe-template" ||
      nextSecondary === MASS_SAVE_CHECK_DELIVERY
    ) {
      const rawShape = String(this.item.system?.AreaShape || "").trim().toLowerCase();
      const unsupported = rawShape === "rect" || rawShape === "wall";
      if (unsupported) updates["system.AreaShape"] = "ray";
    }

    await this.item.update(updates);
    this._toggleSkillDeliveryFields(html);
    if (updates["system.AreaShape"]) {
      html.find('select[name="data.AreaShape"]').val(String(updates["system.AreaShape"]));
    }
    this.render(false);
  }

  async _onSkillDeliveryPipelineChange(html, ev) {
    ev.preventDefault();
    const value = String(ev.currentTarget.value || "").trim().toLowerCase();
    const updates = { "system.DeliveryPipeline": value };
    if (value === "aoe-template" || value === MASS_SAVE_CHECK_DELIVERY) {
      const rawShape = String(this.item.system?.AreaShape || "").trim().toLowerCase();
      const unsupported = rawShape === "rect" || rawShape === "wall";
      if (unsupported) updates["system.AreaShape"] = "ray";
    }

    await this.item.update(updates);
    this._toggleSkillDeliveryFields(html);
    if (updates["system.AreaShape"]) {
      html.find('select[name="data.AreaShape"]').val(String(updates["system.AreaShape"]));
    }
    this.render(false);
  }

  _toggleSpellDeliveryFields(html) {
    const delivery = String(this.item.system?.DeliveryType || "utility").trim().toLowerCase();

    // скрыть всё + отключить инпуты, чтобы Foundry не сериализовал скрытые поля
    const all = html.find(".spell-delivery-row");
    all.hide().find("input, select, textarea").prop("disabled", true);

    const show = (selector) => {
      html.find(selector).show().find("input, select, textarea").prop("disabled", false);
    };

    if (delivery === "summon") {
      show(".spell-delivery-summon");
      return;
    }

    if (hasDeliveryStep(this.item, "save-check")) {
      show(".spell-delivery-save-ability");
      show(".spell-delivery-formula");
    }

    if (hasDeliveryStep(this.item, "attack-ranged") || hasDeliveryStep(this.item, "attack-melee")) {
      show(".spell-delivery-attack");
    }

    if (hasDeliveryStep(this.item, "aoe-template") || hasDeliveryStep(this.item, "create-object")) {
      show(".spell-delivery-aoe");
    }
  }



  async _onSpellDeliveryPipelineChange(html, ev) {
    ev.preventDefault();
    const value = String(ev.currentTarget.value || "").trim().toLowerCase();
    await this.item.update({ "system.DeliveryPipeline": value });
    this._toggleSpellDeliveryFields(html);
  }

  async _onSpellDeliveryTypeChange(html, ev) {
    ev.preventDefault();
    const value = String(ev.currentTarget.value || 'utility').trim().toLowerCase();
    const updates = { 'system.DeliveryType': value };
    if (value === "aoe-template" || value === MASS_SAVE_CHECK_DELIVERY) {
      const rawShape = String(this.item.system?.AreaShape || "").trim().toLowerCase();
      const unsupported = rawShape === "rect" || rawShape === "wall";
      if (unsupported) updates["system.AreaShape"] = "ray";
    }

    const currentSecondary = parseDeliveryPipelineCsv(this.item.system?.DeliveryPipeline || "")[0] || "";
    const allowedSecondary = new Set(getAllowedSecondarySpellTypes(value));
    if (currentSecondary && !allowedSecondary.has(currentSecondary)) {
      updates["system.DeliveryPipeline"] = "";
    }

    await this.item.update(updates);
    // Update visibility without a full re-render.
    this._toggleSpellDeliveryFields(html);
    this._refreshSpellAreaShapeSelect(html, value);
    this.render(false);
  }

  _refreshSpellAreaShapeSelect(html, deliveryOverride = null) {
    const select = html.find('select[name="data.AreaShape"]');
    if (!select.length) return;

    const delivery = String(deliveryOverride ?? this.item.system?.DeliveryType ?? "utility");
    const options = [
      { value: "circle", label: "Круг" },
      { value: "cone", label: "Конус" },
      { value: "ray", label: "Прямоугольник" }
    ];

    const rawShape = String(this.item.system?.AreaShape || "").trim().toLowerCase();
    const current = ((delivery === "aoe-template" || delivery === MASS_SAVE_CHECK_DELIVERY) && (rawShape === "rect" || rawShape === "wall"))
      ? "ray"
      : rawShape;

    const htmlOptions = options.map((opt) => {
      const selected = current === opt.value ? " selected" : "";
      return `<option value="${opt.value}"${selected}>${opt.label}</option>`;
    }).join("");
    select.html(htmlOptions);
  }


  async _onInHandChange(event) {
    event.preventDefault();
    const inHand = event.currentTarget.checked;

    const actor = this.item.actor;
    if (actor) {
      const updates = [{ _id: this.item.id, "system.inHand": inHand }];

      if (inHand) {
        const weaponType = this.item.system?.weaponType;
        const otherWeapons = actor.items.filter(i => (
          ["weapon", "meleeweapon", "rangeweapon"].includes(i.type) &&
          i.id !== this.item.id &&
          i.system?.inHand &&
          (!weaponType || i.system?.weaponType === weaponType)
        ));

        for (const w of otherWeapons) {
          updates.push({ _id: w.id, "system.inHand": false });
        }
      }

      await actor.updateEmbeddedDocuments("Item", updates);
    } else {
      await this.item.update({ "system.inHand": inHand });
    }
  }

  async _onWeaponTypeChange(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const weaponType = element.value;

    // Update the weapon's data
    await this.object.update({ "system.weaponType": weaponType });
  }

  async _onSetThreshold(event) {
    event.preventDefault();
    const current = this.item.system.UsageThreshold || 0;
    new Dialog({
      title: "Порог условия применения",
      content: `<div class="form-group"><input type="number" id="threshold" value="${current}" /></div>`,
      buttons: {
        ok: {
          label: "ОК",
          callback: html => {
            const val = parseInt(html.find('#threshold').val()) || 0;
            this.item.update({ "system.UsageThreshold": val });
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "ok"
    }).render(true);
  }

  async _onModifierChange(delta, event) {
    event.preventDefault();
    const input = $(event.currentTarget).siblings('input');
    const value = parseFloat(input.val()) + delta;
    input.val(value).trigger('change');
  }

  async _onAddAdvantage(data) {
    // Берём текущий массив дополнительных преимуществ
    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    // Добавляем новое значение в массив
    additionalAdvantages.push(data);

    // Сохраняем обновлённый массив в систему Foundry
    await this.item.update({ "system.additionalAdvantages": additionalAdvantages });

    // Уведомляем пользователя
    ui.notifications.info("Характеристика успешно добавлена!");
  }


  _calculateSkillSegments(level, circle) {
    // Perks can define a custom training requirement for level 0.
    // This overrides the default segment count for ANY circle, but only for level 0.
    const isPerkSkill = this.item?.type === "Skill" && !!this.item.system?.isPerk;
    if (isPerkSkill && level === 0) {
      const raw = Number(this.item.system?.perkTrainingPoints ?? 0);
      const custom = Number.isFinite(raw) ? Math.trunc(raw) : 0;
      if (custom > 0) return custom;
    }

    const c = Number(circle);
    const lvl = Number(level);
    if (!Number.isFinite(c) || !Number.isFinite(lvl) || lvl < 0) return 0;

    // If already at (or beyond) max level — no more segments.
    const max = this._getMaxLevelForCircle(c);
    if (max > 0 && lvl >= max) return 0;

    // Circle 0 is a special short progression: 0→1 (8), 1→2 (10), 2→3 (12), 3 is max.
    if (c === 0) {
      const table0 = [8, 10, 12];
      return table0[lvl] ?? 0;
    }

    // Circles 1..4 follow a simple rule (as in the training difficulty table):
    // base = 10 + 2*circle, then +2 every two levels.
    // Example (circle 2): [14,14,16,16,18,18,20]
    const base = 10 + 2 * c;
    return base + 2 * Math.floor(lvl / 2);
  }

  _getMaxLevelForCircle(circle) {
    const maxLevels = {
      0: 3,
      1: 5,
      2: 7,
      3: 9,
      4: 11
    };
    return maxLevels[circle] || 0;
  }

  _parseCircleValue(circleInput) {
    if (circleInput?.length) {
      const circleFromInput = parseInt(circleInput.val(), 10);
      if (!Number.isNaN(circleFromInput)) return circleFromInput;
    }

    const circleFromData = parseInt(this.item.system?.Circle, 10);
    return Number.isNaN(circleFromData) ? 0 : circleFromData;
  }


  _drawCircle(canvas, filledSegments, totalSegments, isMaxLevel) {
    const ctx = canvas.getContext('2d');
    const radius = Math.min(canvas.width, canvas.height) / 2 - 5; // Радиус круга
    const center = { x: canvas.width / 2, y: canvas.height / 2 }; // Центр круга

    // Угол на один сегмент
    const anglePerSegment = (2 * Math.PI) / totalSegments;

    // Очистка канваса
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Устанавливаем чёрный фон круга
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "#000000"; // Чёрный цвет фона
    ctx.fill();

    // Если уровень максимальный, рисуем галочку
    if (isMaxLevel) {
      ctx.strokeStyle = "#00ff00"; // Зелёный цвет для галочки
      ctx.lineWidth = 4;

      // Рисуем галочку
      ctx.beginPath();
      ctx.moveTo(center.x - radius / 3, center.y); // Линия вниз
      ctx.lineTo(center.x - radius / 6, center.y + radius / 4);
      ctx.lineTo(center.x + radius / 3, center.y - radius / 6); // Линия вверх
      ctx.stroke();

      return; // Не рисуем сегменты, если уровень максимальный
    }

    // Рисуем сегменты
    for (let i = 0; i < totalSegments; i++) {
      const startAngle = i * anglePerSegment - Math.PI / 2; // Начало сектора
      const endAngle = startAngle + anglePerSegment; // Конец сектора

      ctx.beginPath();
      ctx.moveTo(center.x, center.y); // Центр круга
      ctx.arc(center.x, center.y, radius, startAngle, endAngle, false); // Сектор

      // Если сегмент заполнен
      if (i < filledSegments) {
        ctx.fillStyle = game.user.color || "#ffffff"; // Цвет заполнения
      } else {
        ctx.fillStyle = "#000000"; // Цвет незаполненного сегмента
      }
      ctx.fill();

      // Добавляем границы сегмента
      ctx.lineWidth = 2; // Толщина линий
      ctx.strokeStyle = "#ffffff"; // Белая граница
      ctx.stroke();
    }
  }



  _activateSkillListeners(html) {
    html.find('.circle-progress-skill').each((_, canvas) => {
      const circleRaw = parseInt(canvas.dataset.circle, 10);
      const circle = Number.isNaN(circleRaw) ? 1 : circleRaw;
      const level = parseInt(canvas.dataset.level, 10) || 0;
      const filledSegments = parseInt(canvas.dataset.filled || 0, 10);
      const totalSegments = this._calculateSkillSegments(level, circle);
      const isMaxLevel = (level >= this._getMaxLevelForCircle(circle)); // Проверяем, достигнут ли максимум

      // Устанавливаем размеры Canvas
      canvas.width = 75;
      canvas.height = 75;

      // Устанавливаем tooltip
      canvas.title = isMaxLevel ? "Максимальный уровень" : `${filledSegments} / ${totalSegments}`;

      // Рисуем круг
      this._drawCircle(canvas, filledSegments, totalSegments, isMaxLevel);
    });

    // Добавляем обработчики кликов на Canvas
    html.find('.circle-progress-skill').on('mousedown', async event => {
      const canvas = event.currentTarget;
      const circleRaw = parseInt(canvas.dataset.circle, 10);
      const circle = Number.isNaN(circleRaw) ? 1 : circleRaw;
      let level = parseInt(canvas.dataset.level, 10) || 0;
      let filledSegments = parseInt(canvas.dataset.filled, 10) || 0;
      const totalSegments = this._calculateSkillSegments(level, circle);
      const isMaxLevel = (level >= this._getMaxLevelForCircle(circle));

      if (event.button === 0 && !isMaxLevel) {
        // ЛКМ: добавляем сегмент
        filledSegments++;
        if (filledSegments >= totalSegments) {
          filledSegments = 0; // Сбрасываем заполнение
          level++; // Увеличиваем уровень
        }
      } else if (event.button === 2) {
        // ПКМ: убираем сегмент
        if (isMaxLevel) {
          // Если максимальный уровень, убираем галочку и уменьшаем уровень
          level--;
          filledSegments = this._calculateSkillSegments(level, circle) - 1;
        } else if (filledSegments > 0) {
          filledSegments--;
        } else if (level > 0) {
          level--; // Уменьшаем уровень
          filledSegments = this._calculateSkillSegments(level, circle) - 1; // Устанавливаем максимальные сегменты для нового уровня
        }
      }

      // Обновляем данные предмета
      await this.object.update({
        "data.Level": level,
        "data.filledSegments": filledSegments
      });

      // Обновляем tooltip
      const totalNow = this._calculateSkillSegments(level, circle);
      const isMaxNow = level >= this._getMaxLevelForCircle(circle);
      canvas.title = isMaxNow ? "Максимальный уровень" : `${filledSegments} / ${totalNow}`;

      // Перерисовываем круг
      this._drawCircle(canvas, filledSegments, totalNow, isMaxNow);
    });
  }



  async _onAdvantageCharacteristicChange(event) {
    event.preventDefault();
    const select = event.currentTarget;
    const characteristic = select.value;
    await this.item.update({ "system.AdvantageCharacteristic": characteristic });
  }

  async _onRemoveAdvantage(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(event.currentTarget).closest('.advantage-char').data('index');
    itemId = parseInt(itemId);
    const additionalAdvantages = this.item.system.additionalAdvantages || [];

    let itemName = 'этот модификатор';

    new Dialog({
      title: `Удалить «${itemName}»?`,
      content: `<p>Вы уверены, что хотите удалить «${itemName}»?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Да",
          callback: () => {
            additionalAdvantages.splice(itemId, 1);
            this.item.update({ "system.additionalAdvantages": additionalAdvantages });
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Нет"
        }
      },
      default: "no"
    }).render(true);
  }

  async _onAddField(ev) {
    ev.preventDefault();
    const fields = normalizeAdditionalFields(this.item.system.additionalFields);
    const hiddenAdditional = fields.map((f, i) => ({ ...f, index: i })).filter(f => f.hidden);
    const hiddenDefaults = Object.keys(this.item.system.hiddenDefaults || {});

    if (hiddenAdditional.length > 0 || hiddenDefaults.length > 0) {
      let options = "";
      for (let f of hiddenAdditional) {
        options += `<option value="a-${f.index}">${f.name}</option>`;
      }
      for (let d of hiddenDefaults) {
        const label = DEFAULT_FIELD_LABELS[d] || d;
        options += `<option value="d-${d}">${label}</option>`;
      }

      new Dialog({
        title: "Скрытые поля",
        content: `<div class="form-group"><label>Поле: <select name="field">${options}</select></label></div>`,
        buttons: {
          show: {
            label: "Показать",
            callback: async html => {
              const choice = html.find('select[name="field"]').val();
              if (!choice) return;
              if (choice.startsWith('a-')) {
                const idx = Number(choice.slice(2));
                if (fields[idx]) {
                  fields[idx].hidden = false;
                  if (fields[idx].value === '-' || fields[idx].value === '—' || fields[idx].value === '–' || fields[idx].value === '−') fields[idx].value = '';
                }
                await this.item.update({ "system.additionalFields": fields });
              } else if (choice.startsWith('d-')) {
                const name = choice.slice(2);
                const hidden = this.item.system.hiddenDefaults || {};

                // Linked default fields (Skill/Spell): some fields are formula/result pairs.
                // Restoring one should restore the other as well.
                const isSkillSpell = (this.item.type === "Skill" || this.item.type === "Spell");
                const isDamagePair = (name === "DamageFormula" || name === "Damage");
                const isRangePair = (name === "RangeFormula" || name === "Range");
                const names = (isSkillSpell && (isDamagePair || isRangePair))
                  ? (isDamagePair ? ["DamageFormula", "Damage"] : ["RangeFormula", "Range"])
                  : [name];

                const updates = {};
                for (const n of names) {
                  let stored = hidden[n]?.value ?? "";
                  if (stored === '-' || stored === '—' || stored === '–' || stored === '−') stored = '';
                  updates[`system.${n}`] = stored;
                  updates[`system.hiddenDefaults.-=${n}`] = null;
                }

                await this.item.update(updates);
              }
              this.render(true);
              if (this.item.parent?.sheet) {
                this.item.parent.sheet.render(false);
              }
            }
          },
          add: {
            label: "Добавить новое",
            callback: () => this._addNewField()
          }
        },
        default: "show"
      }).render(true);
    } else {
      this._addNewField();
    }
  }

  _addNewField() {
    new Dialog({
      title: "Новое поле",
      content: '<div class="form-group"><label>Название: <input type="text" name="field-name"/></label></div>',
      buttons: {
        ok: {
          label: "ОК",
          callback: async html => {
            const name = html.find('input[name="field-name"]').val().trim();
            if (!name) return;
            const fields = normalizeAdditionalFields(this.item.system.additionalFields);
            fields.push({ name, value: "", hidden: false, show: false });
            await this.item.update({ "system.additionalFields": fields });
            this.render(true);
          }
        }
      },
      default: "ok"
    }).render(true);
  }

  async _onAdditionalFieldChange(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    const index = Number(ev.currentTarget.dataset.index);
    const raw = ev.currentTarget.value;
    const value = (typeof raw === "string") ? raw.trim() : raw;
    const fields = normalizeAdditionalFields(this.item.system.additionalFields);
    if (!fields[index]) return;

    // Hide sentinel: "-" (also support dash variants)
    if (value === '-' || value === '—' || value === '–' || value === '−') {
      // Prevent the core sheet change handler from coercing "-" into a number (0/NaN)
      // and overwriting our hide logic.
      fields[index].hidden = true;
      // keep previous stored value to restore when unhidden
    } else {
      fields[index].value = (typeof raw === "string") ? raw : value;
    }

    await this.item.update({ "system.additionalFields": fields });
    this.render(true);
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _updateObject(event, formData) {
    const isWeapon = ["weapon", "meleeweapon", "rangeweapon"].includes(this.item.type);
    if (isWeapon && formData && typeof formData === "object") {
      const keys = Object.keys(formData).filter((k) =>
        k === "data.OnHitEffects" ||
        k === "system.OnHitEffects" ||
        k.startsWith("data.OnHitEffects.") ||
        k.startsWith("system.OnHitEffects.")
      );

      if (keys.length) {
        // OnHitEffects are managed by dedicated handlers (add/remove/select change).
        // Keeping them out of generic form submit avoids accidental array reset.
        for (const key of keys) {
          delete formData[key];
        }
      }
    }

    if (formData && typeof formData === "object") {
      const keys = Object.keys(formData).filter((k) =>
        k === "data.additionalFields" ||
        k === "system.additionalFields" ||
        /^(data|system)\.additionalFields\.\d+\.(name|value|hidden|show)$/.test(k)
      );
      for (const key of keys) {
        delete formData[key];
      }
    }

    return super._updateObject(event, formData);
  }

  async _onFieldChange(ev) {
    const input = ev.currentTarget;
    const rawName = input.name || "";
    // We use 'data.' prefix in templates, but store everything inside system.
    const name = rawName.startsWith('data.') ? rawName.slice(5) : rawName;

    // Read raw value
    let value = (input.type === 'checkbox') ? input.checked : input.value;

    // Normalize strings (trim) for hide sentinel checks
    const valueTrim = (typeof value === 'string') ? value.trim() : value;

    // Hide sentinel: "-" (also support dash variants)
    if (valueTrim === '-' || valueTrim === '—' || valueTrim === '–' || valueTrim === '−') {
      // Prevent the core sheet change handler from coercing "-" into a number (0/NaN)
      // and overwriting our hide logic.
      ev.preventDefault();
      ev.stopImmediatePropagation();

      const hidden = duplicate(this.item.system.hiddenDefaults || {});

      // Linked default fields (Skill/Spell): some fields are formula/result pairs.
      // Hiding one should hide the other as well.
      const isSkillSpell = (this.item.type === "Skill" || this.item.type === "Spell");
      const linked = [];
      if (isSkillSpell && (name === "DamageFormula" || name === "Damage")) {
        linked.push(name === "DamageFormula" ? "Damage" : "DamageFormula");
      }
      if (isSkillSpell && (name === "RangeFormula" || name === "Range")) {
        linked.push(name === "RangeFormula" ? "Range" : "RangeFormula");
      }

      const toHide = Array.from(new Set([name, ...linked]));
      for (const f of toHide) {
        if (hidden[f] === undefined) hidden[f] = { value: this.item.system?.[f] };
      }

      const updates = { "system.hiddenDefaults": hidden };
      for (const f of toHide) {
        updates[`system.${f}`] = "";
      }

      await this.item.update(updates);
      this.render(true);
      if (this.item.parent?.sheet) {
        this.item.parent.sheet.render(false);
      }
      return;
    }

    // Usage cost for skills/spells accepts only non-negative integers.
    if ((this.item.type === "Skill" || this.item.type === "Spell") && name === "UsageCost") {
      if (typeof value === "string") {
        const t = value.trim();
        if (t === "") {
          value = "";
        } else if (!/^\d+$/.test(t)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          input.value = String(this.item.system?.UsageCost ?? "");
          ui.notifications?.warn?.('Поле "Стоимость применения" должно содержать только целое число.');
          return;
        } else {
          value = Number.parseInt(t, 10);
          input.value = String(value);
        }
      } else if (Number.isFinite(value)) {
        value = Math.max(0, Math.trunc(value));
      } else {
        value = "";
      }
    }

    // Convert numbers if requested (we rely on data-dtype="Number" in templates)
    if (typeof value === 'string' && input.dataset?.dtype === 'Number') {
      const t = value.trim();
      if (t === "") value = "";
      else {
        const num = Number(t);
        // keep string if it isn't a valid number (prevents turning into NaN)
        if (!Number.isNaN(num)) value = num;
        else value = t;
      }
    }

    await this.item.update({ [`system.${name}`]: value });
    this.render(true);
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _onFieldLabelClick(ev) {
    const label = ev.currentTarget;
    const type = label.dataset.type;
    if (type === 'additional') {
      const index = Number(label.dataset.index);
      const fields = normalizeAdditionalFields(this.item.system.additionalFields);
      if (fields[index]) {
        fields[index].show = !fields[index].show;
        await this.item.update({ "system.additionalFields": fields });
        label.classList.toggle('selected', fields[index].show);
      }
    } else {
      const field = label.dataset.field;
      const display = duplicate(this.item.system.displayFields || {});
      display[field] = !display[field];
      await this.item.update({ "system.displayFields": display });
      label.classList.toggle('selected', display[field]);
    }
    if (this.item.parent?.sheet) {
      this.item.parent.sheet.render(false);
    }
  }

  async _onRemoveAttackCharacteristic(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(event.currentTarget).closest('.attack-char').data('index');
    itemId = parseInt(itemId);
    const AttackCharacteristics = this.item.system.AttackCharacteristics || [];

    let itemName = 'эту характеристику атаки';

    new Dialog({
      title: `Удалить «${itemName}»?`,
      content: `<p>Вы уверены, что хотите удалить «${itemName}»?</p>`,
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Да",
          callback: () => {
            AttackCharacteristics.splice(itemId, 1);
            this.item.update({ "system.AttackCharacteristics": AttackCharacteristics });
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Нет"
        }
      },
      default: "no"
    }).render(true);
  }

  async _onEquipChange(event) {
    event.preventDefault();
    const isEquiped = event.currentTarget.checked;

    await this.item.update({ "system.isEquiped": isEquiped });
  }

  async _onUsedChange(event) {
    event.preventDefault();
    const isUsed = event.currentTarget.checked;

    await this.item.update({ "system.isUsed": isUsed });

    if (isUsed == false) {
      await this.item.update({ "system.isEquiped": isUsed });
    }
    // Здесь можно добавить логику для применения параметров к персонажу, когда броня надета
    if (isUsed) {
      // Применяем параметры
    } else {
      // Убираем параметры
    }
  }

  _supportsItemModifications() {
    return ["weapon", "meleeweapon", "rangeweapon", "Armor"].includes(this.item?.type);
  }

  _getItemModificationsArray() {
    let source = this.item?.system?.Modifications;

    // Safety: core submit can coerce arrays into numeric-key objects.
    if (!Array.isArray(source) && source && typeof source === "object") {
      source = Object.entries(source)
        .filter(([k]) => /^\d+$/.test(String(k)))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => v);
    }

    if (!Array.isArray(source)) return [];

    return source
      .map((entry, index) => this._normalizeItemModification(entry, index))
      .filter((entry) => !!entry);
  }

  _normalizeItemModification(entry, index = 0) {
    if (!entry) return null;

    if (typeof entry === "string") {
      const uuid = String(entry).trim();
      if (!uuid) return null;
      const stable = String(uuid).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || String(index);
      return {
        id: `mod-${index}-${stable}`,
        uuid,
        itemId: "",
        name: "",
        img: "",
        itemType: "RegularItem"
      };
    }

    if (typeof entry !== "object") return null;

    const normalized = {
      id: String(entry.id || entry.modificationId || ""),
      uuid: String(entry.uuid || entry.itemUuid || entry.flags?.Order?.sourceUuid || "").trim(),
      itemId: String(entry.itemId || entry.sourceId || entry._id || "").trim(),
      name: String(entry.name || entry.itemName || "").trim(),
      img: String(entry.img || entry.itemImg || "").trim(),
      itemType: String(entry.itemType || entry.type || "RegularItem").trim()
    };

    if (!normalized.id) {
      const stableSeed = normalized.uuid || normalized.itemId || normalized.name || String(index);
      const stable = String(stableSeed).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || String(index);
      normalized.id = `mod-${index}-${stable}`;
    }
    if (!normalized.uuid && !normalized.itemId && !normalized.name) return null;

    return normalized;
  }

  _resolveItemModificationDoc(entry) {
    if (!entry) return null;
    const actor = this.item?.actor ?? (this.item?.parent instanceof Actor ? this.item.parent : null);

    if (entry.uuid && typeof fromUuidSync === "function") {
      try {
        const doc = fromUuidSync(entry.uuid);
        if (doc?.documentName === "Item" || doc instanceof Item) return doc;
      } catch (err) {
        // ignore invalid uuid
      }
    }

    if (entry.itemId && actor?.items?.get(entry.itemId)) {
      return actor.items.get(entry.itemId);
    }

    if (entry.itemId && game?.items?.get(entry.itemId)) {
      return game.items.get(entry.itemId);
    }

    return null;
  }

  _getItemModificationsForSheet() {
    return this._getItemModificationsArray().map((entry) => {
      const doc = this._resolveItemModificationDoc(entry);
      return {
        ...entry,
        name: doc?.name || entry.name || "Без названия",
        img: doc?.img || entry.img || "icons/svg/item-bag.svg",
        missing: !doc
      };
    });
  }

  _getItemDropData(event) {
    const dt = event?.originalEvent?.dataTransfer ?? event?.dataTransfer;
    const raw = dt?.getData("text/plain");
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  _onModificationDragEnter(event) {
    if (!this._supportsItemModifications()) return;
    event.preventDefault();
    event.currentTarget?.classList?.add("is-dragover");
  }

  _onModificationDragOver(event) {
    if (!this._supportsItemModifications()) return;
    event.preventDefault();
  }

  _onModificationDragLeave(event) {
    event.currentTarget?.classList?.remove("is-dragover");
  }

  async _onModificationDrop(event) {
    if (!this._supportsItemModifications()) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget?.classList?.remove("is-dragover");

    if (!this.isEditable) return;

    const data = this._getItemDropData(event);
    if (!data || data.type !== "Item") {
      ui.notifications?.warn?.("Можно перетаскивать только предметы.");
      return;
    }

    const droppedItem = await Item.fromDropData(data);
    if (!droppedItem) return;

    if (droppedItem.type !== "RegularItem") {
      ui.notifications?.warn?.("Модификацией может быть только предмет типа 'Regular Item'.");
      return;
    }

    const entries = this._getItemModificationsArray();
    const droppedUuid = String(droppedItem.uuid || "").trim();
    const droppedId = String(droppedItem.id || "").trim();

    const isDuplicate = entries.some((entry) =>
      (droppedUuid && entry.uuid === droppedUuid) ||
      (droppedId && entry.itemId === droppedId && (!droppedUuid || !entry.uuid))
    );

    if (isDuplicate) {
      ui.notifications?.warn?.("Эта модификация уже добавлена.");
      return;
    }

    entries.push({
      id: foundry.utils.randomID(),
      itemId: droppedId,
      uuid: droppedUuid,
      name: String(droppedItem.name || ""),
      img: String(droppedItem.img || ""),
      itemType: "RegularItem"
    });

    await this.item.update({ "system.Modifications": entries });

    const slots = Math.max(0, Number(this.item.system?.Modificationslots ?? 0) || 0);
    if (entries.length > slots) {
      ui.notifications?.warn?.(`Превышен лимит слотов модификаций: ${entries.length}/${slots}.`);
    }
  }

  async _onOpenModification(event) {
    event.preventDefault();
    if (!this._supportsItemModifications()) return;

    const modId = String(event.currentTarget?.dataset?.modificationId || "");
    if (!modId) return;

    const entry = this._getItemModificationsArray().find((m) => m.id === modId);
    if (!entry) return;

    const doc = this._resolveItemModificationDoc(entry);
    if (doc?.sheet) {
      doc.sheet.render(true);
      return;
    }

    ui.notifications?.warn?.("Связанная модификация не найдена.");
  }

  async _onRemoveModification(event) {
    event.preventDefault();
    if (!this._supportsItemModifications() || !this.isEditable) return;

    const modId = String(event.currentTarget?.dataset?.modificationId || "");
    if (!modId) return;

    const current = this._getItemModificationsArray();
    const next = current.filter((entry) => entry.id !== modId);
    if (next.length === current.length) return;

    await this.item.update({ "system.Modifications": next });
  }

  async _onAddRequire(data) {
    // Берём текущий массив дополнительных преимуществ
    const additionalAdvantages = this.item.system.RequiresArray || [];

    // Добавляем новое значение в массив
    additionalAdvantages.push(data);

    // Сохраняем обновлённый массив в систему Foundry
    await this.item.update({ "system.RequiresArray": additionalAdvantages });

    // Уведомляем пользователя
    ui.notifications.info("Характеристика успешно добавлена!");
  }


  async _onRemoveRequire(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = $(element).closest('.requires-char').data('index');
    const RequiresArray = this.item.system.RequiresArray || [];
    itemId = parseInt(itemId);

    if (itemId >= 0 && itemId < RequiresArray.length) {
      let itemName = 'это требование';

      new Dialog({
        title: `Удалить «${itemName}»?`,
        content: `<p>Вы уверены, что хотите удалить «${itemName}»?</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: "Да",
            callback: () => {
              RequiresArray.splice(itemId, 1);
              this.item.update({ "system.RequiresArray": RequiresArray });
            }
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: "Нет"
          }
        },
        default: "no"
      }).render(true);
    }
  }

  async _addingParameters() {
    const template = Handlebars.compile(`
    <div class="advantage-field">
        <select name="data.AdvantageCharacteristic" class="advantage-select">
            {{#each characteristics}}
            <option value="{{this}}" {{#if (isSelected this ../data.AdvantageCharacteristic)}}selected{{/if}}>{{localize this}}</option>
            {{/each}}
        </select>
        <div class="advantage-modifier">
            <button type="button" class="advantage-modifier-minus">-</button>
            <input name="data.Parameters" type="text" value="{{data.Parameters}}" data-type="Number" readonly />
            <button type="button" class="advantage-modifier-plus">+</button>
        </div>
    </div>
`);
    const html = template(this.getData());

    new Dialog({
      title: "Добавление новых параметров",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            // Собираем данные из формы
            const characteristic = html.find(".advantage-select").val();
            const parametersValue = parseInt(html.find("input[name='data.Parameters']").val(), 10) || 0;

            // Создаём объект для записи
            const data = { Characteristic: characteristic, Value: parametersValue };

            // Передаём объект в функцию
            this._onAddAdvantage(data);
          },
        },
        cancel: { label: "Отмена" }
      },
      default: "ok",
      render: (html) => {
        html.find(".advantage-modifier-plus").on("click", () => {
          const input = html.find("input[name='data.Parameters']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue + 1);
        });

        html.find(".advantage-modifier-minus").on("click", () => {
          const input = html.find("input[name='data.Parameters']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue - 1);
        });
      }
    }).render(true);
  }

  async _addingRequires() {
    const template = Handlebars.compile(`
    <div class="requires-field">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <select name="data.RequiresCharacteristic" class="requires-select">
                {{#each characteristics as |Characteristic|}}
                <option value="{{Characteristic}}" {{#if (isSelected Characteristic
                  ../data.RequiresCharacteristic)}}selected{{/if}}>{{localize Characteristic}}</option>
                {{/each}}
              </select>

              <label style="display:flex; gap:6px; align-items:center; user-select:none;">
                <input type="checkbox" class="requires-or-checkbox" />
                ИЛИ
              </label>

              <select name="data.RequiresCharacteristicAlt" class="requires-select-alt" style="display:none;">
                {{#each characteristics as |Characteristic|}}
                <option value="{{Characteristic}}">{{localize Characteristic}}</option>
                {{/each}}
              </select>
            </div>
            <div class="requires-modifier">
              <button type="button" class="requires-modifier-minus">-</button>
              <input name="data.Requires" type="text" value="{{data.Requires}}" data-type="Number" readonly />
              <button type="button" class="requires-modifier-plus">+</button>
            </div>
          </div>
`);
    const html = template(this.getData());

    const dialog = new Dialog({
      title: "Управление требованиями",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            const characteristic = html.find(".requires-select").val();
            const requiresValue = parseInt(html.find("input[name='data.Requires']").val(), 10) || 0;

            const useOr = html.find(".requires-or-checkbox").is(":checked");
            const characteristicAlt = html.find(".requires-select-alt").val();

            const data = {
              RequiresCharacteristic: characteristic,
              Requires: requiresValue,
              RequiresOr: !!useOr,
              RequiresCharacteristicAlt: useOr ? characteristicAlt : ""
            };

            this._onAddRequire(data);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "save",
      render: (html) => {
        // Toggle the alternative characteristic selector
        const updateAltVisibility = () => {
          const checked = html.find(".requires-or-checkbox").is(":checked");
          const altSel = html.find(".requires-select-alt");
          checked ? altSel.show() : altSel.hide();
        };
        html.find(".requires-or-checkbox").on("change", updateAltVisibility);
        updateAltVisibility();

        html.find(".requires-modifier-plus").on("click", () => {
          const input = html.find("input[name='data.Requires']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue + 1);
        });

        html.find(".requires-modifier-minus").on("click", () => {
          const input = html.find("input[name='data.Requires']");
          const currentValue = parseInt(input.val(), 10) || 0;
          input.val(currentValue - 1);
        });
      }
    }).render(true);
  }


  _initializeConsumableTypeControls(html) {
    const typeSelect = html.find(".consumable-type-select");
    const useButton = html.find(".roll-consumable-use");

    const updateVisibility = (rawType) => {
      const normalizedType = normalizeConsumableType(rawType);
      const isAmmo = isAmmoConsumableType(normalizedType);
      const isGrenade = isGrenadeConsumableType(normalizedType);
      const isDoping = normalizedType === "doping" || normalizedType.includes("\u0434\u043e\u043f\u043f\u0438\u043d\u0433");

      const hideDamage = isAmmo;
      const hideThreshold = isDoping || isAmmo;
      const hideExtraPanels = isAmmo;

      const toggleField = (selector, shouldHide) => {
        const elements = html.find(selector);
        shouldHide ? elements.hide() : elements.show();
      };

      toggleField(".consumable-field--damage", hideDamage);
      toggleField(".consumable-field--radius", !isGrenade);
      toggleField(".consumable-field--threshold", hideThreshold);
      toggleField(".consumable-panel--parameters", hideExtraPanels);
      toggleField(".consumable-panel--hint", hideExtraPanels);
      toggleField(".consumable-col--hint", hideExtraPanels);

      if (useButton.length) {
        useButton.prop("disabled", isAmmo);
        useButton.removeAttr("title");
      }
    };

    if (typeSelect.length) {
      typeSelect.on("change", async (event) => {
        const selectedType = event.currentTarget.value;
        updateVisibility(selectedType);
        await this.item.update({ "system.TypeOfConsumables": selectedType });
      });
    }

    const selectedType = String(typeSelect.val() ?? "").trim();
    const initialType = selectedType || String(this.item?.system?.TypeOfConsumables ?? "");
    updateVisibility(initialType);
  }

  async _onUseConsumableFromSheet(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (this.item?.type !== "Consumables") return;

    const actor = this.item?.actor ?? this.item?.parent ?? null;
    if (!actor) {
      ui.notifications?.warn?.("Consumables can be used only from an actor inventory.");
      return;
    }

    await startConsumableUse({ actor, consumableItem: this.item });
  }


  async _showAttackDialog(actor) {
    const template = Handlebars.compile(`
    <td>
  <div class="attack-characteristics">
  <select name="attack-characteristic" class="attack-select">
    {{#each characteristics}}
      <option value="{{this}}" {{#if (eq ../selectedCharacteristic this)}}selected{{/if}}>
        {{localize this}}
      </option>
    {{/each}}
  </select>
</div>
`);
    const html = template(this.getData());

    const dialog = new Dialog({
      title: "Настройки характеристики атаки",
      content: html,
      buttons: {
        save: {
          label: "Сохранить",
          callback: async (html) => {
            const currentArray = this.item.system.AttackCharacteristics || [];
            const selectedCharacteristic = html.find(".attack-select").val();

            if (!selectedCharacteristic) {
              ui.notifications.warn("Выберите характеристику перед добавлением.");
              return;
            }

            if (!currentArray.includes(selectedCharacteristic)) {
              currentArray.push(selectedCharacteristic);

              // Обновляем список характеристик
              await this.item.update({ "system.AttackCharacteristics": currentArray });
            } else {
              ui.notifications.warn("Эта характеристика уже добавлена.");
            }

            this.render(true);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "save",
    }).render(true);
  }

  async _loadDebuffsJson() {
    try {
      const response = await fetch("systems/Order/module/debuffs.json");
      if (!response.ok) throw new Error("Failed to load debuffs.json");
      return await response.json();
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось загрузить debuffs.json.");
      return null;
    }
  }

  _getWeaponOnHitEffectsArray(raw = this.item?.system?.OnHitEffects) {
    let source = raw;

    if (!Array.isArray(source) && source && typeof source === "object") {
      source = Object.entries(source)
        .filter(([k]) => /^\d+$/.test(String(k)))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => v);
    }

    const arr = Array.isArray(source) ? foundry.utils.duplicate(source) : [];

    return arr.map((e) => {
      if (e && typeof e === "object") {
        return {
          debuffKey: String(e.debuffKey ?? "").trim(),
          stateKey: String(e.stateKey ?? 1)
        };
      }
      if (typeof e === "string") {
        return {
          debuffKey: String(e).trim(),
          stateKey: "1"
        };
      }
      return { debuffKey: "", stateKey: "1" };
    });
  }

  async _addWeaponOnHitEffect() {
    // Только для оружия
    if (!["weapon", "meleeweapon", "rangeweapon"].includes(this.item.type)) {
      ui.notifications.warn("Эффекты оружия доступны только для предметов оружия.");
      return;
    }

    const debuffs = await this._loadDebuffsJson();
    if (!debuffs) return;

    const keys = Object.keys(debuffs);
    if (!keys.length) {
      ui.notifications.warn("В debuffs.json нет дебаффов.");
      return;
    }

    const options = keys
      .map(k => `<option value="${k}">${debuffs[k].name || k}</option>`)
      .join("");

    const content = `
    <form>
      <div class="form-group">
        <label>Эффект</label>
        <select id="debuffKey" style="width:100%">${options}</select>
      </div>

      <div class="form-group">
        <label>Уровень</label>
        <select id="stateKey" style="width:100%">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </div>
    </form>
  `;

    new Dialog({
      title: "Добавить эффект оружия",
      content,
      buttons: {
        ok: {
          label: "Добавить",
          callback: async (html) => {
            const debuffKey = html.find("#debuffKey").val();
            const stateKey = String(html.find("#stateKey").val() || "1");

            const arr = this._getWeaponOnHitEffectsArray();

            // Чтобы не плодить дубликаты "тот же эффект/тот же уровень"
            const exists = arr.some(e => e?.debuffKey === debuffKey && (String(e?.stateKey ?? "1") === stateKey));
            if (exists) {
              ui.notifications.warn("Такой эффект уже добавлен.");
              return;
            }

            arr.push({ debuffKey, stateKey });
            await this.item.update({ "system.OnHitEffects": arr });

            this.render(true);
            if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
          }
        },
        cancel: { label: "Отмена" }
      },
      default: "ok"
    }).render(true);
  }

  async _removeWeaponOnHitEffect(event) {
    event.preventDefault();
    const index = Number($(event.currentTarget).closest(".weapon-effect-row").data("index"));
    const arr = this._getWeaponOnHitEffectsArray();

    if (Number.isNaN(index) || index < 0 || index >= arr.length) return;

    arr.splice(index, 1);
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }




  async _onWeaponOnHitEffectSelectChange(event) {
    // Prevent the core submit-on-change handler from corrupting arrays
    // (it can convert system.OnHitEffects into an object with numeric keys).
    event.preventDefault();
    event.stopImmediatePropagation();

    const $el = $(event.currentTarget);
    const $row = $el.closest(".weapon-effect-row");
    const index = Number($row.data("index"));

    if (!Number.isFinite(index) || index < 0) return;

    const name = String($el.attr("name") || "");
    const isDebuff = name.includes(".debuffKey");
    const isState = name.includes(".stateKey");

    if (!isDebuff && !isState) return;

    const value = String($el.val() ?? "").trim();

    const arr = this._getWeaponOnHitEffectsArray();

    while (arr.length <= index) {
      arr.push({ debuffKey: "", stateKey: "1" });
    }

    const current = (arr[index] && typeof arr[index] === "object")
      ? arr[index]
      : { debuffKey: "", stateKey: "1" };

    if (isDebuff) current.debuffKey = value;
    if (isState) current.stateKey = value || "1";

    arr[index] = current;

    await this.item.update({ "system.OnHitEffects": arr });
  }

  async _onAddWeaponTag(event, html) {
    event.preventDefault();

    const input = html.find(".order-tag-input");
    const rawTag = String(input.val() ?? "");
    const added = await this._addWeaponTag(rawTag);
    if (!added) return;

    input.val("");
    this.render(false);
  }

  async _onAddWeaponTagFromSelect(event, html) {
    event.preventDefault();

    const select = html.find(".order-tag-select");
    const rawTag = String(select.val() ?? "");
    const added = await this._addWeaponTag(rawTag);
    if (!added) return;

    select.val("");
    this.render(false);
  }

  async _addWeaponTag(rawTag) {
    const tag = normalizeOrderTagKey(rawTag);
    if (!tag) return false;

    const tags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];
    const exists = tags.some((currentTag) => normalizeOrderTagKey(currentTag) === tag);
    if (exists) return false;

    tags.push(tag);
    await this.item.update({ "system.tags": tags });
    return true;
  }

  async _onRemoveWeaponTag(event) {
    event.preventDefault();

    const ds = event.currentTarget?.dataset ?? {};
    const tags = Array.isArray(this.item.system?.tags) ? [...this.item.system.tags] : [];

    // Preferred: index (new templates). Fallback: tag string (legacy templates).
    let idx = Number(ds.index);

    if (!Number.isFinite(idx)) {
      const tagRaw = String(ds.tag ?? ds.value ?? "").trim();
      const tag = tagRaw.toLowerCase();
      if (tag) idx = tags.findIndex(t => String(t).toLowerCase() === tag);
    }

    if (!Number.isFinite(idx) || idx < 0 || idx >= tags.length) return;

    tags.splice(idx, 1);

    await this.item.update({ "system.tags": tags });
    this.render(false);
  }
  /**
 * Rangeweapon: добавить пустую строку в system.OnHitEffects (как текстовое описание).
 * Также "нормализует" массив, если в нём вдруг лежали старые объекты.
 */
  async _addAccurateHitEffectText() {
    if (this.item.type !== "rangeweapon") return;

    const raw = Array.isArray(this.item.system.OnHitEffects)
      ? foundry.utils.duplicate(this.item.system.OnHitEffects)
      : [];

    // Нормализация на случай, если там лежат объекты старого формата
    const arr = raw.map(e => {
      if (typeof e === "string") return e;
      if (e && typeof e === "object") {
        if (e.text) return String(e.text);
        if (e.debuffKey) return `${e.debuffKey} (lvl ${e.stateKey ?? "?"})`;
        try { return JSON.stringify(e); } catch { return String(e); }
      }
      return String(e ?? "");
    });

    arr.push("");
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _removeAccurateHitEffectText(event) {
    event.preventDefault();
    //if (this.item.type !== "rangeweapon") return;

    const index = Number($(event.currentTarget).closest(".weapon-effect-row").data("index"));
    const arr = Array.isArray(this.item.system.OnHitEffects)
      ? foundry.utils.duplicate(this.item.system.OnHitEffects)
      : [];

    if (!Number.isFinite(index) || index < 0 || index >= arr.length) return;

    arr.splice(index, 1);
    await this.item.update({ "system.OnHitEffects": arr });

    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _onReloadRangeWeapon(event) {
    event.preventDefault();

    const weapon = this.item;
    const actor = weapon.parent;

    if (!actor) {
      ui.notifications.warn("Перезарядка доступна только если оружие находится на персонаже.");
      return;
    }

    const wSys = weapon.system ?? {};

    // ------------------------------
    // Heavy / Superheavy magazine tags
    // ------------------------------
    // В системе нет трекинга действий, поэтому стоимость перезарядки считаем
    // по количеству нажатий на кнопку "Перезарядить".
    const normalizeTagKeySafe = (raw) => {
      const fn = game?.OrderTags?.normalize;
      if (typeof fn === "function") return fn(raw);
      return String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    };

    const weaponHasTag = (tagKey) => {
      const tags = Array.isArray(wSys.tags) ? wSys.tags : [];
      const want = normalizeTagKeySafe(tagKey);
      return tags.some(t => normalizeTagKeySafe(t) === want);
    };

    // Приоритет: сверхтяжелый > тяжелый
    const requiredClicks = weaponHasTag("сверхтяжелый магазин")
      ? 4
      : (weaponHasTag("тяжелый магазин") ? 2 : 1);

    // Если теги сняли и теперь перезарядка обычная — чистим старый прогресс.
    if (requiredClicks === 1 && weapon.getFlag("Order", "reloadProgress") != null) {
      await weapon.unsetFlag("Order", "reloadProgress");
    }

    // Прогресс перезарядки по кликам (не сбрасывается сам по себе)
    let gateInfoHtml = "";
    if (requiredClicks > 1) {
      const current = Number(weapon.getFlag("Order", "reloadProgress") ?? 0) || 0;
      const next = Math.min(requiredClicks, current + 1);
      await weapon.setFlag("Order", "reloadProgress", next);

      if (next < requiredClicks) {
        ui.notifications.info(`Перезарядка: ${next}/${requiredClicks}. Прогресс сохранён.`);
        return;
      }

      ui.notifications.info(`Перезарядка готова: ${next}/${requiredClicks}. Выберите патроны для завершения.`);
      gateInfoHtml = `
      <div style="font-size:12px; opacity:0.9; margin-bottom:8px;">
        <strong>Магазин:</strong> ${requiredClicks === 2 ? "Тяжелый" : "Сверхтяжелый"}<br/>
        <strong>Прогресс перезарядки:</strong> ${next}/${requiredClicks}
      </div>
    `;
    }

    const magazine = Number(wSys.Magazine ?? 0) || 0;

    // Ищем расходники типа Consumables с TypeOfConsumables == "Патроны" и Quantity > 0
    const ammoItems = actor.items.filter(i => {
      if (!i) return false;
      if (i.type !== "Consumables") return false;

      const s = i.system ?? {};
      const t = String(s.TypeOfConsumables ?? "").trim();
      const Quantity = Number(s.Quantity ?? 0) || 0;

      return t === "Патроны" && Quantity > 0;
    });

    if (!ammoItems.length) {
      if (requiredClicks > 1) {
        const p = Number(weapon.getFlag("Order", "reloadProgress") ?? requiredClicks) || requiredClicks;
        ui.notifications.warn(`В инвентаре нет патронов для завершения перезарядки. Прогресс сохранён: ${p}/${requiredClicks}.`);
      } else {
        ui.notifications.warn("В инвентаре нет патронов (Consumables → Type = 'Патроны' и Quantity > 0).");
      }
      return;
    }

    const options = ammoItems
      .map((it) => {
        const Quantity = Number(it.system?.Quantity ?? 0) || 0;
        return `<option value="${it.id}">${it.name} (${Quantity})</option>`;
      })
      .join("");

    const content = `
    <form>
      ${gateInfoHtml}
      <div class="form-group">
        <label>Выбери патроны (расходник):</label>
        <select id="ammoItemId">${options}</select>
      </div>

      <div style="font-size:12px; opacity:0.8; margin-top:6px;">
        Текущее значение "Боезапас": <strong>${magazine}</strong><br/>
        При перезарядке боезапас увеличится на количество патронов в выбранном расходнике,
        а количество в расходнике станет 0.
      </div>
    </form>
  `;

    const applyReload = async (html) => {
      const ammoId = html.find("#ammoItemId").val();
      const ammo = actor.items.get(ammoId);
      if (!ammo) {
        ui.notifications.error("Не найден выбранный расходник.");
        return;
      }

      const aSys = ammo.system ?? {};
      const Quantity = Number(aSys.Quantity ?? 0) || 0;

      if (Quantity <= 0) {
        ui.notifications.warn("В выбранном расходнике нет патронов.");
        return;
      }

      // 1) Увеличиваем боезапас оружия
      const currentMag = Number(weapon.system?.Magazine ?? 0) || 0;
      const newMag = currentMag + Quantity;

      // 2) Списываем патроны (Quantity -> 0)
      await weapon.update({ "system.Magazine": newMag });
      await ammo.update({ "system.Quantity": 0 });

      // 3) Сбрасываем прогресс "тяжелых" магазинов ТОЛЬКО после завершения перезарядки
      if (requiredClicks > 1) {
        await weapon.unsetFlag("Order", "reloadProgress");
      }

      ui.notifications.info(`Перезарядка выполнена: +${Quantity} к боезапасу. "${ammo.name}" теперь 0.`);
    };

    new Dialog({
      title: `Перезарядить: ${weapon.name}`,
      content,
      buttons: {
        reload: {
          label: "Перезарядить",
          callback: applyReload
        },
        cancel: {
          label: "Отмена"
        }
      },
      default: "reload"
    }).render(true);
  }

  _getRollFormulasArray() {
    const s = this.item.system ?? this.item.data?.system ?? {};
    let rawArr = [];
    if (Array.isArray(s.RollFormulas)) {
      rawArr = s.RollFormulas;
    } else if (s.RollFormulas && typeof s.RollFormulas === "object") {
      const keys = Object.keys(s.RollFormulas)
        .filter(k => String(Number(k)) === k)
        .map(k => Number(k))
        .sort((a, b) => a - b);
      rawArr = keys.map(k => s.RollFormulas[k]);
    }

    const out = rawArr.map(v => String(v ?? ""));

    const legacy = String(s.RollFormula ?? "").trim();
    if (legacy && !out.some(v => String(v).trim() === legacy)) {
      out.unshift(legacy);
    }

    return out;
  }

  async _onRollFormulaAdd(ev) {
    ev.preventDefault();
    const arr = this._getRollFormulasArray();
    arr.push("");
    await this.item.update({ "system.RollFormulas": arr });
    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _onRollFormulaRemove(ev) {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.index);
    const arr = this._getRollFormulasArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    await this.item.update({ "system.RollFormulas": arr });
    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  async _onRollFormulaChange(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ev.stopPropagation();
    const idx = Number(ev.currentTarget.dataset.index);
    const arr = this._getRollFormulasArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= arr.length) return;
    arr[idx] = String(ev.currentTarget.value ?? "");
    await this.item.update({ "system.RollFormulas": arr });
    this.render(true);
    if (this.item.parent?.sheet) this.item.parent.sheet.render(false);
  }

  _normalizeSpellDebuffKeyAndStage(rawKey, rawStage) {
    let key = String(rawKey ?? "").trim();
    let stage = Number(rawStage ?? 1);
    if (!Number.isFinite(stage) || stage <= 0) stage = 1;

    const parsed = key.match(/^(.+?)[\s:]+(\d+)$/);
    if (parsed) {
      const keyPart = String(parsed[1] ?? "").trim();
      const stageFromKey = Number(parsed[2] ?? 1);
      if (keyPart) key = keyPart;

      const explicitStage = Number(rawStage);
      const stageWasExplicit = Number.isFinite(explicitStage) && explicitStage !== 1;
      if (!stageWasExplicit && Number.isFinite(stageFromKey) && stageFromKey > 0) {
        stage = stageFromKey;
      }
    }

    return { key, stage: Math.max(1, Math.floor(stage)) };
  }

  _getSpellEffectsArray() {
    const s = this.item.system ?? this.item.data?.system ?? {};
    let source = s.Effects;

    // Back-compat: если Effects был строкой — превращаем в один текстовый эффект
    if (typeof source === "string") {
      const txt = source.trim();
      return txt ? [{ type: "text", text: txt }] : [];
    }

    // Safety: core submit может превратить массив в объект с цифровыми ключами.
    if (!Array.isArray(source) && source && typeof source === "object") {
      source = Object.entries(source)
        .filter(([k]) => /^\d+$/.test(String(k)))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => v);
    }

    const arr = Array.isArray(source) ? foundry.utils.duplicate(source) : [];

    return arr.map((entry) => {
      if (typeof entry === "string") {
        return { type: "text", text: entry };
      }

      if (entry && typeof entry === "object") {
        const inferredType = entry?.type ?? (entry?.buffKind ? "buff" : (entry?.debuffKey ? "debuff" : "text"));
        const type = String(inferredType || "text").trim().toLowerCase();

        if (type === "debuff") {
          const norm = this._normalizeSpellDebuffKeyAndStage(entry?.debuffKey, entry?.stage);
          return { type: "debuff", debuffKey: norm.key, stage: norm.stage };
        }

        if (type === "buff") {
          const kind = String(entry?.buffKind ?? "melee-damage-hits").trim().toLowerCase() || "melee-damage-hits";
          const value = Number(entry?.value ?? 0) || 0;
          const hits = Math.max(1, Math.floor(Number(entry?.hits ?? 1) || 1));
          return { type: "buff", buffKind: kind, value, hits };
        }

        return { type: "text", text: String(entry?.text ?? "") };
      }

      return { type: "text", text: "" };
    });
  }

  async _onSpellEffectAdd(ev) {
    ev.preventDefault();
    const effects = this._getSpellEffectsArray();
    effects.push({ type: "text", text: "" });
    await this.item.update({ "system.Effects": effects });
  }

  async _onSpellEffectRemove(ev) {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.effectIndex);
    const effects = this._getSpellEffectsArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= effects.length) return;
    effects.splice(idx, 1);
    await this.item.update({ "system.Effects": effects });
  }

  async _onSpellEffectTypeChange(html, ev) {
    ev.preventDefault();
    const idx = Number(ev.currentTarget.dataset.effectIndex);
    const type = String(ev.currentTarget.value || "text");

    const effects = this._getSpellEffectsArray();
    if (Number.isNaN(idx) || idx < 0 || idx >= effects.length) return;

    // Сбрасываем поля под тип
    if (type === "text") effects[idx] = { type: "text", text: effects[idx]?.text ?? "" };
    if (type === "debuff") {
      const norm = this._normalizeSpellDebuffKeyAndStage(effects[idx]?.debuffKey, effects[idx]?.stage);
      effects[idx] = { type: "debuff", debuffKey: norm.key, stage: norm.stage };
    }
    if (type === "buff") {
      effects[idx] = { type: "buff", buffKind: "melee-damage-hits", value: 0, hits: 1 };
    }

    await this.item.update({ "system.Effects": effects });

    // Переключаем видимость инпутов без re-render (на всякий)
    const row = html.find(`.effect-row[data-effect-index="${idx}"]`);
    row.find(".effect-text").toggle(type === "text");
    row.find(".effect-debuffKey, .effect-stage").toggle(type === "debuff");
    row.find(".effect-buffKind, .effect-buffValue, .effect-buffHits").toggle(type === "buff");
  }

  async _onSpellEffectFieldChange(ev) {
    const el = ev.currentTarget;
    const cls = el.className || "";

    // 1) Надёжно получаем индекс
    let idx = Number(el.dataset.effectIndex);
    if (!Number.isFinite(idx)) {
      // если dataset вдруг не на поле — берём с родителя
      const row = el.closest?.(".effect-row");
      if (row) idx = Number(row.dataset.effectIndex);
    }
    if (!Number.isFinite(idx)) return; // без индекса нечего сохранять

    // 2) Берём актуальные эффекты (нормализованные)
    const effects = this._getSpellEffectsArray();
    if (!effects[idx]) return;

    // 3) Обновляем нужное поле
    if (cls.includes("effect-text")) {
      effects[idx].text = String(el.value ?? "");
    }

    if (cls.includes("effect-debuffKey")) {
      effects[idx].debuffKey = String(el.value ?? "");
    }

    if (cls.includes("effect-stage")) {
      const n = Number(el.value ?? 1) || 1;
      effects[idx].stage = Math.max(1, Math.min(3, Math.floor(n)));
    }

    // --- BUFF fields ---
    if (cls.includes("effect-buffKind")) {
      effects[idx].buffKind = String(el.value ?? "");
    }
    if (cls.includes("effect-buffValue")) {
      effects[idx].value = Number(el.value) || 0;
    }
    if (cls.includes("effect-buffHits")) {
      const n = Number(el.value ?? 1) || 1;
      effects[idx].hits = Math.max(1, Math.floor(n));
    }

    // 4) Сохраняем
    await this.item.update({ "system.Effects": effects });
  }

  async _onPerkBonusAdd(ev) {
    ev.preventDefault();
    const bonuses = duplicate(this.item.system.perkBonuses || []);
    bonuses.push({ target: "HealthMax", value: 0 });
    await this.item.update({ "system.perkBonuses": bonuses });
  }

  async _onPerkBonusRemove(ev) {
    ev.preventDefault();
    const index = Number(ev.currentTarget?.dataset?.index);
    if (!Number.isFinite(index)) return;
    const bonuses = duplicate(this.item.system.perkBonuses || []);
    bonuses.splice(index, 1);
    await this.item.update({ "system.perkBonuses": bonuses });
  }

  async _onPerkBonusChange(ev) {
    ev.preventDefault();
    const el = ev.currentTarget;
    const index = Number(el?.dataset?.index);
    if (!Number.isFinite(index)) return;

    const bonuses = duplicate(this.item.system.perkBonuses || []);
    bonuses[index] = bonuses[index] || { target: "HealthMax", value: 0 };

    if (el.classList.contains("perk-bonus-target")) {
      bonuses[index].target = String(el.value || "");
    } else if (el.classList.contains("perk-bonus-value")) {
      bonuses[index].value = Number(el.value) || 0;
    }

    await this.item.update({ "system.perkBonuses": bonuses });
  }


  /**
   * Training (Skills/Spells) from within the Item sheet.
   * Works only for embedded items (item is owned by an Actor).
   */
  async _onTrainItemFromSheet(ev) {
    try {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();

      const item = this.item;
      if (!item || !["Skill", "Spell"].includes(item.type)) return;

      // Perks use their own progression logic
      if (item.type === "Skill" && item.system?.isPerk) {
        ui.notifications?.warn?.("Перки тренируются по другой логике.");
        return;
      }

      // Racial skills are not trained via this mechanic
      if (item.type === "Skill" && item.system?.isRacial) {
        ui.notifications?.warn?.("Расовые навыки не тренируются через тренировку.");
        return;
      }

      const actor = item.actor || item.parent;
      if (!actor) {
        ui.notifications?.warn?.("Тренировка доступна только для предметов внутри листа персонажа (embedded item).");
        return;
      }

      const sheet = actor.sheet;
      if (sheet && typeof sheet._openItemTrainingDialog === "function") {
        sheet._openItemTrainingDialog(item);
        return;
      }

      // Fallback: open the actor sheet and retry
      try { await actor.sheet?.render?.(true); } catch (e) { }
      const sheet2 = actor.sheet;
      if (sheet2 && typeof sheet2._openItemTrainingDialog === "function") {
        sheet2._openItemTrainingDialog(item);
        return;
      }

      ui.notifications?.error?.("Не удалось запустить тренировку: обработчик не найден на листе персонажа.");
    } catch (err) {
      console.error("[Order] Train from item sheet failed", err);
      ui.notifications?.error?.("Ошибка при запуске тренировки.");
    }
  }
}
