// intranet-mod.js — Intranet documents and custom tools panel.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: uiState — resolved at call time.
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el

// ─── State ────────────────────────────────────────────────────────────────────

let intranet = { knowledge: [], technology: [], records: [] };
let customTools = [];
let activeIntranetSection = 'knowledge';
let activeIntranetDocKey = '';
let activeCustomToolSlug = '';

// ─── Hydration ────────────────────────────────────────────────────────────────

function hydrateIntranetFromCatalog(catalogIntranet = {}) {
  intranet = {
    knowledge: Array.isArray(catalogIntranet.knowledge) ? catalogIntranet.knowledge.map(doc => ({ ...doc })) : [],
    technology: Array.isArray(catalogIntranet.technology) ? catalogIntranet.technology.map(doc => ({ ...doc })) : [],
    records: Array.isArray(catalogIntranet.records) ? catalogIntranet.records.map(doc => ({ ...doc })) : [],
  };
  if (!intranet[activeIntranetSection]?.length) {
    activeIntranetSection = ['knowledge', 'technology', 'records'].find(section => intranet[section]?.length) || 'knowledge';
  }
  const activeDocs = intranet[activeIntranetSection] ?? [];
  activeIntranetDocKey = activeDocs.some(doc => `${doc.section}:${doc.slug}` === activeIntranetDocKey)
    ? activeIntranetDocKey
    : (activeDocs[0] ? `${activeDocs[0].section}:${activeDocs[0].slug}` : '');
}

function hydrateCustomToolsFromCatalog(catalogCustomTools = []) {
  customTools = Array.isArray(catalogCustomTools) ? catalogCustomTools.map(tool => ({ ...tool })) : [];
  activeCustomToolSlug = customTools.some(tool => tool.slug === activeCustomToolSlug) ? activeCustomToolSlug : customTools[0]?.slug ?? '';
}

// ─── Accessors ────────────────────────────────────────────────────────────────

function intranetDocs(section = activeIntranetSection) {
  return intranet[section] ?? [];
}

function activeIntranetDoc() {
  return intranetDocs().find(doc => `${doc.section}:${doc.slug}` === activeIntranetDocKey) ?? intranetDocs()[0] ?? null;
}

function activeCustomTool() {
  return customTools.find(tool => tool.slug === activeCustomToolSlug) ?? customTools[0] ?? null;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistIntranetDoc(section, doc) {
  const response = await apiJson('/api/orgchart/intranet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, ...doc }),
  });
  await bootstrapOrgChartState();
  activeIntranetSection = section;
  activeIntranetDocKey = `${section}:${response.doc.slug}`;
  setSaveIndicator('saved', `${response.doc.title} saved.`);
  return response.doc;
}

async function persistCustomTool(tool) {
  const response = await apiJson('/api/orgchart/custom-tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tool),
  });
  await bootstrapOrgChartState();
  activeIntranetSection = 'technology';
  activeCustomToolSlug = response.customTool.slug;
  activeIntranetDocKey = `technology:${response.customTool.docSlug}`;
  renderToolList();
  hydrateToolEditor();
  renderSkillToolOptions();
  setSaveIndicator('saved', `${response.customTool.name} saved.`);
  return response.customTool;
}

async function executeCustomTool(slug, input, mode = 'run') {
  return apiJson('/api/orgchart/custom-tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, input, mode }),
  });
}

async function writeOperationalRecord({ title, slug, description, content }) {
  const response = await apiJson('/api/orgchart/intranet/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, slug, description, content, kind: 'record' }),
  });
  intranet.records = [
    response.record,
    ...intranet.records.filter(doc => doc.slug !== response.record.slug),
  ];
  if (activeIntranetSection === 'records') {
    activeIntranetDocKey = `records:${response.record.slug}`;
    hydrateIntranetEditor();
  }
  return response.record;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function intranetSectionLabel(section) {
  if (section === 'knowledge') return 'Knowledge';
  if (section === 'technology') return 'Technology';
  if (section === 'records') return 'Records';
  return titleFromSlug(section);
}

