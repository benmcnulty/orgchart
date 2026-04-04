// markdown.js — Lightweight markdown renderer.
// Returns a DocumentFragment built entirely with DOM methods — no innerHTML.
// Safe to pass directly to element.replaceChildren().

function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;

  // ── Phase 1: Extract fenced code blocks ──────────────────────────────────
  // Protects verbatim content from inline processing.
  const fences = [];
  const src = text.replace(/```([\w.-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    fences.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
    return `\x02${fences.length - 1}\x03`;
  });

  // ── Phase 2: Line-by-line block pass ─────────────────────────────────────
  const lines = src.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence placeholder
    const fenceM = /^\x02(\d+)\x03$/.exec(line.trim());
    if (fenceM) {
      const { lang, code } = fences[+fenceM[1]];
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      if (lang) codeEl.className = `language-${lang}`;
      codeEl.textContent = code; // verbatim — never innerHTML
      pre.appendChild(codeEl);
      frag.appendChild(pre);
      i++;
      continue;
    }

    // Blank line — paragraph separator
    if (!line.trim()) { i++; continue; }

    // ATX headers (# through ######)
    const hm = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hm) {
      const h = document.createElement(`h${hm[1].length}`);
      inlineInto(h, hm[2]);
      frag.appendChild(h);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      frag.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bq = document.createElement('blockquote');
      const parts = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        parts.push(lines[i].slice(2));
        i++;
      }
      inlineInto(bq, parts.join('\n'));
      frag.appendChild(bq);
      continue;
    }

    // Unordered list
    if (/^[*\-+] /.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^[*\-+] /.test(lines[i])) {
        const li = document.createElement('li');
        inlineInto(li, lines[i].slice(2));
        ul.appendChild(li);
        i++;
      }
      frag.appendChild(ul);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const ol = document.createElement('ol');
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const li = document.createElement('li');
        inlineInto(li, lines[i].replace(/^\d+\. /, ''));
        ol.appendChild(li);
        i++;
      }
      frag.appendChild(ol);
      continue;
    }

    // Paragraph — accumulate consecutive non-special lines
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        !l.trim() ||
        /^#{1,6} /.test(l) ||
        /^[>*\-+] /.test(l) ||
        /^\d+\. /.test(l) ||
        /^---+\s*$/.test(l) ||
        /^\x02\d+\x03$/.test(l.trim())
      ) break;
      paraLines.push(l);
      i++;
    }
    if (paraLines.length > 0) {
      const p = document.createElement('p');
      inlineInto(p, paraLines.join('\n'));
      frag.appendChild(p);
    }
  }

  return frag;
}

// Appends inline-rendered nodes to parent.
// Splits multi-line text on \n and inserts <br> between lines.
function inlineInto(parent, text) {
  if (!text) return;
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) parent.appendChild(document.createElement('br'));
    inlineSegment(parent, parts[i]);
  }
}

// Tokenises a single line of inline markdown and appends DOM nodes to parent.
// All user text is set via textContent / createTextNode — never innerHTML.
// Uses matchAll() for safe iteration over all inline pattern matches.
function inlineSegment(parent, text) {
  if (!text) return;
  let plain = '';
  let i = 0;

  while (i < text.length) {
    const token = parseInlineToken(text, i);
    if (!token) {
      plain += text[i];
      i++;
      continue;
    }

    if (plain) {
      parent.appendChild(document.createTextNode(plain));
      plain = '';
    }

    parent.appendChild(token.node);
    i = token.end;
  }

  if (plain) parent.appendChild(document.createTextNode(plain));
}

function parseInlineToken(text, start) {
  if (text.startsWith('`', start)) {
    const end = text.indexOf('`', start + 1);
    if (end > start + 1) {
      const code = document.createElement('code');
      code.textContent = text.slice(start + 1, end);
      return { node: code, end: end + 1 };
    }
  }

  if (text.startsWith('[', start)) {
    const closeLabel = text.indexOf(']', start + 1);
    if (closeLabel !== -1 && text[closeLabel + 1] === '(') {
      const closeHref = text.indexOf(')', closeLabel + 2);
      if (closeHref !== -1) {
        const label = text.slice(start + 1, closeLabel);
        const href = text.slice(closeLabel + 2, closeHref);
        if (/^https?:\/\//i.test(href)) {
          const a = document.createElement('a');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          inlineSegment(a, label);
          return { node: a, end: closeHref + 1 };
        }
      }
    }
  }

  for (const marker of ['**', '__', '~~']) {
    if (!text.startsWith(marker, start)) continue;
    const end = findClosingMarker(text, marker, start + marker.length);
    if (end === -1) continue;

    const tag = marker === '~~' ? 's' : 'strong';
    const node = document.createElement(tag);
    inlineSegment(node, text.slice(start + marker.length, end));
    return { node, end: end + marker.length };
  }

  for (const marker of ['*', '_']) {
    if (!text.startsWith(marker, start)) continue;
    const end = findClosingMarker(text, marker, start + 1);
    if (end === -1) continue;

    const node = document.createElement('em');
    inlineSegment(node, text.slice(start + 1, end));
    return { node, end: end + 1 };
  }

  return null;
}

function findClosingMarker(text, marker, from) {
  let idx = from;
  while ((idx = text.indexOf(marker, idx)) !== -1) {
    const inner = text.slice(from, idx);
    if (/\S/.test(inner)) return idx;
    idx += marker.length;
  }
  return -1;
}
