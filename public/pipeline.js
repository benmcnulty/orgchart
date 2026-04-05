// pipeline.js — Multiphase Lab UI panel.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty

const PIPELINE_STORAGE_KEY = 'pipeline-projects-v2';
const PIPELINE_UI_KEY = 'pipeline-ui-v2';
const PIPELINE_FETCH_RETRY_DELAY_MS = 1500;

const BUILTIN_PHASES = [
  { type: 'optimizer', label: 'Optimizer', description: 'Rewrite the prompt for better downstream execution.' },
  { type: 'generator', label: 'Generator', description: 'Produce the main draft or first-pass answer.' },
  { type: 'critic', label: 'Critic', description: 'Review the draft and surface concrete improvements.' },
  { type: 'synthesizer', label: 'Synthesizer', description: 'Deliver the refined final answer.' },
];

const PHASE_PREFERS_LARGE = new Set(['generator', 'synthesizer']);

const MODEL_PREFERENCES = {
  large: {
    optimizer: ['gemma4:e4b', 'gemma4:4b', 'gemma4:26b', 'gemma4:latest'],
    generator: ['gemma4:31b', 'gemma4:26b', 'gemma4:latest'],
    critic: ['gemma4:e4b', 'gemma4:4b', 'gemma4:26b', 'gemma4:latest'],
    synthesizer: ['gemma4:31b', 'gemma4:26b', 'gemma4:latest'],
    custom: ['gemma4:latest', 'gemma4:26b', 'gemma4:e4b'],
  },
  medium: {
    optimizer: ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    generator: ['gemma4:26b', 'gemma4:e4b', 'gemma4:latest'],
    critic: ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    synthesizer: ['gemma4:26b', 'gemma4:e4b', 'gemma4:latest'],
    custom: ['gemma4:latest', 'gemma4:e4b', 'gemma4:26b'],
  },
  small: {
    optimizer: ['gemma4:e2b', 'gemma4:2b', 'gemma4:e4b', 'gemma4:latest'],
    generator: ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    critic: ['gemma4:e2b', 'gemma4:2b', 'gemma4:e4b', 'gemma4:latest'],
    synthesizer: ['gemma4:e4b', 'gemma4:4b', 'gemma4:latest'],
    custom: ['gemma4:latest', 'gemma4:e4b', 'gemma4:e2b'],
  },
};

let pipelineProjects = [];
let activePipelineProjectId = null;
let pipelineProjectSeq = 1;
let pipelinePhaseSeq = 1;
let pipelineRunning = false;
let pipelineRunningProjectId = null;
let pipelineAbortController = null;
let pipelinePrimerState = new Map();
let pipelineUiState = { navCollapsed: false };
let pipelineMountEl = null;
let pipelineRefs = null;

function pipelineConnectedSources() {
  return (typeof sources !== 'undefined' ? sources : []).filter(source => source.enabled && source.status === 'connected');
}

function pipelinePickSource(type, allSources = pipelineConnectedSources()) {
  if (!allSources.length) return null;
  if (PHASE_PREFERS_LARGE.has(type)) {
    return allSources.find(source => source.capacity === 'large')
      ?? allSources.find(source => source.capacity === 'medium')
      ?? allSources[0];
  }
  return allSources.find(source => source.capacity === 'small')
    ?? allSources.find(source => source.capacity === 'medium')
    ?? allSources[0];
}

function pipelineFallbackModel(type, availableModels, capacity = 'medium', currentModel = '') {
  if (!availableModels?.length) return currentModel || '';
  const prefs = MODEL_PREFERENCES[capacity]?.[type] ?? MODEL_PREFERENCES.medium[type] ?? MODEL_PREFERENCES.medium.custom;
  for (const pref of prefs) {
    const exact = availableModels.find(model => model === pref);
    if (exact) return exact;
    const prefixed = availableModels.find(model => model.startsWith(pref + '-') || model.startsWith(pref + ':'));
    if (prefixed) return prefixed;
  }
  return availableModels.find(model => model.toLowerCase().includes('gemma')) ?? availableModels[0];
}

function makePipelinePhase(type = 'custom') {
  const builtin = BUILTIN_PHASES.find(item => item.type === type);
  return {
    id: `pipeline-phase-${pipelinePhaseSeq++}`,
    type,
    label: builtin?.label ?? `Custom Phase ${pipelinePhaseSeq - 1}`,
    description: builtin?.description ?? '',
    enabled: true,
    sourceId: '',
    model: '',
    thinkingEnabled: true,
    personaId: '',
    customInstructions: '',
  };
}

function defaultPipelinePhases() {
  return BUILTIN_PHASES.map(phase => makePipelinePhase(phase.type));
}

