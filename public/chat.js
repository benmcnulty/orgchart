// chat.js — Chat interface: streaming, context management, source selection.
// Depends on: markdown.js (renderMarkdown global), app.js globals (sources,
// displayLabel, defaultSource) — loaded after markdown.js, before app.js.

// ─── Constants ────────────────────────────────────────────────────────────────

const CTX_CHAR_LIMIT = 20000;  // ~5 k tokens; trigger summarization above this
const CTX_KEEP_RECENT = 6;     // messages preserved verbatim after summarization

// ─── State ────────────────────────────────────────────────────────────────────

let chatMessages = [];          // Ollama API format [{role, content, images?}]
let chatAttachments = [];       // [{type, name, data, mimeType?}]
let chatStreaming = false;
let chatAbortController = null;
let chatAutoScroll = true;
let chatSelectedSourceId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

function chatInit(mountEl) {
  mountEl.className = 'chat-body';

  // ── Source selector bar ──
  const sourceBar = document.createElement('div');
  sourceBar.className = 'chat-source-bar';

  const sourceLabel = document.createElement('label');
  sourceLabel.className = 'field-label';
  sourceLabel.textContent = 'Source';
  sourceLabel.htmlFor = 'chat-source-select';

  const sourceSelect = document.createElement('select');
  sourceSelect.id = 'chat-source-select';
  sourceSelect.className = 'chat-source-select';
  sourceSelect.addEventListener('change', e => {
    chatSelectedSourceId = e.target.value || null;
  });

  sourceBar.append(sourceLabel, sourceSelect);

  // ── Messages area ──
  const messagesEl = document.createElement('div');
  messagesEl.id = 'chat-messages';
  messagesEl.className = 'chat-messages';
  messagesEl.setAttribute('role', 'log');
  messagesEl.setAttribute('aria-live', 'polite');

  const emptyEl = document.createElement('div');
  emptyEl.id = 'chat-empty';
  emptyEl.className = 'chat-empty';
  emptyEl.textContent = 'No messages yet. Start a conversation below.';
  messagesEl.appendChild(emptyEl);

  // Track whether the user has manually scrolled up
  messagesEl.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    chatAutoScroll = (scrollHeight - scrollTop - clientHeight) < 60;
  });

  // ── Composer ──
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

  mountEl.append(sourceBar, messagesEl, composer);

  // ── Wire events ──
  btnAttach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    chatHandleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!chatStreaming) chatSend();
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  btnSend.addEventListener('click', () => { if (!chatStreaming) chatSend(); });
  btnStop.addEventListener('click', () => { if (chatAbortController) chatAbortController.abort(); });

  // Refresh source selector whenever sources change (fired by app.js saveSources)
  document.addEventListener('sources-changed', e => {
    chatRefreshSourceSelector(e.detail.sources);
  });

  // Initial population — sources array may not exist yet if chat.js loaded first
  chatRefreshSourceSelector(typeof sources !== 'undefined' ? sources : []);
}

// ─── Source Selector ──────────────────────────────────────────────────────────

function chatRefreshSourceSelector(allSources) {
  const select = document.getElementById('chat-source-select');
  if (!select) return;

  const enabled = allSources.filter(s => s.enabled);
  const prevId = chatSelectedSourceId;

  select.replaceChildren();

  if (enabled.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No sources available';
    select.appendChild(opt);
    chatSelectedSourceId = null;
    return;
  }

  // Determine default: explicit isDefault flag, else first enabled source
  const defaultId = (enabled.find(s => s.isDefault) ?? enabled[0]).id;

  for (const source of enabled) {
    const opt = document.createElement('option');
    opt.value = source.id;
    const label = (typeof displayLabel === 'function') ? displayLabel(source) : source.url;
    const model = source.selectedModel || '';
    const suffix = source.id === defaultId ? ' (default)' : '';
    opt.textContent = model ? `${label} • ${model}${suffix}` : `${label}${suffix}`;
    select.appendChild(opt);
  }

  // Restore previous selection if still valid, otherwise use default
  const restore = (prevId && enabled.some(s => s.id === prevId)) ? prevId : defaultId;
  select.value = restore;
  chatSelectedSourceId = restore;
}

