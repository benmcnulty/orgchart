// meetings.js — Group chat, meetings, facilitator, draft boards, inference queue.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: DEFAULT_MODEL, RETRY_DELAY_MS, uiState, Policy
//   — resolved at call time (not load time).
// References functions from shared.js: apiJson, proxyFetch, setSaveIndicator, navStatusGlyph, el, renderMarkdown, clampText
// References functions from sources.js: sources, defaultSource, enabledSources (global scope)
// References functions from agents.js: personas, activePersona, buildAgentResourceContext, writeAgentMemory, agentHasSkill (global scope)
// References functions from skills.js: skills (global scope)
// References functions from tools.js: tools, toolEnabled (global scope)
// References functions from management.js: allOrganizationRoles, findRoleById, roleLabel (global scope)
// References functions from tasks-mod.js: scheduledTasks (global scope)

// ─── State ────────────────────────────────────────────────────────────────────

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

// ─── NDJSON stream helper ─────────────────────────────────────────────────────

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
    status: 'idle',
    agenda: '',
    endConditions: '',
    summary: '',
    shortMemory: '',
    longMemory: '',
    retrospective: '',
    turnCount: 0,
    maxTurns: 8,
    completedAt: '',
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

// activeOrganization, activeDepartment, findRoleById, allOrganizationRoles,
// roleLabel, agentsForRole, departmentAssignedAgents, teamAssignedAgents,
// refreshRoleDependentViews, syncRoleAssignmentsFromAgents — extracted to management.js


// skillById, activeSkill — extracted to skills.js
// activeTool — extracted to tools.js

// intranetDocs, activeIntranetDoc, activeCustomTool, persistIntranetDoc,
// persistCustomTool, executeCustomTool, writeOperationalRecord — extracted to intranet-mod.js


// personaInstructions — extracted to agents.js

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

async function persistMeetingRecord(meeting) {
  return writeOperationalRecord({
    slug: `meeting-${slugifyLabel(meeting.title || meeting.id, 'meeting')}-${meeting.id}`,
    title: `${meeting.title} Transcript`,
    description: meeting.topic || 'Meeting transcript and artifacts.',
    content: [
      `# ${meeting.title}`,
      '',
      `## Topic`,
      meeting.topic || '(none)',
      '',
      `## Agenda`,
      meeting.agenda || '(none)',
      '',
      `## Summary`,
      meeting.summary || '(none)',
      '',
      `## Retrospective`,
      meeting.retrospective || '(none)',
      '',
      `## Transcript`,
      meeting.messages.map(message => `- [${message.timestampLabel}] ${message.speaker}: ${message.content}`).join('\n') || '(none)',
      '',
      `## Draft Boards`,
      meeting.draftBoards.map(board => `### ${board.name}\n\n${board.content || board.plan || '(blank)'}`).join('\n\n') || '(none)',
    ].join('\n'),
  });
}

// persistTaskRunRecord — extracted to tasks-mod.js

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
  void persistMeetingRecord(meeting).catch(err => console.warn('Failed to persist meeting record:', err.message));
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
  const deptSelect = document.getElementById('meeting-department-select');
  const teamSelect = document.getElementById('meeting-team-select');
  if (!select) return;

  const meeting = activeMeeting();
  const previous = select.value;
  select.replaceChildren();

  const available = personas.filter(persona => !meeting.participants.includes(persona.id));
  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = personas.length === 0 ? 'Save agents to add participants' : 'All saved agents added';
    select.appendChild(opt);
    return;
  }

  for (const persona of available) {
    const opt = document.createElement('option');
    opt.value = persona.id;
    opt.textContent = `${persona.name.trim() || 'Untitled Agent'}${persona.title.trim() ? ` • ${persona.title.trim()}` : ''}`;
    select.appendChild(opt);
  }

  select.value = available.some(persona => persona.id === previous) ? previous : available[0].id;

  if (deptSelect) {
    deptSelect.replaceChildren();
    const defaultDept = document.createElement('option');
    defaultDept.value = '';
    defaultDept.textContent = 'Select department';
    deptSelect.appendChild(defaultDept);
    for (const organization of organizations) {
      for (const department of organization.departments ?? []) {
        const option = document.createElement('option');
        option.value = `${organization.id}::${department.id}`;
        option.textContent = `${organization.name} • ${department.name}`;
        deptSelect.appendChild(option);
      }
    }
  }

  if (teamSelect) {
    teamSelect.replaceChildren();
    const defaultTeam = document.createElement('option');
    defaultTeam.value = '';
    defaultTeam.textContent = 'Select team';
    teamSelect.appendChild(defaultTeam);
    for (const organization of organizations) {
      for (const department of organization.departments ?? []) {
        for (const team of department.teams ?? []) {
          const option = document.createElement('option');
          option.value = `${organization.id}::${team.id}`;
          option.textContent = `${organization.name} • ${department.name} • ${team.name}`;
          teamSelect.appendChild(option);
        }
      }
    }
  }
}

