function normalizeRollMode(mode) {
  const raw = String(mode ?? "normal").trim().toLowerCase();
  if (raw === "adv") return "adv";
  if (raw === "dis") return "dis";
  return "normal";
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
  defaultManualModifier = 0
} = {}) {
  const initialManual = Number(defaultManualModifier ?? 0) || 0;

  return await new Promise((resolve) => {
    let resolved = false;
    const done = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const submit = (html, rollMode) => {
      const manualModifier = Number(html.find("#order-defense-manual-mod").val() ?? 0) || 0;
      done({
        rollMode: normalizeRollMode(rollMode),
        manualModifier
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
