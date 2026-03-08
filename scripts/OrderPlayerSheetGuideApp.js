const GUIDE_PAGES = [
  {
    id: "welcome",
    title: "Добро пожаловать в Guide",
    icon: "fa-solid fa-book-open",
    selector: null,
    focusLabel: "Общий обзор листа персонажа",
    body: `
      <p>Этот туториал проводит по основным зонам листа персонажа и показывает, где находится ключевая информация и основные действия.</p>
      <p>На каждом шаге всё лишнее затемняется, а нужная зона остаётся видимой. Так проще сразу понять, куда смотреть.</p>
      <div class="os-guide-note">
        <strong>Что будет дальше:</strong> ресурсы, правая верхняя панель, характеристики, круги обучения и все четыре раздела левого меню.
      </div>
    `
  },
  {
    id: "resources",
    title: "Ресурсы персонажа",
    icon: "fa-solid fa-heart-pulse",
    selector: ".os-mid-left",
    focusLabel: "Блок ресурсов слева от портрета",
    body: `
      <p><strong>Здоровье</strong> показывает, сколько урона персонаж может выдержать. Максимум считается автоматически: база <strong>100</strong> + бонусы от <strong>ранга</strong>, <strong>Выносливости</strong>, класса, перков и эффектов.</p>
      <p><strong>Магическая усталость</strong> показывает накопленное магическое перенапряжение. Её предел считается автоматически по формуле <strong>3 + Магия + Выносливость</strong> и тоже может меняться эффектами, классом и перками.</p>
      <p><strong>Стресс</strong> отражает психическую нагрузку персонажа. Обычно его предел равен <strong>100</strong>, но отдельные эффекты могут его менять.</p>
      <div class="os-guide-note">
        Левое число — текущее значение, правое — максимум. Максимумы этих ресурсов обычно растут не ручным вводом, а через развитие персонажа и системные бонусы.
      </div>
    `
  },
  {
    id: "meta",
    title: "Ранг, раса, класс и скорость",
    icon: "fa-solid fa-id-card",
    selector: ".os-mid-right",
    focusLabel: "Правая верхняя панель рядом с портретом",
    body: `
      <p><strong>Ранг</strong> показывает общий уровень развития персонажа. Он влияет на прогрессию и связанные с ней системные значения. Кнопка со стрелкой используется для повышения ранга и открытия соответствующей логики повышения.</p>
      <p><strong>Раса</strong> и <strong>Класс</strong> отображаются отдельными карточками. Это важные базовые элементы персонажа: они задают часть бонусов, ограничений и особенностей билда. По карточкам можно открыть связанные элементы и посмотреть их подробнее.</p>
      <p><strong>Скорость</strong> показывает текущее значение перемещения персонажа. Рядом отображается сумма модификаторов, а при наведении можно посмотреть, какие эффекты её меняют.</p>
      <div class="os-guide-note">
        Этот блок нужен для быстрого чтения общей сборки персонажа: кем он является, какого он ранга и как быстро двигается прямо сейчас.
      </div>
    `
  },
  {
    id: "stats",
    title: "Характеристики, тренировка и броски",
    icon: "fa-solid fa-dice-d20",
    selector: ".os-right .os-panel-right",
    focusLabel: "Правая панель характеристик",
    body: `
      <p>Здесь находятся основные характеристики персонажа. У каждой строки есть <strong>круг прогресса</strong>, <strong>название</strong>, <strong>иконка кубика</strong>, <strong>значение</strong> и <strong>сумма модификаторов</strong>.</p>
      <p><strong>Нажатие на название характеристики</strong> открывает окно тренировки этой характеристики.</p>
      <p><strong>Нажатие на иконку d20</strong> открывает выбор варианта броска:</p>
      <ul>
        <li><strong>Бросок без модификатора</strong> — d20 + базовое значение характеристики, без дополнительных бонусов и штрафов от системных модификаторов.</li>
        <li><strong>Бросок с модификатором</strong> — d20 + значение характеристики + системные модификаторы этой характеристики + вручную добавленные модификаторы из окна броска.</li>
      </ul>
      <p><strong>Модификатор</strong> — это любой дополнительный бонус или штраф от эффектов, предметов, состояний и других источников. Число рядом с характеристикой показывает их общую сумму, а при наведении можно посмотреть источники.</p>
    `
  },
  {
    id: "training-circles",
    title: "Круги очков обучения",
    icon: "fa-regular fa-circle-dot",
    selector: ".os-right .circle-progress",
    focusLabel: "Круги прогресса у характеристик",
    body: `
      <p>Круг рядом с каждой характеристикой показывает <strong>очки обучения</strong> для продвижения этой характеристики к следующему значению.</p>
      <ul>
        <li><strong>ЛКМ по кругу</strong> — добавить одно очко обучения.</li>
        <li><strong>ПКМ по кругу</strong> — убрать одно очко обучения.</li>
      </ul>
      <p>Когда круг заполняется полностью, значение характеристики <strong>увеличивается на 1</strong>, а сам круг прогресса сбрасывается и начинается заново уже для следующего уровня.</p>
      <div class="os-guide-note">
        Это быстрый визуальный способ отслеживать прогресс прокачки без открытия дополнительных окон.
      </div>
    `
  },
  {
    id: "biography",
    title: "Левое меню: Биография",
    icon: "fa-solid fa-user",
    tab: "biography",
    selector: '.tabs_side-menu .navbar[data-tab="biography"], #biography',
    focusLabel: "Вкладка Биография",
    body: `
      <p>Во вкладке <strong>Биография</strong> хранится описательная информация о персонаже: прозвище, фракция, звание, возраст, день рождения, рост, вес, ориентация и другие личные данные.</p>
      <p>Ниже идут большие текстовые поля: <strong>биография</strong>, <strong>позитивные и негативные черты</strong>, <strong>страхи</strong> и <strong>дополнительная информация</strong>.</p>
      <div class="os-guide-note">
        Этот раздел нужен для ролевой части игры и для того, чтобы мастер и игрок быстро держали перед глазами важный лор персонажа.
      </div>
    `
  },
  {
    id: "inventory",
    title: "Левое меню: Инвентарь",
    icon: "fa-solid fa-box-open",
    tab: "inventory",
    selector: '.tabs_side-menu .navbar[data-tab="inventory"], #inventory',
    focusLabel: "Вкладка Инвентарь",
    body: `
      <p>Во вкладке <strong>Инвентарь</strong> показываются ГАЦы, грузоподъёмность, вместимость и все ячейки предметов.</p>
      <p>Здесь можно работать с предметами через <strong>drag-and-drop</strong>, открывать их, а также удалять через кнопку с крестиком на слоте.</p>
      <ul>
        <li><strong>Синие ячейки</strong> — обычные ячейки инвентаря.</li>
        <li><strong>Зелёные ячейки</strong> — ячейки быстрого доступа.</li>
        <li><strong>Оранжевые ячейки</strong> — хранилище.</li>
        <li><strong>Фиолетовые ячейки</strong> — блок «Используется».</li>
      </ul>
      <div class="os-guide-note">
        Этот раздел нужен для всего предметного менеджмента персонажа: переносов, хранения и подготовки предметов к использованию.
      </div>
    `
  },
  {
    id: "equipment",
    title: "Левое меню: Снаряжение",
    icon: "fa-solid fa-shield-halved",
    tab: "equipment",
    selector: '.tabs_side-menu .navbar[data-tab="equipment"], #equipment',
    focusLabel: "Вкладка Снаряжение",
    body: `
      <p>Во вкладке <strong>Снаряжение</strong> отображаются боевые предметы персонажа: <strong>основное оружие</strong>, <strong>вторичное оружие</strong>, <strong>холодное оружие</strong> и <strong>броня</strong>.</p>
      <p>Это боевой раздел листа: отсюда удобно быстро смотреть, что сейчас надето и чем персонаж может атаковать.</p>
      <p>Для холодного оружия здесь также вынесена кнопка <strong>импровизированной атаки</strong>.</p>
      <div class="os-guide-note">
        Когда нужен быстрый доступ к экипированным боевым предметам, обычно работают именно из этой вкладки.
      </div>
    `
  },
  {
    id: "skills",
    title: "Левое меню: Способности, заклинания и перки",
    icon: "fa-solid fa-wand-sparkles",
    tab: "skills",
    selector: '.tabs_side-menu .navbar[data-tab="skills"], #skills',
    focusLabel: "Вкладка Способности",
    body: `
      <p>Во вкладке <strong>Способности</strong> собраны <strong>способности</strong>, <strong>заклинания</strong> и <strong>перки</strong>, сгруппированные по кругам.</p>
      <ul>
        <li><strong>Клик по кубику</strong> — выполнить бросок или начать применение.</li>
        <li><strong>Двойной клик по карточке</strong> — открыть предмет для просмотра или редактирования.</li>
        <li><strong>ПКМ по способности или заклинанию</strong> — отправить карточку в чат с названием, изображением, описанием и выбранными полями из tooltip.</li>
      </ul>
      <div class="os-guide-note">
        Эта вкладка используется в бою и вне боя чаще всего, потому что именно здесь лежит почти весь активный инструментарий персонажа.
      </div>
    `
  }
];

