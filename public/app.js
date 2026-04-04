// app.js — Sources management, panel layout, theme.
// Loaded last; app globals (sources, displayLabel, defaultSource) are
// accessible to chat.js via the shared global scope.

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'inference-sources';
const PERSONA_STORAGE_KEY = 'inference-personas';
const SESSION_EXPORT_VERSION = 1;
const THEME_KEY = 'theme-preference';
const DEFAULT_MODEL = 'gemma4:latest';
const DEFAULT_URL = 'http://localhost:11434';
const RETRY_DELAY_MS = 5000;
const Policy = globalThis.InferencePolicy;

// ─── State ────────────────────────────────────────────────────────────────────

let sources = [];
let nextSeq = 1;
let activeSourceId = null;
let personas = [];
let nextPersonaSeq = 1;
let activePersonaId = null;
let personaDraftController = null;
let uiState = {
  sourcesNavCollapsed: false,
  personasNavCollapsed: false,
  meetingsNavCollapsed: false,
  draftBoardsNavCollapsed: false,
};
let groupChat = {
  meetings: [],
  activeMeetingId: null,
  nextMeetingSeq: 1,
  taskQueue: [],
  activeTasks: [],
  taskHistory: [],
  sourceCursor: 0,
  sourceBusy: new Set(),
  nextTaskSeq: 1,
  tokenLines: [],
  debugLines: [],
  pumping: false,
};

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadSources() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      sources = parsed.map(s => ({
        ...s,
        // Runtime-only fields reset on load
        status: 'connecting',
        models: [],
        error: null,
        retryTimer: null,
        // Provide fallbacks for fields added after initial release
        label: s.label ?? '',
        isDefault: s.isDefault ?? false,
        enabled: s.enabled ?? true,
        hasUpdate: false,
      }));
      nextSeq = Math.max(...sources.map(s => s._seq ?? 0)) + 1;
    }
  } catch {
    sources = [];
  }

  if (sources.length === 0) {
    sources.push(makeSource(DEFAULT_URL));
  }
  activeSourceId = sources[0]?.id ?? null;
}

function saveSources() {
  const persist = sources.map(({ id, url, selectedModel, label, isDefault, enabled, _seq }) => ({
    id, url, selectedModel, label, isDefault, enabled, _seq,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  notifySources();
}

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
  const persist = personas.map(({ id, name, title, description, instructions, _seq }) => ({
    id, name, title, description, instructions, _seq,
  }));
  localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(persist));
  notifyPersonas();
  renderPersonaList();
  syncGroupParticipantsWithPersonas();
  renderGroupParticipantOptions();
  renderGroupParticipants();
}

// ─── Source Helpers ───────────────────────────────────────────────────────────

function makeSource(url) {
  const seq = nextSeq++;
  return {
    id: `source-${seq}`,
    url: normalizeUrl(url),
    status: 'connecting',
    models: [],
    selectedModel: DEFAULT_MODEL,
    error: null,
    retryTimer: null,
    label: '',
    isDefault: false,
    enabled: true,
    hasUpdate: false,
    _seq: seq,
  };
}

function normalizeUrl(url) {
  const trimmed = url.trim().replace(/\/$/, '');
  return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
}

// Returns the display label for a source — used in cards and chat selector.
function displayLabel(source) {
  if (source.label) return source.label;
  try {
    const host = new URL(source.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'Local';
    return host;
  } catch {
    return source.url;
  }
}

// Returns the explicit default source, or the first enabled source, or null.
function defaultSource() {
  return enabledSources().find(s => s.isDefault) ?? enabledSources()[0] ?? null;
}

function enabledSources() {
  return sources.filter(s => s.enabled);
}

function clampText(text, length = 72) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

function navStatusGlyph(status, fallback = '◻') {
  if (status === 'processing') return '…';
  if (status === 'attention') return '🔔';
  return fallback;
}

// Fires the 'sources-changed' event so chat.js can refresh its selector.
function notifySources() {
  document.dispatchEvent(new CustomEvent('sources-changed', { detail: { sources } }));
}

function notifyPersonas() {
  document.dispatchEvent(new CustomEvent('personas-changed', {
    detail: { personas, activePersonaId },
  }));
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function proxyFetch(targetUrl) {
  const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchModels(baseUrl) {
  const data = await proxyFetch(`${baseUrl}/api/tags`);
  return (data.models ?? []).map(m => m.name).sort();
}

// ─── Source Management ────────────────────────────────────────────────────────

function addSource(url) {
  const normalized = normalizeUrl(url);
  if (sources.some(s => s.url === normalized)) {
    return { error: 'This source is already configured.' };
  }
  const source = makeSource(normalized);
  sources.push(source);
  saveSources();
  renderSources();
  connectSource(source);
  return { source };
}

function removeSource(id) {
  const source = sources.find(s => s.id === id);
  if (source?.retryTimer) clearTimeout(source.retryTimer);
  sources = sources.filter(s => s.id !== id);
  saveSources();
  renderSources();
}

async function connectSource(source) {
  if (source.retryTimer) { clearTimeout(source.retryTimer); source.retryTimer = null; }

  source.status = 'connecting';
  source.error = null;
  patchCardStatus(source);

  try {
    const models = await fetchModels(source.url);
    source.models = models;
    source.status = 'connected';
    if (source.id !== activeSourceId) source.hasUpdate = true;

    if (models.includes(DEFAULT_MODEL)) {
      source.selectedModel = DEFAULT_MODEL;
    } else if (!models.includes(source.selectedModel) && models.length > 0) {
      source.selectedModel = models[0];
    }

    saveSources();
  } catch (err) {
    source.status = 'error';
    source.error = err.message;
    if (source.id !== activeSourceId) source.hasUpdate = true;

    source.retryTimer = setTimeout(() => {
      source.retryTimer = null;
      if (sources.includes(source)) connectSource(source);
    }, RETRY_DELAY_MS);
  }

  patchCardStatus(source);
}

// ─── Panel Builder ────────────────────────────────────────────────────────────

// Creates a collapsible panel. Returns { panel, body, actions } so the caller
// can populate the body and add header action buttons.
function createPanel(id, title) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = id;

  const header = document.createElement('div');
  header.className = 'panel-header';

  // The toggle button wraps only the chevron + title — action buttons sit
  // outside it as siblings to avoid invalid nested-button HTML.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'panel-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', `${id}-body`);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.textContent = '>';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'panel-title';
  titleSpan.textContent = title;

  toggle.append(chevron, titleSpan);

  header.append(toggle);

  const body = document.createElement('div');
  body.className = 'panel-body';
  body.id = `${id}-body`;

  const actionRow = document.createElement('div');
  actionRow.className = 'panel-actions-row';

  const actionsLeft = document.createElement('div');
  actionsLeft.className = 'panel-header-actions panel-header-actions--left';

  const actionsRight = document.createElement('div');
  actionsRight.className = 'panel-header-actions panel-header-actions--right';

  const content = document.createElement('div');
  content.className = 'panel-content';

  actionRow.append(actionsLeft, actionsRight);
  body.append(actionRow, content);

  const setCollapsed = collapsed => {
    panel.classList.toggle('panel--collapsed', collapsed);
    body.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };

  toggle.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('panel--collapsed'));
  });

  setCollapsed(true);
  panel.append(header, body);
  return { panel, body: content, actionsLeft, actionsRight, setCollapsed };
}

// ─── Card Rendering ───────────────────────────────────────────────────────────

function renderSources() {
  const list = document.getElementById('sources-nav');
  const detail = document.getElementById('sources-detail');
  const shell = document.getElementById('sources-shell');
  if (!list || !detail || !shell) return;

  shell.classList.toggle('workspace-shell--collapsed', uiState.sourcesNavCollapsed);
  if (!sources.some(source => source.id === activeSourceId)) activeSourceId = sources[0]?.id ?? null;

  if (sources.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No inference sources configured. Press + to add one.';
    list.replaceChildren();
    detail.replaceChildren(p);
    return;
  }

  list.replaceChildren(...sources.map(source => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `workspace-item${source.id === activeSourceId ? ' workspace-item--active' : ''}`;
    item.dataset.status = source.status === 'connecting' ? 'processing' : source.hasUpdate ? 'attention' : 'idle';
    item.addEventListener('click', () => {
      activeSourceId = source.id;
      source.hasUpdate = false;
      renderSources();
    });

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(
      source.status === 'connecting' ? 'processing' : source.hasUpdate ? 'attention' : 'idle',
      '◫',
    );

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = `${displayLabel(source)}${source.isDefault ? ' • Default' : ''}`;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = source.status === 'connected'
      ? `${source.selectedModel || 'No model'}`
      : statusText(source.status);
    copy.append(title, meta);

    item.append(icon, copy);
    return item;
  }));

  const active = sources.find(source => source.id === activeSourceId) ?? sources[0];
  detail.replaceChildren(buildCard(active));
}

// Full card build — only called on initial render or source list changes.
// Status-only changes use patchCardStatus() to preserve label input focus.
function buildCard(source) {
  const card = document.createElement('div');
  card.className = `source-card${source.enabled ? '' : ' source-card--disabled'}`;
  card.id = `card-${source.id}`;

  // ── Header: status + actions ──────────────────────────────────────────────
  const header = el('div', 'card-header');

  const statusGroup = el('div', 'status-group');
  const dot = el('span', `status-dot ${source.status}`);
  const statusLabel = el('span', 'status-label');
  statusLabel.textContent = statusText(source.status);
  statusGroup.append(dot, statusLabel);

  const actions = el('div', 'card-actions');

  const btnStar = el('button', `btn-icon btn-star${source.isDefault ? ' btn-star-active' : ''}`);
  btnStar.textContent = source.isDefault ? '★' : '☆';
  btnStar.title = source.isDefault ? 'Clear default' : 'Set as default';

  const btnToggle = el('button', `btn-icon btn-toggle${source.enabled ? ' btn-toggle-active' : ''}`);
  btnToggle.textContent = source.enabled ? '●' : '○';
  btnToggle.title = source.enabled ? 'Disable source' : 'Enable source';

  const btnRefresh = el('button', 'btn-icon btn-refresh');
  btnRefresh.title = 'Reconnect';
  btnRefresh.textContent = '↻';

  const btnRemove = el('button', 'btn-icon btn-remove');
  btnRemove.title = 'Remove source';
  btnRemove.textContent = '×';

  actions.append(btnStar, btnToggle, btnRefresh, btnRemove);
  header.append(statusGroup, actions);

  // ── Editable label ────────────────────────────────────────────────────────
  const labelRow = el('div', 'card-label-row');
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'card-label-input';
  labelInput.setAttribute('data-field', 'label');
  labelInput.value = source.label;
  labelInput.placeholder = displayLabel(source); // show auto-label as hint
  labelInput.setAttribute('aria-label', 'Source label');
  labelRow.appendChild(labelInput);

  // ── URL display ───────────────────────────────────────────────────────────
  const urlEl = el('div', 'card-url');
  urlEl.textContent = source.url;

  // ── Model selector ────────────────────────────────────────────────────────
  const modelRow = el('div', 'card-model');
  const select = document.createElement('select');
  select.className = 'model-select';
  select.disabled = source.status !== 'connected' || !source.enabled;

  const modelSet = source.models.length > 0 ? source.models : [source.selectedModel];
  for (const name of modelSet) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === source.selectedModel;
    select.appendChild(opt);
  }

  const meta = el('span', `model-count${source.status === 'error' ? ' error' : ''}`);
  meta.textContent = metaText(source);

  modelRow.append(select, meta);

  // ── Event wiring ──────────────────────────────────────────────────────────
  btnStar.addEventListener('click', () => {
    const wasDefault = source.isDefault;
    sources.forEach(s => { s.isDefault = false; });
    if (!wasDefault) source.isDefault = true;
    saveSources();
    sources.forEach(s => patchCardStatus(s));
  });

  btnToggle.addEventListener('click', () => {
    source.enabled = !source.enabled;
    if (!source.enabled && source.isDefault) source.isDefault = false;
    saveSources();
    patchCardStatus(source);
  });

  btnRefresh.addEventListener('click', () => connectSource(source));
  btnRemove.addEventListener('click', () => removeSource(source.id));

  labelInput.addEventListener('input', () => {
    source.label = labelInput.value; // preserve spaces during typing
    labelInput.placeholder = source.label.trim() ? '' : displayLabel(source);
    saveSources();
  });
  labelInput.addEventListener('blur', () => {
    source.label = labelInput.value.trim();
    saveSources();
  });

  select.addEventListener('change', e => {
    source.selectedModel = e.target.value;
    saveSources();
  });

  card.append(header, labelRow, urlEl, modelRow);
  return card;
}

