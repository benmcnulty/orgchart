// home.js — OS-style launcher and operational home.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty

function homeInit() {
  const section = document.getElementById('section-home');
  if (!section) return;
  renderHome();
  document.addEventListener('sources-changed', renderHome);
  document.addEventListener('personas-changed', renderHome);
  document.addEventListener('meeting-updated', renderHome);
  document.addEventListener('projects-changed', renderHome);
  document.addEventListener('skills-changed', renderHome);
  document.addEventListener('tools-changed', renderHome);
  document.addEventListener('organizations-changed', renderHome);
  document.addEventListener('tasks-changed', renderHome);
}

function renderHome() {
  const section = document.getElementById('section-home');
  if (!section) return;

  const shell = el('div', 'home-shell');
  shell.append(
    buildHomeHero(),
    buildHomeLauncher(),
    buildHomeFocusStrip(),
  );

  section.replaceChildren(shell);
}

function buildHomeHero() {
  const org = (typeof organizations !== 'undefined' ? organizations : [])[0] ?? null;
  const wrap = el('section', 'home-hero');

  const copy = el('div', 'home-hero-copy');
  const kicker = el('p', 'section-kicker');
  kicker.textContent = 'Organization OS';
  const title = el('h2', 'home-hero-title');
  title.textContent = org?.name?.trim() || 'OrgChart';
  const desc = el('p', 'home-hero-desc');
  desc.textContent = org?.description?.trim()
    || 'Set the organization context, staff the founding roles, and let the operating apps coordinate work with visible control.';
  copy.append(kicker, title, desc);

  const status = el('div', 'home-hero-status');
  status.append(
    buildHomeStat('Automation', typeof automationEnabled !== 'undefined' && automationEnabled ? 'Active' : 'Paused'),
    buildHomeStat('Agents', String((typeof personas !== 'undefined' ? personas : []).length)),
    buildHomeStat('Meetings', String((typeof groupChat !== 'undefined' ? groupChat.meetings.length : 0))),
    buildHomeStat('Projects', String((typeof projects !== 'undefined' ? projects : []).length)),
  );

  wrap.append(copy, status);
  return wrap;
}

function buildHomeStat(label, value) {
  const card = el('div', 'home-stat');
  const labelEl = el('span', 'home-stat-label');
  labelEl.textContent = label;
  const valueEl = el('span', 'home-stat-value');
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}

function buildHomeLauncher() {
  const card = el('section', 'home-launcher');
  const title = el('h3', 'home-section-title');
  title.textContent = 'Apps';
  const grid = el('div', 'home-app-grid');

  grid.append(...NAV_SECTIONS
    .filter(section => section.id !== 'home')
    .map(section => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'home-app-tile';
      button.addEventListener('click', () => navigateTo(section.id));

      const icon = el('span', 'home-app-icon');
      icon.appendChild(createAppIcon(section.icon, 'home-app-icon-svg'));

      const label = el('span', 'home-app-label');
      label.textContent = section.label;

      const meta = el('span', 'home-app-meta');
      meta.textContent = homeAppMeta(section.id);

      button.append(icon, label, meta);
      return button;
    }));

  card.append(title, grid);
  return card;
}

function homeAppMeta(sectionId) {
  if (sectionId === 'board') {
    return `${unreadBoardNotificationCount()} unread notifications`;
  }
  if (sectionId === 'setup') {
    const done = typeof configCompletedStepCount === 'function' ? configCompletedStepCount() : 0;
    const total = typeof CONFIG_STEPS !== 'undefined' ? CONFIG_STEPS.length : 0;
    return `${done}/${total} setup steps complete`;
  }
  if (sectionId === 'organization') {
    const roles = (typeof organizationRoleSnapshot === 'function' ? organizationRoleSnapshot() : []);
    const filled = roles.filter(role => role.agentId).length;
    return roles.length ? `${filled}/${roles.length} roles filled` : 'No roles defined';
  }
  if (sectionId === 'messages') {
    return `${typeof chatSessions !== 'undefined' ? chatSessions.length : 0} chat sessions`;
  }
  if (sectionId === 'workflows') {
    const tasks = typeof scheduledTasks !== 'undefined' ? scheduledTasks.filter(task => task.enabled).length : 0;
    return `${tasks} enabled tasks`;
  }
  if (sectionId === 'resources') {
    const srcs = typeof sources !== 'undefined' ? sources : [];
    return `${srcs.filter(source => source.status === 'connected').length}/${srcs.length} sources connected`;
  }
  if (sectionId === 'intranet') {
    const totalDocs = (typeof intranet !== 'undefined'
      ? (intranet.knowledge?.length ?? 0) + (intranet.technology?.length ?? 0) + (intranet.records?.length ?? 0)
      : 0);
    return `${totalDocs} intranet docs`;
  }
  if (sectionId === 'diagnostics') {
    return 'Pipelines and deep inspection';
  }
  return '';
}

function buildHomeFocusStrip() {
  const grid = el('section', 'home-focus-grid');
  grid.append(
    buildHomeFocusCard('Now', homeNowText(), 'Open Board', 'board'),
    buildHomeFocusCard('Next', homeNextText(), 'Open Workflows', 'workflows'),
    buildHomeFocusCard('Attention', homeAttentionText(), 'Open Setup', 'setup'),
  );
  return grid;
}

function buildHomeFocusCard(titleText, bodyText, actionText, target) {
  const card = el('article', 'home-focus-card');
  const title = el('h3', 'home-focus-title');
  title.textContent = titleText;
  const body = el('p', 'home-focus-body');
  body.textContent = bodyText;
  const button = el('button', 'btn-secondary');
  button.type = 'button';
  button.textContent = actionText;
  button.addEventListener('click', () => navigateTo(target));
  card.append(title, body, button);
  return card;
}

function homeNowText() {
  const runningMeeting = typeof groupChat !== 'undefined'
    ? groupChat.meetings.find(meeting => meeting.running || meeting.autoMode)
    : null;
  if (runningMeeting) return `${runningMeeting.name || 'Meeting'} is currently running.`;
  const activeProject = (typeof projects !== 'undefined' ? projects : []).find(project => project.status === 'active');
  if (activeProject) return `${activeProject.name || 'Project'} is active and moving toward milestones.`;
  return 'No active autonomous workflow is currently running.';
}

function homeNextText() {
  const nextTask = typeof scheduledTasks !== 'undefined'
    ? scheduledTasks.find(task => task.enabled && task.scheduled)
    : null;
  if (nextTask) return `${nextTask.name || 'Task'} is the next scheduled workflow.`;
  return 'No recurring task is scheduled yet.';
}

function homeAttentionText() {
  const unread = unreadBoardNotificationCount();
  if (unread > 0) return `${unread} board notification${unread !== 1 ? 's' : ''} need review.`;
  const incomplete = typeof configIncompleteCriticalStepCount === 'function' ? configIncompleteCriticalStepCount() : 0;
  if (incomplete > 0) return `${incomplete} critical setup step${incomplete !== 1 ? 's remain' : ' remains'} before autonomy is fully ready.`;
  return 'The system is configured without urgent board attention.';
}
