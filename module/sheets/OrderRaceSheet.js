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
        html.find(".skill-link").click(this._onSkillLinkClick.bind(this));
        // Переопределяем кнопку добавления бонусов
        html.find('.modify-advantage-button').off('click').click(() => this._addingRaceBonus());
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
    async _onSkillLinkClick(event) {
        event.preventDefault();

        // Получаем ID скилла из атрибута `data-skill-id`
        const skillId = event.currentTarget.dataset.skillId;

        // Находим нужный предмет в базе данных по ID
        const skillItem = game.items.get(skillId) || this.actor?.items.get(skillId);

        if (!skillItem) {
            return ui.notifications.warn("Скилл не найден.");
        }

        // Открываем лист предмета
        skillItem.sheet.render(true);
    }
        async _addingRaceBonus() {
        const template = Handlebars.compile(`
        <div class="race-bonus-dialog">
            <div class="form-group">
                <label>Значение</label>
                <input type="number" class="bonus-value" value="2"/>
            </div>
            <div class="form-group fixed-fields">
                <select class="char-first">
                    {{#each characteristics}}
                        <option value="{{this}}">{{localize this}}</option>
                    {{/each}}
                </select>
                <select class="char-second">
                    {{#each characteristics}}
                        <option value="{{this}}">{{localize this}}</option>
                    {{/each}}
                </select>
            </div>
            <div class="form-group">
                <label><input type="checkbox" class="flexible-choice"/> Выбрать при переносе</label>
            </div>
            <div class="form-group flexible-fields" style="display:none;">
                <label>Количество характеристик:</label>
                <select class="char-count">
                    <option value="1">1</option>
                    <option value="2" selected>2</option>
                </select>
            </div>
        </div>`);

        const html = template(this.getData());

        new Dialog({
            title: "Добавление бонуса",
            content: html,
            buttons: {
                save: {
                    label: "Сохранить",
                    callback: (html) => {
                        const value = parseInt(html.find('.bonus-value').val()) || 0;
                        const isFlexible = html.find('.flexible-choice').is(':checked');
                        if (isFlexible) {
                            const count = parseInt(html.find('.char-count').val()) || 1;
                            const data = { value: value, flexible: true, count: count };
                            this._onAddAdvantage(data);
                        } else {
                            const c1 = html.find('.char-first').val();
                            const c2 = html.find('.char-second').val();
                            if (c1 === c2) {
                                ui.notifications.warn('Выберите разные характеристики.');
                                return false;
                            }
                            const data = { characters: [c1, c2], value: value, allowSplit: true };
                            this._onAddAdvantage(data);
                        }
                    }
                },
                cancel: { label: "Отмена" }
            },
            default: "save",
            render: (html) => {
                html.find('.flexible-choice').on('change', ev => {
                    const checked = html.find('.flexible-choice').is(':checked');
                    if (checked) {
                        html.find('.flexible-fields').show();
                        html.find('.fixed-fields').hide();
                    } else {
                        html.find('.flexible-fields').hide();
                        html.find('.fixed-fields').show();
                    }
                });
            }
        }).render(true);
    }
}
