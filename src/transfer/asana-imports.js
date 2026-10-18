// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Import Modules -- Asana Import via server proxy + CSV file upload

import { state } from '/src/core/state.js';
import { showConfirm } from '/src/core/modals.js';
import { extractAsanaProjectGid } from '/src/transfer/exports.js';
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

// ==================== Asana Import State ====================

const asanaImportState = {
    epics: [],           // currently displayed grouping (for preview + confirm)
    rawTasks: [],        // raw epics from server (tasks with subtasks + section info)
    sections: [],        // ordered section list from server
    projectKey: '',
    fetching: false,
    mode: 'api',         // 'api' | 'csv'
    mappingMode: 'tasks' // 'tasks' | 'sections'
};

// ==================== Regrouping ====================

const regroupAsanaData = () => {
    const { rawTasks, sections, mappingMode } = asanaImportState;
    if (mappingMode === 'sections' && sections.length >= 2) {
        // Group rawTasks by section; each section becomes an epic, each task becomes a story
        const sectionMap = new Map();
        for (const s of sections) sectionMap.set(s.gid, { ...s, tasks: [] });
        const unsectioned = [];
        for (const task of rawTasks) {
            const bucket = task.sectionGid ? sectionMap.get(task.sectionGid) : null;
            if (bucket) {
                bucket.tasks.push(task);
            } else {
                unsectioned.push(task);
            }
        }
        const epics = [];
        for (const s of sections) {
            const bucket = sectionMap.get(s.gid);
            if (bucket.tasks.length === 0) continue;
            epics.push({
                key: s.gid,
                summary: s.name,
                stories: bucket.tasks.map(t => ({
                    key: t.key,
                    summary: t.summary,
                    description: t.description,
                    status: t.status
                }))
            });
        }
        if (unsectioned.length) {
            epics.push({
                key: '_unsectioned',
                summary: '(No section)',
                stories: unsectioned.map(t => ({
                    key: t.key,
                    summary: t.summary,
                    description: t.description,
                    status: t.status
                }))
            });
        }
        asanaImportState.epics = epics;
    } else {
        // Default: group by tasks & subtasks
        asanaImportState.epics = rawTasks;
    }
};

// ==================== Modal Lifecycle ====================

export const showAsanaImportModal = () => {
    asanaImportState.epics = [];
    asanaImportState.rawTasks = [];
    asanaImportState.sections = [];
    asanaImportState.projectKey = '';
    asanaImportState.fetching = false;
    asanaImportState.mode = 'api';
    asanaImportState.mappingMode = 'tasks';
    dom.asanaImportStage1.classList.remove('hidden');
    dom.asanaCsvImportStage1.classList.add('hidden');
    dom.asanaImportStage2.classList.add('hidden');
    dom.asanaImportTitle.textContent = 'Import from Asana';
    dom.asanaImportProgress.classList.add('hidden');
    dom.asanaImportProgressItems.innerHTML = '';
    dom.asanaImportProgressBar.style.width = '0';
    dom.asanaImportFetchBtn.disabled = false;
    dom.asanaImportVerifyStatus.textContent = 'Optional - test before fetching';
    dom.asanaImportVerifyStatus.className = 'export-verify-status';
    dom.asanaImportVerifyBtn.disabled = false;
    dom.asanaImportModal.classList.add('visible');
};

export const hideAsanaImportModal = () => {
    dom.asanaImportModal.classList.remove('visible');
    // Clear credentials from DOM
    dom.asanaImportToken.value = '';
    // Clear CSV state
    dom.asanaCsvFileInput.value = '';
    dom.asanaCsvFileInput._droppedFile = null;
    dom.asanaCsvValidationError.classList.add('hidden');
    dom.asanaCsvImportParseBtn.disabled = true;
    dom.asanaCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
};

export const confirmCloseAsanaImportModal = async () => {
    if (asanaImportState.fetching) {
        if (await showConfirm('A fetch is in progress. Close anyway?')) {
            hideAsanaImportModal();
        }
    } else if (await showConfirm('Close import dialog?')) {
        hideAsanaImportModal();
    }
};

// ==================== Verify ====================

