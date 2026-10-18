// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Import Modules -- Linear Import via server proxy + CSV file upload

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

// ==================== Linear Import State ====================

const linearImportState = {
    epics: [],           // currently displayed grouping (for preview + confirm)
    rawIssues: [],       // raw issues from server
    projects: [],        // deduplicated project list from server
    teamKey: '',
    teamName: '',
    fetching: false,
    mode: 'api',         // 'api' | 'csv'
    mappingMode: 'project' // 'project' | 'parent'
};

// ==================== Regrouping ====================

const regroupLinearData = () => {
    const { rawIssues, mappingMode } = linearImportState;

    if (mappingMode === 'parent') {
        // Group by parent issues
        const parentMap = new Map();
        const parentOrder = [];
        const orphans = [];

        // First pass: identify parents (issues with children)
        for (const issue of rawIssues) {
            if (issue.hasChildren) {
                parentMap.set(issue.id, {
                    key: issue.identifier,
                    summary: issue.summary,
                    description: issue.description,
                    status: issue.status,
                    stories: []
                });
                parentOrder.push(issue.id);
            }
        }

        // Second pass: assign children to parents
        for (const issue of rawIssues) {
            if (issue.hasChildren) continue;
            const parent = issue.parentId ? parentMap.get(issue.parentId) : null;
            if (parent) {
                parent.stories.push({
                    key: issue.identifier,
                    summary: issue.summary,
                    description: issue.description,
                    status: issue.status,
                    points: issue.points,
                    labels: issue.labels
                });
            } else {
                orphans.push({
                    key: issue.identifier,
                    summary: issue.summary,
                    description: issue.description,
                    status: issue.status,
                    points: issue.points,
                    labels: issue.labels
                });
            }
        }

        const epics = parentOrder.map(id => parentMap.get(id));
        if (orphans.length > 0) {
            epics.push({ key: null, summary: 'Other (no parent issue)', stories: orphans });
        }
        linearImportState.epics = epics;
    } else {
        // Default: group by projects
        const projectMap = new Map();
        const projectOrder = [];
        const noProject = [];

        for (const issue of rawIssues) {
            if (issue.hasChildren) continue; // Skip parent issues in project mode
            if (issue.projectId) {
                if (!projectMap.has(issue.projectId)) {
                    const proj = linearImportState.projects.find(p => p.id === issue.projectId);
                    projectMap.set(issue.projectId, {
                        key: issue.projectId,
                        summary: proj?.name || issue.projectName || 'Unknown Project',
                        stories: []
                    });
                    projectOrder.push(issue.projectId);
                }
                projectMap.get(issue.projectId).stories.push({
                    key: issue.identifier,
                    summary: issue.summary,
                    description: issue.description,
                    status: issue.status,
                    points: issue.points,
                    labels: issue.labels
                });
            } else {
                noProject.push({
                    key: issue.identifier,
                    summary: issue.summary,
                    description: issue.description,
                    status: issue.status,
                    points: issue.points,
                    labels: issue.labels
                });
            }
        }

        const epics = projectOrder.map(id => projectMap.get(id));
        if (noProject.length > 0) {
            epics.push({ key: null, summary: 'Other (no project)', stories: noProject });
        }
        linearImportState.epics = epics;
    }
};

// ==================== Modal Lifecycle ====================

export const showLinearImportModal = () => {
    linearImportState.epics = [];
    linearImportState.rawIssues = [];
    linearImportState.projects = [];
    linearImportState.teamKey = '';
    linearImportState.teamName = '';
    linearImportState.fetching = false;
    linearImportState.mode = 'api';
    linearImportState.mappingMode = 'project';
    dom.linearImportStage1.classList.remove('hidden');
    dom.linearCsvImportStage1.classList.add('hidden');
    dom.linearImportStage2.classList.add('hidden');
    dom.linearImportTitle.textContent = 'Import from Linear';
    dom.linearImportProgress.classList.add('hidden');
    dom.linearImportProgressItems.innerHTML = '';
    dom.linearImportProgressBar.style.width = '0';
    dom.linearImportFetchBtn.disabled = false;
    dom.linearImportVerifyStatus.textContent = 'Optional - test before fetching';
    dom.linearImportVerifyStatus.className = 'export-verify-status';
    dom.linearImportVerifyBtn.disabled = false;
    dom.linearImportModal.classList.add('visible');
};

