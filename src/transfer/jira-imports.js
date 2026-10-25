// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Import Modules -- Jira Import via server proxy + CSV file upload

import { state } from '/src/core/state.js';
import { showConfirm } from '/src/core/modals.js';
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

// ==================== Jira Import State ====================

const jiraImportState = {
    epics: [],
    projectKey: '',
    fetching: false,
    mode: 'api',        // 'api' | 'csv'
    csvInstanceUrl: ''
};

// ==================== Modal Lifecycle ====================

export const showJiraImportModal = () => {
    jiraImportState.epics = [];
    jiraImportState.projectKey = '';
    jiraImportState.fetching = false;
    jiraImportState.mode = 'api';
    jiraImportState.csvInstanceUrl = '';
    dom.jiraImportStage1.classList.remove('hidden');
    dom.jiraCsvImportStage1.classList.add('hidden');
    dom.jiraImportStage2.classList.add('hidden');
    dom.jiraImportTitle.textContent = 'Import from Jira';
    dom.jiraImportProgress.classList.add('hidden');
    dom.jiraImportProgressItems.innerHTML = '';
    dom.jiraImportProgressBar.style.width = '0';
    dom.jiraImportFetchBtn.disabled = false;
    dom.jiraImportVerifyStatus.textContent = 'Optional - test before fetching';
    dom.jiraImportVerifyStatus.className = 'export-verify-status';
    dom.jiraImportVerifyBtn.disabled = false;
    dom.jiraImportModal.classList.add('visible');
};

export const hideJiraImportModal = () => {
    dom.jiraImportModal.classList.remove('visible');
    // Clear credentials from DOM
    dom.jiraImportToken.value = '';
    // Clear CSV state
    dom.jiraCsvFileInput.value = '';
    dom.jiraCsvFileInput._droppedFile = null;
    dom.jiraCsvInstanceUrl.value = '';
    dom.jiraCsvValidationError.classList.add('hidden');
    dom.jiraCsvImportParseBtn.disabled = true;
    dom.jiraCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
};

export const confirmCloseJiraImportModal = async () => {
    if (jiraImportState.fetching) {
        if (await showConfirm('A fetch is in progress. Close anyway?')) {
            hideJiraImportModal();
        }
    } else if (await showConfirm('Close import dialog?')) {
        hideJiraImportModal();
    }
};

// ==================== Verify ====================

export const verifyJiraImport = () => {
    const instanceUrl = dom.jiraImportInstanceUrl.value.trim();
    const email = dom.jiraImportEmail.value.trim();
    const token = dom.jiraImportToken.value.trim();
    if (!instanceUrl || !email || !token) {
        dom.jiraImportVerifyStatus.className = 'export-verify-status error';
        dom.jiraImportVerifyStatus.textContent = 'Please fill in all fields first';
        return;
    }
    verifyConnection('/api/export/jira/verify', { instanceUrl, email, token }, dom.jiraImportVerifyStatus, dom.jiraImportVerifyBtn);
};

// ==================== Fetch from Jira ====================

export const fetchFromJira = async () => {
    const instanceUrl = dom.jiraImportInstanceUrl.value.trim();
    const projectKey = dom.jiraImportProjectKey.value.trim().toUpperCase();
    const email = dom.jiraImportEmail.value.trim();
    const token = dom.jiraImportToken.value.trim();

    if (!instanceUrl || !projectKey || !email || !token) {
        dom.jiraImportVerifyStatus.className = 'export-verify-status error';
        dom.jiraImportVerifyStatus.textContent = 'Please fill in all fields';
        return;
    }

    jiraImportState.fetching = true;
    dom.jiraImportFetchBtn.disabled = true;
    dom.jiraImportProgress.classList.remove('hidden');
    dom.jiraImportProgressItems.innerHTML = '';
    dom.jiraImportProgressBar.style.width = '0';
    dom.jiraImportProgressBar.classList.add('indeterminate');

    const addLine = (text, cls) => {
        const line = document.createElement('div');
        line.className = 'import-progress-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        dom.jiraImportProgressItems.append(line);
        dom.jiraImportProgressItems.scrollTop = dom.jiraImportProgressItems.scrollHeight;
    };

    addLine('Connecting to Jira...');

    let response;
    try {
        response = await fetch('/api/import/jira', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceUrl, email, token, projectKey })
        });
    } catch (e) {
        addLine(`Connection failed: ${e.message}`, 'error');
        dom.jiraImportProgressBar.classList.remove('indeterminate');
        jiraImportState.fetching = false;
        dom.jiraImportFetchBtn.disabled = false;
        return;
    }

    if (!response.ok) {
        try {
            const err = await response.json();
            addLine(err.error || `HTTP ${response.status}`, 'error');
        } catch {
            addLine(`HTTP ${response.status}`, 'error');
        }
        dom.jiraImportProgressBar.classList.remove('indeterminate');
        jiraImportState.fetching = false;
        dom.jiraImportFetchBtn.disabled = false;
        return;
    }

    await readSSE(response,
        (eventType, data) => {
            // progress event
            if (data.phase === 'epics') {
                addLine(`Fetching epics... ${data.fetched}`);
            } else if (data.phase === 'stories') {
                addLine(`Fetching stories... ${data.fetched}`);
            }
        },
        (data) => {
            // done event
            dom.jiraImportProgressBar.classList.remove('indeterminate');
            dom.jiraImportProgressBar.style.width = '100%';
            addLine(`Found ${data.epicCount} epics, ${data.storyCount} stories`, 'success');
            jiraImportState.epics = data.epics || [];
            jiraImportState.projectKey = data.projectKey || projectKey;
            jiraImportState.fetching = false;
            // Auto-advance to preview
            showJiraImportStage2();
        },
        (data) => {
            // error event
            dom.jiraImportProgressBar.classList.remove('indeterminate');
            addLine(data.error || 'Unknown error from Jira', 'error');
            jiraImportState.fetching = false;
            dom.jiraImportFetchBtn.disabled = false;
        }
    );

    // If stream ended without done event
    if (jiraImportState.fetching) {
        jiraImportState.fetching = false;
        dom.jiraImportFetchBtn.disabled = false;
    }
};

