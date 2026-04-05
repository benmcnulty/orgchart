// tasks-mod.js — Scheduled tasks state, CRUD, scheduler, and panel rendering.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// References globals from app.js: TASK_STORAGE_KEY, AUTOMATION_STORAGE_KEY, uiState
//   — resolved at call time (not load time).
// References functions from shared.js: apiJson, setSaveIndicator, navStatusGlyph, el
// References functions from agents.js: personas, activePersona (global scope)
// References functions from sources.js: defaultSource, enabledSources (global scope)

// ─── State ────────────────────────────────────────────────────────────────────

let scheduledTasks = [];
let nextScheduledTaskSeq = 1;
let activeScheduledTaskId = null;
let automationEnabled = false;
let schedulerTimer = null;

// ─── Persistence ──────────────────────────────────────────────────────────────

function makeScheduledTask() {
  const seq = nextScheduledTaskSeq++;
  return {
    id: `taskdef-${seq}`,
    name: `Task ${seq}`,
    type: 'meeting',
    enabled: true,
    scheduled: false,
    recurrence: 'weekly',
    dayOfWeek: 'monday',
    date: '',
    hour: '09',
    minute: '00',
    meetingId: '',
    outputs: '',
    notes: '',
    agentIds: [],
    lastRunAt: '',
    nextRunHint: '',
    history: [],
    continuityNotes: '',
    hasUpdate: false,
  };
}

function loadScheduledTasks() {
  try {
    const saved = localStorage.getItem(TASK_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      scheduledTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      nextScheduledTaskSeq = Math.max(1, ...scheduledTasks.map(task => Number(String(task.id || '').split('-').pop()) || 0)) + 1;
    }
  } catch {
    scheduledTasks = [];
  }
  if (!scheduledTasks.length) scheduledTasks.push(makeScheduledTask());
  activeScheduledTaskId = scheduledTasks.some(task => task.id === activeScheduledTaskId) ? activeScheduledTaskId : scheduledTasks[0]?.id ?? null;
}

function saveScheduledTasks() {
  localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify({
    tasks: scheduledTasks,
  }));
  renderScheduledTaskList();
  setSaveIndicator('saved', 'Tasks saved.');
}

function loadAutomationState() {
  try {
    const saved = localStorage.getItem(AUTOMATION_STORAGE_KEY);
    if (saved !== null) {
      automationEnabled = saved === 'true';
      return;
    }
    const legacy = localStorage.getItem(TASK_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      automationEnabled = Boolean(parsed?.autoEnabled);
      return;
    }
  } catch {
    automationEnabled = false;
  }
}

function saveAutomationState() {
  localStorage.setItem(AUTOMATION_STORAGE_KEY, String(automationEnabled));
  syncAutomationButton();
  setSaveIndicator('saved', automationEnabled ? 'Automation active.' : 'Automation paused.');
}

// ─── Task CRUD ────────────────────────────────────────────────────────────────

function activeScheduledTask() {
  return scheduledTasks.find(task => task.id === activeScheduledTaskId) ?? scheduledTasks[0] ?? null;
}

function createScheduledTask() {
  const task = makeScheduledTask();
  if (!task.meetingId) task.meetingId = activeMeeting()?.id ?? '';
  scheduledTasks.push(task);
  activeScheduledTaskId = task.id;
  saveScheduledTasks();
  hydrateTaskEditor();
}

