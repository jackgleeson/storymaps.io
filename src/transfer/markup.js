// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Card details are Markdown. Each issue tracker keeps descriptions in a format of its own, so an
// import turns that format into Markdown and an export turns Markdown back into it:
//
//   Linear          Markdown, so nothing to do
//   Jira            wiki markup in CSV files, Atlassian Document Format (ADF) over the API
//   Azure DevOps    HTML
//   Asana           a small set of HTML over the API, plain text in CSV files
//   Phabricator     Remarkup
//
// Nothing here touches the page, so the browser and the server share it and it can be tested on
// its own. A piece of markup with no rule here is left as it arrives.

import { lineBlock, isFence, inlineMarks, markdownToHtml, searchable } from '../core/markdown-marks.js';

export { markdownToHtml };

// No real description comes near this size. Anything longer is cut here, so an issue tracker, or a page
// posing as one, can't hand the server a description that takes minutes to read.
export const MAX_DESCRIPTION = 500_000;
const bounded = (text) => String(text || '').slice(0, MAX_DESCRIPTION);

// =============================================================================
// Markdown, read into blocks
// =============================================================================

// One line as a tree: text, and bold, italic, strike, code and link pieces holding more of the same
const inlineTree = (line, start = 0) => {
    const marks = inlineMarks(line, start);
    const build = (from, to, list) => {
        const nodes = [];
        let at = from;
        for (const mark of list) {
            // Inside a piece already taken, or half in and half out of this one
            if (mark.from < at || mark.to > to) continue;
            if (mark.from > at) nodes.push({ text: line.slice(at, mark.from) });
            if (mark.type === 'url') nodes.push({ type: 'link', url: mark.url, children: [{ text: mark.url }] });
            else if (mark.type === 'code') nodes.push({ type: 'code', children: [{ text: line.slice(mark.open[1], mark.close[0]) }] });
            else {
                const inner = list.filter(m => m !== mark && m.from >= mark.open[1] && m.to <= mark.close[0]);
                nodes.push({ type: mark.type, url: mark.url, children: build(mark.open[1], mark.close[0], inner) });
            }
            at = mark.to;
        }
        if (at < to) nodes.push({ text: line.slice(at, to) });
        return nodes;
    };
    return build(start, line.length, marks);
};

// The blocks of a description: headings, lists, quotes, code and paragraphs
export const parseMarkdown = (text) => {
    const blocks = [];
    let code = null;
    const last = () => blocks[blocks.length - 1];
    for (const line of bounded(text).split('\n')) {
        if (isFence(line)) {
            if (code) { blocks.push({ type: 'code', text: code.join('\n') }); code = null; }
            else code = [];
            continue;
        }
        if (code) { code.push(line); continue; }
        if (!line.trim()) { blocks.push({ type: 'gap' }); continue; }
        const block = lineBlock(line);
        if (block?.type === 'heading') {
            blocks.push({ type: 'heading', level: block.level, inline: inlineTree(line, block.marker) });
        } else if (block?.type === 'bullet' || block?.type === 'number') {
            const ordered = block.type === 'number';
            const item = { inline: inlineTree(line, block.box ? block.box.end : block.marker), depth: Math.floor(block.markerFrom / 2) };
            if (block.box) item.checked = block.checked;
            if (last()?.type === 'list' && (last().ordered === ordered || item.depth > 0)) last().items.push({ ...item, ordered });
            else blocks.push({ type: 'list', ordered, items: [{ ...item, ordered }] });
        } else if (block?.type === 'quote') {
            if (last()?.type === 'quote') last().lines.push(inlineTree(line, block.marker));
            else blocks.push({ type: 'quote', lines: [inlineTree(line, block.marker)] });
        } else if (last()?.type === 'para') {
            last().lines.push(inlineTree(line));
        } else {
            blocks.push({ type: 'para', lines: [inlineTree(line)] });
        }
    }
    if (code) blocks.push({ type: 'code', text: code.join('\n') });
    return blocks.filter(block => block.type !== 'gap');
};

// A tree of inline pieces as text, each kind of piece wrapped by "wrap"
const renderInline = (nodes, wrap, plain = (t) => t) =>
    nodes.map(node => (node.type ? wrap(node, renderInline(node.children, node.type === 'code' ? (n, inner) => inner : wrap, plain)) : plain(node.text))).join('');

const isWebLink = (url) => /^https?:\/\//i.test(url || '');
const taskBox = (item, done = '[x] ', open = '[ ] ') => (item.checked === undefined ? '' : item.checked ? done : open);