function selectIntranetDoc(section, slug) {
  activeIntranetSection = section;
  activeIntranetDocKey = `${section}:${slug}`;
  hydrateIntranetEditor();
}

function renderIntranetSelectors() {
  const docSelect = document.getElementById('intranet-doc-select');
  const tabs = document.getElementById('intranet-section-tabs');
  const toolSelect = document.getElementById('intranet-custom-tool-select');
  if (!docSelect || !tabs) return;
  tabs.querySelectorAll('button[data-section]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.section === activeIntranetSection);
  });
  const docs = intranetDocs();
  docSelect.replaceChildren(...docs.map(doc => {
    const option = document.createElement('option');
    option.value = `${doc.section}:${doc.slug}`;
    option.textContent = doc.title;
    return option;
  }));
  docSelect.value = docs.some(doc => `${doc.section}:${doc.slug}` === activeIntranetDocKey)
    ? activeIntranetDocKey
    : (docs[0] ? `${docs[0].section}:${docs[0].slug}` : '');
  if (toolSelect) {
    toolSelect.replaceChildren(...customTools.map(tool => {
      const option = document.createElement('option');
      option.value = tool.slug;
      option.textContent = tool.name;
      return option;
    }));
    toolSelect.value = customTools.some(tool => tool.slug === activeCustomToolSlug) ? activeCustomToolSlug : (customTools[0]?.slug ?? '');
  }
}

function hydrateIntranetEditor() {
  const doc = activeIntranetDoc();
  const titleEl = document.getElementById('intranet-doc-title');
  const descEl = document.getElementById('intranet-doc-description');
  const contentEl = document.getElementById('intranet-doc-content');
  const saveBtn = document.getElementById('intranet-doc-save');
  const docStatus = document.getElementById('intranet-doc-status');
  const techWrap = document.getElementById('intranet-technology-workbench');
  const toolName = document.getElementById('custom-tool-name');
  const toolDesc = document.getElementById('custom-tool-description');
  const toolDocSlug = document.getElementById('custom-tool-doc-slug');
  const toolTestInput = document.getElementById('custom-tool-test-input');
  const toolReadme = document.getElementById('custom-tool-readme');
  const toolCode = document.getElementById('custom-tool-code');
  const toolStatus = document.getElementById('custom-tool-status');
  const docPickerWrap = document.getElementById('intranet-doc-picker-wrap');
  const toolPickerWrap = document.getElementById('intranet-custom-tool-picker-wrap');
  if (!titleEl || !descEl || !contentEl || !saveBtn || !docStatus || !techWrap || !docPickerWrap || !toolPickerWrap) return;
  renderIntranetSelectors();
  titleEl.value = doc?.title || '';
  descEl.value = doc?.description || '';
  contentEl.value = doc?.content || '';
  titleEl.readOnly = true;
  descEl.readOnly = true;
  contentEl.readOnly = true;
  saveBtn.hidden = true;
  docPickerWrap.hidden = (intranetDocs().length <= 1);
  docStatus.textContent = activeIntranetSection === 'records'
    ? 'System-managed operational record.'
    : activeIntranetSection === 'technology'
      ? 'Technology documentation generated and maintained through agent workflows.'
      : 'Knowledge base document maintained through agent workflows.';
  techWrap.hidden = activeIntranetSection !== 'technology';
  toolPickerWrap.hidden = activeIntranetSection !== 'technology' || customTools.length <= 1;
  if (activeIntranetSection === 'technology') {
    const tool = activeCustomTool();
    if (toolName) toolName.value = tool?.name || '';
    if (toolDesc) toolDesc.value = tool?.description || '';
    if (toolDocSlug) toolDocSlug.value = tool?.docSlug || '';
    if (toolTestInput) toolTestInput.value = tool?.testInput || '';
    if (toolReadme) toolReadme.value = tool?.readme || '';
    if (toolCode) toolCode.value = tool?.code || '';
    if (toolName) toolName.readOnly = true;
    if (toolDesc) toolDesc.readOnly = true;
    if (toolDocSlug) toolDocSlug.readOnly = true;
    if (toolReadme) toolReadme.readOnly = true;
    if (toolCode) toolCode.readOnly = true;
    if (toolStatus) toolStatus.textContent = tool ? `Registered tool: ${tool.id}` : 'No custom tools registered yet.';
  }
}

