// app.js — Sources management, panel layout, theme.
// Loaded last; app globals (sources, displayLabel, defaultSource) are
// accessible to chat.js via the shared global scope.

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'inference-sources';
const PERSONA_STORAGE_KEY = 'inference-personas';
const ORG_STORAGE_KEY = 'orgchart-organizations';
const TASK_STORAGE_KEY = 'orgchart-scheduled-tasks';
const AUTOMATION_STORAGE_KEY = 'orgchart-automation-enabled';
const SESSION_EXPORT_VERSION = 1;
const THEME_KEY = 'theme-preference';
const DEFAULT_MODEL = 'gemma4:latest';
const DEFAULT_URL = 'http://localhost:11434';
const RETRY_DELAY_MS = 5000;
const Policy = globalThis.InferencePolicy;

// ─── State ────────────────────────────────────────────────────────────────────

// sources, nextSeq, activeSourceId — extracted to sources.js
// personas, nextPersonaSeq, activePersonaId, personaDraftController — extracted to agents.js
// skills, activeSkillId — extracted to skills.js
// tools, activeToolId — extracted to tools.js
// organizations, nextOrganizationSeq, activeOrganizationId, activeDepartmentId — extracted to management.js
// scheduledTasks, nextScheduledTaskSeq, activeScheduledTaskId, automationEnabled, schedulerTimer — extracted to tasks-mod.js
let notificationDrawerOpen = false;
let boardNotifications = [];
let saveIndicatorTimer = null;
// intranet, customTools, activeIntranetSection, activeIntranetDocKey, activeCustomToolSlug — extracted to intranet-mod.js
let uiState = {
  sourcesNavCollapsed: false,
  personasNavCollapsed: false,
  skillsNavCollapsed: false,
  toolsNavCollapsed: false,
  managementNavCollapsed: false,
  intranetNavCollapsed: false,
  tasksNavCollapsed: false,
  meetingsNavCollapsed: false,
  draftBoardsNavCollapsed: false,
};
// groupChat — extracted to meetings.js

// ─── Persistence ──────────────────────────────────────────────────────────────

// loadSources, saveSources — extracted to sources.js

// loadPersonas, savePersonas — extracted to agents.js

// makeDefaultOrganization, loadOrganizations, saveOrganizations — extracted to management.js

// makeScheduledTask, loadScheduledTasks, saveScheduledTasks, loadAutomationState, saveAutomationState — extracted to tasks-mod.js

// apiJson — extracted to shared.js

// toolById, toolEnabled — extracted to tools.js

// agentHasSkill, fetchAgentMemoryIndexes, fetchWebResearchContext, buildAgentResourceContext, writeAgentMemory — extracted to agents.js
// window.orgchartBuildAgentResourceContext — extracted to agents.js
// localPersonaSnapshot, hydrateAgentsFromCatalog — extracted to agents.js

// hydrateSkillsFromCatalog — extracted to skills.js
// hydrateToolsFromCatalog — extracted to tools.js

// hydrateIntranetFromCatalog, hydrateCustomToolsFromCatalog — extracted to intranet-mod.js

async function bootstrapOrgChartState() {
  const catalog = await apiJson('/api/orgchart/bootstrap');
  if ((!catalog.agents || catalog.agents.length === 0)) {
    const legacyAgents = localPersonaSnapshot();
    if (legacyAgents.length) {
      await apiJson('/api/orgchart/migrate-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: legacyAgents.map(agent => ({
            id: agent.id,
            slug: agent.slug || agent.name || agent.title || agent.id,
            name: agent.name ?? '',
            title: agent.title ?? '',
            description: agent.description ?? '',
            instructions: agent.instructions ?? '',
            skills: Array.isArray(agent.skills) ? agent.skills : [],
          })),
        }),
      });
      localStorage.removeItem(PERSONA_STORAGE_KEY);
      return bootstrapOrgChartState();
    }
  }
  hydrateAgentsFromCatalog(catalog.agents ?? []);
  hydrateSkillsFromCatalog(catalog.skills ?? []);
  hydrateToolsFromCatalog(catalog.tools ?? []);
  hydrateIntranetFromCatalog(catalog.intranet ?? {});
  hydrateCustomToolsFromCatalog(catalog.customTools ?? []);
  syncRoleAssignmentsFromAgents();
  notifyPersonas();
  notifySkills();
  notifyTools();
}

