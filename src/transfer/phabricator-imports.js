// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Import Modules -- Phabricator Maniphest API + CSV file upload

import { state } from '/src/core/state.js';
import { showConfirm } from '/src/core/modals.js';
import { CARD_COLORS } from '/src/core/constants.js';
import {
    readSSE, verifyConnection,
    renderImportPreview, updateImportCount, buildStorymapFromImport
} from '/src/transfer/import-helpers.js';
import { parseCsv } from '/src/transfer/csv.js';

let dom = null;
let onImportComplete = null;

export const init = (deps) => {
    dom = new Proxy({}, {
        get: (cache, id) => cache[id] ??= document.getElementById(id)
    });
    onImportComplete = deps.onImportComplete;
};

// ==================== Phabricator Import State ====================

const phabImportState = {
    epics: [],
    projectKey: '',
    baseUrl: '',
    fetching: false,
    mode: 'api' // 'api' | 'csv'
};

// ==================== Modal Lifecycle ====================

export const showPhabImportModal = () => {
    phabImportState.epics = [];
    phabImportState.projectKey = '';
    phabImportState.baseUrl = '';
    phabImportState.fetching = false;
    phabImportState.mode = 'api';
    dom.phabImportStage1.classList.remove('hidden');
    dom.phabCsvImportStage1.classList.add('hidden');
    dom.phabImportStage2.classList.add('hidden');
    dom.phabImportTitle.textContent = 'Import from Phabricator';
    dom.phabImportProgress.classList.add('hidden');
    dom.phabImportProgressItems.innerHTML = '';
    dom.phabImportProgressBar.style.width = '0';
    dom.phabImportFetchBtn.disabled = false;
    dom.phabImportVerifyStatus.textContent = 'Optional - test before fetching';
    dom.phabImportVerifyStatus.className = 'export-verify-status';
    dom.phabImportVerifyBtn.disabled = false;
    // Update token help link based on instance URL
    updateTokenHelpLink();
    dom.phabImportModal.classList.add('visible');
};

export const showPhabCsvImportModal = () => {
    phabImportState.epics = [];
    phabImportState.projectKey = '';
    phabImportState.baseUrl = '';
    phabImportState.fetching = false;
    phabImportState.mode = 'csv';
    dom.phabImportStage1.classList.add('hidden');
    dom.phabCsvImportStage1.classList.remove('hidden');
    dom.phabImportStage2.classList.add('hidden');
    dom.phabImportTitle.textContent = 'Import from Phabricator CSV';
    dom.phabCsvFileInput.value = '';
    dom.phabCsvFileInput._droppedFile = null;
    dom.phabCsvValidationError.classList.add('hidden');
    dom.phabCsvImportParseBtn.disabled = true;
    dom.phabCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
    dom.phabImportModal.classList.add('visible');
};

export const hidePhabImportModal = () => {
    dom.phabImportModal.classList.remove('visible');
    // Clear API credentials
    if (dom.phabImportInstanceUrl) dom.phabImportInstanceUrl.value = '';
    if (dom.phabImportToken) dom.phabImportToken.value = '';
    if (dom.phabImportProjectTags) dom.phabImportProjectTags.value = '';
    // Clear CSV state
    dom.phabCsvFileInput.value = '';
    dom.phabCsvFileInput._droppedFile = null;
    dom.phabCsvValidationError.classList.add('hidden');
    dom.phabCsvImportParseBtn.disabled = true;
    dom.phabCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
};

export const confirmClosePhabImportModal = async () => {
    if (phabImportState.fetching) {
        if (await showConfirm('A fetch is in progress. Close anyway?')) {
            hidePhabImportModal();
        }
    } else if (await showConfirm('Close import dialog?')) {
        hidePhabImportModal();
    }
};

// ==================== Token Help Link ====================

const updateTokenHelpLink = () => {
    const url = (dom.phabImportInstanceUrl?.value || '').trim();
    const link = dom.phabImportTokenHelp;
    if (!link) return;
    if (url) {
        const base = url.startsWith('http') ? url : 'https://' + url;
        try {
            const parsed = new URL(base);
            link.href = `${parsed.origin}/conduit/token/`;
        } catch {
            link.href = '#';
        }
    } else {
        link.href = '#';
    }
};

// ==================== Verify ====================

