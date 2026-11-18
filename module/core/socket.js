/**
 * Order | Транспорт запросов «игрок → GM» через веб-сокет.
 *
 * Зачем это нужно
 * ----------------
 * Игрок не может сам менять чужие документы (токен врага, сообщение атаки, эффекты цели),
 * поэтому все такие действия выполняет GM: игрок отправляет запрос, клиент GM его исполняет.
 * Раньше запрос шёл скрытым whisper-сообщением в чат с флагом `flags.Order.<шина>.payload`,
 * а каждый модуль слушал `createChatMessage`. Минусы: лишние записи в базе чата, задержка на
 * запись документа и двойная обработка, если в игре два GM (запрос выполняли оба).
 *
 * Как устроено теперь
 * -------------------
 * 1. Модуль механики регистрирует обработчик своей шины: `registerGMHandler("meleeBus", fn)`.
 * 2. Игрок вызывает `sendToGM("meleeBus", payload)`. Запрос уходит по каналу `system.Order`
 *    (нужен `"socket": true` в system.json) адресно одному активному GM (`game.users.activeGM`).
 * 3. GM сразу отвечает подтверждением (ack) и вызывает все обработчики этой шины — как раньше
 *    при чат-шине: каждый модуль сам смотрит на `payload.type` и игнорирует чужие типы.
 * 4. Если подтверждение не пришло за ACK_TIMEOUT_MS (например, сервер Foundry не перезапущен
 *    после правки system.json и не пересылает сокет системы), запрос отправляется старым путём —
 *    скрытым сообщением в чат. До конца сессии дальше сразу используется чат.
 *    Повторная обработка исключена: у запроса есть `requestId`, GM помнит обработанные id.
 *
 * Сообщения-«шины» из старых сессий по-прежнему скрываются в чате (Order.js, isOrderBusChatMessage).
 */

/** Канал сокета системы. Формат фиксирован Foundry: `system.<id системы>`. */
export const SOCKET_CHANNEL = "system.Order";

/** Шины, которые используют модули механик. Ключ шины = ключ флага в старом чат-транспорте. */
export const ORDER_BUSES = Object.freeze(["meleeBus", "rangedBus", "spellBus", "skillBus", "consumableBus"]);

/** Сколько ждать подтверждения от GM, прежде чем уйти на запасной чат-транспорт. */
const ACK_TIMEOUT_MS = 4000;

/** Сколько обработанных requestId помнить (защита от двойного исполнения). */
const PROCESSED_LIMIT = 500;

/** @type {Map<string, Set<(payload: object, meta: object) => any>>} шина → обработчики */
const handlers = new Map();
/** @type {Map<string, number>} requestId → время обработки (упорядочено по вставке) */
const processed = new Map();
/** @type {Map<string, {resolve: (ok: boolean) => void, timer: number}>} ожидающие подтверждения */
const pendingAcks = new Map();

let listening = false;
/** true, если в этой сессии сокет не доставил запрос и мы перешли на чат. */
let socketUnavailable = false;

const log = (...args) => console.log("Order | socket |", ...args);

/* -------------------------------------------------------------------------- */
/*  Регистрация                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Зарегистрировать обработчик шины на стороне GM.
 * Вызывается из `register*Bus()` каждого модуля механики (хук ready).
 * @param {string} bus      ключ шины, см. ORDER_BUSES
 * @param {(payload: object, meta: {requestId?: string, senderId?: string, via: string}) => any} handler
 */
export function registerGMHandler(bus, handler) {
  if (!bus || typeof handler !== "function") return;
  if (!handlers.has(bus)) handlers.set(bus, new Set());
  handlers.get(bus).add(handler);
  initOrderSocket();
}

/**
 * Подписаться на канал сокета и на запасной чат-транспорт. Идемпотентно.
 * Вызывается автоматически из registerGMHandler, но можно звать и явно в хуке ready.
 */
export function initOrderSocket() {
  if (listening) return;
  if (!game?.socket) return; // слишком рано: game.socket появляется к хуку setup
  listening = true;
  game.socket.on(SOCKET_CHANNEL, onSocketMessage);
  Hooks.on("createChatMessage", onLegacyBusMessage);
}

/* -------------------------------------------------------------------------- */
/*  Отправка                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Отправить запрос на исполнение GM.
 *
 * Модуль механики сам решает, что делать, если текущий пользователь — GM (обычно сразу вызывает
 * свой обработчик локально); эта функция нужна для игроков.
 *
 * @param {string} bus       ключ шины (meleeBus, spellBus, …)
 * @param {object} payload   данные запроса; должен быть JSON-сериализуемым, обязателен `type`
 * @param {object} [options]
 * @param {string} [options.targetUserId]  явный получатель (не GM) — только для особых случаев,
 *        например заклинание без GM в игре: запрос исполняет автор исходного сообщения
 * @param {string} [options.chatContent]   текст скрытого сообщения для запасного чат-пути
 * @returns {Promise<boolean>} true — запрос передан (сокетом или чатом), false — некому отправить
 */
