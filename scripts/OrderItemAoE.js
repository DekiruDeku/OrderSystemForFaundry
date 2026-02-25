import {
  mapTemplateShape,
  placeTemplateInteractively,
  waitForTemplateObject,
  getTokensInTemplate
} from "./OrderTemplateUtils.js";
import { pickTargetsDialog } from "./OrderMultiTargetPicker.js";

function getSystem(obj) {
  return obj?.system ?? obj?.data?.system ?? {};
}

function normalizeAoEShape(shape) {
  const s = String(shape || "").trim().toLowerCase();
  if (s === "circle") return "circle";
  if (s === "cone") return "cone";
  if (s === "ray" || s === "rect" || s === "wall") return "ray";
  return "circle";
}

function buildItemTemplateData({ item, casterToken } = {}) {
  if (!item || !casterToken) return null;

  const s = getSystem(item);
  const size = Number(s.AreaSize ?? 0) || 0;
  if (size <= 0) return null;

  const rawWidth = Number(s.AreaWidth ?? 0) || 0;
  const width = Math.max(rawWidth, 0.5);
  const angle = Number(s.AreaAngle ?? 90) || 90;
  const center = casterToken?.center ?? { x: 0, y: 0 };
  const rawShape = String(s.AreaShape || "circle").trim().toLowerCase();
  const normalizedShape = normalizeAoEShape(rawShape);
  const gridAlignedRect = normalizedShape === "ray" && rawShape !== "wall";

  return {
    t: mapTemplateShape(normalizedShape),
    user: game.user?.id,
    x: center.x,
    y: center.y,
    direction: 0,
    distance: size,
    width,
    angle,
    fillColor: String(s.AreaColor || game.user?.color || "#ffffff"),
    flags: {
      Order: {
        itemAoETemplate: {
          casterActorId: casterToken?.actor?.id ?? null,
          casterTokenId: casterToken?.id ?? null,
          itemId: item?.id ?? null
        },
        templatePlacement: {
          gridAlignedRect
        }
      }
    }
  };
}

export async function collectItemAoETargetIds({
  item,
  casterToken,
  dialogTitle = "Цели в области",
  itemTypeLabel = "способности",
  deleteTemplateAfter = true,
  allowAddTargets = true,
  excludeCaster = true
} = {}) {
  if (!canvas?.ready) {
    ui.notifications?.warn?.("Сцена не готова.");
    return { targetTokenIds: [], templateId: null };
  }

  if (!item) {
    ui.notifications?.warn?.("Не найдена способность.");
    return { targetTokenIds: [], templateId: null };
  }

  if (!casterToken) {
    ui.notifications?.warn?.("Не найден токен использующего.");
    return { targetTokenIds: [], templateId: null };
  }

  const templateData = buildItemTemplateData({ item, casterToken });
  if (!templateData) {
    ui.notifications?.warn?.(`У ${itemTypeLabel} не настроен шаблон области (AreaSize > 0).`);
    return { targetTokenIds: [], templateId: null };
  }

  const placedDoc = await placeTemplateInteractively(templateData);
  if (!placedDoc) return { targetTokenIds: [], templateId: null };

  const templateId = placedDoc.id;
  const templateObj = await waitForTemplateObject(templateId);

  const excludeTokenIds = [];
  if (excludeCaster && casterToken?.id) excludeTokenIds.push(String(casterToken.id));

  const tokensInArea = templateObj
    ? getTokensInTemplate(templateObj, { excludeTokenIds })
    : [];

  const picked = await pickTargetsDialog({
    title: dialogTitle,
    initialTokens: tokensInArea,
    allowAddTargets
  });

  if (deleteTemplateAfter && templateId) {
    try {
      await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [templateId]);
    } catch (e) {
      console.warn("OrderItemAoE | Failed to delete template", e);
    }
  }

  return {
    targetTokenIds: Array.isArray(picked) ? picked : [],
    templateId
  };
}
