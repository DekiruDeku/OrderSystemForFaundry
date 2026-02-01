import { startSkillUse } from "./OrderSkill.js";

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
export async function rollDefensiveSkillDefense({ actor, token, skillItem }) {
  const res = await startSkillUse({ actor, skillItem });
  if (!res) return null;

  return {
    skillId: skillItem.id,
    skillName: skillItem.name,
    defenseTotal: Number(res.total ?? 0) || 0
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

  const isAwaitingDefense = (ctx) => {
    const st = String(ctx?.state || "");
    return st === "awaitingDefense" || st === "awaitingPreemptDefense";
  };


  const getDefenderFromCtx = (ctx) => {
    // Самые частые имена полей
    const defenderTokenId =
      ctx?.defenderTokenId || ctx?.targetTokenId || ctx?.defTokenId || null;

    const defenderActorId =
      ctx?.defenderActorId || ctx?.targetActorId || ctx?.defActorId || null;

    const token = defenderTokenId ? canvas.tokens?.get(defenderTokenId) : null;
    const actor = token?.actor || (defenderActorId ? game.actors?.get(defenderActorId) : null);

    return { token, actor };
  };

  Hooks.on("renderChatMessage", (message, html) => {
    try {
      // Ищем наши селекты (они будут только в сообщениях атак, где ты добавил row)
      const selects = html.find(".order-defense-skill-select");
      if (!selects?.length) return;

      const ctx = getCtx(message);
      if (!ctx) return;

      if (!isAwaitingDefense(ctx)) {
        // Если атака уже разрешена — не показываем защиту
        html.find(".order-defense-skill-row").hide();
        return;
      }

      const { token: defenderToken, actor: defenderActor } = getDefenderFromCtx(ctx);
      if (!defenderActor) return;

      // Защиту должен видеть владелец цели (или GM)
      if (!(game.user?.isGM || defenderActor.isOwner)) {
        html.find(".order-defense-skill-row").hide();
        return;
      }

      const skills = getDefensiveReactionSkills(defenderActor);
      if (!skills.length) {
        html.find(".order-defense-skill-row").hide();
        return;
      }

      // Заполняем все селекты на случай, если сообщение рендерится несколько раз
      selects.each((_, el) => {
        const $el = $(el);
        const row = $el.closest(".order-defense-skill-row");

        // очистка и заполнение
        $el.empty();
        for (const sk of skills) {
          $el.append(`<option value="${sk.id}">${sk.name}</option>`);
        }

        // показать строку
        row.css("display", "flex");
      });
    } catch (e) {
      console.error("OrderSkillDefenseReaction | renderChatMessage error", e);
    }
  });

  console.log("OrderSkillDefenseReaction | UI hook registered");
}

