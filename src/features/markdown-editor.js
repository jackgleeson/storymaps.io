// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Markdown in a CodeMirror editor: the text shows formatted, and a formatted piece shows its
// Markdown symbols only while the cursor or the selection is on it. The description of a card
// (body-editor.js) and the notepad (notepad.js) both use this. Only what is drawn changes: the
// text stays the plain Markdown that was typed, so saving and syncing carry on as before.

import { isValidUrl } from '/src/core/constants.js';
import { lineBlock, isFence, inlineMarks, markdownToHtml } from '/src/core/markdown-marks.js';

const MAX_FORMATTED_DOC = 200_000;

const EDIT_ICON = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Everything CodeMirror needs to show Markdown formatted
const buildPreview = (cm) => {
    const { Decoration, ViewPlugin, WidgetType } = cm;

    class Bullet extends WidgetType {
        eq() { return true; }
        toDOM() {
            const dot = document.createElement('span');
            dot.className = 'cm-md-bullet';
            dot.textContent = '•';
            return dot;
        }
    }

    // The pencil after a link: a click on the link opens it, so this is what puts the cursor in
    // it, to show its Markdown for editing
    // "end" is set for a web address written on its own. The pencil turns it into a link with no
    // words yet, [](address), and puts the cursor between the square brackets for them. Left
    // without words, it goes back to the address alone (tidyUnnamedLink).
    class EditLink extends WidgetType {
        constructor(pos, end = pos) { super(); this.pos = pos; this.end = end; }
        eq(other) { return other.pos === this.pos && other.end === this.end; }
        toDOM(view) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cm-md-edit';
            button.title = 'Edit link';
            button.setAttribute('aria-label', 'Edit link');
            button.tabIndex = -1;
            button.innerHTML = EDIT_ICON;
            button.addEventListener('mousedown', (e) => e.preventDefault());
            button.addEventListener('click', (e) => {
                e.preventDefault();
                view.focus();
                if (this.end === this.pos) {
                    view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true });
                    return;
                }
                if (view.state.readOnly) return;
                const url = view.state.sliceDoc(this.pos, this.end);
                view.dispatch({ changes: { from: this.pos, to: this.end, insert: `[](${url})` }, selection: { anchor: this.pos + 1 }, userEvent: 'input', scrollIntoView: true });
                unnamed.set(view, { at: this.pos, url });
            });
            return button;
        }
        ignoreEvent() { return true; }
    }

    class TaskBox extends WidgetType {
        constructor(checked, pos, locked) { super(); this.checked = checked; this.pos = pos; this.locked = locked; }
        eq(other) { return other.checked === this.checked && other.pos === this.pos && other.locked === this.locked; }
        toDOM(view) {
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'cm-md-task';
            box.checked = this.checked;
            box.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
            box.tabIndex = -1;
            // On a story map that can't be changed the box looks the same and takes no clicks. A
            // disabled box would go grey, which reads as a different answer.
            if (this.locked) {
                box.classList.add('cm-md-task-locked');
                box.setAttribute('aria-disabled', 'true');
            }
            box.addEventListener('mousedown', (e) => e.preventDefault());
            box.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.locked) return;
                view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input' });
            });
            return box;
        }
        ignoreEvent() { return true; }
    }

    const hide = Decoration.replace({});
    const symbol = Decoration.mark({ class: 'cm-md-symbol' });
    const STYLE = { bold: 'cm-md-bold', italic: 'cm-md-italic', strike: 'cm-md-strike', code: 'cm-md-code', link: 'cm-md-link', url: 'cm-md-link' };

    const decorate = (view) => {
        const { state } = view;
        const typing = view.hasFocus && !state.readOnly;
        // Is the cursor, or any part of the selection, on this range?
        const on = (from, to) => typing && state.selection.ranges.some(r => r.from <= to && r.to >= from);
        // The same, but a cursor resting just after the range doesn't count
        const inside = (from, to) => typing && state.selection.ranges.some(r => (r.empty ? r.from >= from && r.from < to : r.from < to && r.to > from));
        const out = [];
        // A description far longer than anyone writes shows as plain text, so every keystroke in it stays quick
        if (state.doc.length > MAX_FORMATTED_DOC) return Decoration.none;
        const add = (from, to, deco) => { if (to > from) out.push(deco.range(from, to)); };
        // Blocks of code, each from its opening ``` line to its closing one, or to the end. Every
        // line is checked for this, which is quick. Formatting, which is not, is only worked out for
        // the lines on screen, so a note thousands of lines long types as fast as a short one.
        const blocks = [];
        let opened = null;
        let number = 0;
        for (const text of state.doc.iterLines()) {
            number++;
            if (!isFence(text)) continue;
            if (opened === null) opened = number;
            else { blocks.push({ first: opened, last: number, closed: true }); opened = null; }
        }
        if (opened !== null) blocks.push({ first: opened, last: state.doc.lines, closed: false });
        const blockAt = (n) => {
            let low = 0, high = blocks.length - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                if (n < blocks[mid].first) high = mid - 1;
                else if (n > blocks[mid].last) low = mid + 1;
                else return blocks[mid];
            }
            return null;
        };

        let done = 0;
        for (const range of view.visibleRanges) {
        const lastLine = state.doc.lineAt(range.to).number;
        for (let n = Math.max(done + 1, state.doc.lineAt(range.from).number); n <= lastLine; n++) {
            done = n;
            const line = state.doc.line(n);
            const at = line.from;
            const lineClass = (name) => out.push(Decoration.line({ class: name }).range(at));

            const code = blockAt(n);
            if (code) {
                const opens = n === code.first;
                const closes = code.closed && n === code.last;
                const lastCode = code.closed ? code.last - 1 : code.last;
                // The ``` lines show while the cursor is anywhere in the block, and are a thin edge
                // otherwise. A block with nothing in it keeps them, or there would be nothing to see.
                if (code.shown === undefined) code.shown = lastCode <= code.first || on(state.doc.line(code.first).from, state.doc.line(code.last).to);
                if (!opens && !closes) {
                    lineClass(`cm-md-codeblock${n === code.first + 1 ? ' cm-md-code-first' : ''}${n === lastCode ? ' cm-md-code-last' : ''}${!code.closed && n === code.last ? ' cm-md-code-end' : ''}${code.shown ? '' : ' cm-md-code-closed'}`);
                    continue;
                }
                lineClass(`cm-md-fence ${opens ? 'cm-md-fence-open' : 'cm-md-fence-close'}${code.shown ? '' : ' cm-md-fence-hidden'}`);
                if (!code.shown) add(at, line.to, hide);
                continue;
            }

            const block = lineBlock(line.text);
            let start = 0;
            if (block) {
                start = block.marker;
                if (block.type === 'heading') {
                    lineClass(`cm-md-heading cm-md-h${Math.min(block.level, 3)}`);
                    add(at, at + block.marker, on(at, line.to) ? symbol : hide);
                } else if (block.type === 'quote') {
                    lineClass('cm-md-quote');
                    add(at, at + block.marker, on(at, line.to) ? symbol : hide);
                } else if (block.type === 'number') {
                    lineClass('cm-md-item');
                    add(at + block.markerFrom, at + block.marker, Decoration.mark({ class: 'cm-md-number' }));
                } else {
                    lineClass('cm-md-item');
                    const from = at + block.markerFrom;
                    // The "- " itself, up to the space after it
                    const to = at + block.marker;
                    // An item being started, such as "- " or "- [ ", keeps its dash while the cursor
                    // is on the line, so a tick box can be typed without the dash turning into a bullet
                    const starting = !block.box && on(at, line.to) && /^(\[([ xX]\]?)?)?$/.test(line.text.slice(block.marker));
                    // A task item shows its tick box and no bullet
                    if (inside(from, to) || starting) add(from, to, symbol);
                    else if (block.box) add(from, to, hide);
                    else add(from, to - 1, Decoration.replace({ widget: new Bullet() }));
                    if (block.box) {
                        start = block.box.end;
                        const boxFrom = at + block.box.from, boxTo = at + block.box.to;
                        if (inside(boxFrom, boxTo)) add(boxFrom, boxTo, symbol);
                        else add(boxFrom, boxTo, Decoration.replace({ widget: new TaskBox(block.checked, boxFrom, state.readOnly) }));
                    }
                }
            }

            for (const mark of inlineMarks(line.text, start)) {
                const from = at + mark.from, to = at + mark.to;
                const shown = on(from, to);
                const url = mark.url && isValidUrl(mark.url) ? mark.url : null;
                if (mark.open) {
                    add(at + mark.open[0], at + mark.open[1], shown ? symbol : hide);
                    add(at + mark.close[0], at + mark.close[1], shown ? symbol : hide);
                    // A link opens on a click, unless its Markdown is showing for editing
                    // The address shows on hover, as the words of a link can say anything
                    const attributes = url && !shown ? { 'data-url': url, title: url } : undefined;
                    add(at + mark.open[1], at + mark.close[0], Decoration.mark({ class: STYLE[mark.type], attributes }));
                } else {
                    // A web address on its own has no symbols to edit, so it opens on a click even
                    // with the cursor on it, such as straight after typing it
                    add(from, to, Decoration.mark({ class: STYLE[mark.type], attributes: url ? { 'data-url': url, title: url } : undefined }));
                }
                // The address of a link with no words yet, [](address), is already being edited
                const unnamedLink = !mark.open && line.text.slice(0, mark.from).endsWith('[](');
                if (url && !shown && !state.readOnly && !unnamedLink) {
                    const pencil = mark.open ? new EditLink(at + mark.open[1]) : new EditLink(from, to);
                    out.push(Decoration.widget({ widget: pencil, side: 1 }).range(to));
                }
            }
        }
        }
        return Decoration.set(out, true);
    };

    return ViewPlugin.fromClass(class {
        constructor(view) { this.decorations = decorate(view); }
        update(update) {
            if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged || update.startState.readOnly !== update.state.readOnly) {
                this.decorations = decorate(update.view);
            }
        }
    }, { decorations: plugin => plugin.decorations });
};