// Patches only the dynamic parts of an existing card without touching the
// label input, so typing in the label field is never interrupted by a
// background status update (e.g. connectSource completing).
function patchCardStatus(source) {
  renderSources();
}

function statusText(status) {
  return { connecting: 'Connecting…', connected: 'Connected', error: 'Error' }[status] ?? status;
}

function metaText(source) {
  if (source.status === 'error') return source.error ?? 'Connection failed';
  if (source.status === 'connected') return `${source.models.length} model${source.models.length !== 1 ? 's' : ''} available`;
  return 'Fetching models…';
}

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

// ─── Personas ────────────────────────────────────────────────────────────────

function makePersona() {
  const seq = nextPersonaSeq++;
  return {
    id: `persona-${seq}`,
    name: '',
    title: '',
    description: '',
    instructions: '',
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

function deleteActivePersona() {
  const persona = activePersona();
  if (!persona) return;

  personas = personas.filter(p => p.id !== persona.id);
  activePersonaId = personas[0]?.id ?? null;
  savePersonas();
  hydratePersonaEditor();
}

function hydratePersonaEditor() {
  const nameEl = document.getElementById('persona-name');
  const titleEl = document.getElementById('persona-title');
  const descEl = document.getElementById('persona-description');
  const instructionsEl = document.getElementById('persona-instructions');
  const emptyEl = document.getElementById('persona-editor-empty');
  const formEl = document.getElementById('persona-editor-form');
  const deleteBtn = document.getElementById('persona-delete-btn');

  if (!nameEl || !titleEl || !descEl || !instructionsEl || !emptyEl || !formEl) return;

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
    setPersonaStatus('Create a persona to draft reusable system instructions.', 'muted');
    return;
  }

  nameEl.value = persona.name;
  titleEl.value = persona.title;
  descEl.value = persona.description;
  instructionsEl.value = persona.instructions;
  setPersonaStatus('Saved personas appear in the chat persona selector.', 'muted');
}

function renderPersonaList() {
  const list = document.getElementById('persona-list');
  if (!list) return;

  if (personas.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'persona-list-empty';
    empty.textContent = 'No personas saved yet.';
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
    name.textContent = persona.name.trim() || 'Untitled Persona';

    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = persona.title.trim() || persona.description.trim() || 'Custom system instructions';

    copy.append(name, meta);
    button.append(icon, copy);
    return button;
  }));
}

function bindPersonaEditor() {
  const nameEl = document.getElementById('persona-name');
  const titleEl = document.getElementById('persona-title');
  const descEl = document.getElementById('persona-description');
  const instructionsEl = document.getElementById('persona-instructions');
  const newBtn = document.getElementById('persona-new-btn');
  const saveBtn = document.getElementById('persona-save-btn');
  const deleteBtn = document.getElementById('persona-delete-btn');
  const draftBtn = document.getElementById('persona-draft-btn');

  if (!nameEl || !titleEl || !descEl || !instructionsEl || !newBtn || !saveBtn || !deleteBtn || !draftBtn) return;

  const updateActiveDraft = () => {
    const persona = activePersona();
    if (!persona) return;
    persona.name = nameEl.value;
    persona.title = titleEl.value;
    persona.description = descEl.value;
    persona.instructions = instructionsEl.value;
    renderPersonaList();
  };

  nameEl.addEventListener('input', updateActiveDraft);
  titleEl.addEventListener('input', updateActiveDraft);
  descEl.addEventListener('input', updateActiveDraft);
  instructionsEl.addEventListener('input', updateActiveDraft);

  newBtn.addEventListener('click', createNewPersona);
  saveBtn.addEventListener('click', () => {
    const persona = ensureActivePersona();
    persona.name = nameEl.value.trim();
    persona.title = titleEl.value.trim();
    persona.description = descEl.value.trim();
    persona.instructions = instructionsEl.value.trim();
    savePersonas();
    hydratePersonaEditor();
    setPersonaStatus(`Saved ${persona.name || 'persona'}.`, 'success');
  });

  deleteBtn.addEventListener('click', () => {
    deleteActivePersona();
    setPersonaStatus('Persona removed.', 'muted');
  });

  draftBtn.addEventListener('click', draftPersonaInstructions);
}