function renderScheduledTaskList() {
  const list = document.getElementById('scheduled-task-list');
  if (!list) return;
  list.replaceChildren(...scheduledTasks.map(task => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${task.id === activeScheduledTaskId ? ' workspace-item--active' : ''}`;
    button.dataset.status = task.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => {
      activeScheduledTaskId = task.id;
      renderScheduledTaskList();
      hydrateTaskEditor();
    });
    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = navStatusGlyph(task.hasUpdate ? 'attention' : 'idle', '◷');
    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = task.name;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    meta.textContent = `${task.scheduled ? 'Scheduled' : 'Manual'} • ${task.recurrence} • ${task.hour}:${task.minute}`;
    copy.append(title, meta);
    button.append(icon, copy);
    return button;
  }));
}

function nextTaskDueLabel(task) {
  if (!task.scheduled) return 'manual only';
  if (task.recurrence === 'once') return `${task.date || 'unscheduled date'} at ${task.hour}:${task.minute}`;
  const day = task.recurrence === 'weekly' ? ` on ${task.dayOfWeek}` : '';
  return `${task.recurrence}${day} at ${task.hour}:${task.minute}`;
}

function selectedTaskMeeting(task) {
  return groupChat.meetings.find(meeting => meeting.id === task?.meetingId) ?? null;
}

function syncTaskScheduleFields(task) {
  const recurrenceField = document.getElementById('scheduled-task-day-field');
  const dateField = document.getElementById('scheduled-task-date-field');
  const meetingField = document.getElementById('scheduled-task-meeting-field');
  if (recurrenceField) recurrenceField.hidden = !task?.scheduled || task?.recurrence !== 'weekly';
  if (dateField) dateField.hidden = !task?.scheduled || task?.recurrence !== 'once';
  if (meetingField) meetingField.hidden = task?.type !== 'meeting';
}

function renderTaskActivity() {
  const scheduledEl = document.getElementById('task-activity-scheduled');
  const completedEl = document.getElementById('task-activity-completed');
  if (!scheduledEl || !completedEl) return;

  const scheduledEntries = [...scheduledTasks].sort((left, right) => {
    const leftEnabled = Number(Boolean(left.enabled && left.scheduled));
    const rightEnabled = Number(Boolean(right.enabled && right.scheduled));
    return rightEnabled - leftEnabled || left.name.localeCompare(right.name);
  });
  scheduledEl.replaceChildren(...scheduledEntries.map(task => {
    const item = document.createElement('details');
    item.className = 'task-activity-item';
    if (task.id === activeScheduledTaskId) item.open = true;
    const summary = document.createElement('summary');
    summary.className = 'task-activity-summary';
    const title = document.createElement('span');
    title.className = 'task-activity-title';
    title.textContent = task.name;
    const meta = document.createElement('span');
    meta.className = 'task-activity-meta';
    meta.textContent = `${task.enabled ? 'Active' : 'Paused'} • ${nextTaskDueLabel(task)}`;
    summary.append(title, meta);
    const body = document.createElement('div');
    body.className = 'task-activity-body';
    const meeting = selectedTaskMeeting(task);
    body.append(
      Object.assign(document.createElement('p'), {
        className: 'task-activity-text',
        textContent: task.type === 'meeting'
          ? `Meeting: ${meeting?.title || 'Unlinked'}`
          : 'Memory consolidation task.',
      }),
      Object.assign(document.createElement('p'), {
        className: 'task-activity-text',
        textContent: task.outputs?.trim() ? `Desired outputs: ${clampText(task.outputs, 140)}` : 'Desired outputs: (none)',
      }),
      Object.assign(document.createElement('p'), {
        className: 'task-activity-text',
        textContent: task.continuityNotes?.trim() ? `Continuity: ${clampText(task.continuityNotes, 160)}` : 'Continuity: no prior run context yet.',
      }),
    );
    item.append(summary, body);
    return item;
  }));

  const completedRuns = scheduledTasks
    .flatMap(task => (task.history ?? []).map(entry => ({ ...entry, taskName: task.name })))
    .sort((left, right) => new Date(right.completedAt || right.startedAt || 0) - new Date(left.completedAt || left.startedAt || 0));
  if (!completedRuns.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Completed runs and retrospectives will appear here.';
    completedEl.replaceChildren(empty);
    return;
  }
  completedEl.replaceChildren(...completedRuns.slice(0, 30).map(entry => {
    const item = document.createElement('details');
    item.className = 'task-activity-item';
    const summary = document.createElement('summary');
    summary.className = 'task-activity-summary';
    const title = document.createElement('span');
    title.className = 'task-activity-title';
    title.textContent = `${entry.taskName} • ${entry.status}`;
    const meta = document.createElement('span');
    meta.className = 'task-activity-meta';
    meta.textContent = new Date(entry.completedAt || entry.startedAt).toLocaleString();
    summary.append(title, meta);
    const body = document.createElement('div');
    body.className = 'task-activity-body';
    const sections = [
      ['Summary', entry.summary],
      ['Outputs', entry.outputs],
      ['Retrospective', entry.retrospective],
    ].filter(([, value]) => String(value ?? '').trim());
    if (!sections.length) {
      body.append(Object.assign(document.createElement('p'), {
        className: 'task-activity-text',
        textContent: 'No additional details recorded for this run.',
      }));
    } else {
      body.append(...sections.map(([label, value]) => {
        const block = document.createElement('div');
        block.className = 'task-activity-block';
        const heading = document.createElement('p');
        heading.className = 'task-activity-block-title';
        heading.textContent = label;
        const text = document.createElement('pre');
        text.className = 'task-activity-pre';
        text.textContent = value;
        block.append(heading, text);
        return block;
      }));
    }
    item.append(summary, body);
    return item;
  }));
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

async function runScheduledTask(task) {
  task.lastRunAt = new Date().toISOString();
  task.hasUpdate = false;
  const historyEntry = {
    id: `taskrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: task.lastRunAt,
    type: task.type,
    meetingId: task.meetingId || null,
    summary: '',
    outputs: task.outputs || '',
    retrospective: '',
    status: 'running',
  };
  try {
    if (task.type === 'meeting') {
      const meeting = groupChat.meetings.find(item => item.id === task.meetingId) ?? activeMeeting();
      if (meeting) {
        groupChat.activeMeetingId = meeting.id;
        if (task.continuityNotes?.trim()) {
          meeting.pendingBoardNotes.push(`Continuity from prior runs:\n${task.continuityNotes.trim()}`);
        }
        if (task.outputs?.trim()) {
          meeting.pendingBoardNotes.push(`Desired outputs for this scheduled run:\n${task.outputs.trim()}`);
        }
        if (task.notes?.trim()) {
          meeting.pendingBoardNotes.push(`Scheduled task notes:\n${task.notes.trim()}`);
        }
        hydrateMeetingEditor();
        await groupChatRun();
        historyEntry.summary = meeting.summary || meeting.agenda || '';
        historyEntry.outputs = [
          task.outputs?.trim() ? `Requested outputs:\n${task.outputs.trim()}` : '',
          activeDraftBoard(meeting)?.content?.trim() ? `Latest draft board (${activeDraftBoard(meeting).name}):\n${activeDraftBoard(meeting).content.trim()}` : '',
        ].filter(Boolean).join('\n\n');
        historyEntry.retrospective = meeting.retrospective || '';
        historyEntry.status = meeting.status === 'complete' ? 'completed' : 'stopped';
        task.continuityNotes = [
          `Last meeting run completed at ${new Date().toLocaleString()}.`,
          meeting.summary ? `Summary:\n${meeting.summary}` : '',
          meeting.retrospective ? `Retrospective:\n${meeting.retrospective}` : '',
        ].filter(Boolean).join('\n\n');
      }
    } else if (task.type === 'memory-consolidation') {
      await runAllAgentMemoryConsolidation();
      historyEntry.summary = 'Agent long-term memory consolidation completed.';
      historyEntry.status = 'completed';
      pushBoardNotification({
        title: 'Memory consolidation complete',
        message: 'Agent long-term memory consolidation finished successfully.',
        source: 'system',
      });
    }
  } catch (err) {
    historyEntry.status = 'failed';
    historyEntry.summary = err.message;
    pushBoardNotification({
      title: `${task.name} failed`,
      message: err.message,
      source: 'system',
    });
    throw err;
  } finally {
    historyEntry.completedAt = new Date().toISOString();
    task.history.unshift(historyEntry);
    task.history = task.history.slice(0, 25);
    try {
      await persistTaskRunRecord(task, historyEntry);
    } catch (err) {
      console.warn('Failed to persist task record:', err.message);
    }
    saveScheduledTasks();
    renderTaskActivity();
  }
}

function taskIsDue(task, now = new Date()) {
  if (!automationEnabled || !task.scheduled) return false;
  const hour = Number(task.hour);
  const minute = Number(task.minute);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  if (task.recurrence === 'once') {
    if (!task.date) return false;
    const sameDate = now.toISOString().slice(0, 10) === task.date;
    if (!sameDate) return false;
  }
  if (task.recurrence === 'weekly') {
    if ((task.dayOfWeek || 'monday').toLowerCase() !== now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()) return false;
  }
  if (task.recurrence === 'once' && task.lastRunAt) return false;
  if (now.getHours() !== hour || now.getMinutes() !== minute) return false;
  if (!task.lastRunAt) return true;
  return new Date(task.lastRunAt).toDateString() !== now.toDateString() || new Date(task.lastRunAt).getHours() !== hour || new Date(task.lastRunAt).getMinutes() !== minute;
}

function startTaskScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(async () => {
    const due = scheduledTasks.filter(task => taskIsDue(task));
    for (const task of due) {
      try {
        await runScheduledTask(task);
      } catch (err) {
        console.warn('Scheduled task failed:', err.message);
        pushBoardNotification({
          title: `${task.name} failed`,
          message: err.message,
          source: 'system',
        });
      }
    }
  }, 30000);
}