// =============================================================================
// Markdown out to each issue tracker
// =============================================================================

// Jira wiki markup, which Jira reads in the Description column of a CSV file. Square brackets
// make links there, so a task box goes as a box character.
export const markdownToJiraWiki = (text) => {
    const wrap = (node, inner) => ({
        bold: `*${inner}*`, italic: `_${inner}_`, strike: `-${inner}-`, code: `{{${inner}}}`,
        link: !isWebLink(node.url) || inner === node.url ? inner : `[${inner}|${node.url}]`,
    }[node.type]);
    const line = (nodes) => renderInline(nodes, wrap);
    return parseMarkdown(text).map(block => {
        if (block.type === 'heading') return `h${block.level}. ${line(block.inline)}`;
        if (block.type === 'list') {
            return block.items.map(item => `${(item.ordered ? '#' : '*').repeat(item.depth + 1)} ${taskBox(item, '☑ ', '☐ ')}${line(item.inline)}`).join('\n');
        }
        if (block.type === 'quote') return block.lines.map(l => `bq. ${line(l)}`).join('\n');
        if (block.type === 'code') return `{code}\n${block.text}\n{code}`;
        return block.lines.map(line).join('\n');
    }).join('\n\n');
};

// Phabricator Remarkup
export const markdownToRemarkup = (text) => {
    const wrap = (node, inner) => ({
        bold: `**${inner}**`, italic: `//${inner}//`, strike: `~~${inner}~~`, code: `\`${inner}\``,
        link: !isWebLink(node.url) || inner === node.url ? inner : `[[ ${node.url} | ${inner} ]]`,
    }[node.type]);
    const line = (nodes) => renderInline(nodes, wrap);
    return parseMarkdown(text).map(block => {
        if (block.type === 'heading') return `${'='.repeat(block.level)} ${line(block.inline)} ${'='.repeat(block.level)}`;
        if (block.type === 'list') {
            return block.items.map(item => `${'  '.repeat(item.depth)}${item.ordered ? '#' : '-'} ${taskBox(item, '[X] ')}${line(item.inline)}`).join('\n');
        }
        if (block.type === 'quote') return block.lines.map(l => `> ${line(l)}`).join('\n');
        if (block.type === 'code') return `\`\`\`\n${block.text}\n\`\`\``;
        return block.lines.map(line).join('\n');
    }).join('\n\n');
};

// Atlassian Document Format, for the Jira API. Empty text gives null. Lists go flat, and a task
// box stays as "[ ]" text, as Jira is strict about anything it doesn't expect.
export const markdownToAdf = (text) => {
    const MARKS = { bold: 'strong', italic: 'em', strike: 'strike', code: 'code' };
    const inline = (nodes, marks = []) => nodes.flatMap(node => {
        if (!node.type) return node.text ? [{ type: 'text', text: node.text, ...(marks.length && { marks }) }] : [];
        const mark = node.type === 'link'
            ? (isWebLink(node.url) ? { type: 'link', attrs: { href: node.url } } : null)
            : { type: MARKS[node.type] };
        // Jira lets code sit inside a link and inside nothing else
        const kept = node.type === 'code' ? marks.filter(m => m.type === 'link') : marks.filter(m => m.type !== mark?.type);
        return inline(node.children, mark ? [...kept, mark] : kept);
    });
    const paragraph = (lines, lead = '') => {
        const content = [];
        lines.forEach((nodes, i) => {
            if (i > 0) content.push({ type: 'hardBreak' });
            content.push(...inline(i === 0 && lead ? [{ text: lead }, ...nodes] : nodes));
        });
        return content.length ? { type: 'paragraph', content } : null;
    };
    const content = parseMarkdown(text).flatMap(block => {
        if (block.type === 'heading') {
            const nodes = inline(block.inline);
            return nodes.length ? [{ type: 'heading', attrs: { level: block.level }, content: nodes }] : [];
        }
        if (block.type === 'list') {
            const items = block.items.map(item => paragraph([item.inline], taskBox(item))).filter(Boolean)
                .map(p => ({ type: 'listItem', content: [p] }));
            return items.length ? [{ type: block.ordered ? 'orderedList' : 'bulletList', content: items }] : [];
        }
        if (block.type === 'quote') {
            const p = paragraph(block.lines);
            return p ? [{ type: 'blockquote', content: [p] }] : [];
        }
        if (block.type === 'code') return block.text ? [{ type: 'codeBlock', content: [{ type: 'text', text: block.text }] }] : [];
        const p = paragraph(block.lines);
        return p ? [p] : [];
    });
    return content.length ? { type: 'doc', version: 1, content } : null;
};