export const hideLinearImportModal = () => {
    dom.linearImportModal.classList.remove('visible');
    // Clear credentials from DOM
    dom.linearImportApiKey.value = '';
    // Clear CSV state
    dom.linearCsvFileInput.value = '';
    dom.linearCsvFileInput._droppedFile = null;
    dom.linearCsvValidationError.classList.add('hidden');
    dom.linearCsvImportParseBtn.disabled = true;
    dom.linearCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
};

export const confirmCloseLinearImportModal = async () => {
    if (linearImportState.fetching) {
        if (await showConfirm('A fetch is in progress. Close anyway?')) {
            hideLinearImportModal();
        }
    } else if (await showConfirm('Close import dialog?')) {
        hideLinearImportModal();
    }
};

// ==================== Verify ====================

export const verifyLinearImport = () => {
    const apiKey = dom.linearImportApiKey.value.trim();
    if (!apiKey) {
        dom.linearImportVerifyStatus.className = 'export-verify-status error';
        dom.linearImportVerifyStatus.textContent = 'Please enter an API key first';
        return;
    }
    verifyConnection('/api/export/linear/verify', { apiKey }, dom.linearImportVerifyStatus, dom.linearImportVerifyBtn);
};

// ==================== Fetch from Linear ====================

export const fetchFromLinear = async () => {
    const apiKey = dom.linearImportApiKey.value.trim();
    const teamKey = dom.linearImportTeamKey.value.trim();

    if (!apiKey || !teamKey) {
        dom.linearImportVerifyStatus.className = 'export-verify-status error';
        dom.linearImportVerifyStatus.textContent = 'Please fill in all fields';
        return;
    }

    linearImportState.fetching = true;
    dom.linearImportFetchBtn.disabled = true;
    dom.linearImportProgress.classList.remove('hidden');
    dom.linearImportProgressItems.innerHTML = '';
    dom.linearImportProgressBar.style.width = '0';
    dom.linearImportProgressBar.classList.add('indeterminate');

    const addLine = (text, cls) => {
        const line = document.createElement('div');
        line.className = 'import-progress-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        dom.linearImportProgressItems.append(line);
        dom.linearImportProgressItems.scrollTop = dom.linearImportProgressItems.scrollHeight;
    };

    addLine('Connecting to Linear...');

    let response;
    try {
        response = await fetch('/api/import/linear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, teamKey })
        });
    } catch (e) {
        addLine(`Connection failed: ${e.message}`, 'error');
        dom.linearImportProgressBar.classList.remove('indeterminate');
        linearImportState.fetching = false;
        dom.linearImportFetchBtn.disabled = false;
        return;
    }

    if (!response.ok) {
        try {
            const err = await response.json();
            addLine(err.error || `HTTP ${response.status}`, 'error');
        } catch {
            addLine(`HTTP ${response.status}`, 'error');
        }
        dom.linearImportProgressBar.classList.remove('indeterminate');
        linearImportState.fetching = false;
        dom.linearImportFetchBtn.disabled = false;
        return;
    }

    await readSSE(response,
        (eventType, data) => {
            if (data.phase === 'team') {
                addLine('Finding team...');
            } else if (data.phase === 'issues') {
                addLine(`Fetching issues... ${data.fetched}`);
            }
        },
        (data) => {
            dom.linearImportProgressBar.classList.remove('indeterminate');
            dom.linearImportProgressBar.style.width = '100%';
            addLine(`Found ${data.issueCount} issues`, 'success');
            linearImportState.rawIssues = data.issues || [];
            linearImportState.projects = data.projects || [];
            linearImportState.teamKey = data.teamKey || teamKey;
            linearImportState.teamName = data.teamName || '';
            linearImportState.mappingMode = linearImportState.projects.length >= 2 ? 'project' : 'parent';
            linearImportState.fetching = false;
            regroupLinearData();
            showLinearImportStage2();
        },
        (data) => {
            dom.linearImportProgressBar.classList.remove('indeterminate');
            addLine(data.error || 'Unknown error from Linear', 'error');
            linearImportState.fetching = false;
            dom.linearImportFetchBtn.disabled = false;
        }
    );

    // If stream ended without done event
    if (linearImportState.fetching) {
        linearImportState.fetching = false;
        dom.linearImportFetchBtn.disabled = false;
    }
};

// ==================== Stage Navigation ====================

export const showLinearImportStage1 = () => {
    dom.linearImportStage2.classList.add('hidden');
    dom.linearImportFetchBtn.disabled = false;
    if (linearImportState.mode === 'csv') {
        dom.linearImportStage1.classList.add('hidden');
        dom.linearCsvImportStage1.classList.remove('hidden');
        dom.linearImportTitle.textContent = 'Import from Linear CSV';
    } else {
        dom.linearImportStage1.classList.remove('hidden');
        dom.linearCsvImportStage1.classList.add('hidden');
        dom.linearImportTitle.textContent = 'Import from Linear';
    }
};

