// chat.js — multi-conversation chat workspace with streaming replies.
// Depends on: markdown.js globals and shared source/agent globals from app.js.

const CTX_CHAR_LIMIT = 20000;
const CTX_KEEP_RECENT = 6;
const ChatPolicy = globalThis.InferencePolicy;

let chatSessions = [];
let nextChatSeq = 1;
let activeChatId = null;
let chatNavCollapsed = false;

function makeChatSession() {
  const seq = nextChatSeq++;
  return {
    id: `chat-${seq}`,
    title: `Chat ${seq}`,
    messages: [],
    attachments: [],
    selectedSourceId: null,
    selectedPersonaId: '',
    busy: false,
    abortController: null,
    autoScroll: true,
    hasUpdate: false,
  };
}

function ensureChatSessions() {
  if (chatSessions.length === 0) {
    const session = makeChatSession();
    chatSessions.push(session);
    activeChatId = session.id;
  }
  if (!chatSessions.some(session => session.id === activeChatId)) {
    activeChatId = chatSessions[0].id;
  }
}

function activeChat() {
  ensureChatSessions();
  return chatSessions.find(session => session.id === activeChatId) ?? chatSessions[0];
}

function chatInit(mountEl, panelActions = {}) {
  mountEl.classList.add('chat-body');
  ensureChatSessions();

  const shell = document.createElement('div');
  shell.id = 'chat-shell';
  shell.className = 'workspace-shell chat-shell';

  const nav = document.createElement('div');
  nav.id = 'chat-list';
  nav.className = 'workspace-nav';

  const list = document.createElement('div');
  list.id = 'chat-session-list';
  list.className = 'chat-session-list';
  nav.append(list);

  const detail = document.createElement('div');
  detail.className = 'workspace-detail chat-detail';

  const sourceBar = document.createElement('div');
  sourceBar.className = 'chat-source-bar';
  const controls = document.createElement('div');
  controls.className = 'chat-controls';

  const sourceField = chatBuildSelectField('chat-source-select', 'Source', 'Select a connected Ollama source for this conversation.');
  const sourceSelect = sourceField.querySelector('select');
  sourceSelect.className = 'chat-source-select';
  sourceSelect.addEventListener('change', e => {
    activeChat().selectedSourceId = e.target.value || null;
    chatRenderSessionList();
  });

  const personaField = chatBuildSelectField('chat-persona-select', 'Agent', 'Use saved system instructions or leave on Default.');
  const personaSelect = personaField.querySelector('select');
  personaSelect.className = 'chat-source-select';
  personaSelect.addEventListener('change', e => {
    activeChat().selectedPersonaId = e.target.value || '';
  });

  controls.append(sourceField, personaField);
  sourceBar.appendChild(controls);

  const messagesEl = document.createElement('div');
  messagesEl.id = 'chat-messages';
  messagesEl.className = 'chat-messages';
  messagesEl.setAttribute('role', 'log');
  messagesEl.setAttribute('aria-live', 'polite');
  messagesEl.addEventListener('scroll', () => {
    const session = activeChat();
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    session.autoScroll = (scrollHeight - scrollTop - clientHeight) < 60;
  });

  const composer = document.createElement('div');
  composer.className = 'chat-composer';
  const attachBar = document.createElement('div');
  attachBar.id = 'chat-attachments';
  attachBar.className = 'chat-attachments hidden';
  const composerRow = document.createElement('div');
  composerRow.className = 'composer-row';
  const btnAttach = document.createElement('button');
  btnAttach.className = 'btn-icon btn-attach';
  btnAttach.title = 'Attach file (.txt, .md, or image)';
  btnAttach.textContent = '+';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'chat-file-input';
  fileInput.accept = '.txt,.md,.png,.jpg,.jpeg,.gif,.webp';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const textarea = document.createElement('textarea');
  textarea.id = 'chat-textarea';
  textarea.className = 'chat-textarea';
  textarea.placeholder = 'Message… (Enter to send, Shift+Enter for newline)';
  textarea.rows = 1;
  const sendGroup = document.createElement('div');
  sendGroup.className = 'composer-send-group';
  const btnSend = document.createElement('button');
  btnSend.id = 'chat-send';
  btnSend.className = 'btn-send';
  btnSend.textContent = 'Send';
  const btnStop = document.createElement('button');
  btnStop.id = 'chat-stop';
  btnStop.className = 'btn-stop hidden';
  btnStop.textContent = 'Stop';
  sendGroup.append(btnSend, btnStop);
  composerRow.append(btnAttach, fileInput, textarea, sendGroup);
  composer.append(attachBar, composerRow);

  detail.append(sourceBar, messagesEl, composer);
  shell.append(nav, detail);
  mountEl.appendChild(shell);

  if (panelActions.actionsLeft) {
    const slimBtn = document.createElement('button');
    slimBtn.type = 'button';
    slimBtn.className = 'btn-add';
    slimBtn.title = 'Collapse chat list';
    slimBtn.textContent = '↔';
    slimBtn.addEventListener('click', () => {
      chatNavCollapsed = !chatNavCollapsed;
      shell.classList.toggle('workspace-shell--collapsed', chatNavCollapsed);
    });
    panelActions.actionsLeft.appendChild(slimBtn);
  }

  if (panelActions.actionsRight) {
    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn-add';
    newBtn.title = 'Create chat';
    newBtn.textContent = '+';
    newBtn.addEventListener('click', chatCreateSession);
    panelActions.actionsRight.appendChild(newBtn);
  }

  btnAttach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    chatHandleFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
  });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!activeChat().busy) chatSend();
    }
  });
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  });
  btnSend.addEventListener('click', () => { if (!activeChat().busy) chatSend(); });
  btnStop.addEventListener('click', () => {
    const session = activeChat();
    if (session.abortController) session.abortController.abort();
  });

  document.addEventListener('sources-changed', e => {
    chatRefreshSourceSelector(e.detail.sources);
    chatRenderSessionList();
  });
  document.addEventListener('personas-changed', e => {
    chatRefreshPersonaSelector(e.detail.personas);
  });

  chatRefreshSourceSelector(typeof sources !== 'undefined' ? sources : []);
  chatRefreshPersonaSelector(typeof personas !== 'undefined' ? personas : []);
  chatRenderSessionList();
  chatHydrateActiveSession();
}

