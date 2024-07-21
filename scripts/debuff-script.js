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

    // Инициализация значения эффекта из данных актора
    const currentState = actor.data.data.debuffs[effectName]?.state || 0;
    stateDisplay.textContent = currentState;

    console.log(`Initializing ${effectName} with state ${currentState}`);

    decrementButton.addEventListener('click', () => updateEffectState(effectName, stateDisplay, -1));
    incrementButton.addEventListener('click', () => updateEffectState(effectName, stateDisplay, 1));
  });

  async function updateEffectState(effectName, displayElement, change) {
    const currentState = parseInt(displayElement.textContent);
    const newState = Math.max(0, currentState + change);
    displayElement.textContent = newState;

    console.log(`Updating ${effectName} to new state ${newState}`);

    // Обновите состояние эффекта в данных актора
    const effectPath = `data.debuffs.${effectName}.state`;
    try {
      await actor.update({ [effectPath]: newState });
      console.log(`Updated ${effectName} to ${newState} in actor data`);
    } catch (err) {
      console.error(`Failed to update ${effectName} for actor: `, err);
    }
  }
});