// Ctrl+B and friends: wrap the selection in a Markdown symbol, or take the symbol off again.
// A selection that ends part way through a link or another formatted piece grows to take in
// all of it, so the symbols never land in the middle of a link's address.
const wrapSelection = (v, sym) => {
    if (v.state.readOnly) return false;
    let { from, to } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    if (to > line.to) return false;
    if (from === to) {
        v.dispatch({ changes: { from, insert: sym + sym }, selection: { anchor: from + sym.length }, userEvent: 'input' });
        return true;
    }
    for (const mark of inlineMarks(line.text)) {
        const a = line.from + mark.from, b = line.from + mark.to;
        if (a < to && b > from) { from = Math.min(from, a); to = Math.max(to, b); }
    }
    const text = v.state.sliceDoc(from, to);
    const n = sym.length;
    // Bold's ** also ends with italic's *, so a longer run of the same symbol isn't this one
    const wrapped = text.length >= n * 2 && text.startsWith(sym) && text.endsWith(sym) && (n > 1 || !text.startsWith(sym + sym));
    const insert = wrapped ? text.slice(n, -n) : sym + text + sym;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from, head: from + insert.length }, userEvent: 'input' });
    return true;
};

// Copy puts the text on the clipboard twice: as Markdown, for a plain text box or another card,
// and formatted, for an email, a chat or a document
const copySelection = (e, v, cut) => {
    const ranges = v.state.selection.ranges.filter(r => !r.empty);
    if (!ranges.length || !e.clipboardData) return false;
    const text = ranges.map(r => v.state.sliceDoc(r.from, r.to)).join('\n');
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', markdownToHtml(text));
    e.preventDefault();
    if (cut && !v.state.readOnly) v.dispatch({ changes: ranges.map(r => ({ from: r.from, to: r.to })), userEvent: 'delete.cut', scrollIntoView: true });
    return true;
};