function renderPersonaPanel(body, actionsLeft, actionsRight) {
  const newBtn = document.createElement('button');
  newBtn.id = 'persona-new-btn';
  newBtn.className = 'btn-add';
  newBtn.title = 'Create persona';
  newBtn.textContent = '+';
  actionsRight.appendChild(newBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse persona list';
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
  heading.textContent = 'Persona Editor';

  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Draft concise system instructions from a role, then refine and save them for chat reuse.';
  intro.append(heading, hint);

  const empty = document.createElement('div');
  empty.id = 'persona-editor-empty';
  empty.className = 'persona-editor-empty';
  empty.textContent = 'Create a persona to start drafting instructions.';

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
  instructionsArea.placeholder = 'Saved instructions are sent as the system message when this persona is selected in chat.';
  instructionsField.append(instructionsLabel, instructionsArea);

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
  draftBtn.textContent = 'Draft Instructions';

  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'persona-delete-btn';
  deleteBtn.className = 'btn-secondary';
  deleteBtn.textContent = 'Delete';

  const saveBtn = document.createElement('button');
  saveBtn.id = 'persona-save-btn';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = 'Save Persona';

  actionsRow.append(draftBtn, deleteBtn, saveBtn);
  footer.append(status, actionsRow);
  form.append(descField, instructionsField, footer);

  editor.append(intro, empty, form);
  shell.append(list, editor);
  body.appendChild(shell);

  renderPersonaList();
  bindPersonaEditor();
  hydratePersonaEditor();
}

function setPersonaStatus(message, tone = 'muted') {
  const status = document.getElementById('persona-status');
  if (!status) return;
  status.textContent = message;
  status.className = `persona-status persona-status--${tone}`;
}

function personaDraftSource() {
  const preferred = defaultSource();
  if (preferred?.status === 'connected' && preferred.selectedModel) return preferred;
  return enabledSources().find(source => source.status === 'connected' && source.selectedModel) ?? null;
}

async function draftPersonaInstructions() {
  const persona = ensureActivePersona();
  const source = personaDraftSource();
  if (!source) {
    setPersonaStatus('Connect an inference source before drafting persona instructions.', 'error');
    return;
  }

  const description = document.getElementById('persona-description')?.value.trim() ?? '';
  const name = document.getElementById('persona-name')?.value.trim() ?? '';
  const title = document.getElementById('persona-title')?.value.trim() ?? '';
  const instructionsEl = document.getElementById('persona-instructions');
  const draftBtn = document.getElementById('persona-draft-btn');
  if (!instructionsEl || !draftBtn) return;

  if (!name && !title && !description) {
    setPersonaStatus('Add at least a name, title, or brief description to draft from.', 'error');
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
  setPersonaStatus(`Drafting with ${displayLabel(source)} • ${source.selectedModel}`, 'muted');

  const messages = workflowMessages({
    sourceModel: source.selectedModel,
    workflow: 'persona_drafting',
    role: 'You write production-ready system instructions for role-based AI personas.',
    instructions: [
      'Draft concise, practical system instructions.',
      'Use a professional tone and avoid filler.',
    ],
    context: {
      persona_name: name || '(unspecified)',
      job_title: title || '(unspecified)',
      brief_description: description || '(unspecified)',
    },
    input: 'Draft the persona system instructions.',
    outputFormat: 'Return only the final system instructions.',
    includeThought: true,
  });

  try {
    instructionsEl.value = '';
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
    setPersonaStatus('Draft complete. Review and save when ready.', 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      setPersonaStatus(`Draft failed: ${err.message}`, 'error');
    }
  } finally {
    persona.generating = false;
    renderPersonaList();
    draftBtn.disabled = false;
    personaDraftController = null;
  }
}

async function* readNdjsonStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try { yield JSON.parse(line); } catch { /* ignore malformed chunks */ }
      }
    }

    if (buffer.trim()) {
      try { yield JSON.parse(buffer.trim()); } catch { /* ignore malformed chunks */ }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Meetings ────────────────────────────────────────────────────────────────

function makeMeeting() {
  const seq = groupChat.nextMeetingSeq++;
  return {
    id: `meeting-${seq}`,
    title: `Meeting ${seq}`,
    topic: '',
    participants: [],
    auto: false,
    agenda: '',
    summary: '',
    shortMemory: '',
    longMemory: '',
    messages: [],
    facilitator: null,
    pendingBoardNotes: [],
    boardDraft: '',
    attachments: [],
    attachmentStatus: 'idle',
    draftBoards: [],
    activeDraftBoardId: null,
    nextDraftBoardSeq: 1,
    hasUpdate: false,
    busy: false,
    controller: null,
  };
}

function ensureMeetings() {
  if (groupChat.meetings.length === 0) {
    const meeting = makeMeeting();
    groupChat.meetings.push(meeting);
    groupChat.activeMeetingId = meeting.id;
  }
  if (!groupChat.meetings.some(meeting => meeting.id === groupChat.activeMeetingId)) {
    groupChat.activeMeetingId = groupChat.meetings[0].id;
  }
}

function activeMeeting() {
  ensureMeetings();
  return groupChat.meetings.find(meeting => meeting.id === groupChat.activeMeetingId) ?? groupChat.meetings[0];
}

function connectedInferenceSources() {
  return enabledSources().filter(source => source.status === 'connected' && source.selectedModel);
}

function nextInferenceSource() {
  const available = connectedInferenceSources();
  if (available.length === 0) return null;
  const source = available[groupChat.sourceCursor % available.length];
  groupChat.sourceCursor = (groupChat.sourceCursor + 1) % available.length;
  return source;
}

function savedPersonaById(id) {
  return personas.find(persona => persona.id === id) ?? null;
}

function personaInstructions(persona) {
  if (!persona) return '';
  if (persona.instructions.trim()) return persona.instructions.trim();
  const identity = [persona.name.trim(), persona.title.trim()].filter(Boolean).join(', ');
  const description = persona.description.trim();
  return [
    identity ? `You are ${identity}.` : 'You are a participant in a professional meeting.',
    description || 'Contribute concise, constructive, objective-focused reasoning.',
  ].join(' ');
}

function workflowMessages({ sourceModel, workflow, role, instructions, context, input, outputFormat, tools, examples, includeThought = true }) {
  return Policy.buildWorkflowMessages({
    modelName: sourceModel,
    workflow,
    role,
    instructions,
    context,
    input,
    outputFormat,
    tools,
    examples,
    includeThought,
  }).messages;
}

function syncGroupParticipantsWithPersonas() {
  const personaIds = new Set(personas.map(persona => persona.id));
  ensureMeetings();

  for (const meeting of groupChat.meetings) {
    meeting.participants = meeting.participants.filter(id => personaIds.has(id));
    if (meeting.facilitator && !personaIds.has(meeting.facilitator.participantId)) {
      meeting.facilitator = null;
    }
  }
}

function meetingTimestamp(date = new Date()) {
  return {
    iso: date.toISOString(),
    label: date.toLocaleString(),
  };
}

function appendMeetingMessage(meeting, entry) {
  const stamp = meetingTimestamp();
  const nextId = `m${meeting.messages.length + 1}`;
  meeting.messages.push({
    id: nextId,
    timestampIso: stamp.iso,
    timestampLabel: stamp.label,
    ...entry,
  });
  if (meeting.id !== groupChat.activeMeetingId && entry.type === 'participant') {
    meeting.hasUpdate = true;
  }
  renderMeetingSelector();
}

function meetingTranscriptTail(meeting, limit = 8) {
  return meeting.messages.slice(-limit).map(msg => `${msg.id} ${msg.speaker}: ${msg.content}`).join('\n\n');
}

function meetingAttachmentContext(meeting) {
  if (!meeting.attachments.length) return '(none)';
  return meeting.attachments.map((attachment, index) => [
    `[a${index + 1}] ${attachment.name} (${attachment.kind})`,
    attachment.summary || 'Summary pending.',
  ].join('\n')).join('\n\n');
}

function makeDraftBoard(meeting, name = '') {
  const seq = meeting.nextDraftBoardSeq++;
  return {
    id: `draft-${meeting.id}-${seq}`,
    name: name.trim() || `Draft Board ${seq}`,
    plan: '',
    content: '',
    updatedAt: new Date().toISOString(),
  };
}

function activeDraftBoard(meeting) {
  if (!meeting.draftBoards.length) return null;
  if (!meeting.draftBoards.some(board => board.id === meeting.activeDraftBoardId)) {
    meeting.activeDraftBoardId = meeting.draftBoards[0].id;
  }
  return meeting.draftBoards.find(board => board.id === meeting.activeDraftBoardId) ?? null;
}

function meetingDraftBoardContext(meeting) {
  if (!meeting.draftBoards.length) return '(none)';
  return meeting.draftBoards.map(board => [
    `${board.name}`,
    board.plan ? `Plan: ${board.plan}` : 'Plan: (none)',
    board.content ? `Content:\n${board.content}` : 'Content: (blank)',
  ].join('\n')).join('\n\n---\n\n');
}

function setGroupChatStatus(message, tone = 'muted') {
  const el = document.getElementById('meeting-status');
  if (!el) return;
  el.textContent = message;
  el.className = `meeting-status meeting-status--${tone}`;
}

function pushDebugLine(text) {
  groupChat.debugLines.push(`[${new Date().toLocaleTimeString()}] ${text}`);
  groupChat.debugLines = groupChat.debugLines.slice(-300);
  renderMeetingDebug();
}

function pushTokenLine(text) {
  groupChat.tokenLines.push(text);
  groupChat.tokenLines = groupChat.tokenLines.slice(-250);
  renderMeetingDebug();
}

function pushTokenBoundary(text) {
  groupChat.tokenLines.push(`[${new Date().toLocaleTimeString()}] ${text}`);
  groupChat.tokenLines = groupChat.tokenLines.slice(-250);
  renderMeetingDebug();
}

function renderMeetingSelector() {
  const nav = document.getElementById('meeting-list');
  if (!nav) return;

  ensureMeetings();
  nav.replaceChildren(...groupChat.meetings.map(meeting => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${meeting.id === groupChat.activeMeetingId ? ' workspace-item--active' : ''}`;
    button.dataset.status = meeting.busy ? 'processing' : meeting.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => switchMeeting(meeting.id));

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(meeting.busy ? 'processing' : meeting.hasUpdate ? 'attention' : 'idle', '▣');

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';

    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = meeting.title;

    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = clampText(
      meeting.topic || meeting.summary || meeting.agenda || 'Waiting for a topic.',
      72,
    );

    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));
}

function switchMeeting(id) {
  groupChat.activeMeetingId = id;
  const meeting = activeMeeting();
  if (meeting) meeting.hasUpdate = false;
  hydrateMeetingEditor();
}

function createMeeting() {
  const meeting = makeMeeting();
  groupChat.meetings.push(meeting);
  groupChat.activeMeetingId = meeting.id;
  renderMeetingSelector();
  hydrateMeetingEditor();
}

function renderGroupParticipantOptions() {
  const select = document.getElementById('meeting-participant-select');
  if (!select) return;

  const meeting = activeMeeting();
  const previous = select.value;
  select.replaceChildren();

  const available = personas.filter(persona => !meeting.participants.includes(persona.id));
  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = personas.length === 0 ? 'Save personas to add participants' : 'All saved personas added';
    select.appendChild(opt);
    return;
  }

  for (const persona of available) {
    const opt = document.createElement('option');
    opt.value = persona.id;
    opt.textContent = `${persona.name.trim() || 'Untitled Persona'}${persona.title.trim() ? ` • ${persona.title.trim()}` : ''}`;
    select.appendChild(opt);
  }

  select.value = available.some(persona => persona.id === previous) ? previous : available[0].id;
}

function renderGroupParticipants() {
  const wrap = document.getElementById('meeting-participants');
  if (!wrap) return;

  const meeting = activeMeeting();
  if (meeting.participants.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'group-participants-empty';
    empty.textContent = 'Add saved personas to this meeting.';
    wrap.replaceChildren(empty);
    updateGroupChatControls();
    return;
  }

  wrap.replaceChildren(...meeting.participants.map(id => {
    const persona = savedPersonaById(id);
    const chip = document.createElement('div');
    chip.className = 'group-participant-chip';

    const label = document.createElement('span');
    label.className = 'group-participant-chip-label';
    label.textContent = persona?.name?.trim() || 'Untitled Persona';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'group-participant-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      meeting.participants = meeting.participants.filter(participantId => participantId !== id);
      if (meeting.facilitator?.participantId === id) meeting.facilitator = null;
      renderGroupParticipantOptions();
      renderGroupParticipants();
      renderGroupChatFacilitator();
    });

    chip.append(label, remove);
    return chip;
  }));

  updateGroupChatControls();
}

function renderMeetingAttachments() {
  const list = document.getElementById('meeting-attachments');
  if (!list) return;

  const meeting = activeMeeting();
  if (!meeting.attachments.length) {
    const empty = document.createElement('div');
    empty.className = 'group-participants-empty';
    empty.textContent = 'Attach images or text files for facilitator indexing.';
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...meeting.attachments.map((attachment, index) => {
    const card = document.createElement('div');
    card.className = 'meeting-attachment';
    card.dataset.status = attachment.status ?? 'idle';

    const header = document.createElement('div');
    header.className = 'meeting-attachment-header';

    const title = document.createElement('div');
    title.className = 'meeting-attachment-title';
    title.textContent = `[a${index + 1}] ${attachment.name}`;

    const meta = document.createElement('div');
    meta.className = 'meeting-attachment-meta';
    meta.textContent = attachment.status === 'processing'
      ? 'Indexing…'
      : attachment.status === 'error'
        ? attachment.error || 'Indexing failed'
        : attachment.kind === 'image'
          ? 'Image indexed'
          : 'Text indexed';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-icon';
    remove.textContent = '×';
    remove.title = 'Remove attachment';
    remove.addEventListener('click', () => {
      meeting.attachments.splice(index, 1);
      renderMeetingAttachments();
    });

    header.append(title, meta, remove);

    const body = document.createElement('div');
    body.className = 'meeting-attachment-summary';
    body.textContent = attachment.summary || 'Summary pending.';

    card.append(header, body);
    return card;
  }));
}

function readMeetingAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onload = e => {
        const dataUrl = e.target.result;
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          kind: 'image',
          mimeType: file.type,
          base64: String(dataUrl).slice(String(dataUrl).indexOf(',') + 1),
          summary: '',
          status: 'processing',
          error: '',
        });
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
      return;
    }

    reader.onload = e => {
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        kind: 'text',
        text: String(e.target.result ?? ''),
        summary: '',
        status: 'processing',
        error: '',
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

async function handleMeetingAttachments(files) {
  if (!files.length) return;
  const meeting = activeMeeting();
  const loaded = await Promise.all(files.map(readMeetingAttachment));
  meeting.attachments.push(...loaded);
  renderMeetingAttachments();
  setGroupChatStatus(`Indexing ${loaded.length} attachment${loaded.length === 1 ? '' : 's'}…`, 'muted');

  await Promise.all(loaded.map(async attachment => {
    try {
      attachment.summary = await indexMeetingAttachment(meeting, attachment);
      attachment.status = 'ready';
      if (meeting.id !== groupChat.activeMeetingId) meeting.hasUpdate = true;
    } catch (err) {
      attachment.status = 'error';
      attachment.error = err.message;
    } finally {
      renderMeetingAttachments();
      renderMeetingSelector();
    }
  }));

  setGroupChatStatus('Attachment indexing complete.', 'success');
}

function renderGroupChatMessages() {
  const list = document.getElementById('meeting-live-feed');
  if (!list) return;

  const meeting = activeMeeting();
  const liveMessages = meeting.messages.filter(msg => msg.type !== 'board');
  if (liveMessages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'group-chat-empty';
    empty.textContent = 'Set a topic, add participants, and generate the first meeting turn.';
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...liveMessages.map(msg => {
    const item = document.createElement('div');
    item.className = 'group-chat-message';

    const header = document.createElement('div');
    header.className = 'group-chat-message-header';

    const name = document.createElement('span');
    name.className = 'group-chat-message-name';
    name.textContent = msg.speaker;

    const source = document.createElement('span');
    source.className = 'group-chat-message-source';
    source.textContent = `${msg.timestampLabel}${msg.sourceLabel ? ` • ${msg.sourceLabel}` : ''}`;

    header.append(name, source);

    const body = document.createElement('div');
    body.className = 'group-chat-message-body md-content';
    body.replaceChildren(renderMarkdown(msg.content));

    item.append(header, body);
    return item;
  }));

  list.scrollTop = list.scrollHeight;
}

function renderMeetingDraftBoards() {
  const list = document.getElementById('meeting-draftboard-list');
  const nameEl = document.getElementById('meeting-draftboard-name');
  const planEl = document.getElementById('meeting-draftboard-plan');
  const contentEl = document.getElementById('meeting-draftboard-content');
  if (!list || !nameEl || !planEl || !contentEl) return;

  const meeting = activeMeeting();
  const board = activeDraftBoard(meeting);

  if (!meeting.draftBoards.length) {
    const empty = document.createElement('div');
    empty.className = 'group-participants-empty';
    empty.textContent = 'Create a blank draft board to shape outputs collaboratively.';
    list.replaceChildren(empty);
    nameEl.value = '';
    planEl.value = '';
    contentEl.value = '';
    return;
  }

  list.replaceChildren(...meeting.draftBoards.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${item.id === meeting.activeDraftBoardId ? ' workspace-item--active' : ''}`;
    button.addEventListener('click', () => {
      meeting.activeDraftBoardId = item.id;
      renderMeetingDraftBoards();
    });

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = '✎';

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = item.name;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = clampText(item.plan || item.content || 'Blank draft board.', 68);
    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));

  nameEl.value = board?.name ?? '';
  planEl.value = board?.plan ?? '';
  contentEl.value = board?.content ?? '';
}

function createMeetingDraftBoard(name = '') {
  const meeting = activeMeeting();
  const board = makeDraftBoard(meeting, name);
  meeting.draftBoards.push(board);
  meeting.activeDraftBoardId = board.id;
  renderMeetingDraftBoards();
  return board;
}

function bindMeetingDraftBoardInputs() {
  const nameEl = document.getElementById('meeting-draftboard-name');
  const planEl = document.getElementById('meeting-draftboard-plan');
  const contentEl = document.getElementById('meeting-draftboard-content');
  if (!nameEl || !planEl || !contentEl) return;

  nameEl.addEventListener('input', () => {
    const board = activeDraftBoard(activeMeeting());
    if (!board) return;
    board.name = nameEl.value || 'Untitled Draft Board';
    board.updatedAt = new Date().toISOString();
    renderMeetingDraftBoards();
  });

  planEl.addEventListener('input', () => {
    const board = activeDraftBoard(activeMeeting());
    if (!board) return;
    board.plan = planEl.value;
    board.updatedAt = new Date().toISOString();
  });

  contentEl.addEventListener('input', () => {
    const board = activeDraftBoard(activeMeeting());
    if (!board) return;
    board.content = contentEl.value;
    board.updatedAt = new Date().toISOString();
  });
}

function renderGroupChatSummary() {
  const agendaEl = document.getElementById('meeting-agenda');
  const summaryEl = document.getElementById('meeting-summary');
  const memoryEl = document.getElementById('meeting-memory');
  const meeting = activeMeeting();

  if (agendaEl) agendaEl.value = meeting.agenda || '';
  if (summaryEl) summaryEl.value = meeting.summary || '';
  if (memoryEl) memoryEl.value = [meeting.shortMemory, meeting.longMemory].filter(Boolean).join('\n\n');
}

function renderGroupChatFacilitator() {
  const el = document.getElementById('meeting-facilitator');
  if (!el) return;

  const meeting = activeMeeting();
  if (!meeting.facilitator) {
    el.textContent = 'No facilitator instruction queued yet.';
    return;
  }

  el.textContent = `${meeting.facilitator.participantName}: ${meeting.facilitator.prompt}`;
}

function renderMeetingDebug() {
  const queueEl = document.getElementById('meeting-queue-list');
  const tokenEl = document.getElementById('meeting-token-flow');
  const debugEl = document.getElementById('meeting-debug-log');
  const filterEl = document.getElementById('meeting-debug-filter');

  if (queueEl) {
    const filter = filterEl?.value ?? 'active';
    const taskPool = [...groupChat.activeTasks, ...groupChat.taskQueue, ...groupChat.taskHistory.slice(-40)].sort((a, b) => b.seq - a.seq);
    const tasks = taskPool.filter(task => {
      if (filter === 'all') return true;
      if (filter === 'active') return task.status === 'queued' || task.status === 'running';
      if (filter === 'errors') return task.status === 'error' || task.status === 'cancelled';
      if (filter === 'history') return task.status === 'completed';
      return true;
    });

    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'group-participants-empty';
      empty.textContent = 'No queued tasks yet.';
      queueEl.replaceChildren(empty);
    } else {
      queueEl.replaceChildren(...tasks.map(task => {
        const row = document.createElement('details');
        row.className = 'meeting-task';

        const summary = document.createElement('summary');
        summary.textContent = `#${task.seq} ${task.status.toUpperCase()} • ${task.purpose}${task.sourceLabel ? ` • ${task.sourceLabel}` : ''}`;

        const metaLabel = document.createElement('div');
        metaLabel.className = 'meeting-task-label';
        metaLabel.textContent = 'Metadata';
        const meta = document.createElement('pre');
        meta.textContent = JSON.stringify({
          meetingId: task.meetingId,
          mode: task.mode,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          sourceLabel: task.sourceLabel ?? null,
          error: task.error ?? null,
        }, null, 2);

        const promptLabel = document.createElement('div');
        promptLabel.className = 'meeting-task-label';
        promptLabel.textContent = 'Prompt';
        const prompt = document.createElement('pre');
        prompt.textContent = task.messages.map(message => {
          const head = `${message.role.toUpperCase()}:`;
          const body = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          return `${head}\n${body}`;
        }).join('\n\n---\n\n');

        const resultLabel = document.createElement('div');
        resultLabel.className = 'meeting-task-label';
        resultLabel.textContent = 'Result';
        const result = document.createElement('pre');
        result.textContent = task.result || task.error || '(no result captured)';

        row.append(summary, metaLabel, meta, promptLabel, prompt, resultLabel, result);
        return row;
      }));
    }
  }

  if (tokenEl) tokenEl.textContent = groupChat.tokenLines.join('\n');
  if (debugEl) debugEl.textContent = groupChat.debugLines.join('\n');
}

