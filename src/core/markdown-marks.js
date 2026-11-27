// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Finds the Markdown in one line of a card description: what kind of line it is, and the bold,
// italic, code and links inside it. The description editor uses the positions to show each piece
// formatted and hide its symbols. Positions are offsets into the line.

// What kind of line this is, or null for a plain one. "marker" is where the symbols that make it
// that kind of line end, and for a list "markerFrom" is where they start, after any indent. A task
// item also has "box": the range of its [ ] or [x], and "checked".
export const lineBlock = (line) => {
    let m;
    if ((m = /^(#{1,6})[ \t]+(?=\S)/.exec(line))) return { type: 'heading', level: m[1].length, marker: m[0].length };
    if ((m = /^([ \t]*)[-*+][ \t]+/.exec(line))) {
        const block = { type: 'bullet', markerFrom: m[1].length, marker: m[0].length };
        const task = /^\[([ xX])\][ \t]+/.exec(line.slice(block.marker));
        if (task) {
            block.box = { from: block.marker, to: block.marker + 3, end: block.marker + task[0].length };
            block.checked = task[1] !== ' ';
        }
        return block;
    }
    if ((m = /^([ \t]*)\d{1,3}[.)][ \t]+/.exec(line))) return { type: 'number', markerFrom: m[1].length, marker: m[0].length };
    if ((m = /^>[ \t]?/.exec(line))) return { type: 'quote', marker: m[0].length };
    return null;
};

// A line that opens or closes a block of code
// Backticks later on the line mean code inside a sentence that happens to start the line
export const isFence = (line) => /^[ \t]*(```+[^`]*|~~~+.*)$/.test(line);

// The formatted pieces of a line, from the offset "start" on (past a list or heading marker).
// Each has its whole range (from, to), the symbols at each end (open, close) where it has any, a
// type, and for a link its url.
// A line is only searched for formatting while it's a size that real writing reaches. A line built
// to be slow to search, tens of thousands of symbols long, is shown as plain text instead, so
// nobody can freeze a browser or tie up the server with a card description.
export const MAX_FORMATTED_LINE = 5000;
const MAX_SYMBOLS = 300;
export const searchable = (line) => {
    if (line.length > MAX_FORMATTED_LINE) return false;
    let symbols = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i);
        // * _ ~ ` [ { / # ! -
        if ((c === 42 || c === 95 || c === 126 || c === 96 || c === 91 || c === 123 || c === 47 || c === 35 || c === 33 || c === 45) && ++symbols > MAX_SYMBOLS) return false;
    }
    return true;
};