function chatGetActiveSource() {
  if (typeof sources === 'undefined') return null;
  const id = chatSelectedSourceId;
  if (id) return sources.find(s => s.id === id && s.enabled) ?? null;
  return sources.find(s => s.enabled) ?? null;
}

// ─── File Handling ────────────────────────────────────────────────────────────

function chatHandleFiles(files) {
  if (!files.length) return;
  let pending = files.length;

  for (const file of files) {
    const reader = new FileReader();

    if (file.type.startsWith('image/')) {
      reader.onload = e => {
        const dataUrl = e.target.result;
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        chatAttachments.push({ type: 'image', name: file.name, data: base64, mimeType: file.type });
        if (--pending === 0) chatRenderAttachmentChips();
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = e => {
        chatAttachments.push({ type: 'text', name: file.name, data: e.target.result });
        if (--pending === 0) chatRenderAttachmentChips();
      };
      reader.readAsText(file);
    }
  }
}

function chatRenderAttachmentChips() {
  const bar = document.getElementById('chat-attachments');
  if (!bar) return;

  bar.replaceChildren();

  if (chatAttachments.length === 0) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');

  chatAttachments.forEach((att, i) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const nameEl = document.createElement('span');
    nameEl.className = 'attachment-name';
    nameEl.textContent = att.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Remove ${att.name}`);
    removeBtn.addEventListener('click', () => {
      chatAttachments.splice(i, 1);
      chatRenderAttachmentChips();
    });

    chip.append(nameEl, removeBtn);
    bar.appendChild(chip);
  });
}

// ─── Send ─────────────────────────────────────────────────────────────────────

async function chatSend() {
  const textarea = document.getElementById('chat-textarea');
  const rawText = textarea.value.trim();
  const attachments = [...chatAttachments];

  if (!rawText && attachments.length === 0) return;

  const source = chatGetActiveSource();
  if (!source) {
    alert('No inference source available. Add and connect an Ollama server first.');
    return;
  }
  if (source.status !== 'connected') {
    const lbl = (typeof displayLabel === 'function') ? displayLabel(source) : source.url;
    alert(`Source "${lbl}" is not connected yet. Please wait or try reconnecting.`);
    return;
  }

  // Clear input
  textarea.value = '';
  textarea.style.height = 'auto';
  chatAttachments = [];
  chatRenderAttachmentChips();

  // Remove empty-state placeholder
  const empty = document.getElementById('chat-empty');
  if (empty) empty.remove();

  // Build message content: prepend text attachments, collect images
  let content = '';
  const images = [];

  for (const att of attachments) {
    if (att.type === 'text') {
      content += `[Attached: ${att.name}]\n\`\`\`\n${att.data}\n\`\`\`\n\n`;
    } else if (att.type === 'image') {
      images.push(att.data);
    }
  }
  content += rawText;

  const userMsg = { role: 'user', content };
  if (images.length > 0) userMsg.images = images;
  chatMessages.push(userMsg);

  // Render user bubble
  const messagesEl = document.getElementById('chat-messages');
  messagesEl.appendChild(chatBuildUserBubble(rawText, attachments));
  chatScrollToBottom();

  // Create assistant response bubble (thinking + content areas)
  const { bubble, thinkingEl, responseEl } = chatBuildAssistantBubble();
  messagesEl.appendChild(bubble);
  chatScrollToBottom();

  // Lock input
  chatStreaming = true;
  document.getElementById('chat-send').disabled = true;
  document.getElementById('chat-stop').classList.remove('hidden');
  chatAutoScroll = true;
  chatAbortController = new AbortController();

  const parser = new ChatThinkingParser();
  let fullText = '';
  let fullThinking = '';

  try {
    const streamUrl = `/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`;
    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: source.selectedModel,
        messages: chatMessages.slice(),
        stream: true,
      }),
      signal: chatAbortController.signal,
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errBody.error ?? `HTTP ${response.status}`);
    }

    for await (const chunk of chatReadStream(response)) {
      const { thinkingDelta, textDelta } = parser.feed(chunk);

      if (thinkingDelta) {
        fullThinking += thinkingDelta;
        thinkingEl.textContent = fullThinking;
        const details = bubble.querySelector('.thinking-details');
        if (details && fullThinking.trim()) details.hidden = false;
      }

      if (textDelta) {
        fullText += textDelta;
        responseEl.replaceChildren(renderMarkdown(fullText));
      }

      chatScrollToBottom();
      if (chunk.done) break;
    }

    // Flush any partial buffer remaining in the parser
    const { textDelta: tail } = parser.flush();
    if (tail) {
      fullText += tail;
      responseEl.replaceChildren(renderMarkdown(fullText));
    }

  } catch (err) {
    if (err.name !== 'AbortError') {
      const errEl = document.createElement('p');
      errEl.className = 'message-error';
      errEl.textContent = `Error: ${err.message}`;
      responseEl.replaceChildren(errEl);
      fullText = `[Error: ${err.message}]`;
    }
  }

  // Update thinking summary to indicate it's complete
  if (fullThinking.trim()) {
    const summary = bubble.querySelector('.thinking-summary');
    if (summary) summary.textContent = 'Thinking';
  }

  // Push complete assistant message to history
  chatMessages.push({ role: 'assistant', content: fullText });

  // Restore input
  chatStreaming = false;
  document.getElementById('chat-send').disabled = false;
  document.getElementById('chat-stop').classList.add('hidden');
  chatAbortController = null;

  // Background context compression check
  chatMaybeCondenseContext();
}

