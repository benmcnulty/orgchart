// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'inference-sources';
const DEFAULT_MODEL = 'gemma4:latest';
const DEFAULT_URL = 'http://localhost:11434';

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Array<{id: string, url: string, status: string, models: string[], selectedModel: string, error: string|null, _seq: number}>} */
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
        status: 'connecting',
        models: [],
        error: null,
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
  const persist = sources.map(({ id, url, selectedModel, _seq }) => ({
    id,
    url,
    selectedModel,
    _seq,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}

// ─── Source Factory ───────────────────────────────────────────────────────────

function makeSource(url) {
  const seq = nextSeq++;
  return {
    id: `source-${seq}`,
    url: normalizeUrl(url),
    status: 'connecting',
    models: [],
    selectedModel: DEFAULT_MODEL,
    error: null,
    _seq: seq,
  };
}

function normalizeUrl(url) {
  const trimmed = url.trim().replace(/\/$/, '');
  return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
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
  sources = sources.filter(s => s.id !== id);
  saveSources();
  renderSources();
}

async function connectSource(source) {
  source.status = 'connecting';
  source.error = null;
  updateCard(source);

  try {
    const models = await fetchModels(source.url);
    source.models = models;
    source.status = 'connected';

    // Prefer DEFAULT_MODEL if available; otherwise keep existing selection if valid,
    // else fall back to first model in the list.
    if (models.includes(DEFAULT_MODEL)) {
      source.selectedModel = DEFAULT_MODEL;
    } else if (!models.includes(source.selectedModel) && models.length > 0) {
      source.selectedModel = models[0];
    }

    saveSources();
  } catch (err) {
    source.status = 'error';
    source.error = err.message;
  }

  updateCard(source);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSources() {
  const container = document.getElementById('sources-container');

  if (sources.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No inference sources configured. Press + to add one.';
    container.replaceChildren(p);
    return;
  }

  container.replaceChildren(...sources.map(buildCard));
}

/** Build a source card entirely via DOM methods — no innerHTML for user-supplied values. */
function buildCard(source) {
  const card = document.createElement('div');
  card.className = 'source-card';
  card.id = `card-${source.id}`;

  // ── Header ──
  const header = el('div', 'card-header');

  const statusGroup = el('div', 'status-group');
  const dot = el('span', `status-dot ${source.status}`);
  const statusLabel = el('span', 'status-label');
  const STATUS_LABELS = { connecting: 'Connecting…', connected: 'Connected', error: 'Error' };
  statusLabel.textContent = STATUS_LABELS[source.status] ?? source.status;
  statusGroup.append(dot, statusLabel);

  const actions = el('div', 'card-actions');
  const btnRefresh = el('button', 'btn-icon btn-refresh');
  btnRefresh.title = 'Reconnect';
  btnRefresh.textContent = '↻';
  const btnRemove = el('button', 'btn-icon btn-remove');
  btnRemove.title = 'Remove source';
  btnRemove.textContent = '×';
  actions.append(btnRefresh, btnRemove);

  header.append(statusGroup, actions);

  // ── URL ──
  const urlEl = el('div', 'card-url');
  urlEl.textContent = source.url;

  // ── Model row ──
  const modelRow = el('div', 'card-model');

  const select = document.createElement('select');
  select.className = 'model-select';
  select.disabled = source.status !== 'connected';

  const modelSet = source.models.length > 0 ? source.models : [source.selectedModel];
  for (const name of modelSet) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === source.selectedModel;
    select.appendChild(opt);
  }

  const meta = el('span', `model-count${source.status === 'error' ? ' error' : ''}`);
  if (source.status === 'error') {
    meta.textContent = source.error ?? 'Connection failed';
  } else if (source.status === 'connected') {
    meta.textContent = `${source.models.length} model${source.models.length !== 1 ? 's' : ''} available`;
  } else {
    meta.textContent = 'Fetching models…';
  }

  modelRow.append(select, meta);

  // ── Wire events ──
  btnRefresh.addEventListener('click', () => connectSource(source));
  btnRemove.addEventListener('click', () => removeSource(source.id));
  select.addEventListener('change', e => {
    source.selectedModel = e.target.value;
    saveSources();
  });

  card.append(header, urlEl, modelRow);
  return card;
}

/** Patch an existing card in-place; falls back to full re-render if card not found. */
function updateCard(source) {
  const existing = document.getElementById(`card-${source.id}`);
  if (!existing) {
    renderSources();
    return;
  }
  const updated = buildCard(source);
  existing.replaceWith(updated);
}

/** Shorthand for creating an element with a class name. */
function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function showModal() {
  const modal = document.getElementById('add-modal');
  const input = document.getElementById('source-url');
  modal.classList.remove('hidden');
  input.value = '';
  hideModalError();
  input.focus();
}

function hideModal() {
  document.getElementById('add-modal').classList.add('hidden');
}

function confirmModal() {
  const url = document.getElementById('source-url').value.trim();
  if (!url) {
    showModalError('Please enter a URL.');
    return;
  }

  const result = addSource(url);
  if (result.error) {
    showModalError(result.error);
    return;
  }

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

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  loadSources();
  renderSources();

  // Kick off connection attempts for all persisted sources
  for (const source of sources) {
    connectSource(source);
  }

  // Toolbar
  document.getElementById('add-source-btn').addEventListener('click', showModal);

  // Modal buttons and keyboard shortcuts
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
