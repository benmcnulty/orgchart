// management.js — Organization, department, team, and role management.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: ORG_STORAGE_KEY, DEFAULT_MODEL, uiState — resolved at call time.
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el
// References functions from agents.js: personas, notifyPersonas (global scope)
// References functions from sources.js: defaultSource, enabledSources (global scope)

// ─── State ────────────────────────────────────────────────────────────────────

let organizations = [];
let nextOrganizationSeq = 1;
let activeOrganizationId = null;
let activeDepartmentId = null;

// ─── Persistence ──────────────────────────────────────────────────────────────

function makeDefaultOrganization() {
  const seq = nextOrganizationSeq++;
  return {
    id: `org-${seq}`,
    name: `Organization ${seq}`,
    description: '',
    industry: '',
    products: '',
    departments: [
      {
        id: `org-${seq}-dept-admin`,
        name: 'Administration',
        description: 'Executive leadership and operational oversight.',
        teams: [
          {
            id: `org-${seq}-team-exec`,
            name: 'Executive Office',
            description: 'Executive leadership team.',
            roles: [
              {
                id: `org-${seq}-role-ceo`,
                title: 'CEO',
                description: 'Sets direction, leads strategy, and represents the organization.',
                agentId: '',
              },
              {
                id: `org-${seq}-role-coo`,
                title: 'COO',
                description: 'Owns operations, execution, and cross-functional coordination.',
                agentId: '',
              },
              {
                id: `org-${seq}-role-cto`,
                title: 'CTO',
                description: 'Evaluates, extends, and governs the organization technology platform and custom tooling.',
                agentId: '',
              },
            ],
          },
        ],
      },
    ],
    suggestions: {
      departments: [],
      teams: [],
      roles: [],
      notes: '',
    },
    hasUpdate: false,
  };
}

function loadOrganizations() {
  try {
    const saved = localStorage.getItem(ORG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      organizations = Array.isArray(parsed) ? parsed : [];
      nextOrganizationSeq = Math.max(1, ...organizations.map(org => Number(String(org.id || '').split('-').pop()) || 0)) + 1;
    }
  } catch {
    organizations = [];
  }
  if (!organizations.length) organizations.push(makeDefaultOrganization());
  activeOrganizationId = organizations.some(org => org.id === activeOrganizationId) ? activeOrganizationId : organizations[0]?.id ?? null;
  const org = organizations.find(item => item.id === activeOrganizationId) ?? organizations[0];
  activeDepartmentId = org?.departments?.some(dept => dept.id === activeDepartmentId) ? activeDepartmentId : org?.departments?.[0]?.id ?? null;
}

function saveOrganizations() {
  localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(organizations));
  renderOrganizationList();
  refreshRoleDependentViews();
  setSaveIndicator('saved', 'Organization saved.');
}

// ─── Accessors ────────────────────────────────────────────────────────────────

function activeOrganization() {
  return organizations.find(org => org.id === activeOrganizationId) ?? organizations[0] ?? null;
}

function activeDepartment() {
  const organization = activeOrganization();
  if (!organization) return null;
  if (!organization.departments.some(department => department.id === activeDepartmentId)) {
    activeDepartmentId = organization.departments[0]?.id ?? null;
  }
  return organization.departments.find(department => department.id === activeDepartmentId) ?? organization.departments[0] ?? null;
}

function findRoleById(roleId) {
  for (const organization of organizations) {
    for (const department of organization.departments ?? []) {
      for (const team of department.teams ?? []) {
        for (const role of team.roles ?? []) {
          if (role.id === roleId) {
            return { organization, department, team, role };
          }
        }
      }
    }
  }
  return null;
}

function allOrganizationRoles() {
  const roles = [];
  for (const organization of organizations) {
    for (const department of organization.departments ?? []) {
      for (const team of department.teams ?? []) {
        for (const role of team.roles ?? []) {
          roles.push({ organization, department, team, role });
        }
      }
    }
  }
  return roles;
}

function roleLabel(roleRef) {
  return [roleRef.organization?.name, roleRef.department?.name, roleRef.team?.name, roleRef.role?.title].filter(Boolean).join(' • ');
}

function agentsForRole(roleId) {
  return personas.filter(persona => persona.roleId === roleId);
}

function departmentAssignedAgents(organizationId, departmentId) {
  return allOrganizationRoles()
    .filter(ref => ref.organization.id === organizationId && ref.department.id === departmentId)
    .flatMap(ref => agentsForRole(ref.role.id))
    .filter((agent, index, arr) => agent && arr.findIndex(item => item.id === agent.id) === index);
}

