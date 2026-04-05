// nav.js — Application navigation controller.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Builds the nav rail and manages section show/hide state.
// Called from app.js init() via mountNavigation().

const NAV_STORAGE_KEY = 'orgchart-active-section';

const NAV_SECTIONS = [
  { id: 'presentation', label: 'Presentation', icon: '◈' },
  { id: 'configuration', label: 'Configuration', icon: '⚙' },
  { id: 'records', label: 'Records', icon: '◳' },
  { id: 'knowledge', label: 'Knowledge', icon: '◉' },
  { id: 'technology', label: 'Technology', icon: '◫' },
  { id: 'diagnostics', label: 'Diagnostics', icon: '◎' },
];

let activeSectionId = 'configuration';

// Activates the given section: shows its container, hides all others,
// and updates the nav rail active state. Persists to localStorage.
function navigateTo(sectionId) {
  const valid = NAV_SECTIONS.some(s => s.id === sectionId);
  if (!valid) return;

  activeSectionId = sectionId;

  // Toggle section visibility
  for (const section of NAV_SECTIONS) {
    const el = document.getElementById(`section-${section.id}`);
    if (el) el.classList.toggle('app-section--active', section.id === sectionId);
  }

  // Update nav item active state
  const nav = document.getElementById('app-nav');
  if (nav) {
    for (const btn of nav.querySelectorAll('.app-nav-item')) {
      btn.classList.toggle('app-nav-item--active', btn.dataset.section === sectionId);
      btn.setAttribute('aria-current', btn.dataset.section === sectionId ? 'page' : 'false');
    }
  }

  try {
    localStorage.setItem(NAV_STORAGE_KEY, sectionId);
  } catch { /* non-fatal */ }
}

// Builds the nav rail buttons and restores the last active section.
// Called once from app.js init() after panels have been mounted.
function mountNavigation() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  nav.replaceChildren(...NAV_SECTIONS.map(section => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-nav-item';
    btn.dataset.section = section.id;
    btn.setAttribute('aria-current', 'false');
    btn.addEventListener('click', () => navigateTo(section.id));

    const icon = document.createElement('span');
    icon.className = 'app-nav-item-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = section.icon;

    const label = document.createElement('span');
    label.className = 'app-nav-item-label';
    label.textContent = section.label;

    btn.append(icon, label);
    return btn;
  }));

  // Restore last active section, defaulting to 'configuration'
  let restored = 'configuration';
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (saved && NAV_SECTIONS.some(s => s.id === saved)) restored = saved;
  } catch { /* non-fatal */ }

  navigateTo(restored);
}