function makePipelineProject() {
  const seq = pipelineProjectSeq++;
  return {
    id: `pipeline-project-${seq}`,
    name: `Project ${seq}`,
    input: '',
    phases: defaultPipelinePhases(),
    currentRun: null,
    phaseContext: {},
    hasUpdate: false,
  };
}

function activePipelineProject() {
  return pipelineProjects.find(project => project.id === activePipelineProjectId) ?? pipelineProjects[0] ?? null;
}

function loadPipelineState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PIPELINE_STORAGE_KEY) || 'null');
    if (saved?.projects?.length) {
      pipelineProjects = saved.projects.map(project => ({
        id: project.id,
        name: project.name ?? 'Project',
        input: project.input ?? '',
        phases: (project.phases ?? []).map(phase => ({
          id: phase.id,
          type: phase.type ?? 'custom',
          label: phase.label ?? 'Phase',
          description: phase.description ?? '',
          enabled: phase.enabled !== false,
          sourceId: phase.sourceId ?? '',
          model: phase.model ?? '',
          thinkingEnabled: phase.thinkingEnabled !== false,
          personaId: phase.personaId ?? '',
          customInstructions: phase.customInstructions ?? '',
        })),
        currentRun: project.currentRun ?? null,
        phaseContext: project.phaseContext ?? {},
        hasUpdate: false,
      }));
      pipelineProjectSeq = Math.max(0, ...pipelineProjects.map(project => Number(project.id.split('-').pop()) || 0)) + 1;
      pipelinePhaseSeq = Math.max(
        0,
        ...pipelineProjects.flatMap(project => project.phases.map(phase => Number(phase.id.split('-').pop()) || 0)),
      ) + 1;
      activePipelineProjectId = saved.activeProjectId ?? pipelineProjects[0]?.id ?? null;
    }
  } catch {
    pipelineProjects = [];
  }

  if (!pipelineProjects.length) {
    const project = makePipelineProject();
    pipelineProjects = [project];
    activePipelineProjectId = project.id;
  }

  try {
    pipelineUiState = JSON.parse(localStorage.getItem(PIPELINE_UI_KEY) || 'null') ?? pipelineUiState;
  } catch {
    pipelineUiState = { navCollapsed: false };
  }
}

function savePipelineState() {
  localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify({
    activeProjectId: activePipelineProjectId,
    projects: pipelineProjects.map(project => ({
      id: project.id,
      name: project.name,
      input: project.input,
      phases: project.phases,
      currentRun: project.currentRun,
      phaseContext: project.phaseContext,
    })),
  }));
  localStorage.setItem(PIPELINE_UI_KEY, JSON.stringify(pipelineUiState));
}

function ensurePhaseSelection(phase) {
  const connected = pipelineConnectedSources();
  if (!connected.length) return;
  let source = connected.find(item => item.id === phase.sourceId);
  if (!source) {
    source = pipelinePickSource(phase.type, connected) ?? connected[0];
    phase.sourceId = source?.id ?? '';
  }
  if (!source) return;
  if (!source.models.includes(phase.model)) {
    phase.model = pipelineFallbackModel(phase.type, source.models, source.capacity, source.selectedModel);
  }
}

function phasePersonaInstructions(phase) {
  const allPersonas = typeof personas !== 'undefined' ? personas : [];
  return allPersonas.find(persona => persona.id === phase.personaId)?.instructions ?? '';
}

function enabledProjectPhases(project) {
  return project.phases.filter(phase => phase.enabled);
}

function phaseRunDefinition(phase) {
  const source = (typeof sources !== 'undefined' ? sources : []).find(item => item.id === phase.sourceId);
  const builtin = BUILTIN_PHASES.find(item => item.type === phase.type);
  return {
    id: phase.id,
    type: phase.type,
    label: phase.label || builtin?.label || 'Phase',
    description: phase.description || builtin?.description || '',
    enabled: phase.enabled,
    sourceUrl: source?.url ?? '',
    model: phase.model || source?.selectedModel || '',
    thinkingEnabled: phase.thinkingEnabled,
    personaInstructions: phasePersonaInstructions(phase),
    customInstructions: phase.customInstructions || '',
  };
}

function phaseOutputOrder(project) {
  return enabledProjectPhases(project).map(phase => ({ id: phase.id, label: phase.label, type: phase.type }));
}

function pipelineProjectGlyph(project) {
  if (pipelineRunningProjectId === project.id) return '…';
  if (project.hasUpdate) return '🔔';
  return '◫';
}

function pipelineShortSource(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname || sourceUrl;
  } catch {
    return sourceUrl ?? 'source';
  }
}

function pipelinePreviewText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function pipelineSetStatus(message, tone = 'info', busy = false) {
  if (!pipelineRefs?.statusEl) return;
  pipelineRefs.statusEl.textContent = message;
  pipelineRefs.statusEl.className = `pipeline-run-status pipeline-run-status--${tone}`;
  pipelineRefs.statusEl.dataset.busy = busy ? 'true' : 'false';
  pipelineRefs.statusEl.hidden = !message;
}