// Is this position in ordinary text: not in a block of code, in code in a sentence, or in the
// address of a link that is being typed?
const plainTextAt = (state, pos) => {
    const line = state.doc.lineAt(pos);
    let inCode = false;
    for (let n = 1; n < line.number; n++) if (isFence(state.doc.line(n).text)) inCode = !inCode;
    if (inCode || isFence(line.text)) return false;
    const before = line.text.slice(0, pos - line.from);
    if (before.endsWith('](') || before.endsWith('<')) return false;
    return !inlineMarks(line.text).some(mark => line.from + mark.from < pos && pos < line.from + mark.to && (mark.type === 'code' || mark.type === 'link' || mark.type === 'url'));
};

// A link pasted with no words yet, per editor: where it is and its address. If the cursor leaves
// it still unnamed, it becomes the bare address, which shows as a link by itself. Only the editor
// that pasted it tidies it, so someone else's notepad never changes a link as it is being named.
const unnamed = new WeakMap();
const tidyUnnamedLink = (cm) => cm.EditorView.updateListener.of((update) => {
    const view = update.view;
    const link = unnamed.get(view);
    if (!link) return;
    if (update.docChanged) link.at = update.changes.mapPos(link.at, 1);
    const empty = `[](${link.url})`;
    const stillEmpty = update.state.sliceDoc(link.at, link.at + empty.length) === empty;
    const { head } = update.state.selection.main;
    const inside = head >= link.at && head <= link.at + empty.length;
    if (stillEmpty && inside && view.hasFocus) return;
    unnamed.delete(view);
    if (!stillEmpty || update.state.readOnly) return;
    // Not during this update: an editor can't be changed while it is being redrawn
    queueMicrotask(() => {
        if (view.state.sliceDoc(link.at, link.at + empty.length) !== empty) return;
        view.dispatch({ changes: { from: link.at, to: link.at + empty.length, insert: link.url }, userEvent: 'input' });
    });
});