function chatBuildSelectField(id, labelText, hintText) {
  const field = document.createElement('div');
  field.className = 'chat-control-field';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = labelText;
  label.htmlFor = id;
  const hint = document.createElement('p');
  hint.className = 'chat-source-hint';
  hint.textContent = hintText;
  const select = document.createElement('select');
  select.id = id;
  field.append(label, hint, select);
  return field;
}

function chatCreateSession() {
  const session = makeChatSession();
  chatSessions.push(session);
  activeChatId = session.id;
  chatRenderSessionList();
  chatHydrateActiveSession();
}

function chatSwitchSession(id) {
  activeChatId = id;
  const session = activeChat();
  session.hasUpdate = false;
  chatRenderSessionList();
  chatHydrateActiveSession();
}

function chatRenderSessionList() {
  const list = document.getElementById('chat-session-list');
  const shell = document.getElementById('chat-shell');
  if (!list || !shell) return;
  shell.classList.toggle('workspace-shell--collapsed', chatNavCollapsed);

  list.replaceChildren(...chatSessions.map(session => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-item${session.id === activeChatId ? ' workspace-item--active' : ''}`;
    button.dataset.status = session.busy ? 'processing' : session.hasUpdate ? 'attention' : 'idle';
    button.addEventListener('click', () => chatSwitchSession(session.id));

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = session.busy ? '…' : session.hasUpdate ? '🔔' : '◇';

    const copy = document.createElement('span');
    copy.className = 'workspace-item-copy';
    const title = document.createElement('span');
    title.className = 'workspace-item-title';
    title.textContent = session.title;
    const meta = document.createElement('span');
    meta.className = 'workspace-item-meta';
    const lastAssistant = [...session.messages].reverse().find(msg => msg.role === 'assistant')?.content;
    meta.textContent = clampText(lastAssistant || 'No replies yet.', 72);
    copy.append(title, meta);

    button.append(icon, copy);
    return button;
  }));
}

function chatHydrateActiveSession() {
  const session = activeChat();
  const textarea = document.getElementById('chat-textarea');
  if (textarea) {
    textarea.value = '';
    textarea.style.height = 'auto';
  }
  chatRefreshSourceSelector(typeof sources !== 'undefined' ? sources : []);
  chatRefreshPersonaSelector(typeof personas !== 'undefined' ? personas : []);
  chatRenderAttachmentChips();
  chatRenderMessages();
  chatSyncButtons();
}

function chatRenderMessages() {
  const session = activeChat();
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;
  messagesEl.replaceChildren();

  if (session.messages.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.id = 'chat-empty';
    emptyEl.className = 'chat-empty';
    emptyEl.textContent = 'No messages yet. Start a conversation below.';
    messagesEl.appendChild(emptyEl);
    return;
  }

  for (const message of session.messages) {
    if (message.role === 'user') {
      messagesEl.appendChild(chatBuildUserBubble(message.rawText || message.content, message.attachments || []));
      continue;
    }
    if (message.role === 'assistant') {
      const bubble = chatBuildAssistantBubble();
      if (message.thinking?.trim()) {
        bubble.details.hidden = false;
        bubble.thinkingEl.replaceChildren(renderMarkdown(message.thinking));
        chatUpdateThinkingSummary(bubble.details, message.thinking, false);
      }
      if (message.content?.trim()) {
        bubble.responseEl.replaceChildren(renderMarkdown(message.content));
      } else {
        bubble.responseEl.hidden = true;
      }
      messagesEl.appendChild(bubble.bubble);
    }
  }
  chatScrollToBottom(session);
}

function chatRefreshSourceSelector(allSources) {
  const select = document.getElementById('chat-source-select');
  if (!select) return;
  const session = activeChat();
  const enabled = allSources.filter(source => source.enabled);
  select.replaceChildren();

  if (enabled.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No sources available';
    select.appendChild(opt);
    session.selectedSourceId = null;
    return;
  }

  const defaultId = (enabled.find(source => source.isDefault) ?? enabled[0]).id;
  for (const source of enabled) {
    const opt = document.createElement('option');
    opt.value = source.id;
    const suffix = source.id === defaultId ? ' (default)' : '';
    opt.textContent = source.selectedModel
      ? `${displayLabel(source)} • ${source.selectedModel}${suffix}`
      : `${displayLabel(source)}${suffix}`;
    select.appendChild(opt);
  }

  const restore = enabled.some(source => source.id === session.selectedSourceId) ? session.selectedSourceId : defaultId;
  session.selectedSourceId = restore;
  select.value = restore;
}

function chatGetActiveSource(session = activeChat()) {
  if (typeof sources === 'undefined') return null;
  if (session.selectedSourceId) {
    return sources.find(source => source.id === session.selectedSourceId && source.enabled) ?? null;
  }
  return sources.find(source => source.enabled) ?? null;
}

function chatRefreshPersonaSelector(allPersonas) {
  const select = document.getElementById('chat-persona-select');
  if (!select) return;
  const session = activeChat();
  select.replaceChildren();

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default (no agent)';
  select.appendChild(defaultOpt);

  for (const persona of allPersonas) {
    const opt = document.createElement('option');
    opt.value = persona.id;
    opt.textContent = `${persona.name.trim() || 'Untitled Agent'}${persona.title.trim() ? ` • ${persona.title.trim()}` : ''}`;
    select.appendChild(opt);
  }

  session.selectedPersonaId = allPersonas.some(persona => persona.id === session.selectedPersonaId) ? session.selectedPersonaId : '';
  select.value = session.selectedPersonaId;
}

function chatSelectedPersona(session = activeChat()) {
  if (typeof personas === 'undefined' || !session.selectedPersonaId) return null;
  return personas.find(persona => persona.id === session.selectedPersonaId) ?? null;
}

function chatBuildRequestMessages(session, source) {
  const selectedPersona = chatSelectedPersona(session);
  const transcript = session.messages
    .map(message => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n---\n\n');
  const prompt = ChatPolicy.buildWorkflowMessages({
    modelName: source.selectedModel,
    workflow: 'chat_conversation',
    role: selectedPersona?.instructions.trim() || 'You are a reliable assistant for a professional inference dashboard.',
    instructions: [
      'Keep the answer concise, direct, and faithful to the provided conversation.',
      'Do not restate hidden reasoning in the final answer.',
    ],
    context: {
      conversation_history: transcript || '(opening turn)',
    },
    input: 'Continue the conversation with the best next assistant reply.',
    outputFormat: 'Return the assistant reply only.',
    includeThought: true,
  });
  return prompt.messages;
}

function chatHandleFiles(files) {
  if (!files.length) return;
  const session = activeChat();
  let pending = files.length;

  for (const file of files) {
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.onload = e => {
        const dataUrl = String(e.target.result);
        session.attachments.push({ type: 'image', name: file.name, data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type });
        if (--pending === 0) chatRenderAttachmentChips();
      };
      reader.readAsDataURL(file);
      continue;
    }
    reader.onload = e => {
      session.attachments.push({ type: 'text', name: file.name, data: String(e.target.result ?? '') });
      if (--pending === 0) chatRenderAttachmentChips();
    };
    reader.readAsText(file);
  }
}

function chatRenderAttachmentChips() {
  const bar = document.getElementById('chat-attachments');
  if (!bar) return;
  const session = activeChat();
  bar.replaceChildren();
  if (!session.attachments.length) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  session.attachments.forEach((attachment, index) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    const nameEl = document.createElement('span');
    nameEl.className = 'attachment-name';
    nameEl.textContent = attachment.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      session.attachments.splice(index, 1);
      chatRenderAttachmentChips();
    });
    chip.append(nameEl, removeBtn);
    bar.appendChild(chip);
  });
}

async function chatSend() {
  const session = activeChat();
  const textarea = document.getElementById('chat-textarea');
  const rawText = textarea.value.trim();
  const attachments = [...session.attachments];
  if (!rawText && attachments.length === 0) return;

  const source = chatGetActiveSource(session);
  if (!source) {
    alert('No inference source available. Add and connect an Ollama server first.');
    return;
  }
  if (source.status !== 'connected') {
    alert(`Source "${displayLabel(source)}" is not connected yet. Please wait or try reconnecting.`);
    return;
  }

  textarea.value = '';
  textarea.style.height = 'auto';
  session.attachments = [];
  chatRenderAttachmentChips();

  let content = '';
  const images = [];
  for (const attachment of attachments) {
    if (attachment.type === 'text') {
      content += `[Attached: ${attachment.name}]\n\`\`\`\n${attachment.data}\n\`\`\`\n\n`;
    } else {
      images.push(attachment.data);
    }
  }
  content += rawText;

  const userMsg = { role: 'user', content, rawText, attachments };
  if (images.length) userMsg.images = images;
  session.messages.push(userMsg);
  session.title = clampText(rawText || attachments.map(attachment => attachment.name).join(', '), 28) || session.title;
  chatRenderMessages();

  const messagesEl = document.getElementById('chat-messages');
  const streamBubble = chatBuildAssistantBubble();
  messagesEl.appendChild(streamBubble.bubble);
  chatScrollToBottom(session);

  session.busy = true;
  session.abortController = new AbortController();
  session.autoScroll = true;
  chatSyncButtons();
  chatRenderSessionList();

  const parser = new ChatThinkingParser();
  let fullText = '';
  let fullThinking = '';
  const requestMessages = chatBuildRequestMessages(session, source);

  try {
    const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: source.selectedModel, messages: requestMessages, stream: true }),
      signal: session.abortController.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errBody.error ?? `HTTP ${response.status}`);
    }

    for await (const chunk of chatReadStream(response)) {
      const { thinkingDelta, textDelta } = parser.feed(chunk);
      if (thinkingDelta) {
        fullThinking += thinkingDelta;
        streamBubble.thinkingEl.textContent = fullThinking;
        streamBubble.details.hidden = false;
        chatUpdateThinkingSummary(streamBubble.details, fullThinking, true);
      }
      if (textDelta) {
        fullText += textDelta;
        streamBubble.responseEl.replaceChildren(renderMarkdown(fullText));
      }
      chatScrollToBottom(session);
      if (chunk.done) break;
    }

    const flushed = parser.flush();
    if (flushed.textDelta) {
      fullText += flushed.textDelta;
      streamBubble.responseEl.replaceChildren(renderMarkdown(fullText));
    }
    if (flushed.thinkingDelta) fullThinking += flushed.thinkingDelta;

    if (!fullText.trim() && fullThinking.trim()) {
      fullText = await chatRequestFinalOnlyReply(source, requestMessages, session.abortController.signal);
      if (fullText.trim()) {
        streamBubble.responseEl.hidden = false;
        streamBubble.responseEl.replaceChildren(renderMarkdown(fullText));
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      fullText = `[Error: ${err.message}]`;
      const errEl = document.createElement('p');
      errEl.className = 'message-error';
      errEl.textContent = `Error: ${err.message}`;
      streamBubble.responseEl.replaceChildren(errEl);
    }
  }

  if (fullThinking.trim()) {
    streamBubble.thinkingEl.replaceChildren(renderMarkdown(fullThinking));
    chatUpdateThinkingSummary(streamBubble.details, fullThinking, false);
  }
  if (!fullText.trim()) {
    streamBubble.responseEl.hidden = true;
  }

  session.messages.push({ role: 'assistant', content: fullText, thinking: fullThinking });
  if (session.id !== activeChatId) session.hasUpdate = true;
  session.busy = false;
  session.abortController = null;
  chatRenderSessionList();
  chatSyncButtons();
  await chatMaybeCondenseContext(session);
}