export class OrderPlayerSheetGuideApp extends Application {
  constructor(sheet, options = {}) {
    options.id ??= `order-player-sheet-guide-${sheet?.actor?.id ?? foundry.utils.randomID()}`;
    super(options);
    this.sheet = sheet;
    this.pageIndex = 0;
    this._originalTab = this._getCurrentTabId();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["Order", "app", "os-player-guide"],
      title: "Guide",
      template: "systems/Order/templates/apps/player-sheet-guide.hbs",
      width: 460,
      height: 470,
      minWidth: 420,
      minHeight: 420,
      resizable: true,
      popOut: true
    });
  }

  get pages() {
    return GUIDE_PAGES;
  }

  getData() {
    const pages = this.pages;
    const page = pages[this.pageIndex] ?? pages[0];
    return {
      page,
      pages: pages.map((p, index) => ({
        ...p,
        index,
        isActive: index === this.pageIndex
      })),
      pageIndex: this.pageIndex,
      pageNumber: this.pageIndex + 1,
      pageCount: pages.length,
      isFirst: this.pageIndex <= 0,
      isLast: this.pageIndex >= pages.length - 1
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('[data-action="prev"]').on('click', (event) => {
      event.preventDefault();
      this._setPage(this.pageIndex - 1);
    });

    html.find('[data-action="next"]').on('click', (event) => {
      event.preventDefault();
      this._setPage(this.pageIndex + 1);
    });

    html.find('[data-action="close-guide"]').on('click', (event) => {
      event.preventDefault();
      this.close();
    });

    html.find('[data-action="jump-page"]').on('click', (event) => {
      event.preventDefault();
      const idx = Number(event.currentTarget?.dataset?.pageIndex);
      if (Number.isFinite(idx)) this._setPage(idx);
    });
  }

  async _render(...args) {
    const rendered = await super._render(...args);
    this.applyCurrentStepHighlight();
    return rendered;
  }

  _setPage(nextIndex) {
    const max = this.pages.length - 1;
    const clamped = Math.max(0, Math.min(max, Number(nextIndex) || 0));
    if (clamped === this.pageIndex) return;
    this.pageIndex = clamped;
    this.render(false);
  }

  applyCurrentStepHighlight() {
    this.clearHighlight();

    const page = this.pages[this.pageIndex];
    const $sheet = this.sheet?.element;
    if (!$sheet?.length) return;

    this._activatePageTab(page);

    if (!page?.selector) return;

    const $targets = $sheet.find(page.selector).filter(':visible');
    const $windowContent = $sheet.find('.window-content').first();
    if (!$targets.length || !$windowContent.length) return;

    $sheet.addClass('os-guide-active');
    $targets.addClass('os-guide-focus');
    this._renderOverlay($windowContent, $targets);
  }

  _activatePageTab(page) {
    if (!page?.tab || !this.sheet?.element?.length) return;

    const $sheet = this.sheet.element;
    const $tabLink = $sheet.find(`.tabs_side-menu .navbar[data-tab="${page.tab}"]`).first();
    const $tabContent = $sheet.find(`#${page.tab}`).first();
    if (!$tabLink.length || !$tabContent.length) return;

    const $allLinks = $sheet.find('.tabs_side-menu .navbar');
    const $allTabs = $sheet.find('.tab-bar');

    $allLinks.removeClass('active');
    $allTabs.removeClass('active');
    $tabLink.addClass('active');
    $tabContent.addClass('active');

    try {
      localStorage.setItem('lastActiveTab', page.tab);
    } catch (_err) {
      // ignore storage errors
    }
  }

  _renderOverlay($windowContent, $targets) {
    const windowContent = $windowContent?.[0];
    const targets = $targets?.toArray?.() ?? [];
    if (!windowContent || !targets.length) return;

    const wcRect = windowContent.getBoundingClientRect();
    const visibleRects = targets
      .map((el) => el?.getBoundingClientRect?.())
      .filter((rect) => rect && rect.width > 0 && rect.height > 0);

    if (!visibleRects.length) return;

    const union = visibleRects.reduce((acc, rect) => ({
      left: Math.min(acc.left, rect.left),
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.right),
      bottom: Math.max(acc.bottom, rect.bottom)
    }), {
      left: visibleRects[0].left,
      top: visibleRects[0].top,
      right: visibleRects[0].right,
      bottom: visibleRects[0].bottom
    });

    const pad = 10;
    const left = Math.max(0, Math.round(union.left - wcRect.left - pad));
    const top = Math.max(0, Math.round(union.top - wcRect.top - pad));
    const right = Math.min(Math.round(wcRect.width), Math.round(union.right - wcRect.left + pad));
    const bottom = Math.min(Math.round(wcRect.height), Math.round(union.bottom - wcRect.top + pad));

    const overlay = $('<div class="os-guide-overlay-root" aria-hidden="true"></div>');
    const pieces = [
      { cls: 'top', style: { left: 0, top: 0, width: '100%', height: `${top}px` } },
      { cls: 'left', style: { left: 0, top: `${top}px`, width: `${left}px`, height: `${Math.max(0, bottom - top)}px` } },
      { cls: 'right', style: { left: `${right}px`, top: `${top}px`, width: `${Math.max(0, wcRect.width - right)}px`, height: `${Math.max(0, bottom - top)}px` } },
      { cls: 'bottom', style: { left: 0, top: `${bottom}px`, width: '100%', height: `${Math.max(0, wcRect.height - bottom)}px` } }
    ];

    for (const piece of pieces) {
      $('<div class="os-guide-overlay-piece"></div>')
        .addClass(`os-guide-overlay-${piece.cls}`)
        .css(piece.style)
        .appendTo(overlay);
    }

    $windowContent.append(overlay);
    this._overlayRoot = overlay;
  }

  _getCurrentTabId() {
    const $sheet = this.sheet?.element;
    if (!$sheet?.length) return null;
    return $sheet.find('.tabs_side-menu .navbar.active').first().data('tab')
      || $sheet.find('.tab-bar.active').first().attr('id')
      || null;
  }

  _restoreOriginalTab() {
    if (!this._originalTab || !this.sheet?.element?.length) return;
    this._activatePageTab({ tab: this._originalTab });
  }

  clearHighlight() {
    const $sheet = this.sheet?.element;
    this._overlayRoot?.remove?.();
    this._overlayRoot = null;
    if (!$sheet?.length) return;
    $sheet.removeClass('os-guide-active');
    $sheet.find('.os-guide-focus').removeClass('os-guide-focus');
  }

  async close(options = {}) {
    this.clearHighlight();
    this._restoreOriginalTab();
    if (this.sheet) this.sheet._guideApp = null;
    return super.close(options);
  }
}
