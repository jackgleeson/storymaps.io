// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Orchestrator — imports all modules, wires init(), owns dom + persistence + event listeners

import * as notepad from '/src/features/notepad.js';
import * as connectionStatus from '/src/features/connection-status.js';
import * as log from '/src/core/log.js';
import { generateId, el, CARD_COLORS, isMapId } from '/src/core/constants.js';
import { state, init as stateInit, initState, clearMapContent, hasContent, pushUndo, undo, redo, updateUndoRedoButtons, clearUndoHistory, createStory, createSlice, selection, clearSelection } from '/src/core/state.js';
import { serialize, deserialize } from '/src/core/serialization.js';
import * as navigation from '/src/ui/navigation.js';
import * as menuTap from '/src/ui/menu-tap.js';
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
import * as cardLinks from '/src/features/card-links.js';
import { loadAnalytics } from '/src/features/analytics.js';
import { isCardHash } from '/src/core/slice-hash.js';
import * as freezeRows from '/src/features/freeze-rows.js';
import * as starterText from '/src/features/starter-text.js';
import * as projects from '/src/features/projects.js';
import * as recentMaps from '/src/features/recent-maps.js';
import * as bookmarkNudge from '/src/features/bookmark-nudge.js';
import * as lesson from '/src/features/lesson.js';
import { parseLocation, projectPath } from '/src/core/project-links.js';

const { isMapEditable } = lock;
const { render, initSortable, addColumn, addColumnAt, addStory, addSlice, deleteColumn, deleteStory, deleteSlice, handleColumnSelection, updateSelectionUI, duplicateColumns, duplicateCards, deleteSelectedColumns, deleteSelectedCards, setPreserveToolbar } = renderMod;
const { closeMainMenu, closeAllOptionsMenus, zoomToFit, scrollElementIntoView } = navigation;
const { loadYjs, createYjsDoc, destroyYjs, syncFromYjs, syncToYjs, getProvider, getYdoc, getYmap, ensureSortable } = yjs;
const { trackPresence, trackCursor, toggleCursorsVisibility, updateCursorsVisibilityUI, getCursorColor, getSessionId, broadcastDragStart, broadcastDragEnd } = presence;
const { lockState, loadLockState, subscribeLockState, updateLockUI, updateEditability, restoreSessionUnlock, initLockListeners, hideLockModal } = lock;
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