const linearPreviewDomRefs = () => ({
    previewHeader: dom.linearImportPreviewHeader,
    preview: dom.linearImportPreview
});

const linearMappingLabels = () => linearImportState.mappingMode === 'project'
    ? { groupLabel: linearImportState.epics.length !== 1 ? 'projects' : 'project', itemLabel: linearImportState.epics.reduce((n, e) => n + e.stories.length, 0) !== 1 ? 'issues' : 'issue' }
    : { groupLabel: linearImportState.epics.length !== 1 ? 'parent issues' : 'parent issue', itemLabel: linearImportState.epics.reduce((n, e) => n + e.stories.length, 0) !== 1 ? 'sub-issues' : 'sub-issue' };

const linearUpdateCount = () => updateImportCount(linearImportState.epics, dom.linearImportCount, linearMappingLabels());

const showLinearImportStage2 = () => {
    dom.linearImportStage1.classList.add('hidden');
    dom.linearCsvImportStage1.classList.add('hidden');
    dom.linearImportStage2.classList.remove('hidden');
    dom.linearImportTitle.textContent = 'Review Import';

    // Show import mode toggle only when importing into an existing map
    if (state.mapLoaded) {
        dom.linearImportMode.classList.remove('hidden');
        dom.linearImportMode.querySelector('input[value="append"]').checked = true;
    } else {
        dom.linearImportMode.classList.add('hidden');
    }

    // Show mapping mode toggle (always visible for Linear)
    const toggle = dom.linearImportMappingMode;
    toggle.classList.remove('hidden');
    // Sync radio buttons with current state
    const radios = toggle.querySelectorAll('input[name="linearMappingMode"]');
    for (const r of radios) r.checked = (r.value === linearImportState.mappingMode);

    renderImportPreview(linearImportState.epics, linearImportState.teamName, linearPreviewDomRefs(), linearUpdateCount, linearMappingLabels());
    linearUpdateCount();
};

// ==================== Mapping Mode Toggle ====================

export const handleLinearMappingModeChange = (value) => {
    if (value === linearImportState.mappingMode) return;
    linearImportState.mappingMode = value;
    regroupLinearData();
    renderImportPreview(linearImportState.epics, linearImportState.teamName, linearPreviewDomRefs(), linearUpdateCount, linearMappingLabels());
    linearUpdateCount();
};

// ==================== Confirm Import ====================

export const confirmLinearImport = () => {
    const isProject = linearImportState.mappingMode === 'project';
    const sliceLabel = isProject ? 'IMPORTED: Projects & issues' : 'IMPORTED: Parent issues & sub-issues';
    const entityName = isProject ? 'project' : 'parent';

    const buildUrlFn = (key) => {
        // key is an issue identifier like "JAC-5" or a project ID
        const issue = linearImportState.rawIssues.find(i => i.identifier === key);
        if (issue) return issue.url || '';
        const project = linearImportState.projects.find(p => p.id === key);
        if (project) return project.url || '';
        return '';
    };

    const data = buildStorymapFromImport(
        linearImportState.epics,
        linearImportState.teamName,
        buildUrlFn,
        { sliceLabel, entityName }
    );
    if (data.steps.length === 0) return;
    const mode = dom.linearImportMode?.querySelector('input:checked')?.value || 'replace';
    hideLinearImportModal();
    onImportComplete(data, { mode });
};

// ==================== Linear CSV Parsing ====================

const mapLinearCsvStatus = (status, completed) => {
    if (completed) return 'done';
    if (!status) return 'planned';
    const s = status.toLowerCase().trim();
    if (s === 'done' || s === 'completed' || s === 'cancelled' || s === 'canceled') return 'done';
    if (s === 'in progress' || s === 'in review') return 'in-progress';
    return 'planned';
};