export const verifyAsanaImport = () => {
    const token = dom.asanaImportToken.value.trim();
    if (!token) {
        dom.asanaImportVerifyStatus.className = 'export-verify-status error';
        dom.asanaImportVerifyStatus.textContent = 'Please enter an API token first';
        return;
    }
    verifyConnection('/api/export/asana/verify', { token }, dom.asanaImportVerifyStatus, dom.asanaImportVerifyBtn);
};

// ==================== Fetch from Asana ====================

export const fetchFromAsana = async () => {
    const token = dom.asanaImportToken.value.trim();
    const projectUrl = dom.asanaImportProjectUrl.value.trim();
    const projectGid = extractAsanaProjectGid(projectUrl);

    if (!token || !projectUrl) {
        dom.asanaImportVerifyStatus.className = 'export-verify-status error';
        dom.asanaImportVerifyStatus.textContent = 'Please fill in all fields';
        return;
    }
    if (!projectGid) {
        dom.asanaImportVerifyStatus.className = 'export-verify-status error';
        dom.asanaImportVerifyStatus.textContent = 'Could not extract project ID from URL';
        return;
    }

    asanaImportState.fetching = true;
    dom.asanaImportFetchBtn.disabled = true;
    dom.asanaImportProgress.classList.remove('hidden');
    dom.asanaImportProgressItems.innerHTML = '';
    dom.asanaImportProgressBar.style.width = '0';
    dom.asanaImportProgressBar.classList.add('indeterminate');

    const addLine = (text, cls) => {
        const line = document.createElement('div');
        line.className = 'import-progress-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        dom.asanaImportProgressItems.append(line);
        dom.asanaImportProgressItems.scrollTop = dom.asanaImportProgressItems.scrollHeight;
    };

    addLine('Connecting to Asana...');

    let response;
    try {
        response = await fetch('/api/import/asana', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, projectGid })
        });
    } catch (e) {
        addLine(`Connection failed: ${e.message}`, 'error');
        dom.asanaImportProgressBar.classList.remove('indeterminate');
        asanaImportState.fetching = false;
        dom.asanaImportFetchBtn.disabled = false;
        return;
    }

    if (!response.ok) {
        try {
            const err = await response.json();
            addLine(err.error || `HTTP ${response.status}`, 'error');
        } catch {
            addLine(`HTTP ${response.status}`, 'error');
        }
        dom.asanaImportProgressBar.classList.remove('indeterminate');
        asanaImportState.fetching = false;
        dom.asanaImportFetchBtn.disabled = false;
        return;
    }

    await readSSE(response,
        (eventType, data) => {
            if (data.phase === 'project') {
                addLine(`Fetching project info...`);
            } else if (data.phase === 'tasks') {
                addLine(`Fetching tasks... ${data.fetched}`);
            } else if (data.phase === 'subtasks') {
                addLine(`Fetching subtasks... ${data.fetched}`);
            }
        },
        (data) => {
            dom.asanaImportProgressBar.classList.remove('indeterminate');
            dom.asanaImportProgressBar.style.width = '100%';
            addLine(`Found ${data.taskCount} tasks, ${data.subtaskCount} subtasks`, 'success');
            asanaImportState.rawTasks = data.epics || [];
            asanaImportState.sections = data.sections || [];
            asanaImportState.projectKey = data.projectName || '';
            asanaImportState.mappingMode = asanaImportState.sections.length >= 2 ? 'sections' : 'tasks';
            asanaImportState.fetching = false;
            regroupAsanaData();
            showAsanaImportStage2();
        },
        (data) => {
            dom.asanaImportProgressBar.classList.remove('indeterminate');
            addLine(data.error || 'Unknown error from Asana', 'error');
            asanaImportState.fetching = false;
            dom.asanaImportFetchBtn.disabled = false;
        }
    );

    // If stream ended without done event
    if (asanaImportState.fetching) {
        asanaImportState.fetching = false;
        dom.asanaImportFetchBtn.disabled = false;
    }
};

// ==================== Stage Navigation ====================

