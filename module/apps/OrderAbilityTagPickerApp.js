/* === Foundry VTT v13/v14 AppV1 compatibility === */
const FormApplication = foundry.appv1?.api?.FormApplication ?? globalThis.FormApplication;

const DEFAULT_COLOR = "#38b9e9";
const DEFAULT_ICON = "fas fa-tag";

const SYSTEM_SVG_ICON_OPTIONS = [
  // Характеристики
  ["systems/Order/icons/tag-icons/characteristics/strength.svg", "Характеристика — Сила"],
  ["systems/Order/icons/tag-icons/characteristics/agility.svg", "Характеристика — Ловкость"],
  ["systems/Order/icons/tag-icons/characteristics/endurance.svg", "Характеристика — Выносливость"],
  ["systems/Order/icons/tag-icons/characteristics/accuracy.svg", "Характеристика — Меткость"],
  ["systems/Order/icons/tag-icons/characteristics/willpower.svg", "Характеристика — Стойкость духа"],
  ["systems/Order/icons/tag-icons/characteristics/knowledge.svg", "Характеристика — Знание"],
  ["systems/Order/icons/tag-icons/characteristics/charisma.svg", "Характеристика — Харизма"],
  ["systems/Order/icons/tag-icons/characteristics/seduction.svg", "Характеристика — Обольщение"],
  ["systems/Order/icons/tag-icons/characteristics/leadership.svg", "Характеристика — Лидерство"],
  ["systems/Order/icons/tag-icons/characteristics/faith.svg", "Характеристика — Вера"],
  ["systems/Order/icons/tag-icons/characteristics/medicine.svg", "Характеристика — Медицина"],
  ["systems/Order/icons/tag-icons/characteristics/magic.svg", "Характеристика — Магия"],
  ["systems/Order/icons/tag-icons/characteristics/stealth.svg", "Характеристика — Скрытность"],

  // Общие игровые значки
  ["systems/Order/icons/tag-icons/common/stealth.svg", "Общее — Скрытность"],
  ["systems/Order/icons/tag-icons/common/immunity.svg", "Общее — Иммунитет"],
  ["systems/Order/icons/tag-icons/common/knockback.svg", "Общее — Отбрасывание"],
  ["systems/Order/icons/tag-icons/common/resistance.svg", "Общее — Сопротивление"],
  ["systems/Order/icons/tag-icons/common/line-attack.svg", "Общее — Линейная атака"],
  ["systems/Order/icons/tag-icons/common/melee.svg", "Общее — Ближний бой"],
  ["systems/Order/icons/tag-icons/common/flight.svg", "Общее — Полёт"],
  ["systems/Order/icons/tag-icons/common/initiative.svg", "Общее — Инициатива"],
  ["systems/Order/icons/tag-icons/common/cone-attack.svg", "Общее — Конусная атака"],
  ["systems/Order/icons/tag-icons/common/cleave.svg", "Общее — Рассекающий удар"],
  ["systems/Order/icons/tag-icons/common/ranged.svg", "Общее — Дальний бой"],
  ["systems/Order/icons/tag-icons/common/tracking.svg", "Общее — Выслеживание"],
  ["systems/Order/icons/tag-icons/common/restrain.svg", "Общее — Сковывание"],
  ["systems/Order/icons/tag-icons/common/transformation.svg", "Общее — Трансформация"],
  ["systems/Order/icons/tag-icons/common/critical.svg", "Общее — Критический удар"],
  ["systems/Order/icons/tag-icons/common/cover.svg", "Общее — Укрытие"],
  ["systems/Order/icons/tag-icons/common/restore.svg", "Общее — Восстановление"],
  ["systems/Order/icons/tag-icons/common/disarm.svg", "Общее — Разоружение"],
  ["systems/Order/icons/tag-icons/common/heavy-attack.svg", "Общее — Тяжёлая атака"],
  ["systems/Order/icons/tag-icons/common/precision.svg", "Общее — Точность"],
  ["systems/Order/icons/tag-icons/common/teleport.svg", "Общее — Телепортация"],
  ["systems/Order/icons/tag-icons/common/knockdown.svg", "Общее — Сбивание с ног"],
  ["systems/Order/icons/tag-icons/common/piercing.svg", "Общее — Пронзание"],
  ["systems/Order/icons/tag-icons/common/sacrifice.svg", "Общее — Жертва"],
  ["systems/Order/icons/tag-icons/common/detection.svg", "Общее — Обнаружение"],
  ["systems/Order/icons/tag-icons/common/rapid-attack.svg", "Общее — Быстрая атака"],
  ["systems/Order/icons/tag-icons/common/guard-break.svg", "Общее — Пробитие защиты"],
  ["systems/Order/icons/tag-icons/common/area-attack.svg", "Общее — Атака по области"],
  ["systems/Order/icons/tag-icons/common/drain.svg", "Общее — Поглощение"],
  ["systems/Order/icons/tag-icons/common/jump.svg", "Общее — Прыжок"],
  ["systems/Order/icons/tag-icons/common/mobility.svg", "Общее — Мобильность"],
  ["systems/Order/icons/tag-icons/common/summon.svg", "Общее — Призыв"],
  ["systems/Order/icons/tag-icons/common/execute.svg", "Общее — Добивание"],
  ["systems/Order/icons/tag-icons/common/stagger.svg", "Общее — Ошеломление"],
  ["systems/Order/icons/tag-icons/common/counterattack.svg", "Общее — Контратака"],
  ["systems/Order/icons/tag-icons/common/grab.svg", "Общее — Захват"],
  ["systems/Order/icons/tag-icons/common/debuff.svg", "Общее — Ослабление"],
  ["systems/Order/icons/tag-icons/common/buff.svg", "Общее — Усиление"],
  ["systems/Order/icons/tag-icons/common/vulnerability.svg", "Общее — Уязвимость"],
  ["systems/Order/icons/tag-icons/common/dash.svg", "Общее — Рывок"],

  // Действия и длительности
  ["systems/Order/icons/tag-icons/actions/main-action.svg", "Действие — Основное действие"],
  ["systems/Order/icons/tag-icons/actions/charge.svg", "Действие — Зарядка"],
  ["systems/Order/icons/tag-icons/actions/cooldown.svg", "Действие — Перезарядка"],
  ["systems/Order/icons/tag-icons/actions/bonus-action.svg", "Действие — Бонусное действие"],
  ["systems/Order/icons/tag-icons/actions/channeling.svg", "Действие — Каналирование"],
  ["systems/Order/icons/tag-icons/actions/concentration.svg", "Действие — Концентрация"],
  ["systems/Order/icons/tag-icons/actions/reaction.svg", "Действие — Реакция"],
  ["systems/Order/icons/tag-icons/actions/duration.svg", "Действие — Длительность"],
  ["systems/Order/icons/tag-icons/actions/interrupt.svg", "Действие — Прерывание"],
  ["systems/Order/icons/tag-icons/actions/instant-action.svg", "Действие — Мгновенное действие"]
].map(([value, label]) => ({ value, label }));