export const inlineMarks = (line, start = 0) => {
    const marks = [];
    if (!searchable(line)) return marks;
    // Characters already inside code or a link address, which bold and italic leave alone
    const chars = [...line].map((c, i) => (i < start ? '\u0000' : c));
    const take = (from, to) => { for (let i = from; i < to; i++) chars[i] = '\u0000'; };
    const scan = (re, each) => { for (const m of chars.join('').matchAll(re)) each(m, m.index, m.index + m[0].length); };

    // Code in a sentence: one backtick each side, or more, as long as both sides have the same number
    scan(/(?<!`)(`+)(?!`)([^\u0000]*?[^`\u0000])\1(?!`)/g, (m, from, to) => {
        const n = m[1].length;
        marks.push({ type: 'code', from, to, open: [from, from + n], close: [to - n, to] });
        take(from, to);
    });
    scan(/\[([^\]\u0000]+)\]\(([^)\s\u0000]+)\)/g, (m, from, to) => {
        if (line[from - 1] === '!') return;
        const textEnd = from + 1 + m[1].length;
        marks.push({ type: 'link', from, to, open: [from, from + 1], close: [textEnd, to], url: m[2] });
        take(textEnd, to);
        take(from, from + 1);
    });
    // A web address stops before the punctuation and the Markdown symbols that end a sentence or a piece
    scan(/https?:\/\/[^\s<>\u0000]*[^\s<>\u0000.,;:!?)\]'"~*_]/g, (m, from, to) => {
        marks.push({ type: 'url', from, to, url: m[0] });
        take(from, to);
    });
    const pair = (type, re, width) => scan(re, (m, from, to) => {
        marks.push({ type, from, to, open: [from, from + width], close: [to - width, to] });
    });
    pair('bold', /\*\*(?=\S)(?:.+?)(?<=\S)\*\*/g, 2);
    pair('bold', /(?<![\w_])__(?=\S)(?:.+?)(?<=\S)__(?![\w_])/g, 2);
    pair('strike', /~~(?=\S)(?:.+?)(?<=\S)~~/g, 2);
    pair('italic', /(?<![*\\])\*(?=[^\s*])(?:[^*]+?)(?<=\S)\*(?!\*)/g, 1);
    pair('italic', /(?<![\w_\\])_(?=[^\s_])(?:[^_]+?)(?<=\S)_(?![\w_])/g, 1);
    return marks.sort((a, b) => a.from - b.from || b.to - a.to);
};

const escapeHtml = (text) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAGS = { bold: 'strong', italic: 'em', strike: 's', code: 'code' };

// One line of Markdown as HTML, from the offset "start" on
const inlineHtml = (line, start = 0) => {
    // Each symbol becomes a tag; the text between them is kept
    const swaps = [];
    for (const mark of inlineMarks(line, start)) {
        const href = /^https?:\/\//i.test(mark.url || '') ? ` href="${escapeHtml(mark.url)}"` : '';
        if (mark.type === 'url') {
            swaps.push({ from: mark.from, to: mark.from, html: `<a${href}>` }, { from: mark.to, to: mark.to, html: '</a>', closes: true });
            continue;
        }
        const tag = mark.type === 'link' ? 'a' : TAGS[mark.type];
        swaps.push({ from: mark.open[0], to: mark.open[1], html: mark.type === 'link' ? `<a${href}>` : `<${tag}>` });
        swaps.push({ from: mark.close[0], to: mark.close[1], html: `</${tag}>`, closes: true });
    }
    swaps.sort((a, b) => a.from - b.from || (b.closes ? 1 : 0) - (a.closes ? 1 : 0));
    let html = '';
    let at = start;
    for (const swap of swaps) {
        if (swap.from < at) continue;
        html += escapeHtml(line.slice(at, swap.from)) + swap.html;
        at = swap.to;
    }
    return html + escapeHtml(line.slice(at));
};

// A description, or part of one, as HTML: what goes on the clipboard beside the Markdown, so that
// an email or a document pasted into gets real headings, bold and links
export const markdownToHtml = (text) => {
    const out = [];
    let list = null;
    let para = [];
    let code = null;
    const endPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
    const endList = () => { if (list) out.push(`</${list}>`); list = null; };
    for (const line of String(text || '').slice(0, 500_000).split('\n')) {
        if (isFence(line)) {
            endPara(); endList();
            if (code) { out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
            else code = [];
            continue;
        }
        if (code) { code.push(line); continue; }
        const block = lineBlock(line);
        if (block?.type === 'bullet' || block?.type === 'number') {
            endPara();
            const kind = block.type === 'bullet' ? 'ul' : 'ol';
            if (list !== kind) { endList(); out.push(`<${kind}>`); list = kind; }
            const box = block.box ? (block.checked ? '☑ ' : '☐ ') : '';
            out.push(`<li>${box}${inlineHtml(line, block.box ? block.box.end : block.marker)}</li>`);
            continue;
        }
        endList();
        if (!line.trim()) { endPara(); continue; }
        if (block?.type === 'heading') { endPara(); out.push(`<h${block.level}>${inlineHtml(line, block.marker)}</h${block.level}>`); continue; }
        if (block?.type === 'quote') { endPara(); out.push(`<blockquote>${inlineHtml(line, block.marker)}</blockquote>`); continue; }
        para.push(inlineHtml(line));
    }
    if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    endPara(); endList();
    return out.join('');
};
