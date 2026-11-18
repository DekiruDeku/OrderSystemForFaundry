/**
 * OrderItem — кастомный класс Item системы Order.
 *
 * Совместимость с Foundry VTT v12+: шим v10, который автоматически переводил
 * ключи обновления "data.*" в "system.*", был удалён из ядра. Шаблоны листов
 * системы (поля формы вида name="data.X") и часть скриптов всё ещё используют
 * старые ключи, поэтому мы выполняем перевод сами — это сохраняет работу всех
 * функций ровно как в v11, без переписывания всех шаблонов.
 */

export function osRemapLegacyDataKeys(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;

  let needsRemap = false;
  for (const k of Object.keys(data)) {
    if (k === "data" || k.startsWith("data.")) { needsRemap = true; break; }
  }
  if (!needsRemap) return data;

  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "data" && v && typeof v === "object" && !Array.isArray(v)) {
      out.system = foundry.utils.mergeObject(out.system ?? {}, v, { inplace: false });
    } else if (k.startsWith("data.")) {
      const mapped = `system.${k.slice(5)}`;
      if (!(mapped in data)) out[mapped] = v; // не перетираем явный system.*-ключ
    } else {
      out[k] = v;
    }
  }
  return out;
}

export class OrderItem extends Item {
  /** @override Перевод legacy-ключей "data.*" -> "system.*" при обновлении. */
  update(data = {}, context = {}) {
    return super.update(osRemapLegacyDataKeys(data), context);
  }
}
