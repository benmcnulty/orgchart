// skills.js — Skills state, CRUD, and panel rendering.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: uiState — resolved at call time.
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el
// References functions from agents.js: activePersona, renderPersonaSkillChecklist (global scope)
// References functions from tools.js: tools (global scope)

// ─── State ────────────────────────────────────────────────────────────────────

let skills = [];
let activeSkillId = null;

// ─── Hydration ────────────────────────────────────────────────────────────────

function hydrateSkillsFromCatalog(catalogSkills) {
  skills = catalogSkills.map(skill => ({
    id: skill.id ?? `skill:${skill.slug}`,
    slug: skill.slug,
    name: skill.name ?? skill.slug,
    title: skill.title ?? skill.name ?? skill.slug,
    description: skill.description ?? '',
    instructions: skill.instructions ?? '',
    tools: Array.isArray(skill.tools) ? [...skill.tools] : [],
    hasUpdate: false,
  }));
  activeSkillId = skills.some(skill => skill.id === activeSkillId) ? activeSkillId : skills[0]?.id ?? null;
}

// ─── Notify ───────────────────────────────────────────────────────────────────

function notifySkills() {
  document.dispatchEvent(new CustomEvent('skills-changed', {
    detail: { skills, activeSkillId },
  }));
}

// ─── Skill Tool Options ───────────────────────────────────────────────────────

