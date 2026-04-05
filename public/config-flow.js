// config-flow.js — Guided setup application.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty

const CONFIG_PROGRESS_KEY = 'orgchart-config-progress';

const CONFIG_STEPS = [
  {
    id: 'org-identity',
    label: 'Organization Identity',
    description: 'Name the organization, describe its operating context, and define the scope that should guide all downstream work.',
    appId: 'organization',
    actionLabel: 'Open Organization',
    prerequisites: [],
    completionCheck: () => {
      const org = (typeof organizations !== 'undefined' ? organizations : [])[0];
      return Boolean(org?.name?.trim() && org?.description?.trim());
    },
  },
  {
    id: 'inference-sources',
    label: 'Inference Sources',
    description: 'Connect at least one inference source so agents can generate, review, and complete work.',
    appId: 'resources',
    actionLabel: 'Open Resources',
    prerequisites: [],
    completionCheck: () => (typeof sources !== 'undefined' ? sources : []).some(source => source.status === 'connected'),
  },
  {
    id: 'founding-leadership',
    label: 'Founding Leadership',
    description: 'Establish the CEO, COO, and CTO roles so the organization can coordinate business, operations, and technology decisions.',
    appId: 'organization',
    actionLabel: 'Open Organization',
    prerequisites: ['org-identity'],
    completionCheck: () => {
      const roles = organizationRoleSnapshot();
      return ['CEO', 'COO', 'CTO'].every(title => roles.some(role => role.title === title));
    },
  },
  {
    id: 'dept-structure',
    label: 'Department Structure',
    description: 'Add departments and teams so work can be routed with explicit ownership.',
    appId: 'organization',
    actionLabel: 'Open Organization',
    prerequisites: ['founding-leadership'],
    completionCheck: () => {
      const org = (typeof organizations !== 'undefined' ? organizations : [])[0];
      return (org?.departments?.length ?? 0) >= 2;
    },
  },
  {
    id: 'agent-staffing',
    label: 'Agent Staffing',
    description: 'Create at least one named agent with role-aware instructions.',
    appId: 'organization',
    actionLabel: 'Open Organization',
    prerequisites: ['inference-sources'],
    completionCheck: () => (typeof personas !== 'undefined' ? personas : []).some(agent => agent.name?.trim() && agent.instructions?.trim()),
  },
  {
    id: 'skills-tools',
    label: 'Skills & Tools',
    description: 'Review the capabilities available to agents and enable only the tools that serve the organization now.',
    appId: 'resources',
    actionLabel: 'Open Resources',
    prerequisites: ['agent-staffing'],
    completionCheck: () => {
      const availableSkills = typeof skills !== 'undefined' ? skills : [];
      const availableTools = typeof tools !== 'undefined' ? tools : [];
      return availableSkills.length > 0 || availableTools.length > 0;
    },
  },
  {
    id: 'role-assignment',
    label: 'Role Assignment',
    description: 'Assign agents into the roles defined on the org chart so staffing and workflow routing use real owners.',
    appId: 'organization',
    actionLabel: 'Open Organization',
    prerequisites: ['dept-structure', 'agent-staffing'],
    completionCheck: () => organizationRoleSnapshot().some(role => role.agentId),
  },
  {
    id: 'intranet-init',
    label: 'Intranet Readiness',
    description: 'Confirm the organization has a living knowledge base, technology catalog, and records trail ready for autonomous work.',
    appId: 'intranet',
    actionLabel: 'Open Intranet',
    prerequisites: ['org-identity'],
    completionCheck: () => {
      const docs = typeof intranet !== 'undefined' ? intranet : { knowledge: [], technology: [], records: [] };
      return (docs.knowledge?.length ?? 0) + (docs.technology?.length ?? 0) + (docs.records?.length ?? 0) > 0;
    },
  },
  {
    id: 'meeting-cadence',
    label: 'Meeting Cadence',
    description: 'Create recurring workflows so the organization can keep moving without manual orchestration every time.',
    appId: 'workflows',
    actionLabel: 'Open Workflows',
    prerequisites: ['agent-staffing'],
    completionCheck: () => (typeof scheduledTasks !== 'undefined' ? scheduledTasks : []).some(task => task.enabled && task.scheduled),
  },
  {
    id: 'autonomy-review',
    label: 'Autonomy Readiness',
    description: 'Verify the critical prerequisites are complete before enabling the organization to run on its own.',
    appId: 'board',
    actionLabel: 'Open Board',
    prerequisites: ['inference-sources', 'agent-staffing', 'role-assignment', 'meeting-cadence'],
    completionCheck: () => typeof automationEnabled !== 'undefined' && automationEnabled === true,
  },
];