// ─── Task Editor ──────────────────────────────────────────────────────────────

function hydrateTaskEditor() {
  const task = activeScheduledTask();
  const fields = {
    name: document.getElementById('scheduled-task-name'),
    type: document.getElementById('scheduled-task-type'),
    scheduled: document.getElementById('scheduled-task-scheduled'),
    recurrence: document.getElementById('scheduled-task-recurrence'),
    day: document.getElementById('scheduled-task-day'),
    date: document.getElementById('scheduled-task-date'),
    time: document.getElementById('scheduled-task-time'),
    meeting: document.getElementById('scheduled-task-meeting'),
    meetingContext: document.getElementById('scheduled-task-meeting-context'),
    outputs: document.getElementById('scheduled-task-outputs'),
    notes: document.getElementById('scheduled-task-notes'),
    due: document.getElementById('scheduled-task-next'),
  };
  if (!task || Object.values(fields).some(value => !value)) return;
  fields.name.value = task.name;
  fields.type.value = task.type;
  fields.scheduled.checked = Boolean(task.scheduled);
  fields.recurrence.value = task.recurrence;
  fields.day.value = task.dayOfWeek;
  fields.date.value = task.date || '';
  fields.time.value = `${task.hour || '09'}:${task.minute || '00'}`;
  fields.outputs.value = task.outputs;
  fields.notes.value = task.notes;
  fields.meeting.replaceChildren(...groupChat.meetings.map(meeting => {
    const option = document.createElement('option');
    option.value = meeting.id;
    option.textContent = meeting.title;
    return option;
  }));
  fields.meeting.value = groupChat.meetings.some(meeting => meeting.id === task.meetingId) ? task.meetingId : groupChat.meetings[0]?.id ?? '';
  task.meetingId = fields.meeting.value;
  const meeting = selectedTaskMeeting(task);
  fields.meetingContext.textContent = task.type === 'meeting'
    ? [
        `Topic: ${meeting?.topic || '(set the meeting topic in Meetings)'}`,
        `Participants: ${meeting?.participants?.map(id => savedPersonaById(id)?.name || savedPersonaById(id)?.title).filter(Boolean).join(', ') || '(none selected)'}`,
        `Continuity: ${task.continuityNotes?.trim() ? 'Existing series context will be carried into the next run.' : 'First scheduled run or no continuity note yet.'}`,
      ].join('\n')
    : 'This task will trigger long-term memory consolidation across agents with the Memory skill.';
  fields.due.textContent = task.lastRunAt ? `Last run: ${new Date(task.lastRunAt).toLocaleString()} • Next rule: ${nextTaskDueLabel(task)}` : `Next rule: ${nextTaskDueLabel(task)}`;
  syncTaskScheduleFields(task);
  renderTaskActivity();
}