export const showAsanaImportStage1 = () => {
    dom.asanaImportStage2.classList.add('hidden');
    dom.asanaImportFetchBtn.disabled = false;
    if (asanaImportState.mode === 'csv') {
        dom.asanaImportStage1.classList.add('hidden');
        dom.asanaCsvImportStage1.classList.remove('hidden');
        dom.asanaImportTitle.textContent = 'Import from Asana CSV';
    } else {
        dom.asanaImportStage1.classList.remove('hidden');
        dom.asanaCsvImportStage1.classList.add('hidden');
        dom.asanaImportTitle.textContent = 'Import from Asana';
    }
};

const asanaPreviewDomRefs = () => ({
    previewHeader: dom.asanaImportPreviewHeader,
    preview: dom.asanaImportPreview
});

const asanaMappingLabels = () => asanaImportState.mappingMode === 'sections'
    ? { groupLabel: asanaImportState.epics.length !== 1 ? 'sections' : 'section', itemLabel: asanaImportState.epics.reduce((n, e) => n + e.stories.length, 0) !== 1 ? 'tasks' : 'task' }
    : {};

const asanaUpdateCount = () => updateImportCount(asanaImportState.epics, dom.asanaImportCount, asanaMappingLabels());

const showAsanaImportStage2 = () => {
    dom.asanaImportStage1.classList.add('hidden');
    dom.asanaCsvImportStage1.classList.add('hidden');
    dom.asanaImportStage2.classList.remove('hidden');
    dom.asanaImportTitle.textContent = 'Review Import';

    // Show import mode toggle only when importing into an existing map
    if (state.mapLoaded) {
        dom.asanaImportMode.classList.remove('hidden');
        dom.asanaImportMode.querySelector('input[value="append"]').checked = true;
    } else {
        dom.asanaImportMode.classList.add('hidden');
    }

    // Show/hide mapping mode toggle
    const toggle = dom.asanaImportMappingMode;
    if (asanaImportState.sections.length >= 2) {
        toggle.classList.remove('hidden');
        // Sync radio buttons with current state
        const radios = toggle.querySelectorAll('input[name="asanaMappingMode"]');
        for (const r of radios) r.checked = (r.value === asanaImportState.mappingMode);
    } else {
        toggle.classList.add('hidden');
    }

    renderImportPreview(asanaImportState.epics, asanaImportState.projectKey, asanaPreviewDomRefs(), asanaUpdateCount, asanaMappingLabels());
    asanaUpdateCount();
};

// ==================== Mapping Mode Toggle ====================

export const handleAsanaMappingModeChange = (value) => {
    if (value === asanaImportState.mappingMode) return;
    asanaImportState.mappingMode = value;
    regroupAsanaData();
    renderImportPreview(asanaImportState.epics, asanaImportState.projectKey, asanaPreviewDomRefs(), asanaUpdateCount, asanaMappingLabels());
    asanaUpdateCount();
};

// ==================== Confirm Import ====================

export const confirmAsanaImport = () => {
    const isSections = asanaImportState.mappingMode === 'sections';
    const sliceLabel = isSections ? 'IMPORTED: Sections & tasks' : 'IMPORTED: Epics & stories';
    const entityName = isSections ? 'section' : 'epic';
    const data = buildStorymapFromImport(
        asanaImportState.epics,
        asanaImportState.projectKey,
        (key) => (key && /^\d+$/.test(key)) ? `https://app.asana.com/0/0/${key}` : '',
        { sliceLabel, entityName }
    );
    if (data.steps.length === 0) return;
    const mode = dom.asanaImportMode?.querySelector('input:checked')?.value || 'replace';
    hideAsanaImportModal();
    onImportComplete(data, { mode });
};

// ==================== Asana CSV Parsing ====================