// cm: the CodeMirror bundle. enterAction(text, from, to): what Enter does at the cursor, such as
// starting the next item of a list, or null for a plain new line.
export const markdownExtensions = (cm, { enterAction } = {}) => [
    cm.Prec.highest(cm.keymap.of([{
        key: 'Enter',
        run: (v) => {
            if (v.state.readOnly || !enterAction) return false;
            const { from, to } = v.state.selection.main;
            const action = enterAction(v.state.doc.toString(), from, to);
            if (!action) return false;
            if (action.insert === undefined) v.dispatch({ selection: { anchor: action.caret }, scrollIntoView: true });
            else v.dispatch({ changes: { from: action.from, to: action.to, insert: action.insert || '' }, selection: { anchor: action.caret }, userEvent: 'input', scrollIntoView: true });
            return true;
        }
    }])),
    cm.keymap.of([
        { key: 'Mod-b', run: (v) => wrapSelection(v, '**') },
        { key: 'Mod-i', run: (v) => wrapSelection(v, '*') },
        { key: 'Mod-Shift-x', run: (v) => wrapSelection(v, '~~') },
        { key: 'Mod-e', run: (v) => wrapSelection(v, '`') },
    ]),
    buildPreview(cm),
    tidyUnnamedLink(cm),
    // A symbol typed between a link's text and its address, as in [text]~~(address), would
    // break the link in two. Someone putting ~~ or ** round the words means the whole link,
    // so the symbol goes after the address.
    cm.EditorView.inputHandler.of((v, from, to, text) => {
        if (v.state.readOnly || from !== to || !/^[*~_`]+$/.test(text) || v.state.sliceDoc(from - 1, from) !== ']') return false;
        const line = v.state.doc.lineAt(from);
        const address = /^\((?:https?:|mailto:)[^)\s]+\)/.exec(line.text.slice(from - line.from));
        if (!address || !line.text.slice(0, from - line.from).includes('[')) return false;
        const at = from + address[0].length;
        v.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
        return true;
    }),
    cm.EditorView.domEventHandlers({
        copy: (e, v) => copySelection(e, v, false),
        cut: (e, v) => copySelection(e, v, true),
        // A web address pasted over selected words makes them a link to it. Pasted on its own it
        // arrives as an empty link, [](address), with the cursor between the square brackets,
        // ready for the words to show. Typed over a link, into code or after "](", it pastes as it is.
        paste: (e, v) => {
            const pasted = e.clipboardData?.getData('text/plain').trim();
            const { from, to, empty } = v.state.selection.main;
            if (v.state.readOnly || !isValidUrl(pasted) || /\s/.test(pasted)) return false;
            const words = v.state.sliceDoc(from, to);
            if (!empty) {
                if (words.includes('\n') || isValidUrl(words)) return false;
                e.preventDefault();
                const insert = `[${words}](${pasted})`;
                v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste' });
                return true;
            }
            if (!plainTextAt(v.state, from)) return false;
            e.preventDefault();
            v.dispatch({ changes: { from, insert: `[](${pasted})` }, selection: { anchor: from + 1 }, userEvent: 'input.paste' });
            unnamed.set(v, { at: from, url: pasted });
            return true;
        },
        // A click on a link opens it and leaves the cursor where it was. The pencil beside
        // the link, or the arrow keys, put the cursor in it to edit its Markdown.
        mousedown: (e) => {
            if (e.button !== 0 || e.shiftKey || !e.target.closest?.('[data-url]')) return false;
            e.preventDefault();
            return true;
        },
        click: (e) => {
            const url = e.target.closest?.('[data-url]')?.dataset.url;
            if (e.button !== 0 || e.shiftKey || !url) return false;
            window.open(url, '_blank', 'noopener');
            return true;
        }
    })
];