// ==================== Stage Navigation ====================

export const showJiraImportStage1 = () => {
    dom.jiraImportStage2.classList.add('hidden');
    dom.jiraImportFetchBtn.disabled = false;
    if (jiraImportState.mode === 'csv') {
        dom.jiraImportStage1.classList.add('hidden');
        dom.jiraCsvImportStage1.classList.remove('hidden');
        dom.jiraImportTitle.textContent = 'Import from Jira CSV';
    } else {
        dom.jiraImportStage1.classList.remove('hidden');
        dom.jiraCsvImportStage1.classList.add('hidden');
        dom.jiraImportTitle.textContent = 'Import from Jira';
    }
};

const jiraPreviewDomRefs = () => ({
    previewHeader: dom.jiraImportPreviewHeader,
    preview: dom.jiraImportPreview
});

const jiraUpdateCount = () => updateImportCount(jiraImportState.epics, dom.jiraImportCount);

const showJiraImportStage2 = () => {
    dom.jiraImportStage1.classList.add('hidden');
    dom.jiraCsvImportStage1.classList.add('hidden');
    dom.jiraImportStage2.classList.remove('hidden');
    dom.jiraImportTitle.textContent = 'Review Import';
    // Show import mode toggle only when importing into an existing map
    if (state.mapLoaded) {
        dom.jiraImportMode.classList.remove('hidden');
        dom.jiraImportMode.querySelector('input[value="append"]').checked = true;
    } else {
        dom.jiraImportMode.classList.add('hidden');
    }
    renderImportPreview(jiraImportState.epics, jiraImportState.projectKey, jiraPreviewDomRefs(), jiraUpdateCount);
    jiraUpdateCount();
};

// ==================== Confirm Import ====================

export const confirmJiraImport = () => {
    const data = jiraDataToStorymap();
    if (data.steps.length === 0) return;
    const mode = dom.jiraImportMode?.querySelector('input:checked')?.value || 'replace';
    hideJiraImportModal();
    onImportComplete(data, { mode });
};

const jiraDataToStorymap = () => {
    const rawUrl = jiraImportState.mode === 'csv'
        ? jiraImportState.csvInstanceUrl
        : dom.jiraImportInstanceUrl.value.trim();
    const instanceUrl = rawUrl.replace(/\/+$/, '');
    const origin = instanceUrl ? (instanceUrl.startsWith('http') ? instanceUrl : 'https://' + instanceUrl) : '';

    return buildStorymapFromImport(
        jiraImportState.epics,
        jiraImportState.projectKey,
        (key) => (origin && key) ? `${origin}/browse/${key}` : ''
    );
};

// ==================== Jira CSV Parsing ====================

const mapJiraCsvStatus = (status) => {
    if (!status) return 'planned';
    const s = status.toLowerCase().trim();
    if (s === 'done' || s === 'closed' || s === 'resolved') return 'done';
    if (s === 'in progress' || s === 'in review' || s === 'in development') return 'in-progress';
    return 'planned';
};

