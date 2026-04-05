// presentation.js — Operations dashboard (Presentation section).
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Renders the live operations dashboard in #section-presentation.
// Pulls data from module globals (sources, personas, groupChat, etc.)
// resolved at call time — no imports needed.

// ─── Dashboard Init ───────────────────────────────────────────────────────────

function presentationInit() {
  const section = document.getElementById('section-presentation');
  if (!section) return;

  const grid = el('div', 'presentation-grid');
  section.appendChild(grid);

  renderPresentationDashboard();

  // Refresh on module events
  document.addEventListener('sources-changed', renderPresentationDashboard);
  document.addEventListener('personas-changed', renderPresentationDashboard);
  document.addEventListener('meeting-updated', renderPresentationDashboard);
  document.addEventListener('projects-changed', renderPresentationDashboard);
}

// ─── Dashboard Render ─────────────────────────────────────────────────────────

function renderPresentationDashboard() {
  const grid = document.querySelector('.presentation-grid');
  if (!grid) return;

  grid.replaceChildren(
    buildAgentHealthCard(),
    buildAutomationCard(),
    buildActiveProjectsCard(),
    buildActiveMeetingsCard(),
    buildUpcomingTasksCard(),
    buildRecentActivityCard(),
    buildBoardNotificationsCard(),
  );
}

// ─── Card Builders ────────────────────────────────────────────────────────────

function presentationCard(title, icon, bodyFn) {
  const card = el('div', 'presentation-card');

  const header = el('div', 'presentation-card-header');
  const iconEl = el('span', 'presentation-card-icon');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const titleEl = el('h3', 'presentation-card-title');
  titleEl.textContent = title;
  header.append(iconEl, titleEl);

  const body = el('div', 'presentation-card-body');
  bodyFn(body);

  card.append(header, body);
  return card;
}

function buildAgentHealthCard() {
  return presentationCard('Agent Health', '◌', body => {
    const agentCount = (typeof personas !== 'undefined' ? personas : []).length;
    const sourceCount = (typeof sources !== 'undefined' ? sources : []).length;
    const connectedCount = (typeof sources !== 'undefined' ? sources : []).filter(s => s.status === 'connected').length;
    const enabledAgents = (typeof personas !== 'undefined' ? personas : []).filter(p => p.name?.trim());

    const rows = [
      ['Agents', agentCount > 0 ? `${agentCount} configured` : 'No agents yet'],
      ['Sources', sourceCount > 0 ? `${connectedCount}/${sourceCount} connected` : 'No sources configured'],
    ];

    if (agentCount > 0) {
      rows.push(['Active agents', enabledAgents.length > 0
        ? enabledAgents.slice(0, 3).map(a => a.name).join(', ') + (enabledAgents.length > 3 ? ` +${enabledAgents.length - 3}` : '')
        : 'None named yet']);
    }

    body.append(...rows.map(([label, value]) => {
      const row = el('div', 'presentation-stat-row');
      const labelEl = el('span', 'presentation-stat-label');
      labelEl.textContent = label;
      const valueEl = el('span', 'presentation-stat-value');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      return row;
    }));

    const actions = el('div', 'presentation-card-actions');
    const btn = el('button', 'btn-secondary');
    btn.textContent = 'Configure Agents →';
    btn.addEventListener('click', () => {
      navigateTo('configuration');
    });
    actions.appendChild(btn);
    body.appendChild(actions);
  });
}

function buildAutomationCard() {
  return presentationCard('Automation', '⚡', body => {
    const enabled = typeof automationEnabled !== 'undefined' ? automationEnabled : false;
    const tasks = typeof scheduledTasks !== 'undefined' ? scheduledTasks : [];
    const enabledTasks = tasks.filter(t => t.enabled && t.scheduled);

    const statusRow = el('div', 'presentation-stat-row');
    const statusLabel = el('span', 'presentation-stat-label');
    statusLabel.textContent = 'Status';
    const statusBadge = el('span', `presentation-badge${enabled ? ' presentation-badge--active' : ' presentation-badge--paused'}`);
    statusBadge.textContent = enabled ? 'Active' : 'Paused';
    statusRow.append(statusLabel, statusBadge);

    const tasksRow = el('div', 'presentation-stat-row');
    const tasksLabel = el('span', 'presentation-stat-label');
    tasksLabel.textContent = 'Scheduled tasks';
    const tasksValue = el('span', 'presentation-stat-value');
    tasksValue.textContent = enabledTasks.length > 0 ? `${enabledTasks.length} active` : 'None scheduled';
    tasksRow.append(tasksLabel, tasksValue);

    body.append(statusRow, tasksRow);

    const actions = el('div', 'presentation-card-actions');
    const btn = el('button', 'btn-secondary');
    btn.textContent = 'Manage Tasks →';
    btn.addEventListener('click', () => navigateTo('configuration'));
    actions.appendChild(btn);
    body.appendChild(actions);
  });
}