// Subscribe to real-time updates via Yjs. Every way of opening a map comes through here.
const subscribeToMap = async (mapId) => {
    clearUndoHistory();
    projects.load(mapId);
    if (!getYdoc()) {
        await createYjsDoc(mapId);
    }

    syncFromYjs();
    render();
    recentMaps.noteOpened();
    bookmarkNudge.start(mapId);

    const deferredTracking = async () => {
        await trackPresence();
        trackCursor();
        await loadLockState(mapId);
        restoreSessionUnlock(mapId);
        subscribeLockState(mapId);
        updateLockUI();
        updateEditability();
        // Fetch backup count for menu badge
        fetch(`/api/backups/${mapId}`).then(r => r.json()).then(b => updateBackupBadge(b.length)).catch(() => {});

        const provider = getProvider();
        if (provider) {
            projects.watch(provider, getYmap());
            recentMaps.watch(getYmap());
            // A map read from disk can get its name after it first opened
            recentMaps.noteOpened();
            provider.awareness.on('change', () => {
                const ydoc = getYdoc();
                for (const [clientId, awarenessState] of provider.awareness.getStates()) {
                    if (clientId === ydoc.clientID) continue;
                    if (awarenessState.lock) {
                        loadLockState(mapId).then(() => {
                            restoreSessionUnlock(mapId);
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
    projects.clear();
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
const { exportsMod, jiraImportsMod, asanaImportsMod, phabImportsMod, linearImportsMod, azureImportsMod } = io;

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

const {
    showAzureImportModal, confirmCloseAzureImportModal,
    verifyAzureImport, fetchFromAzure, showAzureImportStage1, confirmAzureImport,
    showAzureCsvImportModal, handleAzureCsvFile,
} = azureImportsMod;

const { updateBackupBadge } = backups;

const { showWelcomeScreen, hideWelcomeScreen, showLoading, hideLoading, startNewMap, startWithSample, showTutorialToast, newMap, copyMap } = welcome;

// =============================================================================
// Event Listeners
// =============================================================================

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
// Lets the styles give Safari what it needs, such as its own layer for the zoomed map
if (isSafari) document.documentElement.classList.add('safari');

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
        // When the server has imports through tracker APIs turned off, offer the CSV import instead
        const importMap = document.documentElement.dataset.integrations === 'off' ? {
            jira: showJiraCsvImportModal,
            asana: showAsanaCsvImportModal,
            phabricator: showPhabCsvImportModal,
            linear: showLinearCsvImportModal,
            'azure-devops': showAzureCsvImportModal,
        } : {
            jira: showJiraImportModal,
            asana: showAsanaImportModal,
            phabricator: showPhabImportModal,
            linear: showLinearImportModal,
            'azure-devops': showAzureImportModal,
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
        if (getYdoc() && !dom.welcomeScreen.classList.contains('visible')) {
            sliceLinks.revealSliceFromHash();
            cardLinks.openCardFromHash();
        }
    });

    window.addEventListener('popstate', async (e) => {
        // Ignore popstate from our own history.back() after closing expand modal
        if (cardExpand.isPoppingExpandState()) {
            cardExpand.clearPoppingExpandState();
            cardLinks.clearCardHash();
            return;
        }
        // Back closes the recent maps list, on the home page
        if (recentMaps.handlePopState()) return;
        // Back button closes expand modal instead of navigating
        if (cardExpand.getExpandedItem()) {
            cardExpand.closeExpandViaBack();
            cardLinks.clearCardHash();
            return;
        }
        const { mapId, projectId } = parseLocation(window.location.pathname);
        // A project link without a map picks the first map when the page loads
        if (projectId && !mapId) {
            window.location.reload();
            return;
        }
        // A slice link on the open map only changes the hash; hashchange scrolls to the slice
        if (mapId && mapId === state.mapId && getYdoc() && !dom.welcomeScreen.classList.contains('visible')) return;
        if (mapId) {
            await openMapInPage(mapId);
        } else {
            destroyYjs();
            projects.clear();
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
    projects.initListeners({ openMap: openMapInPage, newMap: welcome.newMapInProject });
    recentMaps.initListeners();
    bookmarkNudge.initListeners();
    lesson.init(state, { renderAndSave });
    dom.projectMenuBtn.addEventListener('click', () => {
        closeMainMenu();
        projects.openFromMenu();
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
    cardLinks.initListeners();

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
        // The main menu offers the other theme, for the home page, which has no view controls
        const themeLabel = document.getElementById('themeMenuLabel');
        if (themeLabel) themeLabel.textContent = darkMode ? 'Light mode' : 'Dark mode';
        const themeIcon = document.getElementById('themeMenuIcon');
        if (themeIcon) themeIcon.textContent = darkMode ? '☀️' : '🌙';
        const heroDark = document.getElementById('welcomeHeroDark');
        if (heroDark) heroDark.media = darkMode ? 'all' : 'not all';
    }
    applyDarkMode();
    const toggleDarkMode = () => {
        darkMode = !darkMode;
        try { localStorage.setItem('darkMode', darkMode); } catch (e) {}
        applyDarkMode();
    };
    dom.toggleDarkModeBtn?.addEventListener('click', toggleDarkMode);
    document.getElementById('themeMenuBtn')?.addEventListener('click', () => {
        closeMainMenu();
        toggleDarkMode();
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
        // In full screen the header goes and its buttons float over the map (styles.css)
        document.body.classList.toggle('fullscreen-mode', !!document.fullscreenElement);
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
        }).catch(() => { fullscreenMode = false; updateFullscreenLabel(); });
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
            }).catch(() => {
                // The browser refuses to go back in without a click or key press. The button was lit
                // just below, before this ran, so put it out here.
                fullscreenMode = false;
                updateFullscreenLabel();
                requestAnimationFrame(zoomToFit);
            });
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

    // Azure DevOps API and CSV Import
    [[dom.importAzureBtn, showAzureImportModal], [dom.importAzureCsvBtn, showAzureCsvImportModal]].forEach(([button, show]) => {
        button.addEventListener('click', async () => {
            closeMainMenu();
            if (lockState.isLocked && !lockState.sessionUnlocked) {
                await showAlert('This map is read-only. Unlock it first to import.');
                return;
            }
            show();
        });
    });
    dom.azureImportModalClose.addEventListener('click', confirmCloseAzureImportModal);
    dom.azureImportModal.addEventListener('click', (e) => {
        if (e.target === dom.azureImportModal) confirmCloseAzureImportModal();
    });
    dom.azureImportCancel.addEventListener('click', confirmCloseAzureImportModal);
    dom.azureImportVerifyBtn.addEventListener('click', verifyAzureImport);
    dom.azureImportFetchBtn.addEventListener('click', fetchFromAzure);
    dom.azureImportBack.addEventListener('click', showAzureImportStage1);
    dom.azureImportConfirmBtn.addEventListener('click', confirmAzureImport);
    dom.azureCsvDropzone.addEventListener('click', () => dom.azureCsvFileInput.click());
    dom.azureCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.azureCsvDropzone.classList.add('dragover');
    });
    dom.azureCsvDropzone.addEventListener('dragleave', () => {
        dom.azureCsvDropzone.classList.remove('dragover');
    });
    dom.azureCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.azureCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            dom.azureCsvDropzone.querySelector('span').textContent = file.name;
            dom.azureCsvImportParseBtn.disabled = false;
            dom.azureCsvFileInput._droppedFile = file;
        }
    });
    dom.azureCsvFileInput.addEventListener('change', () => {
        const file = dom.azureCsvFileInput.files[0];
        if (file) {
            dom.azureCsvDropzone.querySelector('span').textContent = file.name;
            dom.azureCsvImportParseBtn.disabled = false;
            dom.azureCsvFileInput._droppedFile = null;
        }
    });
    dom.azureCsvImportParseBtn.addEventListener('click', () => {
        const file = dom.azureCsvFileInput._droppedFile || dom.azureCsvFileInput.files[0];
        handleAzureCsvFile(file);
    });
    dom.azureCsvImportCancel.addEventListener('click', confirmCloseAzureImportModal);

    // Tracker exports: each menu item opens its own export window
    [
        ['exportJiraBtn', 'jiraCsv'], ['exportJiraProxyBtn', 'jiraApi'],
        ['exportAsanaCsvBtn', 'asanaCsv'], ['exportAsanaProxyBtn', 'asanaApi'],
        ['exportPhabProxyBtn', 'phabApi'], ['exportPhabBtn', 'phabConsole'],
        ['exportLinearProxyBtn', 'linearApi'],
        ['exportAzureCsvBtn', 'azureCsv'], ['exportAzureProxyBtn', 'azureApi'],
    ].forEach(([buttonId, kind]) => {
        dom[buttonId].addEventListener('click', () => {
            if (dom[buttonId].disabled) return;
            closeMainMenu();
            exportsMod.openExport(kind);
        });
    });

    // Share dropdown
    // Set the share items for where we are. Runs when the Share menu opens, and when the main menu
    // opens, which offers the same items in full screen.
    const prepareShareItems = () => {
        const onMap = !dom.welcomeScreen.classList.contains('visible');
        dom.shareScreenshot.disabled = !onMap;
        dom.shareDownload.disabled = !onMap;
        // In a project, the project link comes first, then the link to this map in the project
        const inProject = onMap && !!projects.current();
        dom.shareProjectLink.hidden = !inProject;
        dom.shareCopyLink.textContent = inProject ? 'Share this map link' : 'Share URL';
    };
    dom.shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMainMenu();
        prepareShareItems();
        dom.shareMenu.classList.toggle('visible');
    });
    const shareLink = async (url) => {
        dom.shareMenu.classList.remove('visible');
        try {
            await navigator.clipboard.writeText(url);
            dom.shareBtn.querySelector('.btn-label').textContent = ' Copied!';
            setTimeout(() => dom.shareBtn.querySelector('.btn-label').textContent = ' Share', 2000);
            // Where the Share button isn't on screen, as in full screen, say it another way
            if (!dom.shareBtn.offsetParent) showToast('Link copied');
        } catch {
            await showPrompt('Copy this link to share:', url);
        }
    };
    dom.shareProjectLink.addEventListener('click', (e) => {
        e.stopPropagation();
        const link = projects.projectLink();
        if (link) shareLink(link);
    });
    dom.shareCopyLink.addEventListener('click', (e) => {
        e.stopPropagation();
        // The whole map, even if it was opened from a slice link. In a project, it opens with the tabs.
        shareLink(window.location.href.split('#')[0]);
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
            // html-to-image copies the live styles of every element, and the map is zoomed in two
            // parts (src/ui/map-top.js), so it draws an unzoomed copy placed out of view
            const copy = mapEl.cloneNode(true);
            copy.style.setProperty('--zoom', '1');
            Object.assign(copy.style, { position: 'fixed', left: '-100000px', top: '0' });
            const copyTop = copy.querySelector(':scope > .map-top');
            if (copyTop) copyTop.style.height = 'auto';
            document.body.appendChild(copy);
            try {
                mapCanvas = await window._htmlToImage.toCanvas(copy, {
                    backgroundColor: bgColor,
                    pixelRatio: dpr,
                    skipFonts: true,
                    style: {
                        position: 'static',
                        left: 'auto',
                        transform: 'none',
                        margin: '0',
                        minWidth: '0',
                        padding: '24px',
                    },
                });
            } finally {
                copy.remove();
            }
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
                    // The map is zoomed in two parts (src/ui/map-top.js): draw both at full size
                    clonedMap.style.setProperty('--zoom', '1');
                    const clonedTop = clonedMap.querySelector(':scope > .map-top');
                    if (clonedTop) Object.assign(clonedTop.style, { height: 'auto', position: 'static' });

                    // The "+ Slice" border colour is a color-mix(), which the browser reports as
                    // color(srgb ...). html2canvas cannot read that and gives up on the whole image.
                    // At full size the mix is the plain line colour, so set that.
                    for (const btn of clonedDoc.querySelectorAll('.btn-add-slice')) {
                        btn.style.borderColor = 'var(--slice-btn-line, var(--color-border-strong))';
                    }

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
    // The shade behind the panel on a phone closes it
    document.getElementById('panelShade')?.addEventListener('click', () => {
        const open = dom.panelBody?.querySelector('.panel-section.open');
        if (open) switchPanelTab(open.dataset.section);
    });
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
        // A project starts from a map, so the home page doesn't offer one
        dom.projectMenuBtn.hidden = !onMap;
        recentMaps.fillMenu();
        // The full screen items follow the buttons they stand for: the project link is only there
        // in a project, and the map link is named to match
        prepareShareItems();
        document.querySelectorAll('#fullscreenMenuItems [data-clicks]').forEach(item => {
            const button = document.getElementById(item.dataset.clicks);
            item.hidden = button.hidden;
            item.disabled = button.disabled;
        });
        document.getElementById('fullscreenShareLinkLabel').textContent = dom.shareCopyLink.textContent;
    });

    // In full screen, Share and Build are menu items that click the header buttons, so they do
    // exactly what those do
    document.getElementById('fullscreenMenuItems')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-clicks]');
        if (!item) return;
        closeMainMenu();
        document.getElementById(item.dataset.clicks).click();
    });

    // Submenu collapse helper
    const collapseSubmenus = (...except) => {
        const all = [
            [dom.recentSubmenuTrigger, dom.recentSubmenu],
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

    // Recent maps submenu toggle
    dom.recentSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseSubmenus(dom.recentSubmenuTrigger);
        dom.recentSubmenuTrigger.classList.toggle('expanded');
        dom.recentSubmenu.classList.toggle('visible');
    });

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
            closeMainMenu();
            if (!await showConfirm(`Open the ${item.textContent.trim()} sample?\n\nIt opens as a new map. You can return to this map using the back button.`)) return;
            startWithSample(item.dataset.sample);
        }
    });

    document.addEventListener('click', () => {
        closeMainMenu();
        closeAllOptionsMenus();
        dom.shareMenu.classList.remove('visible');
        closeFilterPanel();
    });

    menuTap.init(() => {
        closeMainMenu();
        closeAllOptionsMenus();
        dom.shareMenu.classList.remove('visible');
        navigation.dismissContextMenu();
        document.querySelectorAll('.selection-toolbar-split-menu.visible').forEach(m => m.classList.remove('visible'));
    });

    // A mouse click leaves the focus on the button, and the next key press (Shift to select cards,
    // say) then draws the browser's focus outline on it. A click made with Enter or Space has
    // detail 0, so keyboard users keep the focus where it is. Buttons in a dialog keep it too: the
    // focus belongs inside an open dialog, and the project box puts it back on the button used.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('button');
        if (btn && e.detail > 0 && document.activeElement === btn && !btn.closest('[role="dialog"], .modal')) btn.blur();
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
            exportsMod.hideAllExports();
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

    // Freeze the top rows while scrolling down
    freezeRows.init();
    starterText.init();

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
navigation.init({ state, updateSelectionUI, selection, clearSelection, isMapEditable, addColumnAt, deleteColumn, duplicateColumns, duplicateCards, deleteSelectedColumns, deleteSelectedCards, insertPartialMapRef: (...args) => insertPartialMapRef(...args), getSliceActions: (...args) => ui.getSliceActions(...args), copyCardLink: (cardId) => cardLinks.copyCardLinkById(cardId), buildCard: (cardId) => build.openForCard(cardId), canBuildCard: (cardId) => build.canBuildCard(cardId) });

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
    renderPartialsList,
    logEvent: (text, ids) => log.logEvent(text, ids),
});