let activeConfigStepId = CONFIG_STEPS[0].id;

function organizationRoleSnapshot() {
  return (typeof organizations !== 'undefined' ? organizations : [])
    .flatMap(org => org.departments ?? [])
    .flatMap(department => department.teams ?? [])
    .flatMap(team => team.roles ?? []);
}

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

function stepPrerequisitesMet(step) {
  return step.prerequisites.every(id => {
    const prereq = CONFIG_STEPS.find(item => item.id === id);
    return prereq ? prereq.completionCheck() : true;
  });
}

function stepStatus(step) {
  if (!stepPrerequisitesMet(step)) return 'locked';
  if (step.completionCheck()) return 'complete';
  return 'incomplete';
}

function configCompletedStepCount() {
  return CONFIG_STEPS.filter(step => stepStatus(step) === 'complete').length;
}

function configIncompleteCriticalStepCount() {
  return CONFIG_STEPS
    .filter(step => ['inference-sources', 'agent-staffing', 'role-assignment', 'meeting-cadence'].includes(step.id))
    .filter(step => stepStatus(step) !== 'complete')
    .length;
}

function configFlowInit() {
  const section = document.getElementById('section-setup');
  if (!section) return;

  const shell = el('div', 'config-app-shell');
  const sidebar = el('nav', 'config-app-sidebar');
  sidebar.id = 'config-flow-sidebar';
  sidebar.setAttribute('aria-label', 'Setup steps');
  const detail = el('div', 'config-app-detail');
  detail.id = 'config-flow-detail';

  shell.append(sidebar, detail);
  section.replaceChildren(shell);

  renderConfigChecklist();
  renderConfigStepDetail();

  [
    'sources-changed',
    'personas-changed',
    'skills-changed',
    'tools-changed',
    'organizations-changed',
    'tasks-changed',
    'projects-changed',
    'meeting-updated',
  ].forEach(eventName => {
    document.addEventListener(eventName, () => {
      renderConfigChecklist();
      renderConfigStepDetail();
    });
  });
}

function renderConfigChecklist() {
  const sidebar = document.getElementById('config-flow-sidebar');
  if (!sidebar) return;

  const intro = el('div', 'config-app-intro');
  const kicker = el('p', 'section-kicker');
  kicker.textContent = 'Guided Setup';
  const title = el('h2', 'config-app-title');
  title.textContent = 'Configuration';
  const meta = el('p', 'config-app-meta');
  meta.textContent = `${configCompletedStepCount()}/${CONFIG_STEPS.length} complete`;
  intro.append(kicker, title, meta);

  sidebar.replaceChildren(
    intro,
    ...CONFIG_STEPS.map((step, index) => {
      const status = stepStatus(step);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `config-step-item config-step-item--${status}${step.id === activeConfigStepId ? ' config-step-item--active' : ''}`;
      btn.disabled = status === 'locked';
      btn.addEventListener('click', () => {
        activeConfigStepId = step.id;
        saveConfigProgress({ activeStepId: step.id });
        renderConfigChecklist();
        renderConfigStepDetail();
      });

      const num = el('span', 'config-step-num');
      num.textContent = status === 'complete' ? '✓' : String(index + 1);
      const copy = el('span', 'config-step-copy');
      const label = el('span', 'config-step-label');
      label.textContent = step.label;
      const stepMeta = el('span', 'config-step-meta');
      stepMeta.textContent = status === 'locked'
        ? 'Locked'
        : status === 'complete'
          ? 'Complete'
          : 'Needs attention';
      copy.append(label, stepMeta);
      btn.append(num, copy);
      return btn;
    }),
  );
}