export async function sendToGM(bus, payload, { targetUserId = null, chatContent = null } = {}) {
  const target = targetUserId ? game.users.get(targetUserId) : game.users.activeGM;
  if (!target?.active) return false;

  const requestId = foundry.utils.randomID(16);
  const envelope = {
    kind: "request",
    bus,
    payload,
    requestId,
    senderId: game.user.id,
    targetId: target.id
  };

  if (!socketUnavailable) {
    const delivered = await emitWithAck(envelope);
    if (delivered) return true;
    socketUnavailable = true;
    console.warn(
      "Order | socket | GM не подтвердил запрос по сокету — переключаюсь на чат-транспорт до конца сессии. "
      + "Если это повторяется, перезапустите сервер Foundry: system.json должен быть перечитан с \"socket\": true."
    );
  }

  await sendViaChat(envelope, target, chatContent);
  return true;
}

/** Отправить конверт по сокету и дождаться ack. */
function emitWithAck(envelope) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(envelope.requestId);
      resolve(false);
    }, ACK_TIMEOUT_MS);
    pendingAcks.set(envelope.requestId, { resolve, timer });
    try {
      game.socket.emit(SOCKET_CHANNEL, envelope);
    } catch (err) {
      clearTimeout(timer);
      pendingAcks.delete(envelope.requestId);
      console.warn("Order | socket | emit failed", err);
      resolve(false);
    }
  });
}

/** Запасной путь: скрытое whisper-сообщение получателю (как было до перехода на сокет). */
async function sendViaChat(envelope, target, chatContent) {
  const { bus, payload, requestId, targetId } = envelope;
  await ChatMessage.create({
    content: chatContent ?? `<p>Order: запрос ${foundry.utils.escapeHTML(String(payload?.type ?? ""))}</p>`,
    whisper: [target.id],
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
    flags: { Order: { [bus]: { payload, requestId, targetId } } }
  });
}

/* -------------------------------------------------------------------------- */
/*  Приём                                                                     */
/* -------------------------------------------------------------------------- */

/** Сообщение из канала system.Order (вызывается на всех клиентах, кроме отправителя). */
function onSocketMessage(data) {
  if (!data || typeof data !== "object") return;

  if (data.kind === "ack") {
    if (data.to !== game.user.id) return;
    const pending = pendingAcks.get(data.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingAcks.delete(data.requestId);
    pending.resolve(true);
    return;
  }

  if (data.kind !== "request") return;
  if (data.targetId !== game.user.id) return; // запрос адресован другому клиенту

  // Подтверждаем получение сразу, ещё до исполнения: отправителю важно знать, что запрос дошёл.
  try {
    game.socket.emit(SOCKET_CHANNEL, { kind: "ack", requestId: data.requestId, to: data.senderId });
  } catch (err) {
    console.warn("Order | socket | ack failed", err);
  }

  dispatch(data.bus, data.payload, { requestId: data.requestId, senderId: data.senderId, via: "socket" });
}

/**
 * Запасной чат-транспорт (и совместимость со старыми клиентами).
 * Исполняем, если сообщение адресовано нам и мы — тот, кто должен его исполнить.
 */
function onLegacyBusMessage(message) {
  try {
    const flags = message?.flags?.Order;
    if (!flags || typeof flags !== "object") return;
    const bus = ORDER_BUSES.find((key) => flags[key]?.payload);
    if (!bus) return;

    const { payload, requestId = null, targetId = null } = flags[bus];
    const whisper = Array.isArray(message.whisper) ? message.whisper.map(String) : [];
    if (whisper.length && !whisper.includes(game.user.id)) return;

    // Явный адресат (запрос без GM в игре) — исполняет только он.
    // Иначе — только «главный» активный GM, чтобы при двух GM запрос не выполнился дважды.
    const mine = targetId ? targetId === game.user.id : game.user.isActiveGM;
    if (!mine) return;

    dispatch(bus, payload, { requestId, senderId: message.author?.id ?? null, via: "chat" });
  } catch (err) {
    console.error("Order | socket | legacy bus handler failed", err);
  }
}

/** Вызвать все обработчики шины. Каждый модуль сам игнорирует чужие `payload.type`. */
async function dispatch(bus, payload, meta) {
  if (!payload?.type) return;
  if (meta.requestId) {
    if (processed.has(meta.requestId)) return; // уже исполнено другим путём
    processed.set(meta.requestId, Date.now());
    if (processed.size > PROCESSED_LIMIT) processed.delete(processed.keys().next().value);
  }

  const list = handlers.get(bus);
  if (!list?.size) {
    console.warn(`Order | socket | нет обработчика для шины ${bus}`, payload);
    return;
  }

  log(`${meta.via}: ${bus} → ${payload.type}`);
  for (const handler of list) {
    try {
      await handler(payload, meta);
    } catch (err) {
      console.error(`Order | socket | обработчик ${bus}/${payload.type} упал`, err);
    }
  }
}
