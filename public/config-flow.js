// config-flow.js — Configuration flow engine: guided 10-step setup checklist.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Renders a sidebar checklist inside #section-configuration and manages
// step navigation, prerequisite gating, and completion tracking.
// Pulls completion state from module globals resolved at call time.

const CONFIG_PROGRESS_KEY = 'orgchart-config-progress';

// ─── Step Definitions ─────────────────────────────────────────────────────────

const CONFIG_STEPS = [
  {
    id: 'org-identity',
    label: 'Organization Identity',
    description: 'Name your organization and describe what it does. This context shapes how agents communicate.',
    panelId: 'panel-management',
    prerequisites: [],
    completionCheck: () => {
      const orgs = typeof organizations !== 'undefined' ? organizations : [];
      return orgs.some(org => org.name?.trim() && org.description?.trim());
    },
  },
  {
    id: 'inference-sources',
    label: 'Inference Sources',
    description: 'Connect at least one Ollama API server. Agents need an inference backend to generate responses.',
    panelId: 'panel-sources',
    prerequisites: [],
    completionCheck: () => {
      const srcs = typeof sources !== 'undefined' ? sources : [];
      return srcs.some(s => s.status === 'connected');
    },
  },
  {
    id: 'founding-leadership',
    label: 'Founding Leadership',
    description: 'Define the CEO, COO, and CTO roles in your executive office. These are the founding leadership positions.',
    panelId: 'panel-management',
    prerequisites: ['org-identity'],
    completionCheck: () => {
      const orgs = typeof organizations !== 'undefined' ? organizations : [];
      const org = orgs[0];
      if (!org) return false;
      const execTeam = org.departments?.flatMap(d => d.teams ?? []).find(t => t.name === 'Executive Office');
      return execTeam?.roles?.length >= 3;
    },
  },
  {
    id: 'dept-structure',
    label: 'Department Structure',
    description: 'Add departments and teams that reflect your organization\'s operating structure.',
    panelId: 'panel-management',
    prerequisites: ['founding-leadership'],
    completionCheck: () => {
      const orgs = typeof organizations !== 'undefined' ? organizations : [];
      const org = orgs[0];
      return (org?.departments?.length ?? 0) >= 2;
    },
  },
  {
    id: 'agent-staffing',
    label: 'Agent Staffing',
    description: 'Create at least one agent with a name, title, and system instructions.',
    panelId: 'panel-persona',
    prerequisites: ['inference-sources'],
    completionCheck: () => {
      const ps = typeof personas !== 'undefined' ? personas : [];
      return ps.some(p => p.name?.trim() && p.instructions?.trim());
    },
  },
  {
    id: 'skills-tools',
    label: 'Skills & Tools',
    description: 'Review available skills and enable the tools your agents will use.',
    panelId: 'panel-skills',
    prerequisites: ['agent-staffing'],
    completionCheck: () => {
      const sk = typeof skills !== 'undefined' ? skills : [];
      const tl = typeof tools !== 'undefined' ? tools : [];
      return sk.length > 0 || tl.length > 0;
    },
  },
  {
    id: 'role-assignment',
    label: 'Role Assignment',
    description: 'Assign agents to the roles in your organization chart. This enables role-aware meeting facilitation.',
    panelId: 'panel-management',
    prerequisites: ['dept-structure', 'agent-staffing'],
    completionCheck: () => {
      const orgs = typeof organizations !== 'undefined' ? organizations : [];
      const allRoles = orgs.flatMap(org => org.departments?.flatMap(d => d.teams?.flatMap(t => t.roles ?? []) ?? []) ?? []);
      return allRoles.some(r => r.agentId);
    },
  },
  {
    id: 'intranet-init',
    label: 'Intranet Initialization',
    description: 'Add knowledge articles, technology documentation, or operational records to your intranet.',
    panelId: null,
    sectionId: 'records',
    prerequisites: ['org-identity'],
    completionCheck: () => {
      const iv = typeof intranet !== 'undefined' ? intranet : { knowledge: [], technology: [], records: [] };
      return (iv.knowledge?.length + iv.technology?.length + iv.records?.length) > 0;
    },
  },
  {
    id: 'meeting-cadence',
    label: 'Meeting Cadence',
    description: 'Schedule at least one recurring meeting or automated task to drive organizational activity.',
    panelId: 'panel-tasks',
    prerequisites: ['agent-staffing'],
    completionCheck: () => {
      const tasks = typeof scheduledTasks !== 'undefined' ? scheduledTasks : [];
      return tasks.some(t => t.enabled && t.scheduled);
    },
  },
  {
    id: 'autonomy-review',
    label: 'Autonomy Readiness',
    description: 'Review the readiness checklist and enable autonomous mode when all critical steps are complete.',
    panelId: null,
    prerequisites: ['inference-sources', 'agent-staffing', 'role-assignment', 'meeting-cadence'],
    completionCheck: () => {
      return typeof automationEnabled !== 'undefined' && automationEnabled === true;
    },
  },
];

