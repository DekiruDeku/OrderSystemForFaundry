/**
 * OrderWeaponAoE.js
 *
 * Утилита: собрать цели массовой атаки оружием.
 * Алгоритм:
 * 1) по параметрам оружия создаём шаблон (AoEShape/AoESize/...)
 * 2) интерактивно ставим шаблон на сцене
 * 3) находим токены внутри
 * 4) открываем диалог подтверждения списка целей (можно убрать/добавить)
 *
 * Возвращает объект с targetTokenIds и templateId (если надо).
 */

import { buildWeaponAoETemplateData, placeTemplateInteractively, waitForTemplateObject, getTokensInTemplate } from "./OrderTemplateUtils.js";
import { pickTargetsDialog } from "./OrderMultiTargetPicker.js";

export async function collectWeaponAoETargetIds({
  weaponItem,
  attackerToken,
  dialogTitle = "Цели в области",
  deleteTemplateAfter = true,
  allowAddTargets = true,
  excludeAttacker = true
} = {}) {
  if (!canvas?.ready) {
    ui.notifications?.warn?.("Сцена не готова.");
    return { targetTokenIds: [], templateId: null };
  }

  if (!weaponItem) {
    ui.notifications?.warn?.("Нет оружия для AoE.");
    return { targetTokenIds: [], templateId: null };
  }

  if (!attackerToken) {
    ui.notifications?.warn?.("Не найден токен атакующего.");
    return { targetTokenIds: [], templateId: null };
  }

  const templateData = buildWeaponAoETemplateData({ weaponItem, attackerToken });
  if (!templateData) {
    ui.notifications?.warn?.("У оружия не настроен шаблон массовой атаки (AoESize = 0).");
    return { targetTokenIds: [], templateId: null };
  }

  const placedDoc = await placeTemplateInteractively(templateData);
  if (!placedDoc) return { targetTokenIds: [], templateId: null };

  const templateId = placedDoc.id;
  const templateObj = await waitForTemplateObject(templateId);

  const excludeTokenIds = [];
  if (excludeAttacker && attackerToken?.id) excludeTokenIds.push(String(attackerToken.id));

  const tokensInArea = templateObj
    ? getTokensInTemplate(templateObj, { excludeTokenIds })
    : [];

  const picked = await pickTargetsDialog({
    title: dialogTitle,
    initialTokens: tokensInArea,
    allowAddTargets
  });

  // по умолчанию — удаляем шаблон после выбора целей
  if (deleteTemplateAfter && templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
    } catch (e) {
      console.warn("OrderWeaponAoE | Failed to delete template", e);
    }
  }

  return {
    targetTokenIds: Array.isArray(picked) ? picked : [],
    templateId
  };
}