effects = {
    "Fear": {
        "name": "Страх",
        "state": 0,
        "state1": "Легкий страх: +5 стресса/ход, -2 на АТАКУ",
        "state2": "Ужас +10 стресса/ход -4 на АТАКУ",
        "state3": "Дрожь души +15 стресса/ход -8 на АТАКУ"
    },
    "Trauma": {
        "name": "Травма",
        "state": 0,
        "state1": "Травмированная конечность: • Если рука -1 на атаку этой конечностью • Если нога - 1 на ловкость",
        "state2": "Сломанная конечность: • Если рука -3 на атаку этой конечностью • Если нога -3 на ловкость",
        "state3": "Потерянная конечность • Если рука -рука, потеря оружия, что держала эта рука • Если нога -нога, неспособность к нормальному перемещению"
    },
    "Dizziness": {
        "name": "Ошеломление",
        "state": 0,
        "state1": "Ошеломление: -2 на действия",
        "state2": "Сотрясение: -5 на действия",
        "state3": "Черепно-мозговая -10 на действия, -3 на перемещения"
    },
    "Stunned": {
        "name": "Оглушение",
        "state": 0,
        "state1": "Легкое оглушение: Пропуск 1 хода",
        "state2": "Среднее оглушение: Пропуск от 1го до 3х ходов",
        "state3": "Мощное оглушение: Пропуск от 1го до 5ти ходов Во время оглушения персонаж каждый ход кидает кубик с бонусом вынос- ливости, в случае успеха - он приходит в себя. Последующие оглушения менее эффективны первого."
    },
    "MagicDebuff": {
        "name": "Магическая усталость",
        "state": 0,
        "state1": "Магическая усталость: -3 на действия",
        "state2": "Магическая изнеможденность: -6 на действия",
        "state3": "Магическая ломка: -12 на действия"
    },
    "Poisoned": {
        "name": "Отравление",
        "state": 0,
        "state1": "Легкое отравление: -10 хп/ход через броню.",
        "state2": "Среднее отравление: -20 хп/ход через броню.",
        "state3": "Сильное отравление: -30 хп/ход через броню."
    },
    "Bleeding": {
        "name": "Кровотечение",
        "state": 0,
        "state1": "Сильное отравление: -30 хп/ход через броню.",
        "state2": "Среднее кровотечение: -20 хп/ход через броню.",
        "state3": "Обильное кровотечение: -30 хп/ход через броню."
    }
};


effectSelect = document.getElementById('effect-select');
stateDisplay = document.getElementById('state-display');
effectDescription = document.getElementById('effect-description');
decrementButton = document.getElementById('decrement');
incrementButton = document.getElementById('increment');

function updateEffectDisplay() {
    const selectedEffect = effectSelect.value;
    const effect = effects[selectedEffect];
    stateDisplay.textContent = effect.state;
    let description = '';
    switch (effect.state) {
        case 1:
            description = effect.state1;
            break;
        case 2:
            description = effect.state2;
            break;
        case 3:
            description = effect.state3;
            break;
        default:
            description = 'Нет эффекта';
    }
    effectDescription.textContent = description;
}

effectSelect.addEventListener('change', updateEffectDisplay);

decrementButton.addEventListener('click', () => {
    const selectedEffect = effectSelect.value;
    const effect = effects[selectedEffect];
    if (effect.state > 0) {
        effect.state -= 1;
        updateEffectDisplay();
    }
});

incrementButton.addEventListener('click', () => {
    const selectedEffect = effectSelect.value;
    const effect = effects[selectedEffect];
    if (effect.state < 3) {
        effect.state += 1;
        updateEffectDisplay();
    }
});

// Инициализация начального отображения
updateEffectDisplay();