function updateGroupChatControls() {
  const meeting = activeMeeting();
  const addBtn = document.getElementById('meeting-participant-add');
  const select = document.getElementById('meeting-participant-select');
  const startBtn = document.getElementById('meeting-generate');
  const stopBtn = document.getElementById('meeting-stop');
  const noteBtn = document.getElementById('meeting-board-add');

  if (addBtn) addBtn.disabled = !select?.value;
  if (startBtn) startBtn.disabled = !(meeting.participants.length > 0 && meeting.topic.trim()) || meeting.busy;
  if (stopBtn) stopBtn.disabled = !meeting.busy;
  if (noteBtn) noteBtn.disabled = !(meeting.boardDraft?.trim());
}

function hydrateMeetingEditor() {
  ensureMeetings();
  const meeting = activeMeeting();
  renderMeetingSelector();

  const titleEl = document.getElementById('meeting-title');
  const topicEl = document.getElementById('meeting-topic');
  const autoEl = document.getElementById('meeting-auto');
  const boardEl = document.getElementById('meeting-board-note');

  if (titleEl) titleEl.value = meeting.title;
  if (topicEl) topicEl.value = meeting.topic;
  if (autoEl) autoEl.checked = meeting.auto;
  if (boardEl) boardEl.value = meeting.boardDraft ?? '';

  renderGroupParticipantOptions();
  renderGroupParticipants();
  renderMeetingAttachments();
  renderGroupChatSummary();
  renderGroupChatMessages();
  renderGroupChatFacilitator();
  renderMeetingDraftBoards();
  renderMeetingDebug();
  updateGroupChatControls();
}

