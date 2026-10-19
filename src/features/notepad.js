// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Notepad module — CodeMirror 6 + y-codemirror.next
// Dependencies are lazy-loaded to avoid blocking the critical rendering path.

let view = null;
let activeYtext = null;
let _initPromise = null;

// Loaded lazily on first init()
let EditorView, EditorState, Compartment, keymap;
let defaultKeymap, history, historyKeymap;
let yCollab;
let collabCompartment, readOnlyCompartment;

// Callbacks set via init()
let _state = null;
let _saveToStorage = null;
let _isMapEditable = null;
let _logTextEdit = null;

const stripHtmlTags = (text) => text.replace(/<[^>]*>/g, '');

let _loadPromise = null;
const loadDeps = () => {
    if (_loadPromise) return _loadPromise;
    _loadPromise = import('/vendor/codemirror.bundle.js').then((mod) => {
        EditorView = mod.EditorView;
        keymap = mod.keymap;
        EditorState = mod.EditorState;
        Compartment = mod.Compartment;
        defaultKeymap = mod.defaultKeymap;
        history = mod.history;
        historyKeymap = mod.historyKeymap;
        yCollab = mod.yCollab;
        collabCompartment = new Compartment();
        readOnlyCompartment = new Compartment();
    });
    return _loadPromise;
};

/**
 * Initialize the CodeMirror editor and attach toggle/close listeners.
 * @param {Object} opts
 * @param {Object} opts.state        — app state object (has .notes, .mapId)
 * @param {Function} opts.saveToStorage — persist callback
 * @param {Function} opts.isMapEditable — returns boolean
 */
export const init = (opts) => {
    _state = opts.state;
    _saveToStorage = opts.saveToStorage;
    _isMapEditable = opts.isMapEditable;
    _logTextEdit = opts.logTextEdit;

    // Close button closes the entire unified panel
    const close = document.getElementById('notesClose');
    const controlsRight = document.getElementById('controlsRight');
    close?.addEventListener('click', () => {
        controlsRight?.classList.remove('panel-open');
        document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    });
};

export const ensureEditor = () => _ensureEditor();

// Lazy-load CodeMirror and create the editor on first use
const _ensureEditor = () => {
    if (_initPromise) return _initPromise;
    const parent = document.getElementById('notesEditor');
    if (!parent) return Promise.resolve();
    _initPromise = loadDeps().then(() => _createEditor(parent));
    return _initPromise;
};

const _createEditor = (parent) => {

    const theme = EditorView.theme({
        '&': {
            fontSize: '14px',
            fontFamily: 'inherit',
            color: '#333',
        },
        '.cm-content': {
            padding: '10px 14px',
            lineHeight: '25px',
            caretColor: '#333',
        },
        '&.cm-focused': {
            outline: 'none',
        },
        '.cm-scroller': {
            overflow: 'auto',
            overflowX: 'hidden',
        },
        '.cm-line': {
            padding: '0',
        },
        '.cm-cursor': {
            borderLeftColor: '#333',
        },
        '.cm-ySelectionInfo': {
            opacity: '1',
            fontSize: '10px',
            padding: '1px 3px',
            borderRadius: '3px 3px 3px 0',
            fontFamily: 'Inter, system-ui, sans-serif',
        },
    });

    view = new EditorView({
        parent,
        state: EditorState.create({
            doc: _state.notes || '',
            extensions: [
                keymap.of([...defaultKeymap, ...historyKeymap]),
                history(),
                EditorView.lineWrapping,
                theme,
                readOnlyCompartment.of(EditorState.readOnly.of(!_isMapEditable())),
                collabCompartment.of([]),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        _state.notes = view.state.doc.toString();
                        // Only the person's own edits save. Notes arriving from the server, or loaded into
                        // the editor, must not: saving writes the whole in-memory map to the shared document,
                        // and on a map that hasn't finished loading that map is empty, which wiped maps.
                        const isUserEdit = update.transactions.some(tr =>
                            ['input', 'delete', 'undo', 'redo', 'move'].some(event => tr.isUserEvent(event)));
                        if (!isUserEdit) return;
                        if (update.transactions.some(tr => tr.isUserEvent('input'))) _logTextEdit?.('notes', 'notes');
                        _saveToStorage();
                    }
                }),
            ],
        }),
    });

};

/**
 * Activate yCollab extension (call after provider sync).
 */
export const bindYjs = async (ydoc, ytext, provider) => {
    await _ensureEditor();
    if (!view) return;
    activeYtext = ytext;

    // yCollab expects the editor doc to already match ytext when attached,
    // so sync content first before enabling the collab extension.
    const ytextContent = ytext.toString();
    const current = view.state.doc.toString();
    if (current !== ytextContent) {
        view.dispatch({
            changes: { from: 0, to: current.length, insert: ytextContent },
        });
    }

    const extensions = yCollab(ytext, provider.awareness, { undoManager: false });

    view.dispatch({
        effects: collabCompartment.reconfigure(extensions),
    });
};

/**
 * Deactivate yCollab (on doc destroy).
 */
export const unbindYjs = () => {
    if (!view) return;
    activeYtext = null;

    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });
};

/**
 * Migrate old ymap string notes into Y.Text.
 */
export const migrateLegacyNotes = (ymap, ytext, state) => {
    const legacyNotes = ymap.get('notes');
    if (typeof legacyNotes === 'string' && legacyNotes && ytext.length === 0) {
        ytext.insert(0, legacyNotes);
        ymap.delete('notes');
    }
    // Only overwrite state.notes from ytext if ytext has content,
    // otherwise preserve notes from deserialize (e.g. sample load)
    if (ytext.length > 0) {
        state.notes = stripHtmlTags(ytext.toString());
    }
};

/**
 * Toggle read-only state; sync state.notes → editor when offline.
 */
export const update = () => {
    if (!view) return;

    const editable = _isMapEditable();
    view.dispatch({
        effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(!editable)),
    });

    // When offline (no yCollab active), push state.notes into the editor
    if (!activeYtext) {
        const current = view.state.doc.toString();
        if (current !== _state.notes) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: _state.notes || '' },
            });
        }
    }
};