function bindIntranetEditor() {
  const docSelect = document.getElementById('intranet-doc-select');
  const toolSelect = document.getElementById('intranet-custom-tool-select');
  const testToolBtn = document.getElementById('custom-tool-test');
  const runToolBtn = document.getElementById('custom-tool-run');
  const toolTestInput = document.getElementById('custom-tool-test-input');
  const toolStatus = document.getElementById('custom-tool-status');
  document.querySelectorAll('#intranet-section-tabs button[data-section]').forEach(button => {
    button.addEventListener('click', () => {
      activeIntranetSection = button.dataset.section;
      const docs = intranetDocs(activeIntranetSection);
      activeIntranetDocKey = docs[0] ? `${docs[0].section}:${docs[0].slug}` : '';
      hydrateIntranetEditor();
    });
  });
  if (docSelect) {
    docSelect.addEventListener('change', () => {
      const [section, slug] = docSelect.value.split(':');
      selectIntranetDoc(section, slug);
    });
  }
  if (toolSelect) {
    toolSelect.addEventListener('change', () => {
      activeCustomToolSlug = toolSelect.value;
      hydrateIntranetEditor();
    });
  }
  if (testToolBtn && toolTestInput && toolStatus) {
    testToolBtn.addEventListener('click', async () => {
      const tool = activeCustomTool();
      if (!tool) return;
      toolStatus.textContent = `Testing ${tool.name}…`;
      try {
        const result = await executeCustomTool(tool.slug, toolTestInput.value || tool.testInput || '', 'test');
        toolStatus.textContent = JSON.stringify(result.result, null, 2).slice(0, 1200);
      } catch (err) {
        toolStatus.textContent = `Test failed: ${err.message}`;
      }
    });
  }
  if (runToolBtn && toolTestInput && toolStatus) {
    runToolBtn.addEventListener('click', async () => {
      const tool = activeCustomTool();
      if (!tool) return;
      toolStatus.textContent = `Running ${tool.name}…`;
      try {
        const result = await executeCustomTool(tool.slug, toolTestInput.value || tool.testInput || '', 'run');
        toolStatus.textContent = JSON.stringify(result.result, null, 2).slice(0, 1200);
      } catch (err) {
        toolStatus.textContent = `Run failed: ${err.message}`;
      }
    });
  }
}