function renderSkillToolOptions() {
  const skillToolList = document.getElementById('skill-tools-list');
  const agentSkillList = document.getElementById('persona-skill-list');
  const activeSkill = skillById(activeSkillId);
  if (skillToolList && activeSkill) {
    skillToolList.replaceChildren(...tools.map(tool => {
      const label = document.createElement('label');
      label.className = 'agent-skill-chip';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = tool.id;
      input.checked = Array.isArray(activeSkill.tools) && activeSkill.tools.includes(tool.id);
      input.addEventListener('change', () => {
        activeSkill.tools = Array.from(skillToolList.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
      });
      const text = document.createElement('span');
      text.textContent = tool.name;
      label.append(input, text);
      return label;
    }));
  } else if (skillToolList) {
    skillToolList.replaceChildren();
  }
  if (agentSkillList) {
    const agent = activePersona();
    if (agent) renderPersonaSkillChecklist(agentSkillList, agent);
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function makeSkill() {
  const slug = `skill-${skills.length + 1}`;
  return {
    id: `skill:${slug}`,
    slug,
    name: slug,
    title: `Skill ${skills.length + 1}`,
    description: '',
    instructions: '',
    tools: [],
    hasUpdate: false,
  };
}

function selectSkill(id) {
  activeSkillId = id;
  const skill = activeSkill();
  if (skill) skill.hasUpdate = false;
  renderSkillList();
  hydrateSkillEditor();
  notifySkills();
}

async function persistSkill(skill) {
  const payload = {
    id: skill.id,
    slug: skill.slug || skill.name || skill.title,
    name: skill.name.trim() || slugifyLabel(skill.title, 'skill'),
    title: skill.title.trim() || skill.name.trim(),
    description: skill.description.trim(),
    instructions: skill.instructions.trim(),
    tools: Array.isArray(skill.tools) ? [...skill.tools] : [],
  };
  const { skill: saved } = await apiJson('/api/orgchart/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  activeSkillId = saved.id;
  await bootstrapOrgChartState();
  renderSkillList();
  hydrateSkillEditor();
  renderSkillToolOptions();
  setSaveIndicator('saved', 'Skill saved.');
}

async function deleteActiveSkill() {
  const skill = activeSkill();
  if (!skill) return;
  await apiJson(`/api/orgchart/skills/${encodeURIComponent(skill.slug)}`, { method: 'DELETE' });
  await bootstrapOrgChartState();
  renderSkillList();
  hydrateSkillEditor();
  hydratePersonaEditor();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSkillList() {
  const list = document.getElementById('skills-list');
  if (!list) return;
  if (!skills.length) {
    const empty = document.createElement('div');
    empty.className = 'persona-list-empty';
    empty.textContent = 'No skills saved yet.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...skills.map(skill => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${skill.id === activeSkillId ? ' workspace-item--active' : ''}`;
    button.dataset.status = skill.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => selectSkill(skill.id));

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(skill.hasUpdate ? 'attention' : 'idle', '◇');

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = skill.title || skill.name || 'Untitled Skill';
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = skill.description || 'Reusable tool-aware instructions';
    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));
}

function hydrateSkillEditor() {
  const titleEl = document.getElementById('skill-title');
  const nameEl = document.getElementById('skill-name');
  const descEl = document.getElementById('skill-description');
  const instructionsEl = document.getElementById('skill-instructions');
  const emptyEl = document.getElementById('skill-editor-empty');
  const formEl = document.getElementById('skill-editor-form');
  if (!titleEl || !nameEl || !descEl || !instructionsEl || !emptyEl || !formEl) return;

  const skill = activeSkill();
  emptyEl.classList.toggle('hidden', Boolean(skill));
  formEl.classList.toggle('hidden', !skill);

  if (!skill) {
    titleEl.value = '';
    nameEl.value = '';
    descEl.value = '';
    instructionsEl.value = '';
    const toolList = document.getElementById('skill-tools-list');
    if (toolList) toolList.replaceChildren();
    return;
  }

  titleEl.value = skill.title;
  nameEl.value = skill.name;
  descEl.value = skill.description;
  instructionsEl.value = skill.instructions;
  renderSkillToolOptions();
}

function bindSkillEditor() {
  const titleEl = document.getElementById('skill-title');
  const nameEl = document.getElementById('skill-name');
  const descEl = document.getElementById('skill-description');
  const instructionsEl = document.getElementById('skill-instructions');
  const newBtn = document.getElementById('skill-new-btn');
  const saveBtn = document.getElementById('skill-save-btn');
  const deleteBtn = document.getElementById('skill-delete-btn');
  const toolList = document.getElementById('skill-tools-list');
  if (!titleEl || !nameEl || !descEl || !instructionsEl || !newBtn || !saveBtn || !deleteBtn || !toolList) return;

  const syncDraft = () => {
    const skill = activeSkill();
    if (!skill) return;
    skill.title = titleEl.value;
    skill.name = nameEl.value;
    skill.description = descEl.value;
    skill.instructions = instructionsEl.value;
    skill.tools = Array.from(toolList.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
    renderSkillList();
  };

  titleEl.addEventListener('input', syncDraft);
  nameEl.addEventListener('input', syncDraft);
  descEl.addEventListener('input', syncDraft);
  instructionsEl.addEventListener('input', syncDraft);
  newBtn.addEventListener('click', () => {
    const skill = makeSkill();
    skills.push(skill);
    activeSkillId = skill.id;
    renderSkillList();
    hydrateSkillEditor();
  });
  saveBtn.addEventListener('click', async () => {
    const skill = activeSkill();
    if (!skill) return;
    skill.tools = Array.from(toolList.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
    await persistSkill(skill);
  });
  deleteBtn.addEventListener('click', deleteActiveSkill);
}

function renderSkillPanel(body, actionsLeft, actionsRight) {
  const newBtn = document.createElement('button');
  newBtn.id = 'skill-new-btn';
  newBtn.className = 'btn-add';
  newBtn.title = 'Create skill';
  newBtn.textContent = '+';
  actionsRight.appendChild(newBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse skill list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.skillsNavCollapsed = !uiState.skillsNavCollapsed;
    const shellEl = document.getElementById('skills-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.skillsNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.className = 'workspace-shell persona-shell';
  shell.id = 'skills-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.skillsNavCollapsed);

  const list = document.createElement('div');
  list.className = 'workspace-nav persona-list';
  list.id = 'skills-list';

  const editor = document.createElement('div');
  editor.className = 'workspace-detail persona-editor';

  const intro = document.createElement('div');
  intro.className = 'persona-intro';
  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Skill Editor';
  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Define reusable skill instructions and the tool capabilities they require.';
  intro.append(heading, hint);

  const empty = document.createElement('div');
  empty.id = 'skill-editor-empty';
  empty.className = 'persona-editor-empty';
  empty.textContent = 'Create or select a skill to edit it.';

  const form = document.createElement('div');
  form.id = 'skill-editor-form';
  form.className = 'persona-editor-form hidden';

  for (const [id, labelText, placeholder] of [
    ['skill-title', 'Title', 'e.g. Web Browsing'],
    ['skill-name', 'Name', 'e.g. web-browsing'],
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
    field.append(label, input);
    form.appendChild(field);
  }

  const descField = document.createElement('div');
  descField.className = 'persona-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'field-label';
  descLabel.htmlFor = 'skill-description';
  descLabel.textContent = 'Description';
  const descArea = document.createElement('textarea');
  descArea.id = 'skill-description';
  descArea.className = 'persona-textarea';
  descArea.rows = 3;
  descField.append(descLabel, descArea);

  const instructionsField = document.createElement('div');
  instructionsField.className = 'persona-field';
  const instructionsLabel = document.createElement('label');
  instructionsLabel.className = 'field-label';
  instructionsLabel.htmlFor = 'skill-instructions';
  instructionsLabel.textContent = 'Instructions';
  const instructionsArea = document.createElement('textarea');
  instructionsArea.id = 'skill-instructions';
  instructionsArea.className = 'persona-textarea persona-textarea--instructions';
  instructionsArea.rows = 10;
  instructionsField.append(instructionsLabel, instructionsArea);

  const toolsField = document.createElement('div');
  toolsField.className = 'persona-field';
  const toolsLabel = document.createElement('label');
  toolsLabel.className = 'field-label';
  toolsLabel.textContent = 'Required Tools';
  const toolsList = document.createElement('div');
  toolsList.id = 'skill-tools-list';
  toolsList.className = 'agent-skill-list';
  toolsField.append(toolsLabel, toolsList);

  const footer = document.createElement('div');
  footer.className = 'persona-actions';
  const actionsRow = document.createElement('div');
  actionsRow.className = 'persona-action-row';
  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'skill-delete-btn';
  deleteBtn.className = 'btn-secondary';
  deleteBtn.textContent = 'Delete';
  const saveBtn = document.createElement('button');
  saveBtn.id = 'skill-save-btn';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Save Skill';
  actionsRow.append(deleteBtn, saveBtn);
  footer.append(actionsRow);

  form.append(descField, instructionsField, toolsField, footer);
  editor.append(intro, empty, form);
  shell.append(list, editor);
  body.appendChild(shell);
  renderSkillList();
  bindSkillEditor();
  hydrateSkillEditor();
}

// ─── Accessors ────────────────────────────────────────────────────────────────

function skillById(id) {
  return skills.find(skill => skill.id === id) ?? null;
}

function activeSkill() {
  return skillById(activeSkillId);
}