const parseLinearCsv = (csvText) => {
    const rows = parseCsv(csvText);
    if (rows.length < 2) return { issues: [], projects: [], teamKey: '', teamName: '' };

    const headers = rows[0].map(h => h.trim());
    const col = (name) => headers.indexOf(name);

    const iTitle = col('Title');
    if (iTitle === -1) {
        throw new Error('Missing required column: Title');
    }

    const iId = col('ID');
    const iStatus = col('Status');
    const iEstimate = col('Estimate');
    const iLabels = col('Labels');
    const iProject = col('Project');
    const iParent = col('Parent issue');
    const iCompleted = col('Completed');
    const iDescription = col('Description');

    // First pass: collect all issues
    const allIssues = [];
    const projectSet = new Set();
    let teamKey = '';

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const title = (row[iTitle] || '').trim();
        if (!title) continue;

        const identifier = iId !== -1 ? (row[iId] || '').trim() : '';
        const status = iStatus !== -1 ? (row[iStatus] || '').trim() : '';
        const estimate = iEstimate !== -1 ? parseFloat(row[iEstimate]) : NaN;
        const labelsRaw = iLabels !== -1 ? (row[iLabels] || '').trim() : '';
        const project = iProject !== -1 ? (row[iProject] || '').trim() : '';
        const parentIssue = iParent !== -1 ? (row[iParent] || '').trim() : '';
        const completed = iCompleted !== -1 ? (row[iCompleted] || '').trim() : '';
        const description = iDescription !== -1 ? (row[iDescription] || '').trim() : '';

        // Extract team key from identifier (e.g., "JAC-5" -> "JAC")
        if (!teamKey && identifier && identifier.includes('-')) {
            teamKey = identifier.split('-')[0];
        }

        if (project) projectSet.add(project);

        allIssues.push({
            id: identifier || title,
            identifier,
            summary: title,
            description: description || undefined,
            status: mapLinearCsvStatus(status, completed),
            points: isNaN(estimate) ? undefined : estimate,
            labels: labelsRaw ? labelsRaw.split(',').map(l => l.trim()).filter(Boolean) : [],
            projectName: project || undefined,
            parentIdentifier: parentIssue || undefined,
            hasChildren: false // computed in second pass
        });
    }

    // Second pass: mark parents
    const identifierSet = new Set(allIssues.map(i => i.identifier).filter(Boolean));
    for (const issue of allIssues) {
        if (issue.parentIdentifier && identifierSet.has(issue.parentIdentifier)) {
            // Mark the parent
            const parent = allIssues.find(i => i.identifier === issue.parentIdentifier);
            if (parent) parent.hasChildren = true;
            issue.parentId = issue.parentIdentifier;
        }
    }

    const projects = [...projectSet].map(name => ({ id: name, name, url: '' }));

    return {
        issues: allIssues,
        projects,
        teamKey: teamKey || 'Linear',
        teamName: teamKey || 'Linear'
    };
};

// ==================== CSV Import Modal ====================

export const showLinearCsvImportModal = () => {
    linearImportState.epics = [];
    linearImportState.rawIssues = [];
    linearImportState.projects = [];
    linearImportState.teamKey = '';
    linearImportState.teamName = '';
    linearImportState.fetching = false;
    linearImportState.mode = 'csv';
    linearImportState.mappingMode = 'project';
    dom.linearImportStage1.classList.add('hidden');
    dom.linearCsvImportStage1.classList.remove('hidden');
    dom.linearImportStage2.classList.add('hidden');
    dom.linearImportTitle.textContent = 'Import from Linear CSV';
    dom.linearCsvFileInput.value = '';
    dom.linearCsvValidationError.classList.add('hidden');
    dom.linearCsvImportParseBtn.disabled = true;
    dom.linearCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
    dom.linearImportModal.classList.add('visible');
};

export const handleLinearCsvFile = (file) => {
    if (!file) return;
    dom.linearCsvValidationError.classList.add('hidden');
    // Guard: reject files over 20 MB to prevent browser tab hangs
    if (file.size > 20 * 1024 * 1024) {
        dom.linearCsvValidationError.textContent = 'File too large (max 20 MB). Try exporting fewer issues from Linear.';
        dom.linearCsvValidationError.classList.remove('hidden');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const { issues, projects, teamKey, teamName } = parseLinearCsv(e.target.result);
            if (issues.length === 0) {
                dom.linearCsvValidationError.textContent = 'No issues found in CSV. Check that the file has a Title column.';
                dom.linearCsvValidationError.classList.remove('hidden');
                return;
            }
            linearImportState.rawIssues = issues;
            linearImportState.projects = projects;
            linearImportState.teamKey = teamKey;
            linearImportState.teamName = teamName;
            linearImportState.mappingMode = projects.length >= 2 ? 'project' : 'parent';
            regroupLinearData();
            showLinearImportStage2();
        } catch (err) {
            dom.linearCsvValidationError.textContent = err.message;
            dom.linearCsvValidationError.classList.remove('hidden');
        }
    };
    reader.readAsText(file);
};
