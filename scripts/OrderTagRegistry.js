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
    // Пример: уже существующий в логике системы тег.
    // Описание пока пустое — заполним позже, когда перейдём к конкретным тегам.
    shield: {
        label: "Shield",
        description: "",
        hasLogic: true
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