export const verifyPhabImport = () => {
    const instanceUrl = dom.phabImportInstanceUrl.value.trim();
    const token = dom.phabImportToken.value.trim();
    if (!instanceUrl || !token) {
        dom.phabImportVerifyStatus.className = 'export-verify-status error';
        dom.phabImportVerifyStatus.textContent = 'Please fill in all fields';
        return;
    }
    const url = instanceUrl.startsWith('http') ? instanceUrl : 'https://' + instanceUrl;
    verifyConnection('/api/export/phabricator/verify', { instanceUrl: url, token }, dom.phabImportVerifyStatus, dom.phabImportVerifyBtn);
};

// ==================== Fetch from Phabricator ====================

export const fetchFromPhab = async () => {
    const instanceUrl = dom.phabImportInstanceUrl.value.trim();
    const token = dom.phabImportToken.value.trim();
    const tagsInput = (dom.phabImportProjectTags?.value || '').trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(t => t) : [];

    if (!instanceUrl || !token || tags.length === 0) {
        dom.phabImportVerifyStatus.className = 'export-verify-status error';
        dom.phabImportVerifyStatus.textContent = !instanceUrl || !token ? 'Please fill in all fields' : 'Please enter at least one project tag';
        return;
    }

    const url = instanceUrl.startsWith('http') ? instanceUrl : 'https://' + instanceUrl;

    phabImportState.fetching = true;
    dom.phabImportFetchBtn.disabled = true;
    dom.phabImportProgress.classList.remove('hidden');
    dom.phabImportProgressItems.innerHTML = '';
    dom.phabImportProgressBar.style.width = '0';
    dom.phabImportProgressBar.classList.add('indeterminate');

    const addLine = (text, cls) => {
        const line = document.createElement('div');
        line.className = 'import-progress-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        dom.phabImportProgressItems.append(line);
        dom.phabImportProgressItems.scrollTop = dom.phabImportProgressItems.scrollHeight;
    };

    addLine('Connecting to Phabricator...');

    let response;
    try {
        response = await fetch('/api/import/phabricator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceUrl: url, token, tags })
        });
    } catch (e) {
        addLine(`Connection failed: ${e.message}`, 'error');
        dom.phabImportProgressBar.classList.remove('indeterminate');
        phabImportState.fetching = false;
        dom.phabImportFetchBtn.disabled = false;
        return;
    }

    if (!response.ok) {
        try {
            const err = await response.json();
            addLine(err.error || `HTTP ${response.status}`, 'error');
        } catch {
            addLine(`HTTP ${response.status}`, 'error');
        }
        dom.phabImportProgressBar.classList.remove('indeterminate');
        phabImportState.fetching = false;
        dom.phabImportFetchBtn.disabled = false;
        return;
    }

    await readSSE(response,
        (eventType, data) => {
            if (data.phase === 'project') {
                addLine('Resolving project tags...');
            } else if (data.phase === 'tasks') {
                addLine(`Fetching tasks... ${data.fetched}`);
            } else if (data.phase === 'parents') {
                addLine(`Resolving parent tasks... ${data.fetched}`);
            }
        },
        (data) => {
            dom.phabImportProgressBar.classList.remove('indeterminate');
            dom.phabImportProgressBar.style.width = '100%';
            addLine(`Found ${data.taskCount} tasks`, 'success');
            phabImportState.epics = data.epics || [];
            phabImportState.projectKey = 'Phabricator';
            phabImportState.baseUrl = data.instanceUrl || '';
            phabImportState.fetching = false;
            showPhabImportStage2();
        },
        (data) => {
            dom.phabImportProgressBar.classList.remove('indeterminate');
            addLine(data.error || 'Unknown error from Phabricator', 'error');
            phabImportState.fetching = false;
            dom.phabImportFetchBtn.disabled = false;
        }
    );

    // If stream ended without done event
    if (phabImportState.fetching) {
        phabImportState.fetching = false;
        dom.phabImportFetchBtn.disabled = false;
    }
};

// ==================== Stage Navigation ====================

export const showPhabImportStage1 = () => {
    dom.phabImportStage2.classList.add('hidden');
    if (phabImportState.mode === 'csv') {
        dom.phabImportStage1.classList.add('hidden');
        dom.phabCsvImportStage1.classList.remove('hidden');
        dom.phabImportTitle.textContent = 'Import from Phabricator CSV';
    } else {
        dom.phabImportStage1.classList.remove('hidden');
        dom.phabCsvImportStage1.classList.add('hidden');
        dom.phabImportTitle.textContent = 'Import from Phabricator';
        dom.phabImportFetchBtn.disabled = false;
    }
};

