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
    const hm = /^(#{1,6}) (.+)/.exec(line);
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

  // Patterns ordered longest/most-specific first to avoid partial matches.
  // Inline code must come before bold/italic so backtick content is protected.
  const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|\[([^\]]+)\]\(([^)]+)\))/g;

  let last = 0;

  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    }

    const raw = m[0];

    if (raw.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = raw.slice(1, -1);
      parent.appendChild(code);
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      const strong = document.createElement('strong');
      strong.textContent = raw.slice(2, -2);
      parent.appendChild(strong);
    } else if (raw.startsWith('~~')) {
      const s = document.createElement('s');
      s.textContent = raw.slice(2, -2);
      parent.appendChild(s);
    } else if (raw.startsWith('*') || raw.startsWith('_')) {
      const em = document.createElement('em');
      em.textContent = raw.slice(1, -1);
      parent.appendChild(em);
    } else if (raw.startsWith('[')) {
      const label = m[2];
      const href = m[3];
      if (/^https?:\/\//i.test(href)) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = label;
        parent.appendChild(a);
      } else {
        // Non-http/https URLs render as plain text (no clickable links)
        parent.appendChild(document.createTextNode(raw));
      }
    }

    last = m.index + raw.length;
  }

  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}