// makeSource, normalizeUrl, displayLabel, defaultSource, enabledSources,
// notifySources, fetchModels, addSource, removeSource, connectSource,
// renderSources, buildCard, patchCardStatus, statusText, metaText
// — extracted to sources.js

// clampText, navStatusGlyph, unreadBoardNotificationCount,
// setSaveIndicator, renderBoardNotifications, pushBoardNotification
// — extracted to shared.js

// notifyPersonas — extracted to agents.js

// notifySkills — extracted to skills.js
// notifyTools — extracted to tools.js

// ─── API ──────────────────────────────────────────────────────────────────────

// proxyFetch — extracted to shared.js
// fetchModels — extracted to sources.js
// addSource, removeSource, connectSource — extracted to sources.js
// renderSources, buildCard, patchCardStatus, statusText, metaText — extracted to sources.js
// createPanel, el — extracted to shared.js

// ─── Personas ────────────────────────────────────────────────────────────────

// makePersona, activePersona, ensureActivePersona, createNewPersona, selectPersona,
// persistPersona, deleteActivePersona — extracted to agents.js

// hydratePersonaEditor, renderPersonaList, renderPersonaSkillChecklist,
// populateAgentRoleOptions, bindPersonaEditor, renderPersonaPanel — extracted to agents.js

// renderSkillToolOptions, makeSkill, selectSkill, renderSkillList, hydrateSkillEditor,
// persistSkill, deleteActiveSkill, bindSkillEditor, renderSkillPanel — extracted to skills.js

function titleFromSlug(slug) {
  return String(slug ?? '')
    .split('-')
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function slugifyLabel(value, fallback = 'item') {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

async function testTool(tool, input) {
  if (tool.type === 'web_search') {
    return apiJson('/api/tools/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input || 'OrgChart distributed inference' }),
    });
  }
  if (tool.type === 'wikipedia') {
    return apiJson('/api/tools/wikipedia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input || 'Distributed systems' }),
    });
  }
  if (tool.type === 'web_scrape') {
    return apiJson('/api/tools/web-scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input || 'https://example.com' }),
    });
  }
  if (tool.type.startsWith('memory_')) {
    const agent = activePersona();
    if (!agent?.slug) throw new Error('Save an agent before testing memory tools.');
    return apiJson('/api/tools/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: tool.type === 'memory_delete' ? 'delete' : tool.type === 'memory_read' ? 'read' : 'write',
        agentSlug: agent.slug,
        scope: 'working-memory',
        fileName: 'scratch.txt',
        content: 'OrgChart memory tool test.',
      }),
    });
  }
  if (tool.type === 'custom_tool') {
    const slug = tool.config?.slug;
    if (!slug) throw new Error('Custom tool slug is missing.');
    return executeCustomTool(slug, input || tool.config?.testInput || '', 'test');
  }
  throw new Error('Unsupported tool test');
}

// renderToolList, hydrateToolEditor, persistTool, bindToolEditor, renderToolsPanel — extracted to tools.js

// intranetSectionLabel, selectIntranetDoc, renderIntranetSelectors,
// hydrateIntranetEditor, bindIntranetEditor, renderIntranetPanel — extracted to intranet-mod.js

// selectOrganization, createOrganization, renderOrganizationList, renderOrganizationRolePicker,
// generateAgentFromRole, generateOrganizationSuggestions, addDepartment, addTeam, addRole,
// hydrateManagementEditor, renderManagementPanel — extracted to management.js

// activeScheduledTask, createScheduledTask — extracted to tasks-mod.js

// renderScheduledTaskList, nextTaskDueLabel, selectedTaskMeeting, syncTaskScheduleFields,
// renderTaskActivity, runScheduledTask, taskIsDue, startTaskScheduler,
// hydrateTaskEditor, bindTaskEditor, renderTasksPanel — extracted to tasks-mod.js

// setPersonaStatus, personaDraftSource, draftPersonaInstructions — extracted to agents.js