function pipelineSyncPrimerStatus(contextMessage = '') {
  const states = [...pipelinePrimerState.values()];
  if (!states.length) {
    pipelineSetStatus(contextMessage, 'info', false);
    return;
  }
  const total = states.length;
  const complete = states.filter(state => state.status === 'complete' || state.status === 'failed').length;
  const failed = states.filter(state => state.status === 'failed').length;
  const busy = complete < total;
  const prefix = contextMessage ? `${contextMessage} ` : '';
  const suffix = failed
    ? `${complete}/${total} ready, ${failed} continuing without preload`
    : `${complete}/${total} ready`;
  pipelineSetStatus(`${prefix}Preparing selected endpoints/models… ${suffix}`.trim(), 'info', busy);
}

function createProjectButton(project) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `workspace-item${project.id === activePipelineProjectId ? ' workspace-item--active' : ''}`;
  button.dataset.status = pipelineRunningProjectId === project.id ? 'processing' : project.hasUpdate ? 'attention' : 'idle';
  button.addEventListener('click', () => {
    activePipelineProjectId = project.id;
    project.hasUpdate = false;
    savePipelineState();
    renderPipelinePanel();
  });

  const icon = document.createElement('span');
  icon.className = 'workspace-item-icon';
  icon.textContent = pipelineProjectGlyph(project);

  const copy = document.createElement('span');
  copy.className = 'workspace-item-copy';

  const title = document.createElement('span');
  title.className = 'workspace-item-title';
  title.textContent = project.name || 'Untitled Project';

  const meta = document.createElement('span');
  meta.className = 'workspace-item-meta';
  const enabledCount = enabledProjectPhases(project).length;
  meta.textContent = pipelineRunningProjectId === project.id
    ? 'Running'
    : `${enabledCount} phase${enabledCount === 1 ? '' : 's'}`;

  copy.append(title, meta);
  button.append(icon, copy);
  return button;
}

function renderPipelineNav(navEl) {
  navEl.replaceChildren(...pipelineProjects.map(createProjectButton));
}

function movePhase(project, phaseId, direction) {
  const index = project.phases.findIndex(phase => phase.id === phaseId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= project.phases.length) return;
  const [phase] = project.phases.splice(index, 1);
  project.phases.splice(nextIndex, 0, phase);
  savePipelineState();
  renderPipelinePanel();
}

function deletePhase(project, phaseId) {
  if (project.phases.length <= 1) return;
  project.phases = project.phases.filter(phase => phase.id !== phaseId);
  savePipelineState();
  renderPipelinePanel();
}

