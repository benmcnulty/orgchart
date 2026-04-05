// nav.js — Application navigation controller.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Builds the nav rail and manages section show/hide state.
// Called from app.js init() via mountNavigation().

const NAV_STORAGE_KEY = 'orgchart-active-app';
const NAV_COLLAPSED_KEY = 'orgchart-nav-collapsed';
const NAV_WIDTH_EXPANDED = 184;
const NAV_WIDTH_COLLAPSED = 40;

const NAV_SECTIONS = [
  { id: 'home', label: 'Home', icon: 'home', description: 'Launcher and current focus.' },
  { id: 'board', label: 'Board', icon: 'board', description: 'Executive control and live status.' },
  { id: 'setup', label: 'Setup', icon: 'setup', description: 'Guided onboarding and readiness.' },
  { id: 'organization', label: 'Organization', icon: 'organization', description: 'Agents, roles, teams, and structure.' },
  { id: 'messages', label: 'Messages', icon: 'messages', description: 'Direct conversations and ad hoc work.' },
  { id: 'workflows', label: 'Workflows', icon: 'workflows', description: 'Meetings, tasks, and projects.' },
  { id: 'resources', label: 'Resources', icon: 'resources', description: 'Inference, skills, and tools.' },
  { id: 'intranet', label: 'Intranet', icon: 'intranet', description: 'Knowledge, technology, and records.' },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', description: 'Pipeline, tracing, and deep inspection.' },
];

let activeAppId = 'home';
let navCollapsed = false;

function syncNavShellWidth() {
  const nav = document.getElementById('app-nav');
  const shell = document.querySelector('.app-shell');
  if (!nav || !shell) return;

  if (window.matchMedia('(max-width: 480px)').matches) {
    nav.style.width = '';
    nav.style.minWidth = '';
    shell.style.gridTemplateColumns = '';
    return;
  }

  const navWidth = navCollapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH_EXPANDED;
  nav.style.width = `${navWidth}px`;
  nav.style.minWidth = `${navWidth}px`;
  shell.style.gridTemplateColumns = `${navWidth}px minmax(0, 1fr)`;
}

function createAppIcon(name, className = 'app-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);

  const add = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.appendChild(node);
  };

  if (name === 'home') {
    add('path', { d: 'M4.5 10.5 12 4l7.5 6.5' });
    add('path', { d: 'M6.5 9.5V19h11V9.5' });
    add('path', { d: 'M10 19v-5h4v5' });
  } else if (name === 'board') {
    add('rect', { x: '4', y: '5', width: '16', height: '14', rx: '3' });
    add('path', { d: 'M8 9h8' });
    add('path', { d: 'M8 13h5' });
    add('circle', { cx: '16.5', cy: '13.5', r: '1.5' });
  } else if (name === 'setup') {
    add('circle', { cx: '12', cy: '12', r: '3.2' });
    add('path', { d: 'M12 3.8v2.1M12 18.1v2.1M4.9 6.2l1.6 1.2M17.5 16.6l1.6 1.2M3.8 12h2.1M18.1 12h2.1M4.9 17.8l1.6-1.2M17.5 7.4l1.6-1.2' });
  } else if (name === 'organization') {
    add('circle', { cx: '12', cy: '7', r: '2.5' });
    add('circle', { cx: '6.5', cy: '17', r: '2' });
    add('circle', { cx: '17.5', cy: '17', r: '2' });
    add('path', { d: 'M12 9.5v2.5M8 14h8M6.5 15v-1M17.5 15v-1' });
  } else if (name === 'messages') {
    add('path', { d: 'M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16h-5l-3.5 3v-3H7.5A2.5 2.5 0 0 1 5 13.5z' });
    add('path', { d: 'M8.5 9.5h7M8.5 12h5' });
  } else if (name === 'workflows') {
    add('rect', { x: '4', y: '6', width: '5', height: '5', rx: '1.4' });
    add('rect', { x: '15', y: '6', width: '5', height: '5', rx: '1.4' });
    add('rect', { x: '9.5', y: '14', width: '5', height: '5', rx: '1.4' });
    add('path', { d: 'M9 8.5h6M12 8.5V14' });
  } else if (name === 'resources') {
    add('rect', { x: '4', y: '5', width: '16', height: '14', rx: '3' });
    add('path', { d: 'M8 9h8M8 12h8M8 15h5' });
    add('circle', { cx: '17', cy: '15', r: '1.2' });
  } else if (name === 'intranet') {
    add('path', { d: 'M6 5.5h9.5l2.5 2.5V18.5A1.5 1.5 0 0 1 16.5 20h-10A1.5 1.5 0 0 1 5 18.5V7A1.5 1.5 0 0 1 6.5 5.5z' });
    add('path', { d: 'M15.5 5.5V8h2.5' });
    add('path', { d: 'M8 11h8M8 14h8M8 17h5' });
  } else if (name === 'diagnostics') {
    add('path', { d: 'M5 16.5 9 12l3 3 5-6 2 2' });
    add('path', { d: 'M5 5v14h14' });
  }

  return svg;
}