function renderConfigStepDetail() {
  const detail = document.getElementById('config-flow-detail');
  if (!detail) return;
  const step = CONFIG_STEPS.find(item => item.id === activeConfigStepId) ?? CONFIG_STEPS[0];
  const status = stepStatus(step);

  if (step.id === 'autonomy-review') {
    detail.replaceChildren(buildAutonomyReadinessCard());
    return;
  }

  const card = el('section', 'config-step-card');
  const header = el('div', 'config-step-card-header');
  const copy = el('div', 'config-step-card-copy');
  const title = el('h3', 'config-step-card-title');
  title.textContent = step.label;
  const desc = el('p', 'config-step-card-desc');
  desc.textContent = step.description;
  copy.append(title, desc);
  const badge = el('span', `config-step-badge config-step-badge--${status}`);
  badge.textContent = status === 'complete' ? 'Complete' : status === 'locked' ? 'Locked' : 'In progress';
  header.append(copy, badge);

  const statusBlock = el('div', 'config-step-card-grid');
  statusBlock.append(
    buildConfigInfoBlock('Why it matters', configWhyItMatters(step.id)),
    buildConfigInfoBlock('Current state', configCurrentState(step.id)),
  );

  const prereqBlock = el('div', 'config-step-prereqs');
  const prereqTitle = el('p', 'section-title');
  prereqTitle.textContent = 'Prerequisites';
  const prereqList = el('div', 'config-prereq-list');
  const prereqs = step.prerequisites.length
    ? step.prerequisites.map(id => {
      const prereq = CONFIG_STEPS.find(item => item.id === id);
      const row = el('div', `config-prereq-item config-prereq-item--${prereq ? stepStatus(prereq) : 'complete'}`);
      row.textContent = prereq ? prereq.label : id;
      return row;
    })
    : [buildConfigPrereqEmpty()];
  prereqList.append(...prereqs);
  prereqBlock.append(prereqTitle, prereqList);

  const actions = el('div', 'config-step-actions');
  const primary = el('button', 'btn-primary');
  primary.type = 'button';
  primary.textContent = step.actionLabel;
  primary.disabled = status === 'locked';
  primary.addEventListener('click', () => navigateTo(step.appId));
  actions.appendChild(primary);

  card.append(header, statusBlock, prereqBlock, actions);
  detail.replaceChildren(card);
}

function buildConfigInfoBlock(label, text) {
  const block = el('article', 'config-info-block');
  const heading = el('p', 'section-title');
  heading.textContent = label;
  const body = el('p', 'config-info-copy');
  body.textContent = text;
  block.append(heading, body);
  return block;
}

function buildConfigPrereqEmpty() {
  const row = el('div', 'config-prereq-item config-prereq-item--complete');
  row.textContent = 'No prerequisite steps.';
  return row;
}

function configWhyItMatters(stepId) {
  if (stepId === 'org-identity') return 'The organization description shapes agent tone, planning, and decision framing.';
  if (stepId === 'inference-sources') return 'Without connected inference, no autonomous work can run.';
  if (stepId === 'founding-leadership') return 'CEO, COO, and CTO are the minimum leadership perspectives for autonomous growth.';
  if (stepId === 'dept-structure') return 'Departments and teams define routing boundaries and ownership.';
  if (stepId === 'agent-staffing') return 'Agents need explicit instructions and role context to operate inside scope.';
  if (stepId === 'skills-tools') return 'Skills and tools determine what agents can do and what they cannot.';
  if (stepId === 'role-assignment') return 'Role assignment binds real agent operators to the org chart.';
  if (stepId === 'intranet-init') return 'Knowledge, technology, and records preserve continuity across autonomous work.';
  if (stepId === 'meeting-cadence') return 'Scheduled workflows keep the organization moving without manual prompting.';
  return 'Autonomy should only be enabled once the organization is sufficiently defined.';
}