function buildPhaseEditor(project, phase, index) {
  ensurePhaseSelection(phase);
  const wrapper = document.createElement('div');
  wrapper.className = 'pipeline-phase-editor';

  const topRow = document.createElement('div');
  topRow.className = 'pipeline-phase-editor-top';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'pipeline-phase-enabled';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.checked = phase.enabled;
  enabledInput.addEventListener('change', () => {
    phase.enabled = enabledInput.checked;
    savePipelineState();
    renderPipelinePanel();
  });
  const enabledText = document.createElement('span');
  enabledText.textContent = 'On';
  enabledLabel.append(enabledInput, enabledText);

  const titleInput = document.createElement('input');
  titleInput.className = 'text-input pipeline-phase-title-input';
  titleInput.value = phase.label;
  titleInput.placeholder = 'Phase label';
  titleInput.addEventListener('input', () => {
    phase.label = titleInput.value;
    savePipelineState();
    renderPipelineNav(pipelineRefs.navEl);
  });

  const typeSelect = document.createElement('select');
  typeSelect.className = 'pipeline-config-select';
  for (const option of [...BUILTIN_PHASES, { type: 'custom', label: 'Custom' }]) {
    const el = document.createElement('option');
    el.value = option.type;
    el.textContent = option.label;
    el.selected = phase.type === option.type;
    typeSelect.appendChild(el);
  }
  typeSelect.addEventListener('change', () => {
    phase.type = typeSelect.value;
    const builtin = BUILTIN_PHASES.find(item => item.type === phase.type);
    if (builtin && !phase.customInstructions) phase.description = builtin.description;
    if (!titleInput.value.trim()) phase.label = builtin?.label ?? phase.label;
    ensurePhaseSelection(phase);
    savePipelineState();
    renderPipelinePanel();
  });

  const personaSelect = document.createElement('select');
  personaSelect.className = 'pipeline-config-select';
  const defaultPersona = document.createElement('option');
  defaultPersona.value = '';
  defaultPersona.textContent = 'No persona';
  personaSelect.appendChild(defaultPersona);
  for (const persona of (typeof personas !== 'undefined' ? personas : [])) {
    const option = document.createElement('option');
    option.value = persona.id;
    option.textContent = [persona.name, persona.title].filter(Boolean).join(' • ') || 'Untitled Persona';
    option.selected = persona.id === phase.personaId;
    personaSelect.appendChild(option);
  }
  personaSelect.addEventListener('change', () => {
    phase.personaId = personaSelect.value;
    savePipelineState();
  });

  const actionRow = document.createElement('div');
  actionRow.className = 'pipeline-phase-editor-actions';
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'btn-icon';
  upBtn.textContent = '↑';
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', () => movePhase(project, phase.id, -1));
  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'btn-icon';
  downBtn.textContent = '↓';
  downBtn.disabled = index === project.phases.length - 1;
  downBtn.addEventListener('click', () => movePhase(project, phase.id, 1));
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon btn-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove phase';
  removeBtn.addEventListener('click', () => deletePhase(project, phase.id));
  actionRow.append(upBtn, downBtn, removeBtn);

  topRow.append(enabledLabel, titleInput, typeSelect, personaSelect, actionRow);

  const configRow = document.createElement('div');
  configRow.className = 'pipeline-phase-editor-grid';

  const sourceSelect = document.createElement('select');
  sourceSelect.className = 'pipeline-config-select';
  const connected = pipelineConnectedSources();
  if (!connected.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No connected sources';
    sourceSelect.appendChild(option);
  } else {
    for (const source of connected) {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = `${displayLabel(source)} [${source.capacity ?? 'medium'}]`;
      option.selected = source.id === phase.sourceId;
      sourceSelect.appendChild(option);
    }
  }
  sourceSelect.addEventListener('change', () => {
    phase.sourceId = sourceSelect.value;
    ensurePhaseSelection(phase);
    savePipelineState();
    renderPipelinePanel();
  });

  const source = connected.find(item => item.id === phase.sourceId);
  const modelSelect = document.createElement('select');
  modelSelect.className = 'pipeline-config-select';
  const models = source?.models?.length ? source.models : [phase.model].filter(Boolean);
  if (!models.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '(no models)';
    modelSelect.appendChild(option);
  } else {
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      option.selected = model === phase.model;
      modelSelect.appendChild(option);
    }
  }
  modelSelect.addEventListener('change', () => {
    phase.model = modelSelect.value;
    savePipelineState();
  });

  const thinkingToggle = document.createElement('button');
  thinkingToggle.type = 'button';
  thinkingToggle.className = `pipeline-thinking-toggle ${phase.thinkingEnabled ? 'pipeline-thinking-toggle--on' : 'pipeline-thinking-toggle--off'}`;
  thinkingToggle.textContent = phase.thinkingEnabled ? '🧠 On' : '○ Off';
  thinkingToggle.addEventListener('click', () => {
    phase.thinkingEnabled = !phase.thinkingEnabled;
    savePipelineState();
    renderPipelinePanel();
  });

  configRow.append(
    pipelineField('Source', sourceSelect),
    pipelineField('Model', modelSelect),
    pipelineField('Thinking', thinkingToggle),
  );

  wrapper.append(topRow, configRow);

  if (phase.type === 'custom') {
    const customArea = document.createElement('textarea');
    customArea.className = 'pipeline-textarea pipeline-phase-instructions';
    customArea.rows = 4;
    customArea.placeholder = 'Describe what this custom phase should do with the current working material.';
    customArea.value = phase.customInstructions;
    customArea.addEventListener('input', () => {
      phase.customInstructions = customArea.value;
      savePipelineState();
    });
    wrapper.append(pipelineField('Custom Instructions', customArea));
  } else {
    const hint = document.createElement('p');
    hint.className = 'pipeline-phase-hint';
    hint.textContent = BUILTIN_PHASES.find(item => item.type === phase.type)?.description ?? '';
    wrapper.appendChild(hint);
  }

  return wrapper;
}

function pipelineField(label, control) {
  const field = document.createElement('label');
  field.className = 'pipeline-phase-field';
  const title = document.createElement('span');
  title.className = 'field-label';
  title.textContent = label;
  field.append(title, control);
  return field;
}