function isSvgIcon(icon) {
  return String(icon ?? "").startsWith("systems/Order/icons/tag-icons/") && String(icon).toLowerCase().endsWith(".svg");
}

function normalizeKey(raw) {
  const fn = game?.OrderTags?.normalize;
  if (typeof fn === "function") return fn(raw);
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeColor(raw) {
  const fn = game?.OrderTags?.normalizeColor;
  if (typeof fn === "function") return fn(raw);
  const value = String(raw ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
}

function normalizeIcon(raw) {
  const fn = game?.OrderTags?.normalizeIcon;
  if (typeof fn === "function") return fn(raw);
  if (raw === undefined || raw === null) return DEFAULT_ICON;
  return String(raw).trim();
}

function clampRgb(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n));
}

function hexToRgb(hex) {
  const value = normalizeColor(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clampRgb(v).toString(16).padStart(2, "0")).join("")}`;
}

export class OrderAbilityTagPickerApp extends FormApplication {
  constructor(item, options = {}) {
    super(item, {
      ...options,
      id: options.id || `order-ability-tag-picker-${item?.id || foundry.utils.randomID()}`
    });
    this.item = item;
    this._search = "";
    this._createOpen = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["Order", "app", "os-ability-tag-picker"],
      title: "Теги способности / заклинания",
      template: "systems/Order/templates/apps/ability-tag-picker.hbs",
      width: 570,
      height: 680,
      minWidth: 500,
      minHeight: 500,
      resizable: true,
      closeOnSubmit: false,
      submitOnChange: false,
      scrollY: [".ability-tag-picker-list"]
    });
  }

  getData() {
    const selectedKeys = Array.from(new Set(
      (Array.isArray(this.item?.system?.tags) ? this.item.system.tags : [])
        .map(normalizeKey)
        .filter(Boolean)
    ));
    const selectedSet = new Set(selectedKeys);
    const defs = game?.OrderTags?.getAll?.() ?? {};

    // Keep legacy/unknown keys removable even when they do not yet exist in the catalogue.
    const merged = { ...defs };
    for (const key of selectedKeys) {
      if (!merged[key]) {
        merged[key] = { label: key, description: "", color: DEFAULT_COLOR, icon: DEFAULT_ICON };
      }
    }

    const tags = Object.entries(merged)
      .map(([rawKey, rawDef]) => {
        const key = normalizeKey(rawKey);
        const def = rawDef && typeof rawDef === "object" ? rawDef : {};
        return {
          key,
          label: String(def.label ?? key),
          description: String(def.description ?? ""),
          color: normalizeColor(def.color),
          icon: normalizeIcon(def.icon),
          selected: selectedSet.has(key),
          search: `${key} ${String(def.label ?? "")} ${String(def.description ?? "")}`.toLowerCase()
        };
      })
      .filter((entry) => entry.key)
      .sort((a, b) => {
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        return a.label.localeCompare(b.label, "ru", { sensitivity: "base" });
      });

    const rgb = hexToRgb(DEFAULT_COLOR);
    return {
      itemName: this.item?.name ?? "",
      tags,
      selectedCount: selectedKeys.length,
      search: this._search,
      createOpen: this._createOpen,
      canCreate: !!game.user?.isGM,
      defaultColor: DEFAULT_COLOR,
      rgb,
      iconOptions: [
        { value: "", label: "Без значка" },
        { value: "fas fa-tag", label: "Тег" },
        { value: "fas fa-bolt", label: "Молния" },
        { value: "fas fa-magic", label: "Магия" },
        { value: "fas fa-fire", label: "Огонь" },
        { value: "fas fa-shield-alt", label: "Защита" },
        { value: "fas fa-crosshairs", label: "Атака" },
        { value: "fas fa-heart", label: "Лечение" },
        { value: "fas fa-skull", label: "Смерть / яд" },
        { value: "fas fa-star", label: "Особое" },
        { value: "fas fa-eye", label: "Восприятие" },
        { value: "fas fa-brain", label: "Разум" },
        { value: "fas fa-running", label: "Движение" },
        { value: "fas fa-lock", label: "Контроль" },
        { value: "fas fa-hand-sparkles", label: "Эффект" },
        ...SYSTEM_SVG_ICON_OPTIONS
      ]
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const search = html.find(".ability-tag-picker-search");
    search.on("input", () => {
      this._search = String(search.val() ?? "").trim().toLowerCase();
      this._applySearch(html);
    });
    this._applySearch(html);

    html.find(".ability-tag-picker-toggle-create").on("click", (event) => {
      event.preventDefault();
      this._createOpen = !this._createOpen;
      html.find(".ability-tag-create").toggleClass("is-open", this._createOpen);
      $(event.currentTarget).toggleClass("active", this._createOpen);
      if (this._createOpen) html.find(".ability-tag-create-name").trigger("focus");
    });

    html.find(".ability-tag-picker-action").on("click", async (event) => {
      event.preventDefault();
      const key = normalizeKey(event.currentTarget?.dataset?.tagKey);
      if (!key) return;
      const selected = event.currentTarget?.dataset?.selected === "true";
      await this._setTagSelected(key, !selected);
      this.render(false);
    });

    const colorInput = html.find(".ability-tag-create-color");
    const rInput = html.find(".ability-tag-r");
    const gInput = html.find(".ability-tag-g");
    const bInput = html.find(".ability-tag-b");
    const preview = html.find(".ability-tag-create-preview");

    const syncFromHex = () => {
      const color = normalizeColor(colorInput.val());
      const rgb = hexToRgb(color);
      rInput.val(rgb.r);
      gInput.val(rgb.g);
      bInput.val(rgb.b);
      preview.css("--tag-color", color);
    };
    const syncFromRgb = () => {
      const color = rgbToHex(rInput.val(), gInput.val(), bInput.val());
      colorInput.val(color);
      preview.css("--tag-color", color);
    };
    colorInput.on("input change", syncFromHex);
    rInput.add(gInput).add(bInput).on("input change", syncFromRgb);

    html.find(".ability-tag-create-icon").on("change", (event) => {
      const icon = normalizeIcon(event.currentTarget.value);
      const iconEl = preview.find("i");
      const svgEl = preview.find(".ability-tag-svg-icon");
      if (isSvgIcon(icon)) {
        iconEl.attr("class", "").hide();
        svgEl.attr("src", icon).show();
      } else {
        svgEl.hide().attr("src", "");
        if (icon) iconEl.attr("class", icon).show();
        else iconEl.attr("class", "").hide();
      }
    });

    html.find(".ability-tag-create-submit").on("click", async (event) => {
      event.preventDefault();
      await this._createTag(html);
    });

    html.find(".ability-tag-create-name").on("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      await this._createTag(html);
    });
  }

  _applySearch(html) {
    const query = String(this._search ?? "").trim().toLowerCase();
    html.find(".ability-tag-picker-row").each((_, row) => {
      const haystack = String(row?.dataset?.search ?? "").toLowerCase();
      row.style.display = (!query || haystack.includes(query)) ? "" : "none";
    });
  }

  async _setTagSelected(tagKey, shouldSelect) {
    const key = normalizeKey(tagKey);
    if (!key) return;

    const current = Array.from(new Set(
      (Array.isArray(this.item?.system?.tags) ? this.item.system.tags : [])
        .map(normalizeKey)
        .filter(Boolean)
    ));
    const set = new Set(current);
    if (shouldSelect) set.add(key);
    else set.delete(key);

    await this.item.update({ "system.tags": Array.from(set) });
  }

  async _createTag(html) {
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Создание общего тега доступно только GM. Уже существующие теги можно добавлять всем владельцам предмета.");
      return;
    }

    const label = String(html.find(".ability-tag-create-name").val() ?? "").trim();
    const key = normalizeKey(label);
    if (!key) {
      ui.notifications?.warn?.("Введите название тега.");
      return;
    }

    if (game?.OrderTags?.getOne?.(key)) {
      ui.notifications?.warn?.("Тег с таким названием уже существует. Он добавлен к предмету.");
      await this._setTagSelected(key, true);
      this.render(false);
      return;
    }

    const color = normalizeColor(html.find(".ability-tag-create-color").val());
    const rawIcon = String(html.find(".ability-tag-create-icon").val() ?? "").trim();
    const icon = rawIcon ? normalizeIcon(rawIcon) : "";

    const created = await game?.OrderTags?.upsert?.(key, {
      label,
      color,
      icon,
      description: ""
    });
    if (!created) return;

    await this._setTagSelected(key, true);
    ui.notifications?.info?.(`Тег «${label}» создан и добавлен.`);
    this._createOpen = false;
    this.render(false);
  }

  async _updateObject() {
    // Changes are applied immediately by explicit buttons.
  }
}
