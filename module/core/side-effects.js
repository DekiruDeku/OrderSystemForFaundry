/**
 * Order | Кто записывает побочные изменения актёра.
 *
 * Actor.prepareData() выполняется на КАЖДОМ подключённом клиенте (и при каждом движении токена).
 * Если из него что-то записывать в базу (флаги перегруза, дебафф магической усталости), писать
 * должен ровно один клиент, иначе:
 *  - эффект создаётся несколько раз (по разу от каждого клиента);
 *  - игроки без прав на токен получают ошибки «lacks permission to update Token».
 *
 * Выбираем одного: активный GM с наименьшим id, а если GM нет в игре — первый активный
 * пользователь, который может менять этого актёра (или его токен).
 */

/**
 * Может ли пользователь записывать изменения этого актёра (для токен-актёра — его токена).
 * @param {Actor} actor
 * @param {User} user
 * @returns {boolean}
 */
export function canUserPersistActor(actor, user) {
  if (!actor || !user) return false;

  try {
    if (actor.isToken) {
      const tokenDoc = actor.token;
      if (tokenDoc?.canUserModify) return tokenDoc.canUserModify(user, "update");
      if (tokenDoc?.testUserPermission) return tokenDoc.testUserPermission(user, "OWNER");
    }

    if (actor.canUserModify) return actor.canUserModify(user, "update");
    if (actor.testUserPermission) return actor.testUserPermission(user, "OWNER");
  } catch (err) {
    console.warn("Order | Unable to check Actor persistence permission", err);
  }

  return false;
}

/**
 * Должен ли ТЕКУЩИЙ клиент записать побочные изменения актёра (см. описание файла).
 * @param {Actor} actor
 * @returns {boolean}
 */
export function shouldPersistActorSideEffects(actor) {
  const currentUser = game?.user;
  if (!currentUser) return false;

  const activeUsers = Array.from(game?.users?.contents ?? [])
    .filter((user) => user?.active)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const primaryGM = activeUsers.find((user) => user.isGM);
  if (primaryGM) return primaryGM.id === currentUser.id;

  const responsibleOwner = activeUsers.find((user) => canUserPersistActor(actor, user));
  return responsibleOwner?.id === currentUser.id;
}
