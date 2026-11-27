// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Import Modules -- Azure DevOps Import via server proxy + CSV file upload

import { htmlToMarkdown } from '/src/transfer/markup.js';
import { state } from '/src/core/state.js';
import { showConfirm } from '/src/core/modals.js';
import {
    readSSE, verifyConnection,
    renderImportPreview, updateImportCount, buildStorymapFromImport, showImportMode } from '/src/transfer/import-helpers.js';
import { parseCsv } from '/src/transfer/csv.js';
import { azureOrganization, azureProject } from '/src/transfer/export-issues.js';

let dom = null;
let onImportComplete = null;

export const init = (deps) => {
    dom = new Proxy({}, {
        get: (cache, id) => cache[id] ??= document.getElementById(id)
    });
    onImportComplete = deps.onImportComplete;
    AZURE_FIELD_PAIRS.forEach(([organizationId, projectId]) => tidyAzureLink(document.getElementById(organizationId), document.getElementById(projectId)));
};

// The organization field of each window, with the project field beside it
const AZURE_FIELD_PAIRS = [['azureImportOrganization', 'azureImportProject'], ['azureCsvOrganization', 'azureCsvProject'], ['azureProxyOrganization', 'azureProxyProject']];

// People often paste the link from the address bar into the organization field, such as
// dev.azure.com/acme/Web%20Shop. The link becomes the organization name, and the project it
// names goes in the project field: at once when it is pasted, and on leaving the field when it
// was typed. The input events let the fields be remembered and copied to the other Azure
// DevOps windows, as if they had been typed.
export const tidyAzureLink = (organizationField, projectField) => {
    if (!organizationField) return;
    const set = (field, value) => {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const tidy = (text, { fillProject }) => {
        const organization = azureOrganization(text);
        if (!organization || organization === text.trim()) return false;
        set(organizationField, organization);
        const project = azureProject(text);
        if (project && projectField && fillProject) set(projectField, project);
        return true;
    };
    organizationField.addEventListener('paste', (e) => {
        const pasted = e.clipboardData?.getData('text') || '';
        // Only a link pasted over the whole field is tidied; the rest pastes as usual
        const wholeField = organizationField.selectionStart === 0 && organizationField.selectionEnd === organizationField.value.length;
        if (wholeField && tidy(pasted, { fillProject: true })) e.preventDefault();
    });
    // Moving straight on to the project field means the project is about to be typed, so it is
    // left alone: filling it at that moment would put the typing after the filled-in name.
    organizationField.addEventListener('focusout', (e) => {
        tidy(organizationField.value, { fillProject: e.relatedTarget !== projectField });
    });
};

// ==================== Work items ====================


// A state by its name, for files and for states the project didn't describe. Each process
// has its own names: New, Active and Closed, or To Do, Doing and Done, and so on.
export const statusFromState = (stateName) => {
    const s = String(stateName || '').toLowerCase().trim();
    if (s === 'removed' || s === 'cut') return 'removed';
    if (s === 'done' || s === 'closed' || s === 'completed') return 'done';
    if (['active', 'doing', 'in progress', 'committed', 'resolved', 'ready', 'in review'].includes(s)) return 'in-progress';
    return 'planned';
};

const isType = (item, name) => String(item.type || '').toLowerCase() === name;

// Group a plain list of work items under their epics. A work item belongs to the epic above
// it, however many features or stories sit in between. Removed work is left out, and so is a
// task that sits under a story, bug or other backlog item: it is part of that item.
export const groupWorkItems = (items) => {
    const live = items
        .map(item => ({ ...item, status: item.status || statusFromState(item.state) }))
        .filter(item => item.status !== 'removed');
    const byId = new Map(live.map(item => [String(item.id), item]));
    const parentOf = (item) => (item.parentId != null ? byId.get(String(item.parentId)) : null);

    const epicOf = (item) => {
        let parent = parentOf(item);
        for (let depth = 0; parent && depth < 10; depth++) {
            if (isType(parent, 'epic')) return parent;
            parent = parentOf(parent);
        }
        return null;
    };

    const groups = new Map();
    live.filter(item => isType(item, 'epic')).forEach(epic => {
        groups.set(epic, {
            key: String(epic.id), summary: epic.title, status: epic.status, ...(epic.state && { stateName: epic.state }),
            description: htmlToMarkdown(epic.description) || undefined, stories: [],
        });
    });

    const orphans = [];
    live.forEach(item => {
        if (isType(item, 'epic')) return;
        const parent = parentOf(item);
        if (isType(item, 'task') && parent && !isType(parent, 'epic') && !isType(parent, 'feature')) return;
        const story = {
            key: String(item.id),
            summary: item.title,
            type: item.type || undefined,
            status: item.status,
            ...(item.state && { stateName: item.state }),
            description: htmlToMarkdown(item.description) || undefined,
            points: item.points != null ? item.points : undefined,
            labels: item.tags || [],
        };
        const epic = epicOf(item);
        if (epic) groups.get(epic).stories.push(story);
        else orphans.push(story);
    });

    const epics = [...groups.values()];
    // Work items with no epic go in a group of their own, with no key
    if (orphans.length > 0) epics.push({ key: null, summary: 'No epic', stories: orphans });
    return epics;
};

// ==================== Azure DevOps Import State ====================

const azureImportState = {
    epics: [],
    projectName: '',
    organization: '',
    project: '',
    fetching: false,
    mode: 'api'         // 'api' | 'csv'
};

const CSV_TITLE = 'Import from Azure DevOps CSV';
const API_TITLE = 'Import from Azure DevOps';
const DROP_TEXT = 'Drop .csv file here or click to browse';

const resetState = (mode) => {
    Object.assign(azureImportState, { epics: [], projectName: '', organization: '', project: '', fetching: false, mode });
};

// ==================== Modal Lifecycle ====================

export const showAzureImportModal = () => {
    resetState('api');
    dom.azureImportStage1.classList.remove('hidden');
    dom.azureCsvImportStage1.classList.add('hidden');
    dom.azureImportStage2.classList.add('hidden');
    dom.azureImportTitle.textContent = API_TITLE;
    dom.azureImportProgress.classList.add('hidden');
    dom.azureImportProgressItems.innerHTML = '';
    dom.azureImportProgressBar.style.width = '0';
    dom.azureImportFetchBtn.disabled = false;
    dom.azureImportVerifyStatus.textContent = 'Optional - test before fetching';
    dom.azureImportVerifyStatus.className = 'export-verify-status';
    dom.azureImportVerifyBtn.disabled = false;
    dom.azureImportModal.classList.add('visible');
};

export const hideAzureImportModal = () => {
    dom.azureImportModal.classList.remove('visible');
    // Clear credentials from DOM
    dom.azureImportToken.value = '';
    // Clear CSV state
    dom.azureCsvFileInput.value = '';
    dom.azureCsvFileInput._droppedFile = null;
    dom.azureCsvValidationError.classList.add('hidden');
    dom.azureCsvImportParseBtn.disabled = true;
    dom.azureCsvDropzone.querySelector('span').textContent = DROP_TEXT;
};

export const confirmCloseAzureImportModal = async () => {
    if (azureImportState.fetching) {
        if (await showConfirm('A fetch is in progress. Close anyway?')) {
            hideAzureImportModal();
        }
    } else if (await showConfirm('Close import dialog?')) {
        hideAzureImportModal();
    }
};

// ==================== Verify ====================

const credentials = () => ({
    organization: azureOrganization(dom.azureImportOrganization.value),
    project: dom.azureImportProject.value.trim(),
    token: dom.azureImportToken.value.trim(),
});

export const verifyAzureImport = () => {
    const body = credentials();
    if (!body.organization || !body.project || !body.token) {
        dom.azureImportVerifyStatus.className = 'export-verify-status error';
        dom.azureImportVerifyStatus.textContent = 'Please fill in all fields first';
        return;
    }
    verifyConnection('/api/export/azure-devops/verify', body, dom.azureImportVerifyStatus, dom.azureImportVerifyBtn);
};

// ==================== Fetch from Azure DevOps ====================

export const fetchFromAzure = async () => {
    const body = credentials();
    if (!body.organization || !body.project || !body.token) {
        dom.azureImportVerifyStatus.className = 'export-verify-status error';
        dom.azureImportVerifyStatus.textContent = 'Please fill in all fields';
        return;
    }

    azureImportState.fetching = true;
    dom.azureImportFetchBtn.disabled = true;
    dom.azureImportProgress.classList.remove('hidden');
    dom.azureImportProgressItems.innerHTML = '';
    dom.azureImportProgressBar.style.width = '0';
    dom.azureImportProgressBar.classList.add('indeterminate');

    const addLine = (text, cls) => {
        const line = document.createElement('div');
        line.className = 'import-progress-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        dom.azureImportProgressItems.append(line);
        dom.azureImportProgressItems.scrollTop = dom.azureImportProgressItems.scrollHeight;
    };
    const stop = (text) => {
        addLine(text, 'error');
        dom.azureImportProgressBar.classList.remove('indeterminate');
        azureImportState.fetching = false;
        dom.azureImportFetchBtn.disabled = false;
    };

    addLine('Connecting to Azure DevOps...');

    let response;
    try {
        response = await fetch('/api/import/azure-devops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {
        stop(`Connection failed: ${e.message}`);
        return;
    }

    if (!response.ok) {
        try {
            const err = await response.json();
            stop(err.error || `HTTP ${response.status}`);
        } catch {
            stop(`HTTP ${response.status}`);
        }
        return;
    }

    await readSSE(response,
        (eventType, data) => {
            if (data.phase === 'items' && data.total) addLine(`Fetching work items... ${data.fetched} of ${data.total}`);
        },
        (data) => {
            dom.azureImportProgressBar.classList.remove('indeterminate');
            dom.azureImportProgressBar.style.width = '100%';
            azureImportState.epics = groupWorkItems(data.items || []);
            azureImportState.projectName = data.project || body.project;
            azureImportState.organization = data.organization || body.organization;
            azureImportState.project = data.project || body.project;
            azureImportState.fetching = false;
            const epicCount = azureImportState.epics.filter(epic => epic.key).length;
            const itemCount = azureImportState.epics.reduce((n, epic) => n + epic.stories.length, 0);
            if (epicCount + itemCount === 0) {
                stop('No work items found in this project');
                return;
            }
            addLine(`Found ${epicCount} epics, ${itemCount} work items`, 'success');
            // Auto-advance to preview
            showAzureImportStage2();
        },
        (data) => stop(data.error || 'Unknown error from Azure DevOps')
    );

    // If stream ended without done event
    if (azureImportState.fetching) {
        azureImportState.fetching = false;
        dom.azureImportFetchBtn.disabled = false;
    }
};

// ==================== Stage Navigation ====================

export const showAzureImportStage1 = () => {
    dom.azureImportStage2.classList.add('hidden');
    dom.azureImportFetchBtn.disabled = false;
    const csv = azureImportState.mode === 'csv';
    dom.azureImportStage1.classList.toggle('hidden', csv);
    dom.azureCsvImportStage1.classList.toggle('hidden', !csv);
    dom.azureImportTitle.textContent = csv ? CSV_TITLE : API_TITLE;
};

const azurePreviewDomRefs = () => ({
    previewHeader: dom.azureImportPreviewHeader,
    mode: dom.azureImportMode,
    preview: dom.azureImportPreview
});

// Azure DevOps's own words for the groups, the cards and the first status
const azureWords = { group: ['epic', 'epics'], item: ['work item', 'work items'], entityName: 'epic', statusNames: { planned: 'New' } };

// The review step names each status the way this project does: To Do, Doing and Done in one
// process, New, Active and Closed in another. A status that covers more than one state, such
// as Active and Resolved, lists them all.
export const azureStateNames = (epics) => {
    const names = {};
    epics.flatMap(epic => [epic, ...epic.stories]).forEach(row => {
        if (!row.stateName || !row.status) return;
        (names[row.status] ??= new Set()).add(row.stateName);
    });
    return Object.fromEntries(Object.entries(names).map(([status, states]) => [status, [...states].join(', ')]));
};
const azureReviewWords = () => ({ ...azureWords, statusNames: { ...azureWords.statusNames, ...azureStateNames(azureImportState.epics) } });

const azureUpdateCount = () => updateImportCount(azureImportState.epics, dom.azureImportCount, azureWords);

const showAzureImportStage2 = () => {
    dom.azureImportStage1.classList.add('hidden');
    dom.azureCsvImportStage1.classList.add('hidden');
    dom.azureImportStage2.classList.remove('hidden');
    dom.azureImportTitle.textContent = 'Review Import';
    showImportMode(dom.azureImportMode);
    renderImportPreview(azureImportState.epics, azureImportState.projectName, azurePreviewDomRefs(), azureUpdateCount, azureReviewWords());
    azureUpdateCount();
};

// ==================== Confirm Import ====================

// The link to a work item, when the organization and the project are known
export const azureItemUrl = (organization, project, id) =>
    (organization && project && id ? `https://dev.azure.com/${organization}/${encodeURIComponent(project)}/_workitems/edit/${id}` : '');

export const confirmAzureImport = () => {
    const { organization, project } = azureImportState;
    const data = buildStorymapFromImport(
        azureImportState.epics,
        azureImportState.projectName,
        (id) => azureItemUrl(organization, project, id),
        azureWords
    );
    if (data.steps.length === 0) return;
    const mode = dom.azureImportMode?.querySelector('input:checked')?.value || 'replace';
    hideAzureImportModal();
    onImportComplete(data, { mode });
};

// ==================== Azure DevOps CSV Parsing ====================

// A query in Azure DevOps exports the columns it shows. A flat list has one Title column. A
// tree of work items has Title 1, Title 2 and so on, one for each level, and the level says
// which work item is the parent when the file has no Parent column.
export const parseAzureCsv = (csvText) => {
    const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
    if (rows.length < 2) return { items: [], projectName: '' };

    const headers = rows[0].map(h => h.trim());
    const col = (...names) => headers.findIndex(h => names.includes(h.toLowerCase()));

    const iId = col('id');
    const iType = col('work item type');
    const titleColumns = headers
        .map((h, i) => ({ i, level: /^title( \d+)?$/i.test(h) ? Number(h.split(' ')[1] || 1) : 0 }))
        .filter(c => c.level)
        .sort((a, b) => a.level - b.level);
    if (iId === -1 || iType === -1 || !titleColumns.length) {
        throw new Error('Missing required columns: ID, Work Item Type, Title');
    }

    const iState = col('state');
    const iTags = col('tags');
    const iDescription = col('description');
    const iParent = col('parent');
    const iPoints = col('story points', 'effort', 'size');
    const iProject = col('team project');
    const iArea = col('area path');
    const cell = (row, i) => (i === -1 ? '' : (row[i] || '').trim());

    const items = [];
    const lastAtLevel = [];
    let projectName = '';
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const id = cell(row, iId);
        const titleColumn = titleColumns.find(c => cell(row, c.i));
        if (!id || !titleColumn) continue;

        if (!projectName) projectName = cell(row, iProject) || cell(row, iArea).split('\\')[0];
        const level = titleColumn.level;
        lastAtLevel.length = level;
        lastAtLevel[level - 1] = id;
        const points = parseFloat(cell(row, iPoints));

        items.push({
            id,
            title: cell(row, titleColumn.i),
            type: cell(row, iType),
            state: cell(row, iState),
            description: cell(row, iDescription) || undefined,
            tags: cell(row, iTags).split(';').map(tag => tag.trim()).filter(Boolean),
            points: isNaN(points) ? undefined : points,
            parentId: cell(row, iParent) || (level > 1 ? lastAtLevel[level - 2] : undefined),
        });
    }

    return { items, projectName };
};

// ==================== CSV Import Modal ====================

export const showAzureCsvImportModal = () => {
    resetState('csv');
    dom.azureImportStage1.classList.add('hidden');
    dom.azureCsvImportStage1.classList.remove('hidden');
    dom.azureImportStage2.classList.add('hidden');
    dom.azureImportTitle.textContent = CSV_TITLE;
    dom.azureCsvFileInput.value = '';
    dom.azureCsvValidationError.classList.add('hidden');
    dom.azureCsvImportParseBtn.disabled = true;
    dom.azureCsvDropzone.querySelector('span').textContent = DROP_TEXT;
    dom.azureImportModal.classList.add('visible');
};

export const handleAzureCsvFile = (file) => {
    if (!file) return;
    const showError = (text) => {
        dom.azureCsvValidationError.textContent = text;
        dom.azureCsvValidationError.classList.remove('hidden');
    };
    dom.azureCsvValidationError.classList.add('hidden');
    // Guard: reject files over 20 MB to prevent browser tab hangs
    if (file.size > 20 * 1024 * 1024) {
        showError('File too large (max 20 MB). Try exporting fewer work items from Azure DevOps.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const { items, projectName } = parseAzureCsv(e.target.result);
            const epics = groupWorkItems(items);
            if (epics.length === 0) {
                showError('No work items found in CSV. Check that the file has ID, Work Item Type and Title columns.');
                return;
            }
            azureImportState.epics = epics;
            azureImportState.organization = azureOrganization(dom.azureCsvOrganization.value);
            azureImportState.project = dom.azureCsvProject.value.trim() || projectName;
            azureImportState.projectName = azureImportState.project || 'Azure DevOps';
            // Advance to stage 2
            showAzureImportStage2();
        } catch (err) {
            showError(err.message);
        }
    };
    reader.readAsText(file);
};