function renderGroupChatPanel(body, actionsLeft, actionsRight) {
  const addMeetingBtn = document.createElement('button');
  addMeetingBtn.type = 'button';
  addMeetingBtn.className = 'btn-add';
  addMeetingBtn.title = 'Create meeting';
  addMeetingBtn.textContent = '+';
  addMeetingBtn.addEventListener('click', createMeeting);
  actionsRight.appendChild(addMeetingBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse meeting list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.meetingsNavCollapsed = !uiState.meetingsNavCollapsed;
    const shellEl = document.getElementById('meeting-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.meetingsNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.className = 'workspace-shell group-chat-shell';
  shell.id = 'meeting-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.meetingsNavCollapsed);

  const nav = document.createElement('div');
  nav.id = 'meeting-list';
  nav.className = 'workspace-nav';

  const content = document.createElement('div');
  content.className = 'workspace-detail';

  const headerRow = document.createElement('div');
  headerRow.className = 'meeting-header-row';

  const titleField = document.createElement('div');
  titleField.className = 'group-chat-field';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'field-label';
  titleLabel.htmlFor = 'meeting-title';
  titleLabel.textContent = 'Meeting Title';
  const titleInput = document.createElement('input');
  titleInput.id = 'meeting-title';
  titleInput.className = 'text-input';
  titleInput.type = 'text';
  titleInput.addEventListener('input', () => {
    const meeting = activeMeeting();
    meeting.title = titleInput.value || 'Untitled Meeting';
    renderMeetingSelector();
  });
  titleField.append(titleLabel, titleInput);
  headerRow.append(titleField);

  const controls = document.createElement('div');
  controls.className = 'group-chat-controls';

  const topicField = document.createElement('div');
  topicField.className = 'group-chat-field';
  const topicLabel = document.createElement('label');
  topicLabel.className = 'field-label';
  topicLabel.htmlFor = 'meeting-topic';
  topicLabel.textContent = 'Topic';
  const topicArea = document.createElement('textarea');
  topicArea.id = 'meeting-topic';
  topicArea.className = 'persona-textarea';
  topicArea.rows = 3;
  topicArea.placeholder = 'Define the topic, intended outcomes, and boundaries for the meeting.';
  topicArea.addEventListener('input', () => {
    const meeting = activeMeeting();
    meeting.topic = topicArea.value;
    updateGroupChatControls();
  });
  topicField.append(topicLabel, topicArea);

  const participantField = document.createElement('div');
  participantField.className = 'group-chat-field';
  const participantLabel = document.createElement('label');
  participantLabel.className = 'field-label';
  participantLabel.htmlFor = 'meeting-participant-select';
  participantLabel.textContent = 'Participants';
  const participantRow = document.createElement('div');
  participantRow.className = 'group-participant-add-row';
  const participantSelect = document.createElement('select');
  participantSelect.id = 'meeting-participant-select';
  participantSelect.className = 'chat-source-select';
  const addParticipantBtn = document.createElement('button');
  addParticipantBtn.type = 'button';
  addParticipantBtn.id = 'meeting-participant-add';
  addParticipantBtn.className = 'btn-secondary';
  addParticipantBtn.textContent = 'Add';
  addParticipantBtn.addEventListener('click', () => {
    const meeting = activeMeeting();
    if (!participantSelect.value) return;
    meeting.participants.push(participantSelect.value);
    renderGroupParticipantOptions();
    renderGroupParticipants();
  });
  participantRow.append(participantSelect, addParticipantBtn);
  const participantWrap = document.createElement('div');
  participantWrap.id = 'meeting-participants';
  participantWrap.className = 'group-participants';
  participantField.append(participantLabel, participantRow, participantWrap);

  const boardField = document.createElement('div');
  boardField.className = 'group-chat-field';
  const boardLabel = document.createElement('label');
  boardLabel.className = 'field-label';
  boardLabel.htmlFor = 'meeting-board-note';
  boardLabel.textContent = 'Message From The Board';
  const boardArea = document.createElement('textarea');
  boardArea.id = 'meeting-board-note';
  boardArea.className = 'persona-textarea';
  boardArea.rows = 3;
  boardArea.placeholder = 'Interject a directive or note for the facilitator to consider at the next available step.';
  boardArea.addEventListener('input', () => {
    const meeting = activeMeeting();
    meeting.boardDraft = boardArea.value;
    updateGroupChatControls();
  });
  const boardBtn = document.createElement('button');
  boardBtn.type = 'button';
  boardBtn.id = 'meeting-board-add';
  boardBtn.className = 'btn-secondary';
  boardBtn.textContent = 'Interject Note';
  boardBtn.addEventListener('click', addBoardNote);
  boardField.append(boardLabel, boardArea, boardBtn);

  const attachmentField = document.createElement('div');
  attachmentField.className = 'group-chat-field';
  const attachmentLabel = document.createElement('label');
  attachmentLabel.className = 'field-label';
  attachmentLabel.htmlFor = 'meeting-file-input';
  attachmentLabel.textContent = 'Attached Context';
  const attachmentRow = document.createElement('div');
  attachmentRow.className = 'group-participant-add-row';
  const attachmentBtn = document.createElement('button');
  attachmentBtn.type = 'button';
  attachmentBtn.className = 'btn-secondary';
  attachmentBtn.textContent = 'Attach Files';
  const attachmentInput = document.createElement('input');
  attachmentInput.id = 'meeting-file-input';
  attachmentInput.type = 'file';
  attachmentInput.accept = '.txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp';
  attachmentInput.multiple = true;
  attachmentInput.hidden = true;
  attachmentBtn.addEventListener('click', () => attachmentInput.click());
  attachmentInput.addEventListener('change', async () => {
    const files = Array.from(attachmentInput.files ?? []);
    attachmentInput.value = '';
    await handleMeetingAttachments(files);
  });
  attachmentRow.append(attachmentBtn, attachmentInput);
  const attachmentList = document.createElement('div');
  attachmentList.id = 'meeting-attachments';
  attachmentList.className = 'meeting-attachments';
  attachmentField.append(attachmentLabel, attachmentRow, attachmentList);

  controls.append(topicField, participantField, boardField, attachmentField);

  const summaryGrid = document.createElement('div');
  summaryGrid.className = 'meeting-summary-grid';

  const agendaField = document.createElement('div');
  agendaField.className = 'group-chat-field';
  const agendaLabel = document.createElement('label');
  agendaLabel.className = 'field-label';
  agendaLabel.htmlFor = 'meeting-agenda';
  agendaLabel.textContent = 'Agenda';
  const agendaArea = document.createElement('textarea');
  agendaArea.id = 'meeting-agenda';
  agendaArea.className = 'persona-textarea meeting-summary-box';
  agendaArea.readOnly = true;
  agendaArea.placeholder = 'The facilitator will turn the topic into a structured agenda.';
  agendaField.append(agendaLabel, agendaArea);

  const summaryField = document.createElement('div');
  summaryField.className = 'group-chat-field';
  const summaryLabel = document.createElement('label');
  summaryLabel.className = 'field-label';
  summaryLabel.htmlFor = 'meeting-summary';
  summaryLabel.textContent = 'Summary';
  const summaryArea = document.createElement('textarea');
  summaryArea.id = 'meeting-summary';
  summaryArea.className = 'persona-textarea meeting-summary-box';
  summaryArea.readOnly = true;
  summaryArea.placeholder = 'Dynamic conceptual meeting summary.';
  summaryField.append(summaryLabel, summaryArea);

  const memoryField = document.createElement('div');
  memoryField.className = 'group-chat-field';
  const memoryLabel = document.createElement('label');
  memoryLabel.className = 'field-label';
  memoryLabel.htmlFor = 'meeting-memory';
  memoryLabel.textContent = 'Working Memory';
  const memoryArea = document.createElement('textarea');
  memoryArea.id = 'meeting-memory';
  memoryArea.className = 'persona-textarea meeting-summary-box';
  memoryArea.readOnly = true;
  memoryArea.placeholder = 'Short-term and long-term memory snapshots for orchestration.';
  memoryField.append(memoryLabel, memoryArea);

  summaryGrid.append(agendaField, summaryField, memoryField);

  const facilitator = document.createElement('div');
  facilitator.className = 'group-chat-facilitator-card';
  const facilitatorLabel = document.createElement('div');
  facilitatorLabel.className = 'section-title';
  facilitatorLabel.textContent = 'Facilitator';
  const facilitatorText = document.createElement('p');
  facilitatorText.id = 'meeting-facilitator';
  facilitatorText.className = 'group-chat-facilitator';
  facilitatorText.textContent = 'No facilitator instruction queued yet.';
  facilitator.append(facilitatorLabel, facilitatorText);

  const actionBar = document.createElement('div');
  actionBar.className = 'group-chat-action-bar';
  const autoLabel = document.createElement('label');
  autoLabel.className = 'group-chat-auto';
  const autoInput = document.createElement('input');
  autoInput.type = 'checkbox';
  autoInput.id = 'meeting-auto';
  autoInput.addEventListener('change', () => {
    activeMeeting().auto = autoInput.checked;
  });
  const autoText = document.createElement('span');
  autoText.textContent = 'Auto';
  autoLabel.append(autoInput, autoText);
  const status = document.createElement('p');
  status.id = 'meeting-status';
  status.className = 'meeting-status';
  status.textContent = 'Ready.';
  const buttons = document.createElement('div');
  buttons.className = 'group-chat-buttons';
  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.id = 'meeting-generate';
  generateBtn.className = 'btn-primary';
  generateBtn.textContent = 'Generate Next';
  generateBtn.addEventListener('click', groupChatRun);
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.id = 'meeting-stop';
  stopBtn.className = 'btn-secondary';
  stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', stopGroupChat);
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn-secondary';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', clearGroupChat);
  buttons.append(generateBtn, stopBtn, clearBtn);
  actionBar.append(autoLabel, status, buttons);

  const live = document.createElement('div');
  live.id = 'meeting-live-feed';
  live.className = 'group-chat-messages';

  const draftBoards = document.createElement('details');
  draftBoards.className = 'meeting-details';
  draftBoards.open = true;
  const draftBoardsSummary = document.createElement('summary');
  draftBoardsSummary.textContent = 'Draft Boards';
  const draftBoardsBody = document.createElement('div');
  draftBoardsBody.className = 'meeting-draftboards-wrap';
  const draftBoardsActions = document.createElement('div');
  draftBoardsActions.className = 'panel-actions-row panel-actions-row--nested';
  const draftBoardsActionsLeft = document.createElement('div');
  draftBoardsActionsLeft.className = 'panel-header-actions panel-header-actions--left';
  const draftBoardsActionsRight = document.createElement('div');
  draftBoardsActionsRight.className = 'panel-header-actions panel-header-actions--right';
  const draftBoardsNavToggle = document.createElement('button');
  draftBoardsNavToggle.type = 'button';
  draftBoardsNavToggle.className = 'btn-add';
  draftBoardsNavToggle.title = 'Collapse draft board list';
  draftBoardsNavToggle.textContent = '↔';
  draftBoardsNavToggle.addEventListener('click', () => {
    uiState.draftBoardsNavCollapsed = !uiState.draftBoardsNavCollapsed;
    const shellEl = document.getElementById('meeting-draftboards-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.draftBoardsNavCollapsed);
  });
  const newDraftBtn = document.createElement('button');
  newDraftBtn.type = 'button';
  newDraftBtn.className = 'btn-add';
  newDraftBtn.textContent = '+';
  newDraftBtn.title = 'Create blank draft board';
  newDraftBtn.addEventListener('click', () => createMeetingDraftBoard());
  draftBoardsActionsLeft.appendChild(draftBoardsNavToggle);
  draftBoardsActionsRight.appendChild(newDraftBtn);
  draftBoardsActions.append(draftBoardsActionsLeft, draftBoardsActionsRight);
  const draftBoardShell = document.createElement('div');
  draftBoardShell.className = 'workspace-shell meeting-draftboards-shell';
  draftBoardShell.id = 'meeting-draftboards-shell';
  draftBoardShell.classList.toggle('workspace-shell--collapsed', uiState.draftBoardsNavCollapsed);
  const draftBoardList = document.createElement('div');
  draftBoardList.id = 'meeting-draftboard-list';
  draftBoardList.className = 'workspace-nav meeting-draftboard-list';
  const draftBoardDetail = document.createElement('div');
  draftBoardDetail.className = 'workspace-detail meeting-draftboard-detail';
  const draftBoardToolbar = document.createElement('div');
  draftBoardToolbar.className = 'meeting-draftboard-toolbar';
  const planDraftBtn = document.createElement('button');
  planDraftBtn.type = 'button';
  planDraftBtn.className = 'btn-secondary';
  planDraftBtn.textContent = 'Plan Output';
  planDraftBtn.addEventListener('click', async () => {
    const meeting = activeMeeting();
    const board = activeDraftBoard(meeting) ?? createMeetingDraftBoard();
    setGroupChatStatus(`Planning ${board.name}…`, 'muted');
    board.plan = await draftBoardPlan(meeting, board, meeting.controller?.signal);
    renderMeetingDraftBoards();
    setGroupChatStatus(`Planned ${board.name}.`, 'success');
  });
  const reviseDraftBtn = document.createElement('button');
  reviseDraftBtn.type = 'button';
  reviseDraftBtn.className = 'btn-primary';
  reviseDraftBtn.textContent = 'Revise Board';
  reviseDraftBtn.addEventListener('click', async () => {
    const meeting = activeMeeting();
    const board = activeDraftBoard(meeting) ?? createMeetingDraftBoard();
    setGroupChatStatus(`Revising ${board.name}…`, 'muted');
    board.content = await reviseDraftBoard(meeting, board, meeting.controller?.signal);
    board.updatedAt = new Date().toISOString();
    renderMeetingDraftBoards();
    setGroupChatStatus(`Updated ${board.name}.`, 'success');
  });
  draftBoardToolbar.append(planDraftBtn, reviseDraftBtn);

  const draftBoardNameField = document.createElement('div');
  draftBoardNameField.className = 'group-chat-field';
  const draftBoardNameLabel = document.createElement('label');
  draftBoardNameLabel.className = 'field-label';
  draftBoardNameLabel.htmlFor = 'meeting-draftboard-name';
  draftBoardNameLabel.textContent = 'Draft Board Name';
  const draftBoardNameInput = document.createElement('input');
  draftBoardNameInput.id = 'meeting-draftboard-name';
  draftBoardNameInput.className = 'text-input';
  draftBoardNameField.append(draftBoardNameLabel, draftBoardNameInput);

  const draftBoardPlanField = document.createElement('div');
  draftBoardPlanField.className = 'group-chat-field';
  const draftBoardPlanLabel = document.createElement('label');
  draftBoardPlanLabel.className = 'field-label';
  draftBoardPlanLabel.htmlFor = 'meeting-draftboard-plan';
  draftBoardPlanLabel.textContent = 'Output Plan';
  const draftBoardPlanArea = document.createElement('textarea');
  draftBoardPlanArea.id = 'meeting-draftboard-plan';
  draftBoardPlanArea.className = 'persona-textarea';
  draftBoardPlanArea.rows = 5;
  draftBoardPlanField.append(draftBoardPlanLabel, draftBoardPlanArea);

  const draftBoardContentField = document.createElement('div');
  draftBoardContentField.className = 'group-chat-field';
  const draftBoardContentLabel = document.createElement('label');
  draftBoardContentLabel.className = 'field-label';
  draftBoardContentLabel.htmlFor = 'meeting-draftboard-content';
  draftBoardContentLabel.textContent = 'Draft Artifact';
  const draftBoardContentArea = document.createElement('textarea');
  draftBoardContentArea.id = 'meeting-draftboard-content';
  draftBoardContentArea.className = 'persona-textarea meeting-draftboard-content';
  draftBoardContentArea.rows = 12;
  draftBoardContentField.append(draftBoardContentLabel, draftBoardContentArea);

  draftBoardDetail.append(draftBoardToolbar, draftBoardNameField, draftBoardPlanField, draftBoardContentField);
  draftBoardShell.append(draftBoardList, draftBoardDetail);
  draftBoardsBody.append(draftBoardsActions, draftBoardShell);
  draftBoards.append(draftBoardsSummary, draftBoardsBody);

  const debug = document.createElement('details');
  debug.className = 'meeting-details';
  const debugSummary = document.createElement('summary');
  debugSummary.textContent = 'Debug';
  const debugBody = document.createElement('div');
  debugBody.className = 'meeting-debug-grid';
  const queueWrap = document.createElement('div');
  queueWrap.className = 'meeting-debug-pane';
  const queueToolbar = document.createElement('div');
  queueToolbar.className = 'meeting-debug-toolbar';
  const queueTitle = document.createElement('div');
  queueTitle.className = 'section-title';
  queueTitle.textContent = 'Tasks';
  const queueFilter = document.createElement('select');
  queueFilter.id = 'meeting-debug-filter';
  queueFilter.className = 'chat-source-select meeting-debug-filter';
  queueFilter.replaceChildren(...['active', 'all', 'history', 'errors'].map(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value[0].toUpperCase() + value.slice(1);
    return opt;
  }));
  queueFilter.addEventListener('change', renderMeetingDebug);
  queueToolbar.append(queueTitle, queueFilter);
  const queueList = document.createElement('div');
  queueList.id = 'meeting-queue-list';
  queueList.className = 'meeting-queue-list';
  queueWrap.append(queueToolbar, queueList);
  const tokenWrap = document.createElement('div');
  tokenWrap.className = 'meeting-debug-pane';
  const tokenTitle = document.createElement('div');
  tokenTitle.className = 'section-title';
  tokenTitle.textContent = 'Token Flow';
  const tokenPre = document.createElement('pre');
  tokenPre.id = 'meeting-token-flow';
  tokenPre.className = 'meeting-terminal';
  tokenWrap.append(tokenTitle, tokenPre);
  const debugWrap = document.createElement('div');
  debugWrap.className = 'meeting-debug-pane';
  const debugTitle = document.createElement('div');
  debugTitle.className = 'section-title';
  debugTitle.textContent = 'Task Log';
  const debugPre = document.createElement('pre');
  debugPre.id = 'meeting-debug-log';
  debugPre.className = 'meeting-terminal';
  debugWrap.append(debugTitle, debugPre);
  debugBody.append(queueWrap, tokenWrap, debugWrap);
  debug.append(debugSummary, debugBody);

  content.append(headerRow, controls, summaryGrid, facilitator, actionBar, live, draftBoards, debug);
  shell.append(nav, content);
  body.appendChild(shell);

  ensureMeetings();
  bindMeetingDraftBoardInputs();
  hydrateMeetingEditor();
}

function addBoardNote() {
  const meeting = activeMeeting();
  const note = meeting.boardDraft?.trim();
  if (!note) return;
  meeting.pendingBoardNotes.push(note);
  appendMeetingMessage(meeting, {
    type: 'board',
    speaker: 'Board',
    participantId: null,
    sourceLabel: '',
    content: note,
  });
  meeting.boardDraft = '';
  hydrateMeetingEditor();
  setGroupChatStatus('Board note added to the record and queued for the facilitator.', 'success');
}

function clearGroupChat() {
  const meeting = activeMeeting();
  stopMeeting(meeting);
  meeting.agenda = '';
  meeting.summary = '';
  meeting.shortMemory = '';
  meeting.longMemory = '';
  meeting.messages = [];
  meeting.facilitator = null;
  meeting.pendingBoardNotes = [];
  hydrateMeetingEditor();
  setGroupChatStatus('Meeting cleared.', 'muted');
}

function stopMeeting(meeting) {
  meeting.auto = false;
  meeting.controller?.abort();
}

function stopGroupChat() {
  stopMeeting(activeMeeting());
  const autoInput = document.getElementById('meeting-auto');
  if (autoInput) autoInput.checked = false;
}

async function groupChatRun() {
  const meeting = activeMeeting();
  if (meeting.busy) return;

  syncGroupParticipantsWithPersonas();
  if (connectedInferenceSources().length === 0) {
    setGroupChatStatus('Connect at least one enabled source to run meetings.', 'error');
    return;
  }
  if (meeting.participants.length === 0) {
    setGroupChatStatus('Add at least one participant.', 'error');
    return;
  }
  if (!meeting.topic.trim()) {
    setGroupChatStatus('Enter a meeting topic first.', 'error');
    return;
  }

  meeting.busy = true;
  meeting.controller = new AbortController();
  renderMeetingSelector();
  updateGroupChatControls();
  setGroupChatStatus(meeting.auto ? 'Auto mode running…' : 'Generating next turn…', 'muted');

  try {
    if (!meeting.agenda.trim()) {
      meeting.agenda = await buildMeetingAgenda(meeting, meeting.controller.signal);
      meeting.summary = meeting.agenda;
      meeting.shortMemory = meeting.agenda;
      renderGroupChatSummary();
    }

    do {
      await runMeetingTurn(meeting, meeting.controller.signal);
    } while (meeting.auto && !meeting.controller.signal.aborted);
  } catch (err) {
    if (err.name !== 'AbortError') {
      setGroupChatStatus(`Meeting failed: ${err.message}`, 'error');
    }
  } finally {
    meeting.busy = false;
    meeting.controller = null;
    renderMeetingSelector();
    updateGroupChatControls();
    if (!meeting.auto) setGroupChatStatus('Ready for the next turn.', 'muted');
  }
}

async function runMeetingTurn(meeting, signal) {
  if (!meeting.facilitator || meeting.pendingBoardNotes.length > 0) {
    meeting.facilitator = await planNextMeetingTurn(meeting, signal);
    meeting.pendingBoardNotes = [];
    renderGroupChatFacilitator();
  }

  const plan = meeting.facilitator ?? fallbackFacilitatorPlan(meeting);
  if (!plan) throw new Error('No valid facilitator plan available.');

  const participant = savedPersonaById(plan.participantId);
  if (!participant) throw new Error('Selected participant is no longer available.');

  setGroupChatStatus(`Generating ${participant.name || 'participant'}…`, 'muted');
  const responseText = await generateMeetingParticipantMessage(meeting, participant, plan.prompt, signal);
  if (!responseText.trim()) throw new Error('Participant response was empty.');

  appendMeetingMessage(meeting, {
    type: 'participant',
    participantId: participant.id,
    speaker: participant.name.trim() || participant.title.trim() || 'Participant',
    content: responseText.trim(),
    sourceLabel: '',
  });
  renderGroupChatMessages();

  const [summary, longMemory, nextPlan] = await Promise.all([
    updateMeetingSummary(meeting, signal),
    updateMeetingLongMemory(meeting, signal),
    planNextMeetingTurn(meeting, signal),
  ]);

  if (summary.trim()) {
    meeting.summary = summary.trim();
    meeting.shortMemory = summary.trim();
  }
  if (longMemory.trim()) meeting.longMemory = longMemory.trim();
  meeting.facilitator = nextPlan;
  renderGroupChatSummary();
  renderGroupChatFacilitator();
}

function fallbackFacilitatorPlan(meeting) {
  if (meeting.participants.length === 0) return null;
  const lastId = meeting.messages.filter(msg => msg.type === 'participant').at(-1)?.participantId;
  const pool = meeting.participants.filter(id => id !== lastId);
  const targetId = pool[0] ?? meeting.participants[0];
  const persona = savedPersonaById(targetId);
  return {
    participantId: targetId,
    participantName: persona?.name?.trim() || 'Participant',
    prompt: meeting.messages.filter(msg => msg.type === 'participant').length === 0
      ? `Address the first agenda item for "${meeting.topic}" and include a clear next step recommendation.`
      : `Advance the discussion on "${meeting.topic}", stay within scope, and end with "Next step recommendation:".`,
  };
}

function facilitatorContext(meeting) {
  const board = meeting.pendingBoardNotes.length ? meeting.pendingBoardNotes.map(note => `- ${note}`).join('\n') : '(none)';
  return [
    `Topic:\n${meeting.topic.trim()}`,
    `Agenda:\n${meeting.agenda || '(not established)'}`,
    `Summary:\n${meeting.summary || '(none yet)'}`,
    `Working memory:\n${[meeting.shortMemory, meeting.longMemory].filter(Boolean).join('\n\n') || '(none yet)'}`,
    `Draft boards:\n${meetingDraftBoardContext(meeting)}`,
    `Indexed attachments:\n${meetingAttachmentContext(meeting)}`,
    `Board notes pending:\n${board}`,
    `Recent minutes:\n${meetingTranscriptTail(meeting) || '(opening turn)'}`,
  ].join('\n\n');
}

async function buildMeetingAgenda(meeting, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: 'Build agenda',
    mode: 'blocking',
    workflow: 'meeting_agenda',
    useCritic: true,
    validationHint: 'Return only the agenda with 4-7 numbered items and an intended outcome line.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'meeting_agenda',
      role: 'You are a facilitator drafting a structured professional meeting agenda.',
      instructions: [
        'Turn the meeting topic into an objective-focused agenda.',
        'Keep each item concrete and action-oriented.',
      ],
      context: {
        meeting_title: meeting.title,
        participants: meeting.participants.map(id => savedPersonaById(id)?.name?.trim() || 'Participant').join(', '),
      },
      input: meeting.topic,
      outputFormat: 'Return only the agenda with 4-7 numbered items and one intended outcome line.',
      includeThought: true,
    }),
    signal,
  });
}