const phabPreviewDomRefs = () => ({
    previewHeader: dom.phabImportPreviewHeader,
    preview: dom.phabImportPreview,
    statusFilter: dom.phabImportStatusFilters
});

const phabLabels = () => {
    let total = phabImportState.epics.reduce((n, e) => n + e.stories.filter(s => s._included !== false).length, 0);
    if (phabImportState.mode === 'api') {
        total += phabImportState.epics.filter(e => e.key && e._included !== false).length;
    }
    return { groupLabel: phabImportState.epics.length !== 1 ? 'columns' : 'column', itemLabel: total !== 1 ? 'tasks' : 'task' };
};

const phabUpdateCount = () => {
    if (phabImportState.mode === 'api') {
        let parentCount = 0, childCount = 0;
        phabImportState.epics.forEach(epic => {
            if (!epic._included) return;
            if (epic.key) parentCount++;
            childCount += epic.stories.filter(s => s._included).length;
        });
        const total = parentCount + childCount;
        const label = total !== 1 ? 'tasks' : 'task';
        dom.phabImportCount.textContent = `Importing ${total} ${label} into flat columns`;
    } else {
        updateImportCount(phabImportState.epics, dom.phabImportCount, phabLabels());
    }
};

const showPhabImportStage2 = () => {
    dom.phabImportStage1.classList.add('hidden');
    dom.phabCsvImportStage1.classList.add('hidden');
    dom.phabImportStage2.classList.remove('hidden');
    dom.phabImportTitle.textContent = 'Review Import';
    // Show import mode toggle only when importing into an existing map
    if (state.mapLoaded) {
        dom.phabImportMode.classList.remove('hidden');
        dom.phabImportMode.querySelector('input[value="append"]').checked = true;
    } else {
        dom.phabImportMode.classList.add('hidden');
    }
    renderImportPreview(phabImportState.epics, phabImportState.projectKey, phabPreviewDomRefs(), phabUpdateCount, { ...phabLabels(), statusFilter: true });
    phabUpdateCount();
};

// ==================== CSV Parsing ====================

const mapPhabStatus = (status) => {
    if (!status) return 'planned';
    const s = status.toLowerCase().trim();
    if (s === 'open' || s === 'stalled') return 'planned';
    if (s === 'in progress') return 'in-progress';
    return 'done';
};

const parsePhabricatorCsv = (csvText) => {
    const rows = parseCsv(csvText);
    if (rows.length < 2) return { epics: [], projectKey: '', baseUrl: '' };

    const headers = rows[0].map(h => h.trim());
    const col = (name) => headers.indexOf(name);

    const iTitle = col('Title');
    if (iTitle === -1) {
        throw new Error('Missing required column: Title');
    }

    const iId = col('ID');
    const iDesc = col('Description');
    const iStatus = col('Status');
    const iPoints = col('Points');
    const iFinalPoints = col('Final Story Points');
    const iUri = col('URI');
    const iMonogram = col('Monogram');

    const stories = [];
    let baseUrl = '';

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const title = (row[iTitle] || '').trim();
        if (!title) continue;

        // Extract task key (T416600) from Monogram or ID columns
        let key = '';
        if (iMonogram !== -1 && row[iMonogram]?.trim()) {
            key = row[iMonogram].trim();
        } else if (iId !== -1 && row[iId]?.trim()) {
            const id = row[iId].trim();
            key = id.startsWith('T') ? id : 'T' + id;
        }

        const uri = iUri !== -1 ? (row[iUri] || '').trim() : '';
        if (!baseUrl && uri) {
            try {
                const url = new URL(uri);
                baseUrl = url.origin;
            } catch { /* skip */ }
        }

        const status = iStatus !== -1 ? (row[iStatus] || '').trim() : '';
        const description = iDesc !== -1 ? (row[iDesc] || '').trim() : '';

        // Points: prefer Final Story Points, fall back to Points
        let points;
        if (iFinalPoints !== -1 && row[iFinalPoints]?.trim()) {
            const p = parseFloat(row[iFinalPoints]);
            if (!isNaN(p)) points = p;
        }
        if (points == null && iPoints !== -1 && row[iPoints]?.trim()) {
            const p = parseFloat(row[iPoints]);
            if (!isNaN(p)) points = p;
        }

        stories.push({
            key,
            summary: title,
            status: mapPhabStatus(status),
            description: description || undefined,
            points
        });
    }

    if (stories.length === 0) return { epics: [], projectKey: '', baseUrl: '' };

    // Distribute flat tasks across columns (up to 8) with blank step names
    const cols = Math.min(stories.length, 8);
    const epics = [];
    for (let c = 0; c < cols; c++) {
        epics.push({ key: `_col${c}`, summary: '', stories: [] });
    }
    stories.forEach((s, i) => epics[i % cols].stories.push(s));

    return { epics, projectKey: 'Phabricator', baseUrl };
};