function teamAssignedAgents(organizationId, teamId) {
  return allOrganizationRoles()
    .filter(ref => ref.organization.id === organizationId && ref.team.id === teamId)
    .flatMap(ref => agentsForRole(ref.role.id))
    .filter((agent, index, arr) => agent && arr.findIndex(item => item.id === agent.id) === index);
}

function refreshRoleDependentViews() {
  syncRoleAssignmentsFromAgents();
  renderOrganizationList();
  hydrateManagementEditor();
  renderGroupParticipantOptions();
  renderGroupParticipants();
  hydratePersonaEditor();
  if (typeof chatRefreshPersonaSelector === 'function') chatRefreshPersonaSelector(typeof personas !== 'undefined' ? personas : []);
}

function syncRoleAssignmentsFromAgents() {
  for (const ref of allOrganizationRoles()) {
    const assigned = personas.find(persona => persona.roleId === ref.role.id);
    ref.role.agentId = assigned?.id ?? '';
  }
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

function selectOrganization(id) {
  activeOrganizationId = id;
  const org = activeOrganization();
  if (org) org.hasUpdate = false;
  renderOrganizationList();
  hydrateManagementEditor();
}

function createOrganization() {
  const org = makeDefaultOrganization();
  organizations.push(org);
  activeOrganizationId = org.id;
  saveOrganizations();
  hydrateManagementEditor();
}

function addDepartment(organization) {
  const departmentId = `${organization.id}-dept-${Date.now().toString(36)}`;
  organization.departments.push({
    id: departmentId,
    name: 'New Department',
    description: '',
    teams: [],
  });
  activeDepartmentId = departmentId;
  saveOrganizations();
  hydrateManagementEditor();
}

function addTeam(department) {
  department.teams.push({
    id: `${department.id}-team-${Date.now().toString(36)}`,
    name: 'New Team',
    description: '',
    roles: [],
  });
  saveOrganizations();
  hydrateManagementEditor();
}

function addRole(team) {
  team.roles.push({
    id: `${team.id}-role-${Date.now().toString(36)}`,
    title: 'New Role',
    description: '',
    agentId: '',
  });
  saveOrganizations();
  hydrateManagementEditor();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderOrganizationList() {
  const list = document.getElementById('management-department-list');
  if (!list) return;
  const organization = activeOrganization();
  if (!organization) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren(...organization.departments.map(department => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${department.id === activeDepartmentId ? ' workspace-item--active' : ''}`;
    button.dataset.status = organization.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => {
      activeDepartmentId = department.id;
      renderOrganizationList();
      hydrateManagementEditor();
    });
    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(organization.hasUpdate ? 'attention' : 'idle', '▤');
    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = department.name;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = `${department.teams.length} team${department.teams.length === 1 ? '' : 's'}`;
    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));
}

function renderOrganizationRolePicker(select, selectedAgentId = '') {
  if (!select) return;
  select.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Unfilled';
  select.appendChild(defaultOpt);
  for (const agent of personas) {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = `${agent.name.trim() || 'Untitled Agent'}${agent.title.trim() ? ` • ${agent.title.trim()}` : ''}`;
    select.appendChild(opt);
  }
  select.value = personas.some(agent => agent.id === selectedAgentId) ? selectedAgentId : '';
}

async function generateAgentFromRole(roleRef) {
  const source = personaDraftSource();
  const name = roleRef.role.title;
  const title = roleRef.role.title;
  const description = [
    roleRef.role.description,
    `Team: ${roleRef.team.name}`,
    `Department: ${roleRef.department.name}`,
    `Organization: ${roleRef.organization.name}`,
    roleRef.organization.industry ? `Industry: ${roleRef.organization.industry}` : '',
    roleRef.organization.products ? `Products: ${roleRef.organization.products}` : '',
  ].filter(Boolean).join('\n');

  const created = makePersona();
  created.name = `${roleRef.organization.name} ${roleRef.role.title}`;
  created.title = title;
  created.description = roleRef.role.description;
  created.roleId = roleRef.role.id;
  created.skills = Array.from(new Set([
    roleRef.role.title === 'CEO' ? 'web-browsing' : '',
    roleRef.role.title === 'CEO' ? 'memory' : '',
    roleRef.role.title === 'COO' ? 'memory' : '',
    roleRef.role.title === 'CTO' ? 'technologist' : '',
    roleRef.role.title === 'CTO' ? 'memory' : '',
  ].filter(Boolean)));
  personas.push(created);
  activePersonaId = created.id;

  if (!source) {
    created.instructions = [
      `You are the ${roleRef.role.title} for ${roleRef.organization.name}.`,
      roleRef.role.description || 'Lead your function with clarity, rigor, and practical decision making.',
      `Operate within the ${roleRef.department.name} department on the ${roleRef.team.name} team.`,
    ].join(' ');
    await persistPersona(created);
    roleRef.role.agentId = activePersonaId;
    saveOrganizations();
    hydrateManagementEditor();
    savePersonas();
    return;
  }

  const messages = workflowMessages({
    sourceModel: source.selectedModel,
    workflow: 'persona_drafting',
    role: 'You write production-ready system instructions for role-based AI agents.',
    instructions: [
      'Draft an optimized agent for the specified organizational role.',
      'Preserve the role scope, responsibilities, and organizational context.',
    ],
    context: {
      organization_name: roleRef.organization.name,
      organization_description: roleRef.organization.description || '(unspecified)',
      industry: roleRef.organization.industry || '(unspecified)',
      products: roleRef.organization.products || '(unspecified)',
      department: roleRef.department.name,
      team: roleRef.team.name,
      role_title: roleRef.role.title,
      role_description: roleRef.role.description || '(unspecified)',
    },
    input: 'Draft the agent system instructions for this role.',
    outputFormat: 'Return only the final system instructions.',
    includeThought: true,
  });

  let draftText = '';
  const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: source.selectedModel, messages, stream: true }),
  });
  if (!response.ok) throw new Error(`Agent generation failed: HTTP ${response.status}`);
  for await (const chunk of readNdjsonStream(response)) {
    draftText += chunk.message?.content ?? '';
    if (chunk.done) break;
  }
  const parsed = Policy.parseStructuredResponse(draftText);
  created.instructions = (parsed.answer || draftText).trim();
  await persistPersona(created);
  roleRef.role.agentId = activePersonaId;
  saveOrganizations();
  hydrateManagementEditor();
  savePersonas();
}

async function generateOrganizationSuggestions() {
  const organization = activeOrganization();
  const source = personaDraftSource();
  if (!organization || !source) {
    alert('Connect an inference source before generating organizational suggestions.');
    return;
  }
  const messages = workflowMessages({
    sourceModel: source.selectedModel,
    workflow: 'organization_design',
    role: 'You design pragmatic organizational charts and role structures.',
    instructions: [
      'Suggest departments, teams, and roles that fit the organization.',
      'Avoid duplicating Administration, CEO, COO, or CTO.',
      'Return concise structured JSON.',
    ],
    context: {
      organization_name: organization.name,
      organization_description: organization.description || '(unspecified)',
      industry: organization.industry || '(unspecified)',
      products: organization.products || '(unspecified)',
      existing_departments: organization.departments.map(department => department.name).join(', ') || '(none)',
    },
    input: 'Suggest the next departments, teams, and roles this organization should add.',
    outputFormat: 'Return only valid JSON: {"notes":"","departments":[{"name":"","description":"","teams":[{"name":"","description":"","roles":[{"title":"","description":""}]}]}]}',
    includeThought: true,
  });
  let raw = '';
  const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: source.selectedModel, messages, stream: true }),
  });
  if (!response.ok) throw new Error(`Suggestion request failed: HTTP ${response.status}`);
  for await (const chunk of readNdjsonStream(response)) {
    raw += chunk.message?.content ?? '';
    if (chunk.done) break;
  }
  const parsed = Policy.parseStructuredResponse(raw);
  const candidate = JSON.parse(parsed.answer || raw);
  organization.suggestions = {
    departments: candidate.departments ?? [],
    teams: [],
    roles: [],
    notes: candidate.notes ?? '',
  };
  for (const dept of candidate.departments ?? []) {
    const deptId = `${organization.id}-dept-${slugifyLabel(dept.name, 'department')}-${Date.now().toString(36).slice(-4)}`;
    organization.departments.push({
      id: deptId,
      name: dept.name || 'New Department',
      description: dept.description || '',
      teams: (dept.teams ?? []).map(team => ({
        id: `${deptId}-team-${slugifyLabel(team.name, 'team')}-${Math.random().toString(36).slice(2, 5)}`,
        name: team.name || 'New Team',
        description: team.description || '',
        roles: (team.roles ?? []).map(role => ({
          id: `${deptId}-role-${slugifyLabel(role.title, 'role')}-${Math.random().toString(36).slice(2, 5)}`,
          title: role.title || 'New Role',
          description: role.description || '',
          agentId: '',
        })),
      })),
    });
    activeDepartmentId = deptId;
  }
  organization.hasUpdate = true;
  saveOrganizations();
  hydrateManagementEditor();
}

function hydrateManagementEditor() {
  const organization = activeOrganization();
  const departmentFocus = activeDepartment();
  const nameEl = document.getElementById('org-name');
  const descriptionEl = document.getElementById('org-description');
  const industryEl = document.getElementById('org-industry');
  const productsEl = document.getElementById('org-products');
  const chartEl = document.getElementById('org-chart');
  const notesEl = document.getElementById('org-suggestion-notes');
  if (!organization || !nameEl || !descriptionEl || !industryEl || !productsEl || !chartEl || !notesEl) return;

  nameEl.value = organization.name;
  descriptionEl.value = organization.description;
  industryEl.value = organization.industry;
  productsEl.value = organization.products;
  notesEl.textContent = organization.suggestions?.notes || 'Use Generate Suggestions to intelligently expand the chart.';

  const departmentsToRender = departmentFocus ? [departmentFocus] : [];
  chartEl.replaceChildren(...departmentsToRender.map(department => {
    const card = document.createElement('details');
    card.className = 'org-node';
    card.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `${department.name} (${department.teams.length} team${department.teams.length === 1 ? '' : 's'})`;
    card.appendChild(summary);

    const headerField = document.createElement('input');
    headerField.className = 'text-input';
    headerField.value = department.name;
    headerField.addEventListener('input', () => {
      department.name = headerField.value || 'Unnamed Department';
      saveOrganizations();
    });

    const descriptionField = document.createElement('textarea');
    descriptionField.className = 'persona-textarea';
    descriptionField.rows = 2;
    descriptionField.value = department.description || '';
    descriptionField.placeholder = 'Department description';
    descriptionField.addEventListener('input', () => {
      department.description = descriptionField.value;
      saveOrganizations();
    });

    const addTeamBtn = document.createElement('button');
    addTeamBtn.type = 'button';
    addTeamBtn.className = 'btn-secondary';
    addTeamBtn.textContent = 'Add Team';
    addTeamBtn.addEventListener('click', () => addTeam(department));

    const teamsWrap = document.createElement('div');
    teamsWrap.className = 'org-teams';
    teamsWrap.replaceChildren(...department.teams.map(team => {
      const teamCard = document.createElement('div');
      teamCard.className = 'org-subnode';
      const teamName = document.createElement('input');
      teamName.className = 'text-input';
      teamName.value = team.name;
      teamName.addEventListener('input', () => {
        team.name = teamName.value || 'Unnamed Team';
        saveOrganizations();
      });
      const teamDescription = document.createElement('textarea');
      teamDescription.className = 'persona-textarea';
      teamDescription.rows = 2;
      teamDescription.value = team.description || '';
      teamDescription.placeholder = 'Team description';
      teamDescription.addEventListener('input', () => {
        team.description = teamDescription.value;
        saveOrganizations();
      });

      const addRoleBtn = document.createElement('button');
      addRoleBtn.type = 'button';
      addRoleBtn.className = 'btn-secondary';
      addRoleBtn.textContent = 'Add Role';
      addRoleBtn.addEventListener('click', () => addRole(team));

      const rolesWrap = document.createElement('div');
      rolesWrap.className = 'org-roles';
      rolesWrap.replaceChildren(...team.roles.map(role => {
        const roleCard = document.createElement('div');
        roleCard.className = 'org-role-card';
        const titleField = document.createElement('input');
        titleField.className = 'text-input';
        titleField.value = role.title;
        titleField.addEventListener('input', () => {
          role.title = titleField.value || 'Untitled Role';
          saveOrganizations();
        });
        const roleDescription = document.createElement('textarea');
        roleDescription.className = 'persona-textarea';
        roleDescription.rows = 2;
        roleDescription.value = role.description || '';
        roleDescription.placeholder = 'Role description';
        roleDescription.addEventListener('input', () => {
          role.description = roleDescription.value;
          saveOrganizations();
        });

        const statusRow = document.createElement('div');
        statusRow.className = 'org-role-status-row';
        const status = document.createElement('span');
        status.className = `org-role-status ${role.agentId ? 'org-role-status--filled' : 'org-role-status--open'}`;
        status.textContent = role.agentId ? 'Filled' : 'Unfilled';
        const agentSelect = document.createElement('select');
        agentSelect.className = 'chat-source-select';
        renderOrganizationRolePicker(agentSelect, role.agentId);
        agentSelect.addEventListener('change', async () => {
          role.agentId = agentSelect.value;
          const agent = savedPersonaById(role.agentId);
          if (agent) {
            agent.roleId = role.id;
            await persistPersona(agent);
          }
          saveOrganizations();
          hydrateManagementEditor();
        });
        const generateBtn = document.createElement('button');
        generateBtn.type = 'button';
        generateBtn.className = 'btn-secondary';
        generateBtn.textContent = 'Generate Agent';
        generateBtn.addEventListener('click', async () => {
          const roleRef = findRoleById(role.id);
          if (!roleRef) return;
          await generateAgentFromRole(roleRef);
          role.agentId = savedPersonaById(activePersonaId)?.id ?? role.agentId;
          saveOrganizations();
          hydrateManagementEditor();
        });
        statusRow.append(status, agentSelect, generateBtn);
        roleCard.append(titleField, roleDescription, statusRow);
        return roleCard;
      }));

      teamCard.append(teamName, teamDescription, addRoleBtn, rolesWrap);
      return teamCard;
    }));

    card.append(headerField, descriptionField, addTeamBtn, teamsWrap);
    return card;
  }));
}

function renderManagementPanel(body, actionsLeft, actionsRight) {
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add department';
  addBtn.addEventListener('click', () => {
    const org = activeOrganization();
    if (!org) return;
    addDepartment(org);
  });
  actionsRight.appendChild(addBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.textContent = '↔';
  navToggle.title = 'Collapse department list';
  navToggle.addEventListener('click', () => {
    uiState.managementNavCollapsed = !uiState.managementNavCollapsed;
    const shellEl = document.getElementById('management-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.managementNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.id = 'management-shell';
  shell.className = 'workspace-shell persona-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.managementNavCollapsed);
  const nav = document.createElement('div');
  nav.id = 'management-department-list';
  nav.className = 'workspace-nav persona-list';
  const detail = document.createElement('div');
  detail.className = 'workspace-detail persona-editor';

  const intro = document.createElement('div');
  intro.className = 'persona-intro';
  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Management';
  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Model the organization, departments, teams, and roles so the rest of the app can work with real group structures.';
  intro.append(heading, hint);

  const form = document.createElement('div');
  form.className = 'persona-editor-form';
  for (const [id, labelText, placeholder] of [
    ['org-name', 'Organization Name', 'e.g. Northwind Robotics'],
    ['org-industry', 'Industry', 'e.g. Robotics'],
    ['org-products', 'Products', 'e.g. Warehouse automation systems'],
  ]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'text-input';
    input.type = 'text';
    input.placeholder = placeholder;
    input.addEventListener('input', () => {
      const org = activeOrganization();
      if (!org) return;
      if (id === 'org-name') org.name = input.value || 'Untitled Organization';
      if (id === 'org-industry') org.industry = input.value;
      if (id === 'org-products') org.products = input.value;
      saveOrganizations();
    });
    field.append(label, input);
    form.appendChild(field);
  }
  const descField = document.createElement('div');
  descField.className = 'persona-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'field-label';
  descLabel.htmlFor = 'org-description';
  descLabel.textContent = 'Organization Description';
  const descArea = document.createElement('textarea');
  descArea.id = 'org-description';
  descArea.className = 'persona-textarea';
  descArea.rows = 4;
  descArea.placeholder = 'Describe the organization, market, and operating context.';
  descArea.addEventListener('input', () => {
    const org = activeOrganization();
    if (!org) return;
    org.description = descArea.value;
    saveOrganizations();
  });
  descField.append(descLabel, descArea);

  const suggestionRow = document.createElement('div');
  suggestionRow.className = 'persona-action-row';
  const suggestBtn = document.createElement('button');
  suggestBtn.type = 'button';
  suggestBtn.className = 'btn-secondary';
  suggestBtn.textContent = 'Generate Suggestions';
  suggestBtn.addEventListener('click', async () => {
    await generateOrganizationSuggestions();
  });
  const addDeptBtn = document.createElement('button');
  addDeptBtn.type = 'button';
  addDeptBtn.className = 'btn-secondary';
  addDeptBtn.textContent = 'Add Department';
  addDeptBtn.addEventListener('click', () => {
    const org = activeOrganization();
    if (!org) return;
    addDepartment(org);
  });
  suggestionRow.append(suggestBtn, addDeptBtn);

  const notes = document.createElement('pre');
  notes.id = 'org-suggestion-notes';
  notes.className = 'tool-test-status';
  const chart = document.createElement('div');
  chart.id = 'org-chart';
  chart.className = 'org-chart';

  form.append(descField, suggestionRow, notes, chart);
  detail.append(intro, form);
  shell.append(nav, detail);
  body.appendChild(shell);
  renderOrganizationList();
  hydrateManagementEditor();
}
