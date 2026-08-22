// ==UserScript==
// @name         ChatGPT Markdown & LaTeX Copier
// @namespace    https://github.com/chatgpt-markdown-latex-copier
// @version      1.0.0
// @description  Tampermonkey userscript for copying GPT web responses as Markdown with inline and display LaTeX.
// @author       Open-source contributors
// @license      MIT
// @match        *://*.chatgpt.com/*
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // User settings
  // ==========================================
  const settings = {
    // true  = compact output: remove redundant paragraph spacing (default)
    // false = standard output: preserve Markdown paragraph spacing
    compactMode: true
  };
  // ==========================================

  // --- 1. UI Styles ---
  try {
    GM_addStyle(`
      .chatgpt-markdown-copy-toast { position: fixed; left: 50%; bottom: 10%; transform: translateX(-50%); z-index: 2147483647; padding: 10px 18px; border-radius: 8px; background: rgba(0, 0, 0, 0.85); color: #fff; font-size: 13px; font-weight: bold; pointer-events: none; box-shadow: 0 8px 24px rgba(0,0,0,0.3); transition: opacity 0.2s ease; opacity: 0; }
      .chatgpt-markdown-copy-tooltip { position: fixed; background: rgba(0, 0, 0, 0.9); color: #00ffcc; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-family: monospace; z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity 0.2s; max-width: 80vw; word-wrap: break-word; white-space: pre-wrap; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); }
    `);
  } catch (err) {
    // Clipboard conversion does not depend on the optional toast styling.
  }

  let tooltipElement = null;
  const ensureTooltipElement = () => {
    if (tooltipElement || !document.body) return tooltipElement;
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'chatgpt-markdown-copy-tooltip';
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  };

  // At document-start the body may not exist yet; create the tooltip as soon
  // as parsing finishes, while copy/keydown listeners are already active.
  if (document.body) ensureTooltipElement();
  else document.addEventListener('DOMContentLoaded', ensureTooltipElement, { once: true });

  const showStatusToast = message => {
    if (!document.body) return;
    const toastElement = document.createElement('div');
    toastElement.className = 'chatgpt-markdown-copy-toast';
    toastElement.textContent = message;
    document.body.appendChild(toastElement);
    void toastElement.offsetWidth; toastElement.style.opacity = '1';
    setTimeout(() => { toastElement.style.opacity = '0'; setTimeout(() => toastElement.remove(), 200); }, 1200);
  };

  // --- 2. Core Math Logic ---
  const mathElementSelector = 'math, mjx-container, [role="math"], [data-math-source], [data-math], [data-latex], [data-tex], [data-formula], [data-math-display], [data-client-katex-layout], [data-display-mode], .katex-display, .katex, .MathJax, .math-block, .math-inline, [class*="math-inline"], [class*="math-block"], span.math, span.ztext-math, [data-custom-copy-text], [class*="formula"], .mjx-math';
  const sourceMathSelector = 'math, mjx-container, [role="math"], [data-math-source], [data-math], [data-latex], [data-tex], [data-formula], [data-custom-copy-text], .katex-display, .katex, .MathJax, .math-block, .math-inline, [class*="math-inline"], [class*="math-block"], span.math, span.ztext-math, .mjx-math';
  const mathContextAttribute = 'data-gpt-md-math-context';

  const getMathSource = (el) => {
    const attrs = ['data-math-source', 'data-math', 'data-latex', 'data-tex', 'data-formula', 'data-value', 'data-copy-text', 'data-custom-copy-text'];

    const readAttrs = node => {
      for (const attr of attrs) {
        if (node.hasAttribute(attr)) {
          const value = node.getAttribute(attr);
          if (value !== null && String(value).trim() !== '') return { value };
        }
      }
      return null;
    };

    // Prefer the element's own metadata before walking upward.  A renderer
    // may put a generic copy attribute on a message container; taking that
    // ancestor value first can swallow the actual formula/its display mode.
    const direct = readAttrs(el);
    if (direct) return direct.value;

    // Current ChatGPT keeps the TeX on a semantic ancestor of `.katex`, not
    // inside the rendered node.  Resolve that ancestor explicitly before
    // looking for legacy MathML annotations.
    const semanticAncestor = el.closest('[data-math-source], [role="math"]');
    if (semanticAncestor && semanticAncestor !== el) {
      const source = readAttrs(semanticAncestor);
      if (source) return source.value;
      if (semanticAncestor.getAttribute('role') === 'math') {
        const semanticAria = semanticAncestor.getAttribute('aria-label');
        if (semanticAria && /[\\^_{}$]|[()'`]/.test(semanticAria)) return semanticAria;
      }
    }

    let childWithData = el.querySelector('[data-math-source], [data-custom-copy-text], [data-latex], [data-tex], [data-formula], [data-math]');
    if (childWithData) {
      for (let attr of attrs) {
        if (childWithData.hasAttribute(attr)) {
          const value = childWithData.getAttribute(attr);
          if (value !== null && String(value).trim() !== '') return value;
        }
      }
    }

    let ann = el.querySelector('annotation[encoding="application/x-tex"], script[type^="math/tex"]');
    if (ann && ann.textContent) return ann.textContent;

    let aria = el.getAttribute('aria-label');
    if (aria && (aria.includes('\\') || aria.includes('^') || aria.includes('_') || aria.includes('$') || /[()'`]/.test(aria))) {
        return aria;
    }

    if (el.tagName.toLowerCase() === 'math' && el.hasAttribute('alttext')) {
        return el.getAttribute('alttext');
    }

    let node = el.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 4) {
      const ancestor = readAttrs(node);
      if (ancestor) return ancestor.value;
      node = node.parentElement;
      depth++;
    }

    // Last-resort compatibility for a renderer that renames its source
    // attribute.  Only inspect the math node and inline semantic ancestors;
    // never borrow bookkeeping/text attributes from the surrounding `<p>` or
    // message container.
    const ignoredHeuristicAttrs = new Set([
      'class', 'id', 'style', 'role', 'aria-hidden', 'data-start', 'data-end',
      'data-state', 'data-testid', 'data-index', 'data-id', 'data-node-id',
      'data-placeholder', 'data-client-katex-layout'
    ]);
    const hasTexShape = value => /[\\^_{}]/.test(value);
    let probe = el;
    depth = 0;
    while (probe && depth < 5) {
      const tag = probe.tagName?.toUpperCase();
      if (depth > 0 && ['P', 'DIV', 'SECTION', 'ARTICLE', 'LI'].includes(tag)) break;

      const ariaValue = probe.getAttribute?.('aria-label') || '';
      for (const attr of Array.from(probe.attributes || [])) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '').trim();
        if (!value || ignoredHeuristicAttrs.has(name) || name.startsWith('aria-')) continue;
        if (hasTexShape(value)) return value;
        if (ariaValue && value === ariaValue && /[()'`]/.test(value)) return value;
      }

      probe = probe.parentElement;
      depth++;
    }

    return null;
  };

  const blockMathSelector = [
    '.katex-display',
    '.math-block',
    '[class*="math-block"]',
    '.math-display',
    '[class*="math-display"]',
    '.display-math',
    '[class*="display-math"]',
    '.MathJax_Display',
    'mjx-container[display="true"]',
    'mjx-container[display="block"]',
    '[data-display="block"]',
    '[data-display-mode="block"]',
    '[data-display-mode="true"]',
    '[data-math-display="block"]'
  ].join(', ');

  const isBlockMathElement = (el) => {
    // Selection cloning can drop the outer `.katex-display`/MathJax wrapper.
    // A temporary marker copied from the original DOM preserves that context.
    const markedContext = el.getAttribute(mathContextAttribute);
    if (markedContext === 'block') return true;
    if (markedContext === 'inline') return false;

    const display = el.getAttribute('display');
    if (display === 'block' || display === 'true') return true;

    const dataDisplay = el.getAttribute('data-display-mode') || el.getAttribute('data-display') || el.getAttribute('data-math-display');
    if (dataDisplay === 'block' || dataDisplay === 'true') return true;

    const clientLayout = (el.getAttribute('data-client-katex-layout') || '').toLowerCase();
    if (!clientLayout.includes('inline') && (clientLayout.includes('block') || clientLayout.includes('display') || clientLayout === 'true' || clientLayout.includes('center'))) return true;

    const inlineStyle = el.getAttribute('style') || '';
    if (/\bdisplay\s*:\s*(block|flex|grid|table)\b/i.test(inlineStyle)) return true;

    if (typeof getComputedStyle === 'function') {
      try {
        const computedDisplay = getComputedStyle(el).display;
        if (['block', 'flex', 'grid', 'table', 'table-row', 'list-item'].includes(computedDisplay)) return true;
      } catch (err) { /* detached/custom elements may not have computed style */ }
    }

    if (el.closest(blockMathSelector)) return true;
    if (el.querySelector(blockMathSelector)) return true;

    const semanticLayout = el.closest('[role="math"], [data-math-source], [data-client-katex-layout]');
    if (semanticLayout) {
      const semanticStyle = semanticLayout.getAttribute('style') || '';
      if (/\bdisplay\s*:\s*(block|flex|grid|table)\b/i.test(semanticStyle)) return true;
    }

    // Inline markers are a fallback only after checking block context.  Some
    // renderers put `display="inline"` on MathML nested inside a block wrapper.
    if (display === 'inline' || display === 'false') return false;
    if (dataDisplay === 'inline' || dataDisplay === 'false') return false;
    if (clientLayout.includes('inline') || clientLayout === 'false') return false;
    return false;
  };

  const decodeHtmlEntities = t => {
    if (!t) return '';
    let val = document.createElement('textarea');
    val.innerHTML = t;
    return val.value;
  };

  // Keep explicit delimiters when a renderer exposes them in an attribute or
  // annotation.  Context-based detection is used only when no delimiter is
  // present, so a standalone inline formula is not promoted to a block.
  const parseDelimitedMath = raw => {
    const value = decodeHtmlEntities(raw).trim();
    const delimiters = [
      { open: '$$', close: '$$', block: true },
      { open: '\\[', close: '\\]', block: true },
      { open: '$', close: '$', block: false },
      { open: '\\(', close: '\\)', block: false }
    ];

    for (const delimiter of delimiters) {
      // Do not let the single-dollar rule partially match malformed or
      // double-dollar input (for example `$$x$` or `$x$$`).
      if (delimiter.open === '$' && (value.startsWith('$$') || value.endsWith('$$'))) continue;
      if (!value.startsWith(delimiter.open) || !value.endsWith(delimiter.close)) continue;
      const start = delimiter.open.length;
      const end = value.length - delimiter.close.length;
      if (end < start) continue;
      return { tex: value.slice(start, end).trim(), block: delimiter.block };
    }
    return null;
  };

  const cleanMathSource = t => {
    const explicit = parseDelimitedMath(t);
    if (explicit) return explicit.tex;
    return decodeHtmlEntities(t).trim();
  };

  const formatMathElement = (el) => {
    let raw = getMathSource(el);
    if (!raw) {
      // Do not silently wrap rendered glyphs (or spoken aria text) as TeX
      // when a semantic math node has no recoverable source.
      const semanticMath = el.matches(sourceMathSelector);
      if (semanticMath) return null;
      raw = el.textContent;
    }

    const explicit = parseDelimitedMath(raw);
    let tex = explicit ? explicit.tex : cleanMathSource(raw);
    if (!tex) return null;

    // A renderer's display marker is more reliable than a generic `$...$`
    // string exposed through a copy/aria attribute.  Any strong block signal
    // therefore wins; explicit `$$...$$`/`\[...\]` remains block as well.
    let block = Boolean((explicit && explicit.block) || isBlockMathElement(el));
    return block ? `$$\n${tex}\n$$` : `$${tex}$`;
  };

  const normalizeTextContent = content => content
    // Normalize whitespace in prose while leaving display-math line breaks
    // untouched.  The old `/\s+/g` also flattened the body of `$$ ... $$`.
    .split(/(\$\$[\s\S]*?\$\$)/g)
    .map((part, index) => index % 2 ? part : part.replace(/\s+/g, ' '))
    .join('')
    .trim();

  // --- 3. Markdown Engine ---
  const serializeNode = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    let tag = node.tagName.toLowerCase(), e = node;

    if (e.matches('button,svg,style,script') || e.getAttribute('aria-hidden')==='true') return '';

    if (e.matches(mathElementSelector)) {
      if (e.parentElement?.closest(mathElementSelector)) return '';
      let mathStr = formatMathElement(e);
      if (mathStr) {
          return mathStr.startsWith('$$') ? `\n\n${mathStr}\n\n` : mathStr;
      }
      if (e.matches(sourceMathSelector)) return '';
    }

    if (tag === 'pre') {
      let code = e.querySelector('code'), lang = code?.className.match(/language-(\w+)/)?.[1] || '';
      return `\n\n\`\`\`${lang}\n${(code||e).textContent.replace(/\n$/,'')}\n\`\`\`\n\n`;
    }
    if (tag === 'code') return e.closest('pre') ? '' : `\`${e.textContent}\``;
    if (tag === 'a') return e.href.startsWith('javascript:') ? e.textContent : `[${Array.from(e.childNodes).map(serializeNode).join('')}](${e.href})`;
    if (tag === 'img') return `![${e.alt||''}](${e.src||''})`;
    if (tag === 'strong' || tag === 'b') return `**${Array.from(e.childNodes).map(serializeNode).join('')}**`;
    if (tag === 'em' || tag === 'i') return `*${Array.from(e.childNodes).map(serializeNode).join('')}*`;
    if (tag === 'p') {
      const content = Array.from(e.childNodes).map(serializeNode).join('');
      return `${normalizeTextContent(content)}\n\n`;
    }
    if (tag === 'blockquote') return Array.from(e.childNodes).map(serializeNode).join('').trim().split('\n').map(l=>`> ${l}`).join('\n')+'\n\n';

    if (tag === 'ul' || tag === 'ol') {
      let i = 1;
      return '\n' + Array.from(e.children).filter(c=>c.tagName==='LI').map(li =>
        `${tag==='ol'?`${i++}.`:'-'} ${normalizeTextContent(Array.from(li.childNodes).map(serializeNode).join(''))}`
      ).join('\n') + '\n\n';
    }

    if (tag === 'table') {
      let rows = Array.from(e.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(td => {
        // Read cell nodes through the Markdown serializer so formulas inside
        // tables use their source rather than rendered glyph text.
        const cell = normalizeTextContent(Array.from(td.childNodes).map(serializeNode).join(''));
        return cell.replace(/\|/g, '\\|').trim();
      }));
      if(!rows.length) return '';
      let max = Math.max(...rows.map(r=>r.length));
      rows = rows.map(r => { while(r.length<max) r.push(''); return r; });
      let sep = Array(max).fill('---');
      return `\n\n| ${rows[0].join(' | ')} |\n| ${sep.join(' | ')} |\n${rows.slice(1).map(r=>`| ${r.join(' | ')} |`).join('\n')}\n\n`;
    }

    return Array.from(e.childNodes).map(serializeNode).join('');
  };

  const formatMarkdown = (md) => {
    // Keep literal LaTeX-looking text inside fenced code untouched.  The
    // formatter is allowed to normalize math in prose, but must not rewrite
    // a code sample that happens to contain `\[` or `$$`.
    const fencedCode = [];
    let res = md.replace(/```[\s\S]*?```/g, code => {
      const token = `\uE100${fencedCode.length}\uE101`;
      fencedCode.push(code);
      return token;
    })
      .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, body) => `\n\n$$\n${body}\n$$\n\n`)
      .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, body) => `$${body}$`)
      .replace(/(\$\$[\s\S]*?\$\$)/g, block => `\n\n${block}\n\n`)
      .trim();

    // Remove whitespace-only lines, including lines containing only tabs.
    res = res.replace(/^[ \t]+$/gm, '');

    // Protect the complete display-math payload while compacting surrounding
    // whitespace.  This keeps `$$` delimiters and the TeX body on their own
    // lines instead of inserting/removing newlines inside the formula.
    const blockMath = [];
    res = res.replace(/\$\$[\s\S]*?\$\$/g, block => {
      const token = `\uE000${blockMath.length}\uE001`;
      blockMath.push(block);
      return token;
    });

    if (settings.compactMode) {
      // Collapse repeated line breaks in compact mode.
      res = res.replace(/\n{2,}/g, '\n');

      // Restore the blank lines required around Markdown block elements.
      const blockToken = '(?:\\uE000\\d+\\uE001|\\uE100\\d+\\uE101)';
      res = res.replace(new RegExp(`([^\\n])\\n(${blockToken})`, 'g'), '$1\n\n$2')
               .replace(new RegExp(`(${blockToken})\\n([^\\n])`, 'g'), '$1\n\n$2')
               .replace(/([^\n])\n(```)/g, '$1\n\n$2')
               .replace(/(```)\n([^\n])/g, '$1\n\n$2')
               .replace(/([^\n])\n(\| )/g, '$1\n\n$2');
    } else {
      res = res.replace(/\n{3,}/g, '\n\n');
    }

    return res
      .replace(/\uE000(\d+)\uE001/g, (_, index) => blockMath[Number(index)] || '')
      .replace(/\uE100(\d+)\uE101/g, (_, index) => fencedCode[Number(index)] || '')
      .trim();
  };

  // --- 4. Event Hooks ---
  const editableElementSelector = 'textarea, input, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], #prompt-textarea, #chat-input';
  const mathContextSelector = 'math, mjx-container, [role="math"], [data-math-source], [data-math], [data-latex], [data-tex], [data-formula], [data-math-display], [data-client-katex-layout], [data-display-mode], .katex-display, .katex, .MathJax, .math-block, .math-inline, [class*="math-inline"], [class*="math-block"], [class*="math-display"], span.math, span.ztext-math, [data-custom-copy-text], [class*="formula"], .mjx-math';

  const isLikelyMathContext = el => {
    if (!el.matches('[data-custom-copy-text]')) return true;
    const raw = el.getAttribute('data-custom-copy-text') || '';
    return Boolean(parseDelimitedMath(raw) || /[\\^_{}]/.test(raw));
  };

  const isEditableElement = node => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element) return false;
    const editable = element.closest(editableElementSelector);
    return !!editable && editable.getAttribute('contenteditable') !== 'false';
  };

  const writeClipboardText = text => {
    const useGreaseMonkeyClipboard = () => {
      if (typeof GM_setClipboard !== 'function') return false;
      try {
        // Tampermonkey's second argument is the logical type (`text`/`html`),
        // not a MIME string.
        GM_setClipboard(text, 'text');
        return true;
      } catch (err) {
        return false;
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        return Promise.resolve(navigator.clipboard.writeText(text)).catch(err => {
          if (useGreaseMonkeyClipboard()) return;
          throw err;
        });
      } catch (err) {
        if (useGreaseMonkeyClipboard()) return Promise.resolve();
        return null;
      }
    }

    return useGreaseMonkeyClipboard()
      ? Promise.resolve()
      : null;
  };

  const markMathContexts = selection => {
    const marked = new Map();
    const ranges = [];

    const addAncestors = (node, candidates) => {
      let current = node?.nodeType === 1 ? node : node?.parentElement;
      while (current && current !== document.body) {
        try {
          if (current.matches?.(mathContextSelector) && isLikelyMathContext(current)) candidates.add(current);
        } catch (err) { /* ignore invalid/detached nodes */ }
        current = current.parentElement;
      }
    };

    for (let i = 0; i < selection.rangeCount; i++) {
      let sourceRange;
      try { sourceRange = selection.getRangeAt(i); } catch (err) { continue; }

      let cloneRange;
      try { cloneRange = sourceRange.cloneRange(); } catch (err) { continue; }

      const candidates = new Set();
      addAncestors(sourceRange.startContainer, candidates);
      addAncestors(sourceRange.endContainer, candidates);
      addAncestors(sourceRange.commonAncestorContainer, candidates);

      let queryRoot = sourceRange.commonAncestorContainer;
      if (queryRoot?.nodeType !== 1 && !queryRoot?.querySelectorAll) {
        queryRoot = queryRoot?.parentElement || document.body;
      }
      try {
        if (queryRoot?.matches?.(mathContextSelector) && isLikelyMathContext(queryRoot)) candidates.add(queryRoot);
        for (const mathEl of Array.from(queryRoot?.querySelectorAll?.(mathContextSelector) || [])) {
          if (isLikelyMathContext(mathEl)) candidates.add(mathEl);
        }
      } catch (err) { /* ignore detached/unsupported roots */ }

      const intersecting = [];
      for (const mathEl of candidates) {
        let intersects = false;
        try { intersects = sourceRange.intersectsNode(mathEl); } catch (err) { /* ignore detached nodes */ }
        if (!intersects) continue;

        const previous = mathEl.hasAttribute(mathContextAttribute)
          ? mathEl.getAttribute(mathContextAttribute)
          : null;
        if (!marked.has(mathEl)) marked.set(mathEl, previous);
        mathEl.setAttribute(mathContextAttribute, isBlockMathElement(mathEl) ? 'block' : 'inline');
        intersecting.push(mathEl);
      }

      // Only expand to outermost math roots.  This preserves a complete
      // formula when the user starts/ends the selection inside its rendered
      // KaTeX/MathJax wrapper, without changing the visible browser selection.
      const roots = intersecting.filter(mathEl => !intersecting.some(other => other !== mathEl && other.contains?.(mathEl)));
      for (const mathEl of roots) {
        try {
          if (mathEl.contains(sourceRange.startContainer)) cloneRange.setStartBefore(mathEl);
          if (mathEl.contains(sourceRange.endContainer)) cloneRange.setEndAfter(mathEl);
        } catch (err) { /* keep the unexpanded clone range */ }
      }

      ranges.push(cloneRange);
    }

    return { marked, ranges };
  };

  const restoreMathContexts = marked => {
    for (const [mathEl, previous] of marked) {
      try {
        if (previous === null) mathEl.removeAttribute(mathContextAttribute);
        else mathEl.setAttribute(mathContextAttribute, previous);
      } catch (err) { /* ignore nodes removed by a rerender */ }
    }
  };

  const serializeSelection = (selection = window.getSelection()) => {
    // `Selection#toString()` can be empty for MathML/hidden annotation nodes
    // even when a formula is visibly selected.  The serialized Markdown below
    // is the authoritative empty-selection check.
    if (!selection || !selection.rangeCount) return '';

    let hasSelectedContent = false;
    for (let i = 0; i < selection.rangeCount; i++) {
      try {
        if (!selection.getRangeAt(i).collapsed) {
          hasSelectedContent = true;
          break;
        }
      } catch (err) { /* ignore stale ranges */ }
    }
    if (!hasSelectedContent) return '';

    const anchor = selection.anchorNode?.nodeType === 1
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
    if (!anchor || isEditableElement(anchor)) return '';

    let marked = new Map();
    try {
      const context = markMathContexts(selection);
      marked = context.marked;
      const div = document.createElement('div');
      context.ranges.forEach((range, index) => {
        if (index > 0) div.appendChild(document.createTextNode('\n\n'));
        div.appendChild(range.cloneContents());
      });
      return formatMarkdown(serializeNode(div));
    } catch (err) {
      // A detached or rapidly rerendered selection is simply not copied.
      return '';
    } finally {
      restoreMathContexts(marked);
    }
  };

  let keyboardCopyInProgress = false;
  let pendingKeyboardMarkdown = '';
  const handledCopyEvents = new WeakSet();
  const handledKeydownEvents = new WeakSet();

  const handleCopy = e => {
    if (handledCopyEvents.has(e)) return;
    // A synthetic textarea is used by the keyboard fallback.  Never rewrite
    // copies originating in form controls, even if window.getSelection() still
    // points at an older page selection.
    let md = '';
    if (keyboardCopyInProgress && pendingKeyboardMarkdown && isEditableElement(e.target)) {
      // `execCommand('copy')` focuses a temporary textarea.  Use the payload
      // prepared from the page selection instead of treating that textarea as
      // an ordinary user input field.
      md = pendingKeyboardMarkdown;
    } else {
      if (isEditableElement(e.target)) return;
      md = serializeSelection();
    }
    if (!md || !e.clipboardData) return;

    try {
      // Return a plain-text clipboard payload; do not let the page overwrite it.
      e.clipboardData.setData('text/plain', md);
      handledCopyEvents.add(e);
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!keyboardCopyInProgress) showStatusToast('Copied as Markdown');
    } catch (err) {
      // Leave the browser's original clipboard behavior intact.
    }
  };

  // Window capture runs before page/document handlers, which also covers the
  // browser's native right-click and Ctrl/Cmd+C copy paths.
  window.addEventListener('copy', handleCopy, true);
  // Some site builds attach copy handling directly on document; keep a
  // document-capture fallback as well.  The WeakSet guard prevents duplicate
  // serialization if both listeners see the same event.
  document.addEventListener('copy', handleCopy, true);

  const copyWithExecCommand = md => {
    if (!document.body) return false;
    const textarea = document.createElement('textarea');
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const active = document.activeElement;
    let copied = false;

    textarea.value = md;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);

    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } catch (err) {
      copied = false;
    }

    textarea.remove();
    if (active && typeof active.focus === 'function') {
      try { active.focus({ preventScroll: true }); } catch (err) { /* no-op */ }
    }
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
    return copied;
  };

  const copyButtonSelector = [
    'button[data-testid="copy-turn-action-button"]',
    '[data-testid="copy-turn-action-button"]',
    'button[data-test-id="copy-button"]',
    '[data-test-id="copy-button"]',
    'button[aria-label="Copy" i]',
    'button[aria-label="Copy response" i]',
    'button[aria-label="Copy answer" i]',
    'button[aria-label="Copy message" i]',
    // Localized labels are kept for Chinese ChatGPT interfaces.
    'button[aria-label="复制"]',
    'button[aria-label="复制回复"]',
    'button[aria-label="复制回答"]',
    'button[aria-label="复制消息"]',
    '[role="button"][aria-label="Copy" i]',
    '[role="button"][aria-label="Copy response" i]',
    '[role="button"][aria-label="Copy answer" i]',
    '[role="button"][aria-label="Copy message" i]',
    '[role="button"][aria-label="复制"]',
    '[role="button"][aria-label="复制回复"]',
    '[role="button"][aria-label="复制回答"]',
    '[role="button"][aria-label="复制消息"]',
    'button[title="Copy" i]',
    'button[title="Copy response" i]',
    'button[title="Copy message" i]',
    'button[title="复制"]'
  ].join(', ');

  const turnContainerSelector = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author-role="assistant"]',
    'section[data-testid^="conversation-turn-"]',
    '[data-testid^="conversation-turn-"]',
    'article[data-testid^="conversation-turn-"]',
    'section[data-turn], article[data-turn], [data-turn]',
    '[data-turn-id-container]',
    '[data-message-id]'
  ].join(', ');
  const messageContentSelector = '[data-message-content], .markdown, .prose, [class*="markdown"]';

  const getEventElement = target => target?.nodeType === 1 ? target : target?.parentElement;

  const findCopyButton = target => {
    const element = getEventElement(target);
    const button = element?.closest(copyButtonSelector);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
    // A code block can have its own Copy button; it should retain native code
    // copying rather than copy the entire assistant response.
    if (button.closest('pre, code')) return null;
    return button;
  };

  const findAssistantTurn = button => {
    const directAssistant = button.closest('[data-message-author-role="assistant"], [data-role="assistant"], [data-author-role="assistant"]');
    if (directAssistant) return directAssistant;

    const turn = button.closest(turnContainerSelector);
    if (!turn || turn.matches('[data-message-author-role="user"], [data-role="user"], [data-author-role="user"]')) return null;
    const turnRole = (turn.getAttribute('data-turn') || turn.getAttribute('data-author') || '').toLowerCase();
    if (turnRole === 'user') return null;
    const hasUserMarker = turn.querySelector('[data-message-author-role="user"], [data-role="user"], [data-author-role="user"]');
    const hasAssistantMarker = turn.querySelector('[data-message-author-role="assistant"], [data-role="assistant"], [data-author-role="assistant"]');
    if (hasUserMarker && !hasAssistantMarker) return null;
    const buttonLabel = (button.getAttribute('aria-label') || button.getAttribute('title') || '').trim().toLowerCase();
    if (/(copy message|复制消息)/i.test(buttonLabel) && turnRole !== 'assistant') return null;

    const assistants = Array.from(turn.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"], [data-author-role="assistant"]'));
    if (assistants.length) return turnRole === 'assistant' || assistants.length > 1 ? turn : assistants[0];

    // The explicit ChatGPT test id is only used on assistant turns.  Generic
    // aria-label Copy buttons require an assistant/content marker to avoid
    // hijacking unrelated page controls.
    if (button.matches('[data-testid="copy-turn-action-button"], [data-test-id="copy-button"]')) return turn;
    return turnRole === 'assistant' ? turn : null;
  };

  const findMessageContentRoots = assistantTurn => {
    if (!assistantTurn) return [];
    const assistantSelector = '[data-message-author-role="assistant"], [data-role="assistant"], [data-author-role="assistant"]';
    const nestedAssistants = Array.from(assistantTurn.querySelectorAll(assistantSelector));
    const allAssistants = assistantTurn.matches(assistantSelector) ? [assistantTurn, ...nestedAssistants] : nestedAssistants;
    const startIndex = allAssistants.findIndex(node => node.getAttribute('data-turn-start-message') === 'true');
    const owners = startIndex >= 0 ? allAssistants.slice(startIndex) : (allAssistants.length ? allAssistants : [assistantTurn]);
    const direct = owners.filter(owner => owner.matches(messageContentSelector));
    const markdown = owners.flatMap(owner => Array.from(owner.querySelectorAll('.markdown, .prose, [class*="markdown"]')));
    const messageContent = owners.flatMap(owner => Array.from(owner.querySelectorAll('[data-message-content]')));
      const candidates = markdown.length ? markdown : (messageContent.length ? messageContent : direct);
    const roots = candidates.length ? candidates : [assistantTurn];
    // A `.markdown.prose` node can match both selectors; remove nested roots
    // so each visible response fragment is serialized exactly once.
    return roots
      .filter(root => !roots.some(other => other !== root && other.contains(root)))
      .filter(root => !root.matches('[hidden], [aria-hidden="true"]') && !root.closest('[hidden], [aria-hidden="true"]'));
  };

  const serializeElements = roots => {
    const uniqueRoots = Array.from(new Set(roots)).filter(root => root && !isEditableElement(root));
    if (!uniqueRoots.length) return '';
    try {
      const ranges = uniqueRoots.map(root => {
        const range = document.createRange();
        range.selectNodeContents(root);
        return range;
      });
      // Reuse the selection serializer without changing the user's visible
      // browser selection.  The builder only needs these three Selection-like
      // members and will clone/mark the range internally.
      const selectionLike = {
        rangeCount: ranges.length,
        anchorNode: uniqueRoots[0],
        getRangeAt: index => {
          if (!ranges[index]) throw new DOMException('IndexSizeError');
          return ranges[index];
        }
      };
      return serializeSelection(selectionLike);
    } catch (err) {
      // A detached or rapidly rerendered response is simply not copied.
      return '';
    }
  };

  const copyMarkdown = md => {
    const apiPromise = writeClipboardText(md);
    if (apiPromise) return apiPromise;
    return copyWithExecCommand(md) ? Promise.resolve() : null;
  };

  const handledButtonEvents = new WeakSet();
  const handleCopyButtonClick = e => {
    if (handledButtonEvents.has(e)) return;
    const button = findCopyButton(e.target);
    if (!button) return;

    const assistantTurn = findAssistantTurn(button);
    const contentRoots = findMessageContentRoots(assistantTurn);
    if (!contentRoots.length) return;

    const md = serializeElements(contentRoots);
    if (!md) return;

    const copyPromise = copyMarkdown(md);
    if (!copyPromise) return;

    handledButtonEvents.add(e);
    e.preventDefault();
    e.stopImmediatePropagation();
    copyPromise
      .then(() => showStatusToast('Copied as Markdown'))
      .catch(() => showStatusToast('Copy failed'));
  };

  // Event delegation handles buttons created/replaced by React without a
  // MutationObserver. Capture runs before ChatGPT's own click handler.
  window.addEventListener('click', handleCopyButtonClick, true);
  document.addEventListener('click', handleCopyButtonClick, true);

  const handleKeyboardCopy = e => {
    if (handledKeydownEvents.has(e)) return;
    if (e.isComposing || e.repeat || e.shiftKey || e.altKey) return;
    if (typeof e.key !== 'string' || e.key.toLowerCase() !== 'c' || !(e.ctrlKey || e.metaKey)) return;
    if (isEditableElement(e.target)) return;

    const md = serializeSelection();
    if (!md) return;

    // Use the synchronous browser path first, then fall back to the Clipboard
    // API when execCommand is unavailable or blocked by the browser.
    let copied = false;
    pendingKeyboardMarkdown = md;
    keyboardCopyInProgress = true;
    try {
      copied = copyWithExecCommand(md);
    } catch (err) {
      copied = false;
    } finally {
      keyboardCopyInProgress = false;
      pendingKeyboardMarkdown = '';
    }

    if (copied) {
      handledKeydownEvents.add(e);
      e.preventDefault();
      e.stopImmediatePropagation();
      showStatusToast('Copied as Markdown');
      return;
    }

    const writePromise = writeClipboardText(md);
    if (!writePromise) {
      // Keep the browser's native copy behavior when no programmatic
      // clipboard path is available.
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    handledKeydownEvents.add(e);
    writePromise
      .then(() => showStatusToast('Copied as Markdown'))
      .catch(() => showStatusToast('Copy failed'));
  };

  window.addEventListener('keydown', handleKeyboardCopy, true);
  document.addEventListener('keydown', handleKeyboardCopy, true);

  // Hover Tooltip
  let tooltipTimer;
  document.addEventListener('mouseover', (e) => {
    const target = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
    const mathEl = target?.closest(mathElementSelector);
    if (!mathEl) return;

    const tip = ensureTooltipElement();
    if (!tip) return;

    mathEl.style.cursor = "pointer";
    tooltipTimer = setTimeout(() => {
      const tex = formatMathElement(mathEl);
      if (!tex) return;
      tip.textContent = tex;
      const rect = mathEl.getBoundingClientRect();
      let topPos = rect.top - tip.offsetHeight - 8;
      if (topPos < 0) topPos = rect.bottom + 8;
      tip.style.left = `${Math.max(10, rect.left)}px`;
      tip.style.top = `${topPos}px`;
      tip.style.opacity = '1';
    }, 800);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
    if (target?.closest(mathElementSelector) && tooltipElement) {
      clearTimeout(tooltipTimer);
      tooltipElement.style.opacity = '0';
    }
  });

  // Double Click Copy
  document.addEventListener('dblclick', (e) => {
    const target = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
    const mathEl = target?.closest(mathElementSelector);
    if (!mathEl) return;

    const tex = formatMathElement(mathEl);
    if (tex) {
      const tip = ensureTooltipElement();
      const writePromise = writeClipboardText(tex);
      if (!writePromise) return;
      writePromise.then(() => {
        showStatusToast('LaTeX Formula Copied!');
        window.getSelection().removeAllRanges();
        if (tip) tip.style.opacity = '0';
      }).catch(() => showStatusToast('Copy failed'));
    }
  });

})();
