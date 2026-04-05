// tools.js — Tools state, CRUD, and panel rendering.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: uiState — resolved at call time.
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el

// ─── State ────────────────────────────────────────────────────────────────────

let tools = [];
let activeToolId = null;

// ─── Accessors ────────────────────────────────────────────────────────────────

function toolById(id) {
  return tools.find(tool => tool.id === id) ?? null;
}

function toolEnabled(id) {
  return toolById(id)?.enabled !== false;
}

function activeTool() {
  return tools.find(tool => tool.id === activeToolId) ?? null;
}

// ─── Hydration ────────────────────────────────────────────────────────────────

function hydrateToolsFromCatalog(catalogTools) {
  tools = catalogTools.map(tool => ({
    id: tool.id,
    name: tool.name ?? tool.id,
    type: tool.type ?? tool.id,
    description: tool.description ?? '',
    enabled: tool.enabled !== false,
    config: tool.config && typeof tool.config === 'object' ? tool.config : {},
    busy: false,
    hasUpdate: false,
  }));
  activeToolId = tools.some(tool => tool.id === activeToolId) ? activeToolId : tools[0]?.id ?? null;
}

// ─── Notify ───────────────────────────────────────────────────────────────────

function notifyTools() {
  document.dispatchEvent(new CustomEvent('tools-changed', {
    detail: { tools, activeToolId },
  }));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderToolList() {
  const list = document.getElementById('tools-list');
  if (!list) return;
  list.replaceChildren(...tools.map(tool => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${tool.id === activeToolId ? ' workspace-item--active' : ''}`;
    button.dataset.status = tool.busy ? 'processing' : tool.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => {
      activeToolId = tool.id;
      renderToolList();
      hydrateToolEditor();
    });
    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(tool.busy ? 'processing' : tool.hasUpdate ? 'attention' : 'idle', '⬢');
    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = tool.name;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = tool.description || tool.type;
    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));
}

function hydrateToolEditor() {
  const nameEl = document.getElementById('tool-name');
  const descEl = document.getElementById('tool-description');
  const enabledEl = document.getElementById('tool-enabled');
  const configEl = document.getElementById('tool-config');
  const statusEl = document.getElementById('tool-test-status');
  if (!nameEl || !descEl || !enabledEl || !configEl || !statusEl) return;
  const tool = activeTool();
  if (!tool) return;
  nameEl.value = tool.name;
  descEl.value = tool.description;
  enabledEl.checked = tool.enabled !== false;
  configEl.value = JSON.stringify(tool.config ?? {}, null, 2);
  statusEl.textContent = tool.type;
}

async function persistTool(tool) {
  const payload = {
    id: tool.id,
    name: tool.name.trim(),
    type: tool.type,
    description: tool.description.trim(),
    enabled: tool.enabled !== false,
    config: tool.config ?? {},
  };
  await apiJson('/api/orgchart/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await bootstrapOrgChartState();
  renderToolList();
  hydrateToolEditor();
  renderSkillToolOptions();
  setSaveIndicator('saved', 'Tool saved.');
}

function bindToolEditor() {
  const nameEl = document.getElementById('tool-name');
  const descEl = document.getElementById('tool-description');
  const enabledEl = document.getElementById('tool-enabled');
  const configEl = document.getElementById('tool-config');
  const saveBtn = document.getElementById('tool-save-btn');
  const testBtn = document.getElementById('tool-test-btn');
  const probeEl = document.getElementById('tool-test-input');
  const statusEl = document.getElementById('tool-test-status');
  if (!nameEl || !descEl || !enabledEl || !configEl || !saveBtn || !testBtn || !probeEl || !statusEl) return;

  const syncDraft = () => {
    const tool = activeTool();
    if (!tool) return;
    tool.name = nameEl.value;
    tool.description = descEl.value;
    tool.enabled = enabledEl.checked;
    try {
      tool.config = JSON.parse(configEl.value || '{}');
      statusEl.textContent = 'Config valid.';
    } catch {
      statusEl.textContent = 'Config JSON is invalid.';
    }
    renderToolList();
  };

  nameEl.addEventListener('input', syncDraft);
  descEl.addEventListener('input', syncDraft);
  enabledEl.addEventListener('change', syncDraft);
  configEl.addEventListener('input', syncDraft);

  saveBtn.addEventListener('click', async () => {
    const tool = activeTool();
    if (!tool) return;
    tool.config = JSON.parse(configEl.value || '{}');
    await persistTool(tool);
    statusEl.textContent = 'Tool saved.';
  });

  testBtn.addEventListener('click', async () => {
    const tool = activeTool();
    if (!tool) return;
    tool.busy = true;
    renderToolList();
    statusEl.textContent = `Testing ${tool.name}…`;
    try {
      const result = await testTool(tool, probeEl.value.trim());
      statusEl.textContent = JSON.stringify(result, null, 2).slice(0, 800);
    } catch (err) {
      statusEl.textContent = `Test failed: ${err.message}`;
    } finally {
      tool.busy = false;
      renderToolList();
    }
  });
}

function renderToolsPanel(body, actionsLeft) {
  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse tool list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.toolsNavCollapsed = !uiState.toolsNavCollapsed;
    const shellEl = document.getElementById('tools-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.toolsNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.className = 'workspace-shell persona-shell';
  shell.id = 'tools-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.toolsNavCollapsed);

  const list = document.createElement('div');
  list.className = 'workspace-nav persona-list';
  list.id = 'tools-list';

  const editor = document.createElement('div');
  editor.className = 'workspace-detail persona-editor';
  const intro = document.createElement('div');
  intro.className = 'persona-intro';
  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Tool Runtime';
  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Configure built-in tool capabilities exposed to agent skills and test them against the local runtime.';
  intro.append(heading, hint);

  const form = document.createElement('div');
  form.className = 'persona-editor-form';
  for (const [id, labelText] of [['tool-name', 'Name'], ['tool-description', 'Description']]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const input = id === 'tool-description' ? document.createElement('textarea') : document.createElement('input');
    input.id = id;
    input.className = id === 'tool-description' ? 'persona-textarea' : 'text-input';
    if (id !== 'tool-description') input.type = 'text';
    field.append(label, input);
    form.appendChild(field);
  }

  const enabledField = document.createElement('label');
  enabledField.className = 'agent-skill-chip';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.id = 'tool-enabled';
  const enabledText = document.createElement('span');
  enabledText.textContent = 'Enabled';
  enabledField.append(enabledInput, enabledText);

  const configField = document.createElement('div');
  configField.className = 'persona-field';
  const configLabel = document.createElement('label');
  configLabel.className = 'field-label';
  configLabel.htmlFor = 'tool-config';
  configLabel.textContent = 'Config JSON';
  const configArea = document.createElement('textarea');
  configArea.id = 'tool-config';
  configArea.className = 'persona-textarea persona-textarea--instructions';
  configArea.rows = 10;
  configField.append(configLabel, configArea);

  const probeField = document.createElement('div');
  probeField.className = 'persona-field';
  const probeLabel = document.createElement('label');
  probeLabel.className = 'field-label';
  probeLabel.htmlFor = 'tool-test-input';
  probeLabel.textContent = 'Test Input';
  const probeInput = document.createElement('input');
  probeInput.id = 'tool-test-input';
  probeInput.className = 'text-input';
  probeInput.type = 'text';
  probeInput.placeholder = 'Search query, URL, or memory probe';
  probeField.append(probeLabel, probeInput);

  const footer = document.createElement('div');
  footer.className = 'persona-actions';
  const status = document.createElement('pre');
  status.id = 'tool-test-status';
  status.className = 'tool-test-status';
  const actionsRow = document.createElement('div');
  actionsRow.className = 'persona-action-row';
  const testBtn = document.createElement('button');
  testBtn.id = 'tool-test-btn';
  testBtn.className = 'btn-secondary';
  testBtn.textContent = 'Run Test';
  const saveBtn = document.createElement('button');
  saveBtn.id = 'tool-save-btn';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Save Tool';
  actionsRow.append(testBtn, saveBtn);
  footer.append(status, actionsRow);

  form.append(enabledField, configField, probeField, footer);
  editor.append(intro, form);
  shell.append(list, editor);
  body.appendChild(shell);

  renderToolList();
  bindToolEditor();
  hydrateToolEditor();
}