function chatToRequestMessage(message) {
  const request = { role: message.role, content: message.content };
  if (message.images?.length) request.images = message.images;
  return request;
}

async function chatRequestFinalOnlyReply(source, requestMessages, signal) {
  const criticMessages = ChatPolicy.buildWorkflowMessages({
    modelName: source.selectedModel,
    workflow: 'chat_final_answer',
    role: 'You review a drafted assistant response and return only the final user-facing answer.',
    instructions: [
      'Do not include reasoning, planning notes, or XML tags in the final answer.',
      'Use the prior request context faithfully.',
    ],
    context: {
      original_request: requestMessages.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n---\n\n'),
    },
    input: 'Return the final user-facing answer only.',
    outputFormat: 'Return only the final user-facing answer.',
    includeThought: true,
  }).messages;

  const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: source.selectedModel,
      messages: criticMessages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parser = new ChatThinkingParser();
  let finalText = '';
  for await (const chunk of chatReadStream(response)) {
    const { textDelta } = parser.feed(chunk);
    if (textDelta) finalText += textDelta;
    if (chunk.done) break;
  }
  const flushed = parser.flush();
  if (flushed.textDelta) finalText += flushed.textDelta;
  return finalText.trim();
}

async function* chatReadStream(response) {
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
        try { yield JSON.parse(line); } catch {}
      }
    }
    if (buffer.trim()) {
      try { yield JSON.parse(buffer.trim()); } catch {}
    }
  } finally {
    reader.releaseLock();
  }
}

