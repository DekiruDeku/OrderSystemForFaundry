// NOTE: Actor sheets initialize tabs inside the sheet class.
// This helper is kept only to prevent crashes if the file is still loaded.
(function safeTabsInit() {
  const linksOfTabs = document.querySelectorAll('.tabs_side-menu .navbar');
  const tabs = document.querySelectorAll('.tab-bar');

  if (!linksOfTabs?.length || !tabs?.length) return;

  linksOfTabs.forEach(link => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const targetTab = link.getAttribute('data-tab');
      if (!targetTab) return;

      tabs.forEach(tab => tab.classList.remove('active'));
      linksOfTabs.forEach(l => l.classList.remove('active'));

      const targetEl = document.getElementById(targetTab);
      link.classList.add('active');
      if (targetEl) targetEl.classList.add('active');
    });
  });
})();