async function indexMeetingAttachment(meeting, attachment) {
  const attachmentMessage = attachment.kind === 'image'
    ? {
        role: 'user',
        content: [
          `Meeting title: ${meeting.title}`,
          `Meeting topic: ${meeting.topic || '(not set yet)'}`,
          `Attachment name: ${attachment.name}`,
          'Create a compact reference summary for meeting participants.',
          'Include what it is, what matters, and how it may be referenced later.',
        ].join('\n'),
        images: [attachment.base64],
      }
    : {
        role: 'user',
        content: [
          `Meeting title: ${meeting.title}`,
          `Meeting topic: ${meeting.topic || '(not set yet)'}`,
          `Attachment name: ${attachment.name}`,
          'Create a compact reference summary for meeting participants.',
          'Include what it is, what matters, and how it may be referenced later.',
          '',
          attachment.text ? `Attachment content:\n${attachment.text.slice(0, 12000)}` : 'Attachment content unavailable.',
        ].join('\n'),
      };

  return requestQueuedText({
    meetingId: meeting.id,
    purpose: `Index attachment: ${attachment.name}`,
    mode: 'parallel',
    workflow: 'attachment_index',
    useCritic: true,
    validationHint: 'Return only a concise attachment summary in under 140 words.',
    messages: [
      ...workflowMessages({
        sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
        workflow: 'attachment_index',
        role: 'You are indexing meeting context for later retrieval.',
        instructions: [
          'Summarize what matters and how participants should reference it later.',
        ],
        context: {
          meeting_title: meeting.title,
          meeting_topic: meeting.topic || '(not set yet)',
          attachment_name: attachment.name,
        },
        input: attachment.kind === 'text' ? (attachment.text?.slice(0, 12000) || '(empty)') : 'See attached image.',
        outputFormat: 'Return only a concise reference summary in under 140 words with concrete retrieval cues.',
        includeThought: true,
      }).slice(0, 1),
      attachmentMessage,
    ],
  });
}