// readNdjsonStream — extracted to meetings.js

// ─── Meetings ────────────────────────────────────────────────────────────────

// makeMeeting, ensureMeetings, activeMeeting, connectedInferenceSources, nextInferenceSource,
// savedPersonaById, workflowMessages, syncGroupParticipantsWithPersonas, meetingTimestamp,
// persistMeetingRecord, appendMeetingMessage, meetingTranscriptTail, meetingAttachmentContext,
// makeDraftBoard, activeDraftBoard, meetingDraftBoardContext, setGroupChatStatus,
// pushDebugLine, pushTokenLine, pushTokenBoundary, renderMeetingSelector, switchMeeting,
// createMeeting, renderGroupParticipantOptions, renderGroupParticipants, renderMeetingAttachments,
// readMeetingAttachment, handleMeetingAttachments, renderGroupChatMessages, renderMeetingDraftBoards,
// createMeetingDraftBoard, bindMeetingDraftBoardInputs, renderGroupChatSummary, renderGroupChatFacilitator,
// renderMeetingDebug, updateGroupChatControls, hydrateMeetingEditor, renderGroupChatPanel,
// addBoardNote, clearGroupChat, stopMeeting, stopGroupChat, groupChatRun, runMeetingTurn,
// runMeetingRetrospective, fallbackFacilitatorPlan, facilitatorContext, buildMeetingAgenda,
// buildMeetingEndConditions, indexMeetingAttachment, planNextMeetingTurn, generateMeetingParticipantMessage,
// updateMeetingSummary, updateMeetingLongMemory, draftBoardPlan, reviseDraftBoard,
// requestQueuedText, pumpInferenceQueue, startTask, runTask, runStreamRequest
// — extracted to meetings.js


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

// syncAutomationButton, setAutomationEnabled — extracted to tasks-mod.js

