// sources.js — Inference source management (state, CRUD, card rendering).
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: DEFAULT_URL, DEFAULT_MODEL, STORAGE_KEY,
// RETRY_DELAY_MS, uiState, showModal — all resolved at call time (not load time).

// ─── State ────────────────────────────────────────────────────────────────────

let sources = [];
let nextSeq = 1;
let activeSourceId = null;

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
        capacity: s.capacity ?? 'medium',
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
  const persist = sources.map(({ id, url, selectedModel, label, isDefault, enabled, capacity, _seq }) => ({
    id, url, selectedModel, label, isDefault, enabled, capacity, _seq,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  notifySources();
  setSaveIndicator('saved', 'Sources saved.');
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
    capacity: 'medium', // 'small' | 'medium' | 'large' — informs pipeline routing
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

// ─── Events ───────────────────────────────────────────────────────────────────

// Fires the 'sources-changed' event so chat.js can refresh its selector.
function notifySources() {
  document.dispatchEvent(new CustomEvent('sources-changed', { detail: { sources } }));
}

// ─── API ──────────────────────────────────────────────────────────────────────

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

  // ── Capacity selector ─────────────────────────────────────────────────────
  // Sets the hardware tier for this source; used by the pipeline to route
  // phases to the most appropriate machine.
  const capacitySelect = document.createElement('select');
  capacitySelect.className = 'capacity-select';
  capacitySelect.title = 'Inference capacity tier — routes pipeline phases to the right hardware';
  for (const [value, label] of [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = source.capacity === value;
    capacitySelect.appendChild(opt);
  }
  capacitySelect.addEventListener('change', e => {
    source.capacity = e.target.value;
    saveSources();
  });

  modelRow.append(select, meta, capacitySelect);

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

// ─── Panel Init ───────────────────────────────────────────────────────────────

/**
 * Initialises the Inference Sources panel content.
 * Called from app.js init() after createPanel() has created the panel shell.
 *
 * @param {HTMLElement} body - The panel content div
 * @param {HTMLElement} actionsLeft - Left action slot in panel header
 * @param {HTMLElement} actionsRight - Right action slot in panel header
 */
function sourcesInit(body, actionsLeft, actionsRight) {
  const btnAdd = document.createElement('button');
  btnAdd.id = 'add-source-btn';
  btnAdd.className = 'btn-add';
  btnAdd.title = 'Add inference source';
  btnAdd.textContent = '+';
  btnAdd.addEventListener('click', showModal);
  actionsRight.appendChild(btnAdd);

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
  actionsLeft.appendChild(navToggle);

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
  body.appendChild(shell);
  renderSources();
}
