const HIDDEN_SENTINEL = "-";
export const AUTO_SUCCESS_TOTAL = 999999;

const CHARACTERISTIC_KEYS = new Set([
  "Strength", "Dexterity", "Stamina", "Accuracy", "Will", "Knowledge", "Charisma",
  "Seduction", "Leadership", "Faith", "Medicine", "Magic", "Stealth"
]);

function getActorSystem(actor) {
  return actor?.system ?? actor?.data?.system ?? {};
}

export function isOrderCharacteristicKey(key) {
  return CHARACTERISTIC_KEYS.has(String(key ?? "").trim());
}

export function getCharacteristicKeyFromPath(path) {
  const match = /^(?:data|system)\.([A-Za-z]+)\.value$/.exec(String(path ?? "").trim());
  const key = match?.[1] ?? "";
  return isOrderCharacteristicKey(key) ? key : "";
}

export function isHiddenCharacteristicValue(value) {
  return String(value ?? "").trim() === HIDDEN_SENTINEL;
}

export function isActorCharacteristicHidden(actor, key) {
  if (!actor || !isOrderCharacteristicKey(key)) return false;
  const sys = getActorSystem(actor);
  return isHiddenCharacteristicValue(sys?.[key]?.value);
}


export function isAutoSuccessTotal(total) {
  return Number(total ?? 0) >= AUTO_SUCCESS_TOTAL;
}

export function formatCharacteristicCheckTotal(total, label = "Авто") {
  return isAutoSuccessTotal(total) ? String(label) : String(Number(total ?? 0) || 0);
}
export function makeAutoSuccessRoll(actor, attribute, { flavor = "" } = {}) {
  const actorName = String(actor?.name ?? "Цель").trim() || "Цель";
  const attrLabel = String(game?.i18n?.localize?.(attribute) ?? attribute ?? "характеристика").trim();
  const contentFlavor = String(flavor || attrLabel || "Проверка").trim();

  return {
    total: AUTO_SUCCESS_TOTAL,
    formula: "AUTO_SUCCESS",
    orderAutoSuccess: true,
    orderAutoAttribute: attribute,
    async toMessage(messageData = {}) {
      const speaker = messageData?.speaker ?? ChatMessage.getSpeaker({ actor });
      const finalFlavor = String(messageData?.flavor || contentFlavor || attrLabel || "Проверка").trim();
      await ChatMessage.create({
        speaker,
        content: `<p><strong>${actorName}</strong> — ${finalFlavor}: <strong>АВТОУСПЕХ</strong> (скрытая характеристика).</p>`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
      return null;
    }
  };
}