function buildPhaseOutputCard(project, phaseMeta) {
  const record = project.currentRun?.phases?.[phaseMeta.id] ?? null;
  const details = document.createElement('details');
  details.className = 'pipeline-phase-card';
  details.open = false;

  const summary = document.createElement('summary');
  summary.className = 'pipeline-phase-summary';
  const title = document.createElement('span');
  title.className = 'pipeline-phase-summary-title';
  title.textContent = phaseMeta.label;
  const status = document.createElement('span');
  status.className = `pipeline-status-badge pipeline-status-badge--${record?.status ?? 'pending'}`;
  status.textContent = record?.status ?? 'pending';
  const duration = document.createElement('span');
  duration.className = 'pipeline-duration';
  duration.textContent = record?.durationMs ? `${(record.durationMs / 1000).toFixed(1)}s` : '';
  summary.append(title, status, duration);

  const body = document.createElement('div');
  body.className = 'pipeline-phase-body';

  const thinkDetails = document.createElement('details');
  thinkDetails.className = 'thinking-details pipeline-thinking';
  thinkDetails.hidden = !record?.thinkingContent;
  thinkDetails.open = false;
  const thinkSummary = document.createElement('summary');
  thinkSummary.className = 'thinking-summary';
  thinkSummary.textContent = 'Thinking';
  const thinkPanel = document.createElement('div');
  thinkPanel.className = 'thinking-panel';
  const thinkInner = document.createElement('div');
  thinkInner.className = 'thinking-panel-inner';
  const thinkEl = document.createElement('div');
  thinkEl.className = 'thinking-content md-content';
  if (record?.thinkingContent) thinkEl.replaceChildren(renderMarkdown(record.thinkingContent));
  thinkInner.appendChild(thinkEl);
  thinkPanel.appendChild(thinkInner);
  thinkDetails.append(thinkSummary, thinkPanel);

  const output = document.createElement('div');
  output.className = 'pipeline-stream md-content';
  if (record?.strippedOutput) output.replaceChildren(renderMarkdown(record.strippedOutput));

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn-secondary pipeline-retry-btn';
  retryBtn.textContent = 'Retry from here';
  retryBtn.hidden = record?.status !== 'error';
  retryBtn.addEventListener('click', () => pipelineRetryFrom(project, phaseMeta.id));

  body.append(thinkDetails, output, retryBtn);
  details.append(summary, body);

  return { details, summary, status, duration, thinkDetails, thinkEl, output, retryBtn };
}

function renderPipelineResults(project, container) {
  container.replaceChildren();
  if (!project.currentRun) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No pipeline output yet. Configure the project and run it to see per-phase results here.';
    container.appendChild(empty);
    return { phaseRefs: new Map(), finalDetails: null, finalOutputEl: null, docsDetails: null, docsEl: null };
  }

  const phaseRefs = new Map();
  const phasesWrap = document.createElement('div');
  phasesWrap.className = 'pipeline-phases';
  for (const phaseMeta of (project.currentRun.phaseOrder ?? phaseOutputOrder(project))) {
    const refs = buildPhaseOutputCard(project, phaseMeta);
    phasesWrap.appendChild(refs.details);
    phaseRefs.set(phaseMeta.id, refs);
  }

  const finalDetails = document.createElement('details');
  finalDetails.className = 'pipeline-output-section';
  finalDetails.open = false;
  const finalSummary = document.createElement('summary');
  finalSummary.className = 'pipeline-output-header';
  finalSummary.textContent = 'Final Output';
  const finalOutputEl = document.createElement('div');
  finalOutputEl.className = 'pipeline-final-output md-content';
  finalOutputEl.replaceChildren(renderMarkdown(project.currentRun.finalOutput ?? ''));
  finalDetails.append(finalSummary, finalOutputEl);

  const docsDetails = document.createElement('details');
  docsDetails.className = 'pipeline-run-docs-details';
  docsDetails.hidden = !project.currentRun.runDocumentation;
  docsDetails.open = false;
  const docsSummary = document.createElement('summary');
  docsSummary.className = 'pipeline-run-docs-summary';
  docsSummary.textContent = 'Run Documentation';
  const docsEl = document.createElement('div');
  docsEl.className = 'pipeline-run-docs md-content';
  docsEl.replaceChildren(renderMarkdown(project.currentRun.runDocumentation ?? ''));
  docsDetails.append(docsSummary, docsEl);

  container.append(phasesWrap, finalDetails, docsDetails);
  return { phaseRefs, finalDetails, finalOutputEl, docsDetails, docsEl };
}