function exportSessionSnapshot() {
  return {
    version: SESSION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    theme: document.documentElement.getAttribute('data-theme') ?? null,
    sources: sources.map(({ id, url, selectedModel, label, isDefault, enabled, _seq }) => ({
      id, url, selectedModel, label, isDefault, enabled, _seq,
    })),
    personas: personas.map(({ id, slug, name, title, description, instructions, skills: agentSkills, _seq }) => ({
      id, slug, name, title, description, instructions, skills: agentSkills, _seq,
    })),
    skills: skills.map(({ id, slug, name, title, description, instructions, tools: skillTools }) => ({
      id, slug, name, title, description, instructions, tools: skillTools,
    })),
    tools: tools.map(({ id, name, type, description, enabled, config }) => ({
      id, name, type, description, enabled, config,
    })),
    organizations,
    scheduledTasks: {
      autoEnabled: automationEnabled,
      tasks: scheduledTasks,
    },
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

async function applyImportedSession(snapshot) {
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

  if (Array.isArray(snapshot.skills)) {
    for (const skill of snapshot.skills) {
      await apiJson('/api/orgchart/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      });
    }
  }

  if (Array.isArray(snapshot.tools)) {
    for (const tool of snapshot.tools) {
      await apiJson('/api/orgchart/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tool),
      });
    }
  }

  if (Array.isArray(snapshot.personas)) {
    for (const persona of snapshot.personas) {
      await apiJson('/api/orgchart/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persona),
      });
    }
    await bootstrapOrgChartState();
  }

  if (Array.isArray(snapshot.organizations)) {
    organizations = snapshot.organizations;
    nextOrganizationSeq = Math.max(1, ...organizations.map(org => Number(String(org.id || '').split('-').pop()) || 0)) + 1;
    activeOrganizationId = organizations[0]?.id ?? null;
  }

  if (snapshot.scheduledTasks?.tasks) {
    scheduledTasks = Array.isArray(snapshot.scheduledTasks.tasks) ? snapshot.scheduledTasks.tasks : [];
    automationEnabled = Boolean(snapshot.scheduledTasks.autoEnabled);
    nextScheduledTaskSeq = Math.max(1, ...scheduledTasks.map(task => Number(String(task.id || '').split('-').pop()) || 0)) + 1;
    activeScheduledTaskId = scheduledTasks[0]?.id ?? null;
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
  saveOrganizations();
  saveScheduledTasks();
  saveAutomationState();
  renderSources();
  hydratePersonaEditor();
  renderSkillList();
  hydrateSkillEditor();
  renderToolList();
  hydrateToolEditor();
  renderOrganizationList();
  hydrateManagementEditor();
  renderScheduledTaskList();
  hydrateTaskEditor();
  renderMeetingSelector();
  hydrateMeetingEditor();
  if (typeof window.chatImportState === 'function' && snapshot.chat) {
    window.chatImportState(snapshot.chat);
  }
  for (const source of sources) connectSource(source);
  setSaveIndicator('saved', 'Session applied.');
}

async function importSessionSnapshot(file) {
  const text = await file.text();
  const snapshot = JSON.parse(text);
  await applyImportedSession(snapshot);
}

function mountSessionToolbar() {
  const headerInner = document.querySelector('.header-inner');
  if (!headerInner) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'header-session-tools';

  const automationBtn = document.createElement('button');
  automationBtn.type = 'button';
  automationBtn.id = 'automation-toggle';
  automationBtn.className = 'header-icon-btn header-automation-btn';
  automationBtn.addEventListener('click', () => {
    setAutomationEnabled(!automationEnabled);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.id = 'save-indicator';
  saveBtn.className = 'header-icon-btn header-save-btn';
  saveBtn.dataset.state = 'idle';
  saveBtn.title = 'Save current local session state';
  saveBtn.innerHTML = '<span class="header-icon-btn__glyph">⌁</span><span id="save-indicator-label">Saved</span>';
  saveBtn.addEventListener('click', () => {
    try {
      setSaveIndicator('saving', 'Saving…');
      saveSources();
      savePersonas();
      saveOrganizations();
      saveScheduledTasks();
      saveAutomationState();
      setSaveIndicator('saved', 'Saved');
    } catch (err) {
      setSaveIndicator('error', err.message || 'Save failed');
    }
  });

  const bellBtn = document.createElement('button');
  bellBtn.type = 'button';
  bellBtn.id = 'board-notification-btn';
  bellBtn.className = 'header-icon-btn header-bell-btn';
  bellBtn.title = 'Board notifications';
  bellBtn.innerHTML = '<span class="header-icon-btn__glyph">🔔</span><span class="sr-only">Board notifications</span><span id="board-notification-count" class="header-notification-badge" hidden>0</span>';
  bellBtn.addEventListener('click', () => {
    notificationDrawerOpen = !notificationDrawerOpen;
    renderBoardNotifications();
  });

  const drawer = document.createElement('div');
  drawer.id = 'board-notification-drawer';
  drawer.className = 'board-notification-drawer';
  drawer.hidden = true;
  const drawerHead = document.createElement('div');
  drawerHead.className = 'board-notification-drawer-head';
  const drawerTitle = document.createElement('p');
  drawerTitle.className = 'section-title';
  drawerTitle.textContent = 'Board Messages';
  const drawerClear = document.createElement('button');
  drawerClear.type = 'button';
  drawerClear.className = 'btn-secondary';
  drawerClear.textContent = 'Clear Read';
  drawerClear.addEventListener('click', () => {
    boardNotifications = boardNotifications.filter(item => !item.read);
    renderBoardNotifications();
  });
  drawerHead.append(drawerTitle, drawerClear);
  const drawerEmpty = document.createElement('p');
  drawerEmpty.id = 'board-notification-empty';
  drawerEmpty.className = 'empty-state';
  drawerEmpty.textContent = 'No board notifications yet.';
  const drawerList = document.createElement('div');
  drawerList.id = 'board-notification-list';
  drawerList.className = 'board-notification-list';
  drawer.append(drawerHead, drawerEmpty, drawerList);

  toolbar.append(automationBtn, saveBtn, bellBtn, drawer);
  headerInner.insertBefore(toolbar, document.getElementById('theme-toggle'));
  renderBoardNotifications();
  setSaveIndicator('idle', 'Saved');
  syncAutomationButton();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  initTheme();
  loadAutomationState();
  mountSessionToolbar();
  loadSources();
  await bootstrapOrgChartState();
  loadOrganizations();
  loadScheduledTasks();
  syncGroupParticipantsWithPersonas();

  // ── Sources panel ─────────────────────────────────────────────────────────
  const {
    panel: sourcesPanel,
    body: sourcesBody,
    actionsLeft: sourcesActionsLeft,
    actionsRight: sourcesActionsRight,
  } = createPanel('panel-sources', 'Inference Sources');

  sourcesInit(sourcesBody, sourcesActionsLeft, sourcesActionsRight);
  document.getElementById('panel-sources-mount').appendChild(sourcesPanel);

  // ── Persona panel ─────────────────────────────────────────────────────────
  const {
    panel: personaPanel,
    body: personaBody,
    actionsLeft: personaActionsLeft,
    actionsRight: personaActionsRight,
  } = createPanel('panel-persona', 'Agents');
  document.getElementById('panel-persona-mount').appendChild(personaPanel);
  renderPersonaPanel(personaBody, personaActionsLeft, personaActionsRight);

  // ── Skills panel ──────────────────────────────────────────────────────────
  const {
    panel: skillsPanel,
    body: skillsBody,
    actionsLeft: skillsActionsLeft,
    actionsRight: skillsActionsRight,
  } = createPanel('panel-skills', 'Skills');
  document.getElementById('panel-skills-mount').appendChild(skillsPanel);
  renderSkillPanel(skillsBody, skillsActionsLeft, skillsActionsRight);

  // ── Tools panel ───────────────────────────────────────────────────────────
  const {
    panel: toolsPanel,
    body: toolsBody,
    actionsLeft: toolsActionsLeft,
  } = createPanel('panel-tools', 'Tools');
  document.getElementById('panel-tools-mount').appendChild(toolsPanel);
  renderToolsPanel(toolsBody, toolsActionsLeft);

  // ── Management panel ──────────────────────────────────────────────────────
  const {
    panel: managementPanel,
    body: managementBody,
    actionsLeft: managementActionsLeft,
    actionsRight: managementActionsRight,
  } = createPanel('panel-management', 'Management');
  document.getElementById('panel-management-mount').appendChild(managementPanel);
  renderManagementPanel(managementBody, managementActionsLeft, managementActionsRight);

  // ── Intranet panel ───────────────────────────────────────────────────────
  const {
    panel: intranetPanel,
    body: intranetBody,
    actionsLeft: intranetActionsLeft,
    actionsRight: intranetActionsRight,
  } = createPanel('panel-intranet', 'Intranet');
  document.getElementById('panel-intranet-mount').appendChild(intranetPanel);
  renderIntranetPanel(intranetBody, intranetActionsLeft, intranetActionsRight);

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

  // ── Multiphase Lab panel ──────────────────────────────────────────────────
  const {
    panel: pipelinePanel,
    body: pipelineBody,
    actionsLeft: pipelineActionsLeft,
    actionsRight: pipelineActionsRight,
  } = createPanel('panel-pipeline', 'Multiphase Lab');
  document.getElementById('panel-pipeline-mount').appendChild(pipelinePanel);
  pipelineInit(pipelineBody, { actionsLeft: pipelineActionsLeft, actionsRight: pipelineActionsRight }); // defined in pipeline.js

  // ── Tasks panel ───────────────────────────────────────────────────────────
  const {
    panel: tasksPanel,
    body: tasksBody,
    actionsLeft: tasksActionsLeft,
    actionsRight: tasksActionsRight,
  } = createPanel('panel-tasks', 'Tasks');
  document.getElementById('panel-tasks-mount').appendChild(tasksPanel);
  renderTasksPanel(tasksBody, tasksActionsLeft, tasksActionsRight);

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
  startTaskScheduler();

  // ── Presentation dashboard ────────────────────────────────────────────────
  presentationInit();

  // ── Navigation ────────────────────────────────────────────────────────────
  // mountNavigation() builds the nav rail and activates the last-used section.
  // Called after all panels are mounted so panels are already in the DOM.
  mountNavigation();
}

init().catch(err => {
  console.error('OrgChart init failed', err);
});
