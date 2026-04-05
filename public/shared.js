// shared.js — Shared utilities used across all OrgChart modules.
// OrgChart: Paper Dolls for Corporate Theater — MIT © 2026 Ben McNulty
//
// Loaded first in index.html. References state variables (boardNotifications,
// notificationDrawerOpen, saveIndicatorTimer) that are declared in app.js —
// this works because all <script> tags share the same browser global scope,
// and these functions are called after app.js has initialised those variables.

// ─── Fetch Utilities ──────────────────────────────────────────────────────────

async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

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

// ─── Text + Status Utilities ──────────────────────────────────────────────────

function clampText(text, length = 72) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact;
}

function navStatusGlyph(status, fallback = '◻') {
  if (status === 'processing') return '…';
  if (status === 'attention') return '🔔';
  return fallback;
}

// ─── Save Indicator ───────────────────────────────────────────────────────────

// setSaveIndicator references saveIndicatorTimer declared in app.js (global scope).
function setSaveIndicator(state = 'idle', message = '') {
  const button = document.getElementById('save-indicator');
  const label = document.getElementById('save-indicator-label');
  if (!button) return;
  if (saveIndicatorTimer) {
    clearTimeout(saveIndicatorTimer);
    saveIndicatorTimer = null;
  }
  button.dataset.state = state;
  if (label) {
    label.textContent = message || (
      state === 'error' ? 'Save failed'
        : state === 'saved' ? 'Saved'
          : state === 'saving' ? 'Saving…'
            : 'Saved'
    );
  }
  if (state === 'saved' || state === 'error') {
    saveIndicatorTimer = setTimeout(() => {
      const current = document.getElementById('save-indicator');
      if (!current) return;
      current.dataset.state = 'idle';
      const currentLabel = document.getElementById('save-indicator-label');
      if (currentLabel) currentLabel.textContent = 'Saved';
    }, 1800);
  }
}

// ─── Board Notifications ──────────────────────────────────────────────────────

// All three functions reference boardNotifications / notificationDrawerOpen
// declared in app.js (global scope).

function unreadBoardNotificationCount() {
  return boardNotifications.filter(item => !item.read).length;
}

function renderBoardNotifications() {
  const badge = document.getElementById('board-notification-count');
  const drawer = document.getElementById('board-notification-drawer');
  const list = document.getElementById('board-notification-list');
  const button = document.getElementById('board-notification-btn');
  const empty = document.getElementById('board-notification-empty');
  const unread = unreadBoardNotificationCount();
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = unread === 0;
  }
  if (button) button.dataset.hasUnread = unread > 0 ? 'true' : 'false';
  if (drawer) drawer.hidden = !notificationDrawerOpen;
  if (!list || !empty) return;
  if (!boardNotifications.length) {
    list.replaceChildren();
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.replaceChildren(...boardNotifications.map(item => {
    const entry = document.createElement('article');
    entry.className = `board-notification${item.read ? '' : ' board-notification--unread'}`;
    const top = document.createElement('div');
    top.className = 'board-notification-top';
    const copy = document.createElement('div');
    copy.className = 'board-notification-copy';
    const title = document.createElement('p');
    title.className = 'board-notification-title';
    title.textContent = item.title;
    const meta = document.createElement('p');
    meta.className = 'board-notification-meta';
    meta.textContent = `${item.source || 'system'} • ${new Date(item.createdAt).toLocaleString()}`;
    copy.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'board-notification-actions';
    const markBtn = document.createElement('button');
    markBtn.type = 'button';
    markBtn.className = 'btn-secondary';
    markBtn.textContent = item.read ? 'Unread' : 'Read';
    markBtn.addEventListener('click', () => {
      item.read = !item.read;
      renderBoardNotifications();
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn-secondary';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      boardNotifications = boardNotifications.filter(entryItem => entryItem.id !== item.id);
      renderBoardNotifications();
    });
    actions.append(markBtn, clearBtn);
    top.append(copy, actions);
    const body = document.createElement('p');
    body.className = 'board-notification-body';
    body.textContent = item.message;
    entry.append(top, body);
    return entry;
  }));
}

function pushBoardNotification({ title, message, source = 'facilitator' }) {
  boardNotifications.unshift({
    id: `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: title || 'Board update',
    message: message || '',
    source,
    createdAt: new Date().toISOString(),
    read: false,
  });
  boardNotifications = boardNotifications.slice(0, 50);
  notificationDrawerOpen = true;
  renderBoardNotifications();
}

// ─── Panel Builder ────────────────────────────────────────────────────────────

// Creates a collapsible panel. Returns { panel, body, actionsLeft, actionsRight,
// setCollapsed } so the caller can populate the body and add header action buttons.
function createPanel(id, title) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = id;

  const header = document.createElement('div');
  header.className = 'panel-header';

  // The toggle button wraps only the chevron + title — action buttons sit
  // outside it as siblings to avoid invalid nested-button HTML.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'panel-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', `${id}-body`);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.textContent = '>';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'panel-title';
  titleSpan.textContent = title;

  toggle.append(chevron, titleSpan);
  header.append(toggle);

  const body = document.createElement('div');
  body.className = 'panel-body';
  body.id = `${id}-body`;

  const actionRow = document.createElement('div');
  actionRow.className = 'panel-actions-row';

  const actionsLeft = document.createElement('div');
  actionsLeft.className = 'panel-header-actions panel-header-actions--left';

  const actionsRight = document.createElement('div');
  actionsRight.className = 'panel-header-actions panel-header-actions--right';

  const content = document.createElement('div');
  content.className = 'panel-content';

  actionRow.append(actionsLeft, actionsRight);
  body.append(actionRow, content);

  const setCollapsed = collapsed => {
    panel.classList.toggle('panel--collapsed', collapsed);
    body.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };

  toggle.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('panel--collapsed'));
  });

  setCollapsed(true);
  panel.append(header, body);
  return { panel, body: content, actionsLeft, actionsRight, setCollapsed };
}

// ─── DOM Helper ───────────────────────────────────────────────────────────────

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