function renderPipelineDetail(project, detailEl) {
  detailEl.replaceChildren();
  const wrapper = document.createElement('div');
  wrapper.className = 'pipeline-project-detail';

  const nameInput = document.createElement('input');
  nameInput.className = 'text-input pipeline-project-name';
  nameInput.value = project.name;
  nameInput.placeholder = 'Project name';
  nameInput.addEventListener('input', () => {
    project.name = nameInput.value;
    savePipelineState();
    renderPipelineNav(pipelineRefs.navEl);
  });

  const inputArea = document.createElement('textarea');
  inputArea.className = 'pipeline-textarea';
  inputArea.rows = 5;
  inputArea.placeholder = 'Enter the prompt or task for this project.';
  inputArea.value = project.input;
  inputArea.addEventListener('input', () => {
    project.input = inputArea.value;
    savePipelineState();
  });

  const phasesSection = document.createElement('div');
  phasesSection.className = 'pipeline-editor-section';
  const phasesHeader = document.createElement('div');
  phasesHeader.className = 'pipeline-section-header';
  const phasesTitle = document.createElement('h3');
  phasesTitle.className = 'pipeline-section-title';
  phasesTitle.textContent = 'Phases';
  const addPhaseBtn = document.createElement('button');
  addPhaseBtn.type = 'button';
  addPhaseBtn.className = 'btn-secondary';
  addPhaseBtn.textContent = 'Add Phase';
  addPhaseBtn.addEventListener('click', () => {
    project.phases.push(makePipelinePhase('custom'));
    savePipelineState();
    renderPipelinePanel();
  });
  phasesHeader.append(phasesTitle, addPhaseBtn);
  const phaseList = document.createElement('div');
  phaseList.className = 'pipeline-phase-editor-list';
  phaseList.replaceChildren(...project.phases.map((phase, index) => buildPhaseEditor(project, phase, index)));
  phasesSection.append(phasesHeader, phaseList);

  const runRow = document.createElement('div');
  runRow.className = 'pipeline-run-row';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'btn-primary pipeline-run-btn';
  runBtn.textContent = '▶ Run Pipeline';
  runBtn.disabled = pipelineRunning;
  runBtn.addEventListener('click', () => {
    if (!pipelineRunning) pipelineStartRun(project);
  });
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn-stop';
  stopBtn.textContent = '■ Stop';
  stopBtn.hidden = !pipelineRunning || pipelineRunningProjectId !== project.id;
  stopBtn.addEventListener('click', () => pipelineAbortController?.abort());
  const statusEl = document.createElement('span');
  statusEl.className = 'pipeline-run-status';
  statusEl.hidden = true;
  runRow.append(runBtn, stopBtn, statusEl);

  const resultsSection = document.createElement('div');
  resultsSection.className = 'pipeline-results-section';
  const resultRefs = renderPipelineResults(project, resultsSection);

  wrapper.append(
    pipelineField('Project', nameInput),
    pipelineField('Prompt Input', inputArea),
    phasesSection,
    runRow,
    resultsSection,
  );

  detailEl.appendChild(wrapper);
  pipelineRefs.statusEl = statusEl;
  pipelineRefs.runBtn = runBtn;
  pipelineRefs.stopBtn = stopBtn;
  pipelineRefs.inputEl = inputArea;
  pipelineRefs.phaseRefs = resultRefs.phaseRefs;
  pipelineRefs.finalOutputEl = resultRefs.finalOutputEl;
  pipelineRefs.finalDetails = resultRefs.finalDetails;
  pipelineRefs.docsDetails = resultRefs.docsDetails;
  pipelineRefs.docsEl = resultRefs.docsEl;
}

function renderPipelinePanel() {
  if (!pipelineMountEl || !pipelineRefs) return;
  pipelineRefs.shell.classList.toggle('workspace-shell--collapsed', pipelineUiState.navCollapsed);
  renderPipelineNav(pipelineRefs.navEl);
  const project = activePipelineProject();
  if (!project) return;
  renderPipelineDetail(project, pipelineRefs.detailEl);
  pipelineSyncPrimerStatus();
}

function resetProjectRun(project) {
  project.currentRun = {
    phaseOrder: phaseOutputOrder(project),
    phases: {},
    finalOutput: '',
    runDocumentation: null,
  };
  project.phaseContext = { phaseOutputs: {} };
  pipelinePrimerState = new Map();
  savePipelineState();
}

function pipelineRetryFrom(project, fromPhaseId) {
  const enabled = enabledProjectPhases(project);
  const index = enabled.findIndex(phase => phase.id === fromPhaseId);
  if (index < 0) return;
  const phaseOutputs = {};
  for (let i = 0; i < index; i += 1) {
    const record = project.currentRun?.phases?.[enabled[i].id];
    if (record?.strippedOutput) phaseOutputs[enabled[i].id] = record.strippedOutput;
  }
  pipelineStartRun(project, { phaseOutputs });
}

function patchActivePhaseStart(phaseId, label) {
  const refs = pipelineRefs.phaseRefs?.get(phaseId);
  if (!refs) return;
  refs.details.hidden = false;
  refs.status.className = 'pipeline-status-badge pipeline-status-badge--running';
  refs.status.textContent = 'running';
  refs.summary.querySelector('.pipeline-phase-summary-title').textContent = label || refs.summary.querySelector('.pipeline-phase-summary-title').textContent;
}