function bindTaskEditor() {
  const task = () => activeScheduledTask();
  const binders = [
    ['scheduled-task-name', 'input', el => { if (task()) task().name = el.value || 'Untitled Task'; }],
    ['scheduled-task-type', 'change', el => {
      if (task()) task().type = el.value;
      syncTaskScheduleFields(task());
      hydrateTaskEditor();
    }],
    ['scheduled-task-scheduled', 'change', el => {
      if (task()) {
        task().scheduled = el.checked;
        task().enabled = el.checked;
      }
    }],
    ['scheduled-task-recurrence', 'change', el => { if (task()) task().recurrence = el.value; }],
    ['scheduled-task-day', 'change', el => { if (task()) task().dayOfWeek = el.value; }],
    ['scheduled-task-date', 'change', el => { if (task()) task().date = el.value; }],
    ['scheduled-task-meeting', 'change', el => { if (task()) task().meetingId = el.value; }],
    ['scheduled-task-outputs', 'input', el => { if (task()) task().outputs = el.value; }],
    ['scheduled-task-notes', 'input', el => { if (task()) task().notes = el.value; }],
  ];
  for (const [id, eventName, apply] of binders) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.addEventListener(eventName, () => {
      apply(element);
      saveScheduledTasks();
      hydrateTaskEditor();
    });
  }
  const timeEl = document.getElementById('scheduled-task-time');
  if (timeEl) {
    timeEl.addEventListener('change', () => {
      if (task()) {
        const [hour = '09', minute = '00'] = timeEl.value.split(':');
        task().hour = hour.padStart(2, '0');
        task().minute = minute.padStart(2, '0');
      }
      saveScheduledTasks();
      hydrateTaskEditor();
    });
  }
  const runBtn = document.getElementById('scheduled-task-run');
  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      const current = activeScheduledTask();
      if (!current) return;
      try {
        await runScheduledTask(current);
        hydrateTaskEditor();
      } catch (err) {
        renderTaskActivity();
      }
    });
  }
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function renderTasksPanel(body, actionsLeft, actionsRight) {
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-add';
  addBtn.textContent = '+';
  addBtn.title = 'Create scheduled task';
  addBtn.addEventListener('click', createScheduledTask);
  actionsRight.appendChild(addBtn);

  const navToggle = document.createElement('button');
  navToggle.type = 'button';
  navToggle.className = 'btn-add';
  navToggle.textContent = '↔';
  navToggle.title = 'Collapse task list';
  navToggle.addEventListener('click', () => {
    uiState.tasksNavCollapsed = !uiState.tasksNavCollapsed;
    const shellEl = document.getElementById('tasks-shell');
    if (shellEl) shellEl.classList.toggle('workspace-shell--collapsed', uiState.tasksNavCollapsed);
  });
  actionsLeft.appendChild(navToggle);

  const shell = document.createElement('div');
  shell.id = 'tasks-shell';
  shell.className = 'workspace-shell persona-shell';
  shell.classList.toggle('workspace-shell--collapsed', uiState.tasksNavCollapsed);
  const nav = document.createElement('div');
  nav.id = 'scheduled-task-list';
  nav.className = 'workspace-nav persona-list';
  const detail = document.createElement('div');
  detail.className = 'workspace-detail persona-editor';
  const intro = document.createElement('div');
  intro.className = 'persona-intro';
  const heading = document.createElement('h3');
  heading.className = 'persona-heading';
  heading.textContent = 'Tasks';
  const hint = document.createElement('p');
  hint.className = 'persona-hint';
  hint.textContent = 'Configure scheduled organizational work, preserve meeting continuity, and keep upcoming and completed runs in view.';
  intro.append(heading, hint);

  const form = document.createElement('div');
  form.className = 'persona-editor-form';

  const topRow = document.createElement('div');
  topRow.className = 'task-top-row';
  const scheduledLabel = document.createElement('label');
  scheduledLabel.className = 'agent-skill-chip';
  const scheduledInput = document.createElement('input');
  scheduledInput.type = 'checkbox';
  scheduledInput.id = 'scheduled-task-scheduled';
  const scheduledText = document.createElement('span');
  scheduledText.textContent = 'Scheduled';
  scheduledLabel.append(scheduledInput, scheduledText);
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.id = 'scheduled-task-run';
  runBtn.className = 'btn-primary';
  runBtn.textContent = 'Run Now';
  const due = document.createElement('p');
  due.id = 'scheduled-task-next';
  due.className = 'persona-status';
  topRow.append(scheduledLabel, runBtn, due);
  form.appendChild(topRow);

  for (const [id, labelText] of [['scheduled-task-name', 'Task Name']]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const control = id === 'scheduled-task-name' ? document.createElement('input') : document.createElement('textarea');
    control.id = id;
    control.className = id === 'scheduled-task-name' ? 'text-input' : 'persona-textarea';
    if (id === 'scheduled-task-name') control.type = 'text';
    if (id !== 'scheduled-task-name') control.rows = 3;
    field.append(label, control);
    form.appendChild(field);
  }

  const configGrid = document.createElement('div');
  configGrid.className = 'task-config-grid';
  const selectSpecs = [
    ['scheduled-task-type', 'Type', [['meeting', 'Meeting'], ['memory-consolidation', 'Memory Consolidation']]],
    ['scheduled-task-recurrence', 'Recurrence', [['weekly', 'Weekly'], ['daily', 'Daily'], ['once', 'Once']]],
    ['scheduled-task-day', 'Day', [['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday']]],
  ];
  for (const [id, labelText, options] of selectSpecs) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    if (id === 'scheduled-task-day') field.id = 'scheduled-task-day-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const select = document.createElement('select');
    select.id = id;
    select.className = 'chat-source-select';
    select.replaceChildren(...options.map(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      return option;
    }));
    field.append(label, select);
    configGrid.appendChild(field);
  }
  for (const [id, labelText, inputType] of [['scheduled-task-date', 'Date', 'date'], ['scheduled-task-time', 'Time', 'time']]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    if (id === 'scheduled-task-date') field.id = 'scheduled-task-date-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'text-input';
    input.type = inputType;
    field.append(label, input);
    configGrid.appendChild(field);
  }
  form.appendChild(configGrid);

  const meetingField = document.createElement('div');
  meetingField.className = 'persona-field';
  meetingField.id = 'scheduled-task-meeting-field';
  const meetingLabel = document.createElement('label');
  meetingLabel.className = 'field-label';
  meetingLabel.htmlFor = 'scheduled-task-meeting';
  meetingLabel.textContent = 'Meeting';
  const meetingSelect = document.createElement('select');
  meetingSelect.id = 'scheduled-task-meeting';
  meetingSelect.className = 'chat-source-select';
  meetingField.append(meetingLabel, meetingSelect);
  form.appendChild(meetingField);

  const meetingContext = document.createElement('pre');
  meetingContext.id = 'scheduled-task-meeting-context';
  meetingContext.className = 'tool-test-status';
  form.appendChild(meetingContext);

  for (const [id, labelText] of [
    ['scheduled-task-outputs', 'Desired Outputs'],
    ['scheduled-task-notes', 'Notes'],
  ]) {
    const field = document.createElement('div');
    field.className = 'persona-field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.textContent = labelText;
    const control = document.createElement('textarea');
    control.id = id;
    control.className = 'persona-textarea';
    control.rows = 3;
    field.append(label, control);
    form.appendChild(field);
  }

  const activity = document.createElement('div');
  activity.className = 'task-activity-board';
  const scheduledBlock = document.createElement('details');
  scheduledBlock.className = 'task-activity-panel';
  scheduledBlock.open = true;
  const scheduledSummary = document.createElement('summary');
  scheduledSummary.className = 'task-activity-panel-summary';
  scheduledSummary.textContent = 'Scheduled';
  const scheduledList = document.createElement('div');
  scheduledList.id = 'task-activity-scheduled';
  scheduledList.className = 'task-activity-list';
  scheduledBlock.append(scheduledSummary, scheduledList);
  const completedBlock = document.createElement('details');
  completedBlock.className = 'task-activity-panel';
  completedBlock.open = true;
  const completedSummary = document.createElement('summary');
  completedSummary.className = 'task-activity-panel-summary';
  completedSummary.textContent = 'Completed';
  const completedList = document.createElement('div');
  completedList.id = 'task-activity-completed';
  completedList.className = 'task-activity-list';
  completedBlock.append(completedSummary, completedList);
  activity.append(scheduledBlock, completedBlock);
  form.appendChild(activity);

  detail.append(intro, form);
  shell.append(nav, detail);
  body.appendChild(shell);
  renderScheduledTaskList();
  hydrateTaskEditor();
  bindTaskEditor();
}