// ─── Stream Reading ───────────────────────────────────────────────────────────

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
        try { yield JSON.parse(line); } catch { /* skip malformed lines */ }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      try { yield JSON.parse(buffer.trim()); } catch { /* ignore */ }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── ThinkingParser ───────────────────────────────────────────────────────────
// Handles both native `thinking` field (Ollama 0.7+) and inline <think>…</think>
// tags (DeepSeek-R1 and similar). Correctly handles tags split across chunks.

class ChatThinkingParser {
  constructor() {
    this._buf = '';      // unconsumed content from current chunk
    this._inThink = false;
  }

  feed(chunk) {
    // Native thinking field takes priority
    const nativeThinking = chunk.message?.thinking ?? '';
    const content = chunk.message?.content ?? '';

    let thinkingDelta = nativeThinking;
    let textDelta = '';

    this._buf += content;

    while (this._buf.length > 0) {
      if (!this._inThink) {
        const start = this._buf.indexOf('<think>');
        if (start === -1) {
          // No opening tag — hold back any partial '<think>' prefix
          const hold = this._partialPrefixLen(this._buf, '<think>');
          const safe = this._buf.slice(0, this._buf.length - hold);
          textDelta += safe;
          this._buf = this._buf.slice(safe.length);
          break;
        }
        if (start > 0) {
          textDelta += this._buf.slice(0, start);
        }
        this._buf = this._buf.slice(start + 7); // skip '<think>'
        this._inThink = true;
      } else {
        const end = this._buf.indexOf('</think>');
        if (end === -1) {
          const hold = this._partialPrefixLen(this._buf, '</think>');
          const safe = this._buf.slice(0, this._buf.length - hold);
          thinkingDelta += safe;
          this._buf = this._buf.slice(safe.length);
          break;
        }
        thinkingDelta += this._buf.slice(0, end);
        this._buf = this._buf.slice(end + 8); // skip '</think>'
        this._inThink = false;
      }
    }

    return { thinkingDelta, textDelta };
  }

  flush() {
    const rem = this._buf;
    this._buf = '';
    return rem ? { thinkingDelta: '', textDelta: rem } : { thinkingDelta: '', textDelta: '' };
  }

  // Returns the length of the longest suffix of str that is a prefix of target,
  // up to target.length - 1. Used to hold back possible partial tag boundaries.
  _partialPrefixLen(str, target) {
    const max = Math.min(str.length, target.length - 1);
    for (let len = max; len > 0; len--) {
      if (str.endsWith(target.slice(0, len))) return len;
    }
    return 0;
  }
}