// Activates the given section: shows its container, hides all others,
// and updates the nav rail active state. Persists to localStorage.
function navigateTo(sectionId) {
  const valid = NAV_SECTIONS.some(s => s.id === sectionId);
  if (!valid) return;

  activeAppId = sectionId;

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

function setNavCollapsed(nextCollapsed) {
  navCollapsed = Boolean(nextCollapsed);
  const nav = document.getElementById('app-nav');
  const shell = document.querySelector('.app-shell');
  if (nav) {
    nav.classList.toggle('app-nav--collapsed', navCollapsed);
  }
  if (shell) {
    shell.classList.toggle('app-shell--nav-collapsed', navCollapsed);
  }
  syncNavShellWidth();
  const toggle = document.getElementById('app-nav-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(navCollapsed));
    toggle.setAttribute('aria-label', navCollapsed ? 'Expand navigation' : 'Collapse navigation');
    toggle.title = navCollapsed ? 'Expand navigation' : 'Collapse navigation';
    toggle.textContent = navCollapsed ? '›' : '‹';
  }
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, String(navCollapsed));
  } catch { /* non-fatal */ }
}

// Builds the nav rail buttons and restores the last active section.
// Called once from app.js init() after panels have been mounted.
function mountNavigation() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  const head = document.createElement('div');
  head.className = 'app-nav-head';

  const title = document.createElement('span');
  title.className = 'app-nav-head-title';
  title.textContent = 'Apps';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'app-nav-toggle';
  toggle.className = 'app-nav-toggle';
  toggle.addEventListener('click', () => setNavCollapsed(!navCollapsed));

  head.append(title, toggle);

  const list = document.createElement('div');
  list.className = 'app-nav-list';

  list.replaceChildren(...NAV_SECTIONS.map(section => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-nav-item';
    btn.dataset.section = section.id;
    btn.title = section.label;
    btn.setAttribute('aria-current', 'false');
    btn.addEventListener('click', () => navigateTo(section.id));

    const icon = document.createElement('span');
    icon.className = 'app-nav-item-icon';
    icon.appendChild(createAppIcon(section.icon, 'app-nav-item-icon-svg'));

    const label = document.createElement('span');
    label.className = 'app-nav-item-label';
    label.textContent = section.label;

    btn.append(icon, label);
    return btn;
  }));

  nav.replaceChildren(head, list);

  // Restore last active app, defaulting to 'home'
  let restored = 'home';
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY) || localStorage.getItem('orgchart-active-section');
    if (saved && NAV_SECTIONS.some(s => s.id === saved)) restored = saved;
  } catch { /* non-fatal */ }

  try {
    navCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
  } catch {
    navCollapsed = false;
  }

  setNavCollapsed(navCollapsed);
  navigateTo(restored);
  window.addEventListener('resize', syncNavShellWidth);
}