// ==================== CSV File Handler ====================

export const handlePhabCsvFile = (file) => {
    if (!file) return;
    dom.phabCsvValidationError.classList.add('hidden');
    if (file.size > 20 * 1024 * 1024) {
        dom.phabCsvValidationError.textContent = 'File too large (max 20 MB). Try exporting fewer tasks from Phabricator.';
        dom.phabCsvValidationError.classList.remove('hidden');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const { epics, projectKey, baseUrl } = parsePhabricatorCsv(e.target.result);
            if (epics.length === 0) {
                dom.phabCsvValidationError.textContent = 'No tasks found in CSV. Check that the file has a Title column.';
                dom.phabCsvValidationError.classList.remove('hidden');
                return;
            }
            phabImportState.epics = epics;
            phabImportState.projectKey = projectKey;
            phabImportState.baseUrl = baseUrl;
            showPhabImportStage2();
        } catch (err) {
            dom.phabCsvValidationError.textContent = err.message;
            dom.phabCsvValidationError.classList.remove('hidden');
        }
    };
    reader.readAsText(file);
};

// ==================== Storymap Builder (API mode) ====================

const buildPhabApiStorymap = () => {
    const { baseUrl, epics } = phabImportState;
    const buildUrl = (key) => (key && baseUrl) ? baseUrl + '/' + key : '';
    const allCards = [];
    let epicIndex = 0;

    for (const epic of epics) {
        if (!epic._included) continue;
        const isParent = !!epic.key; // "Other" pseudo-epic has key === null
        const tag = isParent ? `epic-${String(++epicIndex).padStart(2, '0')}` : null;

        if (isParent) {
            const card = { name: epic.summary, color: CARD_COLORS.lime, tags: [tag] };
            if (epic.description) card.body = epic.description;
            if (epic.status) card.status = epic.status;
            if (epic.points != null) card.points = epic.points;
            const url = buildUrl(epic.key);
            if (url) card.url = url;
            allCards.push(card);
        }

        for (const story of epic.stories) {
            if (!story._included) continue;
            const card = { name: story.summary };
            if (tag) card.tags = [`${tag}-task`];
            if (story.description) card.body = story.description;
            if (story.status) card.status = story.status;
            if (story.points != null) card.points = story.points;
            const url = buildUrl(story.key);
            if (url) card.url = url;
            allCards.push(card);
        }
    }

    if (allCards.length === 0) return { app: 'storymap', v: 1, name: 'Phabricator Import', steps: [], users: [], activities: [], slices: [] };

    const cols = Math.min(allCards.length, 8);
    const grid = Array.from({ length: cols }, () => []);
    allCards.forEach((card, i) => grid[i % cols].push(card));

    const steps = [];
    const users = [];
    const activities = [];
    for (let c = 0; c < cols; c++) {
        steps.push({ name: '' });
        users.push(c === 0 ? [{ name: '', color: '#fca5a5' }] : []);
        activities.push(c === 0 ? [{ name: '', color: '#93c5fd' }] : []);
    }

    return {
        app: 'storymap',
        v: 1,
        name: 'Phabricator Import',
        steps,
        users,
        activities,
        slices: [
            { name: 'MVP', stories: Array.from({ length: cols }, () => []) },
            { name: 'IMPORTED: Phabricator tasks', stories: grid }
        ]
    };
};

// ==================== Confirm Import ====================

export const confirmPhabImport = () => {
    let data;
    if (phabImportState.mode === 'csv') {
        const { baseUrl } = phabImportState;
        data = buildStorymapFromImport(
            phabImportState.epics,
            phabImportState.projectKey,
            (key) => (key && baseUrl) ? baseUrl + '/' + key : '',
            { sliceLabel: 'IMPORTED: Phabricator tasks' }
        );
    } else {
        data = buildPhabApiStorymap();
    }
    if (data.steps.length === 0) return;
    const mode = dom.phabImportMode?.querySelector('input:checked')?.value || 'replace';
    hidePhabImportModal();
    onImportComplete(data, { mode });
};