class ChatThinkingParser {
  constructor() {
    this._buf = '';
    this._inThink = false;
    this._activeTag = null;
  }

  feed(chunk) {
    const nativeThinking = chunk.message?.thinking ?? '';
    const content = chunk.message?.content ?? '';
    let thinkingDelta = nativeThinking;
    let textDelta = '';
    this._buf += content;

    while (this._buf.length > 0) {
      if (!this._inThink) {
        const next = this._findNextTag(this._buf);
        const start = next?.index ?? -1;
        if (start === -1) {
          const hold = Math.max(...ChatPolicy.THINK_TAGS.map(tag => this._partialPrefixLen(this._buf, tag.open)));
          const safe = this._buf.slice(0, this._buf.length - hold);
          textDelta += safe;
          this._buf = this._buf.slice(safe.length);
          break;
        }
        if (start > 0) textDelta += this._buf.slice(0, start);
        this._activeTag = next.tag;
        this._buf = this._buf.slice(start + next.tag.open.length);
        this._inThink = true;
      } else {
        const end = this._buf.indexOf(this._activeTag.close);
        if (end === -1) {
          const hold = this._partialPrefixLen(this._buf, this._activeTag.close);
          const safe = this._buf.slice(0, this._buf.length - hold);
          thinkingDelta += safe;
          this._buf = this._buf.slice(safe.length);
          break;
        }
        thinkingDelta += this._buf.slice(0, end);
        this._buf = this._buf.slice(end + this._activeTag.close.length);
        this._inThink = false;
        this._activeTag = null;
      }
    }
    return { thinkingDelta, textDelta };
  }