function configCurrentState(stepId) {
  if (stepId === 'org-identity') {
    const org = (typeof organizations !== 'undefined' ? organizations : [])[0];
    return org?.description?.trim() ? `${org.name} is described and in scope.` : 'The organization still needs a grounded description.';
  }
  if (stepId === 'inference-sources') {
    const srcs = typeof sources !== 'undefined' ? sources : [];
    return `${srcs.filter(source => source.status === 'connected').length}/${srcs.length} sources are connected.`;
  }
  if (stepId === 'founding-leadership') {
    const roles = organizationRoleSnapshot();
    return `${['CEO', 'COO', 'CTO'].filter(title => roles.some(role => role.title === title)).length}/3 founding roles are present.`;
  }
  if (stepId === 'dept-structure') {
    const org = (typeof organizations !== 'undefined' ? organizations : [])[0];
    return `${org?.departments?.length ?? 0} departments are defined.`;
  }
  if (stepId === 'agent-staffing') {
    return `${(typeof personas !== 'undefined' ? personas : []).length} agents are saved.`;
  }
  if (stepId === 'skills-tools') {
    return `${typeof skills !== 'undefined' ? skills.length : 0} skills and ${typeof tools !== 'undefined' ? tools.length : 0} tools are available.`;
  }
  if (stepId === 'role-assignment') {
    const roles = organizationRoleSnapshot();
    return `${roles.filter(role => role.agentId).length}/${roles.length} roles are filled.`;
  }
  if (stepId === 'intranet-init') {
    const docs = typeof intranet !== 'undefined' ? intranet : { knowledge: [], technology: [], records: [] };
    return `${(docs.knowledge?.length ?? 0) + (docs.technology?.length ?? 0) + (docs.records?.length ?? 0)} intranet documents are available.`;
  }
  if (stepId === 'meeting-cadence') {
    const tasks = typeof scheduledTasks !== 'undefined' ? scheduledTasks : [];
    return `${tasks.filter(task => task.enabled && task.scheduled).length} scheduled workflows are enabled.`;
  }
  return typeof automationEnabled !== 'undefined' && automationEnabled
    ? 'Autonomy is currently active.'
    : 'Autonomy is currently paused.';
}

function buildAutonomyReadinessCard() {
  const card = el('section', 'readiness-card');
  const heading = el('h3', 'readiness-title');
  heading.textContent = 'Autonomy Readiness Review';
  const description = el('p', 'readiness-description');
  description.textContent = 'Autonomous work should only run when the organization has enough structure, staffing, resources, and recurring workflows to stay in scope.';

  const checklist = el('div', 'readiness-checklist');
  const criticalIds = ['inference-sources', 'agent-staffing', 'role-assignment', 'meeting-cadence'];
  checklist.append(...criticalIds.map(id => {
    const step = CONFIG_STEPS.find(item => item.id === id);
    const status = step ? stepStatus(step) : 'locked';
    const row = el('div', `readiness-row readiness-row--${status}`);
    const icon = el('span', 'readiness-icon');
    icon.textContent = status === 'complete' ? '✓' : status === 'locked' ? '⊘' : '○';
    const label = el('span', 'readiness-step-label');
    label.textContent = step?.label || id;
    row.append(icon, label);
    return row;
  }));

  const footer = el('div', 'readiness-footer');
  const statusMsg = el('p', 'readiness-status');
  const allCriticalDone = configIncompleteCriticalStepCount() === 0;
  const isEnabled = typeof automationEnabled !== 'undefined' && automationEnabled;
  statusMsg.textContent = isEnabled
    ? 'Autonomous mode is active.'
    : allCriticalDone
      ? 'Critical setup is complete. Autonomous mode can be enabled.'
      : 'Finish the critical setup steps before enabling autonomous mode.';
  if (isEnabled) statusMsg.classList.add('readiness-status--active');

  const button = el('button', isEnabled ? 'btn-secondary' : 'btn-primary');
  button.type = 'button';
  button.textContent = isEnabled ? 'Pause Autonomy' : 'Enable Autonomous Mode';
  button.disabled = !isEnabled && !allCriticalDone;
  button.addEventListener('click', () => {
    if (typeof setAutomationEnabled === 'function') {
      setAutomationEnabled(!isEnabled);
      renderConfigChecklist();
      renderConfigStepDetail();
    }
  });

  footer.append(statusMsg, button);
  card.append(heading, description, checklist, footer);
  return card;
}

(function restoreConfigState() {
  const saved = loadConfigProgress();
  if (saved?.activeStepId && CONFIG_STEPS.some(step => step.id === saved.activeStepId)) {
    activeConfigStepId = saved.activeStepId;
  }
})();
