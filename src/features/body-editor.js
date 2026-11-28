// Storymaps.io — AGPL-3.0 — see LICENCE for details
// The details box of an open card. The text is Markdown. It shows formatted, and a formatted
// piece shows its Markdown symbols only while the cursor or the selection is on it.
//
// The box starts as the plain textarea in the page, so a card opens at once. CodeMirror loads in
// the background and takes over from the textarea when it's ready. Either way the rest of the app
// talks to the one object made here, which looks enough like a textarea for what it needs.

import { markdownExtensions } from '/src/features/markdown-editor.js';

let cm = null;
let loading = null;
const loadCodeMirror = () => {
    loading ||= import('/vendor/codemirror.bundle.js').then((mod) => { cm = mod; });
    return loading;
};

// textarea: the details textarea in the page.
// onInput: called after the person types or pastes. onBlur: called when the box loses focus.
// enterAction(text, from, to): what Enter does at the cursor, or null for a plain new line.
export const createBodyBox = (textarea, { onInput, onBlur, enterAction }) => {
    let view = null;
    let readOnly = textarea.readOnly;
    let lock = null;
    // True while text from the map is being put into the box, which isn't typing
    let setting = false;

    const resizeTextarea = () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    };

    // Replace part of the text as if typed, so undo can take it back
    const replace = ({ from, to, insert, caret }) => {
        if (view) {
            view.focus();
            view.dispatch({ changes: { from, to, insert: insert || '' }, selection: { anchor: caret }, userEvent: 'input', scrollIntoView: true });
            return;
        }
        textarea.focus();
        textarea.setSelectionRange(from, to);
        const done = insert ? document.execCommand('insertText', false, insert) : document.execCommand('delete');
        if (!done) {
            textarea.setRangeText(insert || '', from, to, 'end');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        textarea.setSelectionRange(caret, caret);
    };

    // Enter in a list starts the next item, and so on. False leaves Enter to add a new line.
    const pressEnter = (text, from, to, moveTo) => {
        if (readOnly) return false;
        const action = enterAction(text, from, to);
        if (!action) return false;
        if (action.insert === undefined) moveTo(action.caret);
        else replace(action);
        return true;
    };

    textarea.addEventListener('input', () => { if (!view) onInput(); });
    textarea.addEventListener('blur', () => { if (!view) onBlur(); });
    textarea.addEventListener('keydown', (e) => {
        if (view || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        if (pressEnter(textarea.value, textarea.selectionStart, textarea.selectionEnd, (at) => textarea.setSelectionRange(at, at))) e.preventDefault();
    });

    const lockExtensions = () => [cm.EditorState.readOnly.of(readOnly), cm.EditorView.editable.of(!readOnly)];

    const newState = (text) => cm.EditorState.create({
        doc: text,
        extensions: [
            cm.history(),
            // Formatting, shortcuts, links, lists and the clipboard (markdown-editor.js)
            ...markdownExtensions(cm, { enterAction }),
            cm.keymap.of([...cm.defaultKeymap, ...cm.historyKeymap]),
            cm.EditorView.lineWrapping,
            cm.placeholder(textarea.placeholder),
            cm.EditorView.contentAttributes.of({ 'aria-label': 'Details', spellcheck: 'true' }),
            lock.of(lockExtensions()),
            cm.EditorView.updateListener.of((update) => {
                // The hidden textarea keeps a copy of the text, for anything that reads the page
                if (update.docChanged) textarea.value = update.state.doc.toString();
                if (update.docChanged && !setting) onInput();
                if (update.focusChanged && !update.view.hasFocus) onBlur();
            }),
            cm.EditorView.domEventHandlers({
                // Esc leaves the box, so everything shows formatted again. A second Esc closes the card.
                keydown: (e, v) => {
                    if (e.key !== 'Escape' || !v.hasFocus || readOnly) return false;
                    e.stopPropagation();
                    v.contentDOM.blur();
                    return true;
                },
            })
        ]
    });

    const mount = () => {
        if (view) return;
        lock = new cm.Compartment();
        const holder = document.createElement('div');
        holder.className = 'card-expand-body card-expand-md md-editor';
        textarea.after(holder);
        const focused = document.activeElement === textarea;
        const { selectionStart, selectionEnd } = textarea;
        view = new cm.EditorView({ parent: holder, state: newState(textarea.value) });
        textarea.hidden = true;
        if (focused) {
            view.focus();
            view.dispatch({ selection: { anchor: selectionStart, head: selectionEnd } });
        }
    };

    return {
        // Swap the textarea for the Markdown editor, once it has loaded
        load: () => loadCodeMirror().then(mount),
        get value() { return view ? view.state.doc.toString() : textarea.value; },
        // Show a card that has just been opened: its text, with nothing to undo
        open(text) {
            if (view) view.setState(newState(text));
            textarea.value = text;
        },
        // Show text someone else changed, keeping the cursor where it is
        show(text) {
            if (!view) {
                if (textarea.value === text) return;
                const focused = document.activeElement === textarea;
                const { selectionStart, selectionEnd } = textarea;
                textarea.value = text;
                if (focused) textarea.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length));
                resizeTextarea();
                return;
            }
            const now = view.state.doc.toString();
            if (now === text) return;
            // Change only the part that differs, so the cursor stays put around it
            let start = 0;
            while (start < now.length && start < text.length && now[start] === text[start]) start++;
            let endNow = now.length, endText = text.length;
            while (endNow > start && endText > start && now[endNow - 1] === text[endText - 1]) { endNow--; endText--; }
            setting = true;
            try {
                view.dispatch({ changes: { from: start, to: endNow, insert: text.slice(start, endText) } });
            } finally {
                setting = false;
            }
        },
        get readOnly() { return readOnly; },
        set readOnly(value) {
            readOnly = !!value;
            textarea.readOnly = readOnly;
            if (view) view.dispatch({ effects: lock.reconfigure(lockExtensions()) });
        },
        get selectionEnd() { return view ? view.state.selection.main.to : textarea.selectionEnd; },
        resize: () => { if (!view) resizeTextarea(); },
        replace
    };
};