function buildActiveProjectsCard() {
  return presentationCard('Active Projects', '◇', body => {
    const allProjects = typeof projects !== 'undefined' ? projects : [];
    const active = allProjects.filter(p => p.status === 'active' || p.status === 'planning');

    if (allProjects.length === 0) {
      const empty = el('p', 'presentation-empty');
      empty.textContent = 'No projects yet.';
      body.appendChild(empty);
    } else {
      const list = el('div', 'presentation-list');
      list.append(...active.slice(0, 5).map(project => {
        const item = el('div', 'presentation-list-item');
        const name = el('span', 'presentation-list-title');
        name.textContent = project.name || 'Untitled Project';

        const meta = el('span', 'presentation-list-meta');
        const progress = typeof projectProgress === 'function' ? projectProgress(project) : null;
        const statusLabel = typeof projectStatusLabel === 'function' ? projectStatusLabel(project.status) : project.status;
        meta.textContent = progress
          ? `${progress.done}/${progress.total} milestones · ${statusLabel}`
          : statusLabel;

        item.append(name, meta);
        return item;
      }));

      if (active.length === 0) {
        const idle = el('p', 'presentation-empty');
        idle.textContent = `${allProjects.length} project${allProjects.length !== 1 ? 's' : ''} — none active.`;
        body.appendChild(idle);
      } else {
        body.appendChild(list);
      }
    }

    const actions = el('div', 'presentation-card-actions');
    const btn = el('button', 'btn-secondary');
    btn.textContent = 'View Projects →';
    btn.addEventListener('click', () => navigateTo('configuration'));
    actions.appendChild(btn);
    body.appendChild(actions);
  });
}

function buildActiveMeetingsCard() {
  return presentationCard('Active Meetings', '◈', body => {
    const gc = typeof groupChat !== 'undefined' ? groupChat : { meetings: [], activeMeetingId: null };
    const meetings = gc.meetings ?? [];
    const active = meetings.filter(m => m.running || m.autoMode);
    const recent = meetings.slice(-5).reverse();

    if (recent.length === 0) {
      const empty = el('p', 'presentation-empty');
      empty.textContent = 'No meetings yet.';
      body.appendChild(empty);
    } else {
      const list = el('div', 'presentation-list');
      list.append(...recent.map(meeting => {
        const item = el('div', 'presentation-list-item');
        const name = el('span', 'presentation-list-title');
        name.textContent = meeting.name || 'Untitled Meeting';
        const meta = el('span', 'presentation-list-meta');
        const msgCount = (meeting.messages ?? []).length;
        meta.textContent = `${msgCount} message${msgCount !== 1 ? 's' : ''}${meeting.autoMode ? ' • auto' : ''}`;
        item.append(name, meta);
        return item;
      }));
      body.appendChild(list);
    }

    const actions = el('div', 'presentation-card-actions');
    const btn = el('button', 'btn-secondary');
    btn.textContent = 'Open Meetings →';
    btn.addEventListener('click', () => navigateTo('diagnostics'));
    actions.appendChild(btn);
    body.appendChild(actions);
  });
}

function buildUpcomingTasksCard() {
  return presentationCard('Upcoming Tasks', '◳', body => {
    const tasks = typeof scheduledTasks !== 'undefined' ? scheduledTasks : [];
    const scheduled = tasks.filter(t => t.enabled && t.scheduled);

    if (scheduled.length === 0) {
      const empty = el('p', 'presentation-empty');
      empty.textContent = 'No tasks scheduled.';
      body.appendChild(empty);
    } else {
      const list = el('div', 'presentation-list');
      list.append(...scheduled.slice(0, 5).map(task => {
        const item = el('div', 'presentation-list-item');
        const name = el('span', 'presentation-list-title');
        name.textContent = task.name || 'Unnamed Task';
        const meta = el('span', 'presentation-list-meta');
        meta.textContent = task.recurrence || task.type || '';
        item.append(name, meta);
        return item;
      }));
      body.appendChild(list);
    }

    const actions = el('div', 'presentation-card-actions');
    const btn = el('button', 'btn-secondary');
    btn.textContent = 'Manage Tasks →';
    btn.addEventListener('click', () => navigateTo('configuration'));
    actions.appendChild(btn);
    body.appendChild(actions);
  });
}

function buildRecentActivityCard() {
  return presentationCard('Recent Activity', '◉', body => {
    const gc = typeof groupChat !== 'undefined' ? groupChat : { taskHistory: [] };
    const history = [...(gc.taskHistory ?? [])].reverse().slice(0, 8);

    if (history.length === 0) {
      const empty = el('p', 'presentation-empty');
      empty.textContent = 'No activity yet.';
      body.appendChild(empty);
    } else {
      const list = el('div', 'presentation-list');
      list.append(...history.map(entry => {
        const item = el('div', 'presentation-list-item');
        const name = el('span', 'presentation-list-title');
        name.textContent = clampText(entry.summary || entry.purpose || 'Task completed', 60);
        const meta = el('span', 'presentation-list-meta');
        meta.textContent = entry.completedAt ? new Date(entry.completedAt).toLocaleTimeString() : '';
        item.append(name, meta);
        return item;
      }));
      body.appendChild(list);
    }
  });
}

function buildBoardNotificationsCard() {
  return presentationCard('Board Notifications', '🔔', body => {
    const notices = typeof boardNotifications !== 'undefined' ? boardNotifications : [];
    const recent = notices.slice(0, 5);

    if (recent.length === 0) {
      const empty = el('p', 'presentation-empty');
      empty.textContent = 'No notifications.';
      body.appendChild(empty);
    } else {
      const list = el('div', 'presentation-list');
      list.append(...recent.map(notice => {
        const item = el('div', `presentation-list-item${notice.read ? '' : ' presentation-list-item--unread'}`);
        const name = el('span', 'presentation-list-title');
        name.textContent = clampText(notice.title || 'Board update', 60);
        const meta = el('span', 'presentation-list-meta');
        meta.textContent = notice.source || 'system';
        item.append(name, meta);
        return item;
      }));
      body.appendChild(list);
    }
  });
}