  flush() {
    const rem = this._buf;
    this._buf = '';
    return rem ? { thinkingDelta: '', textDelta: rem } : { thinkingDelta: '', textDelta: '' };
  }

  _partialPrefixLen(str, target) {
    const max = Math.min(str.length, target.length - 1);
    for (let len = max; len > 0; len--) {
      if (str.endsWith(target.slice(0, len))) return len;
    }
    return 0;
  }

  _findNextTag(str) {
    const matches = ChatPolicy.THINK_TAGS
      .map(tag => ({ tag, index: str.indexOf(tag.open) }))
      .filter(match => match.index !== -1)
      .sort((a, b) => a.index - b.index);
    return matches[0] ?? null;
  }
}

function chatBuildUserBubble(text, attachments) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message chat-message--user';
  if (attachments.length > 0) {
    const attRow = document.createElement('div');
    attRow.className = 'message-attachments';
    for (const attachment of attachments) {
      const chip = document.createElement('span');
      chip.className = 'attachment-chip attachment-chip--sent';
      chip.textContent = attachment.name;
      attRow.appendChild(chip);
    }
    wrapper.appendChild(attRow);
  }
  if (text) {
    const p = document.createElement('div');
    p.className = 'message-text';
    p.textContent = text;
    wrapper.appendChild(p);
  }
  return wrapper;
}

function chatBuildAssistantBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'chat-message chat-message--assistant';

  const details = document.createElement('details');
  details.className = 'thinking-details';
  details.hidden = true;
  details.open = false;
  details.dataset.streaming = 'true';

  const summary = document.createElement('summary');
  summary.className = 'thinking-summary';
  const summaryMain = document.createElement('span');
  summaryMain.className = 'thinking-summary-main';
  const statusDot = document.createElement('span');
  statusDot.className = 'thinking-status-dot';
  const title = document.createElement('span');
  title.className = 'thinking-title';
  title.textContent = 'Thinking';
  const meta = document.createElement('span');
  meta.className = 'thinking-meta';
  meta.textContent = 'Live';
  summaryMain.append(statusDot, title, meta);
  const preview = document.createElement('span');
  preview.className = 'thinking-preview';
  preview.textContent = 'Reasoning in progress';
  summary.append(summaryMain, preview);

  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'thinking-content md-content';
  const panel = document.createElement('div');
  panel.className = 'thinking-panel';
  const panelInner = document.createElement('div');
  panelInner.className = 'thinking-panel-inner';
  panelInner.appendChild(thinkingEl);
  panel.appendChild(panelInner);
  details.append(summary, panel);

  const responseEl = document.createElement('div');
  responseEl.className = 'message-content md-content';
  const loadingEl = document.createElement('span');
  loadingEl.className = 'chat-loading';
  for (let index = 0; index < 3; index++) {
    const dot = document.createElement('span');
    dot.className = 'chat-loading-dot';
    loadingEl.appendChild(dot);
  }
  responseEl.appendChild(loadingEl);
  bubble.append(details, responseEl);
  return { bubble, details, thinkingEl, responseEl };
}

function chatUpdateThinkingSummary(details, text, streaming) {
  details.dataset.streaming = String(streaming);
  const title = details.querySelector('.thinking-title');
  const meta = details.querySelector('.thinking-meta');
  const preview = details.querySelector('.thinking-preview');
  const compact = text.replace(/\s+/g, ' ').trim();
  const steps = text.split('\n').map(line => line.trim()).filter(Boolean).length;
  if (title) title.textContent = streaming ? 'Thinking' : 'Thought process';
  if (meta) meta.textContent = streaming ? 'Live' : `${steps || 1} update${steps === 1 ? '' : 's'}`;
  if (preview) {
    preview.textContent = compact
      ? (compact.length > 88 ? `${compact.slice(0, 87)}…` : compact)
      : (streaming ? 'Reasoning in progress' : 'Show reasoning');
  }
}

