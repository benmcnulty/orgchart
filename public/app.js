// app.js — Sources management, panel layout, theme.
// Loaded last; app globals (sources, displayLabel, defaultSource) are
// accessible to chat.js via the shared global scope.

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'inference-sources';
const THEME_KEY = 'theme-preference';
const DEFAULT_MODEL = 'gemma4:latest';
const DEFAULT_URL = 'http://localhost:11434';
const RETRY_DELAY_MS = 5000;

// ─── State ────────────────────────────────────────────────────────────────────

let sources = [];
let nextSeq = 1;

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
      }));
      nextSeq = Math.max(...sources.map(s => s._seq ?? 0)) + 1;
    }
  } catch {
    sources = [];
  }

  if (sources.length === 0) {
    sources.push(makeSource(DEFAULT_URL));
  }
}

function saveSources() {
  const persist = sources.map(({ id, url, selectedModel, label, isDefault, enabled, _seq }) => ({
    id, url, selectedModel, label, isDefault, enabled, _seq,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  notifySources();
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

// Fires the 'sources-changed' event so chat.js can refresh its selector.
function notifySources() {
  document.dispatchEvent(new CustomEvent('sources-changed', { detail: { sources } }));
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

    if (models.includes(DEFAULT_MODEL)) {
      source.selectedModel = DEFAULT_MODEL;
    } else if (!models.includes(source.selectedModel) && models.length > 0) {
      source.selectedModel = models[0];
    }

    saveSources();
  } catch (err) {
    source.status = 'error';
    source.error = err.message;

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
  toggle.className = 'panel-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', `${id}-body`);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.textContent = '▾';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'panel-title';
  titleSpan.textContent = title;

  toggle.append(chevron, titleSpan);
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('panel--collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  const actions = document.createElement('div');
  actions.className = 'panel-header-actions';

  header.append(toggle, actions);

  const body = document.createElement('div');
  body.className = 'panel-body';
  body.id = `${id}-body`;

  panel.append(header, body);
  return { panel, body, actions };
}

// ─── Card Rendering ───────────────────────────────────────────────────────────

function renderSources() {
  const container = document.getElementById('sources-container');
  if (!container) return;

  if (sources.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No inference sources configured. Press + to add one.';
    container.replaceChildren(p);
    return;
  }

  container.replaceChildren(...sources.map(buildCard));
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
  const card = document.getElementById(`card-${source.id}`);
  if (!card) { renderSources(); return; }

  card.classList.toggle('source-card--disabled', !source.enabled);

  const dot = card.querySelector('.status-dot');
  if (dot) dot.className = `status-dot ${source.status}`;

  const label = card.querySelector('.status-label');
  if (label) label.textContent = statusText(source.status);

  const btnStar = card.querySelector('.btn-star');
  if (btnStar) {
    btnStar.textContent = source.isDefault ? '★' : '☆';
    btnStar.title = source.isDefault ? 'Clear default' : 'Set as default';
    btnStar.classList.toggle('btn-star-active', source.isDefault);
  }

  const btnToggle = card.querySelector('.btn-toggle');
  if (btnToggle) {
    btnToggle.textContent = source.enabled ? '●' : '○';
    btnToggle.title = source.enabled ? 'Disable source' : 'Enable source';
    btnToggle.classList.toggle('btn-toggle-active', source.enabled);
  }

  const select = card.querySelector('.model-select');
  if (select) {
    select.disabled = source.status !== 'connected' || !source.enabled;
    const modelSet = source.models.length > 0 ? source.models : [source.selectedModel];
    const existing = Array.from(select.options).map(o => o.value);
    if (JSON.stringify(modelSet) !== JSON.stringify(existing)) {
      select.replaceChildren(...modelSet.map(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        opt.selected = name === source.selectedModel;
        return opt;
      }));
    }
  }

  const metaEl = card.querySelector('.model-count');
  if (metaEl) {
    metaEl.className = `model-count${source.status === 'error' ? ' error' : ''}`;
    metaEl.textContent = metaText(source);
  }
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

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  initTheme();
  loadSources();

  // ── Sources panel ─────────────────────────────────────────────────────────
  const { panel: sourcesPanel, body: sourcesBody, actions: sourcesActions } = createPanel('panel-sources', 'Inference Sources');

  const btnAdd = document.createElement('button');
  btnAdd.id = 'add-source-btn';
  btnAdd.className = 'btn-add';
  btnAdd.title = 'Add inference source';
  btnAdd.textContent = '+';
  btnAdd.addEventListener('click', showModal);
  sourcesActions.appendChild(btnAdd);

  const container = document.createElement('div');
  container.id = 'sources-container';
  container.className = 'sources-container';
  sourcesBody.appendChild(container);

  document.getElementById('panel-sources-mount').appendChild(sourcesPanel);
  renderSources();

  // ── Chat panel ────────────────────────────────────────────────────────────
  const { panel: chatPanel, body: chatBody } = createPanel('panel-chat', 'Chat');
  document.getElementById('panel-chat-mount').appendChild(chatPanel);
  chatInit(chatBody); // defined in chat.js

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
