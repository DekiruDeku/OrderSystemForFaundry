// Get all navigation links and tab content elements
const linksOfTabs = document.querySelectorAll('.tabs_side-menu .navbar');
const tabs = document.querySelectorAll('.tab-bar');

// Add click event listener to each tab link
linksOfTabs.forEach(link => {
  link.addEventListener('click', (event) => {
    // Prevent default link behavior
    event.preventDefault();

    // Get the target tab id
    const targetTab = link.getAttribute('data-tab');

    // Remove 'active' class from all tabs and links
    tabs.forEach(tab => tab.classList.remove('active'));
    linksOfTabs.forEach(link => link.classList.remove('active'));

    // Add 'active' class to the clicked link and corresponding tab
    link.classList.add('active');
    document.getElementById(targetTab).classList.add('active');
    console.log("switch");
  });
});

// Activate the first tab by default
linksOfTabs[0].classList.add('active');
tabs[0].classList.add('active');
