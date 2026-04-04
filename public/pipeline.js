// pipeline.js — Multiphase Lab UI panel.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Depends on: markdown.js (renderMarkdown global), app.js globals
//   (sources, displayLabel) — loaded after markdown.js, before app.js.

// ─── Constants ────────────────────────────────────────────────────────────────

const PIPELINE_PHASES = ['optimizer', 'generator', 'critic', 'synthesizer'];

const PHASE_META = {
  optimizer:   { num: 1, label: 'Optimizer',   desc: 'Rewrites your input into an optimized prompt' },
  generator:   { num: 2, label: 'Generator',   desc: 'Produces primary content from the optimized prompt' },
  critic:      { num: 3, label: 'Critic',       desc: 'Multi-axis quality evaluation and revision brief' },
  synthesizer: { num: 4, label: 'Synthesizer', desc: 'Final revised output with run documentation' },
};

// Phases that prefer large-capacity sources for routing
const PHASE_PREFERS_LARGE = new Set(['generator', 'synthesizer']);

// ─── Model Selection ──────────────────────────────────────────────────────────

/**
 * Ordered model preferences per phase per capacity tier.
 *
 * Designed for the OrgChart hardware fleet:
 *   large  — M4 MacBook 32GB:        handles dense 31b models
 *   medium — HP Victus 16GB Nvidia:  targets MoE 26b and efficient e4b
 *   small  — M2 Mini 8GB:            edge models only (e2b / e4b)
 *
 * Per phase rationale:
 *   optimizer/critic — benefit from deliberate reasoning; e4b is fast + smart
 *   generator        — primary quality driver; use the biggest available model
 *   synthesizer      — revision + docs; large model quality matters most here
 */
