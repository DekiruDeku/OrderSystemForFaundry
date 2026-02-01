import { startSkillUse } from "./OrderSkill.js";
import { buildCombatRollFlavor } from "./OrderRollFlavor.js";


const DEF_DELIVERY = "defensive-reaction";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

export function getDefensiveReactionSkills(actor) {
  const items = actor?.items?.contents ?? [];
  return items
    .filter(i => i?.type === "Skill" && String(getSystem(i)?.DeliveryType || "") === DEF_DELIVERY)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}

/**
 * Бросок защитного навыка (отдельный).
 */
export async function rollDefensiveSkillDefense({ actor, token, skillItem, scene = null } = {}) {
  const res = await startSkillUse({ actor, skillItem });
  if (!res) return null;

  const roll = res.roll;

  if (roll) {
    const flavor = buildCombatRollFlavor({
      scene,
      action: "Защита",
      source: `Навык: ${skillItem?.name ?? "—"}`,
      rollMode: res.rollMode ?? "normal",
      characteristic: res.characteristic ?? null,
      applyModifiers: true,
      manualMod: Number(res.manualMod ?? 0) || 0,
      externalMod: 0
    });

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor, token }),
      flavor
    });
  }

  return {
    skillId: skillItem.id,
    skillName: skillItem.name,
    defenseTotal: Number(res.total ?? roll?.total ?? 0) || 0
  };
}


/**
 * UI: если в атакующем сообщении есть .order-defense-skill-select — заполняем и показываем строку.
 */
export function registerOrderSkillDefenseReactionUI() {
  const getCtx = (m) =>
    m?.getFlag?.("Order", "attack") ||
    m?.getFlag?.("Order", "rangedAttack") ||
    m?.getFlag?.("Order", "spellAttack") ||
    m?.getFlag?.("Order", "skillAttack") ||
    null;

  Hooks.on("renderChatMessage", (message, html) => {
    try {
      const selects = html.find(".order-defense-skill-select");
      if (!selects?.length) return;

      selects.each((_, el) => {
        const $el = $(el);
        const row = $el.closest(".order-defense-skill-row");
        if (!row.length) return;

        // В обычном сообщении атаки srcId == message.id.
        // В сообщении "защита против преемпта" srcId указывает на исходное сообщение атаки.
        const srcId = String(el.dataset?.src || message.id);
        const srcMsg = game.messages.get(srcId);
        const ctx = getCtx(srcMsg || message);

        if (!ctx) {
          row.hide();
          return;
        }

        const isPreempt = (srcId !== message.id) && (String(ctx.state) === "awaitingPreemptDefense");

        // Показываем только когда реально ожидается защита
        if (!isPreempt && String(ctx.state) !== "awaitingDefense") {
          row.hide();
          return;
        }
        if (isPreempt && String(ctx.state) !== "awaitingPreemptDefense") {
          row.hide();
          return;
        }

        // Кто защищается:
        // - обычная атака: defender
        // - против преемпта: attacker (его атаку отменили, и он защищается от удара на опережение)
        const tokenId = isPreempt
          ? (ctx.attackerTokenId ?? ctx.casterTokenId ?? null)
          : (ctx.defenderTokenId ?? ctx.targetTokenId ?? null);

        const actorId = isPreempt
          ? (ctx.attackerActorId ?? ctx.casterActorId ?? null)
          : (ctx.defenderActorId ?? ctx.targetActorId ?? null);

        const token = tokenId ? canvas.tokens?.get(tokenId) : null;
        const actor = token?.actor ?? (actorId ? game.actors?.get(actorId) : null);

        if (!actor) {
          row.hide();
          return;
        }

        // Защиту должен видеть владелец защищающегося (или GM)
        if (!(game.user?.isGM || actor.isOwner)) {
          row.hide();
          return;
        }

        const skills = getDefensiveReactionSkills(actor);
        if (!skills.length) {
          row.hide();
          return;
        }

        // Не перезаполняем, чтобы не сбрасывать выбор при re-render
        if (!$el.children().length) {
          for (const sk of skills) {
            $el.append(`<option value="${sk.id}">${sk.name}</option>`);
          }
        }

        row.css("display", "flex");
      });
    } catch (e) {
      console.error("OrderSkillDefenseReaction | renderChatMessage error", e);
    }
  });

  console.log("OrderSkillDefenseReaction | UI hook registered");
}