async function planNextMeetingTurn(meeting, signal) {
  const raw = await requestQueuedText({
    meetingId: meeting.id,
    purpose: 'Facilitator plan',
    mode: 'parallel',
    workflow: 'facilitator_plan',
    useCritic: true,
    validationHint: 'Return exactly two lines: PARTICIPANT: <name> and PROMPT: <instruction>.',
    validator: value => /PARTICIPANT:\s*.+/i.test(value) && /PROMPT:\s*.+/i.test(value),
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'facilitator_plan',
      role: 'You facilitate a professional meeting using a plan-and-execute mindset.',
      instructions: [
        'Advance the meeting against the agenda and current summary.',
        'Interpret board notes in context rather than obeying them blindly.',
        'Choose the single best next participant and write a concise next prompt.',
      ],
      context: {
        facilitator_context: facilitatorContext(meeting),
        available_participants: meeting.participants.map(id => savedPersonaById(id)?.name?.trim() || 'Participant').join('\n'),
        tool_schema: JSON.stringify(Policy.buildFacilitatorToolSchema(), null, 2),
      },
      input: 'Produce the next facilitator action for this meeting.',
      outputFormat: 'Return exactly two lines: PARTICIPANT: <name> and PROMPT: <instruction>.',
      examples: [
        {
          input: 'Need the next meeting move.',
          thought: 'The product lead should answer the unresolved market question.',
          output: 'PARTICIPANT: Product Lead\nPROMPT: Resolve the open market-fit concern and end with a next step recommendation.',
        },
      ],
      includeThought: true,
    }),
    signal,
  });

  const participantLine = raw.match(/PARTICIPANT:\s*(.+)/i)?.[1]?.trim();
  const promptLine = raw.match(/PROMPT:\s*([\s\S]+)/i)?.[1]?.trim();
  const participant = personas.find(persona => (persona.name.trim() || 'Untitled Persona').toLowerCase() === (participantLine || '').toLowerCase());
  if (!participant || !meeting.participants.includes(participant.id) || !promptLine) {
    return fallbackFacilitatorPlan(meeting);
  }

  return {
    participantId: participant.id,
    participantName: participant.name.trim() || 'Participant',
    prompt: promptLine,
  };
}

async function generateMeetingParticipantMessage(meeting, persona, facilitatorPrompt, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: `Speaker turn: ${persona.name.trim() || 'Participant'}`,
    mode: 'blocking',
    workflow: 'meeting_participant_turn',
    useCritic: true,
    validationHint: 'Return only the participant reply and end with "Next step recommendation:".',
    validator: value => /Next step recommendation:/i.test(value),
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'meeting_participant_turn',
      role: personaInstructions(persona),
      instructions: [
        'You are participating in a professional meeting.',
        'Stay on agenda, move the discussion forward, and be concise and practical.',
      ],
      context: {
        facilitator_context: facilitatorContext(meeting),
      },
      input: `Facilitator prompt for you:\n${facilitatorPrompt}`,
      outputFormat: 'Return only the participant reply and end with one final line that begins exactly with "Next step recommendation:".',
      includeThought: true,
    }),
    signal,
  });
}

async function updateMeetingSummary(meeting, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: 'Update summary',
    mode: 'parallel',
    workflow: 'meeting_summary',
    useCritic: true,
    validationHint: 'Return only the meeting summary in under 140 words.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'meeting_summary',
      role: 'You maintain a concise dynamic meeting summary.',
      instructions: ['Track progress against the agenda, decisions, tensions, unresolved questions, and the next direction.'],
      context: {
        facilitator_context: facilitatorContext(meeting),
      },
      input: 'Refresh the meeting summary.',
      outputFormat: 'Return only the summary in under 140 words.',
      includeThought: true,
    }),
    signal,
  });
}

async function updateMeetingLongMemory(meeting, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: 'Update long memory',
    mode: 'parallel',
    workflow: 'meeting_long_memory',
    useCritic: true,
    validationHint: 'Return only the longer-horizon memory in under 160 words.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'meeting_long_memory',
      role: 'You maintain compact long-term memory for a meeting.',
      instructions: ['Preserve durable facts, decisions, recurring concerns, and references to important minute ids like [m3].'],
      context: {
        facilitator_context: facilitatorContext(meeting),
      },
      input: 'Refresh the longer-horizon meeting memory.',
      outputFormat: 'Return only the memory in under 160 words.',
      includeThought: true,
    }),
    signal,
  });
}

async function draftBoardPlan(meeting, board, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: `Draft board plan: ${board.name}`,
    mode: 'parallel',
    workflow: 'draft_board_plan',
    useCritic: true,
    validationHint: 'Return only a concise plan with 3-6 bullet points.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'draft_board_plan',
      role: 'You are planning a collaborative meeting output artifact.',
      instructions: ['Define the intended artifact clearly enough for collaborative iteration.'],
      context: {
        facilitator_context: facilitatorContext(meeting),
        draft_board_name: board.name,
      },
      input: `Current board content:\n${board.content || '(blank)'}`,
      outputFormat: 'Return only a concise plan with 3-6 bullet points describing what this draft board should contain.',
      includeThought: true,
    }),
    signal,
  });
}

async function reviseDraftBoard(meeting, board, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: `Revise draft board: ${board.name}`,
    mode: 'blocking',
    workflow: 'draft_board_revision',
    useCritic: true,
    validationHint: 'Return only the revised draft board content.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'draft_board_revision',
      role: 'You are collaboratively revising a meeting draft board.',
      instructions: [
        'Use the agenda, summary, current transcript, and any existing board content.',
        'Be concrete, organized, and artifact-oriented.',
      ],
      context: {
        facilitator_context: facilitatorContext(meeting),
        draft_board_name: board.name,
        board_plan: board.plan || '(none)',
      },
      input: `Existing board content:\n${board.content || '(blank)'}`,
      outputFormat: 'Return only the revised draft board content.',
      includeThought: true,
    }),
    signal,
  });
}

function requestQueuedText({ meetingId, purpose, messages, mode, signal, validator = null, validationHint = '', workflow = 'generic', useCritic = false }) {
  const task = {
    id: `task-${groupChat.nextTaskSeq++}`,
    seq: groupChat.nextTaskSeq - 1,
    meetingId,
    purpose,
    messages,
    mode,
    status: 'queued',
    createdAt: new Date().toISOString(),
    signal,
    validator,
    validationHint,
    workflow,
    useCritic,
  };

  pushDebugLine(`Queued ${purpose}`);

  return new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
    groupChat.taskQueue.push(task);
    renderMeetingDebug();
    pumpInferenceQueue();
  });
}

function pumpInferenceQueue() {
  if (groupChat.pumping) return;
  groupChat.pumping = true;

  try {
    const availableSources = () => connectedInferenceSources().filter(source => !groupChat.sourceBusy.has(source.id));

    while (groupChat.taskQueue.length > 0) {
      const free = availableSources();
      if (free.length === 0) break;

      const blockingIndex = groupChat.taskQueue.findIndex(task => task.mode === 'blocking');
      if (blockingIndex !== -1) {
        if (groupChat.activeTasks.length > 0) break;
        const [task] = groupChat.taskQueue.splice(blockingIndex, 1);
        startTask(task, free[0]);
        break;
      }

      const task = groupChat.taskQueue.shift();
      startTask(task, free[0]);
    }
  } finally {
    groupChat.pumping = false;
  }
}

function startTask(task, source) {
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  task.sourceId = source.id;
  task.sourceLabel = `${displayLabel(source)} • ${source.selectedModel}`;
  task.streamTrace = { reasoning: '', output: '' };
  groupChat.activeTasks.push(task);
  groupChat.sourceBusy.add(source.id);
  pushDebugLine(`Started #${task.seq} ${task.purpose} on ${task.sourceLabel}`);
  pushTokenBoundary(`#${task.seq} STREAM START • ${task.purpose} • ${task.sourceLabel}`);
  pushTokenLine(`prompt >> ${clampText(task.messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join(' | '), 320)}`);
  renderMeetingDebug();

  runTask(task, source)
    .then(result => {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = result;
      task.resolve(result);
    })
    .catch(err => {
      task.status = err.name === 'AbortError' ? 'cancelled' : 'error';
      task.completedAt = new Date().toISOString();
      task.error = err.message;
      task.reject(err);
    })
    .finally(() => {
      groupChat.activeTasks = groupChat.activeTasks.filter(active => active !== task);
      groupChat.sourceBusy.delete(source.id);
      groupChat.taskHistory.push(task);
      groupChat.taskHistory = groupChat.taskHistory.slice(-60);
      if (task.streamTrace?.reasoning) pushTokenLine(`#${task.seq} reasoning <<\n${task.streamTrace.reasoning}`);
      if (task.streamTrace?.output) pushTokenLine(`#${task.seq} output <<\n${task.streamTrace.output}`);
      pushTokenBoundary(`#${task.seq} STREAM END • ${task.status.toUpperCase()}`);
      pushDebugLine(`Finished #${task.seq} ${task.purpose} (${task.status})`);
      renderMeetingDebug();
      pumpInferenceQueue();
    });
}

