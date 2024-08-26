import OrderItemSheet from "./OrderItemSheet.js";


export default class OrderClassSheet extends OrderItemSheet {

  get template() {
    return `systems/Order/templates/sheets/Class-sheet.hbs`; // 'data' больше не используется
  }

  getData() {
    let sheetData = super.getData();
    console.log("OrderClassSheet getData", sheetData);
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".create-BaseSkill").click(this._onBaseCreateSkill.bind(this));
    html.find(".item-delete-class").click(this._onDeleteSkill.bind(this));
    html.find(".line-edit").change(this._onBaseSkillChange.bind(this));
    html.find(".create-ClassSkill").click(this._onClassCreateSkill.bind(this));
  }

  async _onClassCreateSkill(event) {
    event.preventDefault();
    const newSkill = {
      type: "Skill",
      _id: randomID(16),
      system: {
        name: "New Skill",
        description: "Description of the new skill",
        Damage: 0,
        Range: 0,
        EffectThreshold: 0,
        Level: 1,
        TypeOFAbility: "",
        Circle: 1,
        Cooldown: 1
      }
    };

    let skills = duplicate(this.item.system.Skills);
    skills.push(newSkill);
    await this.item.update({ "system.Skills": skills });

    this.render();
  }

  async _onBaseSkillChange(event) {
    event.preventDefault();

    const input = event.currentTarget;
    const value = input.type === "checkbox" ? input.checked : input.value;
    const name = input.name;

    const li = $(event.currentTarget).closest(".skill-card");
    const id = li.data("item-id");
    let basePerks = duplicate(this.item.system.basePerks);
    const skill = basePerks.find(skill => skill._id === id);

    if (skill) {
      const fieldPath = name.split('.');
      if (fieldPath.length > 1) {
        skill[fieldPath[0]][fieldPath[1]] = value;
      } else {
        skill[name] = value;
      }
      await this.item.update({ "system.basePerks": basePerks });
    }
  }

  async _onDeleteSkill(event) {
    event.preventDefault();

    const li = $(event.currentTarget).closest(".skill-card");
    const id = li.data("item-id");
    let basePerks = duplicate(this.item.system.basePerks);
    let Skills = duplicate(this.item.system.Skills);
    const skillToDelete = basePerks.find(skill => skill._id === id);
    const skillToDelete1 = Skills.find(skill => skill._id === id);
    const index = basePerks.indexOf(skillToDelete);
    const index1 = Skills.indexOf(skillToDelete1);

    if (skillToDelete) {
      new Dialog({
        title: `Delete ${skillToDelete.system.name}`,
        content: `<p>Are you sure you want to delete the skill <strong>${skillToDelete.system.name}</strong>?</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: "Yes",
            callback: async () => {
              basePerks.splice(index, 1);
              await this.item.update({ "system.basePerks": basePerks });
              this.render();
            }
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: "No"
          }
        },
        default: "no"
      }).render(true);
    }

    if (skillToDelete1) {
      new Dialog({
        title: `Delete ${skillToDelete1.system.name}`,
        content: `<p>Are you sure you want to delete the skill <strong>${skillToDelete1.system.name}</strong>?</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: "Yes",
            callback: async () => {
              Skills.splice(index, 1);
              await this.item.update({ "system.Skills": Skills });
              this.render();
            }
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: "No"
          }
        },
        default: "no"
      }).render(true);
    }

  }

  async _onBaseCreateSkill(event) {
    event.preventDefault();
    const newSkill = {
      type: "Skill",
      _id: randomID(16),
      system: {
        name: "New Skill",
        description: "Description of the new skill",
        Damage: 0,
        Range: 0,
        EffectThreshold: 0,
        Level: 1,
        TypeOFAbility: "",
        Circle: 1,
        Cooldown: 1
      }
    };

    let basePerks = duplicate(this.item.system.basePerks);
    basePerks.push(newSkill);
    await this.item.update({ "system.basePerks": basePerks });

    this.render();
  }
}
