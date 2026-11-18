/* =========================================================================
   Order | Прокачка: карточки чата.
   Одна карточка на тренировку (вместо трёх бросков), карточка нового уровня,
   заявки ГМу (Эволюция, «Другое улучшение») и отметка отката.
   У заявок и у карточки уровня есть кнопки ГМа: их видит только ГМ, игрок видит статус.
   Флаг сообщения: flags.Order.levelingCard = { type, actorUuid, itemId, level, status, … }.
   ========================================================================= */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "+0");

export const CARD_FLAG = "levelingCard";

const STATUS_TEXT = {
  evo: {
    approved: "Одобрено: вариант появился в списке способностей.",
    declined: "Отклонено: игрок выберет обычное улучшение.",
    void: "Отменено откатом ГМа."
  },
  custom: {
    approved: "Одобрено: ГМ внесёт изменение в лист способности.",
    declined: "Отклонено: игрок выберет обычное улучшение.",
    void: "Отменено откатом ГМа."
  }
};

function head(d) {
  return `<header class="lvx-cm-head"><img src="${esc(d.img)}" alt=""><div><strong>${esc(d.name)}</strong><span>${esc(d.sub ?? "")}</span></div></header>`;
}

export function trainingCardHtml(d) {
  const dice = d.rolls.map((r) => `<span class="lvx-cm-die ${r.cls}" title="${r.nat} ${sign(d.bonus)} = ${r.total}">${r.nat}</span>`).join("");
  const outcome = d.aborted
    ? "Тренировка сорвана, очки не начислены."
    : `<b>${d.net > 0 ? "+" : d.net < 0 ? "−" : ""}${Math.abs(d.net)} О.О.</b> ${d.up ? `· уровень <b>${d.level}</b>` : d.max ? "· максимальный уровень" : `· ${d.filled} из ${d.need}`}`;
  const bar = d.up || d.aborted || d.max || !d.need ? "" : `<div class="lvx-cm-bar"><i style="--p:${Math.min(1, d.filled / d.need).toFixed(3)}"></i></div>`;
  return `<div class="lvx-cm lvx-cm--training">
    ${head({ ...d, sub: `Тренировка · ${d.char} ${sign(d.bonus)}${d.mod ? ` (условия ${sign(d.mod)})` : ""} · сложность ${d.dc}` })}
    <div class="lvx-cm-dice">${dice}</div>
    <p>${outcome}${d.overLimit ? ` <span class="lvx-cm-tag is-gold">сверх лимита дня</span>` : ""}</p>
    ${bar}
  </div>`;
}

function pickLine(p) {
  if (p.key === "custom") return `<p>Другое: заявка ГМу</p>`;
  return `<p>${esc(p.label)}${p.times > 1 ? " (дважды)" : ""}: ${esc(p.from)} → <b>${esc(p.to)}</b></p>`;
}

export function levelCardHtml(d) {
  const title = d.replacing ? "Замена отклонённой заявки" : "Новый уровень";
  const reverted = d.status === "void";
  return `<div class="lvx-cm lvx-cm--level${reverted ? " is-void" : ""}">
    ${head({ ...d, sub: d.source ? `Источник: ${d.source}` : "" })}
    <p>${title}: <b>${d.level}</b>${d.evo ? ` <span class="lvx-cm-tag is-gold">Эволюция</span>` : ""}</p>
    ${d.picks.map(pickLine).join("")}
    ${d.synced?.length ? `<p class="lvx-cm-note">Вместе с ним выросли: ${d.synced.map(esc).join(", ")}</p>` : ""}
    ${reverted ? `<p class="lvx-cm-wait">ГМ откатил этот выбор.</p>`
      : `<div class="lvx-cm-actions" data-lvx-gm><button type="button" class="lvx-cm-btn" data-lvx-act="revert" title="Вернуть значения и дать игроку выбрать заново">Откатить</button></div>`}
  </div>`;
}

export function requestCardHtml(d) {
  const isEvo = d.type === "evo";
  const title = isEvo ? `Заявка на Эволюцию «${esc(d.evoName)}»` : "Заявка на улучшение";
  const text = isEvo ? d.evoText : d.text;
  let tail;
  if (d.status === "pending") {
    tail = `<div class="lvx-cm-actions" data-lvx-gm>
        <button type="button" class="lvx-cm-btn is-accent" data-lvx-act="approve">Одобрить</button>
        <button type="button" class="lvx-cm-btn" data-lvx-act="decline">Отклонить</button>
      </div>
      <p class="lvx-cm-wait" data-lvx-player>Ждёт решения ГМа.</p>`;
  } else {
    tail = `<p class="lvx-cm-wait is-${esc(d.status)}">${esc(STATUS_TEXT[d.type]?.[d.status] ?? "")}</p>`;
  }
  return `<div class="lvx-cm lvx-cm--${isEvo ? "evo" : "custom"}">
    ${head({ ...d, sub: d.actorName ?? "" })}
    <p class="lvx-cm-title">${title}<span class="lvx-cm-tag is-gold">ур. ${d.level}</span></p>
    <p>${esc(text)}</p>
    ${tail}
  </div>`;
}

export function revertCardHtml(d) {
  return `<div class="lvx-cm lvx-cm--revert">
    ${head({ ...d, sub: d.actorName ?? "" })}
    <p>ГМ откатил выбор уровня <b>${d.level}</b>. Игрок выберет заново.</p>
  </div>`;
}

export function cardHtml(flag) {
  switch (flag?.type) {
    case "training": return trainingCardHtml(flag);
    case "level": return levelCardHtml(flag);
    case "evo":
    case "custom": return requestCardHtml(flag);
    case "revert": return revertCardHtml(flag);
    default: return "";
  }
}

/* Создать карточку. data попадает во флаг целиком: по нему же карточка перерисовывается после решения ГМа. */
export async function postCard(actor, data, { rolls = [], whisperGM = false } = {}) {
  const flag = { ...data, actorUuid: actor.uuid, actorName: actor.name };
  const msg = {
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardHtml(flag),
    flags: { Order: { [CARD_FLAG]: flag } }
  };
  if (rolls.length) {
    msg.rolls = rolls;
    msg.sound = CONFIG.sounds?.dice;
  }
  if (whisperGM) msg.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  try {
    return await ChatMessage.create(msg);
  } catch (err) {
    console.error("Order | Leveling | не удалось создать карточку чата", err);
    return null;
  }
}

/* ГМ поменял статус: перерисовать карточку из флага */
export async function setCardStatus(message, status, extra = {}) {
  const flag = message?.flags?.Order?.[CARD_FLAG];
  if (!flag) return;
  const next = { ...flag, ...extra, status };
  try {
    await message.update({ content: cardHtml(next), [`flags.Order.${CARD_FLAG}`]: next });
  } catch (err) {
    console.error("Order | Leveling | не удалось обновить карточку", err);
  }
}
