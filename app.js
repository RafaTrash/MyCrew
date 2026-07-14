function bindMenu() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (!target) return;
      setActivePage(target);
    });
  });

  // Add new menu item for "Projetos"
  const projectsBtn = document.createElement('button');
  projectsBtn.className = 'nav-item';
  projectsBtn.setAttribute('data-target', 'projects');
  projectsBtn.textContent = 'Projetos';
  projectsBtn.addEventListener('click', () => setActivePage('projects'));

  // Append the new button to the menu
  const menuContainer = document.querySelector('.menu-container');
  if (menuContainer) {
    menuContainer.appendChild(projectsBtn);
  }
}
