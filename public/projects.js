// projects.js — Projects & Milestones state, CRUD, and panel rendering.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: uiState — resolved at call time.
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el

// ─── State ────────────────────────────────────────────────────────────────────

let projects = [];
let activeProjectId = null;

// ─── Events ───────────────────────────────────────────────────────────────────

function notifyProjects() {
  document.dispatchEvent(new CustomEvent('projects-changed', { detail: { projects } }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function activeProject() {
  return projects.find(p => p.id === activeProjectId) ?? null;
}

function projectStatusLabel(status) {
  return {
    planning: 'Planning',
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    archived: 'Archived',
  }[status] ?? status;
}

function milestoneStatusLabel(status) {
  return {
    pending: 'Pending',
    'in-progress': 'In Progress',
    completed: 'Completed',
    blocked: 'Blocked',
  }[status] ?? status;
}

function projectProgress(project) {
  const milestones = project.milestones ?? [];
  if (milestones.length === 0) return null;
  const done = milestones.filter(m => m.status === 'completed').length;
  return { done, total: milestones.length, pct: Math.round((done / milestones.length) * 100) };
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const data = await apiJson('/api/orgchart/projects');
    projects = data.projects ?? [];
    if (!projects.some(p => p.id === activeProjectId)) {
      activeProjectId = projects[0]?.id ?? null;
    }
  } catch {
    projects = [];
  }
}

async function persistProject(project) {
  const { project: saved } = await apiJson('/api/orgchart/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  const idx = projects.findIndex(p => p.id === saved.id);
  if (idx >= 0) {
    projects[idx] = saved;
  } else {
    projects.push(saved);
  }
  activeProjectId = saved.id;
  notifyProjects();
  setSaveIndicator('saved', 'Project saved.');
  return saved;
}

async function deleteActiveProject() {
  const project = activeProject();
  if (!project) return;
  await apiJson(`/api/orgchart/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
  projects = projects.filter(p => p.id !== project.id);
  activeProjectId = projects[0]?.id ?? null;
  notifyProjects();
  setSaveIndicator('saved', 'Project deleted.');
}

// ─── Milestone helpers ────────────────────────────────────────────────────────

function makeProject() {
  return {
    id: `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: 'New Project',
    description: '',
    status: 'planning',
    ownerId: '',
    departmentId: '',
    teamId: '',
    deadline: '',
    milestones: [],
    linkedMeetingIds: [],
    linkedTaskIds: [],
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeMilestone() {
  return {
    id: `milestone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: 'New Milestone',
    description: '',
    status: 'pending',
    deadline: '',
    completedAt: '',
    linkedArtifacts: [],
  };
}

// ─── Panel Rendering ──────────────────────────────────────────────────────────

function projectsInit(body, actionsLeft, actionsRight) {
  const btnAdd = document.createElement('button');
  btnAdd.type = 'button';
  btnAdd.className = 'btn-add';
  btnAdd.title = 'Create project';
  btnAdd.textContent = '+';
  btnAdd.addEventListener('click', async () => {
    const project = makeProject();
    projects.push(project);
    activeProjectId = project.id;
    renderProjectsPanel();
    await persistProject(project);
    renderProjectsPanel();
  });
  actionsRight.appendChild(btnAdd);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse project list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.projectsNavCollapsed = !uiState.projectsNavCollapsed;
    const shellEl = document.getElementById('projects-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.projectsNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.id = 'projects-shell';
  shell.className = 'workspace-shell projects-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.projectsNavCollapsed ?? false);

  const nav = document.createElement('div');
  nav.id = 'projects-nav';
  nav.className = 'workspace-nav';

  const detail = document.createElement('div');
  detail.id = 'projects-detail';
  detail.className = 'workspace-detail projects-detail';

  shell.append(nav, detail);
  body.appendChild(shell);
  renderProjectsPanel();
}

function renderProjectsPanel() {
  const nav = document.getElementById('projects-nav');
  const detail = document.getElementById('projects-detail');
  if (!nav || !detail) return;

  if (!projects.some(p => p.id === activeProjectId)) {
    activeProjectId = projects[0]?.id ?? null;
  }

  // ── Nav list ────────────────────────────────────────────────────────────────
  if (projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No projects yet. Press + to create one.';
    nav.replaceChildren(empty);
    detail.replaceChildren();
    return;
  }

  nav.replaceChildren(...projects.map(project => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `workspace-item${project.id === activeProjectId ? ' workspace-item--active' : ''}`;
    btn.dataset.status = 'idle';
    btn.addEventListener('click', () => {
      activeProjectId = project.id;
      renderProjectsPanel();
    });

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    const progress = projectProgress(project);
    icon.textContent = project.status === 'completed' ? '✓'
      : project.status === 'active' ? '◈'
        : navStatusGlyph('idle', '◇');

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';

    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = project.name || 'Untitled Project';

    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = progress
      ? `${progress.done}/${progress.total} milestones · ${projectStatusLabel(project.status)}`
      : projectStatusLabel(project.status);

    copy.append(title, meta);
    btn.append(icon, copy);
    return btn;
  }));

  // ── Detail pane ─────────────────────────────────────────────────────────────
  const project = activeProject();
  if (!project) {
    detail.replaceChildren();
    return;
  }
  detail.replaceChildren(buildProjectCard(project));
}

function buildProjectCard(project) {
  const card = el('div', 'project-card');

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el('div', 'card-header');
  const statusGroup = el('div', 'status-group');
  const dot = el('span', `status-dot ${project.status === 'active' ? 'connected' : project.status === 'completed' ? 'connected' : 'connecting'}`);
  const statusLbl = el('span', 'status-label');
  statusLbl.textContent = projectStatusLabel(project.status);
  statusGroup.append(dot, statusLbl);

  const actions = el('div', 'card-actions');
  const btnDelete = el('button', 'btn-icon btn-remove');
  btnDelete.title = 'Delete project';
  btnDelete.textContent = '×';
  btnDelete.addEventListener('click', async () => {
    if (!confirm(`Delete project "${project.name}"?`)) return;
    await deleteActiveProject();
    renderProjectsPanel();
  });
  actions.appendChild(btnDelete);
  header.append(statusGroup, actions);

  // ── Name ────────────────────────────────────────────────────────────────────
  const nameRow = el('div', 'card-label-row');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'card-label-input';
  nameInput.value = project.name;
  nameInput.placeholder = 'Project name';
  nameInput.setAttribute('aria-label', 'Project name');
  nameInput.addEventListener('input', () => { project.name = nameInput.value; });
  nameInput.addEventListener('blur', async () => {
    project.name = nameInput.value.trim() || 'Untitled Project';
    await persistProject(project);
    renderProjectsPanel();
  });
  nameRow.appendChild(nameInput);

  // ── Status + deadline row ────────────────────────────────────────────────────
  const metaRow = el('div', 'project-meta-row');

  const statusSel = document.createElement('select');
  statusSel.className = 'chat-source-select';
  for (const [value, label] of [
    ['planning', 'Planning'], ['active', 'Active'], ['paused', 'Paused'],
    ['completed', 'Completed'], ['archived', 'Archived'],
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = project.status === value;
    statusSel.appendChild(opt);
  }
  statusSel.addEventListener('change', async () => {
    project.status = statusSel.value;
    await persistProject(project);
    renderProjectsPanel();
  });

  const deadlineLabel = el('label', 'field-label');
  deadlineLabel.textContent = 'Deadline';
  const deadlineInput = document.createElement('input');
  deadlineInput.type = 'date';
  deadlineInput.className = 'text-input project-deadline-input';
  deadlineInput.value = project.deadline ?? '';
  deadlineInput.addEventListener('change', async () => {
    project.deadline = deadlineInput.value;
    await persistProject(project);
    renderProjectsPanel();
  });

  metaRow.append(statusSel, deadlineLabel, deadlineInput);

  // ── Description ──────────────────────────────────────────────────────────────
  const descField = el('div', 'persona-field');
  const descLabel = el('label', 'field-label');
  descLabel.textContent = 'Description';
  const descArea = document.createElement('textarea');
  descArea.className = 'persona-textarea';
  descArea.rows = 3;
  descArea.placeholder = 'What is this project about?';
  descArea.value = project.description ?? '';
  descArea.addEventListener('blur', async () => {
    project.description = descArea.value.trim();
    await persistProject(project);
  });
  descField.append(descLabel, descArea);

  // ── Milestones ───────────────────────────────────────────────────────────────
  const milestonesSection = el('div', 'project-milestones');
  const milestonesHeader = el('div', 'project-milestones-header');
  const milestonesTitle = el('h4', 'project-milestones-title');
  milestonesTitle.textContent = 'Milestones';

  const progress = projectProgress(project);
  if (progress) {
    const progressEl = el('span', 'project-progress-badge');
    progressEl.textContent = `${progress.done}/${progress.total} (${progress.pct}%)`;
    milestonesHeader.append(milestonesTitle, progressEl);
  } else {
    milestonesHeader.append(milestonesTitle);
  }

  const addMilestoneBtn = el('button', 'btn-secondary');
  addMilestoneBtn.textContent = '+ Add Milestone';
  addMilestoneBtn.addEventListener('click', async () => {
    project.milestones = project.milestones ?? [];
    project.milestones.push(makeMilestone());
    await persistProject(project);
    renderProjectsPanel();
  });

  const milestoneList = el('div', 'milestone-list');
  if ((project.milestones ?? []).length === 0) {
    const empty = el('p', 'tool-test-status');
    empty.textContent = 'No milestones yet.';
    milestoneList.appendChild(empty);
  } else {
    milestoneList.append(...project.milestones.map((milestone, idx) => buildMilestoneRow(project, milestone, idx)));
  }

  milestonesSection.append(milestonesHeader, milestoneList, addMilestoneBtn);

  // ── Notes ────────────────────────────────────────────────────────────────────
  const notesField = el('div', 'persona-field');
  const notesLabel = el('label', 'field-label');
  notesLabel.textContent = 'Notes';
  const notesArea = document.createElement('textarea');
  notesArea.className = 'persona-textarea';
  notesArea.rows = 4;
  notesArea.placeholder = 'Free-form notes, links, context...';
  notesArea.value = project.notes ?? '';
  notesArea.addEventListener('blur', async () => {
    project.notes = notesArea.value.trim();
    await persistProject(project);
  });
  notesField.append(notesLabel, notesArea);

  // ── Save button ───────────────────────────────────────────────────────────────
  const saveBtn = el('button', 'btn-primary');
  saveBtn.textContent = 'Save Project';
  saveBtn.addEventListener('click', async () => {
    project.name = nameInput.value.trim() || 'Untitled Project';
    project.description = descArea.value.trim();
    project.notes = notesArea.value.trim();
    await persistProject(project);
    renderProjectsPanel();
  });

  card.append(header, nameRow, metaRow, descField, milestonesSection, notesField, saveBtn);
  return card;
}

function buildMilestoneRow(project, milestone, idx) {
  const row = el('div', 'milestone-row');

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'text-input milestone-name-input';
  nameInput.value = milestone.name;
  nameInput.placeholder = 'Milestone name';
  nameInput.addEventListener('blur', async () => {
    milestone.name = nameInput.value.trim() || 'Untitled Milestone';
    await persistProject(project);
  });

  const statusSel = document.createElement('select');
  statusSel.className = 'chat-source-select milestone-status-select';
  for (const [value, label] of [
    ['pending', 'Pending'], ['in-progress', 'In Progress'],
    ['completed', 'Completed'], ['blocked', 'Blocked'],
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = milestone.status === value;
    statusSel.appendChild(opt);
  }
  statusSel.addEventListener('change', async () => {
    milestone.status = statusSel.value;
    if (statusSel.value === 'completed' && !milestone.completedAt) {
      milestone.completedAt = new Date().toISOString();
    }
    await persistProject(project);
    renderProjectsPanel();
  });

  const deadlineInput = document.createElement('input');
  deadlineInput.type = 'date';
  deadlineInput.className = 'text-input milestone-deadline-input';
  deadlineInput.value = milestone.deadline ?? '';
  deadlineInput.title = 'Milestone deadline';
  deadlineInput.addEventListener('change', async () => {
    milestone.deadline = deadlineInput.value;
    await persistProject(project);
  });

  const removeBtn = el('button', 'btn-icon btn-remove');
  removeBtn.title = 'Remove milestone';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', async () => {
    project.milestones.splice(idx, 1);
    await persistProject(project);
    renderProjectsPanel();
  });

  row.append(nameInput, statusSel, deadlineInput, removeBtn);
  return row;
}
