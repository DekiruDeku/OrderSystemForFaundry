import { ORDER_BASE_TAGS, normalizeTagKey } from "./OrderTagRegistry.js";

/**
 * Менеджер тегов (GM)
 *
 * Редактирует централизованные описания/лейблы тегов, которые хранятся в:
 *   game.settings.get("Order", "tagDefinitions")
 *
 * В предметах оружия теги остаются строками: item.system.tags: string[]
 */
export class OrderTagManagerApp extends FormApplication {
    constructor(object = {}, options = {}) {
        super(object, options);
        this._drafts = [];
        this._pending = { byKey: {}, byRowId: {} }; // NEW
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "order-tag-manager",
            classes: ["Order", "app", "os-tagmgr"],
            title: "Менеджер тегов",
            template: "systems/Order/templates/apps/tag-manager.hbs",
            width: 900,
            height: 650,
            minWidth: 760,
            minHeight: 520,
            resizable: true,
            closeOnSubmit: false
        });
    }

    async getData() {
        const isGM = Boolean(game.user?.isGM);
        const world = (game.settings.get("Order", "tagDefinitions") ?? {});

        // Merged: base tags + world tags/overrides
        const merged = (game.OrderTags?.getAll?.() ?? {});

        const rows = Object.entries(merged)
            .map(([keyRaw, def]) => {
                const key = normalizeTagKey(keyRaw);
                const base = ORDER_BASE_TAGS?.[key];
                const isBase = Boolean(base);
                const hasLogic = Boolean(base?.hasLogic);
                const isOverride = Object.prototype.hasOwnProperty.call(world, key);

                return {
                    id: key, // stable id for existing
                    key,
                    label: String(def?.label ?? key),
                    description: String(def?.description ?? ""),
                    isBase,
                    hasLogic,
                    isOverride,
                    isNew: false
                };
            })
            .sort((a, b) => a.key.localeCompare(b.key, "ru"));

        // Draft rows (not saved yet)
        for (const d of this._drafts) {
            rows.push({
                id: d.id,
                key: d.key ?? "",
                label: d.label ?? "",
                description: d.description ?? "",
                isBase: false,
                hasLogic: false,
                isOverride: false,
                isNew: true
            });
        }
        const pendingByKey = this._pending?.byKey ?? {};
        const pendingByRowId = this._pending?.byRowId ?? {};

        for (const r of rows) {
            if (r.isNew) {
                const p = pendingByRowId[r.id];
                if (!p) continue;
                if (typeof p.key === "string") r.key = p.key;
                if (typeof p.label === "string") r.label = p.label;
                if (typeof p.description === "string") r.description = p.description;
            } else {
                const p = pendingByKey[r.key];
                if (!p) continue;
                if (typeof p.label === "string") r.label = p.label;
                if (typeof p.description === "string") r.description = p.description;
            }
        }

        return {
            isGM,
            tags: rows
        };
    }

    activateListeners(html) {
        super.activateListeners(html);


        html.find(".tagmgr-add").on("click", (ev) => {
            ev.preventDefault();
            this._stashFormState(html); // NEW: сохраняем введённые значения
            this._drafts.push({ id: foundry.utils.randomID(), key: "", label: "", description: "" });
            this.render(false);
        });

        html.find(".tagmgr-delete").on("click", async (ev) => {
            ev.preventDefault();
            this._stashFormState(html); // NEW
            const btn = ev.currentTarget;
            const key = String(btn?.dataset?.key ?? "").trim();
            const rowId = String(btn?.dataset?.rowId ?? "").trim();

            // Existing tag in registry (world entry): remove from settings
            if (key) {
                await game.OrderTags?.remove?.(key);
                this.render(false);
                return;
            }

            // Draft row: remove locally
            if (rowId) {
                this._drafts = this._drafts.filter(d => d.id !== rowId);
                this.render(false);
            }
        });

        html.find(".tagmgr-reset").on("click", async (ev) => {
            ev.preventDefault();
            this._stashFormState(html); // NEW
            const key = String(ev.currentTarget?.dataset?.key ?? "").trim();
            if (!key) return;
            await game.OrderTags?.remove?.(key);
            this.render(false);
        });

        // Normalize key on blur (draft rows only)
        html.find(".tagmgr-key-input").on("blur", (ev) => {
            const el = ev.currentTarget;
            if (!el) return;
            if (el.disabled || el.readOnly) return;
            const v = String(el.value ?? "");
            el.value = normalizeTagKey(v);
        });

        // Client-side search filter (no rerender)
        const search = html.find(".tagmgr-search");
        search.on("input", () => {
            const q = String(search.val() ?? "").trim().toLowerCase();
            const rows = html.find(".tagmgr-row");

            rows.each((_, row) => {
                const s = String(row?.dataset?.search ?? "").toLowerCase();
                row.style.display = (!q || s.includes(q)) ? "" : "none";
            });
        });
    }

    _stashFormState(html) {
        if (!html) return;

        const byKey = {};
        const byRowId = {};

        html.find(".tagmgr-row").each((_, rowEl) => {
            const row = $(rowEl);
            const rowId = String(row.data("rowId") ?? "").trim();

            // key: сначала hidden (самый надёжный), потом обычные
            const keyHidden = row.find('input[type="hidden"][name$=".key"]');
            const keyNamed = row.find('input[name$=".key"]');
            const keyVisual = row.find(".tagmgr-key-input");

            const keyRaw =
                (keyHidden.length ? keyHidden.val() : "") ||
                (keyNamed.length ? keyNamed.val() : "") ||
                (keyVisual.length ? keyVisual.val() : "");

            const key = normalizeTagKey(keyRaw);

            const label = String(row.find('input[name$=".label"]').val() ?? "");
            const description = String(row.find('textarea[name$=".description"]').val() ?? "");

            if (rowId) {
                byRowId[rowId] = { key, label, description };
            }
            if (key) {
                byKey[key] = { label, description };
            }
        });

        this._pending = { byKey, byRowId };

        // синхронизируем черновики (draft rows), чтобы их key/label/desc не терялись
        for (const d of this._drafts) {
            const p = byRowId[d.id];
            if (!p) continue;
            d.key = p.key ?? d.key;
            d.label = p.label ?? d.label;
            d.description = p.description ?? d.description;
        }
    }

    async _updateObject(event, formData) {
        event?.preventDefault();

        if (!game.user?.isGM) {
            ui.notifications?.warn?.("Только GM может редактировать теги.");
            return;
        }

        const data = foundry.utils.expandObject(formData ?? {});
        const rowsObj = data?.tags && typeof data.tags === "object" ? data.tags : {};
        const rows = Object.values(rowsObj);

        // Берём текущие world settings и правим их, а не заменяем целиком
        const currentWorld = (game.settings.get("Order", "tagDefinitions") ?? {});
        const nextWorld = foundry.utils.deepClone(currentWorld);

        const seen = new Set();
        let hadDup = false;
        let keysCount = 0;

        for (const r of rows) {
            const key = normalizeTagKey(r?.key);
            if (!key) continue;

            keysCount++;
            if (seen.has(key)) hadDup = true;
            seen.add(key);

            const labelRaw = String(r?.label ?? "");
            const labelTrim = labelRaw.trim();
            const description = String(r?.description ?? "");

            const base = ORDER_BASE_TAGS?.[key];

            if (base) {
                const baseLabel = String(base?.label ?? key);
                const baseDesc = String(base?.description ?? "");

                const effectiveLabel = labelTrim || baseLabel;

                const overrideLabel = effectiveLabel !== baseLabel;
                const overrideDesc = description !== baseDesc;

                if (overrideLabel || overrideDesc) {
                    // сохраняем override (и только отличающиеся поля)
                    nextWorld[key] = {
                        ...(overrideLabel ? { label: effectiveLabel } : {}),
                        ...(overrideDesc ? { description } : {})
                    };
                } else {
                    // если совпало с базой — удаляем override
                    if (Object.prototype.hasOwnProperty.call(nextWorld, key)) delete nextWorld[key];
                }
            } else {
                // Custom tags: если label пустой — используем key
                const effectiveLabel = labelTrim || key;
                nextWorld[key] = { label: effectiveLabel, description };
            }
        }

        // если вдруг форма пришла вообще без ключей — НИЧЕГО не перезаписываем
        if (keysCount === 0) {
            ui.notifications?.error?.("Не удалось прочитать форму тегов (ключи отсутствуют). Ничего не сохранено.");
            return;
        }

        await game.settings.set("Order", "tagDefinitions", nextWorld);

        if (hadDup) ui.notifications?.warn?.("Были дубли ключей — сохранён последний вариант для каждого ключа.");
        else ui.notifications?.info?.("Теги сохранены.");

        this._drafts = [];
        this._pending = { byKey: {}, byRowId: {} }; // очистили черновик
        this.render(false);
    }
}