// ─── Progress Persistence ─────────────────────────────────────────────────────

function loadConfigProgress() {
  try {
    const saved = localStorage.getItem(CONFIG_PROGRESS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveConfigProgress(progress) {
  try {
    localStorage.setItem(CONFIG_PROGRESS_KEY, JSON.stringify(progress));
  } catch { /* non-fatal */ }
}

// ─── Step State Helpers ───────────────────────────────────────────────────────

function stepPrerequisitesMet(step) {
  return step.prerequisites.every(prereqId => {
    const prereq = CONFIG_STEPS.find(s => s.id === prereqId);
    return prereq ? prereq.completionCheck() : true;
  });
}

function stepStatus(step) {
  if (!stepPrerequisitesMet(step)) return 'locked';
  if (step.completionCheck()) return 'complete';
  return 'incomplete';
}

// ─── Config Flow UI ───────────────────────────────────────────────────────────

let activeConfigStepId = CONFIG_STEPS[0].id;

function configFlowInit() {
  const section = document.getElementById('section-configuration');
  if (!section) return;

  // Wrap existing panel mounts in a detail pane; add sidebar checklist
  const shell = el('div', 'config-flow-shell');

  const sidebar = el('nav', 'config-flow-sidebar');
  sidebar.id = 'config-flow-sidebar';
  sidebar.setAttribute('aria-label', 'Setup steps');

  const detail = el('div', 'config-flow-detail');
  detail.id = 'config-flow-detail';

  // Move existing panel mount divs into the detail area
  while (section.firstChild) {
    detail.appendChild(section.firstChild);
  }

  // Append autonomy readiness panel (step 10) at the end of detail
  const readinessMount = el('div', '');
  readinessMount.id = 'autonomy-readiness-mount';
  detail.appendChild(readinessMount);

  shell.append(sidebar, detail);
  section.appendChild(shell);

  renderConfigChecklist();

  // Refresh checklist when sources/personas/etc change
  document.addEventListener('sources-changed', renderConfigChecklist);
  document.addEventListener('personas-changed', renderConfigChecklist);
  document.addEventListener('skills-changed', renderConfigChecklist);
  document.addEventListener('tools-changed', renderConfigChecklist);
}

function renderConfigChecklist() {
  const sidebar = document.getElementById('config-flow-sidebar');
  if (!sidebar) return;

  sidebar.replaceChildren(...CONFIG_STEPS.map((step, index) => {
    const status = stepStatus(step);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `config-step-item config-step-item--${status}${step.id === activeConfigStepId ? ' config-step-item--active' : ''}`;
    btn.disabled = status === 'locked';
    btn.dataset.stepId = step.id;

    const num = el('span', 'config-step-num');
    num.textContent = status === 'complete' ? '✓' : String(index + 1);

    const copy = el('span', 'config-step-copy');
    const label = el('span', 'config-step-label');
    label.textContent = step.label;
    const meta = el('span', 'config-step-meta');
    meta.textContent = status === 'locked' ? 'Locked — complete prerequisites first'
      : status === 'complete' ? 'Complete'
        : 'Not started';
    copy.append(label, meta);

    btn.append(num, copy);
    btn.addEventListener('click', () => selectConfigStep(step.id));
    return btn;
  }));
}

function selectConfigStep(stepId) {
  activeConfigStepId = stepId;
  renderConfigChecklist();

  const step = CONFIG_STEPS.find(s => s.id === stepId);
  if (!step) return;

  // For steps that navigate to a different section (intranet)
  if (step.sectionId && step.sectionId !== 'configuration') {
    navigateTo(step.sectionId);
    return;
  }

  // Scroll to and expand the relevant panel
  if (step.panelId) {
    const panelEl = document.getElementById(step.panelId);
    if (panelEl) {
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Expand the panel if collapsed
      if (panelEl.classList.contains('panel--collapsed')) {
        const toggle = panelEl.querySelector('.panel-toggle');
        if (toggle) toggle.click();
      }
    }
  }

  // For the autonomy readiness step, render a summary view
  if (stepId === 'autonomy-review') {
    renderAutonomyReadiness();
  }
}

// ─── Autonomy Readiness Summary ───────────────────────────────────────────────

function renderAutonomyReadiness() {
  const mount = document.getElementById('autonomy-readiness-mount');
  if (!mount) return;

  const card = el('div', 'readiness-card');

  const heading = el('h3', 'readiness-title');
  heading.textContent = 'Autonomy Readiness Review';

  const description = el('p', 'readiness-description');
  description.textContent = 'Review all setup requirements before enabling autonomous mode. All critical steps must be complete.';

  const checklist = el('div', 'readiness-checklist');

  const criticalSteps = CONFIG_STEPS.filter(s => s.id !== 'autonomy-review');
  checklist.append(...criticalSteps.map(step => {
    const status = stepStatus(step);
    const row = el('div', `readiness-row readiness-row--${status}`);
    const icon = el('span', 'readiness-icon');
    icon.textContent = status === 'complete' ? '✓' : status === 'locked' ? '⊘' : '○';
    const label = el('span', 'readiness-step-label');
    label.textContent = step.label;
    row.append(icon, label);
    return row;
  }));

  const allCriticalDone = criticalSteps
    .filter(s => s.prerequisites.length === 0 || ['inference-sources', 'agent-staffing', 'role-assignment', 'meeting-cadence'].includes(s.id))
    .every(s => stepStatus(s) === 'complete');

  const footer = el('div', 'readiness-footer');
  const statusMsg = el('p', 'readiness-status');

  const isEnabled = typeof automationEnabled !== 'undefined' && automationEnabled;

  if (isEnabled) {
    statusMsg.textContent = '✓ Autonomous mode is active.';
    statusMsg.classList.add('readiness-status--active');
  } else if (allCriticalDone) {
    statusMsg.textContent = 'All critical requirements met — ready to enable autonomy.';
  } else {
    statusMsg.textContent = 'Complete the highlighted steps above before enabling autonomy.';
  }

  const enableBtn = document.createElement('button');
  enableBtn.className = isEnabled ? 'btn-secondary' : 'btn-primary';
  enableBtn.textContent = isEnabled ? 'Pause Autonomy' : 'Enable Autonomous Mode';
  enableBtn.disabled = !isEnabled && !allCriticalDone;
  enableBtn.addEventListener('click', () => {
    if (typeof setAutomationEnabled === 'function') {
      setAutomationEnabled(!isEnabled);
      renderAutonomyReadiness();
      renderConfigChecklist();
    }
  });

  footer.append(statusMsg, enableBtn);
  card.append(heading, description, checklist, footer);

  mount.replaceChildren(card);
  mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
