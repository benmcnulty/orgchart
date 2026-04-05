// agents.js — Agent (persona) state, CRUD, editor, and instruction drafting.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: PERSONA_STORAGE_KEY, DEFAULT_MODEL, uiState,
// Policy — all resolved at call time (not load time).
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el
// References functions from other modules (resolved at runtime via globals):
//   syncGroupParticipantsWithPersonas, renderGroupParticipantOptions, renderGroupParticipants (meetings.js)
//   findRoleById, allOrganizationRoles, roleLabel, refreshRoleDependentViews, syncRoleAssignmentsFromAgents (management.js)
//   skillById, renderSkillList (skills.js)

// ─── State ────────────────────────────────────────────────────────────────────

let personas = [];
let nextPersonaSeq = 1;
let activePersonaId = null;
let personaDraftController = null;

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadPersonas() {
  try {
    const saved = localStorage.getItem(PERSONA_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      personas = parsed.map(p => ({
        id: p.id,
        name: p.name ?? '',
        title: p.title ?? '',
        description: p.description ?? '',
        instructions: p.instructions ?? '',
        _seq: p._seq ?? nextPersonaSeq++,
        generating: false,
        hasUpdate: false,
      }));
      nextPersonaSeq = Math.max(0, ...personas.map(p => p._seq ?? 0)) + 1;
    }
  } catch {
    personas = [];
  }

  activePersonaId = personas[0]?.id ?? null;
}

function savePersonas() {
  notifyPersonas();
  renderPersonaList();
  syncGroupParticipantsWithPersonas();
  renderGroupParticipantOptions();
  renderGroupParticipants();
  setSaveIndicator('saved', 'Agents updated.');
}

// ─── Agent Helpers ────────────────────────────────────────────────────────────

function agentHasSkill(agent, skillSlug) {
  return Boolean(agent && Array.isArray(agent.skills) && agent.skills.includes(skillSlug));
}

async function fetchAgentMemoryIndexes(agent) {
  if (!agent?.slug || !agentHasSkill(agent, 'memory')) return '';
  if (!toolEnabled('memory-read')) return '';
  try {
    const [working, longterm] = await Promise.all([
      apiJson('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'index', agentSlug: agent.slug, scope: 'working-memory' }),
      }),
      apiJson('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'index', agentSlug: agent.slug, scope: 'longterm-memory' }),
      }),
    ]);
    return [
      'Agent memory indexes:',
      `Working memory files: ${(working.files ?? []).map(file => file.name).join(', ') || '(none)'}`,
      `Long-term memory files: ${(longterm.files ?? []).map(file => file.name).join(', ') || '(none)'}`,
    ].join('\n');
  } catch {
    return '';
  }
}

async function fetchWebResearchContext(query) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return '';
  const parts = [];
  try {
    if (toolEnabled('wikipedia')) {
      const wiki = await apiJson('/api/tools/wikipedia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      parts.push([
        `Wikipedia: ${wiki.title}`,
        wiki.summary || wiki.content || '(no summary)',
        wiki.url ? `URL: ${wiki.url}` : '',
      ].filter(Boolean).join('\n'));
    }
  } catch { /* non-fatal */ }
  try {
    if (toolEnabled('web-search')) {
      const search = await apiJson('/api/tools/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const top = (search.results ?? []).slice(0, 3).map((result, index) => `${index + 1}. ${result.title}\n${result.snippet}\n${result.url}`);
      if (top.length) parts.push(`Web search results:\n${top.join('\n\n')}`);
    }
  } catch { /* non-fatal */ }
  return parts.join('\n\n');
}

async function buildAgentResourceContext(agent, prompt, extra = {}) {
  if (!agent) return '';
  const blocks = [];
  const memory = await fetchAgentMemoryIndexes(agent);
  if (memory) blocks.push(memory);
  if (agentHasSkill(agent, 'web-browsing')) {
    const research = await fetchWebResearchContext(extra.researchQuery || prompt || extra.topic || '');
    if (research) blocks.push(research);
  }
  return blocks.join('\n\n');
}

