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
        html.find('.modify-advantage-button').click(() => this._addingParameters());
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

    async _addingParameters() {
        const template = Handlebars.compile(`
    <div class="advantage-field">
        <select name="data.AdvantageCharacteristic" class="advantage-select">
            {{#each characteristics}}
            <option value="{{this}}" {{#if (isSelected this ../data.AdvantageCharacteristic)}}selected{{/if}}>{{this}}</option>
            {{/each}}
        </select>
        <div class="advantage-modifier">
            <button type="button" class="advantage-modifier-minus">-</button>
            <input name="data.Parameters" type="text" value="{{data.Parameters}}" data-type="Number" readonly />
            <button type="button" class="advantage-modifier-plus">+</button>
        </div>
    </div>
`);
        const html = template(this.getData());

        new Dialog({
            title: "Добавление новых параметров",
            content: html,
            buttons: {
                save: {
                    label: "Сохранить",
                    callback: (html) => {
                        // Собираем данные из формы
                        const characteristic = html.find(".advantage-select").val();
                        const parametersValue = parseInt(html.find("input[name='data.Parameters']").val(), 10) || 0;

                        // Создаём объект для записи
                        const data = { Characteristic: characteristic, Value: parametersValue };

                        // Передаём объект в функцию
                        this._onAddAdvantage(data);
                    },
                },
                cancel: { label: "Отмена" }
            },
            default: "ok",
            render: (html) => {
                html.find(".advantage-modifier-plus").on("click", () => {
                    const input = html.find("input[name='data.Parameters']");
                    const currentValue = parseInt(input.val(), 10) || 0;
                    input.val(currentValue + 1);
                });

                html.find(".advantage-modifier-minus").on("click", () => {
                    const input = html.find("input[name='data.Parameters']");
                    const currentValue = parseInt(input.val(), 10) || 0;
                    input.val(currentValue - 1);
                });
            }
        }).render(true);
    }
}