export const parseJiraCsv = (csvText) => {
    const rows = parseCsv(csvText);
    if (rows.length < 2) return { epics: [], projectKey: '' };

    const headers = rows[0].map(h => h.trim());
    const col = (name) => headers.indexOf(name);

    const iSummary = col('Summary');
    const iKey = col('Issue key');
    const iType = col('Issue Type');
    if (iSummary === -1 || iKey === -1 || iType === -1) {
        throw new Error('Missing required columns: Summary, Issue key, Issue Type');
    }

    const iStatus = col('Status');
    const iDesc = col('Description');
    const iPoints = headers.findIndex(h => /story\s*point/i.test(h));
    const iParent = col('Parent key') !== -1 ? col('Parent key') : col('Parent');
    const iProject = col('Project key');
    // Jira exports one "Labels" column per label
    const iLabels = headers.map((h, i) => (h === 'Labels' ? i : -1)).filter(i => i !== -1);

    // First pass: index all rows
    const epicMap = new Map(); // key -> epic object
    const storyRows = [];     // non-epic rows
    let projectKey = '';

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length <= iSummary || !row[iKey]?.trim()) continue;

        const key = row[iKey].trim();
        const summary = row[iSummary].trim();
        const type = (row[iType] || '').trim().toLowerCase();
        const status = iStatus !== -1 ? row[iStatus]?.trim() : '';
        const description = iDesc !== -1 ? row[iDesc]?.trim() : '';
        const points = iPoints !== -1 ? parseFloat(row[iPoints]) : NaN;
        const parentKey = iParent !== -1 ? (row[iParent] || '').trim() : '';

        if (!projectKey && iProject !== -1 && row[iProject]?.trim()) {
            projectKey = row[iProject].trim();
        }
        if (!projectKey && key.includes('-')) {
            projectKey = key.split('-')[0];
        }

        const item = {
            key, summary, type, status: mapJiraCsvStatus(status),
            description: description || undefined,
            points: isNaN(points) ? undefined : points,
            labels: iLabels.map(i => (row[i] || '').trim()).filter(Boolean),
            parentKey
        };

        if (type === 'epic') {
            epicMap.set(key, { key, summary, status: item.status, description: item.description, stories: [] });
        }
        storyRows.push(item);
    }

    // Second pass: group stories under epics
    const orphans = [];
    for (const item of storyRows) {
        if (item.type === 'epic') continue;
        const story = {
            key: item.key,
            summary: item.summary,
            status: item.status,
            description: item.description,
            points: item.points != null ? item.points : undefined,
            labels: item.labels
        };
        const epic = item.parentKey ? epicMap.get(item.parentKey) : null;
        if (epic) {
            epic.stories.push(story);
        } else {
            orphans.push(story);
        }
    }

    const epics = [...epicMap.values()];

    // Orphans go into "Other" pseudo-epic
    if (orphans.length > 0) {
        epics.push({ key: null, summary: 'Other (no parent epic)', stories: orphans });
    }

    return { epics, projectKey };
};

// ==================== CSV Import Modal ====================

export const showJiraCsvImportModal = () => {
    jiraImportState.epics = [];
    jiraImportState.projectKey = '';
    jiraImportState.fetching = false;
    jiraImportState.mode = 'csv';
    jiraImportState.csvInstanceUrl = '';
    dom.jiraImportStage1.classList.add('hidden');
    dom.jiraCsvImportStage1.classList.remove('hidden');
    dom.jiraImportStage2.classList.add('hidden');
    dom.jiraImportTitle.textContent = 'Import from Jira CSV';
    dom.jiraCsvFileInput.value = '';
    dom.jiraCsvInstanceUrl.value = '';
    dom.jiraCsvValidationError.classList.add('hidden');
    dom.jiraCsvImportParseBtn.disabled = true;
    dom.jiraCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
    dom.jiraImportModal.classList.add('visible');
};

export const handleJiraCsvFile = (file) => {
    if (!file) return;
    dom.jiraCsvValidationError.classList.add('hidden');
    // Guard: reject files over 20 MB to prevent browser tab hangs
    if (file.size > 20 * 1024 * 1024) {
        dom.jiraCsvValidationError.textContent = 'File too large (max 20 MB). Try exporting fewer issues from Jira.';
        dom.jiraCsvValidationError.classList.remove('hidden');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const { epics, projectKey } = parseJiraCsv(e.target.result);
            if (epics.length === 0) {
                dom.jiraCsvValidationError.textContent = 'No issues found in CSV. Check that the file has Summary, Issue key, and Issue Type columns.';
                dom.jiraCsvValidationError.classList.remove('hidden');
                return;
            }
            jiraImportState.epics = epics;
            jiraImportState.projectKey = projectKey;
            jiraImportState.csvInstanceUrl = dom.jiraCsvInstanceUrl.value.trim();
            // Advance to stage 2
            showJiraImportStage2();
        } catch (err) {
            dom.jiraCsvValidationError.textContent = err.message;
            dom.jiraCsvValidationError.classList.remove('hidden');
        }
    };
    reader.readAsText(file);
};