function patchActivePhaseChunk(phaseId, channel, delta) {
  const refs = pipelineRefs.phaseRefs?.get(phaseId);
  if (!refs || !delta) return;
  if (channel === 'thinking') {
    refs.thinkDetails.hidden = false;
    refs.thinkEl.dataset.raw = (refs.thinkEl.dataset.raw ?? '') + delta;
    refs.thinkEl.classList.add('thinking-content--live');
    const last = refs.thinkEl.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) {
      last.textContent += delta;
    } else {
      refs.thinkEl.appendChild(document.createTextNode(delta));
    }
    return;
  }
  refs.output.dataset.raw = (refs.output.dataset.raw ?? '') + delta;
  refs.output.classList.add('pipeline-stream--live');
  const last = refs.output.lastChild;
  if (last?.nodeType === Node.TEXT_NODE) {
    last.textContent += delta;
  } else {
    refs.output.appendChild(document.createTextNode(delta));
  }
}

function patchActivePhaseComplete(phaseId, record, skipped = false) {
  const refs = pipelineRefs.phaseRefs?.get(phaseId);
  if (!refs) return;
  refs.status.className = `pipeline-status-badge pipeline-status-badge--${skipped ? 'skipped' : 'complete'}`;
  refs.status.textContent = skipped ? 'skipped' : 'complete';
  refs.duration.textContent = record.durationMs ? `${(record.durationMs / 1000).toFixed(1)}s` : '';
  refs.output.classList.remove('pipeline-stream--live');
  refs.output.replaceChildren(renderMarkdown(record.strippedOutput ?? ''));
  refs.thinkEl.classList.remove('thinking-content--live');
  if (record.thinkingContent) {
    refs.thinkDetails.hidden = false;
    refs.thinkEl.replaceChildren(renderMarkdown(record.thinkingContent));
  } else {
    refs.thinkDetails.hidden = true;
  }
  refs.retryBtn.hidden = true;
}

function patchActivePhaseError(phaseId, message) {
  const refs = pipelineRefs.phaseRefs?.get(phaseId);
  if (!refs) return;
  refs.status.className = 'pipeline-status-badge pipeline-status-badge--error';
  refs.status.textContent = 'error';
  refs.output.classList.remove('pipeline-stream--live');
  const err = document.createElement('p');
  err.className = 'message-error';
  err.textContent = `Error: ${message}`;
  refs.output.replaceChildren(err);
  refs.retryBtn.hidden = false;
}

function handlePipelineEvent(project, event) {
  const phaseId = event.phase;
  const label = event.label;
  switch (event.type) {
    case 'primer':
      pipelinePrimerState.set(event.key, {
        status: event.status,
        model: event.model,
        sourceUrl: event.sourceUrl,
      });
      pipelineSyncPrimerStatus();
      break;
    case 'phase_start':
      project.currentRun.phases[phaseId] = {
        id: phaseId,
        label,
        type: project.phases.find(phase => phase.id === phaseId)?.type ?? 'custom',
        status: 'running',
        rawOutput: '',
        strippedOutput: '',
        thinkingContent: '',
      };
      if (project.id === activePipelineProjectId) patchActivePhaseStart(phaseId, label);
      else project.hasUpdate = true;
      break;
    case 'chunk': {
      const record = project.currentRun.phases[phaseId] ??= {
        id: phaseId,
        label,
        type: project.phases.find(phase => phase.id === phaseId)?.type ?? 'custom',
        status: 'running',
        rawOutput: '',
        strippedOutput: '',
        thinkingContent: '',
      };
      if (event.channel === 'thinking') record.thinkingContent = (record.thinkingContent ?? '') + event.delta;
      else record.strippedOutput = (record.strippedOutput ?? '') + event.delta;
      if (project.id === activePipelineProjectId) patchActivePhaseChunk(phaseId, event.channel, event.delta);
      else project.hasUpdate = true;
      break;
    }
    case 'phase_complete':
      project.currentRun.phases[phaseId] = event.record;
      project.phaseContext.phaseOutputs[phaseId] = event.record.strippedOutput ?? '';
      if (project.id === activePipelineProjectId) patchActivePhaseComplete(phaseId, event.record, event.skipped);
      else project.hasUpdate = true;
      break;
    case 'phase_retry':
      pipelineSetStatus(`${label || phaseId} timed out. Re-preparing ${pipelineShortSource(event.sourceUrl)} and retrying…`, 'info', true);
      break;
    case 'pipeline_complete':
      project.currentRun = event.run;
      project.hasUpdate = project.id !== activePipelineProjectId;
      if (project.id === activePipelineProjectId) {
        if (pipelineRefs.finalOutputEl) {
          pipelineRefs.finalOutputEl.replaceChildren(renderMarkdown(event.run.finalOutput ?? ''));
        }
        if (pipelineRefs.docsDetails && pipelineRefs.docsEl) {
          pipelineRefs.docsDetails.hidden = !event.run.runDocumentation;
          pipelineRefs.docsEl.replaceChildren(renderMarkdown(event.run.runDocumentation ?? ''));
        }
      }
      pipelinePrimerState = new Map();
      pipelineSetStatus('', 'info', false);
      break;
    case 'error':
      if (phaseId) {
        project.currentRun.phases[phaseId] = {
          ...(project.currentRun.phases[phaseId] ?? {}),
          status: 'error',
          error: event.message,
        };
        if (project.id === activePipelineProjectId) patchActivePhaseError(phaseId, event.message);
      }
      pipelinePrimerState = new Map();
      pipelineSetStatus(`Phase ${label || phaseId || 'pipeline'} failed: ${event.message}`, 'error', false);
      break;
  }
  savePipelineState();
  renderPipelineNav(pipelineRefs.navEl);
}