async function writeAgentMemory(agent, scope, fileName, content) {
  if (!agent?.slug || !content?.trim()) return null;
  if (!(toolEnabled('memory-write') || toolEnabled('memory-update'))) return null;
  return apiJson('/api/tools/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      op: 'write',
      agentSlug: agent.slug,
      scope,
      fileName,
      content: content.trim(),
    }),
  });
}

window.orgchartBuildAgentResourceContext = buildAgentResourceContext;

// ─── Catalog Hydration ────────────────────────────────────────────────────────

function localPersonaSnapshot() {
  try {
    const saved = localStorage.getItem(PERSONA_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hydrateAgentsFromCatalog(catalogAgents) {
  personas = catalogAgents.map((agent, index) => ({
    id: agent.id ?? `agent:${agent.slug ?? index + 1}`,
    slug: agent.slug ?? `agent-${index + 1}`,
    name: agent.name ?? '',
    title: agent.title ?? '',
    description: agent.description ?? '',
    instructions: agent.instructions ?? '',
    roleId: agent.roleId ?? '',
    skills: Array.isArray(agent.skills) ? [...agent.skills] : [],
    color: agent.color ?? 'blue',
    _seq: index + 1,
    generating: false,
    hasUpdate: false,
  }));
  nextPersonaSeq = personas.length + 1;
  activePersonaId = personas.some(agent => agent.id === activePersonaId) ? activePersonaId : personas[0]?.id ?? null;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function notifyPersonas() {
  document.dispatchEvent(new CustomEvent('personas-changed', {
    detail: { personas, activePersonaId },
  }));
}

// ─── Agent Management ─────────────────────────────────────────────────────────

function makePersona() {
  const seq = nextPersonaSeq++;
  const slug = `agent-${seq}`;
  return {
    id: `agent:${slug}`,
    slug,
    name: '',
    title: '',
    description: '',
    instructions: '',
    roleId: '',
    skills: [],
    color: 'blue',
    generating: false,
    hasUpdate: false,
    _seq: seq,
  };
}

function activePersona() {
  return personas.find(p => p.id === activePersonaId) ?? null;
}

function ensureActivePersona() {
  const persona = activePersona();
  if (persona) return persona;

  const created = makePersona();
  personas.push(created);
  activePersonaId = created.id;
  savePersonas();
  hydratePersonaEditor();
  return created;
}

function createNewPersona() {
  const created = makePersona();
  personas.push(created);
  activePersonaId = created.id;
  savePersonas();
  hydratePersonaEditor();
}

function selectPersona(id) {
  activePersonaId = id;
  const persona = activePersona();
  if (persona) persona.hasUpdate = false;
  renderPersonaList();
  hydratePersonaEditor();
  notifyPersonas();
}

async function persistPersona(persona) {
  const payload = {
    id: persona.id,
    slug: persona.slug || persona.name || persona.title || persona.id,
    name: persona.name.trim(),
    title: persona.title.trim(),
    description: persona.description.trim(),
    instructions: persona.instructions.trim(),
    roleId: persona.roleId ?? '',
    skills: Array.isArray(persona.skills) ? [...persona.skills] : [],
    color: persona.color ?? 'blue',
  };
  const { agent } = await apiJson('/api/orgchart/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  activePersonaId = agent.id;
  const existing = activePersona();
  if (existing) {
    existing.id = agent.id;
    existing.slug = agent.slug;
    existing.name = agent.name;
    existing.title = agent.title;
    existing.description = agent.description;
    existing.instructions = agent.instructions;
    existing.skills = [...(agent.skills ?? [])];
    existing.color = agent.color ?? existing.color;
  }
  await bootstrapOrgChartState();
  renderSkillToolOptions();
  syncGroupParticipantsWithPersonas();
  refreshRoleDependentViews();
  setSaveIndicator('saved', 'Agent saved.');
}

async function deleteActivePersona() {
  const persona = activePersona();
  if (!persona) return;

  await apiJson(`/api/orgchart/agents/${encodeURIComponent(persona.slug || persona.name || persona.id)}`, {
    method: 'DELETE',
  });
  personas = personas.filter(p => p.id !== persona.id);
  activePersonaId = personas[0]?.id ?? null;
  savePersonas();
  hydratePersonaEditor();
}

// ─── Card Rendering ───────────────────────────────────────────────────────────

function hydratePersonaEditor() {
  const nameEl = document.getElementById('persona-name');
  const titleEl = document.getElementById('persona-title');
  const descEl = document.getElementById('persona-description');
  const instructionsEl = document.getElementById('persona-instructions');
  const roleEl = document.getElementById('persona-role');
  const skillsEl = document.getElementById('persona-skill-list');
  const emptyEl = document.getElementById('persona-editor-empty');
  const formEl = document.getElementById('persona-editor-form');
  const deleteBtn = document.getElementById('persona-delete-btn');

  if (!nameEl || !titleEl || !descEl || !instructionsEl || !roleEl || !skillsEl || !emptyEl || !formEl) return;

  const persona = activePersona();
  const hasPersona = Boolean(persona);
  emptyEl.classList.toggle('hidden', hasPersona);
  formEl.classList.toggle('hidden', !hasPersona);
  if (deleteBtn) deleteBtn.disabled = !hasPersona;

  if (!persona) {
    nameEl.value = '';
    titleEl.value = '';
    descEl.value = '';
    instructionsEl.value = '';
    roleEl.value = '';
    skillsEl.replaceChildren();
    setPersonaStatus('Create an agent to draft reusable system instructions.', 'muted');
    return;
  }

  nameEl.value = persona.name;
  titleEl.value = persona.title;
  descEl.value = persona.description;
  instructionsEl.value = persona.instructions;
  populateAgentRoleOptions(roleEl, persona.roleId);
  renderPersonaSkillChecklist(skillsEl, persona);
  setPersonaStatus('Saved agents appear in the chat agent selector.', 'muted');
}

function renderPersonaList() {
  const list = document.getElementById('persona-list');
  if (!list) return;

  if (personas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'persona-list-empty';
    empty.textContent = 'No agents saved yet.';
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...personas.map(persona => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${persona.id === activePersonaId ? ' workspace-item--active' : ''}`;
    button.dataset.status = persona.generating ? 'processing' : persona.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => selectPersona(persona.id));

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(
      persona.generating ? 'processing' : persona.hasUpdate ? 'attention' : 'idle',
      '◌',
    );

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const name = document.createElement('span');
    name.className = 'workspace-item-title';
    name.textContent = persona.name.trim() || 'Untitled Agent';

    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    const roleRef = persona.roleId ? findRoleById(persona.roleId) : null;
    meta.textContent = roleRef?.role?.title || persona.title.trim() || persona.description.trim() || 'Custom system instructions';

    copy.append(name, meta);
    button.append(icon, copy);
    return button;
  }));
}

function renderPersonaSkillChecklist(container, persona) {
  if (!container) return;
  if (skills.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tool-test-status';
    empty.textContent = 'No skills available yet.';
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...skills.map(skill => {
    const label = document.createElement('label');
    label.className = 'agent-skill-chip';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = skill.slug;
    input.checked = Array.isArray(persona.skills) && persona.skills.includes(skill.slug);
    input.addEventListener('change', () => {
      persona.skills = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
    });
    const text = document.createElement('span');
    text.textContent = skill.title;
    label.append(input, text);
    return label;
  }));
}

function populateAgentRoleOptions(select, selectedRoleId = '') {
  if (!select) return;
  const roles = allOrganizationRoles();
  select.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Unassigned role';
  select.appendChild(defaultOpt);
  for (const ref of roles) {
    const option = document.createElement('option');
    option.value = ref.role.id;
    option.textContent = roleLabel(ref);
    select.appendChild(option);
  }
  select.value = roles.some(ref => ref.role.id === selectedRoleId) ? selectedRoleId : '';
}

function bindPersonaEditor() {
  const nameEl = document.getElementById('persona-name');
  const titleEl = document.getElementById('persona-title');
  const descEl = document.getElementById('persona-description');
  const instructionsEl = document.getElementById('persona-instructions');
  const roleEl = document.getElementById('persona-role');
  const skillsEl = document.getElementById('persona-skill-list');
  const newBtn = document.getElementById('persona-new-btn');
  const saveBtn = document.getElementById('persona-save-btn');
  const deleteBtn = document.getElementById('persona-delete-btn');
  const draftBtn = document.getElementById('persona-draft-btn');
  const reviseBtn = document.getElementById('persona-revise-btn');

  if (!nameEl || !titleEl || !descEl || !instructionsEl || !roleEl || !skillsEl || !newBtn || !saveBtn || !deleteBtn || !draftBtn || !reviseBtn) return;

  const updateActiveDraft = () => {
    const persona = activePersona();
    if (!persona) return;
    persona.name = nameEl.value;
    persona.title = titleEl.value;
    persona.description = descEl.value;
    persona.instructions = instructionsEl.value;
    persona.roleId = roleEl.value;
    renderPersonaList();
  };

  nameEl.addEventListener('input', updateActiveDraft);
  titleEl.addEventListener('input', updateActiveDraft);
  descEl.addEventListener('input', updateActiveDraft);
  instructionsEl.addEventListener('input', updateActiveDraft);
  roleEl.addEventListener('change', () => {
    updateActiveDraft();
    refreshRoleDependentViews();
  });

  newBtn.addEventListener('click', createNewPersona);
  saveBtn.addEventListener('click', async () => {
    const persona = ensureActivePersona();
    persona.name = nameEl.value.trim();
    persona.title = titleEl.value.trim();
    persona.description = descEl.value.trim();
    persona.instructions = instructionsEl.value.trim();
    persona.roleId = roleEl.value;
    persona.skills = Array.from(skillsEl.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    await persistPersona(persona);
    savePersonas();
    hydratePersonaEditor();
    setPersonaStatus(`Saved ${persona.name || 'agent'}.`, 'success');
  });

  deleteBtn.addEventListener('click', async () => {
    await deleteActivePersona();
    setPersonaStatus('Agent removed.', 'muted');
  });

  draftBtn.addEventListener('click', () => draftPersonaInstructions('draft'));
  reviseBtn.addEventListener('click', () => draftPersonaInstructions('revise'));
}

function renderPersonaPanel(body, actionsLeft, actionsRight) {
  const newBtn = document.createElement('button');
  newBtn.id = 'persona-new-btn';
  newBtn.className = 'btn-add';
  newBtn.title = 'Create agent';
  newBtn.textContent = '+';
  actionsRight.appendChild(newBtn);

  const memoryBtn = document.createElement('button');
  memoryBtn.type = 'button';
  memoryBtn.className = 'btn-secondary';
  memoryBtn.textContent = 'Consolidate Memory';
  memoryBtn.addEventListener('click', async () => {
    await runAllAgentMemoryConsolidation();
    setPersonaStatus('Long-term memory consolidation completed.', 'success');
  });
  actionsRight.appendChild(memoryBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse agent list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.personasNavCollapsed = !uiState.personasNavCollapsed;
    const shellEl = document.getElementById('persona-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.personasNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.className = 'workspace-shell persona-shell';
  shell.id = 'persona-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.personasNavCollapsed);

  const list = document.createElement('div');
  list.className = 'workspace-nav persona-list';
  list.id = 'persona-list';

  const editor = document.createElement('div');
  editor.className = 'workspace-detail persona-editor';

  const intro = document.createElement('div');
  intro.className = 'persona-intro';

  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Agent Editor';

  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Draft concise system instructions from a role, then refine and save them for chat and pipeline reuse.';
  intro.append(heading, hint);

  const empty = document.createElement('div');
  empty.id = 'persona-editor-empty';
  empty.className = 'persona-editor-empty';
  empty.textContent = 'Create an agent to start drafting instructions.';

  const form = document.createElement('div');
  form.id = 'persona-editor-form';
  form.className = 'persona-editor-form hidden';

  const fields = [
    ['persona-name', 'Name', 'e.g. Executive Coach'],
    ['persona-title', 'Job Title', 'e.g. VP of Product'],
  ];

  for (const [id, labelText, placeholder] of fields) {
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
    input.autocomplete = 'off';

    field.append(label, input);
    form.appendChild(field);
  }

  const descField = document.createElement('div');
  descField.className = 'persona-field';

  const descLabel = document.createElement('label');
  descLabel.className = 'field-label';
  descLabel.htmlFor = 'persona-description';
  descLabel.textContent = 'Brief Description';

  const descArea = document.createElement('textarea');
  descArea.id = 'persona-description';
  descArea.className = 'persona-textarea';
  descArea.rows = 4;
  descArea.placeholder = 'Optional context or a rough persona idea to expand.';
  descField.append(descLabel, descArea);

  const instructionsField = document.createElement('div');
  instructionsField.className = 'persona-field';

  const instructionsLabel = document.createElement('label');
  instructionsLabel.className = 'field-label';
  instructionsLabel.htmlFor = 'persona-instructions';
  instructionsLabel.textContent = 'System Instructions';

  const instructionsArea = document.createElement('textarea');
  instructionsArea.id = 'persona-instructions';
  instructionsArea.className = 'persona-textarea persona-textarea--instructions';
  instructionsArea.rows = 12;
  instructionsArea.placeholder = 'Saved instructions are sent as the system message when this agent is selected in chat or a pipeline phase.';
  instructionsField.append(instructionsLabel, instructionsArea);

  const roleField = document.createElement('div');
  roleField.className = 'persona-field';
  const roleLabel = document.createElement('label');
  roleLabel.className = 'field-label';
  roleLabel.htmlFor = 'persona-role';
  roleLabel.textContent = 'Role Assignment';
  const roleSelect = document.createElement('select');
  roleSelect.id = 'persona-role';
  roleSelect.className = 'chat-source-select';
  roleField.append(roleLabel, roleSelect);

  const skillsField = document.createElement('div');
  skillsField.className = 'persona-field';
  const skillsLabel = document.createElement('label');
  skillsLabel.className = 'field-label';
  skillsLabel.textContent = 'Skills';
  const skillsList = document.createElement('div');
  skillsList.id = 'persona-skill-list';
  skillsList.className = 'agent-skill-list';
  skillsField.append(skillsLabel, skillsList);

  const footer = document.createElement('div');
  footer.className = 'persona-actions';

  const status = document.createElement('p');
  status.id = 'persona-status';
  status.className = 'persona-status';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'persona-action-row';

  const draftBtn = document.createElement('button');
  draftBtn.id = 'persona-draft-btn';
  draftBtn.className = 'btn-secondary';
  draftBtn.textContent = 'Draft';

  const reviseBtn = document.createElement('button');
  reviseBtn.id = 'persona-revise-btn';
  reviseBtn.className = 'btn-secondary';
  reviseBtn.textContent = 'Revise';

  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'persona-delete-btn';
  deleteBtn.className = 'btn-secondary';
  deleteBtn.textContent = 'Delete';

  const saveBtn = document.createElement('button');
  saveBtn.id = 'persona-save-btn';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Save Agent';

  actionsRow.append(draftBtn, reviseBtn, deleteBtn, saveBtn);
  footer.append(status, actionsRow);
  form.append(descField, instructionsField, roleField, skillsField, footer);

  editor.append(intro, empty, form);
  shell.append(list, editor);
  body.appendChild(shell);

  renderPersonaList();
  bindPersonaEditor();
  hydratePersonaEditor();
}

// ─── Status ───────────────────────────────────────────────────────────────────

function setPersonaStatus(message, tone = 'muted') {
  const status = document.getElementById('persona-status');
  if (!status) return;
  status.textContent = message;
  status.className = `persona-status persona-status--${tone}`;
}

// ─── Instruction Drafting ─────────────────────────────────────────────────────

function personaDraftSource() {
  const preferred = defaultSource();
  if (preferred?.status === 'connected' && preferred.selectedModel) return preferred;
  return enabledSources().find(source => source.status === 'connected' && source.selectedModel) ?? null;
}

async function draftPersonaInstructions(mode = 'draft') {
  const persona = ensureActivePersona();
  const source = personaDraftSource();
  if (!source) {
    setPersonaStatus('Connect an inference source before drafting agent instructions.', 'error');
    return;
  }

  const description = document.getElementById('persona-description')?.value.trim() ?? '';
  const name = document.getElementById('persona-name')?.value.trim() ?? '';
  const title = document.getElementById('persona-title')?.value.trim() ?? '';
  const instructionsEl = document.getElementById('persona-instructions');
  const draftBtn = document.getElementById('persona-draft-btn');
  const reviseBtn = document.getElementById('persona-revise-btn');
  if (!instructionsEl || !draftBtn || !reviseBtn) return;
  const currentInstructions = instructionsEl.value.trim();
  const roleRef = findRoleById(persona.roleId);

  if (!name && !title && !description && !(mode === 'revise' && currentInstructions)) {
    setPersonaStatus('Add at least a name, title, or brief description to draft from.', 'error');
    return;
  }
  if (mode === 'revise' && !currentInstructions) {
    setPersonaStatus('Add or draft instructions before requesting a revision.', 'error');
    return;
  }

  persona.name = name;
  persona.title = title;
  persona.description = description;
  renderPersonaList();

  personaDraftController?.abort();
  personaDraftController = new AbortController();
  persona.generating = true;
  persona.hasUpdate = false;
  renderPersonaList();
  draftBtn.disabled = true;
  reviseBtn.disabled = true;
  setPersonaStatus(`${mode === 'revise' ? 'Revising' : 'Drafting'} with ${displayLabel(source)} • ${source.selectedModel}`, 'muted');

  const messages = workflowMessages({
    sourceModel: source.selectedModel,
    workflow: 'persona_drafting',
    role: 'You write production-ready system instructions for role-based AI agents.',
    instructions: [
      mode === 'revise' ? 'Revise the existing instructions into a more optimized version of the same agent.' : 'Draft concise, practical system instructions.',
      'Use the assigned organizational role as the fundamental identity guide whenever it is available.',
      'Preserve the same role and intent.',
      'Use a professional tone and avoid filler.',
    ],
    context: {
      persona_name: name || '(unspecified)',
      job_title: title || '(unspecified)',
      brief_description: description || '(unspecified)',
      assigned_role: roleRef ? roleLabel(roleRef) : '(none assigned)',
      role_description: roleRef?.role?.description || '(none assigned)',
      department_name: roleRef?.department?.name || '(none assigned)',
      team_name: roleRef?.team?.name || '(none assigned)',
      organization_name: roleRef?.organization?.name || '(none assigned)',
      current_instructions: currentInstructions || '(none yet)',
    },
    input: mode === 'revise' ? 'Revise the current agent system instructions.' : 'Draft the agent system instructions.',
    outputFormat: 'Return only the final system instructions.',
    includeThought: true,
  });

  try {
    if (mode === 'draft') instructionsEl.value = '';
    let draftText = '';

    const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: source.selectedModel,
        messages,
        stream: true,
      }),
      signal: personaDraftController.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errBody.error ?? `HTTP ${response.status}`);
    }

    for await (const chunk of readNdjsonStream(response)) {
      const delta = chunk.message?.content ?? '';
      if (!delta) {
        if (chunk.done) break;
        continue;
      }
      draftText += delta;
      const parsed = Policy.parseStructuredResponse(draftText);
      instructionsEl.value = parsed.answer || draftText;
      persona.instructions = parsed.answer || draftText;
      if (chunk.done) break;
    }

    const parsed = Policy.parseStructuredResponse(draftText);
    draftText = parsed.answer || draftText;
    if (!draftText.trim()) {
      throw new Error('Model returned no final instructions.');
    }

    persona.hasUpdate = persona.id !== activePersonaId;
    setPersonaStatus(`${mode === 'revise' ? 'Revision' : 'Draft'} complete. Review and save when ready.`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      setPersonaStatus(`Draft failed: ${err.message}`, 'error');
    }
  } finally {
    persona.generating = false;
    renderPersonaList();
    draftBtn.disabled = false;
    reviseBtn.disabled = false;
    personaDraftController = null;
  }
}

function personaInstructions(persona) {
  if (!persona) return '';
  const linkedSkills = skills.filter(skill => Array.isArray(persona.skills) && persona.skills.includes(skill.slug));
  const grantedTools = linkedSkills.flatMap(skill => Array.isArray(skill.tools) ? skill.tools : []);
  const capabilityBlock = [
    linkedSkills.length ? `Skills: ${linkedSkills.map(skill => skill.title).join(', ')}.` : '',
    grantedTools.length ? `Available tool capabilities: ${Array.from(new Set(grantedTools)).join(', ')}.` : '',
  ].filter(Boolean).join('\n');
  if (persona.instructions.trim()) {
    return [persona.instructions.trim(), capabilityBlock].filter(Boolean).join('\n\n');
  }
  const identity = [persona.name.trim(), persona.title.trim()].filter(Boolean).join(', ');
  const description = persona.description.trim();
  return [
    identity ? `You are ${identity}.` : 'You are a participant in a professional meeting.',
    description || 'Contribute concise, constructive, objective-focused reasoning.',
    capabilityBlock,
  ].join(' ');
}

// ─── Memory Consolidation ─────────────────────────────────────────────────────

async function runAllAgentMemoryConsolidation() {
  const source = personaDraftSource();
  if (!source) throw new Error('No connected source available for memory consolidation.');
  for (const agent of personas) {
    if (!agent?.slug || !agentHasSkill(agent, 'memory')) continue;
    const [working, longterm] = await Promise.all([
      apiJson('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'index', agentSlug: agent.slug, scope: 'working-memory' }),
      }),
      apiJson('/api/tools/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'index', agentSlug: agent.slug, scope: 'longterm-memory' }),
      }),
    ]);
    const messages = workflowMessages({
      sourceModel: source.selectedModel,
      workflow: 'memory_consolidation',
      role: 'You distill an agent working memory into compact, durable long-term memory.',
      instructions: [
        'Organize durable facts, preferences, and patterns.',
        'Exclude transient details unless they are likely to matter later.',
      ],
      context: {
        agent_name: agent.name || agent.title || agent.slug,
        working_memory_files: (working.files ?? []).map(file => file.name).join(', ') || '(none)',
        longterm_memory_files: (longterm.files ?? []).map(file => file.name).join(', ') || '(none)',
      },
      input: 'Create the next long-term memory consolidation note from the current working memory index.',
      outputFormat: 'Return only the long-term memory note in under 180 words.',
      includeThought: true,
    });
    let raw = '';
    const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: source.selectedModel, messages, stream: true }),
    });
    if (!response.ok) continue;
    for await (const chunk of readNdjsonStream(response)) {
      raw += chunk.message?.content ?? '';
      if (chunk.done) break;
    }
    const parsed = Policy.parseStructuredResponse(raw);
    const text = (parsed.answer || raw).trim();
    if (text) {
      await writeAgentMemory(agent, 'longterm-memory', `consolidated-${Date.now().toString(36)}.md`, text);
    }
  }
}