// ─── Message Bubble Builders ──────────────────────────────────────────────────

function chatBuildUserBubble(text, attachments) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message chat-message--user';

  if (attachments.length > 0) {
    const attRow = document.createElement('div');
    attRow.className = 'message-attachments';
    for (const att of attachments) {
      const chip = document.createElement('span');
      chip.className = 'attachment-chip attachment-chip--sent';
      chip.textContent = att.name;
      attRow.appendChild(chip);
    }
    wrapper.appendChild(attRow);
  }

  if (text) {
    const p = document.createElement('div');
    p.className = 'message-text';
    p.textContent = text; // textContent — safe against XSS
    wrapper.appendChild(p);
  }

  return wrapper;
}

function chatBuildAssistantBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'chat-message chat-message--assistant';

  // Thinking section — hidden until content arrives
  const details = document.createElement('details');
  details.className = 'thinking-details';
  details.hidden = true;
  details.open = true;

  const summary = document.createElement('summary');
  summary.className = 'thinking-summary';
  summary.textContent = 'Thinking…';

  const thinkingEl = document.createElement('pre');
  thinkingEl.className = 'thinking-content';

  details.append(summary, thinkingEl);

  // Response content — updated via replaceChildren(renderMarkdown(text))
  const responseEl = document.createElement('div');
  responseEl.className = 'message-content md-content';

  bubble.append(details, responseEl);

  return { bubble, thinkingEl, responseEl };
}

// ─── Auto-scroll ──────────────────────────────────────────────────────────────

function chatScrollToBottom() {
  if (!chatAutoScroll) return;
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

// ─── Context Management ───────────────────────────────────────────────────────

function chatEstimateChars() {
  return chatMessages.reduce(
    (acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0),
    0,
  );
}

async function chatMaybeCondenseContext() {
  if (chatEstimateChars() < CTX_CHAR_LIMIT) return;
  if (chatMessages.length <= CTX_KEEP_RECENT + 1) return;

  const head = chatMessages.filter(m => m.role !== 'system').slice(0, -CTX_KEEP_RECENT);
  const tail = chatMessages.slice(-CTX_KEEP_RECENT);

  if (head.length < 2) return;

  try {
    const summaryText = await chatSummarizeMessages(head);
    chatMessages = [
      { role: 'system', content: `[Conversation summary]: ${summaryText}` },
      ...tail,
    ];
    chatInsertContextDivider();
  } catch (err) {
    console.warn('Context summarization failed:', err.message);
  }
}

async function chatSummarizeMessages(messages) {
  const source = chatGetActiveSource();
  if (!source || source.status !== 'connected') throw new Error('No connected source for summarization');

  const prompt = chatBuildSummaryPrompt(messages);

  const streamUrl = `/api/stream?url=${encodeURIComponent(source.url + '/api/chat')}`;
  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: source.selectedModel,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
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

// ─── Summarization Prompt ─────────────────────────────────────────────────────
// This function defines how old conversation history is condensed when the
// context window fills up. The summary replaces all prior messages, so what
// you preserve here determines the "memory" of the conversation.
//
// TODO: Customize this prompt to fit your use case. Consider what details
// are most important to retain — facts, decisions, tone, user preferences,
// file names, open questions, etc.
//
// messages: Array<{role: 'user'|'assistant', content: string}>
// return:   string — the full prompt sent to the model
//
function chatBuildSummaryPrompt(messages) {
  const transcript = messages
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  return (
    'Summarize the following conversation concisely. Preserve all key facts, ' +
    'decisions, user preferences, file names, open questions, and any context ' +
    'needed to continue the conversation naturally. Write only the summary — ' +
    'no preamble, no commentary.\n\n' +
    transcript
  );
}

// ─── Context Divider ──────────────────────────────────────────────────────────

function chatInsertContextDivider() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const divider = document.createElement('div');
  divider.className = 'context-divider';
  const span = document.createElement('span');
  span.textContent = 'context summarized';
  divider.appendChild(span);
  el.appendChild(divider);
  chatScrollToBottom();
}
