/**
 * Order Tag Registry (Foundry VTT v11)
 *
 * Идея:
 * - Items хранят только строки тегов (system.tags: string[])
 * - Метаданные тегов (label/description) лежат централизованно: в коде системы + в game.settings (world)
 * - Так игроки/ГМ могут добавлять новые теги и задавать им описания без правок каждого предмета.
 */

/**
 * Базовые теги системы.
 *
 * ВАЖНО:
 * - Ключи должны быть нормализованы (см. normalizeTagKey)
 * - Только базовые теги (зашитые тут) в будущем могут иметь «кодовую» логику
 * - Новые базовые теги можно безопасно добавлять позже — они подхватятся автоматически
 */
export const ORDER_BASE_TAGS = {
    // --- Блок/щиты ---
    shield: {
        label: "Щит",
        description:
            "Если у бойца экипирован этот щит, он способен использовать БЛОК против всех видов атак, как в ближнем, так и в дальнем бою. Такой блок может кидаться либо от Силы, либо от Выносливости.",
        hasLogic: true
    },

    "веский аргумент": {
        label: "Веский аргумент",
        description:
            "Успешный удар щитом на натуральный d20 19–20 может наложить 1 очко оглушения на цель. Цель должна пройти проверку на Выносливость против 8 + (Сила владельца щита: значение + модификатор). В случае провала получает оглушение.",
        hasLogic: true
    },

    // --- Общее (описательные) ---
    "парное": {
        label: "Парное",
        description:
            "При наличии определенного навыка боец может использовать это оружие в качестве парного."
    },

    "быстрое": {
        label: "Быстрое",
        description:
            "Этим оружием можно атаковать при помощи бонусного действия."
    },

    "технические ограничения скорострельности": {
        label: "Технические ограничения скорострельности",
        description:
            "За ход оружие не способно совершить больше одного выстрела, даже если какой-то перк на это мог бы повлиять."
    },

    "часть чего-то большего": {
        label: "Часть чего-то большего",
        description:
            "Вас не покидает чувство, что для раскрытия этого оружия нужно что-то ещё..."
    },

    "массовая атака": {
        label: "Массовая атака",
        description:
            "Позволяет выполнять массовую атаку этим оружием через шаблон области (AoE).",
        hasLogic: true
    },

    // --- Дальний бой ---
    "тесное знакомство": {
        label: "Тесное знакомство",
        description:
            "Стрельба в ближнем бою не накладывает помеху, однако противник сможет использовать блок.",
        hasLogic: true
    },

    "тяжелый магазин": {
        label: "Тяжелый магазин",
        description:
            "Перезарядка оружия занимает 2 бонусных действия.",
        hasLogic: true
    },

    "сверхтяжелый магазин": {
        label: "Сверхтяжелый магазин",
        description:
            "Перезарядка оружия занимает 4 бонусных действия, которые не обязательно совершать последовательно.",
        hasLogic: true
    },

    "дальнозоркость": {
        label: "Дальнозоркость",
        description:
            "При стрельбе на дистанции от 1 до 3х клеток стрелок получает дополнительно -3 к атаке."
    },

    "крупный калибр": {
        label: "Крупный калибр",
        description:
            "Автоматическая стрельба накладывает -3 вместо -1 на меткость за каждую пулю после первой.",
        hasLogic: true
    },

    "оглушающий разряд": {
        label: "Оглушающий разряд",
        description:
            "Попадание смирителем по среднестатистическому противнику не заставляет его получать эффект от урона, но заставляет пройти проверку на Выносливость: 10+ чтобы не потерять сознание, 14+ чтобы не получить 1 очко ошеломления. Против целей в броне эффективность падает: нужно выкинуть 6+ чтобы не потерять сознание и 10+ чтобы не получить 1 очко ошеломления. Успешное попадание по среднестатистическому гражданскому гарантированно выводит его из боя.",
        hasLogic: true
    },

    // --- Ближний бой / броня ---
    "пронзание": {
        label: "Пронзание",
        description:
            "Атака этим оружием игнорирует 10 единиц брони.",
        hasLogic: true
    },

    "удар в сочленение": {
        label: "Удар в сочленение",
        description:
            "При атаке основным действием этим оружием вы игнорируете 10 брони противника."
    },

    "древковое": {
        label: "Древковое",
        description:
            "Дальность вашей атаки равна двум клеткам, но все еще считается как рукопашная атака."
    },

    // --- Порог по натуральному d20 → дебаффы (пока только описания; автоматику подключим позже) ---
    "заточенный клинок": {
        label: "Заточенный клинок",
        description:
            "Успешные атаки на натуральный d20 20 накладывают на противника 1 очко кровотечения."
    },

    "бритвенная острота": {
        label: "Бритвенная острота",
        description:
            "Успешные атаки на натуральный d20 19–20 накладывают на противника 1 очко кровотечения."
    },

    "невероятная острота": {
        label: "Невероятная острота",
        description:
            "Успешные атаки на натуральный d20 18–20 накладывают на противника 1 очко кровотечения."
    },

    "зловещая острота": {
        label: "Зловещая острота",
        description:
            "Успешные атаки на натуральный d20 20 накладывают на противника 2 очка кровотечения."
    },

    "тяжелый клинок": {
        label: "Тяжелый клинок",
        description:
            "Успешные атаки на натуральный d20 20 накладывают на противника 1 очко травмы конечности."
    },

    "крушащий клинок": {
        label: "Крушащий клинок",
        description:
            "Успешные атаки на натуральный d20 19–20 накладывают на противника 1 очко травмы конечности."
    },

    "b1g-boy": {
        label: "B1G-BOY",
        description:
            "Успешные атаки на натуральный d20 18–20 накладывают на противника 1 очко травмы конечности."
    },

    "идеальный баланс": {
        label: "Идеальный баланс",
        description:
            "Атаки через ловкость сопровождаются эффектом “Заточенный клинок”, атаки через силу сопровождаются эффектом “Тяжелый клинок”."
    },

    "г-образный взмах": {
        label: "Г-образный взмах",
        description:
            "Перед ударом выберите 3 клетки в форме буквы Г в радиусе досягаемости вашего оружия. Атака этим оружием бьет сразу по всем целям, находящимся в этих трех клетках."
    },

    // --- Особые/магические ---
    "tough-guy": {
        label: "TOUGH-GUY",
        description:
            "Каждые +3 к силе = +10 к урону этого ножа."
    },

    "податливый манапроводник": {
        label: "Податливый манапроводник",
        description:
            "Любые заклинания зарядки, накладываемые на это оружие хозяином клинка, держатся на 2 хода дольше."
    },

    "белая молния": {
        label: "Белая молния",
        description:
            "Если скальпель был выбит из руки владельца или же он осознанно был брошен, хозяин может в любой момент бонусным действием вернуть скальпель себе в руку, если он находится на дистанции 3 + Магия клеток."
    }
};