async function runTask(task, source) {
  const primary = await runStreamRequest(source, task.messages, task);
  if (primary.trim() && (!task.validator || task.validator(primary))) return primary.trim();

  if (task.useCritic) {
    pushTokenLine(`#${task.seq} critic >> requesting corrected final output`);
    const reviewed = await runStreamRequest(source, Policy.buildCriticMessages({
      modelName: source.selectedModel,
      workflow: task.workflow,
      originalMessages: task.messages,
      draft: primary,
      validationHint: task.validationHint,
    }), task);
    if (reviewed.trim() && (!task.validator || task.validator(reviewed))) return reviewed.trim();
  }

  pushTokenLine(`#${task.seq} fallback >> requesting final-only output`);
  return runStreamRequest(source, [
    {
      role: 'system',
      content: 'Return only the final requested output. Do not include hidden reasoning or chain-of-thought.',
    },
    ...task.messages,
  ], task);
}

async function runStreamRequest(source, messages, task) {
  const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: source.selectedModel,
      messages,
      stream: true,
    }),
    signal: task.signal,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(errBody.error ?? `HTTP ${response.status}`);
  }

  let text = '';
  for await (const chunk of readNdjsonStream(response)) {
    const thinking = chunk.message?.thinking ?? '';
    const delta = chunk.message?.content ?? '';
    if (thinking) task.streamTrace.reasoning += thinking;
    if (delta) {
      text += delta;
      task.streamTrace.output += delta;
    }
    if (chunk.done) break;
  }

  const parsed = Policy.parseStructuredResponse(text);
  if (parsed.thought) task.streamTrace.reasoning += `${task.streamTrace.reasoning ? '\n' : ''}${parsed.thought}`;
  return (parsed.answer || text).trim();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function showModal() {
  document.getElementById('add-modal').classList.remove('hidden');
  const input = document.getElementById('source-url');
  input.value = '';
  hideModalError();
  input.focus();
}

function hideModal() {
  document.getElementById('add-modal').classList.add('hidden');
}

function confirmModal() {
  const url = document.getElementById('source-url').value.trim();
  if (!url) { showModalError('Please enter a URL.'); return; }
  const result = addSource(url);
  if (result.error) { showModalError(result.error); return; }
  hideModal();
}

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideModalError() {
  document.getElementById('modal-error').classList.add('hidden');
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  syncThemeButton();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) syncThemeButton();
  });
}

function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  syncThemeButton();
}

function effectiveTheme() {
  return (
    document.documentElement.getAttribute('data-theme') ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

function syncThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = effectiveTheme() === 'dark';
  btn.textContent = isDark ? '☀' : '☾';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', btn.title);
}

function exportSessionSnapshot() {
  return {
    version: SESSION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    theme: document.documentElement.getAttribute('data-theme') ?? null,
    sources: sources.map(({ id, url, selectedModel, label, isDefault, enabled, _seq }) => ({
      id, url, selectedModel, label, isDefault, enabled, _seq,
    })),
    personas: personas.map(({ id, name, title, description, instructions, _seq }) => ({
      id, name, title, description, instructions, _seq,
    })),
    meetings: {
      uiState,
      activeMeetingId: groupChat.activeMeetingId,
      nextMeetingSeq: groupChat.nextMeetingSeq,
      meetings: groupChat.meetings.map(meeting => ({
        id: meeting.id,
        title: meeting.title,
        topic: meeting.topic,
        participants: [...meeting.participants],
        auto: false,
        agenda: meeting.agenda,
        summary: meeting.summary,
        shortMemory: meeting.shortMemory,
        longMemory: meeting.longMemory,
        messages: meeting.messages.map(message => ({ ...message })),
        facilitator: meeting.facilitator ? { ...meeting.facilitator } : null,
        pendingBoardNotes: [...meeting.pendingBoardNotes],
        boardDraft: meeting.boardDraft,
        attachments: meeting.attachments.map(attachment => ({ ...attachment })),
        draftBoards: meeting.draftBoards.map(board => ({ ...board })),
        activeDraftBoardId: meeting.activeDraftBoardId,
        nextDraftBoardSeq: meeting.nextDraftBoardSeq,
        hasUpdate: meeting.hasUpdate,
      })),
    },
    chat: typeof window.chatExportState === 'function' ? window.chatExportState() : null,
  };
}

function downloadSessionSnapshot() {
  const blob = new Blob([JSON.stringify(exportSessionSnapshot(), null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `distributed-inference-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function applyImportedSession(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid session file.');

  if (Array.isArray(snapshot.sources)) {
    sources = snapshot.sources.map(source => ({
      ...makeSource(source.url ?? DEFAULT_URL),
      id: source.id ?? `source-${nextSeq}`,
      url: normalizeUrl(source.url ?? DEFAULT_URL),
      selectedModel: source.selectedModel ?? DEFAULT_MODEL,
      label: source.label ?? '',
      isDefault: Boolean(source.isDefault),
      enabled: source.enabled ?? true,
      _seq: source._seq ?? nextSeq++,
      status: 'connecting',
      models: [],
      error: null,
      retryTimer: null,
      hasUpdate: false,
    }));
    nextSeq = Math.max(1, ...sources.map(source => source._seq ?? 0)) + 1;
    activeSourceId = sources[0]?.id ?? null;
  }

  if (Array.isArray(snapshot.personas)) {
    personas = snapshot.personas.map(persona => ({
      id: persona.id,
      name: persona.name ?? '',
      title: persona.title ?? '',
      description: persona.description ?? '',
      instructions: persona.instructions ?? '',
      _seq: persona._seq ?? nextPersonaSeq++,
      generating: false,
      hasUpdate: false,
    }));
    nextPersonaSeq = Math.max(1, ...personas.map(persona => persona._seq ?? 0)) + 1;
    activePersonaId = personas[0]?.id ?? null;
  }

  if (snapshot.meetings?.meetings) {
    groupChat.meetings = snapshot.meetings.meetings.map(meeting => ({
      ...makeMeeting(),
      ...meeting,
      participants: Array.isArray(meeting.participants) ? [...meeting.participants] : [],
      messages: Array.isArray(meeting.messages) ? meeting.messages.map(message => ({ ...message })) : [],
      pendingBoardNotes: Array.isArray(meeting.pendingBoardNotes) ? [...meeting.pendingBoardNotes] : [],
      attachments: Array.isArray(meeting.attachments) ? meeting.attachments.map(attachment => ({ ...attachment })) : [],
      draftBoards: Array.isArray(meeting.draftBoards) ? meeting.draftBoards.map(board => ({ ...board })) : [],
      busy: false,
      auto: false,
      controller: null,
    }));
    groupChat.activeMeetingId = snapshot.meetings.activeMeetingId ?? groupChat.meetings[0]?.id ?? null;
    groupChat.nextMeetingSeq = snapshot.meetings.nextMeetingSeq ?? (groupChat.meetings.length + 1);
    if (snapshot.meetings.uiState) {
      uiState = { ...uiState, ...snapshot.meetings.uiState };
    }
  }

  if (snapshot.theme) {
    document.documentElement.setAttribute('data-theme', snapshot.theme);
    localStorage.setItem(THEME_KEY, snapshot.theme);
    syncThemeButton();
  }

  saveSources();
  savePersonas();
  renderSources();
  hydratePersonaEditor();
  renderMeetingSelector();
  hydrateMeetingEditor();
  if (typeof window.chatImportState === 'function' && snapshot.chat) {
    window.chatImportState(snapshot.chat);
  }
  for (const source of sources) connectSource(source);
}

async function importSessionSnapshot(file) {
  const text = await file.text();
  const snapshot = JSON.parse(text);
  applyImportedSession(snapshot);
}

function mountSessionToolbar() {
  const headerInner = document.querySelector('.header-inner');
  if (!headerInner) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'header-session-tools';

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.hidden = true;
  importInput.addEventListener('change', async () => {
    const [file] = Array.from(importInput.files ?? []);
    importInput.value = '';
    if (!file) return;
    try {
      await importSessionSnapshot(file);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn-secondary';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => importInput.click());

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn-secondary';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', downloadSessionSnapshot);

  toolbar.append(importBtn, exportBtn, importInput);
  headerInner.insertBefore(toolbar, document.getElementById('theme-toggle'));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  initTheme();
  mountSessionToolbar();
  loadSources();
  loadPersonas();
  syncGroupParticipantsWithPersonas();

  // ── Sources panel ─────────────────────────────────────────────────────────
  const {
    panel: sourcesPanel,
    body: sourcesBody,
    actionsLeft: sourcesActionsLeft,
    actionsRight: sourcesActionsRight,
  } = createPanel('panel-sources', 'Inference Sources');

  const btnAdd = document.createElement('button');
  btnAdd.id = 'add-source-btn';
  btnAdd.className = 'btn-add';
  btnAdd.title = 'Add inference source';
  btnAdd.textContent = '+';
  btnAdd.addEventListener('click', showModal);
  sourcesActionsRight.appendChild(btnAdd);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.title = 'Collapse source list';
  navToggle.textContent = '↔';
  navToggle.addEventListener('click', () => {
    uiState.sourcesNavCollapsed = !uiState.sourcesNavCollapsed;
    const shellEl = document.getElementById('sources-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.sourcesNavCollapsed);
  });
  sourcesActionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.id = 'sources-shell';
  shell.className = 'workspace-shell sources-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.sourcesNavCollapsed);
  const nav = document.createElement('div');
  nav.id = 'sources-nav';
  nav.className = 'workspace-nav';
  const detail = document.createElement('div');
  detail.id = 'sources-detail';
  detail.className = 'workspace-detail sources-detail';
  shell.append(nav, detail);
  sourcesBody.appendChild(shell);

  document.getElementById('panel-sources-mount').appendChild(sourcesPanel);
  renderSources();

  // ── Persona panel ─────────────────────────────────────────────────────────
  const {
    panel: personaPanel,
    body: personaBody,
    actionsLeft: personaActionsLeft,
    actionsRight: personaActionsRight,
  } = createPanel('panel-persona', 'Persona');
  document.getElementById('panel-persona-mount').appendChild(personaPanel);
  renderPersonaPanel(personaBody, personaActionsLeft, personaActionsRight);

  // ── Chat panel ────────────────────────────────────────────────────────────
  const {
    panel: chatPanel,
    body: chatBody,
    actionsLeft: chatActionsLeft,
    actionsRight: chatActionsRight,
  } = createPanel('panel-chat', 'Chat');
  document.getElementById('panel-chat-mount').appendChild(chatPanel);
  chatInit(chatBody, { actionsLeft: chatActionsLeft, actionsRight: chatActionsRight }); // defined in chat.js
  notifyPersonas();

  // ── Group chat panel ──────────────────────────────────────────────────────
  const {
    panel: groupChatPanel,
    body: groupChatBody,
    actionsLeft: groupChatActionsLeft,
    actionsRight: groupChatActionsRight,
  } = createPanel('panel-group-chat', 'Meetings');
  document.getElementById('panel-group-chat-mount').appendChild(groupChatPanel);
  renderGroupChatPanel(groupChatBody, groupChatActionsLeft, groupChatActionsRight);

  // Kick off connection attempts for all loaded sources
  for (const source of sources) {
    connectSource(source);
  }

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Modal
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-confirm').addEventListener('click', confirmModal);
  document.getElementById('source-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmModal();
    if (e.key === 'Escape') hideModal();
  });
  document.getElementById('add-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal();
  });
}

init();
