document.addEventListener('DOMContentLoaded', () => {
  const actor = game.actors.get(actorId);
  if (!actor) {
    console.error(`Actor with ID ${actorId} not found!`);
    return;
  }

  console.log(`Actor found: ${actor.name}`);
  console.log(`Actor debuffs: `, actor.data.data.debuffs);

  const effectElements = document.querySelectorAll('.effect');

  effectElements.forEach(element => {
    const effectName = element.getAttribute('data-effect');
    const decrementButton = element.querySelector('.decrement');
    const incrementButton = element.querySelector('.increment');
    const stateDisplay = element.querySelector('.state-display');
    const stateText = element.querySelector('.state-text');

    // Инициализация значения эффекта из данных актора
    const currentState = actor.data.data.debuffs[effectName]?.state || 0;
    stateDisplay.textContent = currentState;
    updateStateText(stateText, currentState, actor.data.data.debuffs[effectName]);

    console.log(`Initializing ${effectName} with state ${currentState}`);

    decrementButton.addEventListener('click', () => updateEffectState(effectName, stateDisplay, stateText, -1));
    incrementButton.addEventListener('click', () => updateEffectState(effectName, stateDisplay, stateText, 1));
  });

  async function updateEffectState(effectName, displayElement, textElement, change) {
    const currentState = parseInt(displayElement.textContent);
    const newState = Math.max(0, currentState + change);
    displayElement.textContent = newState;

    console.log(`Updating ${effectName} to new state ${newState}`);

    // Обновите состояние эффекта в данных актора
    const effectPath = `data.debuffs.${effectName}.state`;
    try {
      await actor.update({ [effectPath]: newState });
      updateStateText(textElement, newState, actor.data.data.debuffs[effectName]);
      console.log(`Updated ${effectName} to ${newState} in actor data`);
    } catch (err) {
      console.error(`Failed to update ${effectName} for actor: `, err);
    }
  }

  function updateStateText(textElement, state, effectData) {
    switch (state) {
      case 1:
        textElement.textContent = effectData.state1;
        break;
      case 2:
        textElement.textContent = effectData.state2;
        break;
      case 3:
        textElement.textContent = effectData.state3;
        break;
      default:
        textElement.textContent = '';
        break;
    }
  }
});
