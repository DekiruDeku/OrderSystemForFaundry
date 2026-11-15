import OrderPlayerSheet from "./OrderPlayerSheet.js";
import { getOrderHideRollFlag } from "../../scripts/OrderHiddenRolls.js";

export default class OrderNPCSheet extends OrderPlayerSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      // Шаблон общий с листом игрока: отличия NPC внутри него развилками по actor.type.
      classes: ["Order", "sheet", "Player", "NPC", "osj"],
      template: "systems/Order/templates/sheets/Player-sheet.hbs"
    });
  }

  getData() {
    const data = super.getData();
    data.osHideRollBonuses = getOrderHideRollFlag(this.actor);
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="toggle-hide-roll-bonuses"]').off('change.orderNpcHideRolls').on('change.orderNpcHideRolls', async (event) => {
      event.preventDefault();
      const enabled = !!event.currentTarget?.checked;
      await this.actor.setFlag('Order', 'hideRollBonuses', enabled);
      this.render(false);
    });
  }
}