function chatScrollToBottom(session = activeChat()) {
  if (!session.autoScroll) return;
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function chatEstimateChars(session) {
  return session.messages.reduce((total, message) => total + (typeof message.content === 'string' ? message.content.length : 0), 0);
}

async function chatMaybeCondenseContext(session) {
  if (chatEstimateChars(session) < CTX_CHAR_LIMIT) return;
  if (session.messages.length <= CTX_KEEP_RECENT + 1) return;
  const head = session.messages.filter(message => message.role !== 'system').slice(0, -CTX_KEEP_RECENT);
  const tail = session.messages.slice(-CTX_KEEP_RECENT);
  if (head.length < 2) return;
  try {
    const summaryText = await chatSummarizeMessages(session, head.map(chatToRequestMessage));
    session.messages = [{ role: 'system', content: `[Conversation summary]: ${summaryText}` }, ...tail];
    if (session.id === activeChatId) chatInsertContextDivider();
  } catch (err) {
    console.warn('Context summarization failed:', err.message);
  }
}

async function chatSummarizeMessages(session, messages) {
  const source = chatGetActiveSource(session);
  if (!source || source.status !== 'connected') throw new Error('No connected source for summarization');
  const prompt = chatBuildSummaryPrompt(messages);
  const response = await fetch(`/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: source.selectedModel, messages: [{ role: 'user', content: prompt }], stream: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Summarization request failed: HTTP ${response.status}`);
  let summary = '';
  for await (const chunk of chatReadStream(response)) {
    summary += chunk.message?.content ?? '';
    if (chunk.done) break;
  }
  return summary.trim();
}

function chatBuildSummaryPrompt(messages) {
  const transcript = messages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');
  return 'Summarize the following conversation concisely. Preserve all key facts, decisions, user preferences, file names, open questions, and any context needed to continue the conversation naturally. Write only the summary.\n\n' + transcript;
}

function chatInsertContextDivider() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const divider = document.createElement('div');
  divider.className = 'context-divider';
  const span = document.createElement('span');
  span.textContent = 'context summarized';
  divider.appendChild(span);
  el.appendChild(divider);
  chatScrollToBottom(activeChat());
}

function chatSyncButtons() {
  const session = activeChat();
  const sendBtn = document.getElementById('chat-send');
  const stopBtn = document.getElementById('chat-stop');
  if (sendBtn) sendBtn.disabled = session.busy;
  if (stopBtn) stopBtn.classList.toggle('hidden', !session.busy);
}

function chatExportState() {
  return {
    nextChatSeq,
    activeChatId,
    chatNavCollapsed,
    sessions: chatSessions.map(session => ({
      id: session.id,
      title: session.title,
      messages: session.messages.map(message => ({ ...message })),
      attachments: session.attachments.map(attachment => ({ ...attachment })),
      selectedSourceId: session.selectedSourceId,
      selectedPersonaId: session.selectedPersonaId,
      autoScroll: session.autoScroll,
      hasUpdate: session.hasUpdate,
    })),
  };
}

function chatImportState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.sessions)) return;
  nextChatSeq = snapshot.nextChatSeq ?? (snapshot.sessions.length + 1);
  activeChatId = snapshot.activeChatId ?? snapshot.sessions[0]?.id ?? null;
  chatNavCollapsed = Boolean(snapshot.chatNavCollapsed);
  chatSessions = snapshot.sessions.map(session => ({
    id: session.id,
    title: session.title ?? 'Chat',
    messages: Array.isArray(session.messages) ? session.messages.map(message => ({ ...message })) : [],
    attachments: Array.isArray(session.attachments) ? session.attachments.map(attachment => ({ ...attachment })) : [],
    selectedSourceId: session.selectedSourceId ?? null,
    selectedPersonaId: session.selectedPersonaId ?? '',
    busy: false,
    abortController: null,
    autoScroll: session.autoScroll ?? true,
    hasUpdate: session.hasUpdate ?? false,
  }));
  ensureChatSessions();
  chatRenderSessionList();
  chatHydrateActiveSession();
}

window.chatExportState = chatExportState;
window.chatImportState = chatImportState;
