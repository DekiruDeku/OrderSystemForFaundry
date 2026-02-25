function normalizeRollMode(mode) {
  const raw = String(mode ?? "normal").trim().toLowerCase();
  if (raw === "adv") return "adv";
  if (raw === "dis") return "dis";
  return "normal";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getDefenseD20Formula(mode = "normal") {
  const rollMode = normalizeRollMode(mode);
  if (rollMode === "adv") return "2d20kh1";
  if (rollMode === "dis") return "2d20kl1";
  return "1d20";
}

export async function promptDefenseRollSetup({
  title = "Настройка защитного броска",
  defaultRollMode = "normal",
  defaultManualModifier = 0,
  characteristics = [],
  defaultCharacteristic = ""
} = {}) {
  const initialManual = Number(defaultManualModifier ?? 0) || 0;
  const characteristicOptions = Array.isArray(characteristics)
    ? Array.from(new Set(characteristics.map((v) => String(v || "").trim()).filter(Boolean)))
    : [];
  const resolvedCharacteristic = characteristicOptions.includes(String(defaultCharacteristic || "").trim())
    ? String(defaultCharacteristic || "").trim()
    : (characteristicOptions[0] ?? "");
  const hasCharacteristicChoice = characteristicOptions.length > 1;

  const characteristicControlHtml = hasCharacteristicChoice
    ? `
      <div class="form-group">
        <label>Характеристика:</label>
        <select id="order-defense-characteristic">
          ${characteristicOptions
        .map((key) => {
          const selected = key === resolvedCharacteristic ? " selected" : "";
          const localized = escapeHtml(game.i18n.localize(key));
          return `<option value="${escapeHtml(key)}"${selected}>${localized}</option>`;
        })
        .join("")}
        </select>
      </div>
    `
    : (characteristicOptions.length === 1
      ? `
      <div class="form-group">
        <label>Характеристика:</label>
        <div>${escapeHtml(game.i18n.localize(characteristicOptions[0]))}</div>
      </div>
    `
      : "");

  return await new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const submit = (html, rollMode) => {
      const manualModifier = Number(html.find("#order-defense-manual-mod").val() ?? 0) || 0;
      const selectedCharacteristic = hasCharacteristicChoice
        ? String(html.find("#order-defense-characteristic").val() || resolvedCharacteristic || "").trim()
        : resolvedCharacteristic;
      done({
        rollMode: normalizeRollMode(rollMode),
        manualModifier,
        characteristic: selectedCharacteristic
      });
    };

    new Dialog({
      title,
      content: `
        <form class="order-defense-roll-setup">
          <div class="form-group">
            <label>Ручной модификатор:</label>
            <input type="number" id="order-defense-manual-mod" value="${initialManual}" />
          </div>
          ${characteristicControlHtml}
        </form>
      `,
      buttons: {
        normal: {
          label: "Обычный",
          callback: (html) => submit(html, "normal")
        },
        adv: {
          label: "Преимущество",
          callback: (html) => submit(html, "adv")
        },
        dis: {
          label: "Помеха",
          callback: (html) => submit(html, "dis")
        }
      },
      default: normalizeRollMode(defaultRollMode),
      close: () => done(null)
    }).render(true);
  });
}
