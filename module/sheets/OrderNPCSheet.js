import OrderPlayerSheet from "./OrderPlayerSheet.js";
import { getOrderHideRollFlag } from "../../scripts/OrderHiddenRolls.js";

export default class OrderNPCSheet extends OrderPlayerSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["Order", "sheet", "Player", "NPC"],
      template: "systems/Order/templates/sheets/NPC-sheet.hbs"
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
