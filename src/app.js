// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Orchestrator — imports all modules, wires init(), owns dom + persistence + event listeners

import * as notepad from '/src/features/notepad.js';
import * as log from '/src/core/log.js';
import { generateId, el, CARD_COLORS } from '/src/core/constants.js';
import { state, init as stateInit, initState, hasContent, pushUndo, undo, redo, updateUndoRedoButtons, createStory, createSlice, selection, clearSelection } from '/src/core/state.js';
import { serialize, deserialize } from '/src/core/serialization.js';
import * as navigation from '/src/ui/navigation.js';
import * as presence from '/src/ui/presence.js';
import * as lock from '/src/core/lock.js';
import * as yjs from '/src/core/yjs.js';
import * as ui from '/src/ui/ui.js';
import * as renderMod from '/src/ui/render.js';
import { showAlert, showConfirm, showPrompt, showToast } from '/src/core/modals.js';
import * as tour from '/src/features/tour.js';
import { dom } from '/src/ui/dom.js';
import * as search from '/src/features/search.js';
import * as backups from '/src/features/backups.js';
import * as cardExpand from '/src/features/card-expand.js';
import * as io from '/src/transfer/io.js';
import * as welcome from '/src/features/welcome.js';
import * as partials from '/src/features/partials.js';
import * as build from '/src/features/build.js';
import * as sliceLinks from '/src/features/slice-links.js';

const { isMapEditable } = lock;
const { render, initSortable, addColumn, addColumnAt, addStory, addSlice, deleteColumn, deleteStory, deleteSlice, handleColumnSelection, updateSelectionUI, duplicateColumns, duplicateCards, deleteSelectedColumns, deleteSelectedCards, setPreserveToolbar } = renderMod;
const { closeMainMenu, closeAllOptionsMenus, zoomToFit, scrollElementIntoView } = navigation;
const { loadYjs, createYjsDoc, destroyYjs, syncFromYjs, syncToYjs, getProvider, getYdoc, getYmap, ensureSortable } = yjs;
const { trackPresence, trackCursor, toggleCursorsVisibility, updateCursorsVisibilityUI, getCursorColor, getSessionId, broadcastDragStart, broadcastDragEnd } = presence;
const { lockState, loadLockState, subscribeLockState, updateLockUI, updateEditability, checkSessionUnlock, initLockListeners, hideLockModal } = lock;
const { renderLegend, renderPartialsList, renderMapStats } = ui;

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY = 'storymap';

// Generate a unique map ID, checking server-side SQLite for collisions
const newMapId = async () => {
    try {
        const res = await fetch('/api/maps/new-id');
        if (res.ok) return (await res.json()).id;
    } catch { /* fall through */ }
    return generateId();
};

// Subscribe to real-time updates via Yjs
const subscribeToMap = async (mapId) => {
    if (!getYdoc()) {
        await createYjsDoc(mapId);
    }

    syncFromYjs();
    render();

    const deferredTracking = async () => {
        await trackPresence();
        trackCursor();
        await loadLockState(mapId);
        lockState.sessionUnlocked = checkSessionUnlock(mapId);
        subscribeLockState(mapId);
        updateLockUI();
        updateEditability();
        // Fetch backup count for menu badge
        fetch(`/api/backups/${mapId}`).then(r => r.json()).then(b => updateBackupBadge(b.length)).catch(() => {});

        const provider = getProvider();
        if (provider) {
            provider.awareness.on('change', () => {
                const ydoc = getYdoc();
                for (const [clientId, awarenessState] of provider.awareness.getStates()) {
                    if (clientId === ydoc.clientID) continue;
                    if (awarenessState.lock) {
                        loadLockState(mapId).then(() => {
                            lockState.sessionUnlocked = checkSessionUnlock(mapId);
                            updateLockUI();
                            updateEditability();
                        });
                        break;
                    }
                }
            });
        }
    };
    if ('requestIdleCallback' in window) {
        requestIdleCallback(deferredTracking);
    } else {
        setTimeout(deferredTracking, 0);
    }
};

// Local storage save (also syncs to Yjs → WebSocket → server)
const saveToStorage = () => {
    if (state.mapId && !isMapEditable()) {
        return;
    }

    // Never write an empty map over a shared document that has steps while the map isn't open.
    // An empty in-memory map at that point means it hasn't loaded into this browser yet, and
    // writing it would wipe the map for everyone.
    const ymapForGuard = getYmap();
    if (state.mapId && ymapForGuard && !state.mapLoaded && state.columns.length === 0
        && (ymapForGuard.get('columns')?.length || 0) > 0) {
        return;
    }

    // Don't overwrite localStorage that has real data with an empty state
    // (protects against Yjs sync returning partial data e.g. notes only)
    if (state.columns.length === 0) {
        const existing = localStorage.getItem(STORAGE_KEY);
        if (existing) {
            try {
                const parsed = JSON.parse(existing);
                if (parsed.steps && parsed.steps.length > 0) return;
            } catch { /* corrupted — ok to overwrite */ }
        }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    if (state.mapId) localStorage.setItem(STORAGE_KEY + ':mapId', state.mapId);
    // Some edits patch a single card without a full render, so refresh the Legend panel's stats here
    renderMapStats();
    if (state.mapId && getYmap()) {
        syncToYjs();
    }
};

// Combined render and save - used after state mutations
const renderAndSave = () => {
    partials.ensurePartialBlankCol();
    render();
    saveToStorage();
    if (dom.searchInput.value.trim() || hasActiveFilters()) {
        applySearchFilter(dom.searchInput.value.trim());
    }
};

const { openExpandModal, closeExpandModal } = cardExpand;

// Disconnect from a map before showing the home page, so nothing on the home page can write to it
const leaveMapForWelcome = () => {
    destroyYjs();
    state.mapId = null;
    showWelcomeScreen();
};

const loadFromStorage = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            deserialize(JSON.parse(data));
            return true;
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
    }
    return false;
};

const { exportMap, sanitizeFilename, formatTimestamp, createAutoBackup, hideImportModal, hideExportModal, hideExportYamlModal, hideExportCsvModal } = io;
const { exportsMod, jiraImportsMod, asanaImportsMod, phabImportsMod, linearImportsMod } = io;

const {
    showJiraExportModal, hideJiraExportModal, confirmCloseJiraExportModal, populateJiraExportEpics, downloadJiraCsv, jiraExportState,
    showPhabExportModal, hidePhabExportModal, confirmClosePhabModal, populatePhabExportEpics, showPhabStage2, showPhabStage1,
    generatePhabImportFunction, generatePhabImportCall, copyPhabCode, phabExportState,
    showJiraApiExportModal, hideJiraApiExportModal, confirmCloseJiraApiModal, populateJiraApiExportEpics,
    showJiraApiStage2, showJiraApiStage1, generateJiraApiImportCall, jiraApiExportState,
    showAsanaExportModal, hideAsanaExportModal, confirmCloseAsanaModal, populateAsanaExportEpics,
    showAsanaStage2, showAsanaStage1, generateAsanaImportCall, asanaExportState,
    showAsanaCsvExportModal, hideAsanaCsvExportModal, confirmCloseAsanaCsvModal,
    populateAsanaCsvExportEpics, downloadAsanaCsv, asanaCsvExportState,
    showJiraProxyExportModal, hideJiraProxyExportModal, confirmCloseJiraProxyModal,
    populateJiraProxyExportEpics, showJiraProxyStage2, showJiraProxyStage1,
    exportToJiraProxy, jiraProxyExportState, verifyJiraProxy,
    showPhabProxyExportModal, hidePhabProxyExportModal, confirmClosePhabProxyModal,
    populatePhabProxyExportEpics, showPhabProxyStage2, showPhabProxyStage1,
    exportToPhabProxy, phabProxyExportState, verifyPhabProxy,
    showAsanaProxyExportModal, hideAsanaProxyExportModal, confirmCloseAsanaProxyModal,
    populateAsanaProxyExportEpics, showAsanaProxyStage2, showAsanaProxyStage1,
    exportToAsanaProxy, asanaProxyExportState, verifyAsanaProxy,
    showLinearProxyExportModal, hideLinearProxyExportModal, confirmCloseLinearProxyModal,
    populateLinearProxyExportEpics, showLinearProxyStage2, showLinearProxyStage1,
    exportToLinearProxy, linearProxyExportState, verifyLinearProxy,
} = exportsMod;