// Wire yjs module
yjs.init({
    state,
    notepad,
    log,
    connectionStatus,
    isMapEditable,
    render,
    setPreserveToolbar,
    onSync: () => cardExpand.refreshFromRemote(),
});

// Wire tour module
tour.init({
    addSlice,
    deleteSlice,
    getState: () => state,
    renderAndSave,
    createStory,
    zoomToFit,
    clearSelection: () => {
        closeAllOptionsMenus();
        clearSelection();
        updateSelectionUI();
    },
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
        if (res.status === 410) return 'deleted';
        if (res.status === 404) return false;
        return res.ok ? true : null;
    } catch {
        return null;
    }
};

// Open a map without loading the page again, for back and forward and for project tabs, so full
// screen stays as it is. The board fades out while the map arrives, and back in once the new map
// fits the screen, so it never shows at the last map's zoom first. The spinner only shows if the
// map is slow, so a quick switch doesn't flash it.
const openMapInPage = async (mapId) => {
    const board = dom.storyMapWrapper;
    clearTimeout(board._fadeTimer);
    board.classList.add('map-fading', 'map-switching');
    const spinner = setTimeout(showLoading, 400);
    const loaded = await loadMapById(mapId);
    clearTimeout(spinner);
    hideLoading();
    if (!loaded) {
        board.classList.remove('map-fading', 'map-switching');
        leaveMapForWelcome();
        return;
    }
    hideWelcomeScreen();
    zoomToFit();
    board.classList.remove('map-switching');
    board._fadeTimer = setTimeout(() => board.classList.remove('map-fading'), 200);
    requestAnimationFrame(() => {
        sliceLinks.revealSliceFromHash(350);
        cardLinks.openCardFromHash();
    });
};

