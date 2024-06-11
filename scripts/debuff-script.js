document.addEventListener('DOMContentLoaded', () => {
    const effectSelect = document.getElementById('effect-select');
    const stateDisplay = document.getElementById('state-display');
    const effectDescription = document.getElementById('effect-description');
    const decrementButton = document.getElementById('decrement');
    const incrementButton = document.getElementById('increment');

    function updateEffectDisplay() {
        const selectedEffect = effectSelect.value;
        const effect = data[selectedEffect];
        console.log(effect);
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
        console.log("auhdgvucgvuhytdrycgvjhb");
        const selectedEffect = effectSelect.value;
        const effect = data[selectedEffect];
        console.log(effect);
        if (effect.state < 3) {
            effect.state += 1;
            updateEffectDisplay();
        }
    });

    // Инициализация начального отображения
    updateEffectDisplay();
})