async function* readPipelineSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!block || block.startsWith(':')) continue;
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!dataLine) continue;
        yield JSON.parse(dataLine.slice(6));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function pipelineStartRun(project, precomputedCtx = {}) {
  if (!project.input.trim()) {
    if (pipelineRefs.inputEl) pipelineRefs.inputEl.focus();
    return;
  }
  const enabledPhases = enabledProjectPhases(project).map(phaseRunDefinition).filter(phase => phase.sourceUrl && phase.model);
  if (!enabledPhases.length) {
    pipelineSetStatus('Enable at least one fully configured phase before running.', 'error', false);
    return;
  }

  pipelineRunning = true;
  pipelineRunningProjectId = project.id;
  pipelineAbortController = new AbortController();
  resetProjectRun(project);
  renderPipelinePanel();
  pipelineSetStatus('Starting pipeline…', 'info', true);

  const requestBody = JSON.stringify({
    userInput: project.input.trim(),
    phaseDefinitions: enabledPhases,
    precomputedCtx,
  });

  try {
    let seenEvents = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch('/api/pipeline/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: pipelineAbortController.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        for await (const event of readPipelineSse(response)) {
          seenEvents += 1;
          handlePipelineEvent(project, event);
        }
        break;
      } catch (err) {
        const isTransient =
          err.name !== 'AbortError' &&
          seenEvents === 0 &&
          attempt === 0 &&
          /load failed|failed to fetch|networkerror/i.test(String(err.message ?? err));
        if (isTransient) {
          pipelineSetStatus('Pipeline connection dropped during startup. Retrying once…', 'info', true);
          await new Promise(resolve => setTimeout(resolve, PIPELINE_FETCH_RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      pipelineSetStatus('Pipeline stopped.', 'info', false);
    } else {
      pipelineSetStatus(`Pipeline failed: ${err.message}`, 'error', false);
    }
  } finally {
    pipelineRunning = false;
    pipelineRunningProjectId = null;
    pipelineAbortController = null;
    renderPipelinePanel();
  }
}

function createPipelineProject() {
  const project = makePipelineProject();
  pipelineProjects.push(project);
  activePipelineProjectId = project.id;
  savePipelineState();
  renderPipelinePanel();
}

function togglePipelineNav() {
  pipelineUiState.navCollapsed = !pipelineUiState.navCollapsed;
  savePipelineState();
  renderPipelinePanel();
}

function pipelineInit(mountEl, panelActions) {
  loadPipelineState();
  pipelineMountEl = mountEl;
  mountEl.className = 'pipeline-body';

  panelActions.actionsLeft.replaceChildren();
  panelActions.actionsRight.replaceChildren();

  const navToggleBtn = document.createElement('button');
  navToggleBtn.type = 'button';
  navToggleBtn.className = 'btn-icon';
  navToggleBtn.textContent = '↔';
  navToggleBtn.title = 'Collapse or expand project sidebar';
  navToggleBtn.addEventListener('click', togglePipelineNav);

  const addProjectBtn = document.createElement('button');
  addProjectBtn.type = 'button';
  addProjectBtn.className = 'btn-icon';
  addProjectBtn.textContent = '+';
  addProjectBtn.title = 'Add project';
  addProjectBtn.addEventListener('click', createPipelineProject);

  panelActions.actionsLeft.appendChild(navToggleBtn);
  panelActions.actionsRight.appendChild(addProjectBtn);

  const shell = document.createElement('div');
  shell.className = 'workspace-shell pipeline-shell';
  const navEl = document.createElement('div');
  navEl.className = 'workspace-nav';
  const detailEl = document.createElement('div');
  detailEl.className = 'workspace-detail pipeline-workspace-detail';
  shell.append(navEl, detailEl);
  mountEl.replaceChildren(shell);

  pipelineRefs = {
    shell,
    navEl,
    detailEl,
    statusEl: null,
    runBtn: null,
    stopBtn: null,
    inputEl: null,
    phaseRefs: new Map(),
    finalOutputEl: null,
    finalDetails: null,
    docsDetails: null,
    docsEl: null,
  };

  renderPipelinePanel();
  document.addEventListener('sources-changed', () => renderPipelinePanel());
  document.addEventListener('personas-changed', () => renderPipelinePanel());
}