const {
    showJiraImportModal, hideJiraImportModal, confirmCloseJiraImportModal,
    verifyJiraImport, fetchFromJira, showJiraImportStage1, confirmJiraImport,
    showJiraCsvImportModal, handleJiraCsvFile,
} = jiraImportsMod;

const {
    showAsanaImportModal, hideAsanaImportModal, confirmCloseAsanaImportModal,
    verifyAsanaImport, fetchFromAsana, showAsanaImportStage1, confirmAsanaImport,
    showAsanaCsvImportModal, handleAsanaCsvFile, handleAsanaMappingModeChange,
} = asanaImportsMod;

const {
    showPhabImportModal, showPhabCsvImportModal, hidePhabImportModal, confirmClosePhabImportModal,
    verifyPhabImport, fetchFromPhab, handlePhabCsvFile, showPhabImportStage1, confirmPhabImport,
} = phabImportsMod;

const {
    showLinearImportModal, hideLinearImportModal, confirmCloseLinearImportModal,
    verifyLinearImport, fetchFromLinear, showLinearImportStage1, confirmLinearImport,
    showLinearCsvImportModal, handleLinearCsvFile, handleLinearMappingModeChange,
} = linearImportsMod;

const { updateBackupBadge } = backups;

const { showWelcomeScreen, hideWelcomeScreen, showLoading, hideLoading, startNewMap, startWithSample, showTutorialToast, newMap, copyMap, loadSample } = welcome;

// =============================================================================
// Event Listeners
// =============================================================================

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const { applySearchFilter, hasActiveFilters, closeSearch, openSearch, closeFilterPanel, itemMatchesFilters } = search;