function renderGroupParticipants() {
  const wrap = document.getElementById('meeting-participants');
  if (!wrap) return;

  const meeting = activeMeeting();
  if (meeting.participants.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'group-participants-empty';
    empty.textContent = 'Add saved agents to this meeting.';
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
    label.textContent = persona?.name?.trim() || 'Untitled Agent';

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
  const endEl = document.getElementById('meeting-end-conditions');
  const summaryEl = document.getElementById('meeting-summary');
  const memoryEl = document.getElementById('meeting-memory');
  const meeting = activeMeeting();

  if (agendaEl) agendaEl.value = meeting.agenda || '';
  if (endEl) endEl.value = meeting.endConditions || '';
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
  const autoInput = document.getElementById('meeting-auto');

  if (addBtn) addBtn.disabled = !select?.value;
  if (startBtn) startBtn.disabled = !(meeting.participants.length > 0 && meeting.topic.trim()) || meeting.busy;
  if (stopBtn) stopBtn.disabled = !meeting.busy;
  if (noteBtn) noteBtn.disabled = !(meeting.boardDraft?.trim());
  if (autoInput) autoInput.disabled = !automationEnabled;
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
  if (autoEl) {
    autoEl.checked = meeting.auto;
    autoEl.disabled = !automationEnabled;
  }
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
  const participantGroupRow = document.createElement('div');
  participantGroupRow.className = 'group-participant-add-row';
  const departmentSelect = document.createElement('select');
  departmentSelect.id = 'meeting-department-select';
  departmentSelect.className = 'chat-source-select';
  const addDepartmentBtn = document.createElement('button');
  addDepartmentBtn.type = 'button';
  addDepartmentBtn.className = 'btn-secondary';
  addDepartmentBtn.textContent = 'Add Department';
  addDepartmentBtn.addEventListener('click', () => {
    const meeting = activeMeeting();
    if (!departmentSelect.value) return;
    const [organizationId, departmentId] = departmentSelect.value.split('::');
    const ids = departmentAssignedAgents(organizationId, departmentId).map(agent => agent.id);
    meeting.participants = Array.from(new Set([...meeting.participants, ...ids]));
    renderGroupParticipantOptions();
    renderGroupParticipants();
  });
  const teamSelect = document.createElement('select');
  teamSelect.id = 'meeting-team-select';
  teamSelect.className = 'chat-source-select';
  const addTeamBtn = document.createElement('button');
  addTeamBtn.type = 'button';
  addTeamBtn.className = 'btn-secondary';
  addTeamBtn.textContent = 'Add Team';
  addTeamBtn.addEventListener('click', () => {
    const meeting = activeMeeting();
    if (!teamSelect.value) return;
    const [organizationId, teamId] = teamSelect.value.split('::');
    const ids = teamAssignedAgents(organizationId, teamId).map(agent => agent.id);
    meeting.participants = Array.from(new Set([...meeting.participants, ...ids]));
    renderGroupParticipantOptions();
    renderGroupParticipants();
  });
  participantGroupRow.append(departmentSelect, addDepartmentBtn, teamSelect, addTeamBtn);
  const participantWrap = document.createElement('div');
  participantWrap.id = 'meeting-participants';
  participantWrap.className = 'group-participants';
  participantField.append(participantLabel, participantRow, participantGroupRow, participantWrap);

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
  boardArea.placeholder = 'Send a concise message from the board for the facilitator to interpret at the next available step.';
  boardArea.addEventListener('input', () => {
    const meeting = activeMeeting();
    meeting.boardDraft = boardArea.value;
    updateGroupChatControls();
  });
  const boardBtn = document.createElement('button');
  boardBtn.type = 'button';
  boardBtn.id = 'meeting-board-add';
  boardBtn.className = 'btn-secondary';
  boardBtn.textContent = 'Send to Meeting';
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

  const endField = document.createElement('div');
  endField.className = 'group-chat-field';
  const endLabel = document.createElement('label');
  endLabel.className = 'field-label';
  endLabel.htmlFor = 'meeting-end-conditions';
  endLabel.textContent = 'End Conditions';
  const endArea = document.createElement('textarea');
  endArea.id = 'meeting-end-conditions';
  endArea.className = 'persona-textarea meeting-summary-box';
  endArea.readOnly = true;
  endArea.placeholder = 'Facilitator-defined completion conditions.';
  endField.append(endLabel, endArea);

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

  summaryGrid.append(agendaField, endField, summaryField, memoryField);

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
    if (!automationEnabled) {
      autoInput.checked = false;
      return;
    }
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
  meeting.endConditions = '';
  meeting.summary = '';
  meeting.shortMemory = '';
  meeting.longMemory = '';
  meeting.retrospective = '';
  meeting.turnCount = 0;
  meeting.status = 'idle';
  meeting.completedAt = '';
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
  if (meeting.auto && !automationEnabled) {
    setGroupChatStatus('Automation is paused at the application level.', 'error');
    return;
  }

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
  meeting.status = 'running';
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
    if (!meeting.endConditions.trim()) {
      meeting.endConditions = await buildMeetingEndConditions(meeting, meeting.controller.signal);
      renderGroupChatSummary();
    }

    do {
      await runMeetingTurn(meeting, meeting.controller.signal);
    } while (meeting.auto && automationEnabled && !meeting.controller.signal.aborted && meeting.status !== 'complete');
  } catch (err) {
    if (err.name !== 'AbortError') {
      setGroupChatStatus(`Meeting failed: ${err.message}`, 'error');
      pushBoardNotification({
        title: `${meeting.title} failed`,
        message: err.message,
        source: 'facilitator',
      });
    }
  } finally {
    meeting.busy = false;
    meeting.controller = null;
    renderMeetingSelector();
    updateGroupChatControls();
    if (meeting.status === 'complete') {
      setGroupChatStatus('Meeting complete.', 'success');
      pushBoardNotification({
        title: `${meeting.title} complete`,
        message: clampText(meeting.summary || meeting.retrospective || 'The facilitator marked the meeting complete.', 220),
        source: 'facilitator',
      });
    } else if (!meeting.auto) {
      setGroupChatStatus('Ready for the next turn.', 'muted');
    }
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
  if (plan.status === 'complete') {
    meeting.status = 'complete';
    meeting.completedAt = new Date().toISOString();
    meeting.retrospective = await runMeetingRetrospective(meeting, signal);
    await persistMeetingRecord(meeting).catch(err => console.warn('Failed to persist meeting record:', err.message));
    renderGroupChatSummary();
    renderGroupChatFacilitator();
    return;
  }

  const participant = savedPersonaById(plan.participantId);
  if (!participant) throw new Error('Selected participant is no longer available.');

  setGroupChatStatus(`Generating ${participant.name || 'participant'}…`, 'muted');
  const responseText = await generateMeetingParticipantMessage(meeting, participant, plan.prompt, signal);
  if (!responseText.trim()) throw new Error('Participant response was empty.');
  meeting.turnCount += 1;

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
  if (nextPlan?.status === 'complete' || meeting.turnCount >= meeting.maxTurns) {
    meeting.facilitator = { ...(nextPlan || {}), status: 'complete', participantName: 'Facilitator', prompt: 'Meeting complete. Run retrospective and close.' };
    meeting.status = 'completing';
  }
  renderGroupChatSummary();
  renderGroupChatFacilitator();
}

async function runMeetingRetrospective(meeting, signal) {
  const participants = meeting.participants.map(savedPersonaById).filter(Boolean);
  if (!participants.length) return '';
  const results = await Promise.all(participants.map(async persona => {
    const reflection = await requestQueuedText({
      meetingId: meeting.id,
      purpose: `Retrospective: ${persona.name || persona.title || 'Participant'}`,
      mode: 'parallel',
      workflow: 'meeting_retrospective',
      useCritic: true,
      validationHint: 'Return only the distilled learnings and actions in under 120 words.',
      messages: workflowMessages({
        sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
        workflow: 'meeting_retrospective',
        role: personaInstructions(persona),
        instructions: [
          'Distill your learnings from the meeting into concise working memory.',
          'Focus on durable lessons, responsibilities, and next actions.',
        ],
        context: {
          facilitator_context: facilitatorContext(meeting),
          participant_name: persona.name || persona.title || 'Participant',
        },
        input: 'Create the participant retrospective memory note.',
        outputFormat: 'Return only the distilled learnings and next actions in under 120 words.',
        includeThought: true,
      }),
      signal,
    });
    await writeAgentMemory(
      persona,
      'working-memory',
      `meeting-${meeting.id}-${Date.now().toString(36)}.md`,
      `# ${meeting.title}\n\n${reflection.trim()}`
    );
    return `${persona.name || persona.title || 'Participant'}:\n${reflection.trim()}`;
  }));
  return results.join('\n\n');
}

// runAllAgentMemoryConsolidation — extracted to agents.js

function fallbackFacilitatorPlan(meeting) {
  if (meeting.participants.length === 0) return null;
  const lastId = meeting.messages.filter(msg => msg.type === 'participant').at(-1)?.participantId;
  const pool = meeting.participants.filter(id => id !== lastId);
  const targetId = pool[0] ?? meeting.participants[0];
  const persona = savedPersonaById(targetId);
  return {
    status: 'continue',
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
    `End conditions:\n${meeting.endConditions || '(not established)'}`,
    `Summary:\n${meeting.summary || '(none yet)'}`,
    `Working memory:\n${[meeting.shortMemory, meeting.longMemory].filter(Boolean).join('\n\n') || '(none yet)'}`,
    `Draft boards:\n${meetingDraftBoardContext(meeting)}`,
    `Indexed attachments:\n${meetingAttachmentContext(meeting)}`,
    `Board notes pending:\n${board}`,
    `Turn count:\n${meeting.turnCount}/${meeting.maxTurns}`,
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

async function buildMeetingEndConditions(meeting, signal) {
  return requestQueuedText({
    meetingId: meeting.id,
    purpose: 'Define end conditions',
    mode: 'blocking',
    workflow: 'meeting_end_conditions',
    useCritic: true,
    validationHint: 'Return only 3-5 concise bullet end conditions.',
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'meeting_end_conditions',
      role: 'You are a facilitator defining the completion conditions for a professional meeting.',
      instructions: [
        'Define explicit completion conditions that preserve scope.',
        'Make the finish line objective, observable, and concise.',
      ],
      context: {
        meeting_title: meeting.title,
        meeting_topic: meeting.topic,
        agenda: meeting.agenda || '(pending)',
      },
      input: 'Define the end-of-meeting conditions.',
      outputFormat: 'Return only 3-5 concise bullet end conditions.',
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
    validationHint: 'Return STATUS, PARTICIPANT, and PROMPT lines. STATUS must be CONTINUE or COMPLETE.',
    validator: value => /STATUS:\s*(CONTINUE|COMPLETE)/i.test(value) && /PARTICIPANT:\s*.+/i.test(value) && /PROMPT:\s*.+/i.test(value),
    messages: workflowMessages({
      sourceModel: defaultSource()?.selectedModel || DEFAULT_MODEL,
      workflow: 'facilitator_plan',
      role: 'You facilitate a professional meeting using a plan-and-execute mindset.',
      instructions: [
        'Advance the meeting against the agenda and current summary.',
        'Interpret board notes in context rather than obeying them blindly.',
        'Honor the explicit meeting end conditions and stop when they are satisfied.',
        'If the meeting should end, return STATUS: COMPLETE, PARTICIPANT: NONE, and a concise completion prompt.',
        'Otherwise choose the single best next participant and write a concise next prompt.',
      ],
      context: {
        facilitator_context: facilitatorContext(meeting),
        available_participants: meeting.participants.map(id => savedPersonaById(id)?.name?.trim() || 'Participant').join('\n'),
        tool_schema: JSON.stringify(Policy.buildFacilitatorToolSchema(), null, 2),
      },
      input: 'Produce the next facilitator action for this meeting.',
      outputFormat: 'Return exactly three lines: STATUS: <CONTINUE|COMPLETE>, PARTICIPANT: <name|NONE>, PROMPT: <instruction>.',
      examples: [
        {
          input: 'Need the next meeting move.',
          thought: 'The product lead should answer the unresolved market question.',
          output: 'STATUS: CONTINUE\nPARTICIPANT: Product Lead\nPROMPT: Resolve the open market-fit concern and end with a next step recommendation.',
        },
      ],
      includeThought: true,
    }),
    signal,
  });

  const statusLine = raw.match(/STATUS:\s*(.+)/i)?.[1]?.trim().toLowerCase() || 'continue';
  const participantLine = raw.match(/PARTICIPANT:\s*(.+)/i)?.[1]?.trim();
  const promptLine = raw.match(/PROMPT:\s*([\s\S]+)/i)?.[1]?.trim();
  if (statusLine === 'complete') {
    return {
      status: 'complete',
      participantId: null,
      participantName: 'Facilitator',
      prompt: promptLine || 'Meeting complete. Capture retrospective learnings and close.',
    };
  }
  const participant = personas.find(persona => (persona.name.trim() || 'Untitled Agent').toLowerCase() === (participantLine || '').toLowerCase());
  if (!participant || !meeting.participants.includes(participant.id) || !promptLine) {
    return fallbackFacilitatorPlan(meeting);
  }

  return {
    status: 'continue',
    participantId: participant.id,
    participantName: participant.name.trim() || 'Participant',
    prompt: promptLine,
  };
}

async function generateMeetingParticipantMessage(meeting, persona, facilitatorPrompt, signal) {
  const resourceContext = await buildAgentResourceContext(persona, facilitatorPrompt, { topic: meeting.topic });
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
        agent_resources: resourceContext || '(none)',
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