// ─── Run Record ───────────────────────────────────────────────────────────────

async function persistTaskRunRecord(task, historyEntry) {
  return writeOperationalRecord({
    slug: `task-${slugifyLabel(task.name, 'task')}-${historyEntry.id}`,
    title: `${task.name} Run`,
    description: `${task.type} • ${historyEntry.status}`,
    content: [
      `# ${task.name}`,
      '',
      `- Type: ${task.type}`,
      `- Status: ${historyEntry.status}`,
      `- Started: ${historyEntry.startedAt}`,
      `- Completed: ${historyEntry.completedAt || '(running)'}`,
      '',
      `## Summary`,
      historyEntry.summary || '(none)',
      '',
      `## Outputs`,
      historyEntry.outputs || '(none)',
      '',
      `## Retrospective`,
      historyEntry.retrospective || '(none)',
      '',
      `## Continuity`,
      task.continuityNotes || '(none)',
    ].join('\n'),
  });
}

// ─── Automation Button ────────────────────────────────────────────────────────

function syncAutomationButton() {
  const btn = document.getElementById('automation-toggle');
  if (!btn) return;
  btn.dataset.state = automationEnabled ? 'active' : 'paused';
  btn.textContent = automationEnabled ? 'Active' : 'Paused';
  btn.title = automationEnabled ? 'Pause autonomous and scheduled processes' : 'Activate autonomous and scheduled processes';
  btn.setAttribute('aria-label', btn.title);
}

function setAutomationEnabled(nextValue) {
  automationEnabled = Boolean(nextValue);
  saveAutomationState();
  if (!automationEnabled) {
    for (const meeting of groupChat.meetings) {
      if (meeting.auto && meeting.controller) {
        meeting.auto = false;
        meeting.controller.abort();
      }
    }
  }
  updateGroupChatControls();
}