// The HTML Asana takes for a task's notes: a body holding a few tags, with plain new lines
// between paragraphs. Asana has two heading sizes, so smaller headings go as bold lines.
export const markdownToAsanaHtml = (text) => {
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const wrap = (node, inner) => ({
        bold: `<strong>${inner}</strong>`, italic: `<em>${inner}</em>`, strike: `<s>${inner}</s>`, code: `<code>${inner}</code>`,
        link: isWebLink(node.url) ? `<a href="${escape(node.url)}">${inner}</a>` : inner,
    }[node.type]);
    const line = (nodes) => renderInline(nodes, wrap, escape);
    const blocks = parseMarkdown(text).map(block => {
        if (block.type === 'heading') return block.level <= 2 ? `<h${block.level}>${line(block.inline)}</h${block.level}>` : `<strong>${line(block.inline)}</strong>\n`;
        if (block.type === 'list') {
            const tag = block.ordered ? 'ol' : 'ul';
            return `<${tag}>${block.items.map(item => `<li>${taskBox(item, '☑ ', '☐ ')}${line(item.inline)}</li>`).join('')}</${tag}>`;
        }
        if (block.type === 'quote') return `<blockquote>${block.lines.map(line).join('\n')}</blockquote>`;
        if (block.type === 'code') return `<pre>${escape(block.text)}</pre>`;
        return `${block.lines.map(line).join('\n')}\n`;
    });
    // A blank line between two paragraphs, as there is no tag to part them
    return `<body>${blocks.map((html, i) => (i > 0 && html.endsWith('\n') && blocks[i - 1].endsWith('\n') ? `\n${html}` : html)).join('').trimEnd()}</body>`;
};

// =============================================================================
// Each issue tracker's format in to Markdown
// =============================================================================

// Wrap text in a Markdown symbol, keeping any space at its ends outside the symbols, and each
// line wrapped on its own
const wrapText = (inner, open, close = open) => inner.split('\n').map(line => {
    const text = line.trim();
    if (!text) return line;
    return line.slice(0, line.indexOf(text[0])) + open + text + close + line.slice(line.lastIndexOf(text[text.length - 1]) + 1);
}).join('\n');

// A list item that starts with a box character is a task, as the exports write one
const taskBoxes = (line) => line.replace(/^(\s*[-*+] )\u2610 /, '$1[ ] ').replace(/^(\s*[-*+] )\u2611 /, '$1[x] ');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (text) => text
    .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

// The pieces of some HTML in order: tags, and the text between them. Scripts, styles and comments
// are left out. Each character is looked at a fixed number of times however the HTML is built,
// so a page of nothing but "<" is read as fast as any other.
const htmlParts = (source) => {
    const parts = [];
    let at = 0;
    while (at < source.length) {
        const open = source.indexOf('<', at);
        if (open === -1) { parts.push(source.slice(at)); break; }
        if (source.startsWith('<!--', open)) {
            parts.push(source.slice(at, open));
            const end = source.indexOf('-->', open + 4);
            if (end === -1) break;
            at = end + 3;
            continue;
        }
        const close = source.indexOf('>', open + 1);
        // No ">" anywhere after this: the rest is text
        if (close === -1) { parts.push(source.slice(at)); break; }
        // A "<" with another "<" before its ">" is text, such as "a < b"
        const start = source.lastIndexOf('<', close);
        parts.push(source.slice(at, start));
        const tag = source.slice(start, close + 1);
        const hidden = /^<(script|style)\b/i.exec(tag);
        if (hidden) {
            const end = source.toLowerCase().indexOf(`</${hidden[1].toLowerCase()}`, close);
            if (end === -1) break;
            const endClose = source.indexOf('>', end);
            if (endClose === -1) break;
            at = endClose + 1;
            continue;
        }
        parts.push(tag);
        at = close + 1;
    }
    return parts;
};

// Lists inside lists, and tags inside tags, past any depth a real description has
const MAX_NESTING = 8;
const MAX_LAYERS = 40;