/**
 * Нормализация ключа тега для стабильного поиска.
 * НЕ используем slugify (чтобы не ломать кириллицу).
 *
 * Правила:
 * - trim
 * - lowercase
 * - схлопываем множественные пробелы
 */
export function normalizeTagKey(raw) {
    return String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

/**
 * Регистрируем настройки мира (world settings) под описания/лейблы тегов.
 * Структура в settings:
 *   {
 *     [normalizedKey]: { label?: string, description?: string }
 *   }
 */
export function registerOrderTagRegistry() {
    // World overrides / кастомные теги.
    // config:false специально — позже сделаем красивый UI-редактор.
    game.settings.register("Order", "tagDefinitions", {
        name: "Order: Tag Definitions",
        hint: "Internal storage for tag labels and descriptions.",
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // Версия (на будущее для миграций формата).
    game.settings.register("Order", "tagDefinitionsVersion", {
        name: "Order: Tag Definitions Version",
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    // Публичный API для других модулей/шаблонов/консоли.
    // Пример:
    //   const desc = game.OrderTags.getDescription("shield");
    //   await game.OrderTags.upsert("яд", { description: "..." });
    game.OrderTags = {
        normalize: normalizeTagKey,
        getAll: getOrderTagDefinitions,
        getOne: getOrderTagDefinition,
        getDescription: getOrderTagDescription,
        upsert: upsertOrderTagDefinition,
        remove: removeOrderTagDefinition
    };

    // Handlebars helpers (пригодятся для тултипов в листе персонажа/карточках)
    // Использование:
    //   <span data-tooltip="{{orderTagDescription tag}}">{{tag}}</span>
    Handlebars.registerHelper("orderTagDescription", function (tagKey) {
        return getOrderTagDescription(tagKey);
    });

    Handlebars.registerHelper("orderTagLabel", function (tagKey) {
        const def = getOrderTagDefinition(tagKey);
        return def?.label || String(tagKey ?? "");
    });
}

function getWorldTagDefinitions() {
    const raw = game.settings.get("Order", "tagDefinitions");
    return raw && typeof raw === "object" ? raw : {};
}

/**
 * Слить базу системы + world overrides.
 * - world может переопределять label/description базовых тегов
 * - world может добавлять новые теги (без hasLogic)
 */
export function getOrderTagDefinitions() {
    const world = getWorldTagDefinitions();

    // база
    const merged = foundry.utils.deepClone(ORDER_BASE_TAGS);

    // overrides/additions
    for (const [rawKey, rawDef] of Object.entries(world)) {
        const key = normalizeTagKey(rawKey);
        if (!key) continue;

        const def = rawDef && typeof rawDef === "object" ? rawDef : {};
        const baseHasLogic = Boolean(merged?.[key]?.hasLogic);

        merged[key] = {
            label: (typeof def.label === "string" && def.label.trim() !== "")
                ? def.label
                : (merged?.[key]?.label ?? key),
            description: typeof def.description === "string" ? def.description : (merged?.[key]?.description ?? ""),
            // hasLogic НЕ разрешаем включать из settings (только базовые теги системы могут иметь логику)
            hasLogic: baseHasLogic
        };
    }

    return merged;
}

export function getOrderTagDefinition(tagKey) {
    const key = normalizeTagKey(tagKey);
    if (!key) return null;

    const defs = getOrderTagDefinitions();
    const def = defs?.[key];
    if (!def) return null;

    const isBase = Boolean(ORDER_BASE_TAGS?.[key]);

    return {
        key,
        label: def.label ?? key,
        description: def.description ?? "",
        hasLogic: Boolean(def.hasLogic) && isBase,
        isBase
    };
}

export function getOrderTagDescription(tagKey) {
    return getOrderTagDefinition(tagKey)?.description ?? "";
}

/**
 * Добавить/обновить описание/лейбл тега в world settings.
 * - Работает и для базовых тегов (как override)
 * - Работает для кастомных тегов
 */
export async function upsertOrderTagDefinition(tagKey, partial) {
    if (!game.user?.isGM) {
        ui.notifications?.warn?.("Только GM может редактировать описания тегов.");
        return;
    }

    const key = normalizeTagKey(tagKey);
    if (!key) return;

    const current = getWorldTagDefinitions();
    const next = foundry.utils.deepClone(current);

    const prev = next[key] && typeof next[key] === "object" ? next[key] : {};
    const patch = partial && typeof partial === "object" ? partial : {};

    next[key] = {
        ...prev,
        ...(typeof patch.label === "string" ? { label: patch.label } : {}),
        ...(typeof patch.description === "string" ? { description: patch.description } : {})
    };

    await game.settings.set("Order", "tagDefinitions", next);
}

/**
 * Удалить world-override.
 * - Для базового тега: вернётся к дефолту системы
 * - Для кастомного: полностью исчезнет из registry
 */
export async function removeOrderTagDefinition(tagKey) {
    if (!game.user?.isGM) {
        ui.notifications?.warn?.("Только GM может удалять описания тегов.");
        return;
    }

    const key = normalizeTagKey(tagKey);
    if (!key) return;

    const current = getWorldTagDefinitions();
    if (!Object.prototype.hasOwnProperty.call(current, key)) return;

    const next = foundry.utils.deepClone(current);
    delete next[key];

    await game.settings.set("Order", "tagDefinitions", next);
}
