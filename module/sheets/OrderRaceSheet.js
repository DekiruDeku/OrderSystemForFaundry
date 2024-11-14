import OrderItemSheet from "./OrderItemSheet.js";

export default class OrderRaceSheet extends OrderItemSheet {
    get template() {
        return 'systems/Order/templates/sheets/Race-sheet.hbs';
    }

    // Настройка данных для рендера шаблона
    getData() {
        let sheetData = super.getData();
        console.log("OrderRaceSheet getData", sheetData);
        return sheetData;
    }

    activateListeners(html) {
        super.activateListeners(html);
        // Инициализация зоны перетаскивания для Skills
        const skillsDropArea = html.find(".skills-drop");
        skillsDropArea.on("dragenter", this._onDragEnter.bind(this));
        skillsDropArea.on("dragover", this._onDragOver.bind(this));
        skillsDropArea.on("drop", (event) => this._onDrop(event, "Skills"));
        html.find(".delete-skill-button").click(this._onDeleteSkillClick.bind(this));
    }

    _onDragEnter(event) {
        event.preventDefault();
        event.currentTarget.classList.add("dragging");
    }

    // Обработчик для dragover, чтобы разрешить сброс предметов
    _onDragOver(event) {
        event.preventDefault();
    }

    // Основной обработчик для drop - добавляем предмет в массив класса
    async _onDrop(event, targetArray) {
        event.preventDefault();
        event.currentTarget.classList.remove("dragging");
        console.log("smth0");

        // Получаем данные о перетаскиваемом элементе
        const data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));

        // Проверяем, что это именно предмет и что его тип подходит, например, "skill"
        if (data.type !== "Item") return ui.notifications.warn("Можно перетаскивать только предметы.");

        const droppedItem = await Item.fromDropData(data);
        if (droppedItem.type !== "Skill") return ui.notifications.warn("Можно перетаскивать только предметы типа 'Скилл'.");

        // Определяем массив для сохранения (Skills или Base Perks)
        const target = "system.Skills";

        // Получаем текущий массив, или создаем новый, если он пустой
        const itemsArray = foundry.utils.getProperty(this.item, target) || [];

        // Добавляем предмет в массив
        itemsArray.push(droppedItem.toObject());

        // Обновляем соответствующий массив в данных предмета
        await this.item.update({ [target]: itemsArray });

        ui.notifications.info(`${droppedItem.name} добавлен в класс.`);
    }
    
    async _onDeleteSkillClick(event) {
        event.preventDefault();
    
        // Получаем ID предмета и целевой массив из атрибутов кнопки
        const targetArray = event.currentTarget.dataset.array;
        const itemId = event.currentTarget.dataset.id;
        console.log(itemId);
        console.log(targetArray);
    
        // Подтверждение удаления с использованием диалогового окна
        const confirmed = await Dialog.confirm({
          title: "Подтверждение удаления",
          content: "<p>Вы уверены, что хотите удалить этот скилл?</p>",
          yes: () => true,
          no: () => false,
          defaultYes: false
        });
    
        if (!confirmed) return;
    
        // Получаем массив, который нужно обновить (skills или basePerks)
        const path = `system.${targetArray}`;
        const itemsArray = foundry.utils.getProperty(this.item, path) || [];
    
        // Фильтруем массив, удаляя элемент с нужным `_id`
        const updatedArray = itemsArray.filter(item => item._id !== itemId);
    
        // Обновляем соответствующий массив в данных предмета
        await this.item.update({ [path]: updatedArray });
    
        ui.notifications.info("Скилл успешно удален.");
      }
}