const loadMapById = async (mapId) => {
    destroyYjs();

    // The server refuses a connection for anything that isn't shaped like a map ID, and the page
    // would sit on "Loading map..." until that timed out. Say straight away that there's no map.
    // Only the map part of a link gets here: /new, /tour, samples and the project part of a
    // project link are dealt with before this.
    if (mapId && !isMapId(mapId)) return false;

    if (mapId) {
        clearMapContent();
        state.mapId = mapId;
        const known = await mapKnownToServer(mapId);
        // A deleted map can't be opened, and the server refuses its connection
        if (known === 'deleted') return false;
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
    const where = parseLocation(path);
    let mapId = sampleMatch ? null : where.mapId;

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

    // A link to a project alone (/p/<project>) opens the first map, or offers a new map for a
    // project with none
    if (where.projectId && !mapId) {
        const project = await projects.fetchProject(where.projectId);
        if (project?.maps.length) {
            history.replaceState(null, '', projectPath(where.projectId, project.maps[0].id) + window.location.hash);
            mapId = project.maps[0].id;
        } else {
            history.replaceState(null, '', '/');
            showWelcomeScreen();
            if (!project) {
                recentMaps.forgetProject(where.projectId);
                await showAlert("This project link doesn't open anything. The project may have been deleted, or the link may be wrong.");
            } else if (await showConfirm(`${project.name} has no maps yet. Create a new map in it?`)) {
                window.location.replace(projectPath(where.projectId, 'new'));
            }
            return;
        }
    }

    // A new map for a project (/p/<project>/new) is only made when the project can take it
    let notice = null;
    if (where.projectId && mapId === 'new') {
        const problem = await projects.roomForNewMap(where.projectId);
        if (problem?.firstMap) {
            history.replaceState(null, '', projectPath(where.projectId, problem.firstMap));
            mapId = problem.firstMap;
            notice = problem.message;
        } else if (problem) {
            history.replaceState(null, '', '/');
            showWelcomeScreen();
            await showAlert(problem.message);
            return;
        }
    }

    if (sampleMatch) {
        await startWithSample(sampleMatch[1]);
    } else if (mapId === 'new') {
        // A new map made from the add box of a project (/p/<project>/new) joins that project
        await startNewMap();
        if (where.projectId) await projects.joinNew(where.projectId);
    } else if (mapId === 'tour' && !where.projectId) {
        await startWithSample('tour', { showToast: false });
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
                cardLinks.openCardFromHash();
            });
            // A card link opens the card, so the tip about moving around the map would only get in the way
            if (!isCardHash(window.location.hash)) setTimeout(showTutorialToast, 800);
        } else {
            // The map is gone, so it leaves the recent list too
            recentMaps.forgetMap(mapId);
            leaveMapForWelcome();
        }
    } else {
        showWelcomeScreen();
    }
    if (notice) await showAlert(notice);
};

loadAnalytics();
init();