const initEventListeners = () => {
    dom.logoLink.addEventListener('click', async (e) => {
        if (!state.mapId) return;
        e.preventDefault();
        if (!hasContent() || await showConfirm('Go to home page?\n\nYou can return to this map using the back button.')) {
            window.location.href = '/';
        }
    });

    welcome.initListeners();

    document.querySelector('.welcome-integrations')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.welcome-integration');
        if (!btn?.dataset.import) return;
        const importMap = {
            jira: showJiraImportModal,
            asana: showAsanaImportModal,
            phabricator: showPhabImportModal,
            linear: showLinearImportModal,
        };
        importMap[btn.dataset.import]?.();
    });

    // Force light mode for printing (dark backgrounds waste ink and browsers
    // skip background colours by default, causing illegible text).
    window.addEventListener('beforeprint', () => {
        if (document.documentElement.classList.contains('dark-mode')) {
            document.documentElement.dataset.wasDark = '1';
            document.documentElement.classList.remove('dark-mode');
        }
    });
    window.addEventListener('afterprint', () => {
        if (document.documentElement.dataset.wasDark) {
            delete document.documentElement.dataset.wasDark;
            document.documentElement.classList.add('dark-mode');
        }
    });

    window.addEventListener('hashchange', () => {
        if (getYdoc() && !dom.welcomeScreen.classList.contains('visible')) sliceLinks.revealSliceFromHash();
    });

    window.addEventListener('popstate', async (e) => {
        // Ignore popstate from our own history.back() after closing expand modal
        if (cardExpand.isPoppingExpandState()) {
            cardExpand.clearPoppingExpandState();
            return;
        }
        // Back button closes expand modal instead of navigating
        if (cardExpand.getExpandedItem()) {
            cardExpand.closeExpandViaBack();
            return;
        }
        const mapId = window.location.pathname.slice(1) || null;
        // A slice link on the open map only changes the hash; hashchange scrolls to the slice
        if (mapId && mapId === state.mapId && getYdoc() && !dom.welcomeScreen.classList.contains('visible')) return;
        if (mapId) {
            if (await loadMapById(mapId)) hideWelcomeScreen();
            else leaveMapForWelcome();
        } else {
            destroyYjs();
            showWelcomeScreen();
        }
    });

    dom.boardName.addEventListener('input', (e) => {
        state.name = e.target.value;
        log.logTextEdit('map title', 'map');
        saveToStorage();
    });

    dom.boardName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dom.boardName.blur();
        }
    });

    dom.newMapBtn.addEventListener('click', () => {
        closeMainMenu();
        newMap();
    });
    dom.copyExistingBtn.addEventListener('click', () => {
        closeMainMenu();
        copyMap();
    });
    dom.exportBtn.addEventListener('click', () => {
        closeMainMenu();
        exportMap();
    });
    dom.printBtn.addEventListener('click', () => {
        closeMainMenu();
        const originalTitle = document.title;
        document.title = sanitizeFilename(state.name || 'story-map');
        window.print();
        document.title = originalTitle;
    });
    backups.initListeners();
    cardExpand.initListeners();

    dom.toggleCursorsBtn?.addEventListener('click', () => {
        toggleCursorsVisibility();
    });
    // Focus mode toggle
    let focusMode = localStorage.getItem('focusMode') === 'true';
    function applyFocusMode() {
        document.body.classList.toggle('focus-mode', focusMode);
        if (dom.toggleFocusModeBtn) {
            dom.toggleFocusModeBtn.classList.toggle('active', focusMode);
            dom.toggleFocusModeBtn.title = focusMode ? 'Exit focus mode' : 'Focus mode';
        }
    }
    applyFocusMode();
    dom.toggleFocusModeBtn?.addEventListener('click', () => {
        focusMode = !focusMode;
        localStorage.setItem('focusMode', focusMode);
        applyFocusMode();
    });
    // Dark mode toggle
    let darkMode = (() => {
        try {
            const stored = localStorage.getItem('darkMode');
            if (stored !== null) return stored === 'true';
        } catch (e) {}
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    })();
    function applyDarkMode() {
        document.documentElement.classList.toggle('dark-mode', darkMode);
        if (dom.toggleDarkModeBtn) {
            dom.toggleDarkModeBtn.classList.toggle('active', darkMode);
            dom.toggleDarkModeBtn.title = darkMode ? 'Light mode' : 'Dark mode';
        }
    }
    applyDarkMode();
    dom.toggleDarkModeBtn?.addEventListener('click', () => {
        darkMode = !darkMode;
        try { localStorage.setItem('darkMode', darkMode); } catch (e) {}
        applyDarkMode();
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        try { if (localStorage.getItem('darkMode') !== null) return; } catch (ex) {}
        darkMode = e.matches;
        applyDarkMode();
    });
    // Fullscreen mode — double-Esc to exit (single Esc is used by modals, expand view, etc.)
    let fullscreenMode = false;
    let lastFullscreenEsc = 0;
    let keyboardLocked = false;
    const updateFullscreenLabel = () => {
        if (dom.toggleFullscreenBtn) {
            dom.toggleFullscreenBtn.classList.toggle('active', fullscreenMode);
            dom.toggleFullscreenBtn.title = fullscreenMode ? 'Exit full screen' : 'Full screen';
        }
    };
    const enterFullscreenMode = () => {
        fullscreenMode = true;
        lastFullscreenEsc = 0;
        document.documentElement.requestFullscreen().then(() => {
            requestAnimationFrame(zoomToFit);
            // Keyboard Lock API (Chrome/Edge): prevent browser from auto-exiting on Esc
            if (navigator.keyboard?.lock) {
                navigator.keyboard.lock(['Escape']).then(() => { keyboardLocked = true; }).catch(() => {});
            }
        }).catch(() => { fullscreenMode = false; });
    };
    const exitFullscreenMode = () => {
        fullscreenMode = false;
        lastFullscreenEsc = 0;
        keyboardLocked = false;
        if (document.fullscreenElement) {
            const p = document.exitFullscreen();
            if (p?.then) p.then(() => requestAnimationFrame(zoomToFit));
        }
    };
    if (dom.toggleFullscreenBtn && !document.fullscreenEnabled) {
        dom.toggleFullscreenBtn.remove();
    }
    dom.toggleFullscreenBtn?.addEventListener('click', () => {
        if (fullscreenMode) exitFullscreenMode();
        else enterFullscreenMode();
    });
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && fullscreenMode) {
            // Browser exited fullscreen (Esc without keyboard lock) — re-enter
            document.documentElement.requestFullscreen().then(() => {
                if (navigator.keyboard?.lock) {
                    navigator.keyboard.lock(['Escape']).then(() => { keyboardLocked = true; }).catch(() => {});
                }
            }).catch(() => { fullscreenMode = false; requestAnimationFrame(zoomToFit); });
        }
        if (!document.fullscreenElement && !fullscreenMode) {
            keyboardLocked = false;
            requestAnimationFrame(zoomToFit);
        }
        updateFullscreenLabel();
    });
    io.initListeners();

    dom.importJiraBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showJiraImportModal();
    });

    // Jira Import modal events
    dom.jiraImportModalClose.addEventListener('click', confirmCloseJiraImportModal);
    dom.jiraImportModal.addEventListener('click', (e) => {
        if (e.target === dom.jiraImportModal) confirmCloseJiraImportModal();
    });
    dom.jiraImportCancel.addEventListener('click', confirmCloseJiraImportModal);
    dom.jiraImportVerifyBtn.addEventListener('click', verifyJiraImport);
    dom.jiraImportFetchBtn.addEventListener('click', fetchFromJira);
    dom.jiraImportBack.addEventListener('click', showJiraImportStage1);
    dom.jiraImportConfirmBtn.addEventListener('click', confirmJiraImport);

    // Jira CSV Import
    dom.importJiraCsvBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showJiraCsvImportModal();
    });
    dom.jiraCsvDropzone.addEventListener('click', () => dom.jiraCsvFileInput.click());
    dom.jiraCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.jiraCsvDropzone.classList.add('dragover');
    });
    dom.jiraCsvDropzone.addEventListener('dragleave', () => {
        dom.jiraCsvDropzone.classList.remove('dragover');
    });
    dom.jiraCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.jiraCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            dom.jiraCsvDropzone.querySelector('span').textContent = file.name;
            dom.jiraCsvImportParseBtn.disabled = false;
            dom.jiraCsvFileInput._droppedFile = file;
        }
    });
    dom.jiraCsvFileInput.addEventListener('change', () => {
        const file = dom.jiraCsvFileInput.files[0];
        if (file) {
            dom.jiraCsvDropzone.querySelector('span').textContent = file.name;
            dom.jiraCsvImportParseBtn.disabled = false;
            dom.jiraCsvFileInput._droppedFile = null;
        }
    });
    dom.jiraCsvImportParseBtn.addEventListener('click', () => {
        const file = dom.jiraCsvFileInput._droppedFile || dom.jiraCsvFileInput.files[0];
        handleJiraCsvFile(file);
    });
    dom.jiraCsvImportCancel.addEventListener('click', confirmCloseJiraImportModal);

    // Asana Import
    dom.importAsanaBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showAsanaImportModal();
    });

    // Asana Import modal events
    dom.asanaImportModalClose.addEventListener('click', confirmCloseAsanaImportModal);
    dom.asanaImportModal.addEventListener('click', (e) => {
        if (e.target === dom.asanaImportModal) confirmCloseAsanaImportModal();
    });
    dom.asanaImportCancel.addEventListener('click', confirmCloseAsanaImportModal);
    dom.asanaImportVerifyBtn.addEventListener('click', verifyAsanaImport);
    dom.asanaImportFetchBtn.addEventListener('click', fetchFromAsana);
    dom.asanaImportBack.addEventListener('click', showAsanaImportStage1);
    dom.asanaImportConfirmBtn.addEventListener('click', confirmAsanaImport);
    dom.asanaImportMappingMode.addEventListener('change', (e) => {
        if (e.target.name === 'asanaMappingMode') handleAsanaMappingModeChange(e.target.value);
    });

    // Asana CSV Import
    dom.importAsanaCsvBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showAsanaCsvImportModal();
    });
    dom.asanaCsvDropzone.addEventListener('click', () => dom.asanaCsvFileInput.click());
    dom.asanaCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.asanaCsvDropzone.classList.add('dragover');
    });
    dom.asanaCsvDropzone.addEventListener('dragleave', () => {
        dom.asanaCsvDropzone.classList.remove('dragover');
    });
    dom.asanaCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.asanaCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            dom.asanaCsvDropzone.querySelector('span').textContent = file.name;
            dom.asanaCsvImportParseBtn.disabled = false;
            dom.asanaCsvFileInput._droppedFile = file;
        }
    });
    dom.asanaCsvFileInput.addEventListener('change', () => {
        const file = dom.asanaCsvFileInput.files[0];
        if (file) {
            dom.asanaCsvDropzone.querySelector('span').textContent = file.name;
            dom.asanaCsvImportParseBtn.disabled = false;
            dom.asanaCsvFileInput._droppedFile = null;
        }
    });
    dom.asanaCsvImportParseBtn.addEventListener('click', () => {
        const file = dom.asanaCsvFileInput._droppedFile || dom.asanaCsvFileInput.files[0];
        handleAsanaCsvFile(file);
    });
    dom.asanaCsvImportCancel.addEventListener('click', confirmCloseAsanaImportModal);

    // Phabricator API Import
    dom.importPhabBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showPhabImportModal();
    });
    // Phabricator CSV Import
    dom.importPhabCsvBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showPhabCsvImportModal();
    });
    dom.phabImportModalClose.addEventListener('click', confirmClosePhabImportModal);
    dom.phabImportModal.addEventListener('click', (e) => {
        if (e.target === dom.phabImportModal) confirmClosePhabImportModal();
    });
    dom.phabImportCancel.addEventListener('click', confirmClosePhabImportModal);
    dom.phabImportVerifyBtn.addEventListener('click', verifyPhabImport);
    dom.phabImportFetchBtn.addEventListener('click', fetchFromPhab);
    dom.phabImportInstanceUrl.addEventListener('input', () => {
        // Update token help link when instance URL changes
        const url = dom.phabImportInstanceUrl.value.trim();
        const link = dom.phabImportTokenHelp;
        if (url) {
            const base = url.startsWith('http') ? url : 'https://' + url;
            try { link.href = new URL(base).origin + '/conduit/token/'; } catch { link.href = '#'; }
        } else {
            link.href = '#';
        }
    });
    dom.phabImportTokenHelp?.addEventListener('click', async (e) => {
        e.preventDefault();
        await showAlert('To get your API token:\n\n1. Click your profile picture in Phabricator\n2. Go to Settings\n3. Click "Conduit API Tokens"\n4. Click "Generate Token"');
    });
    dom.phabCsvImportCancel.addEventListener('click', confirmClosePhabImportModal);
    dom.phabCsvDropzone.addEventListener('click', () => dom.phabCsvFileInput.click());
    dom.phabCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.phabCsvDropzone.classList.add('dragover');
    });
    dom.phabCsvDropzone.addEventListener('dragleave', () => {
        dom.phabCsvDropzone.classList.remove('dragover');
    });
    dom.phabCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.phabCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            dom.phabCsvDropzone.querySelector('span').textContent = file.name;
            dom.phabCsvImportParseBtn.disabled = false;
            dom.phabCsvFileInput._droppedFile = file;
        }
    });
    dom.phabCsvFileInput.addEventListener('change', () => {
        const file = dom.phabCsvFileInput.files[0];
        if (file) {
            dom.phabCsvDropzone.querySelector('span').textContent = file.name;
            dom.phabCsvImportParseBtn.disabled = false;
            dom.phabCsvFileInput._droppedFile = null;
        }
    });
    dom.phabCsvImportParseBtn.addEventListener('click', () => {
        const file = dom.phabCsvFileInput._droppedFile || dom.phabCsvFileInput.files[0];
        handlePhabCsvFile(file);
    });
    dom.phabImportBack.addEventListener('click', showPhabImportStage1);
    dom.phabImportConfirmBtn.addEventListener('click', confirmPhabImport);

    // Linear API Import
    dom.importLinearBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showLinearImportModal();
    });

    // Linear Import modal events
    dom.linearImportModalClose.addEventListener('click', confirmCloseLinearImportModal);
    dom.linearImportModal.addEventListener('click', (e) => {
        if (e.target === dom.linearImportModal) confirmCloseLinearImportModal();
    });
    dom.linearImportCancel.addEventListener('click', confirmCloseLinearImportModal);
    dom.linearImportVerifyBtn.addEventListener('click', verifyLinearImport);
    dom.linearImportFetchBtn.addEventListener('click', fetchFromLinear);
    dom.linearImportBack.addEventListener('click', showLinearImportStage1);
    dom.linearImportConfirmBtn.addEventListener('click', confirmLinearImport);
    dom.linearImportMappingMode.addEventListener('change', (e) => {
        if (e.target.name === 'linearMappingMode') handleLinearMappingModeChange(e.target.value);
    });

    // Linear CSV Import
    dom.importLinearCsvBtn.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showLinearCsvImportModal();
    });
    dom.linearCsvDropzone.addEventListener('click', () => dom.linearCsvFileInput.click());
    dom.linearCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.linearCsvDropzone.classList.add('dragover');
    });
    dom.linearCsvDropzone.addEventListener('dragleave', () => {
        dom.linearCsvDropzone.classList.remove('dragover');
    });
    dom.linearCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.linearCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            dom.linearCsvDropzone.querySelector('span').textContent = file.name;
            dom.linearCsvImportParseBtn.disabled = false;
            dom.linearCsvFileInput._droppedFile = file;
        }
    });
    dom.linearCsvFileInput.addEventListener('change', () => {
        const file = dom.linearCsvFileInput.files[0];
        if (file) {
            dom.linearCsvDropzone.querySelector('span').textContent = file.name;
            dom.linearCsvImportParseBtn.disabled = false;
            dom.linearCsvFileInput._droppedFile = null;
        }
    });
    dom.linearCsvImportParseBtn.addEventListener('click', () => {
        const file = dom.linearCsvFileInput._droppedFile || dom.linearCsvFileInput.files[0];
        handleLinearCsvFile(file);
    });
    dom.linearCsvImportCancel.addEventListener('click', confirmCloseLinearImportModal);

    // Jira Export Modal
    dom.exportJiraBtn.addEventListener('click', () => {
        closeMainMenu();
        showJiraExportModal();
    });
    dom.jiraExportModalClose.addEventListener('click', confirmCloseJiraExportModal);
    dom.jiraExportModal.addEventListener('click', (e) => {
        if (e.target === dom.jiraExportModal) confirmCloseJiraExportModal();
    });
    dom.jiraExportCancel.addEventListener('click', confirmCloseJiraExportModal);
    dom.jiraExportDownload.addEventListener('click', () => {
        downloadJiraCsv();
    });
    [dom.jiraStatusNone, dom.jiraStatusPlanned, dom.jiraStatusInProgress, dom.jiraStatusDone].forEach(input => {
        input.addEventListener('input', populateJiraExportEpics);
    });
    const statusFilters = [
        { el: dom.jiraFilterNone, status: 'none' },
        { el: dom.jiraFilterPlanned, status: 'planned' },
        { el: dom.jiraFilterInProgress, status: 'in-progress' },
        { el: dom.jiraFilterDone, status: 'done' }
    ];
    statusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                jiraExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                jiraExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateJiraExportEpics();
        });
    });

    // Phabricator Export Modal
    dom.exportPhabBtn.addEventListener('click', () => {
        if (dom.exportPhabBtn.disabled) return;
        closeMainMenu();
        showPhabExportModal();
    });
    dom.phabExportModalClose.addEventListener('click', confirmClosePhabModal);
    dom.phabExportModal.addEventListener('click', (e) => {
        if (e.target === dom.phabExportModal) confirmClosePhabModal();
    });
    dom.phabExportCancel.addEventListener('click', confirmClosePhabModal);
    dom.phabExportNext.addEventListener('click', showPhabStage2);
    dom.phabExportBack.addEventListener('click', showPhabStage1);
    dom.phabExportDone.addEventListener('click', hidePhabExportModal);
    dom.phabCopyFunction.addEventListener('click', () => {
        copyPhabCode(dom.phabImportFunction, dom.phabCopyFunction);
    });
    dom.phabCopyCall.addEventListener('click', () => {
        copyPhabCode(dom.phabImportCall, dom.phabCopyCall);
    });
    document.getElementById('phabTokenHelpLink')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await showAlert('To get your API token:\n\n1. Click your profile picture in Phabricator\n2. Go to Settings\n3. Click "Conduit API Tokens"\n4. Click "Generate Token"');
    });
    dom.phabInstanceUrl.addEventListener('input', () => {
        dom.phabImportFunction.textContent = generatePhabImportFunction();
    });
    dom.phabApiToken.addEventListener('input', () => {
        dom.phabImportCall.textContent = generatePhabImportCall();
    });
    dom.phabTags.addEventListener('input', () => {
        dom.phabImportCall.textContent = generatePhabImportCall();
    });
    const phabStatusFilters = [
        { el: dom.phabFilterNone, status: 'none' },
        { el: dom.phabFilterPlanned, status: 'planned' },
        { el: dom.phabFilterInProgress, status: 'in-progress' },
        { el: dom.phabFilterDone, status: 'done' }
    ];
    phabStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                phabExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                phabExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populatePhabExportEpics();
        });
    });

    // Asana CSV Export Modal
    dom.exportAsanaCsvBtn.addEventListener('click', () => {
        if (dom.exportAsanaCsvBtn.disabled) return;
        closeMainMenu();
        showAsanaCsvExportModal();
    });
    dom.asanaCsvExportModalClose.addEventListener('click', confirmCloseAsanaCsvModal);
    dom.asanaCsvExportModal.addEventListener('click', (e) => {
        if (e.target === dom.asanaCsvExportModal) confirmCloseAsanaCsvModal();
    });
    dom.asanaCsvExportCancel.addEventListener('click', confirmCloseAsanaCsvModal);
    dom.asanaCsvExportDownload.addEventListener('click', downloadAsanaCsv);
    const asanaCsvStatusFilters = [
        { el: dom.asanaCsvFilterNone, status: 'none' },
        { el: dom.asanaCsvFilterPlanned, status: 'planned' },
        { el: dom.asanaCsvFilterInProgress, status: 'in-progress' },
        { el: dom.asanaCsvFilterDone, status: 'done' }
    ];
    asanaCsvStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                asanaCsvExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                asanaCsvExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateAsanaCsvExportEpics();
        });
    });

    // Jira Proxy Export Modal
    dom.exportJiraProxyBtn.addEventListener('click', () => {
        if (dom.exportJiraProxyBtn.disabled) return;
        closeMainMenu();
        showJiraProxyExportModal();
    });
    dom.jiraProxyExportModalClose.addEventListener('click', confirmCloseJiraProxyModal);
    dom.jiraProxyExportModal.addEventListener('click', (e) => {
        if (e.target === dom.jiraProxyExportModal) confirmCloseJiraProxyModal();
    });
    dom.jiraProxyExportCancel.addEventListener('click', confirmCloseJiraProxyModal);
    dom.jiraProxyExportNext.addEventListener('click', showJiraProxyStage2);
    dom.jiraProxyExportBack.addEventListener('click', showJiraProxyStage1);
    dom.jiraProxyExportRun.addEventListener('click', exportToJiraProxy);
    dom.jiraProxyVerifyBtn.addEventListener('click', verifyJiraProxy);
    const jiraProxyStatusFilters = [
        { el: dom.jiraProxyFilterNone, status: 'none' },
        { el: dom.jiraProxyFilterPlanned, status: 'planned' },
        { el: dom.jiraProxyFilterInProgress, status: 'in-progress' },
        { el: dom.jiraProxyFilterDone, status: 'done' }
    ];
    jiraProxyStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                jiraProxyExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                jiraProxyExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateJiraProxyExportEpics();
        });
    });

    // Phabricator Proxy Export Modal
    dom.exportPhabProxyBtn.addEventListener('click', () => {
        if (dom.exportPhabProxyBtn.disabled) return;
        closeMainMenu();
        showPhabProxyExportModal();
    });
    dom.phabProxyExportModalClose.addEventListener('click', confirmClosePhabProxyModal);
    dom.phabProxyExportModal.addEventListener('click', (e) => {
        if (e.target === dom.phabProxyExportModal) confirmClosePhabProxyModal();
    });
    dom.phabProxyExportCancel.addEventListener('click', confirmClosePhabProxyModal);
    dom.phabProxyExportNext.addEventListener('click', showPhabProxyStage2);
    dom.phabProxyExportBack.addEventListener('click', showPhabProxyStage1);
    dom.phabProxyExportRun.addEventListener('click', exportToPhabProxy);
    dom.phabProxyVerifyBtn.addEventListener('click', verifyPhabProxy);
    document.getElementById('phabProxyTokenHelpLink')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await showAlert('To get your API token:\n\n1. Click your profile picture in Phabricator\n2. Go to Settings\n3. Click "Conduit API Tokens"\n4. Click "Generate Token"');
    });
    const phabProxyStatusFilters = [
        { el: dom.phabProxyFilterNone, status: 'none' },
        { el: dom.phabProxyFilterPlanned, status: 'planned' },
        { el: dom.phabProxyFilterInProgress, status: 'in-progress' },
        { el: dom.phabProxyFilterDone, status: 'done' }
    ];
    phabProxyStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                phabProxyExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                phabProxyExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populatePhabProxyExportEpics();
        });
    });

    // Asana Proxy Export Modal
    dom.exportAsanaProxyBtn.addEventListener('click', () => {
        if (dom.exportAsanaProxyBtn.disabled) return;
        closeMainMenu();
        showAsanaProxyExportModal();
    });
    dom.asanaProxyExportModalClose.addEventListener('click', confirmCloseAsanaProxyModal);
    dom.asanaProxyExportModal.addEventListener('click', (e) => {
        if (e.target === dom.asanaProxyExportModal) confirmCloseAsanaProxyModal();
    });
    dom.asanaProxyExportCancel.addEventListener('click', confirmCloseAsanaProxyModal);
    dom.asanaProxyExportNext.addEventListener('click', showAsanaProxyStage2);
    dom.asanaProxyExportBack.addEventListener('click', showAsanaProxyStage1);
    dom.asanaProxyExportRun.addEventListener('click', exportToAsanaProxy);
    dom.asanaProxyVerifyBtn.addEventListener('click', verifyAsanaProxy);
    const asanaProxyStatusFilters = [
        { el: dom.asanaProxyFilterNone, status: 'none' },
        { el: dom.asanaProxyFilterPlanned, status: 'planned' },
        { el: dom.asanaProxyFilterInProgress, status: 'in-progress' },
        { el: dom.asanaProxyFilterDone, status: 'done' }
    ];
    asanaProxyStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                asanaProxyExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                asanaProxyExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateAsanaProxyExportEpics();
        });
    });

    // Linear Proxy Export Modal
    dom.exportLinearProxyBtn.addEventListener('click', () => {
        if (dom.exportLinearProxyBtn.disabled) return;
        closeMainMenu();
        showLinearProxyExportModal();
    });
    dom.linearProxyExportModalClose.addEventListener('click', confirmCloseLinearProxyModal);
    dom.linearProxyExportModal.addEventListener('click', (e) => {
        if (e.target === dom.linearProxyExportModal) confirmCloseLinearProxyModal();
    });
    dom.linearProxyExportCancel.addEventListener('click', confirmCloseLinearProxyModal);
    dom.linearProxyExportNext.addEventListener('click', showLinearProxyStage2);
    dom.linearProxyExportBack.addEventListener('click', showLinearProxyStage1);
    dom.linearProxyExportRun.addEventListener('click', exportToLinearProxy);
    dom.linearProxyVerifyBtn.addEventListener('click', verifyLinearProxy);
    const linearProxyStatusFilters = [
        { el: dom.linearProxyFilterNone, status: 'none' },
        { el: dom.linearProxyFilterPlanned, status: 'planned' },
        { el: dom.linearProxyFilterInProgress, status: 'in-progress' },
        { el: dom.linearProxyFilterDone, status: 'done' }
    ];
    linearProxyStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                linearProxyExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                linearProxyExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateLinearProxyExportEpics();
        });
    });

    // Share dropdown
    dom.shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMainMenu();
        const onMap = !dom.welcomeScreen.classList.contains('visible');
        dom.shareScreenshot.disabled = !onMap;
        dom.shareDownload.disabled = !onMap;
        dom.shareMenu.classList.toggle('visible');
    });
    dom.shareCopyLink.addEventListener('click', async (e) => {
        e.stopPropagation();
        dom.shareMenu.classList.remove('visible');
        // The whole map, even if it was opened from a slice link
        const url = window.location.href.split('#')[0];
        try {
            await navigator.clipboard.writeText(url);
            dom.shareBtn.querySelector('.btn-label').textContent = ' Copied!';
            setTimeout(() => dom.shareBtn.querySelector('.btn-label').textContent = ' Share', 2000);
        } catch {
            await showPrompt('Copy this link to share:', url);
        }
    });
    const captureMap = async () => {
        const dpr = Math.max(window.devicePixelRatio || 2, 2);
        const isDark = document.documentElement.classList.contains('dark-mode');
        const bgColor = isDark ? '#0f172a' : '#f8fafc';

        const mapEl = dom.storyMap;

        let mapCanvas;
        if (isSafari) {
            // Safari: use html-to-image (SVG foreignObject) — html2canvas hangs on SVG rendering
            if (!window._htmlToImage) {
                const mod = await import('/vendor/html-to-image.bundle.js');
                window._htmlToImage = mod;
            }
            mapCanvas = await window._htmlToImage.toCanvas(mapEl, {
                backgroundColor: bgColor,
                pixelRatio: dpr,
                skipFonts: true,
                style: {
                    transform: 'none',
                    margin: '0',
                    minWidth: '0',
                    padding: '24px',
                },
            });
        } else {
            // Chrome/Firefox: use html2canvas (foreignObject has rendering issues in Firefox)
            if (!window._html2canvas) {
                const mod = await import('/vendor/html2canvas.bundle.js');
                window._html2canvas = mod.default;
            }
            mapCanvas = await window._html2canvas(mapEl, {
                backgroundColor: bgColor,
                scale: dpr,
                useCORS: true,
                onclone: (clonedDoc) => {
                    const clonedMap = clonedDoc.getElementById('storyMap');
                    Object.assign(clonedMap.style, {
                        transform: 'none',
                        margin: '0',
                        minWidth: '0',
                        padding: '24px',
                    });
                    clonedMap.style.setProperty('--card-width', '180px');

                    // Ensure story columns have explicit width
                    for (const col of clonedDoc.querySelectorAll('.story-column')) {
                        col.style.width = '180px';
                    }

                    // Ensure story cards don't clip text
                    for (const card of clonedDoc.querySelectorAll('.story-card')) {
                        card.style.overflow = 'visible';
                    }

                    // Convert textareas to divs and ensure they can display full text
                    for (const ta of clonedDoc.querySelectorAll('.story-text')) {
                        const div = clonedDoc.createElement('div');
                        div.textContent = ta.value;
                        div.style.cssText = `
                            width: 100%;
                            font-family: inherit;
                            font-size: 13px;
                            font-weight: 500;
                            color: #1a1a1a;
                            text-align: center;
                            line-height: 1.4;
                            white-space: pre-wrap !important;
                            word-break: break-word !important;
                            border: none;
                            padding: 0;
                            margin: 0;
                            background: transparent;
                        `;
                        ta.replaceWith(div);
                    }
                },
            });
        }

        // Draw logo with canvas API (avoids html2canvas SVG issues in Safari)
        const logoPad = 24 * dpr;
        const logoGap = 60 * dpr;
        const iconSize = 28 * dpr;
        const logoTextSize = 20 * dpr;
        const logoFont = `700 ${logoTextSize}px system-ui, -apple-system, sans-serif`;
        const textColor = isDark ? '#e2e8f0' : '#333';

        // Measure logo text width
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        measureCtx.font = logoFont;
        const logoTextW = measureCtx.measureText('Storymaps.io').width;
        const logoGapInner = 10 * dpr; // gap between icon and text
        const logoW = iconSize + logoGapInner + logoTextW;
        const logoH = Math.max(iconSize, logoTextSize);

        // Composite: logo on top, then map below with spacing
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = Math.max(mapCanvas.width, logoW + logoPad * 2);
        finalCanvas.height = mapCanvas.height + logoH + logoPad + logoGap;
        const ctx = finalCanvas.getContext('2d');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // Draw 4-square SVG icon with canvas
        const ix = logoPad, iy = logoPad;
        const rectSize = iconSize * 7 / 24; // 7/24 of icon size (matches viewBox)
        const rr = iconSize * 1 / 24; // corner radius
        const squares = [
            { x: iconSize * 3 / 24, y: iconSize * 3 / 24, fill: '#fef08a', stroke: '#d4aa00' },
            { x: iconSize * 14 / 24, y: iconSize * 3 / 24, fill: '#fecdd3', stroke: '#e88a9a' },
            { x: iconSize * 3 / 24, y: iconSize * 14 / 24, fill: '#a5f3fc', stroke: '#67c5d6' },
            { x: iconSize * 14 / 24, y: iconSize * 14 / 24, fill: '#14b8a6', stroke: '#0d9488' },
        ];
        for (const sq of squares) {
            const sx = ix + sq.x, sy = iy + sq.y;
            ctx.beginPath();
            ctx.roundRect(sx, sy, rectSize, rectSize, rr);
            ctx.fillStyle = sq.fill;
            ctx.fill();
            ctx.strokeStyle = sq.stroke;
            ctx.lineWidth = dpr;
            ctx.stroke();
        }

        // Draw "Storymaps.io" text
        ctx.font = logoFont;
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.fillText('Storymaps.io', ix + iconSize + logoGapInner, iy + iconSize / 2);
        ctx.textBaseline = 'alphabetic';

        ctx.drawImage(mapCanvas, 0, logoH + logoPad + logoGap);

        // Draw legend in bottom-right corner
        if (state.legend?.length) {
            const s = dpr; // scale factor
            const font = `${13 * s}px system-ui, -apple-system, sans-serif`;
            const titleFont = `600 ${12 * s}px system-ui, -apple-system, sans-serif`;
            const swatchSize = 22 * s;
            const rowH = 28 * s;
            const pad = 14 * s;
            const gap = 6 * s;

            // Measure text widths
            ctx.font = font;
            const maxLabelW = Math.max(...state.legend.map(e => ctx.measureText(e.label).width));
            const boxW = pad + swatchSize + gap + maxLabelW + pad;
            const titleH = 18 * s;
            const boxH = pad + titleH + state.legend.length * rowH + pad;

            const bx = finalCanvas.width - boxW - logoPad;
            const by = finalCanvas.height - boxH - logoPad;

            // Background with rounded corners
            const r = 8 * s;
            ctx.beginPath();
            ctx.moveTo(bx + r, by);
            ctx.lineTo(bx + boxW - r, by);
            ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
            ctx.lineTo(bx + boxW, by + boxH - r);
            ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
            ctx.lineTo(bx + r, by + boxH);
            ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
            ctx.lineTo(bx, by + r);
            ctx.quadraticCurveTo(bx, by, bx + r, by);
            ctx.closePath();
            ctx.fillStyle = isDark ? '#1e293b' : 'white';
            ctx.fill();
            ctx.strokeStyle = isDark ? '#334155' : '#e2e2e2';
            ctx.lineWidth = 1 * s;
            ctx.stroke();

            // Title
            ctx.font = titleFont;
            ctx.fillStyle = isDark ? '#94a3b8' : '#666';
            ctx.fillText('Legend', bx + pad, by + pad + 12 * s);

            // Entries
            state.legend.forEach((entry, i) => {
                const ry = by + pad + titleH + i * rowH;
                // Swatch
                const sr = 4 * s;
                const sx = bx + pad;
                const sy = ry + (rowH - swatchSize) / 2;
                ctx.beginPath();
                ctx.moveTo(sx + sr, sy);
                ctx.lineTo(sx + swatchSize - sr, sy);
                ctx.quadraticCurveTo(sx + swatchSize, sy, sx + swatchSize, sy + sr);
                ctx.lineTo(sx + swatchSize, sy + swatchSize - sr);
                ctx.quadraticCurveTo(sx + swatchSize, sy + swatchSize, sx + swatchSize - sr, sy + swatchSize);
                ctx.lineTo(sx + sr, sy + swatchSize);
                ctx.quadraticCurveTo(sx, sy + swatchSize, sx, sy + swatchSize - sr);
                ctx.lineTo(sx, sy + sr);
                ctx.quadraticCurveTo(sx, sy, sx + sr, sy);
                ctx.closePath();
                ctx.fillStyle = entry.color;
                ctx.fill();
                // Label
                ctx.font = font;
                ctx.fillStyle = isDark ? '#e2e8f0' : '#333';
                ctx.fillText(entry.label, bx + pad + swatchSize + gap, ry + rowH / 2 + 5 * s);
            });
        }

        return finalCanvas;
    };
    dom.shareScreenshot.addEventListener('click', async (e) => {
        e.stopPropagation();
        dom.shareMenu.classList.remove('visible');
        dom.shareBtn.querySelector('.btn-label').textContent = ' Capturing...';
        try {
            // Safari requires ClipboardItem to receive a Promise<Blob>, and clipboard.write()
            // must be called synchronously within the user gesture (click handler)
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': captureMap().then(c => new Promise(r => c.toBlob(r, 'image/png')))
                })
            ]);
            dom.shareBtn.querySelector('.btn-label').textContent = ' Copied!';
            setTimeout(() => dom.shareBtn.querySelector('.btn-label').textContent = ' Share', 2000);
        } catch (err) {
            await showAlert('Screenshot failed: ' + (err?.message || 'could not render the map as an image'));
            dom.shareBtn.querySelector('.btn-label').textContent = ' Share';
        }
    });
    dom.shareDownload.addEventListener('click', async (e) => {
        e.stopPropagation();
        dom.shareMenu.classList.remove('visible');
        dom.shareBtn.querySelector('.btn-label').textContent = ' Capturing...';
        try {
            const canvas = await captureMap();
            const dataUrl = canvas.toDataURL('image/png');
            const link = el('a', null, {
                href: dataUrl,
                download: sanitizeFilename(state.name || 'story-map') + '-' + formatTimestamp() + '.png'
            });
            link.click();
            dom.shareBtn.querySelector('.btn-label').textContent = ' Share';
        } catch (err) {
            await showAlert('Screenshot failed: ' + (err?.message || 'could not render the map as an image'));
            dom.shareBtn.querySelector('.btn-label').textContent = ' Share';
        }
    });

    // Undo/Redo buttons
    dom.undoBtn.addEventListener('click', () => { undo(); });
    dom.redoBtn.addEventListener('click', () => { redo(); });

    // Panel tab controls
    dom.legendToggle?.addEventListener('click', () => switchPanelTab('legend'));
    dom.partialsToggle?.addEventListener('click', () => switchPanelTab('partials'));
    dom.notesToggle?.addEventListener('click', () => switchPanelTab('notepad'));
    dom.logToggle?.addEventListener('click', () => switchPanelTab('log'));
    dom.legendAddBtn?.addEventListener('click', () => {
        if (state.legend.length >= Object.keys(CARD_COLORS).length) return;
        pushUndo();
        state.legend.push({
            id: generateId(),
            color: CARD_COLORS.yellow,
            label: ''
        });
        log.logEvent('Added legend entry');
        renderAndSave();
        const inputs = dom.legendEntries.querySelectorAll('.legend-label');
        if (inputs.length) inputs[inputs.length - 1].focus();
    });

    search.initListeners();

    // Zoom controls
    dom.zoomIn.addEventListener('click', navigation.zoomIn);
    dom.zoomOut.addEventListener('click', navigation.zoomOut);
    dom.zoomReset.addEventListener('click', navigation.zoomCycle);

    // Main menu dropdown
    dom.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.shareMenu.classList.remove('visible');
        dom.mainMenu.classList.toggle('visible');
        document.body.classList.toggle('main-menu-open', dom.mainMenu.classList.contains('visible'));
        const onMap = !dom.welcomeScreen.classList.contains('visible');
        dom.copyExistingBtn.disabled = !onMap;
        dom.exportSubmenuTrigger.disabled = !onMap;
        dom.printBtn.disabled = !onMap;
        dom.backupsBtn.disabled = !onMap;
    });

    // Submenu collapse helper
    const collapseSubmenus = (...except) => {
        const all = [
            [dom.samplesSubmenuTrigger, dom.samplesSubmenu],
            [dom.importSubmenuTrigger, dom.importSubmenu],
            [dom.exportSubmenuTrigger, dom.exportSubmenu],
        ];
        all.forEach(([trigger, menu]) => {
            if (except.includes(trigger)) return;
            trigger.classList.remove('expanded');
            menu.classList.remove('visible');
            menu.querySelectorAll('.integration-icon').forEach(i => i.classList.remove('active'));
            menu.querySelectorAll('.integration-options').forEach(o => o.classList.remove('visible'));
        });
    };

    // Samples submenu toggle
    dom.samplesSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSubmenus(dom.samplesSubmenuTrigger);
        dom.samplesSubmenuTrigger.classList.toggle('expanded');
        dom.samplesSubmenu.classList.toggle('visible');
    });

    // Import submenu toggle
    dom.importSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSubmenus(dom.importSubmenuTrigger);
        dom.importSubmenuTrigger.classList.toggle('expanded');
        dom.importSubmenu.classList.toggle('visible');
    });

    // Export submenu toggle
    dom.exportSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSubmenus(dom.exportSubmenuTrigger);
        dom.exportSubmenuTrigger.classList.toggle('expanded');
        dom.exportSubmenu.classList.toggle('visible');
    });

    // Integration icon toggle
    document.querySelectorAll('.integration-icon[data-integration]').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const integration = icon.dataset.integration;
            const container = icon.closest('.dropdown-submenu-content');
            const wasActive = icon.classList.contains('active');
            container.querySelectorAll('.integration-icon').forEach(i => i.classList.remove('active'));
            container.querySelectorAll('.integration-options').forEach(o => o.classList.remove('visible'));
            if (!wasActive) {
                icon.classList.add('active');
                container.querySelector(`.integration-options[data-for="${integration}"]`)?.classList.add('visible');
            }
        });
    });

    // Handle clicks on sample items in main menu
    dom.mainMenu.addEventListener('click', async (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item?.dataset.sample) {
            if (lockState.isLocked && !lockState.sessionUnlocked) {
                await showAlert('This map is read-only. Unlock it first to load a sample.');
                closeMainMenu();
                return;
            }
            loadSample(item.dataset.sample);
            closeMainMenu();
        }
    });

    document.addEventListener('click', () => {
        closeMainMenu();
        closeAllOptionsMenus();
        dom.shareMenu.classList.remove('visible');
        closeFilterPanel();
    });

    document.addEventListener('keydown', (e) => {
        // The expanded card has its own buttons and fields, so map shortcuts (undo, delete
        // selection, pan) would act on the map behind it. Only Escape, to close it, gets through.
        if (dom.cardExpandModal.classList.contains('visible') && e.key !== 'Escape') return;

        const isTextInput = e.target.matches('input, textarea') || e.target.closest('.cm-editor');

        const isEmptyTextInput = isTextInput && e.target.matches('input, textarea') && !e.target.value;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && (!isTextInput || isEmptyTextInput)) {
            e.preventDefault();
            undo();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && (!isTextInput || isEmptyTextInput)) {
            e.preventDefault();
            redo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isTextInput && selection.columnIds.length > 0) {
            e.preventDefault();
            duplicateColumns();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput && selection.columnIds.length > 0) {
            e.preventDefault();
            const hasStorySelection = selection.clickedCards.some(c => c.type === 'story');
            if (hasStorySelection) {
                deleteSelectedCards();
            } else {
                deleteSelectedColumns();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            openSearch();
        }
        if (e.key === 'Escape' && fullscreenMode) {
            const now = Date.now();
            if (now - lastFullscreenEsc < 500) {
                exitFullscreenMode();
                lastFullscreenEsc = 0;
                return;
            }
            lastFullscreenEsc = now;
        }
        if (e.key === 'Escape') {
            const hadOpenUI =
                dom.cardExpandModal.classList.contains('visible') ||
                !dom.filterPanel.classList.contains('hidden') ||
                !dom.searchBar.classList.contains('hidden') ||
                selection.columnIds.length > 0 ||
                dom.mainMenu.classList.contains('visible') ||
                dom.shareMenu.classList.contains('visible') ||
                dom.importModal.classList.contains('visible') ||
                dom.exportModal.classList.contains('visible') ||
                dom.backupsModal?.classList.contains('visible') ||
                dom.buildAiModal.classList.contains('visible');
            if (dom.buildAiModal.classList.contains('visible')) {
                build.confirmClose();
                return;
            }
            if (dom.cardExpandModal.classList.contains('visible')) {
                closeExpandModal();
                return;
            }
            if (!dom.filterPanel.classList.contains('hidden')) {
                closeFilterPanel();
            } else if (!dom.searchBar.classList.contains('hidden')) {
                closeSearch();
            } else if (selection.columnIds.length > 0) {
                clearSelection();
                updateSelectionUI();
            }
            closeMainMenu();
            closeAllOptionsMenus();
            dom.shareMenu.classList.remove('visible');
            hideImportModal();
            hideExportModal();
            hideJiraExportModal();
            hideJiraApiExportModal();
            hidePhabExportModal();
            hideAsanaExportModal();
            hideAsanaCsvExportModal();
            if (fullscreenMode && !hadOpenUI) {
                showToast('Press Esc again to exit full screen mode', 1500);
            }
        }
        if (!isTextInput && ((e.altKey && e.key === 'r') || (e.shiftKey && e.code === 'Digit0'))) {
            e.preventDefault();
            zoomToFit();
        }
        if (!isTextInput && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            const PAN_AMOUNT = 100;
            const wrapper = dom.storyMapWrapper;
            switch (e.key) {
                case 'ArrowLeft':
                    wrapper.scrollBy({ left: -PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowRight':
                    wrapper.scrollBy({ left: PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowUp':
                    wrapper.scrollBy({ top: -PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowDown':
                    wrapper.scrollBy({ top: PAN_AMOUNT, behavior: 'smooth' });
                    break;
            }
            e.preventDefault();
        }
    });

    // Pan/drag navigation (right-click to pan, Miro-style)
    navigation.initPan();

    // Marquee (rectangle) selection
    navigation.initMarquee();

    // Ctrl+scroll wheel zoom
    navigation.initWheelZoom();

    // Pinch-to-zoom on touch devices
    navigation.initPinchZoom();

    // Lock feature event listeners
    initLockListeners();

    // Auto-fit map on window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(navigation.resizeToFit, 200);
    });
};

// Unified panel tab switching
const switchPanelTab = (sectionKey) => {
    const sections = dom.panelBody?.querySelectorAll('.panel-section');
    const tabs = document.querySelectorAll('.panel-tab');
    const activeSection = dom.panelBody?.querySelector(`.panel-section[data-section="${sectionKey}"]`);
    const activeTab = document.querySelector(`.panel-tab[data-section="${sectionKey}"]`);

    if (!activeSection || !activeTab || activeTab.disabled) return;

    const isAlreadyOpen = activeSection.classList.contains('open');

    // Close all sections and deactivate all tabs
    sections?.forEach(s => s.classList.remove('open'));
    tabs.forEach(t => t.classList.remove('active'));

    if (isAlreadyOpen) {
        // Close the panel entirely
        dom.controlsRight?.classList.remove('panel-open');
    } else {
        // Open the requested section
        activeSection.classList.add('open');
        activeTab.classList.add('active');
        dom.controlsRight?.classList.add('panel-open');
        if (sectionKey === 'notepad') notepad.ensureEditor();
    }
};

// =============================================================================
// Module Wiring
// =============================================================================

// Wire state module (needs serialize/deserialize + renderAndSave)
stateInit({ serialize, deserialize, renderAndSave, logEvent: (text, ids) => log.logEvent(text, ids) });

// Wire navigation module
navigation.init({ state, updateSelectionUI, selection, clearSelection, isMapEditable, addColumnAt, deleteColumn, duplicateColumns, duplicateCards, deleteSelectedColumns, deleteSelectedCards, insertPartialMapRef: (...args) => insertPartialMapRef(...args), getSliceActions: (...args) => ui.getSliceActions(...args) });

// Wire presence module
presence.init({
    getProvider,
    getYdoc,
    getZoomLevel: () => navigation.zoomLevel,
    getState: () => state,
});

// Wire lock module
lock.init({
    state,
    getProvider,
    getYdoc,
    getCursorColor,
    render,
    notepadUpdate: () => notepad.update(),
    saveToStorage,
    closeMainMenu,
    initSortable,
    renderLegend,
    logEvent: (text, ids) => log.logEvent(text, ids),
});

// Wire yjs module
yjs.init({
    state,
    notepad,
    log,
    isMapEditable,
    render,
    setPreserveToolbar,
});

// Wire tour module
tour.init({
    addSlice,
    deleteSlice,
    getState: () => state,
    renderAndSave,
    createStory,
    zoomToFit,
});

// Wire card-expand module
cardExpand.init({ renderAndSave, saveToStorage });

// Wire slice links module
sliceLinks.init({
    state,
    pushUndo,
    saveToStorage,
    logEvent: (text, ids) => log.logEvent(text, ids),
});

// Wire build-with-AI module
build.init({ state, showPrompt });

// Wire backups module
backups.init({
    renderAndSave,
    saveToStorage,
    startWithSample: (...args) => startWithSample(...args),
});

// Wire io module
io.init({
    renderAndSave,
    saveToStorage,
    subscribeToMap,
    newMapId,
    createYjsDoc,
    hideWelcomeScreen: () => hideWelcomeScreen(),
});

// Wire welcome module
welcome.init({
    render,
    renderAndSave,
    saveToStorage,
    subscribeToMap,
    newMapId,
    createYjsDoc,
    switchPanelTab,
});

// Wire partials module
partials.init({ renderAndSave, switchPanelTab });

const { materializePhantomColumn, createPartialMap, startEditingPartial, stopEditingPartial, deletePartialMap, restorePartialMap, replaceWithPartial, insertPartialMapRef } = partials;

// Wire ui module
ui.init({
    state,
    isMapEditable,
    pushUndo,
    addStory: (columnId, sliceId, rowType) => {
        if (rowType) return addStory(columnId, sliceId, rowType);
        const story = addStory(columnId, sliceId, null, { skipFocus: true });
        if (story) openExpandModal(story);
        return story;
    },
    deleteColumn,
    deleteStory,
    deleteSlice,
    saveToStorage,
    renderAndSave,
    scrollElementIntoView,
    addColumn,
    addSlice,
    materializePhantomColumn,
    handleColumnSelection,
    startEditingPartial,
    stopEditingPartial,
    deletePartialMap,
    restorePartialMap,
    openExpandModal,
    logEvent: (text, ids) => log.logEvent(text, ids),
    logTextEdit: (label, id) => log.logTextEdit(label, id),
    refilterCard: (card, item) => {
        const q = dom.searchInput.value.trim().toLowerCase();
        if (!q && !hasActiveFilters()) return;
        const text = (card.querySelector('.step-text, .story-text')?.value
            || card.querySelector('.story-text-preview')?.textContent || '').toLowerCase();
        const textMatch = !q || text.includes(q);
        const filterMatch = itemMatchesFilters(item);
        card.classList.toggle('search-dimmed', !textMatch || !filterMatch);
    },
    initSortable,
});

// Wire render module
renderMod.init({
    state,
    isMapEditable,
    pushUndo,
    saveToStorage,
    renderAndSave,
    ensureSortable,
    scrollElementIntoView,
    notepadUpdate: () => notepad.update(),
    getIsSafari: () => isSafari,
    getZoomLevel: () => navigation.zoomLevel,
    broadcastDragStart,
    broadcastDragEnd,
    getIsPinching: () => navigation.isPinching,
    createPartialMap,
    deletePartialMap,
    replaceWithPartial,
    logEvent: (text, ids) => log.logEvent(text, ids),
    logTextEdit: (label, id) => log.logTextEdit(label, id),
});

// =============================================================================
// Initialize
// =============================================================================

// Whether the server already knows this map. Ask before connecting: the sync server creates an empty
// document for any ID and records the map as soon as the socket connects. null = couldn't tell (offline).
const mapKnownToServer = async (mapId) => {
    try {
        const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}/meta`, { cache: 'no-store' });
        if (res.status === 404) return false;
        return res.ok ? true : null;
    } catch {
        return null;
    }
};

const loadMapById = async (mapId) => {
    destroyYjs();

    if (mapId) {
        state.mapId = mapId;
        const known = await mapKnownToServer(mapId);
        await createYjsDoc(mapId);
        await subscribeToMap(mapId);

        // Data arrived via Yjs sync
        if (state.columns.length > 0) {
            return true;
        }

        // A map that isn't open anywhere is read from disk after the socket syncs, so its content can
        // arrive a moment later. A map the server knows opens even without steps, so its notes,
        // backups and legend stay reachable; give it longer to arrive.
        const ymap = getYmap();
        if (ymap) {
            if (known && ymap.size > 0) {
                syncFromYjs();
                render();
                return true;
            }
            const hasData = await new Promise(resolve => {
                let resolved = false;
                const done = (result) => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    ymap.unobserveDeep(check);
                    resolve(result);
                };
                const timeout = setTimeout(() => done(false), known ? 5000 : 500);
                const check = () => {
                    syncFromYjs();
                    if (state.columns.length > 0 || (known && ymap.size > 0)) {
                        render();
                        done(true);
                    }
                };
                ymap.observeDeep(check);
            });
            if (hasData || known) return true;
        }

        // Fallback: load from localStorage if Yjs sync failed (only when the server couldn't say
        // whether the map exists; otherwise a stale or empty local copy could overwrite it)
        // Only skip if a *different* mapId is stored (null = no tracking yet, allow it)
        const storedMapId = localStorage.getItem(STORAGE_KEY + ':mapId');
        if (known === null && (!storedMapId || storedMapId === mapId) && loadFromStorage()) {
            dom.boardName.value = state.name;
            render();
            saveToStorage();
            return true;
        }
    }
    return false;
};

const init = async () => {
    const path = window.location.pathname;
    const sampleMatch = path.match(/^\/sample\/([a-z0-9-]+)$/);
    const mapId = sampleMatch ? null : (path.slice(1) || null);

    initEventListeners();
    notepad.init({ state, saveToStorage, isMapEditable, logTextEdit: (label, id) => log.logTextEdit(label, id) });
    log.init();
    updateCursorsVisibilityUI();

    // Populate browser-specific DevTools instructions
    const devtoolsHint = isSafari
        ? 'first enable via Safari &gt; Settings &gt; Advanced &gt; <em>Show features for web developers</em>, then press <strong>Cmd+Option+I</strong>'
        : /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
            ? 'press <strong>Cmd+Option+I</strong>'
            : 'press <strong>F12</strong>';
    document.querySelectorAll('.devtools-instructions').forEach(el => {
        el.innerHTML = devtoolsHint;
    });

    if (sampleMatch) {
        await startWithSample(sampleMatch[1]);
    } else if (mapId === 'new') {
        await startNewMap();
    } else if (mapId === 'tour') {
        await startWithSample('story-mapping-101', { showToast: false });
        dom.controlsRight?.classList.remove('panel-open');
        dom.panelBody?.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tour.startTour();
    } else if (mapId) {
        loadYjs(); // Start downloading Yjs modules in parallel with DOM setup
        showLoading();
        const loaded = await loadMapById(mapId);
        hideLoading();
        if (loaded) {
            hideWelcomeScreen();
            requestAnimationFrame(() => {
                zoomToFit();
                sliceLinks.revealSliceFromHash(350);
            });
            setTimeout(showTutorialToast, 800);
        } else {
            leaveMapForWelcome();
        }
    } else {
        showWelcomeScreen();
    }
};

init();