function renderIntranetPanel(body, actionsLeft, actionsRight) {
  actionsLeft.replaceChildren();
  actionsRight.replaceChildren();

  const detail = document.createElement('div');
  detail.className = 'persona-editor intranet-view';

  const intro = document.createElement('div');
  intro.className = 'persona-intro';
  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Intranet';
  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Maintain institutional knowledge, custom tool documentation, and durable operational records on disk.';
  intro.append(heading, hint);

  const tabs = document.createElement('div');
  tabs.id = 'intranet-section-tabs';
  tabs.className = 'intranet-section-tabs';
  for (const section of ['knowledge', 'technology', 'records']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.dataset.section = section;
    button.textContent = intranetSectionLabel(section);
    tabs.appendChild(button);
  }

  const form = document.createElement('div');
  form.className = 'persona-editor-form';
  const docPickerWrap = document.createElement('div');
  docPickerWrap.className = 'persona-field';
  docPickerWrap.id = 'intranet-doc-picker-wrap';
  const docPickerLabel = document.createElement('label');
  docPickerLabel.className = 'field-label';
  docPickerLabel.htmlFor = 'intranet-doc-select';
  docPickerLabel.textContent = 'Document';
  const docPicker = document.createElement('select');
  docPicker.id = 'intranet-doc-select';
  docPicker.className = 'chat-source-select';
  docPickerWrap.append(docPickerLabel, docPicker);
  form.appendChild(docPickerWrap);
  for (const [id, labelText, isArea] of [
    ['intranet-doc-title', 'Title', false],
    ['intranet-doc-description', 'Description', true],
    ['intranet-doc-content', 'Markdown', true],
  ]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const control = isArea ? document.createElement('textarea') : document.createElement('input');
    control.id = id;
    control.className = isArea ? 'persona-textarea' : 'text-input';
    if (!isArea) control.type = 'text';
    if (id === 'intranet-doc-content') control.classList.add('persona-textarea--instructions');
    if (isArea) control.rows = id === 'intranet-doc-content' ? 12 : 3;
    field.append(label, control);
    form.appendChild(field);
  }
  const docFooter = document.createElement('div');
  docFooter.className = 'persona-actions';
  const docStatus = document.createElement('p');
  docStatus.id = 'intranet-doc-status';
  docStatus.className = 'persona-status';
  const saveDocBtn = document.createElement('button');
  saveDocBtn.type = 'button';
  saveDocBtn.id = 'intranet-doc-save';
  saveDocBtn.className = 'btn-primary';
  saveDocBtn.textContent = 'Save Document';
  saveDocBtn.hidden = true;
  docFooter.append(docStatus, saveDocBtn);
  form.appendChild(docFooter);

  const technologyWrap = document.createElement('div');
  technologyWrap.id = 'intranet-technology-workbench';
  technologyWrap.className = 'intranet-technology-workbench';
  technologyWrap.hidden = true;
  const techHeader = document.createElement('div');
  techHeader.className = 'meeting-draftboard-toolbar';
  const techHeaderTitle = document.createElement('div');
  techHeaderTitle.className = 'section-title';
  techHeaderTitle.textContent = 'Custom Tools';
  techHeader.append(techHeaderTitle);
  const toolPickerWrap = document.createElement('div');
  toolPickerWrap.className = 'persona-field';
  toolPickerWrap.id = 'intranet-custom-tool-picker-wrap';
  const toolPickerLabel = document.createElement('label');
  toolPickerLabel.className = 'field-label';
  toolPickerLabel.htmlFor = 'intranet-custom-tool-select';
  toolPickerLabel.textContent = 'Tool';
  const toolPicker = document.createElement('select');
  toolPicker.id = 'intranet-custom-tool-select';
  toolPicker.className = 'chat-source-select';
  toolPickerWrap.append(toolPickerLabel, toolPicker);
  const techDetail = document.createElement('div');
  techDetail.className = 'intranet-tool-detail';
  techDetail.appendChild(toolPickerWrap);
  for (const [id, labelText, type, rows] of [
    ['custom-tool-name', 'Tool Name', 'input', 0],
    ['custom-tool-description', 'Description', 'textarea', 3],
    ['custom-tool-doc-slug', 'Technology Doc Slug', 'input', 0],
    ['custom-tool-test-input', 'Safe Test Input', 'textarea', 3],
    ['custom-tool-readme', 'Technology Documentation', 'textarea', 8],
    ['custom-tool-code', 'JavaScript Source', 'textarea', 12],
  ]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const control = type === 'input' ? document.createElement('input') : document.createElement('textarea');
    control.id = id;
    control.className = type === 'input' ? 'text-input' : 'persona-textarea';
    if (type === 'input') control.type = 'text';
    if (type !== 'input') control.rows = rows;
    if (id === 'custom-tool-code') control.classList.add('persona-textarea--instructions');
    field.append(label, control);
    techDetail.appendChild(field);
  }
  const techFooter = document.createElement('div');
  techFooter.className = 'persona-actions';
  const techStatus = document.createElement('pre');
  techStatus.id = 'custom-tool-status';
  techStatus.className = 'tool-test-status';
  const techActions = document.createElement('div');
  techActions.className = 'persona-action-row';
  for (const [id, text, className] of [
    ['custom-tool-test', 'Test Tool', 'btn-secondary'],
    ['custom-tool-run', 'Run Tool', 'btn-secondary'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = className;
    btn.textContent = text;
    techActions.appendChild(btn);
  }
  techFooter.append(techStatus, techActions);
  techDetail.appendChild(techFooter);
  technologyWrap.append(techHeader, techDetail);

  detail.append(intro, tabs, form, technologyWrap);
  body.appendChild(detail);
  bindIntranetEditor();
  hydrateIntranetEditor();
}
