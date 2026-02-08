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

        ui.notifications.info(`${droppedItem.name} добавлен в расу.`);
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
            <div class="form-group" style="margin-bottom:12px;">
                <div style="font-weight:700; margin-bottom:6px;">Вариант A</div>

                <label style="display:block; margin-bottom:4px;">Тип бонуса</label>
                <select class="optA-type" style="width:100%;">
                    <option value="pair" selected>Выбор из 2 характеристик (или разделить)</option>
                    <option value="single">Фикс: к 1 характеристике</option>
                    <option value="flex">Выбрать при переносе (к N характеристикам)</option>
                </select>

                <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                    <div style="flex:0 0 120px;">Значение</div>
                    <input type="number" class="optA-value" value="2" style="flex:1;"/>
                </div>

                <div class="optA-single-fields" style="display:none; margin-top:8px;">
                    <label style="display:block; margin-bottom:4px;">Характеристика</label>
                    <select class="optA-char-single" style="width:100%;">
                        {{#each characteristics}}
                            <option value="{{this}}">{{localize this}}</option>
                        {{/each}}
                    </select>
                </div>

                <div class="optA-pair-fields" style="margin-top:8px;">
                    <label style="display:block; margin-bottom:4px;">Две характеристики</label>
                    <div style="display:flex; gap:8px;">
                      <select class="optA-char-first" style="flex:1;">
                          {{#each characteristics}}
                              <option value="{{this}}">{{localize this}}</option>
                          {{/each}}
                      </select>
                      <select class="optA-char-second" style="flex:1;">
                          {{#each characteristics}}
                              <option value="{{this}}">{{localize this}}</option>
                          {{/each}}
                      </select>
                    </div>
                    <div style="font-size:12px; opacity:0.75; margin-top:6px;">При переносе игрок выбирает: первую / вторую / разделить поровну.</div>
                </div>

                <div class="optA-flex-fields" style="display:none; margin-top:8px;">
                    <label style="display:block; margin-bottom:4px;">На сколько характеристик выбрать</label>
                    <select class="optA-count" style="width:100%;">
                        <option value="1">1</option>
                        <option value="2" selected>2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                    </select>
                    <div style="font-size:12px; opacity:0.75; margin-top:6px;">Игрок выберет разные характеристики при переносе.</div>
                </div>
            </div>

            <hr style="margin:12px 0; opacity:0.35;"/>

            <div class="form-group" style="margin-bottom:10px;">
                <label style="display:flex; gap:8px; align-items:center;">
                    <input type="checkbox" class="use-alternative"/>
                    <span><b>Альтернатива</b> (выбор между вариантом A и B при переносе)</span>
                </label>
            </div>

            <div class="optB-wrapper" style="display:none;">
                <div class="form-group" style="margin-bottom:12px;">
                    <div style="font-weight:700; margin-bottom:6px;">Вариант B</div>

                    <label style="display:block; margin-bottom:4px;">Тип бонуса</label>
                    <select class="optB-type" style="width:100%;">
                        <option value="single" selected>Фикс: к 1 характеристике</option>
                        <option value="pair">Выбор из 2 характеристик (или разделить)</option>
                        <option value="flex">Выбрать при переносе (к N характеристикам)</option>
                    </select>

                    <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                        <div style="flex:0 0 120px;">Значение</div>
                        <input type="number" class="optB-value" value="1" style="flex:1;"/>
                    </div>

                    <div class="optB-single-fields" style="margin-top:8px;">
                        <label style="display:block; margin-bottom:4px;">Характеристика</label>
                        <select class="optB-char-single" style="width:100%;">
                            {{#each characteristics}}
                                <option value="{{this}}">{{localize this}}</option>
                            {{/each}}
                        </select>
                    </div>

                    <div class="optB-pair-fields" style="display:none; margin-top:8px;">
                        <label style="display:block; margin-bottom:4px;">Две характеристики</label>
                        <div style="display:flex; gap:8px;">
                          <select class="optB-char-first" style="flex:1;">
                              {{#each characteristics}}
                                  <option value="{{this}}">{{localize this}}</option>
                              {{/each}}
                          </select>
                          <select class="optB-char-second" style="flex:1;">
                              {{#each characteristics}}
                                  <option value="{{this}}">{{localize this}}</option>
                              {{/each}}
                          </select>
                        </div>
                        <div style="font-size:12px; opacity:0.75; margin-top:6px;">При переносе игрок выбирает: первую / вторую / разделить поровну.</div>
                    </div>

                    <div class="optB-flex-fields" style="display:none; margin-top:8px;">
                        <label style="display:block; margin-bottom:4px;">На сколько характеристик выбрать</label>
                        <select class="optB-count" style="width:100%;">
                            <option value="1">1</option>
                            <option value="2" selected>2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                        </select>
                        <div style="font-size:12px; opacity:0.75; margin-top:6px;">Игрок выберет разные характеристики при переносе.</div>
                    </div>
                </div>

                <div style="font-size:12px; opacity:0.75; margin-top:-6px;">Пример: <b>+2 к Силе</b> <i>ИЛИ</i> <b>+1 к двум характеристикам на выбор</b>.</div>
            </div>
        </div>`);

        const html = template(this.getData());

        const buildOption = (dlgHtml, prefix) => {
            const type = String(dlgHtml.find(`.${prefix}-type`).val() || '').trim();
            const value = parseInt(dlgHtml.find(`.${prefix}-value`).val(), 10) || 0;

            if (type === 'single') {
                const ch = dlgHtml.find(`.${prefix}-char-single`).val();
                if (!ch) return null;
                return { Characteristic: ch, Value: value };
            }

            if (type === 'flex') {
                const count = parseInt(dlgHtml.find(`.${prefix}-count`).val(), 10) || 1;
                return { flexible: true, value: value, count: count };
            }

            // default: pair
            const c1 = dlgHtml.find(`.${prefix}-char-first`).val();
            const c2 = dlgHtml.find(`.${prefix}-char-second`).val();
            if (!c1 || !c2) return null;
            if (c1 === c2) {
                ui.notifications.warn('Выберите разные характеристики.');
                return null;
            }
            return { characters: [c1, c2], value: value, allowSplit: true };
        };

        new Dialog({
            title: "Добавление бонуса",
            content: html,
            buttons: {
                save: {
                    label: "Сохранить",
                    callback: (dlgHtml) => {
                        const useAlt = dlgHtml.find('.use-alternative').is(':checked');
                        const optA = buildOption(dlgHtml, 'optA');
                        if (!optA) return false;

                        if (!useAlt) {
                            this._onAddAdvantage(optA);
                            return;
                        }

                        const optB = buildOption(dlgHtml, 'optB');
                        if (!optB) return false;

                        const data = {
                            alternative: true,
                            options: [optA, optB]
                        };
                        this._onAddAdvantage(data);
                    }
                },
                cancel: { label: "Отмена" }
            },
            default: "save",
            render: (dlgHtml) => {
                const syncOption = (prefix) => {
                    const type = String(dlgHtml.find(`.${prefix}-type`).val() || '').trim();
                    dlgHtml.find(`.${prefix}-single-fields`).toggle(type === 'single');
                    dlgHtml.find(`.${prefix}-pair-fields`).toggle(type === 'pair' || !type);
                    dlgHtml.find(`.${prefix}-flex-fields`).toggle(type === 'flex');
                };

                const syncAll = () => {
                    const useAlt = dlgHtml.find('.use-alternative').is(':checked');
                    dlgHtml.find('.optB-wrapper').toggle(!!useAlt);
                    syncOption('optA');
                    syncOption('optB');
                };

                dlgHtml.find('.optA-type').on('change', syncAll);
                dlgHtml.find('.optB-type').on('change', syncAll);
                dlgHtml.find('.use-alternative').on('change', syncAll);
                syncAll();
            }
        }).render(true);
    }
}