// HTML, as Azure DevOps and Asana keep descriptions. Headings, bold, italic, strike, code, links,
// lists, quotes and code blocks become Markdown; any other tag is dropped and its text kept.
// "newLines" keeps the line breaks in the text itself, which Asana uses between paragraphs and
// other HTML ignores.
export const htmlToMarkdown = (html, { newLines = false } = {}) => {
    const source = bounded(html);
    // The text so far, with a new layer for each piece that is wrapped once it closes
    // Each layer keeps its text in pieces and remembers its last character, so adding to it never
    // means reading back what is already there
    const layers = [{ tag: null, parts: [], last: '' }];
    const lists = [];
    let pre = false;
    const top = () => layers[layers.length - 1];
    const put = (text) => { if (text) { top().parts.push(text); top().last = text[text.length - 1]; } };
    const newLine = () => { if (top().last && top().last !== '\n') put('\n'); };
    const INLINE = { b: '**', strong: '**', i: '*', em: '*', s: '~~', strike: '~~', del: '~~', code: '`' };
    const WRAPPED = new Set([...Object.keys(INLINE), 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
    const BLOCKS = new Set(['p', 'div', 'tr', 'table', 'section', 'article', 'header', 'footer']);

    const close = (tag) => {
        // Close what was left open inside it, then the tag itself
        const at = layers.map(l => l.tag).lastIndexOf(tag);
        if (at <= 0) return;
        while (layers.length > at) {
            const layer = layers.pop();
            const inner = layer.parts.join('');
            if (INLINE[layer.tag]) put(layer.tag === 'code' && pre ? inner : wrapText(inner, INLINE[layer.tag]));
            else if (layer.tag === 'a') {
                const label = inner.trim();
                const href = layer.href;
                if (!href || !/^(https?:|mailto:)/i.test(href)) put(inner);
                else if (!label || label === href) put(href);
                else put(wrapText(inner, '[', `](${href})`));
            } else if (layer.tag === 'blockquote') {
                newLine();
                put(inner.trim().split('\n').map(line => `> ${line}`).join('\n') + '\n');
            } else {
                newLine();
                if (inner.trim()) put(`${'#'.repeat(Number(layer.tag[1]))} ${inner.replace(/\s+/g, ' ').trim()}\n`);
            }
        }
    };

    for (const part of htmlParts(source)) {
        if (!part) continue;
        const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(part);
        if (!tagMatch) {
            if (part.startsWith('<')) continue;
            put(pre ? decodeEntities(part) : decodeEntities(part.replace(newLines ? /[^\S\n]+/g : /\s+/g, ' ')));
            continue;
        }
        const [, closing, rawName, attrs] = tagMatch;
        const name = rawName.toLowerCase();
        if (name === 'br') put('\n');
        else if (name === 'hr') { newLine(); put('---\n'); }
        else if (name === 'img') put(/\balt="([^"]*)"/i.exec(attrs)?.[1] || '');
        else if (name === 'input' && /type="?checkbox/i.test(attrs)) put(/\bchecked\b/i.test(attrs) ? '[x] ' : '[ ] ');
        else if (name === 'pre') {
            newLine();
            put('```\n');
            pre = !closing;
        } else if (name === 'ul' || name === 'ol') {
            if (closing) lists.pop();
            else if (lists.length < MAX_LAYERS) lists.push({ ordered: name === 'ol', count: 0 });
            newLine();
        } else if (name === 'li') {
            if (closing) continue;
            newLine();
            const list = lists[lists.length - 1] || { ordered: false, count: 0 };
            put('  '.repeat(Math.min(MAX_NESTING, Math.max(0, lists.length - 1))) + (list.ordered ? `${++list.count}. ` : '- '));
        } else if (WRAPPED.has(name) && !(name === 'code' && pre)) {
            if (closing) close(name);
            else if (layers.length < MAX_LAYERS) layers.push({ tag: name, parts: [], last: '', href: decodeEntities(/\bhref="([^"]*)"/i.exec(attrs)?.[1] || '') });
        } else if (BLOCKS.has(name) && closing) put('\n');
        else if ((name === 'td' || name === 'th') && closing) put(' ');
    }
    while (layers.length > 1) close(top().tag);

    let inCode = false;
    return layers[0].parts.join('').split('\n').map(line => {
        if (isFence(line)) { inCode = !inCode; return line.trim(); }
        if (inCode) return line;
        // Keep the indent of a list item inside another list, and nothing else at the ends
        const indent = /^( +)([-*+]|\d+\.) /.exec(line)?.[1] || '';
        return indent + taskBoxes(line.trim().replace(/[ \t]+/g, ' '));
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

// Lines outside code blocks go through "each"; a line that opens or closes a code block, and
// the lines between, go as they are
const outsideCode = (text, each) => {
    let inCode = false;
    return bounded(text).replace(/\r\n?/g, '\n').split('\n').map(line => {
        if (isFence(line)) { inCode = !inCode; return line; }
        return inCode ? line : each(line);
    }).join('\n');
};

// Numbers for "1." lists, counted per depth and started again after any other line
const listCounter = () => {
    let counts = [];
    return {
        next: (depth) => { counts.length = depth + 1; counts[depth] = (counts[depth] || 0) + 1; return counts[depth]; },
        reset: () => { counts = []; },
    };
};

// Jira wiki markup, as Jira writes descriptions into a CSV file
export const jiraWikiToMarkdown = (text) => {
    const INLINE = /\{\{(.+?)\}\}|\[([^|\]\n]+)\|([^|\]\n\s]+)(?:\|[^\]\n]*)?\]|\[(https?:\/\/[^\]\s|]+)\]|(?<![\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])|(?<![\w_])_(\S(?:[^_\n]*\S)?)_(?![\w_])|(?<![\w-])-(\S(?:[^-\n]*\S)?)-(?![\w-])|\{color[^}]*\}/g;
    const inline = (line) => (!searchable(line) ? line : line.replace(/\\\\/g, '\n').replace(INLINE, (m, code, label, url, bare, bold, italic, strike) => {
        if (code !== undefined) return `\`${code}\``;
        if (label !== undefined) return /^(https?:|mailto:)/i.test(url) ? `[${inline(label)}](${url})` : m;
        if (bare !== undefined) return bare;
        if (bold !== undefined) return `**${inline(bold)}**`;
        if (italic !== undefined) return `*${inline(italic)}*`;
        if (strike !== undefined) return `~~${inline(strike)}~~`;
        return '';
    }));
    const numbers = listCounter();
    let inCode = false;
    let inQuote = false;
    const out = [];
    for (const raw of bounded(text).replace(/\r\n?/g, '\n').split('\n')) {
        // {code} and {noformat} open and close a block of code, sometimes around text on the same line
        const fence = /^(.*?)\{(?:code|noformat)(?::[^}]*)?\}(.*)$/.exec(raw);
        if (fence) {
            const [, before, after] = fence;
            if (before.trim()) out.push(inCode ? before : inline(before));
            out.push('```');
            inCode = !inCode;
            const closesToo = /^(.*?)\{(?:code|noformat)\}\s*$/.exec(after);
            if (closesToo && inCode) { out.push(closesToo[1], '```'); inCode = false; }
            else if (after.trim()) out.push(inCode ? after : inline(after));
            continue;
        }
        if (inCode) { out.push(raw); continue; }
        if (/^\s*\{quote\}\s*$/.test(raw)) { inQuote = !inQuote; continue; }
        const quote = inQuote ? '> ' : '';
        let m;
        if ((m = /^h([1-6])\.\s+(.*)$/.exec(raw))) { numbers.reset(); out.push(`${quote}${'#'.repeat(Number(m[1]))} ${inline(m[2])}`); continue; }
        if ((m = /^bq\.\s+(.*)$/.exec(raw))) { numbers.reset(); out.push(`> ${inline(m[1])}`); continue; }
        if (/^-{4,}\s*$/.test(raw)) { numbers.reset(); out.push('---'); continue; }
        if ((m = /^\s*([*#]+|-)\s+(.*)$/.exec(raw))) {
            const depth = m[1].length - 1;
            const marker = m[1].endsWith('#') ? `${numbers.next(depth)}.` : '-';
            out.push(taskBoxes(`${quote}${'  '.repeat(depth)}${marker} ${inline(m[2])}`));
            continue;
        }
        numbers.reset();
        out.push(quote + inline(raw));
    }
    if (inCode) out.push('```');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

// Phabricator Remarkup, which is close to Markdown: the headings, italics, monospace, numbered
// lists and links differ
export const remarkupToMarkdown = (text) => {
    const numbers = listCounter();
    const inline = (line) => (!searchable(line) ? line : line.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : part
        .replace(/\[\[\s*(https?:\/\/[^\s|\]]+)\s*\|\s*([^\]]+?)\s*\]\]/g, '[$2]($1)')
        .replace(/\[\[\s*(https?:\/\/[^\s|\]]+)\s*\]\]/g, '$1')
        .replace(/(?<![:\w/])\/\/(?=\S)(.+?)(?<=\S)\/\/(?!\/)/g, '*$1*')
        .replace(/##(?=\S)(.+?)(?<=\S)##/g, '`$1`')
        .replace(/!!(?=\S)(.+?)(?<=\S)!!/g, '**$1**'))).join(''));
    return outsideCode(text, (line) => {
        let m;
        if ((m = /^(={1,6})\s*([^=\s].*?)\s*=*\s*$/.exec(line))) { numbers.reset(); return `${'#'.repeat(m[1].length)} ${inline(m[2])}`; }
        if ((m = /^(\s*)#\s+(.*)$/.exec(line))) {
            const depth = Math.floor(m[1].length / 2);
            return `${'  '.repeat(depth)}${numbers.next(depth)}. ${inline(m[2])}`;
        }
        if ((m = /^(\s*[-*]\s+)\[([ xX])\](\s+.*)$/.exec(line))) return `${m[1]}[${m[2] === ' ' ? ' ' : 'x'}]${inline(m[3])}`;
        if (!/^\s*([-*]|\d+[.)])\s/.test(line)) numbers.reset();
        return inline(line);
    }).trim();
};