const MODEL_PREFERENCES = {
  large: {
    optimizer:   ['gemma4:e4b', 'gemma4:4b', 'gemma4:26b', 'gemma4:latest'],
    generator:   ['gemma4:31b', 'gemma4:26b', 'gemma4:latest'],
    critic:      ['gemma4:e4b', 'gemma4:4b', 'gemma4:26b', 'gemma4:latest'],
    synthesizer: ['gemma4:31b', 'gemma4:26b', 'gemma4:latest'],
  },
  medium: {
    optimizer:   ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    generator:   ['gemma4:26b', 'gemma4:e4b', 'gemma4:latest'],
    critic:      ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    synthesizer: ['gemma4:26b', 'gemma4:e4b', 'gemma4:latest'],
  },
  small: {
    optimizer:   ['gemma4:e2b', 'gemma4:2b', 'gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    generator:   ['gemma4:e4b', 'gemma4:4b', 'gemma4:e2b', 'gemma4:latest'],
    critic:      ['gemma4:e2b', 'gemma4:2b', 'gemma4:e4b', 'gemma4:latest'],
    synthesizer: ['gemma4:e4b', 'gemma4:4b', 'gemma4:e2b', 'gemma4:latest'],
  },
};

/**
 * Picks the best available model for a phase given a source's capacity tier.
 * Tries exact match, then quantized-variant prefix match, then any Gemma model,
 * then falls back to the first available model.
 *
 * @param {string} phaseName
 * @param {string[]} availableModels - All models on a source
 * @param {'small'|'medium'|'large'} capacity - Source capacity tier
 * @returns {string}
 */
function pipelineFallbackModel(phaseName, availableModels, capacity = 'medium') {
  if (!availableModels?.length) return '';
  const prefs = MODEL_PREFERENCES[capacity]?.[phaseName] ?? MODEL_PREFERENCES.medium[phaseName] ?? [];

  for (const pref of prefs) {
    // Exact match
    const exact = availableModels.find(m => m === pref);
    if (exact) return exact;
    // Prefix match — handles quantized variants like 'gemma4:e4b-it-q4_K_M'
    const prefixed = availableModels.find(m => m.startsWith(pref + '-') || m.startsWith(pref + ':'));
    if (prefixed) return prefixed;
  }

  // Last resort: any Gemma model, then whatever's available
  return availableModels.find(m => m.toLowerCase().includes('gemma')) ?? availableModels[0] ?? '';
}

/**
 * Picks the best connected source for a phase based on capacity.
 * generator/synthesizer prefer large → medium → any.
 * optimizer/critic prefer small → medium → any.
 *
 * @param {string} phaseName
 * @param {object[]} allSources
 * @returns {object|null}
 */
function pipelinePickSource(phaseName, allSources) {
  const connected = (allSources ?? []).filter(s => s.status === 'connected' && s.enabled);
  if (!connected.length) return null;

  if (PHASE_PREFERS_LARGE.has(phaseName)) {
    return connected.find(s => s.capacity === 'large')
      ?? connected.find(s => s.capacity === 'medium')
      ?? connected[0];
  } else {
    return connected.find(s => s.capacity === 'small')
      ?? connected.find(s => s.capacity === 'medium')
      ?? connected[0];
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

let pipelineRunning = false;
let pipelineAbortController = null;

/** Accumulated phase outputs for retry-from-failure */
let pipelinePhaseCtx = {};

/** Full PipelineRun record built as events arrive */
let pipelineCurrentRun = null;

/** Per-phase DOM refs — populated by buildPhaseCards() */
const phaseRefs = {};

/** Top-level output section refs */
let pipelineFinalEl = null;
let pipelineRunDocsEl = null;
let pipelineOutputActionsEl = null;
let pipelineRunStatusEl = null;

// ─── SSE Reader ───────────────────────────────────────────────────────────────

/**
 * Async generator that parses a Server-Sent Events response stream.
 * Yields parsed JSON event objects.
 *
 * @param {Response} response
 */
async function* readPipelineSse(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += dec.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!block) continue;
        const dataLine = block.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          yield JSON.parse(dataLine.slice(6));
        } catch { /* malformed event, skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Phase Card Builders ──────────────────────────────────────────────────────

/**
 * Builds a single phase card DOM element and stores refs for live updates.
 * Cards start hidden; pipelineShowPhase() makes them visible.
 *
 * @param {string} phase
 * @returns {HTMLElement}
 */
function buildPhaseCard(phase) {
  const { num, label, desc } = PHASE_META[phase];

  const card = document.createElement('div');
  card.className = 'pipeline-phase-card';
  card.id = `pipeline-card-${phase}`;
  card.hidden = true;

  // ── Card header ───────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'pipeline-phase-header';

  const nameBadge = document.createElement('div');
  nameBadge.className = 'pipeline-phase-name';

  const numEl = document.createElement('span');
  numEl.className = 'pipeline-phase-num';
  numEl.textContent = String(num);

  const labelEl = document.createElement('span');
  labelEl.className = 'pipeline-phase-label';
  labelEl.textContent = label;

  const descEl = document.createElement('span');
  descEl.className = 'pipeline-phase-desc';
  descEl.textContent = desc;

  nameBadge.append(numEl, labelEl, descEl);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'pipeline-status-badge pipeline-status-badge--pending';
  statusBadge.textContent = 'Pending';

  const durationEl = document.createElement('span');
  durationEl.className = 'pipeline-duration';
  durationEl.hidden = true;

  const headerRight = document.createElement('div');
  headerRight.className = 'pipeline-phase-header-right';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn-secondary pipeline-retry-btn';
  retryBtn.textContent = 'Retry from here';
  retryBtn.hidden = true;
  retryBtn.addEventListener('click', () => pipelineRetryFrom(phase));

  headerRight.append(statusBadge, durationEl, retryBtn);
  header.append(nameBadge, headerRight);

  // ── Thinking section (collapsible, hidden until content arrives) ──────────
  const thinkDetails = document.createElement('details');
  thinkDetails.className = 'thinking-details pipeline-thinking';
  thinkDetails.hidden = true;
  thinkDetails.open = false;
  thinkDetails.dataset.streaming = 'false';

  const thinkSummary = document.createElement('summary');
  thinkSummary.className = 'thinking-summary';

  const thinkSummaryMain = document.createElement('span');
  thinkSummaryMain.className = 'thinking-summary-main';

  const thinkDot = document.createElement('span');
  thinkDot.className = 'thinking-status-dot';

  const thinkTitle = document.createElement('span');
  thinkTitle.className = 'thinking-title';
  thinkTitle.textContent = 'Thinking';

  const thinkMeta = document.createElement('span');
  thinkMeta.className = 'thinking-meta';
  thinkMeta.textContent = 'Hidden by default';

  thinkSummaryMain.append(thinkDot, thinkTitle, thinkMeta);

  const thinkPreview = document.createElement('span');
  thinkPreview.className = 'thinking-preview';
  thinkPreview.textContent = 'Available when the phase starts';

  thinkSummary.append(thinkSummaryMain, thinkPreview);

  const thinkPanel = document.createElement('div');
  thinkPanel.className = 'thinking-panel';

  const thinkPanelInner = document.createElement('div');
  thinkPanelInner.className = 'thinking-panel-inner';

  const thinkEl = document.createElement('div');
  thinkEl.className = 'thinking-content md-content';

  thinkPanelInner.appendChild(thinkEl);
  thinkPanel.appendChild(thinkPanelInner);
  thinkDetails.append(thinkSummary, thinkPanel);

  // ── Streaming output area ─────────────────────────────────────────────────
  const outputWrap = document.createElement('div');
  outputWrap.className = 'pipeline-phase-output';

  const streamEl = document.createElement('div');
  streamEl.className = 'pipeline-stream md-content';

  const charCountEl = document.createElement('span');
  charCountEl.className = 'pipeline-char-count';

  outputWrap.append(streamEl, charCountEl);
  card.append(header, thinkDetails, outputWrap);

  // Store refs for live updates
  phaseRefs[phase] = {
    card,
    statusBadge,
    durationEl,
    thinkDetails,
    thinkEl,
    thinkSummary,
    thinkMeta,
    thinkPreview,
    streamEl,
    charCountEl,
    retryBtn,
  };

  return card;
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

/**
 * Builds the collapsible per-phase config panel (source / model / thinking).
 * Auto-populates from connected sources using capacity-aware routing.
 *
 * @returns {{ el: HTMLElement, refresh: (sources: object[]) => void }}
 */
function buildConfigPanel() {
  const details = document.createElement('details');
  details.className = 'pipeline-config-details';

  const summary = document.createElement('summary');
  summary.className = 'pipeline-config-summary';
  summary.textContent = '⚙ Configure phases';
  details.appendChild(summary);

  const grid = document.createElement('div');
  grid.className = 'pipeline-config-grid';

  // Header row
  const hdrs = ['Phase', 'Source', 'Model', 'Thinking'];
  const hdrRow = document.createElement('div');
  hdrRow.className = 'pipeline-config-hdr-row';
  for (const h of hdrs) {
    const hEl = document.createElement('span');
    hEl.className = 'pipeline-config-hdr';
    hEl.textContent = h;
    hdrRow.appendChild(hEl);
  }
  grid.appendChild(hdrRow);

  // Phase rows
  const phaseRows = {};
  for (const phase of PIPELINE_PHASES) {
    const { num, label } = PHASE_META[phase];
    const row = document.createElement('div');
    row.className = 'pipeline-config-row';
    row.dataset.phase = phase;

    const nameEl = document.createElement('span');
    nameEl.className = 'pipeline-config-phase-name';
    nameEl.textContent = `${num}. ${label}`;

    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'pipeline-config-select';
    sourceSelect.dataset.type = 'source';

    const modelSelect = document.createElement('select');
    modelSelect.className = 'pipeline-config-select';
    modelSelect.dataset.type = 'model';

    // When source changes, repopulate the model select
    sourceSelect.addEventListener('change', () => {
      const sourceId = sourceSelect.value;
      const allSrc = typeof sources !== 'undefined' ? sources : [];
      const source = allSrc.find(s => s.id === sourceId);
      populateModelSelect(modelSelect, source?.models ?? [], phase, source?.capacity ?? 'medium', source?.selectedModel);
    });

    const thinkingToggle = document.createElement('button');
    thinkingToggle.className = 'pipeline-thinking-toggle pipeline-thinking-toggle--on';
    thinkingToggle.dataset.value = 'true';
    thinkingToggle.textContent = '🧠 On';
    thinkingToggle.addEventListener('click', () => {
      const isOn = thinkingToggle.dataset.value === 'true';
      thinkingToggle.dataset.value = isOn ? 'false' : 'true';
      thinkingToggle.textContent = isOn ? '○ Off' : '🧠 On';
      thinkingToggle.className = isOn
        ? 'pipeline-thinking-toggle pipeline-thinking-toggle--off'
        : 'pipeline-thinking-toggle pipeline-thinking-toggle--on';
    });

    row.append(nameEl, sourceSelect, modelSelect, thinkingToggle);
    grid.appendChild(row);
    phaseRows[phase] = { row, sourceSelect, modelSelect, thinkingToggle };
  }

  details.appendChild(grid);

  /**
   * Repopulates source and model selects from current source list.
   * Called on sources-changed and on init.
   */
  function refresh(allSources) {
    const connected = (allSources ?? []).filter(s => s.enabled && s.status === 'connected');

    for (const phase of PIPELINE_PHASES) {
      const { sourceSelect, modelSelect } = phaseRows[phase];
      const prevSourceId = sourceSelect.value;

      sourceSelect.replaceChildren();

      if (connected.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No sources connected';
        sourceSelect.appendChild(opt);
        modelSelect.replaceChildren();
        continue;
      }

      // Auto-pick the best source for this phase
      const autoSource = pipelinePickSource(phase, allSources);

      for (const src of connected) {
        const opt = document.createElement('option');
        opt.value = src.id;
        const lbl = typeof displayLabel === 'function' ? displayLabel(src) : src.url;
        const cap = src.capacity ?? 'medium';
        opt.textContent = `${lbl} [${cap}]`;
        sourceSelect.appendChild(opt);
      }

      // Restore previous selection if still connected, else use auto-pick
      const restore = (prevSourceId && connected.some(s => s.id === prevSourceId))
        ? prevSourceId
        : (autoSource?.id ?? connected[0]?.id ?? '');
      sourceSelect.value = restore;

      const selectedSrc = connected.find(s => s.id === restore) ?? connected[0];
      populateModelSelect(modelSelect, selectedSrc?.models ?? [], phase, selectedSrc?.capacity ?? 'medium', selectedSrc?.selectedModel);
    }
  }

  return { el: details, refresh, getPhaseRows: () => phaseRows };
}

/**
 * Populates a model select with the available models for a phase,
 * pre-selecting the capacity-appropriate default.
 */
function populateModelSelect(select, models, phase, capacity, currentModel) {
  select.replaceChildren();
  if (!models.length) {
    const opt = document.createElement('option');
    opt.value = currentModel ?? '';
    opt.textContent = currentModel ?? '(no models)';
    select.appendChild(opt);
    return;
  }

  const preferred = pipelineFallbackModel(phase, models, capacity);

  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  }

  select.value = preferred || models[0];
}

// ─── Run Config Builder ───────────────────────────────────────────────────────

/**
 * Reads the config panel UI state and builds the phaseOverrides payload
 * for the pipeline API request.
 *
 * @param {ReturnType<buildConfigPanel>['getPhaseRows']} getPhaseRows
 * @returns {Record<string, { model: string, thinkingEnabled: boolean, sourceUrl: string }>}
 */
function buildRunConfig(getPhaseRows) {
  const allSrc = typeof sources !== 'undefined' ? sources : [];
  const rows = getPhaseRows();
  const config = {};

  for (const phase of PIPELINE_PHASES) {
    const { sourceSelect, modelSelect, thinkingToggle } = rows[phase];
    const sourceId = sourceSelect.value;
    const source = allSrc.find(s => s.id === sourceId);

    config[phase] = {
      model: modelSelect.value || (source?.selectedModel ?? ''),
      thinkingEnabled: thinkingToggle.dataset.value === 'true',
      sourceUrl: source?.url ?? '',
    };
  }

  return config;
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

/**
 * Handles a single SSE event from the pipeline run stream.
 * Updates the appropriate phase card, accumulates run record.
 */
function pipelineHandleEvent(event) {
  const { type, phase } = event;
  const refs = phase ? phaseRefs[phase] : null;

  switch (type) {
    case 'phase_start': {
      if (!refs) break;
      refs.card.hidden = false;
      pipelineSetPhaseStatus(phase, 'running');
      refs.thinkDetails.dataset.streaming = 'true';
      refs.thinkMeta.textContent = 'Streaming';
      refs.thinkPreview.textContent = 'Reasoning trace is being collected';
      pipelineSetRunStatus(`Running ${PHASE_META[phase]?.label ?? phase}…`, 'info');
      // Scroll card into view smoothly
      refs.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      break;
    }

    case 'primer': {
      const label = event.model ? `${event.model}` : 'model';
      if (event.status === 'start') {
        pipelineSetRunStatus(`Priming ${label} on ${pipelineShortSource(event.sourceUrl)}…`, 'info');
      } else if (event.status === 'retry') {
        pipelineSetRunStatus(`Retrying warm-up for ${label} on ${pipelineShortSource(event.sourceUrl)}…`, 'info');
      }
      break;
    }

    case 'phase_retry': {
      if (!refs) break;
      pipelineSetRunStatus(
        `${PHASE_META[phase]?.label ?? phase} timed out. Re-priming ${pipelineShortSource(event.sourceUrl)} and retrying…`,
        'info',
      );
      refs.thinkDetails.hidden = false;
      refs.thinkDetails.dataset.streaming = 'true';
      refs.thinkMeta.textContent = `Retry ${event.attempt}`;
      break;
    }

    case 'chunk': {
      if (!refs) break;
      const { channel, delta } = event;
      if (!delta) break;

      if (channel === 'thinking') {
        refs.thinkDetails.hidden = false;
        refs.thinkDetails.dataset.streaming = 'true';
        refs.thinkMeta.textContent = 'Streaming';

        const currentThinking = refs.thinkEl.dataset.raw ?? '';
        const nextThinking = currentThinking + delta;
        refs.thinkEl.dataset.raw = nextThinking;
        refs.thinkEl.classList.add('thinking-content--live');

        const lastThinking = refs.thinkEl.lastChild;
        if (lastThinking?.nodeType === Node.TEXT_NODE) {
          lastThinking.textContent += delta;
        } else {
          refs.thinkEl.appendChild(document.createTextNode(delta));
        }

        refs.thinkPreview.textContent = pipelinePreviewText(nextThinking) || 'Reasoning trace available';
        break;
      }

      const currentText = refs.streamEl.dataset.raw ?? '';
      const nextText = currentText + delta;
      refs.streamEl.dataset.raw = nextText;
      refs.streamEl.classList.add('pipeline-stream--live');

      const last = refs.streamEl.lastChild;
      if (last?.nodeType === Node.TEXT_NODE) {
        last.textContent += delta;
      } else {
        refs.streamEl.appendChild(document.createTextNode(delta));
      }

      const charLen = nextText.length;
      refs.charCountEl.textContent = charLen > 0 ? `${charLen.toLocaleString()} chars` : '';
      break;
    }

    case 'phase_complete': {
      if (!refs) break;
      const { record, skipped } = event;

      // If this phase was skipped (retry path), mark it differently
      if (skipped) {
        pipelineSetPhaseStatus(phase, 'skipped');
        refs.streamEl.replaceChildren(renderMarkdown(record.strippedOutput ?? ''));
        refs.card.hidden = false;
        break;
      }

      pipelineSetPhaseStatus(phase, 'complete');
      refs.thinkDetails.dataset.streaming = 'false';

      // Duration badge
      if (record.durationMs != null) {
        refs.durationEl.textContent = `${(record.durationMs / 1000).toFixed(1)}s`;
        refs.durationEl.hidden = false;
      }

      // Re-render output as markdown (replaces raw streaming text nodes)
      refs.streamEl.dataset.raw = record.strippedOutput ?? '';
      refs.streamEl.classList.remove('pipeline-stream--live');
      refs.streamEl.replaceChildren(renderMarkdown(record.strippedOutput ?? ''));

      const charLen = (record.strippedOutput ?? '').length;
      refs.charCountEl.textContent = charLen > 0 ? `${charLen.toLocaleString()} chars` : '';

      // Thinking panel — render markdown if present, hide details if not
      if (record.thinkingContent) {
        refs.thinkEl.classList.remove('thinking-content--live');
        refs.thinkEl.dataset.raw = record.thinkingContent;
        refs.thinkEl.replaceChildren(renderMarkdown(record.thinkingContent));
        refs.thinkMeta.textContent = 'Available';
        refs.thinkPreview.textContent = pipelinePreviewText(record.thinkingContent) || 'Reasoning trace available';
        refs.thinkDetails.hidden = false;
        refs.thinkDetails.open = false;
      } else {
        refs.thinkEl.classList.remove('thinking-content--live');
        refs.thinkDetails.hidden = true;
      }

      // Store stripped output for retry context
      const outputKeys = { optimizer: 'optimizedPrompt', generator: 'generatedOutput', critic: 'critiqueReport' };
      if (outputKeys[phase]) {
        pipelinePhaseCtx[outputKeys[phase]] = record.strippedOutput;
      }

      break;
    }

    case 'pipeline_complete': {
      const { run } = event;
      pipelineCurrentRun = run;
      pipelineShowFinalOutput(run);
      pipelineSetRunStatus('');
      break;
    }

    case 'error': {
      if (refs) {
        pipelineSetPhaseStatus(phase, 'error');
        refs.thinkDetails.dataset.streaming = 'false';
        const errEl = document.createElement('p');
        errEl.className = 'message-error';
        errEl.textContent = `Error: ${event.message}`;
        refs.streamEl.replaceChildren(errEl);
        refs.retryBtn.hidden = false;
      }
      pipelineSetRunStatus(`Phase ${PHASE_META[phase]?.label ?? phase} failed: ${event.message}`, 'error');
      break;
    }
  }
}

function pipelinePreviewText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function pipelineShortSource(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname || sourceUrl;
  } catch {
    return sourceUrl ?? 'source';
  }
}

// ─── Phase Status Helpers ─────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending:  'Pending',
  running:  'Running…',
  complete: 'Complete',
  skipped:  'Skipped',
  error:    'Error',
};

function pipelineSetPhaseStatus(phase, status) {
  const refs = phaseRefs[phase];
  if (!refs) return;
  refs.statusBadge.className = `pipeline-status-badge pipeline-status-badge--${status}`;
  refs.statusBadge.textContent = STATUS_LABELS[status] ?? status;
}

function pipelineSetRunStatus(message, tone = 'info') {
  if (!pipelineRunStatusEl) return;
  pipelineRunStatusEl.textContent = message;
  pipelineRunStatusEl.className = `pipeline-run-status pipeline-run-status--${tone}`;
  pipelineRunStatusEl.hidden = !message;
}

// ─── Final Output ─────────────────────────────────────────────────────────────

function pipelineShowFinalOutput(run) {
  if (!pipelineFinalEl || !run) return;

  pipelineFinalEl.replaceChildren(renderMarkdown(run.finalOutput ?? ''));

  if (run.runDocumentation && pipelineRunDocsEl) {
    pipelineRunDocsEl.replaceChildren(renderMarkdown(run.runDocumentation));
    const docsDetails = pipelineRunDocsEl.closest('details');
    if (docsDetails) docsDetails.hidden = false;
  }

  if (pipelineOutputActionsEl) pipelineOutputActionsEl.hidden = false;
}

// ─── Retry From Phase ─────────────────────────────────────────────────────────

function pipelineRetryFrom(fromPhase) {
  // Determine which precomputed context to pass
  // (everything computed before the failed phase)
  const contextUpTo = {};
  const outputKeysByPhase = {
    optimizer: 'optimizedPrompt',
    generator: 'generatedOutput',
    critic:    'critiqueReport',
  };

  for (const phase of PIPELINE_PHASES) {
    if (phase === fromPhase) break;
    const key = outputKeysByPhase[phase];
    if (key && pipelinePhaseCtx[key]) {
      contextUpTo[key] = pipelinePhaseCtx[key];
    }
  }

  // Kick off run with precomputed context
  pipelineStartRun(contextUpTo);
}

// ─── Run Pipeline ─────────────────────────────────────────────────────────────

/**
 * Starts a pipeline run. If precomputedCtx is provided, earlier phases are
 * skipped (retry-from-failure path). Otherwise all four phases run fresh.
 *
 * @param {object} precomputedCtx
 */
async function pipelineStartRun(precomputedCtx = {}) {
  const textarea = document.getElementById('pipeline-textarea');
  const runBtn = document.getElementById('pipeline-run-btn');
  const stopBtn = document.getElementById('pipeline-stop-btn');

  const userInput = textarea?.value.trim() ?? '';
  if (!userInput) {
    textarea?.focus();
    return;
  }

  // Validate at least one source is connected
  const allSrc = typeof sources !== 'undefined' ? sources : [];
  const anyConnected = allSrc.some(s => s.status === 'connected' && s.enabled);
  if (!anyConnected) {
    pipelineSetRunStatus('Connect at least one Ollama source before running.', 'error');
    return;
  }

  // Reset state
  pipelineRunning = true;
  pipelineCurrentRun = null;
  if (Object.keys(precomputedCtx).length === 0) {
    // Full fresh run — clear all refs and hide cards
    pipelinePhaseCtx = {};
    for (const phase of PIPELINE_PHASES) {
      const refs = phaseRefs[phase];
      if (!refs) continue;
      refs.card.hidden = true;
      refs.statusBadge.className = 'pipeline-status-badge pipeline-status-badge--pending';
      refs.statusBadge.textContent = 'Pending';
      refs.streamEl.replaceChildren();
      refs.streamEl.dataset.raw = '';
      refs.streamEl.classList.remove('pipeline-stream--live');
      refs.charCountEl.textContent = '';
      refs.durationEl.hidden = true;
      refs.thinkDetails.hidden = true;
      refs.thinkDetails.open = false;
      refs.thinkDetails.dataset.streaming = 'false';
      refs.thinkEl.replaceChildren();
      refs.thinkEl.dataset.raw = '';
      refs.thinkEl.classList.remove('thinking-content--live');
      refs.thinkMeta.textContent = 'Hidden by default';
      refs.thinkPreview.textContent = 'Available when the phase starts';
      refs.retryBtn.hidden = true;
    }
    if (pipelineFinalEl) pipelineFinalEl.replaceChildren();
    if (pipelineRunDocsEl) pipelineRunDocsEl.replaceChildren();
    if (pipelineOutputActionsEl) pipelineOutputActionsEl.hidden = true;
    const docsDetails = pipelineRunDocsEl?.closest('details');
    if (docsDetails) docsDetails.hidden = true;
  }

  if (runBtn) runBtn.disabled = true;
  if (stopBtn) stopBtn.hidden = false;

  pipelineSetRunStatus('Pipeline running…', 'info');
  pipelineAbortController = new AbortController();

  try {
    const phaseOverrides = pipelineRunConfigRef ? buildRunConfig(pipelineRunConfigRef) : {};

    const response = await fetch('/api/pipeline/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userInput, phaseOverrides, precomputedCtx }),
      signal: pipelineAbortController.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }

    for await (const event of readPipelineSse(response)) {
      pipelineHandleEvent(event);
    }

  } catch (err) {
    if (err.name !== 'AbortError') {
      pipelineSetRunStatus(`Pipeline failed: ${err.message}`, 'error');
    } else {
      pipelineSetRunStatus('Pipeline stopped.', 'info');
    }
  } finally {
    pipelineRunning = false;
    pipelineAbortController = null;
    if (runBtn) runBtn.disabled = false;
    if (stopBtn) stopBtn.hidden = true;
  }
}

// ─── Export / Copy ────────────────────────────────────────────────────────────

function pipelineExportJson() {
  if (!pipelineCurrentRun) return;
  const blob = new Blob([JSON.stringify(pipelineCurrentRun, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orgchart-run-${pipelineCurrentRun.id?.slice(0, 8) ?? 'export'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function pipelineCopyFinalOutput() {
  if (!pipelineCurrentRun?.finalOutput) return;
  try {
    await navigator.clipboard.writeText(pipelineCurrentRun.finalOutput);
  } catch {
    // Clipboard API unavailable — silently ignore (user can copy manually)
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Stored so buildRunConfig() can read phase rows from outside pipelineInit
let pipelineRunConfigRef = null;

/**
 * Initialises the Multiphase Lab panel.
 * Follows the same signature as chatInit().
 *
 * @param {HTMLElement} mountEl - The panel content div (panel-content)
 * @param {{ actionsLeft: HTMLElement, actionsRight: HTMLElement }} panelActions
 */
function pipelineInit(mountEl, panelActions) {
  mountEl.className = 'pipeline-body';

  // ── Input area ────────────────────────────────────────────────────────────
  const inputSection = document.createElement('div');
  inputSection.className = 'pipeline-input-section';

  const inputLabel = document.createElement('label');
  inputLabel.className = 'field-label';
  inputLabel.htmlFor = 'pipeline-textarea';
  inputLabel.textContent = 'Prompt Input';

  const textarea = document.createElement('textarea');
  textarea.id = 'pipeline-textarea';
  textarea.className = 'pipeline-textarea';
  textarea.rows = 5;
  textarea.placeholder = 'Enter your raw prompt or task description. The pipeline will optimize, generate, critique, and synthesize it through four sequential agent phases.';

  const runRow = document.createElement('div');
  runRow.className = 'pipeline-run-row';

  const runBtn = document.createElement('button');
  runBtn.id = 'pipeline-run-btn';
  runBtn.className = 'btn-primary pipeline-run-btn';
  runBtn.textContent = '▶ Run Pipeline';
  runBtn.addEventListener('click', () => { if (!pipelineRunning) pipelineStartRun(); });

  const stopBtn = document.createElement('button');
  stopBtn.id = 'pipeline-stop-btn';
  stopBtn.className = 'btn-stop hidden';
  stopBtn.textContent = '■ Stop';
  stopBtn.hidden = true;
  stopBtn.addEventListener('click', () => { if (pipelineAbortController) pipelineAbortController.abort(); });

  const runStatus = document.createElement('span');
  runStatus.id = 'pipeline-run-status';
  runStatus.className = 'pipeline-run-status';
  runStatus.hidden = true;
  pipelineRunStatusEl = runStatus;

  runRow.append(runBtn, stopBtn, runStatus);

  // ── Config panel ──────────────────────────────────────────────────────────
  const { el: configEl, refresh: configRefresh, getPhaseRows } = buildConfigPanel();
  pipelineRunConfigRef = getPhaseRows;

  inputSection.append(inputLabel, textarea, configEl, runRow);

  // ── Phase cards ───────────────────────────────────────────────────────────
  const phaseSection = document.createElement('div');
  phaseSection.className = 'pipeline-phases';
  phaseSection.id = 'pipeline-phases';

  for (const phase of PIPELINE_PHASES) {
    const card = buildPhaseCard(phase);
    phaseSection.appendChild(card);
  }

  // ── Final output section ──────────────────────────────────────────────────
  const outputSection = document.createElement('div');
  outputSection.className = 'pipeline-output-section';
  outputSection.id = 'pipeline-output';

  const outputHeader = document.createElement('div');
  outputHeader.className = 'pipeline-output-header';

  const outputTitle = document.createElement('h3');
  outputTitle.className = 'pipeline-output-title';
  outputTitle.textContent = 'Final Output';

  outputHeader.appendChild(outputTitle);

  const finalOutput = document.createElement('div');
  finalOutput.className = 'pipeline-final-output md-content';
  finalOutput.id = 'pipeline-final-output';
  pipelineFinalEl = finalOutput;

  // Run Documentation (collapsible)
  const docsDetails = document.createElement('details');
  docsDetails.className = 'pipeline-run-docs-details';
  docsDetails.hidden = true;

  const docsSummary = document.createElement('summary');
  docsSummary.className = 'pipeline-run-docs-summary';
  docsSummary.textContent = '📋 Run Documentation';

  const runDocs = document.createElement('div');
  runDocs.className = 'pipeline-run-docs md-content';
  pipelineRunDocsEl = runDocs;

  docsDetails.append(docsSummary, runDocs);

  // Output action buttons
  const outputActions = document.createElement('div');
  outputActions.className = 'pipeline-output-actions';
  outputActions.hidden = true;
  pipelineOutputActionsEl = outputActions;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-secondary';
  copyBtn.textContent = 'Copy Final Output';
  copyBtn.addEventListener('click', pipelineCopyFinalOutput);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-secondary';
  exportBtn.textContent = 'Export Run JSON';
  exportBtn.addEventListener('click', pipelineExportJson);

  const runAgainBtn = document.createElement('button');
  runAgainBtn.className = 'btn-primary';
  runAgainBtn.textContent = 'Run Again';
  runAgainBtn.addEventListener('click', () => { if (!pipelineRunning) pipelineStartRun(); });

  outputActions.append(copyBtn, exportBtn, runAgainBtn);
  outputSection.append(outputHeader, finalOutput, docsDetails, outputActions);

  mountEl.append(inputSection, phaseSection, outputSection);

  // ── Sources-changed listener ───────────────────────────────────────────────
  document.addEventListener('sources-changed', e => {
    configRefresh(e.detail.sources);
  });

  // Initial population from already-loaded sources
  configRefresh(typeof sources !== 'undefined' ? sources : []);
}