const parseAsanaCsv = (csvText) => {
    const rows = parseCsv(csvText);
    if (rows.length < 2) return { epics: [], projectKey: '' };

    const headers = rows[0].map(h => h.trim());
    const col = (name) => headers.indexOf(name);

    const iName = col('Name');
    if (iName === -1) {
        throw new Error('Missing required column: Name');
    }

    const iNotes = col('Notes');
    const iCompletedAt = col('Completed At');
    const iTaskId = col('Task ID');
    const iParentTask = col('Parent Task');
    const iSection = col('Section/Column');

    // First pass: index all rows as tasks, identify parent/child
    const taskMap = new Map(); // name -> epic object (for parent tasks)
    const taskOrder = [];      // ordered list of parent task names
    const subtaskRows = [];    // rows with a parent
    const sectionOrder = [];   // unique section names in order of first appearance
    const sectionSet = new Set();

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const name = (row[iName] || '').trim();
        if (!name) continue;

        const notes = iNotes !== -1 ? (row[iNotes] || '').trim() : '';
        const completedAt = iCompletedAt !== -1 ? (row[iCompletedAt] || '').trim() : '';
        const taskId = iTaskId !== -1 ? (row[iTaskId] || '').trim() : '';
        const parentTask = iParentTask !== -1 ? (row[iParentTask] || '').trim() : '';
        const sectionName = iSection !== -1 ? (row[iSection] || '').trim() : '';
        const status = completedAt ? 'done' : 'planned';

        if (parentTask) {
            // This is a subtask
            subtaskRows.push({ name, notes, taskId, status, parentTask });
        } else {
            // Track section order
            if (sectionName && !sectionSet.has(sectionName)) {
                sectionSet.add(sectionName);
                sectionOrder.push(sectionName);
            }
            // This is a top-level task (becomes a step/epic)
            if (!taskMap.has(name)) {
                taskMap.set(name, {
                    key: taskId || name,
                    summary: name,
                    description: notes || undefined,
                    status,
                    sectionGid: sectionName, // use name as gid for CSV
                    sectionName,
                    stories: []
                });
                taskOrder.push(name);
            }
        }
    }

    // Second pass: assign subtasks to their parent tasks
    for (const sub of subtaskRows) {
        const parent = taskMap.get(sub.parentTask);
        if (parent) {
            parent.stories.push({
                key: sub.taskId || '',
                summary: sub.name,
                status: sub.status,
                description: sub.notes || undefined
            });
        }
        // Subtasks whose parent isn't found are dropped (parent not in this project)
    }

    const epics = taskOrder.map(name => taskMap.get(name));
    const sections = sectionOrder.map(name => ({ gid: name, name }));

    return { epics, sections, projectKey: 'Asana' };
};

// ==================== CSV Import Modal ====================

export const showAsanaCsvImportModal = () => {
    asanaImportState.epics = [];
    asanaImportState.rawTasks = [];
    asanaImportState.sections = [];
    asanaImportState.projectKey = '';
    asanaImportState.fetching = false;
    asanaImportState.mode = 'csv';
    asanaImportState.mappingMode = 'tasks';
    dom.asanaImportStage1.classList.add('hidden');
    dom.asanaCsvImportStage1.classList.remove('hidden');
    dom.asanaImportStage2.classList.add('hidden');
    dom.asanaImportTitle.textContent = 'Import from Asana CSV';
    dom.asanaCsvFileInput.value = '';
    dom.asanaCsvValidationError.classList.add('hidden');
    dom.asanaCsvImportParseBtn.disabled = true;
    dom.asanaCsvDropzone.querySelector('span').textContent = 'Drop .csv file here or click to browse';
    dom.asanaImportModal.classList.add('visible');
};

export const handleAsanaCsvFile = (file) => {
    if (!file) return;
    dom.asanaCsvValidationError.classList.add('hidden');
    // Guard: reject files over 20 MB to prevent browser tab hangs
    if (file.size > 20 * 1024 * 1024) {
        dom.asanaCsvValidationError.textContent = 'File too large (max 20 MB). Try exporting fewer tasks from Asana.';
        dom.asanaCsvValidationError.classList.remove('hidden');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const { epics, sections, projectKey } = parseAsanaCsv(e.target.result);
            if (epics.length === 0) {
                dom.asanaCsvValidationError.textContent = 'No tasks found in CSV. Check that the file has a Name column.';
                dom.asanaCsvValidationError.classList.remove('hidden');
                return;
            }
            asanaImportState.rawTasks = epics;
            asanaImportState.sections = sections || [];
            asanaImportState.projectKey = projectKey;
            asanaImportState.mappingMode = asanaImportState.sections.length >= 2 ? 'sections' : 'tasks';
            regroupAsanaData();
            showAsanaImportStage2();
        } catch (err) {
            dom.asanaCsvValidationError.textContent = err.message;
            dom.asanaCsvValidationError.classList.remove('hidden');
        }
    };
    reader.readAsText(file);
};