// Atlassian Document Format, as the Jira API gives descriptions
export const adfToMarkdown = (doc) => {
    const MARKS = { strong: '**', em: '*', strike: '~~' };
    const inline = (nodes, depth) => (Array.isArray(nodes) ? nodes.slice(0, 500) : []).map(node => {
        if (!node || depth > 20) return '';
        if (node.type === 'text') {
            let text = node.text || '';
            const marks = node.marks || [];
            if (marks.some(m => m.type === 'code')) text = `\`${text}\``;
            for (const mark of marks) if (MARKS[mark.type]) text = wrapText(text, MARKS[mark.type]);
            const href = marks.find(m => m.type === 'link')?.attrs?.href;
            if (href && (node.text || '').trim() !== href) text = wrapText(text, '[', `](${href})`);
            return text;
        }
        if (node.type === 'hardBreak') return '\n';
        if (node.type === 'inlineCard') return node.attrs?.url || '';
        if (node.type === 'mention' || node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
        return inline(node.content, depth + 1);
    }).join('');

    // The blocks inside a node, each as its lines of Markdown
    const blocks = (nodes, depth, indent = '') => (Array.isArray(nodes) ? nodes.slice(0, 500) : []).flatMap(node => {
        if (!node || depth > 20) return [];
        const kids = (extra = indent) => blocks(node.content, depth + 1, extra);
        switch (node.type) {
            case 'paragraph': return [inline(node.content, depth + 1)];
            case 'heading': return [`${'#'.repeat(Math.min(6, Math.max(1, node.attrs?.level || 1)))} ${inline(node.content, depth + 1).replace(/\n/g, ' ')}`];
            case 'codeBlock': return [`\`\`\`\n${inline(node.content, depth + 1)}\n\`\`\``];
            case 'rule': return ['---'];
            case 'blockquote': return [kids().join('\n\n').split('\n').map(line => `> ${line}`).join('\n')];
            case 'bulletList':
            case 'orderedList':
            case 'taskList': {
                const lines = [];
                (node.content || []).slice(0, 500).forEach((item, i) => {
                    const marker = node.type === 'orderedList' ? `${i + 1}. ` : node.type === 'taskList' ? `- [${item.attrs?.state === 'DONE' ? 'x' : ' '}] ` : '- ';
                    const parts = item.type === 'taskItem' ? [inline(item.content, depth + 1)] : blocks(item.content, depth + 1, `${indent}  `);
                    const [first = '', ...rest] = parts;
                    // A list inside this item is already indented; other blocks sit under its text
                    lines.push(`${indent}${marker}${first.replace(/\n/g, ' ')}`, ...rest.map(part => (/^\s*([-*]|\d+\.) /.test(part) ? part : `${indent}  ${part}`)));
                });
                return [lines.join('\n')];
            }
            case 'table': return [(node.content || []).map(row => (row.content || []).map(cell => blocks(cell.content, depth + 2).join(' ').replace(/\n/g, ' ')).join(' | ')).join('\n')];
            default: return Array.isArray(node.content) ? kids() : [inline([node], depth)].filter(Boolean);
        }
    });
    return blocks(doc?.type === 'doc' ? doc.content : [doc].filter(Boolean), 0).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
};
