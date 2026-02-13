const HUD_ID = "order-debuff-hud";
let sidebarObserver = null;
let sidebarResizeObserver = null;

const getSidebarBounds = () => {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return null;
    return sidebar.getBoundingClientRect();
};

const updateHudPosition = (hud = null) => {
    const resolvedHud =
        (hud instanceof HTMLElement) ? hud : document.getElementById(HUD_ID);

    if (!resolvedHud) return;

    const sidebarBounds = getSidebarBounds();

    if (!sidebarBounds) {
        resolvedHud.style.right = "10px";
        return;
    }

    const rightOffset = Math.max(10, window.innerWidth - sidebarBounds.left + 10);
    resolvedHud.style.right = `${rightOffset}px`;
};

const getControlledToken = () => {
    const controlled = Array.from(canvas?.tokens?.controlled || []);
    return controlled[0] || null;
};

const getDebuffEffects = (actor) => {
    if (!actor?.effects) return [];
    return actor.effects.filter(effect => effect.getFlag("Order", "debuffKey"));
};

const fetchDebuffData = async () => {
    try {
        const response = await fetch("systems/Order/module/debuffs.json");
        if (!response.ok) throw new Error("Failed to load debuffs.json");
        return await response.json();
    } catch (error) {
        console.error(error);
        return null;
    }
};

const buildTooltipContent = (effect) => {
    const description = effect?.flags?.description || "";
    const level = Number(effect.getFlag("Order", "stateKey")) || 1;
    const levelText = `Уровень: ${level}`;

    if (!description) {
        return `${effect.label}\n${levelText}`;
    }

    return `${effect.label}\n${levelText}\n${description}`;
};

const updateDebuffEffectLevel = async (effect, delta) => {
    const actor = effect?.parent;
    if (!actor) return;

    const debuffKey = effect.getFlag("Order", "debuffKey");
    if (!debuffKey) return;

    const systemStates = await fetchDebuffData();
    if (!systemStates) return;

    const debuff = systemStates[debuffKey];
    if (!debuff) return;

    const maxState = Object.keys(debuff.states || {}).length || effect.getFlag("Order", "maxState") || 1;
    const currentState = Number(effect.getFlag("Order", "stateKey")) || 1;
    const newState = currentState + delta;

    if (newState < 1) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
        return;
    }

    if (newState > maxState) return;

    if (typeof actor?._applyDebuff === "function") {
        await actor._applyDebuff(debuffKey, String(newState));
        return;
    }

    const stageChanges = Array.isArray(debuff.changes?.[newState])
        ? debuff.changes[newState].map(change => ({ ...change }))
        : [];

    await effect.update({
        changes: stageChanges,
        'flags.description': debuff.states[newState],
        'flags.Order.stateKey': newState,
        'flags.Order.maxState': maxState
    });
};

const ensureHud = () => {
    let hud = document.getElementById(HUD_ID);
    if (hud) return hud;

    hud = document.createElement("div");
    hud.id = HUD_ID;
    hud.classList.add("order-debuff-hud");
    document.body.appendChild(hud);
    updateHudPosition(hud);
    return hud;
};

const renderDebuffs = (token) => {
    const hud = ensureHud();
    hud.innerHTML = "";
    updateHudPosition(hud);

    if (!token?.actor) {
        hud.classList.add("is-hidden");
        return;
    }

    const effects = getDebuffEffects(token.actor);
    if (!effects.length) {
        hud.classList.add("is-hidden");
        return;
    }

    hud.classList.remove("is-hidden");

    effects.forEach(effect => {
        const icon = document.createElement("div");
        icon.classList.add("order-debuff-icon");

        const img = document.createElement("img");
        img.src = effect.icon;
        img.alt = effect.label;
        img.title = effect.label;

        const tooltip = document.createElement("div");
        tooltip.classList.add("order-debuff-tooltip");
        tooltip.textContent = buildTooltipContent(effect);

        icon.addEventListener("click", (event) => {
            event.preventDefault();
            updateDebuffEffectLevel(effect, 1);
        });

        icon.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            updateDebuffEffectLevel(effect, -1);
        });

        icon.appendChild(img);
        icon.appendChild(tooltip);
        hud.appendChild(icon);
    });
};

const refreshHudForControlled = () => {
    const token = getControlledToken();
    renderDebuffs(token);
};

export const registerTokenDebuffHud = () => {
    Hooks.once("ready", () => {
        ensureHud();
        updateHudPosition();
        refreshHudForControlled();

        const sidebar = document.getElementById("sidebar");
        if (sidebar) {
            sidebarObserver = new MutationObserver(() => updateHudPosition());
            sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ["class", "style"] });

            if (window.ResizeObserver) {
                sidebarResizeObserver = new ResizeObserver(() => updateHudPosition());
                sidebarResizeObserver.observe(sidebar);
            }
        }

        window.addEventListener("resize", () => updateHudPosition());
    });

    Hooks.on("controlToken", () => {
        refreshHudForControlled();
    });

    Hooks.on("createActiveEffect", (effect) => {
        const controlled = getControlledToken();
        if (controlled?.actor?.id === effect.parent?.id) {
            refreshHudForControlled();
        }
    });

    Hooks.on("updateActiveEffect", (effect) => {
        const controlled = getControlledToken();
        if (controlled?.actor?.id === effect.parent?.id) {
            refreshHudForControlled();
        }
    });

    Hooks.on("deleteActiveEffect", (effect) => {
        const controlled = getControlledToken();
        if (controlled?.actor?.id === effect.parent?.id) {
            refreshHudForControlled();
        }
    });

    Hooks.on("updateToken", (scene, tokenData) => {
        const controlled = getControlledToken();
        if (controlled?.id === tokenData._id) {
            refreshHudForControlled();
        }
    });
};
