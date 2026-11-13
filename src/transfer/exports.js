// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Export Modules — Jira CSV, Jira API, Phabricator, Asana

import { el } from '/src/core/constants.js';
import { state } from '/src/core/state.js';
import { showConfirm, showAlert } from '/src/core/modals.js';

let dom = null;
let sanitizeFilename = null;

export const init = (deps) => {
    dom = new Proxy({}, {
        get: (cache, id) => cache[id] ??= document.getElementById(id)
    });
    sanitizeFilename = deps.sanitizeFilename;
};

// ==================== Jira CSV Export ====================

export const jiraExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showJiraExportModal = () => {
    populateJiraExportSlices();
    populateJiraExportEpics();
    dom.jiraExportModal.classList.add('visible');
};

export const hideJiraExportModal = () => {
    dom.jiraExportModal.classList.remove('visible');
};

export const confirmCloseJiraExportModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideJiraExportModal();
    }
};

const populateJiraExportSlices = () => {
    const container = document.getElementById('jiraExportSlices');
    container.innerHTML = '';
    jiraExportState.selectedSlices.clear();

    const slices = state.slices;

    slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        jiraExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = el('label', 'export-slice-checkbox checked');
        const checkbox = el('input', null, { type: 'checkbox', checked: true });
        checkbox.dataset.sliceId = slice.id;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                jiraExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                jiraExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateJiraExportEpics();
        });
        const nameSpan = el('span', 'export-slice-name', { text: sliceName });
        const countSpan = el('span', 'export-slice-count', { text: `(${storyCount})` });
        label.append(checkbox, nameSpan, countSpan);
        container.append(label);
    });

    if (slices.length === 0) {
        container.innerHTML = '<span style="color: #666; font-size: 13px;">No releases found</span>';
    }
};

export const populateJiraExportEpics = () => {
    dom.jiraExportEpics.innerHTML = '';
    jiraExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!jiraExportState.selectedSlices.has(slice.id)) return;

            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!jiraExportState.selectedStatuses.has(storyStatus)) return;

                    tasks.push({
                        name: story.name,
                        body: story.body || '',
                        status: story.status || null,
                        url: story.url || null,
                        included: true
                    });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = {
            columnId: column.id,
            name: column.name || `Activity ${colIndex + 1}`,
            type: 'Epic',
            description: '',
            included: true,
            tasks
        };
        jiraExportState.epicData.push(epicData);

        const epicDiv = el('div', 'jira-export-epic');
        epicDiv.dataset.columnId = column.id;

        const header = el('div', 'jira-export-epic-header');

        const checkbox = el('input', 'jira-export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => {
            epicData.included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
        });

        const nameInput = el('input', 'jira-export-epic-name', {
            type: 'text',
            value: epicData.name,
            placeholder: 'Epic name'
        });
        nameInput.addEventListener('input', (e) => {
            epicData.name = e.target.value;
        });

        const typeSelect = el('select', 'jira-export-epic-type', { title: 'Jira issue type' });
        ['Epic', 'Task'].forEach(type => {
            const option = el('option', null, { value: type, text: type });
            typeSelect.append(option);
        });
        typeSelect.addEventListener('change', (e) => {
            epicData.type = e.target.value;
        });

        header.append(checkbox, nameInput, typeSelect);

        const description = el('textarea', 'jira-export-epic-description', {
            placeholder: 'Optional description for this epic...',
            rows: 2
        });
        description.addEventListener('input', (e) => {
            epicData.description = e.target.value;
        });

        const tasksList = el('div', 'jira-export-tasks');
        tasks.forEach((task, taskIndex) => {
            const taskEl = el('label', 'jira-export-task');
            if (task.body) taskEl.dataset.body = task.body;

            const taskCheckbox = el('input', 'jira-export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => {
                task.included = e.target.checked;
                taskEl.classList.toggle('excluded', !e.target.checked);
            });
            taskEl.append(taskCheckbox);

            const nameSpan = el('span', 'jira-export-task-name', { text: task.name });
            taskEl.append(nameSpan);

            const statusClass = task.status === 'done' ? 'done' :
                task.status === 'in-progress' ? 'in-progress' :
                task.status === 'blocked' ? 'blocked' :
                task.status === 'planned' ? 'planned' : 'none';
            const jiraStatus = task.status === 'done' ? dom.jiraStatusDone.value :
                task.status === 'in-progress' ? dom.jiraStatusInProgress.value :
                task.status === 'blocked' ? dom.jiraStatusBlocked.value :
                task.status === 'planned' ? dom.jiraStatusPlanned.value :
                dom.jiraStatusNone.value;
            const statusBadge = el('span', `jira-export-task-status ${statusClass}`, { text: jiraStatus });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });

        epicDiv.append(header, description, tasksList);
        dom.jiraExportEpics.append(epicDiv);
    });

    if (dom.jiraExportEpics.children.length === 0) {
        const emptyMsg = el('p', null, {
            style: 'color: #666; text-align: center; padding: 20px;',
            text: 'No stories to export. Add some stories to your map first, or select more releases above.'
        });
        dom.jiraExportEpics.append(emptyMsg);
    }

    const epicCount = jiraExportState.epicData.length;
    const taskCount = jiraExportState.epicData.reduce((sum, epic) => sum + epic.tasks.length, 0);
    if (dom.jiraExportCount) {
        dom.jiraExportCount.textContent = epicCount > 0 ? `(${epicCount} epics, ${taskCount} tasks)` : '';
    }
};

const escapeCSV = (str) => {
    if (str == null) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
};

const generateJiraCsv = () => {
    const rows = [];
    const projectName = dom.jiraProjectName.value.trim();
    const projectKey = dom.jiraProjectKey.value.trim().toUpperCase();
    const projectType = dom.jiraProjectType.value;
    const childType = 'Task';
    const hasProject = projectName && projectKey;
    const defaultDesc = 'Imported from Storymaps.io';

    const headers = ['Work type', 'Summary', 'Description', 'Work item ID', 'Parent', 'Status', 'Project type'];
    if (hasProject) {
        headers.unshift('Project key');
        headers.unshift('Project name');
    }
    rows.push(headers.map(escapeCSV).join(','));

    let issueId = 1;
    const epicInputs = dom.jiraExportEpics.querySelectorAll('.jira-export-epic');

    epicInputs.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.jira-export-epic-checkbox');
        if (!checkbox.checked) return;

        const epicId = issueId++;
        const nameInput = epicEl.querySelector('.jira-export-epic-name');
        const typeSelect = epicEl.querySelector('.jira-export-epic-type');
        const descTextarea = epicEl.querySelector('.jira-export-epic-description');

        const epicName = nameInput.value || 'Untitled Epic';
        const epicType = typeSelect.value || 'Epic';
        const epicDesc = descTextarea.value || defaultDesc;

        const epicRow = [epicType, epicName, epicDesc, epicId, '', '', projectType];
        if (hasProject) {
            epicRow.unshift(projectKey);
            epicRow.unshift(projectName);
        }
        rows.push(epicRow.map(escapeCSV).join(','));

        const taskEls = epicEl.querySelectorAll('.jira-export-task');
        taskEls.forEach((taskEl) => {
            const taskCheckbox = taskEl.querySelector('.jira-export-task-checkbox');
            if (!taskCheckbox.checked) return;

            const taskName = taskEl.querySelector('.jira-export-task-name')?.textContent || '';
            const statusBadge = taskEl.querySelector('.jira-export-task-status');
            const jiraStatus = statusBadge?.textContent || dom.jiraStatusNone.value;

            const taskDesc = taskEl.dataset.body || defaultDesc;
            const taskRow = [childType, taskName, taskDesc, issueId++, epicId, jiraStatus, projectType];
            if (hasProject) {
                taskRow.unshift(projectKey);
                taskRow.unshift(projectName);
            }
            rows.push(taskRow.map(escapeCSV).join(','));
        });
    });

    return rows.join('\n');
};

export const downloadJiraCsv = () => {
    const csv = generateJiraCsv();
    const filename = sanitizeFilename(state.name || 'story-map') + '-jira.csv';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideJiraExportModal();
};

// ==================== Phabricator Export ====================

export const phabExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showPhabExportModal = () => {
    populatePhabExportSlices();
    populatePhabExportEpics();
    dom.phabStage1.classList.remove('hidden');
    dom.phabStage2.classList.add('hidden');
    dom.phabExportTitle.textContent = 'Step 1: Select Tasks';
    dom.phabExportModal.classList.add('visible');
};

export const hidePhabExportModal = () => {
    dom.phabExportModal.classList.remove('visible');
};

export const confirmClosePhabModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hidePhabExportModal();
    }
};

const populatePhabExportSlices = () => {
    const container = dom.phabExportSlices;
    container.innerHTML = '';
    phabExportState.selectedSlices.clear();

    const slices = state.slices;

    slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        phabExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = el('label', 'export-slice-checkbox checked');
        const checkbox = el('input', null, { type: 'checkbox', checked: true });
        checkbox.dataset.sliceId = slice.id;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                phabExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                phabExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populatePhabExportEpics();
        });
        const nameSpan = el('span', 'export-slice-name', { text: sliceName });
        const countSpan = el('span', 'export-slice-count', { text: `(${storyCount})` });
        label.append(checkbox, nameSpan, countSpan);
        container.append(label);
    });

    if (slices.length === 0) {
        container.innerHTML = '<span style="color: #666; font-size: 13px;">No releases found</span>';
    }
};

export const populatePhabExportEpics = () => {
    dom.phabExportEpics.innerHTML = '';
    phabExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!phabExportState.selectedSlices.has(slice.id)) return;

            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!phabExportState.selectedStatuses.has(storyStatus)) return;

                    tasks.push({
                        name: story.name,
                        body: story.body || '',
                        status: story.status || null,
                        included: true
                    });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = {
            columnId: column.id,
            name: column.name || `Activity ${colIndex + 1}`,
            description: '',
            included: true,
            type: 'epic',
            tasks
        };
        phabExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;

        const header = el('div', 'export-epic-header');

        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => {
            epicData.included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
        });

        const nameInput = el('input', 'export-epic-name', {
            type: 'text',
            value: epicData.name,
            placeholder: 'Epic name'
        });
        nameInput.addEventListener('input', (e) => {
            epicData.name = e.target.value;
        });

        const typeSelect = el('select', 'export-epic-type');
        const epicOption = el('option', null, { value: 'epic', text: 'Epic' });
        const taskOption = el('option', null, { value: 'task', text: 'Task' });
        typeSelect.append(epicOption, taskOption);
        typeSelect.addEventListener('change', (e) => {
            epicData.type = e.target.value;
        });

        header.append(checkbox, nameInput, typeSelect);

        const description = el('textarea', 'export-epic-description', {
            placeholder: 'Optional description for this epic...',
            rows: 2
        });
        description.addEventListener('input', (e) => {
            epicData.description = e.target.value;
        });

        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;

            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => {
                task.included = e.target.checked;
                taskEl.classList.toggle('excluded', !e.target.checked);
            });
            taskEl.append(taskCheckbox);

            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);

            const statusClass = task.status === 'done' ? 'done' :
                task.status === 'in-progress' ? 'in-progress' :
                task.status === 'blocked' ? 'blocked' :
                task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' :
                task.status === 'in-progress' ? 'In Progress' :
                task.status === 'blocked' ? 'Blocked' :
                task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });

        epicDiv.append(header, description, tasksList);
        dom.phabExportEpics.append(epicDiv);
    });

    if (dom.phabExportEpics.children.length === 0) {
        const emptyMsg = el('p', null, {
            style: 'color: #666; text-align: center; padding: 20px;',
            text: 'No stories to export. Add some stories to your map first, or select more releases above.'
        });
        dom.phabExportEpics.append(emptyMsg);
    }

    const epicCount = phabExportState.epicData.length;
    const taskCount = phabExportState.epicData.reduce((sum, epic) => sum + epic.tasks.length, 0);
    if (dom.phabExportCount) {
        dom.phabExportCount.textContent = epicCount > 0 ? `(${epicCount} epics, ${taskCount} tasks)` : '';
    }
};

export const generatePhabImportFunction = () => {
    return `async function importTasks(token, items, tags) {
  const url = '${getPhabBaseUrl()}/api/maniphest.edit';
  async function createTask(t, parentId, itemTags) {
    const indent = parentId ? '  ' : '';
    const params = new URLSearchParams();
    params.set('api.token', token);
    let i = 0;
    params.set('transactions[' + i + '][type]', 'title');
    params.set('transactions[' + i++ + '][value]', t.title);
    params.set('transactions[' + i + '][type]', 'description');
    params.set('transactions[' + i++ + '][value]', t.description || '');
    if (t.status) {
      params.set('transactions[' + i + '][type]', 'status');
      params.set('transactions[' + i++ + '][value]', t.status);
    }
    if (parentId) {
      params.set('transactions[' + i + '][type]', 'parent');
      params.set('transactions[' + i++ + '][value]', parentId);
    }
    if (itemTags && itemTags.length) {
      params.set('transactions[' + i + '][type]', 'projects.add');
      itemTags.forEach((tag, j) => params.set('transactions[' + i + '][value][' + j + ']', tag));
    }
    const r = await (await fetch(url, {method:'POST', body:params, credentials:'omit'})).json();
    if (r.error_code) { console.log(indent + '✗ ' + t.title + ': ' + r.error_info); return null; }
    console.log(indent + '✓ T' + r.result.object.id + ': ' + t.title);
    return r.result.object.phid;
  }
  for (const item of items) {
    const itemTags = item.type === 'epic' ? ['epic', ...tags] : [...tags];
    const itemId = await createTask(item, null, itemTags);
    if (itemId && item.subtasks) {
      for (const sub of item.subtasks) { await createTask(sub, itemId, tags); }
    }
  }
  console.log('Import complete!');
}`;
};

const getPhabBaseUrl = () => {
    const input = dom.phabInstanceUrl.value.trim();
    if (!input) return 'https://phabricator.example.com';
    if (!input.startsWith('http://') && !input.startsWith('https://')) {
        return 'https://' + input;
    }
    return input;
};

export const generatePhabImportCall = () => {
    const epics = [];
    const epicEls = dom.phabExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;

        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');
        const typeSelect = epicEl.querySelector('.export-epic-type');

        const epicName = nameInput.value || 'Untitled Epic';
        const epicDesc = descTextarea.value || '';
        const epicType = typeSelect?.value || 'epic';

        const subtasks = [];
        const phabStatusMap = { none: 'open', planned: 'open', 'in-progress': 'progress', blocked: 'stalled', done: 'resolved' };
        const taskEls = epicEl.querySelectorAll('.export-task');
        taskEls.forEach((taskEl) => {
            const taskCheckbox = taskEl.querySelector('.export-task-checkbox');
            if (!taskCheckbox.checked) return;

            const taskName = taskEl.querySelector('.export-task-name')?.textContent || '';
            const taskStatus = phabStatusMap[taskEl.dataset.status] || 'open';
            subtasks.push({ title: taskName, description: taskEl.dataset.body || 'Imported from Storymaps.io', status: taskStatus });
        });

        if (subtasks.length > 0) {
            epics.push({
                title: epicName,
                description: epicDesc || 'Imported from Storymaps.io',
                type: epicType,
                subtasks
            });
        }
    });

    const token = dom.phabApiToken.value.trim() || '<enter token above>';
    const tagsInput = dom.phabTags.value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(t => t) : [];
    return `importTasks('${token}', ${JSON.stringify(epics, null, 2)}, ${JSON.stringify(tags)});`;
};

export const showPhabStage2 = () => {
    dom.phabStage1.classList.add('hidden');
    dom.phabStage2.classList.remove('hidden');
    dom.phabExportTitle.textContent = 'Step 2: Import';

    dom.phabImportFunction.textContent = generatePhabImportFunction();
    dom.phabImportCall.textContent = generatePhabImportCall();
};

export const showPhabStage1 = () => {
    dom.phabStage1.classList.remove('hidden');
    dom.phabStage2.classList.add('hidden');
    dom.phabExportTitle.textContent = 'Step 1: Select Tasks';
};

export const copyPhabCode = async (element, button) => {
    const text = element.textContent;
    try {
        await navigator.clipboard.writeText(text);
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = originalText, 2000);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = originalText, 2000);
    }
};

// ==================== Jira API Export ====================

export const jiraApiExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showJiraApiExportModal = () => {
    populateJiraApiExportSlices();
    populateJiraApiExportEpics();
    dom.jiraApiStage1.classList.remove('hidden');
    dom.jiraApiStage2.classList.add('hidden');
    dom.jiraApiExportTitle.textContent = 'Export to Jira';
    dom.jiraApiExportModal.classList.add('visible');
};

export const hideJiraApiExportModal = () => {
    dom.jiraApiExportModal.classList.remove('visible');
};

export const confirmCloseJiraApiModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideJiraApiExportModal();
    }
};

const populateJiraApiExportSlices = () => {
    const container = dom.jiraApiExportSlices;
    container.innerHTML = '';
    jiraApiExportState.selectedSlices.clear();

    const slices = state.slices;

    slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        jiraApiExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = el('label', 'export-slice-checkbox checked');
        const checkbox = el('input', null, { type: 'checkbox', checked: true });
        checkbox.dataset.sliceId = slice.id;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                jiraApiExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                jiraApiExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateJiraApiExportEpics();
        });
        const nameSpan = el('span', 'export-slice-name', { text: sliceName });
        const countSpan = el('span', 'export-slice-count', { text: `(${storyCount})` });
        label.append(checkbox, nameSpan, countSpan);
        container.append(label);
    });
};

export const populateJiraApiExportEpics = () => {
    dom.jiraApiExportEpics.innerHTML = '';
    jiraApiExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!jiraApiExportState.selectedSlices.has(slice.id)) return;

            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!jiraApiExportState.selectedStatuses.has(storyStatus)) return;

                    tasks.push({
                        name: story.name,
                        body: story.body || '',
                        status: story.status || null,
                        included: true
                    });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = {
            columnId: column.id,
            name: column.name || `Activity ${colIndex + 1}`,
            description: '',
            included: true,
            tasks
        };
        jiraApiExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;

        const header = el('div', 'export-epic-header');

        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => {
            epicData.included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
        });

        const nameInput = el('input', 'export-epic-name', {
            type: 'text',
            value: epicData.name,
            placeholder: 'Epic name'
        });
        nameInput.addEventListener('input', (e) => {
            epicData.name = e.target.value;
        });

        header.append(checkbox, nameInput);

        const description = el('textarea', 'export-epic-description', {
            placeholder: 'Epic description (optional)',
            rows: 2
        });
        description.addEventListener('input', (e) => {
            epicData.description = e.target.value;
        });

        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;

            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => {
                task.included = e.target.checked;
                taskEl.classList.toggle('excluded', !e.target.checked);
            });
            taskEl.append(taskCheckbox);

            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);

            const statusClass = task.status === 'done' ? 'done' :
                task.status === 'in-progress' ? 'in-progress' :
                task.status === 'blocked' ? 'blocked' :
                task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' :
                task.status === 'in-progress' ? 'In Progress' :
                task.status === 'blocked' ? 'Blocked' :
                task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });

        epicDiv.append(header, description, tasksList);
        dom.jiraApiExportEpics.append(epicDiv);
    });

    if (dom.jiraApiExportEpics.children.length === 0) {
        const emptyMsg = el('p', null, {
            style: 'color: #666; text-align: center; padding: 20px;',
            text: 'No stories to export. Add some stories to your map first, or select more releases above.'
        });
        dom.jiraApiExportEpics.append(emptyMsg);
    }

    const epicCount = jiraApiExportState.epicData.length;
    const taskCount = jiraApiExportState.epicData.reduce((sum, epic) => sum + epic.tasks.length, 0);
    if (dom.jiraApiExportCount) {
        dom.jiraApiExportCount.textContent = epicCount > 0 ? `(${epicCount} epics, ${taskCount} stories)` : '';
    }
};

export const generateJiraApiImportFunction = () => {
    return `async function importToJira(email, token, projectKey, epics) {
  const auth = btoa(email + ':' + token);
  const headers = {
    'Authorization': 'Basic ' + auth,
    'Content-Type': 'application/json'
  };

  for (const epic of epics) {
    console.log('Creating Epic: ' + epic.summary);
    const epicRes = await fetch('/rest/api/3/issue', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: epic.summary,
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: epic.description || 'Imported from Storymaps.io' }] }] },
          issuetype: { name: 'Epic' }
        }
      })
    });
    const epicData = await epicRes.json();
    if (epicData.errors) {
      console.log('✗ Epic failed:', epicData.errors);
      continue;
    }
    console.log('✓ Created Epic: ' + epicData.key);

    for (const story of epic.stories) {
      const storyRes = await fetch('/rest/api/3/issue', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: story.summary,
            description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: story.description || 'Imported from Storymaps.io' }] }] },
            issuetype: { name: 'Story' },
            parent: { key: epicData.key }
          }
        })
      });
      const storyData = await storyRes.json();
      if (storyData.errors) {
        console.log('  ✗ Story failed:', storyData.errors);
      } else {
        console.log('  ✓ Created Story: ' + storyData.key + ' - ' + story.summary);
      }
    }
  }
  console.log('\\nImport complete!');
}`;
};

export const generateJiraApiImportCall = () => {
    const epics = [];
    const epicEls = dom.jiraApiExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;

        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');

        const epicName = nameInput.value || 'Untitled Epic';
        const epicDesc = descTextarea.value || '';

        const stories = [];
        const taskEls = epicEl.querySelectorAll('.export-task');
        taskEls.forEach((taskEl) => {
            const taskCheckbox = taskEl.querySelector('.export-task-checkbox');
            if (!taskCheckbox.checked) return;

            const taskName = taskEl.querySelector('.export-task-name')?.textContent || '';
            stories.push({ summary: taskName, description: taskEl.dataset.body || 'Imported from Storymaps.io' });
        });

        if (stories.length > 0) {
            epics.push({
                summary: epicName,
                description: epicDesc,
                stories
            });
        }
    });

    const email = dom.jiraApiEmail.value.trim() || '<enter email above>';
    const token = dom.jiraApiToken.value.trim() || '<enter token above>';
    const projectKey = dom.jiraApiProjectKey.value.trim().toUpperCase() || '<enter project key above>';

    return `importToJira('${email}', '${token}', '${projectKey}', ${JSON.stringify(epics, null, 2)});`;
};

export const showJiraApiStage2 = () => {
    dom.jiraApiStage1.classList.add('hidden');
    dom.jiraApiStage2.classList.remove('hidden');
    dom.jiraApiExportTitle.textContent = 'Step 2: Import';

    dom.jiraApiImportFunction.textContent = generateJiraApiImportFunction();
    dom.jiraApiImportCall.textContent = generateJiraApiImportCall();
};

export const showJiraApiStage1 = () => {
    dom.jiraApiStage1.classList.remove('hidden');
    dom.jiraApiStage2.classList.add('hidden');
    dom.jiraApiExportTitle.textContent = 'Step 1: Select Stories';
};

// ==================== Asana Export ====================

export const asanaExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showAsanaExportModal = () => {
    populateAsanaExportSlices();
    populateAsanaExportEpics();
    dom.asanaStage1.classList.remove('hidden');
    dom.asanaStage2.classList.add('hidden');
    dom.asanaExportTitle.textContent = 'Step 1: Select Tasks';
    dom.asanaExportModal.classList.add('visible');
};

export const hideAsanaExportModal = () => {
    dom.asanaExportModal.classList.remove('visible');
};

export const confirmCloseAsanaModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideAsanaExportModal();
    }
};

const populateAsanaExportSlices = () => {
    const container = dom.asanaExportSlices;
    container.innerHTML = '';
    asanaExportState.selectedSlices.clear();

    const slices = state.slices;

    slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        asanaExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = el('label', 'export-slice-checkbox checked');
        const checkbox = el('input', null, { type: 'checkbox', checked: true });
        checkbox.dataset.sliceId = slice.id;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                asanaExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                asanaExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateAsanaExportEpics();
        });
        const nameSpan = el('span', 'export-slice-name', { text: sliceName });
        const countSpan = el('span', 'export-slice-count', { text: `(${storyCount})` });
        label.append(checkbox, nameSpan, countSpan);
        container.append(label);
    });

    if (slices.length === 0) {
        container.innerHTML = '<span style="color: #666; font-size: 13px;">No releases found</span>';
    }
};

const updateAsanaExportCount = () => {
    if (!dom.asanaExportCount) return;
    const epicCount = asanaExportState.epicData.filter(e => e.included).length;
    const taskCount = asanaExportState.epicData.reduce(
        (sum, epic) => epic.included ? sum + epic.tasks.filter(t => t.included).length : sum, 0
    );
    dom.asanaExportCount.textContent = epicCount > 0 ? `(${epicCount} parent tasks, ${taskCount} subtasks)` : '';
};

export const populateAsanaExportEpics = () => {
    dom.asanaExportEpics.innerHTML = '';
    asanaExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!asanaExportState.selectedSlices.has(slice.id)) return;

            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!asanaExportState.selectedStatuses.has(storyStatus)) return;

                    tasks.push({
                        name: story.name,
                        body: story.body || '',
                        status: story.status || null,
                        included: true
                    });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = {
            columnId: column.id,
            name: column.name || `Activity ${colIndex + 1}`,
            description: '',
            included: true,
            tasks
        };
        asanaExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;

        const header = el('div', 'export-epic-header');

        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => {
            epicData.included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
            updateAsanaExportCount();
        });

        const nameInput = el('input', 'export-epic-name', {
            type: 'text',
            value: epicData.name,
            placeholder: 'Parent task name'
        });
        nameInput.addEventListener('input', (e) => {
            epicData.name = e.target.value;
        });

        header.append(checkbox, nameInput);

        const description = el('textarea', 'export-epic-description', {
            placeholder: 'Task description (optional)',
            rows: 2
        });
        description.addEventListener('input', (e) => {
            epicData.description = e.target.value;
        });

        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;

            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => {
                task.included = e.target.checked;
                taskEl.classList.toggle('excluded', !e.target.checked);
                updateAsanaExportCount();
            });
            taskEl.append(taskCheckbox);

            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);

            const statusClass = task.status === 'done' ? 'done' :
                task.status === 'in-progress' ? 'in-progress' :
                task.status === 'blocked' ? 'blocked' :
                task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' :
                task.status === 'in-progress' ? 'In Progress' :
                task.status === 'blocked' ? 'Blocked' :
                task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });

        epicDiv.append(header, description, tasksList);
        dom.asanaExportEpics.append(epicDiv);
    });

    if (dom.asanaExportEpics.children.length === 0) {
        const emptyMsg = el('p', null, {
            style: 'color: #666; text-align: center; padding: 20px;',
            text: 'No stories to export. Add some stories to your map first, or select more releases above.'
        });
        dom.asanaExportEpics.append(emptyMsg);
    }

    updateAsanaExportCount();
};

export const generateAsanaImportFunction = () => {
    const withSections = dom.asanaCreateSections.checked;
    return `async function importToAsana(token, projectGid, items) {
  const baseUrl = 'https://app.asana.com/api/1.0';
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
${withSections ? `
  async function createSection(name) {
    const res = await fetch(baseUrl + '/projects/' + projectGid + '/sections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { name: name } })
    });
    const data = await res.json();
    if (data.errors) {
      console.log('\\u2717 Section failed: ' + JSON.stringify(data.errors));
      return null;
    }
    console.log('\\u2713 Created section: ' + name);
    return data.data.gid;
  }
` : ''}
  for (const item of items) {${withSections ? `
    const sectionGid = await createSection(item.name);` : ''}
    console.log('Creating task: ' + item.name);
    const res = await fetch(baseUrl + '/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          name: item.name,
          notes: item.notes || 'Imported from Storymaps.io',
          projects: [projectGid],${withSections ? `
          memberships: [{ project: projectGid, section: sectionGid }],` : ''}
          completed: item.completed || false
        }
      })
    });
    const data = await res.json();
    if (data.errors) {
      console.log('\\u2717 Task failed: ' + JSON.stringify(data.errors));
      continue;
    }
    const parentGid = data.data.gid;
    console.log('\\u2713 Created: ' + item.name + ' (' + parentGid + ')');

    if (item.subtasks) {
      for (const sub of item.subtasks) {
        const subRes = await fetch(baseUrl + '/tasks/' + parentGid + '/subtasks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            data: {
              name: sub.name,
              notes: sub.notes || 'Imported from Storymaps.io',
              completed: sub.completed || false
            }
          })
        });
        const subData = await subRes.json();
        if (subData.errors) {
          console.log('  \\u2717 Subtask failed: ' + JSON.stringify(subData.errors));
        } else {
          console.log('  \\u2713 Created subtask: ' + sub.name);
        }
      }
    }
  }
  console.log('\\nImport complete!');
}`;
};

export const extractAsanaProjectGid = (input) => {
    if (!input) return '';
    // New-style URL: app.asana.com/1/.../project/PROJECT_GID/...
    const projectMatch = input.match(/\/project\/(\d+)/);
    if (projectMatch) return projectMatch[1];
    // Old-style URL: app.asana.com/0/PROJECT_GID/...
    const legacyMatch = input.match(/app\.asana\.com\/0\/(\d+)/);
    if (legacyMatch) return legacyMatch[1];
    // Bare GID number
    if (/^\d+$/.test(input)) return input;
    return '';
};

export const generateAsanaImportCall = () => {
    const items = [];
    const epicEls = dom.asanaExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;

        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');

        const epicName = nameInput.value || 'Untitled Task';
        const epicDesc = descTextarea.value || '';

        const subtasks = [];
        const taskEls = epicEl.querySelectorAll('.export-task');
        taskEls.forEach((taskEl) => {
            const taskCheckbox = taskEl.querySelector('.export-task-checkbox');
            if (!taskCheckbox.checked) return;

            const taskName = taskEl.querySelector('.export-task-name')?.textContent || '';
            const taskStatus = taskEl.dataset.status;
            subtasks.push({
                name: taskName,
                notes: taskEl.dataset.body || 'Imported from Storymaps.io',
                completed: taskStatus === 'done'
            });
        });

        if (subtasks.length > 0) {
            items.push({
                name: epicName,
                notes: epicDesc || 'Imported from Storymaps.io',
                completed: false,
                subtasks
            });
        }
    });

    const token = dom.asanaApiToken.value.trim() || '<enter token above>';
    const projectGid = extractAsanaProjectGid(dom.asanaProjectUrl.value.trim()) || '<paste project page URL above>';
    return `importToAsana('${token}', '${projectGid}', ${JSON.stringify(items, null, 2)});`;
};

export const showAsanaStage2 = () => {
    dom.asanaStage1.classList.add('hidden');
    dom.asanaStage2.classList.remove('hidden');
    dom.asanaExportTitle.textContent = 'Step 2: Import';

    dom.asanaImportFunction.textContent = generateAsanaImportFunction();
    dom.asanaImportCall.textContent = generateAsanaImportCall();
};

export const showAsanaStage1 = () => {
    dom.asanaStage1.classList.remove('hidden');
    dom.asanaStage2.classList.add('hidden');
    dom.asanaExportTitle.textContent = 'Step 1: Select Tasks';
};

// ==================== Asana CSV Export ====================

export const asanaCsvExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showAsanaCsvExportModal = () => {
    populateAsanaCsvExportSlices();
    populateAsanaCsvExportEpics();
    dom.asanaCsvExportModal.classList.add('visible');
};

export const hideAsanaCsvExportModal = () => {
    dom.asanaCsvExportModal.classList.remove('visible');
};

export const confirmCloseAsanaCsvModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideAsanaCsvExportModal();
    }
};

const populateAsanaCsvExportSlices = () => {
    const container = dom.asanaCsvExportSlices;
    container.innerHTML = '';
    asanaCsvExportState.selectedSlices.clear();

    const slices = state.slices;

    slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        asanaCsvExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = el('label', 'export-slice-checkbox checked');
        const checkbox = el('input', null, { type: 'checkbox', checked: true });
        checkbox.dataset.sliceId = slice.id;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                asanaCsvExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                asanaCsvExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateAsanaCsvExportEpics();
        });
        const nameSpan = el('span', 'export-slice-name', { text: sliceName });
        const countSpan = el('span', 'export-slice-count', { text: `(${storyCount})` });
        label.append(checkbox, nameSpan, countSpan);
        container.append(label);
    });

    if (slices.length === 0) {
        container.innerHTML = '<span style="color: #666; font-size: 13px;">No releases found</span>';
    }
};

const updateAsanaCsvExportCount = () => {
    if (!dom.asanaCsvExportCount) return;
    const sectionCount = asanaCsvExportState.epicData.filter(e => e.included).length;
    const taskCount = asanaCsvExportState.epicData.reduce(
        (sum, epic) => epic.included ? sum + epic.tasks.filter(t => t.included).length : sum, 0
    );
    dom.asanaCsvExportCount.textContent = sectionCount > 0 ? `(${sectionCount} parent tasks, ${taskCount} subtasks)` : '';
};

export const populateAsanaCsvExportEpics = () => {
    dom.asanaCsvExportEpics.innerHTML = '';
    asanaCsvExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!asanaCsvExportState.selectedSlices.has(slice.id)) return;

            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!asanaCsvExportState.selectedStatuses.has(storyStatus)) return;

                    tasks.push({
                        name: story.name,
                        body: story.body || '',
                        status: story.status || null,
                        included: true
                    });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = {
            columnId: column.id,
            name: column.name || `Activity ${colIndex + 1}`,
            included: true,
            tasks
        };
        asanaCsvExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;

        const header = el('div', 'export-epic-header');

        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => {
            epicData.included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
            updateAsanaCsvExportCount();
        });

        const nameInput = el('input', 'export-epic-name', {
            type: 'text',
            value: epicData.name,
            placeholder: 'Section name'
        });
        nameInput.addEventListener('input', (e) => {
            epicData.name = e.target.value;
        });

        header.append(checkbox, nameInput);

        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;

            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => {
                task.included = e.target.checked;
                taskEl.classList.toggle('excluded', !e.target.checked);
                updateAsanaCsvExportCount();
            });
            taskEl.append(taskCheckbox);

            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);

            const statusClass = task.status === 'done' ? 'done' :
                task.status === 'in-progress' ? 'in-progress' :
                task.status === 'blocked' ? 'blocked' :
                task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' :
                task.status === 'in-progress' ? 'In Progress' :
                task.status === 'blocked' ? 'Blocked' :
                task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });

        epicDiv.append(header, tasksList);
        dom.asanaCsvExportEpics.append(epicDiv);
    });

    if (dom.asanaCsvExportEpics.children.length === 0) {
        const emptyMsg = el('p', null, {
            style: 'color: #666; text-align: center; padding: 20px;',
            text: 'No stories to export. Add some stories to your map first, or select more releases above.'
        });
        dom.asanaCsvExportEpics.append(emptyMsg);
    }

    updateAsanaCsvExportCount();
};

export const downloadAsanaCsv = () => {
    const withSections = dom.asanaCsvCreateSections.checked;
    const header = ['Name', 'Description', 'Section', 'Parent Task'].map(escapeCSV).join(',');
    const rows = [header];
    const epicEls = dom.asanaCsvExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;

        const nameInput = epicEl.querySelector('.export-epic-name');
        const parentName = nameInput.value || 'Untitled';
        const section = withSections ? parentName : '';

        // Parent task row — must come before subtasks
        rows.push([parentName, 'Imported from Storymaps.io', section, ''].map(escapeCSV).join(','));

        const taskEls = epicEl.querySelectorAll('.export-task');
        taskEls.forEach((taskEl) => {
            const taskCheckbox = taskEl.querySelector('.export-task-checkbox');
            if (!taskCheckbox.checked) return;
            const taskName = taskEl.querySelector('.export-task-name')?.textContent || '';
            const taskDesc = taskEl.dataset.body || 'Imported from Storymaps.io';
            // Subtask row — linked to parent via exact name match
            rows.push([taskName, taskDesc, section, parentName].map(escapeCSV).join(','));
        });
    });

    const csv = rows.join('\n');
    const filename = sanitizeFilename(state.name || 'story-map') + '-asana.csv';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideAsanaCsvExportModal();
};

// ==================== SSE Reader (shared by proxy exports) ====================

const readSSE = async (response, onProgress, onDone) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', eventType = null;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (eventType === 'done') onDone(data);
                    else onProgress(eventType, data);
                } catch { /* skip malformed event */ }
            }
        }
    }
};

// ==================== SVG icons for progress items ====================

const ICON_PENDING = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_SPINNER = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_DONE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8.5l2.5 2.5L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_FAILED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_SKIPPED = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ICON_DONE_LG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8.5l2.5 2.5L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ==================== Shared progress renderer ====================

const renderExportProgress = (container, barEl, summaryEl, epicData, buildUrl) => {
    // Clear and build progress header
    const progressParent = container.parentElement;
    const existingHeader = progressParent.querySelector('.export-progress-header');
    if (existingHeader) existingHeader.remove();
    const existingDone = progressParent.querySelector('.export-done-summary');
    if (existingDone) existingDone.remove();

    container.innerHTML = '';
    const flatItems = [];

    epicData.forEach(epic => {
        if (!epic.included) return;
        flatItems.push({ name: epic.name, isParent: true, el: null, iconEl: null, resultEl: null });
        epic.tasks.forEach(task => {
            if (!task.included) return;
            flatItems.push({ name: task.name, isParent: false, el: null, iconEl: null, resultEl: null });
        });
    });

    const totalItems = flatItems.length;

    // Create progress header (label + count)
    const header = el('div', 'export-progress-header');
    const label = el('span', 'export-progress-label', { text: 'Exporting' });
    const countEl = el('span', 'export-progress-count', { text: `0/${totalItems}` });
    header.append(label, countEl);
    barEl.parentElement.parentNode.insertBefore(header, barEl.parentElement);

    flatItems.forEach(item => {
        const row = el('div', `export-progress-item ${item.isParent ? 'parent' : 'child'} pending`);
        const icon = el('span', 'status-icon', { html: ICON_PENDING });
        const name = el('span', 'item-name', { text: item.name });
        const result = el('span', 'item-result');
        row.append(icon, name, result);
        container.append(row);
        item.el = row;
        item.iconEl = icon;
        item.resultEl = result;
    });

    let pointer = 0;
    let doneCount = 0;
    let failCount = 0;

    const updateBar = () => {
        const completed = doneCount + failCount;
        const pct = totalItems > 0 ? (completed / totalItems * 100) : 0;
        barEl.style.width = pct + '%';
        countEl.textContent = `${completed}/${totalItems}`;
    };

    const setItemState = (idx, state, resultText, directUrl) => {
        const item = flatItems[idx];
        if (!item) return;
        item.el.className = `export-progress-item ${item.isParent ? 'parent' : 'child'} ${state}`;
        if (state === 'pending') item.iconEl.innerHTML = ICON_PENDING;
        else if (state === 'creating') item.iconEl.innerHTML = ICON_SPINNER;
        else if (state === 'done') item.iconEl.innerHTML = ICON_DONE;
        else if (state === 'failed') item.iconEl.innerHTML = ICON_FAILED;
        else if (state === 'skipped') item.iconEl.innerHTML = ICON_SKIPPED;
        if (resultText) {
            const url = directUrl || (state === 'done' && buildUrl ? buildUrl(resultText) : null);
            if (url) {
                item.resultEl.innerHTML = '';
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = resultText + ' ';
                a.insertAdjacentHTML('beforeend', '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4.5 1.5H2.5a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-2M7.5 1.5h3m0 0v3m0-3L5.5 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
                item.resultEl.append(a);
            } else {
                item.resultEl.textContent = resultText;
            }
        }
        // Auto-scroll to keep current item visible
        item.el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };

    const skipChildren = (fromIdx) => {
        // After a parent fails, skip all contiguous children
        let i = fromIdx;
        while (i < flatItems.length && !flatItems[i].isParent) {
            setItemState(i, 'skipped', 'skipped');
            failCount++;
            i++;
        }
        pointer = i;
        updateBar();
    };

    const onProgress = (event, data) => {
        if (data.status === 'creating') {
            if (pointer < flatItems.length) {
                setItemState(pointer, 'creating');
            }
        } else if (data.status === 'created') {
            const resultId = data.key || data.id || data.gid || '';
            setItemState(pointer, 'done', resultId, data.url);
            doneCount++;
            pointer++;
            updateBar();
        } else if (data.status === 'error') {
            const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
            const isParent = pointer < flatItems.length && flatItems[pointer].isParent;
            setItemState(pointer, 'failed', errMsg);
            failCount++;
            pointer++;
            if (isParent) {
                skipChildren(pointer);
            }
            updateBar();
        }
    };

    const onDone = (data) => {
        const created = data.created || doneCount;
        const failed = data.failed || failCount;
        label.textContent = 'Complete';
        countEl.textContent = `${created + failed}/${totalItems}`;
        barEl.style.width = '100%';

        // Build done summary card
        const card = el('div', `export-done-summary${failed > 0 ? ' has-failures' : ''}`);
        const iconWrap = el('div', 'done-icon', { html: ICON_DONE_LG });
        const textWrap = el('div');
        const mainText = el('div', 'done-text', { text: `${created} item${created !== 1 ? 's' : ''} created` });
        textWrap.append(mainText);
        if (failed > 0) {
            textWrap.append(el('div', 'done-detail', { text: `${failed} failed or skipped` }));
        }
        card.append(iconWrap, textWrap);
        container.parentNode.insertBefore(card, container.nextSibling);

        // Hide the plain summary text
        summaryEl.textContent = '';
    };

    return { onProgress, onDone, totalItems };
};

// ==================== Shared export summary ====================

const renderExportSummary = (container, epicData, parentLabel, childLabel) => {
    let parentCount = 0, childCount = 0;
    epicData.forEach(epic => {
        if (!epic.included) return;
        parentCount++;
        childCount += epic.tasks.filter(t => t.included).length;
    });
    const pLabel = parentCount !== 1 ? parentLabel + 's' : parentLabel;
    const cLabel = childCount !== 1 ? childLabel + 's' : childLabel;
    container.innerHTML = `Exporting <strong>${parentCount}</strong> ${pLabel} and <strong>${childCount}</strong> ${cLabel}`;
};

// ==================== Shared verify connection ====================

const verifyConnection = async (verifyUrl, body, statusEl, verifyBtn) => {
    verifyBtn.disabled = true;
    statusEl.className = 'export-verify-status loading';
    statusEl.innerHTML = '<span class="spinner-sm"></span> Verifying\u2026';
    try {
        const res = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.ok) {
            statusEl.className = 'export-verify-status success';
            statusEl.textContent = `Connected as ${data.displayName || data.userName || data.name || 'Unknown'}`;
        } else {
            statusEl.className = 'export-verify-status error';
            statusEl.textContent = data.error || 'Verification failed';
        }
    } catch (e) {
        statusEl.className = 'export-verify-status error';
        statusEl.textContent = `Connection error: ${e.message}`;
    }
    verifyBtn.disabled = false;
};

export const verifyJiraProxy = () => {
    const instanceUrl = dom.jiraProxyInstanceUrl.value.trim();
    const email = dom.jiraProxyEmail.value.trim();
    const token = dom.jiraProxyToken.value.trim();
    if (!instanceUrl || !email || !token) {
        dom.jiraProxyVerifyStatus.className = 'export-verify-status error';
        dom.jiraProxyVerifyStatus.textContent = 'Please fill in all fields first';
        return;
    }
    verifyConnection('/api/export/jira/verify', { instanceUrl, email, token }, dom.jiraProxyVerifyStatus, dom.jiraProxyVerifyBtn);
};

export const verifyPhabProxy = () => {
    const instanceUrl = dom.phabProxyInstanceUrl.value.trim();
    const token = dom.phabProxyApiToken.value.trim();
    if (!instanceUrl || !token) {
        dom.phabProxyVerifyStatus.className = 'export-verify-status error';
        dom.phabProxyVerifyStatus.textContent = 'Please fill in Instance URL and API Token first';
        return;
    }
    verifyConnection('/api/export/phabricator/verify', { instanceUrl, token }, dom.phabProxyVerifyStatus, dom.phabProxyVerifyBtn);
};

export const verifyAsanaProxy = () => {
    const token = dom.asanaProxyApiToken.value.trim();
    if (!token) {
        dom.asanaProxyVerifyStatus.className = 'export-verify-status error';
        dom.asanaProxyVerifyStatus.textContent = 'Please enter your API token first';
        return;
    }
    verifyConnection('/api/export/asana/verify', { token }, dom.asanaProxyVerifyStatus, dom.asanaProxyVerifyBtn);
};

// ==================== Jira Proxy Export ====================

export const jiraProxyExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

const cleanupProgressUI = (progressEl) => {
    const header = progressEl.querySelector('.export-progress-header');
    if (header) header.remove();
    const done = progressEl.querySelector('.export-done-summary');
    if (done) done.remove();
};

export const showJiraProxyExportModal = () => {
    populateJiraProxyExportSlices();
    populateJiraProxyExportEpics();
    dom.jiraProxyStage1.classList.remove('hidden');
    dom.jiraProxyStage2.classList.add('hidden');
    dom.jiraProxyExportTitle.textContent = 'Export to Jira';
    dom.jiraProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.jiraProxyProgress);
    dom.jiraProxyProgressItems.innerHTML = '';
    dom.jiraProxyProgressBar.style.width = '0';
    dom.jiraProxyProgressSummary.textContent = '';
    dom.jiraProxyExportRun.disabled = false;
    dom.jiraProxyExportModal.classList.add('visible');
};

export const hideJiraProxyExportModal = () => {
    dom.jiraProxyExportModal.classList.remove('visible');
};

export const confirmCloseJiraProxyModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideJiraProxyExportModal();
    }
};

export const showJiraProxyStage1 = () => {
    dom.jiraProxyStage1.classList.remove('hidden');
    dom.jiraProxyStage2.classList.add('hidden');
    dom.jiraProxyExportTitle.textContent = 'Step 1: Select Stories';
};

export const showJiraProxyStage2 = () => {
    dom.jiraProxyStage1.classList.add('hidden');
    dom.jiraProxyStage2.classList.remove('hidden');
    dom.jiraProxyExportTitle.textContent = 'Step 2: Export';
    dom.jiraProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.jiraProxyProgress);
    dom.jiraProxyProgressItems.innerHTML = '';
    dom.jiraProxyProgressBar.style.width = '0';
    dom.jiraProxyProgressSummary.textContent = '';
    dom.jiraProxyExportRun.disabled = false;
    dom.jiraProxyVerifyStatus.textContent = 'Optional - test before exporting';
    dom.jiraProxyVerifyStatus.className = 'export-verify-status';
    dom.jiraProxyVerifyBtn.disabled = false;
    renderExportSummary(dom.jiraProxySummary, jiraProxyExportState.epicData, 'epic', 'story');
};

const populateJiraProxyExportSlices = () => {
    const container = dom.jiraProxyExportSlices;
    container.innerHTML = '';
    jiraProxyExportState.selectedSlices.clear();

    state.slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        jiraProxyExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = document.createElement('label');
        label.className = 'export-slice-checkbox checked';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                jiraProxyExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                jiraProxyExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateJiraProxyExportEpics();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'export-slice-name';
        nameSpan.textContent = `${sliceName} (${storyCount})`;
        label.append(checkbox, nameSpan);
        container.append(label);
    });
};

export const populateJiraProxyExportEpics = () => {
    dom.jiraProxyExportEpics.innerHTML = '';
    jiraProxyExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!jiraProxyExportState.selectedSlices.has(slice.id)) return;
            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!jiraProxyExportState.selectedStatuses.has(storyStatus)) return;
                    tasks.push({ name: story.name, body: story.body || '', status: story.status || null, included: true });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = { columnId: column.id, name: column.name || `Activity ${colIndex + 1}`, description: '', included: true, tasks };
        jiraProxyExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;
        const header = el('div', 'export-epic-header');
        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => { epicData.included = e.target.checked; epicDiv.classList.toggle('excluded', !e.target.checked); updateJiraProxyExportCount(); });
        const nameInput = el('input', 'export-epic-name', { type: 'text', value: epicData.name, placeholder: 'Epic name' });
        nameInput.addEventListener('input', (e) => { epicData.name = e.target.value; });
        header.append(checkbox, nameInput);
        const description = el('textarea', 'export-epic-description', { placeholder: 'Epic description (optional)', rows: 2 });
        description.addEventListener('input', (e) => { epicData.description = e.target.value; });
        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;
            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => { task.included = e.target.checked; taskEl.classList.toggle('excluded', !e.target.checked); updateJiraProxyExportCount(); });
            taskEl.append(taskCheckbox);
            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);
            const statusClass = task.status === 'done' ? 'done' : task.status === 'in-progress' ? 'in-progress' : task.status === 'blocked' ? 'blocked' : task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' : task.status === 'in-progress' ? 'In Progress' : task.status === 'blocked' ? 'Blocked' : task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });
        epicDiv.append(header, description, tasksList);
        dom.jiraProxyExportEpics.append(epicDiv);
    });

    updateJiraProxyExportCount();
};

const updateJiraProxyExportCount = () => {
    let epicCount = 0, storyCount = 0;
    jiraProxyExportState.epicData.forEach(e => { if (e.included) { epicCount++; storyCount += e.tasks.filter(t => t.included).length; } });
    dom.jiraProxyExportCount.textContent = `(${epicCount} epics, ${storyCount} stories)`;
};

export const exportToJiraProxy = async () => {
    const epics = [];
    const epicEls = dom.jiraProxyExportEpics.querySelectorAll('.export-epic');
    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;
        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');
        const stories = [];
        epicEl.querySelectorAll('.export-task').forEach((taskEl) => {
            if (!taskEl.querySelector('.export-task-checkbox').checked) return;
            stories.push({ summary: taskEl.querySelector('.export-task-name')?.textContent || '', description: taskEl.dataset.body || 'Imported from Storymaps.io' });
        });
        if (stories.length > 0) {
            epics.push({ summary: nameInput.value || 'Untitled Epic', description: descTextarea.value || '', stories });
        }
    });

    const instanceUrl = dom.jiraProxyInstanceUrl.value.trim();
    const email = dom.jiraProxyEmail.value.trim();
    const token = dom.jiraProxyToken.value.trim();
    const projectKey = dom.jiraProxyProjectKey.value.trim().toUpperCase();

    if (!instanceUrl || !email || !token || !projectKey) {
        await showAlert('Please fill in all credential fields.');
        return;
    }
    if (epics.length === 0) {
        await showAlert('No stories selected to export.');
        return;
    }

    dom.jiraProxyExportRun.disabled = true;
    dom.jiraProxyExportBack.disabled = true;
    dom.jiraProxyProgress.classList.remove('hidden');
    dom.jiraProxyProgressSummary.textContent = '';
    dom.jiraProxyProgressBar.style.width = '0';

    const origin = instanceUrl.includes('://') ? instanceUrl.replace(/\/+$/, '') : `https://${instanceUrl.replace(/\/+$/, '')}`;
    const progress = renderExportProgress(
        dom.jiraProxyProgressItems, dom.jiraProxyProgressBar,
        dom.jiraProxyProgressSummary, jiraProxyExportState.epicData,
        (key) => `${origin}/browse/${key}`
    );

    try {
        const response = await fetch('/api/export/jira', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceUrl, email, token, projectKey, epics })
        });

        if (!response.ok) {
            const err = await response.json();
            dom.jiraProxyProgressSummary.textContent = err.error || 'Request failed';
            dom.jiraProxyExportRun.disabled = false;
            dom.jiraProxyExportBack.disabled = false;
            return;
        }

        await readSSE(response, progress.onProgress, progress.onDone);
        dom.jiraProxyExportBack.disabled = false;
        return;
    } catch (e) {
        dom.jiraProxyProgressSummary.textContent = `Network error: ${e.message}`;
    }
    dom.jiraProxyExportRun.disabled = false;
    dom.jiraProxyExportBack.disabled = false;
};

// ==================== Phabricator Proxy Export ====================

export const phabProxyExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showPhabProxyExportModal = () => {
    populatePhabProxyExportSlices();
    populatePhabProxyExportEpics();
    dom.phabProxyStage1.classList.remove('hidden');
    dom.phabProxyStage2.classList.add('hidden');
    dom.phabProxyExportTitle.textContent = 'Export to Phabricator';
    dom.phabProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.phabProxyProgress);
    dom.phabProxyProgressItems.innerHTML = '';
    dom.phabProxyProgressBar.style.width = '0';
    dom.phabProxyProgressSummary.textContent = '';
    dom.phabProxyExportRun.disabled = false;
    dom.phabProxyExportModal.classList.add('visible');
};

export const hidePhabProxyExportModal = () => {
    dom.phabProxyExportModal.classList.remove('visible');
};

export const confirmClosePhabProxyModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hidePhabProxyExportModal();
    }
};

export const showPhabProxyStage1 = () => {
    dom.phabProxyStage1.classList.remove('hidden');
    dom.phabProxyStage2.classList.add('hidden');
    dom.phabProxyExportTitle.textContent = 'Step 1: Select Tasks';
};

export const showPhabProxyStage2 = () => {
    dom.phabProxyStage1.classList.add('hidden');
    dom.phabProxyStage2.classList.remove('hidden');
    dom.phabProxyExportTitle.textContent = 'Step 2: Export';
    dom.phabProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.phabProxyProgress);
    dom.phabProxyProgressItems.innerHTML = '';
    dom.phabProxyProgressBar.style.width = '0';
    dom.phabProxyProgressSummary.textContent = '';
    dom.phabProxyExportRun.disabled = false;
    dom.phabProxyVerifyStatus.textContent = 'Optional - test before exporting';
    dom.phabProxyVerifyStatus.className = 'export-verify-status';
    dom.phabProxyVerifyBtn.disabled = false;
    renderExportSummary(dom.phabProxySummary, phabProxyExportState.epicData, 'epic', 'task');
};

const populatePhabProxyExportSlices = () => {
    const container = dom.phabProxyExportSlices;
    container.innerHTML = '';
    phabProxyExportState.selectedSlices.clear();

    state.slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        phabProxyExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = document.createElement('label');
        label.className = 'export-slice-checkbox checked';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                phabProxyExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                phabProxyExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populatePhabProxyExportEpics();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'export-slice-name';
        nameSpan.textContent = `${sliceName} (${storyCount})`;
        label.append(checkbox, nameSpan);
        container.append(label);
    });
};

export const populatePhabProxyExportEpics = () => {
    dom.phabProxyExportEpics.innerHTML = '';
    phabProxyExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!phabProxyExportState.selectedSlices.has(slice.id)) return;
            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!phabProxyExportState.selectedStatuses.has(storyStatus)) return;
                    tasks.push({ name: story.name, body: story.body || '', status: story.status || null, included: true });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = { columnId: column.id, name: column.name || `Activity ${colIndex + 1}`, description: '', included: true, type: 'epic', tasks };
        phabProxyExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;
        const header = el('div', 'export-epic-header');
        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => { epicData.included = e.target.checked; epicDiv.classList.toggle('excluded', !e.target.checked); updatePhabProxyExportCount(); });
        const nameInput = el('input', 'export-epic-name', { type: 'text', value: epicData.name, placeholder: 'Epic name' });
        nameInput.addEventListener('input', (e) => { epicData.name = e.target.value; });
        const typeSelect = el('select', 'export-epic-type');
        const epicOption = el('option', null, { value: 'epic', text: 'Epic' });
        const taskOption = el('option', null, { value: 'task', text: 'Task' });
        typeSelect.append(epicOption, taskOption);
        typeSelect.addEventListener('change', (e) => { epicData.type = e.target.value; });
        header.append(checkbox, nameInput, typeSelect);
        const description = el('textarea', 'export-epic-description', { placeholder: 'Optional description for this epic...', rows: 2 });
        description.addEventListener('input', (e) => { epicData.description = e.target.value; });
        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;
            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => { task.included = e.target.checked; taskEl.classList.toggle('excluded', !e.target.checked); updatePhabProxyExportCount(); });
            taskEl.append(taskCheckbox);
            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);
            const statusClass = task.status === 'done' ? 'done' : task.status === 'in-progress' ? 'in-progress' : task.status === 'blocked' ? 'blocked' : task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' : task.status === 'in-progress' ? 'In Progress' : task.status === 'blocked' ? 'Blocked' : task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });
        epicDiv.append(header, description, tasksList);
        dom.phabProxyExportEpics.append(epicDiv);
    });

    updatePhabProxyExportCount();
};

const updatePhabProxyExportCount = () => {
    let epicCount = 0, taskCount = 0;
    phabProxyExportState.epicData.forEach(e => { if (e.included) { epicCount++; taskCount += e.tasks.filter(t => t.included).length; } });
    dom.phabProxyExportCount.textContent = `(${epicCount} epics, ${taskCount} tasks)`;
};

export const exportToPhabProxy = async () => {
    const items = [];
    const epicEls = dom.phabProxyExportEpics.querySelectorAll('.export-epic');
    const phabStatusMap = { none: 'open', planned: 'open', 'in-progress': 'progress', blocked: 'stalled', done: 'resolved' };

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;
        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');
        const typeSelect = epicEl.querySelector('.export-epic-type');
        const subtasks = [];
        epicEl.querySelectorAll('.export-task').forEach((taskEl) => {
            if (!taskEl.querySelector('.export-task-checkbox').checked) return;
            subtasks.push({
                title: taskEl.querySelector('.export-task-name')?.textContent || '',
                description: taskEl.dataset.body || 'Imported from Storymaps.io',
                status: phabStatusMap[taskEl.dataset.status] || 'open'
            });
        });
        if (subtasks.length > 0) {
            items.push({
                title: nameInput.value || 'Untitled Epic',
                description: descTextarea.value || 'Imported from Storymaps.io',
                type: typeSelect?.value || 'epic',
                subtasks
            });
        }
    });

    const instanceUrl = dom.phabProxyInstanceUrl.value.trim();
    const token = dom.phabProxyApiToken.value.trim();
    const tagsInput = dom.phabProxyTags.value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(t => t) : [];

    if (!instanceUrl || !token) {
        await showAlert('Please fill in Instance URL and API Token.');
        return;
    }
    if (items.length === 0) {
        await showAlert('No tasks selected to export.');
        return;
    }

    dom.phabProxyExportRun.disabled = true;
    dom.phabProxyExportBack.disabled = true;
    dom.phabProxyProgress.classList.remove('hidden');
    dom.phabProxyProgressSummary.textContent = '';
    dom.phabProxyProgressBar.style.width = '0';

    const phabOrigin = instanceUrl.includes('://') ? instanceUrl.replace(/\/+$/, '') : `https://${instanceUrl.replace(/\/+$/, '')}`;
    const progress = renderExportProgress(
        dom.phabProxyProgressItems, dom.phabProxyProgressBar,
        dom.phabProxyProgressSummary, phabProxyExportState.epicData,
        (id) => `${phabOrigin}/${id}`
    );

    try {
        const response = await fetch('/api/export/phabricator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceUrl, token, tags, items })
        });

        if (!response.ok) {
            const err = await response.json();
            dom.phabProxyProgressSummary.textContent = err.error || 'Request failed';
            dom.phabProxyExportRun.disabled = false;
            dom.phabProxyExportBack.disabled = false;
            return;
        }

        await readSSE(response, progress.onProgress, progress.onDone);
        dom.phabProxyExportBack.disabled = false;
        return;
    } catch (e) {
        dom.phabProxyProgressSummary.textContent = `Network error: ${e.message}`;
    }
    dom.phabProxyExportRun.disabled = false;
    dom.phabProxyExportBack.disabled = false;
};

// ==================== Asana Proxy Export ====================

export const asanaProxyExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showAsanaProxyExportModal = () => {
    populateAsanaProxyExportSlices();
    populateAsanaProxyExportEpics();
    dom.asanaProxyStage1.classList.remove('hidden');
    dom.asanaProxyStage2.classList.add('hidden');
    dom.asanaProxyExportTitle.textContent = 'Export to Asana';
    dom.asanaProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.asanaProxyProgress);
    dom.asanaProxyProgressItems.innerHTML = '';
    dom.asanaProxyProgressBar.style.width = '0';
    dom.asanaProxyProgressSummary.textContent = '';
    dom.asanaProxyExportRun.disabled = false;
    dom.asanaProxyExportModal.classList.add('visible');
};

export const hideAsanaProxyExportModal = () => {
    dom.asanaProxyExportModal.classList.remove('visible');
};

export const confirmCloseAsanaProxyModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideAsanaProxyExportModal();
    }
};

export const showAsanaProxyStage1 = () => {
    dom.asanaProxyStage1.classList.remove('hidden');
    dom.asanaProxyStage2.classList.add('hidden');
    dom.asanaProxyExportTitle.textContent = 'Step 1: Select Tasks';
};

export const showAsanaProxyStage2 = () => {
    dom.asanaProxyStage1.classList.add('hidden');
    dom.asanaProxyStage2.classList.remove('hidden');
    dom.asanaProxyExportTitle.textContent = 'Step 2: Export';
    dom.asanaProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.asanaProxyProgress);
    dom.asanaProxyProgressItems.innerHTML = '';
    dom.asanaProxyProgressBar.style.width = '0';
    dom.asanaProxyProgressSummary.textContent = '';
    dom.asanaProxyExportRun.disabled = false;
    dom.asanaProxyVerifyStatus.textContent = 'Optional - test before exporting';
    dom.asanaProxyVerifyStatus.className = 'export-verify-status';
    dom.asanaProxyVerifyBtn.disabled = false;
    renderExportSummary(dom.asanaProxySummary, asanaProxyExportState.epicData, 'parent task', 'subtask');
};

const populateAsanaProxyExportSlices = () => {
    const container = dom.asanaProxyExportSlices;
    container.innerHTML = '';
    asanaProxyExportState.selectedSlices.clear();

    state.slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        asanaProxyExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = document.createElement('label');
        label.className = 'export-slice-checkbox checked';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                asanaProxyExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                asanaProxyExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateAsanaProxyExportEpics();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'export-slice-name';
        nameSpan.textContent = `${sliceName} (${storyCount})`;
        label.append(checkbox, nameSpan);
        container.append(label);
    });
};

export const populateAsanaProxyExportEpics = () => {
    dom.asanaProxyExportEpics.innerHTML = '';
    asanaProxyExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!asanaProxyExportState.selectedSlices.has(slice.id)) return;
            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!asanaProxyExportState.selectedStatuses.has(storyStatus)) return;
                    tasks.push({ name: story.name, body: story.body || '', status: story.status || null, included: true });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = { columnId: column.id, name: column.name || `Activity ${colIndex + 1}`, description: '', included: true, tasks };
        asanaProxyExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;
        const header = el('div', 'export-epic-header');
        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => { epicData.included = e.target.checked; epicDiv.classList.toggle('excluded', !e.target.checked); updateAsanaProxyExportCount(); });
        const nameInput = el('input', 'export-epic-name', { type: 'text', value: epicData.name, placeholder: 'Parent task name' });
        nameInput.addEventListener('input', (e) => { epicData.name = e.target.value; });
        header.append(checkbox, nameInput);
        const description = el('textarea', 'export-epic-description', { placeholder: 'Task description (optional)', rows: 2 });
        description.addEventListener('input', (e) => { epicData.description = e.target.value; });
        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;
            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => { task.included = e.target.checked; taskEl.classList.toggle('excluded', !e.target.checked); updateAsanaProxyExportCount(); });
            taskEl.append(taskCheckbox);
            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);
            const statusClass = task.status === 'done' ? 'done' : task.status === 'in-progress' ? 'in-progress' : task.status === 'blocked' ? 'blocked' : task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' : task.status === 'in-progress' ? 'In Progress' : task.status === 'blocked' ? 'Blocked' : task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });
        epicDiv.append(header, description, tasksList);
        dom.asanaProxyExportEpics.append(epicDiv);
    });

    updateAsanaProxyExportCount();
};

const updateAsanaProxyExportCount = () => {
    let parentCount = 0, subtaskCount = 0;
    asanaProxyExportState.epicData.forEach(e => { if (e.included) { parentCount++; subtaskCount += e.tasks.filter(t => t.included).length; } });
    dom.asanaProxyExportCount.textContent = `(${parentCount} tasks, ${subtaskCount} subtasks)`;
};

export const exportToAsanaProxy = async () => {
    const items = [];
    const epicEls = dom.asanaProxyExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;
        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');
        const subtasks = [];
        epicEl.querySelectorAll('.export-task').forEach((taskEl) => {
            if (!taskEl.querySelector('.export-task-checkbox').checked) return;
            subtasks.push({
                name: taskEl.querySelector('.export-task-name')?.textContent || '',
                notes: taskEl.dataset.body || 'Imported from Storymaps.io',
                completed: taskEl.dataset.status === 'done'
            });
        });
        if (subtasks.length > 0) {
            items.push({
                name: nameInput.value || 'Untitled Task',
                notes: descTextarea.value || 'Imported from Storymaps.io',
                completed: false,
                subtasks
            });
        }
    });

    const token = dom.asanaProxyApiToken.value.trim();
    const projectGid = extractAsanaProjectGid(dom.asanaProxyProjectUrl.value.trim());
    const createSections = dom.asanaProxyCreateSections.checked;

    if (!token || !projectGid) {
        await showAlert('Please fill in your API token and project URL.');
        return;
    }
    if (items.length === 0) {
        await showAlert('No tasks selected to export.');
        return;
    }

    dom.asanaProxyExportRun.disabled = true;
    dom.asanaProxyExportBack.disabled = true;
    dom.asanaProxyProgress.classList.remove('hidden');
    dom.asanaProxyProgressSummary.textContent = '';
    dom.asanaProxyProgressBar.style.width = '0';

    const progress = renderExportProgress(
        dom.asanaProxyProgressItems, dom.asanaProxyProgressBar,
        dom.asanaProxyProgressSummary, asanaProxyExportState.epicData,
        (gid) => `https://app.asana.com/0/0/${gid}`
    );

    // Wrap onProgress to skip section events from Asana
    const onProgressFiltered = (event, data) => {
        if (data.type === 'section') return;
        progress.onProgress(event, data);
    };

    try {
        const response = await fetch('/api/export/asana', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, projectGid, createSections, items })
        });

        if (!response.ok) {
            const err = await response.json();
            dom.asanaProxyProgressSummary.textContent = err.error || 'Request failed';
            dom.asanaProxyExportRun.disabled = false;
            dom.asanaProxyExportBack.disabled = false;
            return;
        }

        await readSSE(response, onProgressFiltered, progress.onDone);
        dom.asanaProxyExportBack.disabled = false;
        return;
    } catch (e) {
        dom.asanaProxyProgressSummary.textContent = `Network error: ${e.message}`;
    }
    dom.asanaProxyExportRun.disabled = false;
    dom.asanaProxyExportBack.disabled = false;
};

// ==================== Linear Proxy Export ====================

export const linearProxyExportState = {
    selectedSlices: new Set(),
    selectedStatuses: new Set(['none', 'planned', 'in-progress', 'blocked', 'done']),
    epicData: []
};

export const showLinearProxyExportModal = () => {
    populateLinearProxyExportSlices();
    populateLinearProxyExportEpics();
    dom.linearProxyStage1.classList.remove('hidden');
    dom.linearProxyStage2.classList.add('hidden');
    dom.linearProxyExportTitle.textContent = 'Export to Linear';
    dom.linearProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.linearProxyProgress);
    dom.linearProxyProgressItems.innerHTML = '';
    dom.linearProxyProgressBar.style.width = '0';
    dom.linearProxyProgressSummary.textContent = '';
    dom.linearProxyExportRun.disabled = false;
    dom.linearProxyExportModal.classList.add('visible');
};

export const hideLinearProxyExportModal = () => {
    dom.linearProxyExportModal.classList.remove('visible');
};

export const confirmCloseLinearProxyModal = async () => {
    if (await showConfirm('Close export dialog?')) {
        hideLinearProxyExportModal();
    }
};

export const showLinearProxyStage1 = () => {
    dom.linearProxyStage1.classList.remove('hidden');
    dom.linearProxyStage2.classList.add('hidden');
    dom.linearProxyExportTitle.textContent = 'Step 1: Select Issues';
};

export const showLinearProxyStage2 = () => {
    dom.linearProxyStage1.classList.add('hidden');
    dom.linearProxyStage2.classList.remove('hidden');
    dom.linearProxyExportTitle.textContent = 'Step 2: Export';
    dom.linearProxyProgress.classList.add('hidden');
    cleanupProgressUI(dom.linearProxyProgress);
    dom.linearProxyProgressItems.innerHTML = '';
    dom.linearProxyProgressBar.style.width = '0';
    dom.linearProxyProgressSummary.textContent = '';
    dom.linearProxyExportRun.disabled = false;
    dom.linearProxyVerifyStatus.textContent = 'Optional - test before exporting';
    dom.linearProxyVerifyStatus.className = 'export-verify-status';
    dom.linearProxyVerifyBtn.disabled = false;
    renderExportSummary(dom.linearProxySummary, linearProxyExportState.epicData, 'parent issue', 'sub-issue');
};

const populateLinearProxyExportSlices = () => {
    const container = dom.linearProxyExportSlices;
    container.innerHTML = '';
    linearProxyExportState.selectedSlices.clear();

    state.slices.forEach(slice => {
        const sliceName = slice.name || 'Unnamed Release';
        linearProxyExportState.selectedSlices.add(slice.id);

        let storyCount = 0;
        state.columns.forEach(column => {
            const stories = slice.stories[column.id] || [];
            storyCount += stories.filter(s => s.name.trim()).length;
        });

        const label = document.createElement('label');
        label.className = 'export-slice-checkbox checked';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                linearProxyExportState.selectedSlices.add(slice.id);
                label.classList.add('checked');
            } else {
                linearProxyExportState.selectedSlices.delete(slice.id);
                label.classList.remove('checked');
            }
            populateLinearProxyExportEpics();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'export-slice-name';
        nameSpan.textContent = `${sliceName} (${storyCount})`;
        label.append(checkbox, nameSpan);
        container.append(label);
    });
};

export const populateLinearProxyExportEpics = () => {
    dom.linearProxyExportEpics.innerHTML = '';
    linearProxyExportState.epicData = [];

    state.columns.forEach((column, colIndex) => {
        const tasks = [];
        state.slices.forEach(slice => {
            if (!linearProxyExportState.selectedSlices.has(slice.id)) return;
            const sliceStories = slice.stories[column.id] || [];
            sliceStories.forEach(story => {
                if (story.name.trim()) {
                    const storyStatus = story.status || 'none';
                    if (!linearProxyExportState.selectedStatuses.has(storyStatus)) return;
                    tasks.push({ name: story.name, body: story.body || '', status: story.status || null, points: story.points ?? null, included: true });
                }
            });
        });

        if (tasks.length === 0) return;

        const epicData = { columnId: column.id, name: column.name || `Activity ${colIndex + 1}`, description: '', included: true, tasks };
        linearProxyExportState.epicData.push(epicData);

        const epicDiv = el('div', 'export-epic');
        epicDiv.dataset.columnId = column.id;
        const header = el('div', 'export-epic-header');
        const checkbox = el('input', 'export-epic-checkbox', { type: 'checkbox', checked: true });
        checkbox.addEventListener('change', (e) => { epicData.included = e.target.checked; epicDiv.classList.toggle('excluded', !e.target.checked); updateLinearProxyExportCount(); });
        const nameInput = el('input', 'export-epic-name', { type: 'text', value: epicData.name, placeholder: 'Parent issue name' });
        nameInput.addEventListener('input', (e) => { epicData.name = e.target.value; });
        header.append(checkbox, nameInput);
        const description = el('textarea', 'export-epic-description', { placeholder: 'Issue description (optional)', rows: 2 });
        description.addEventListener('input', (e) => { epicData.description = e.target.value; });
        const tasksList = el('div', 'export-tasks');
        tasks.forEach((task) => {
            const taskEl = el('label', 'export-task');
            taskEl.dataset.status = task.status || 'none';
            if (task.body) taskEl.dataset.body = task.body;
            if (task.points != null) taskEl.dataset.points = task.points;
            const taskCheckbox = el('input', 'export-task-checkbox', { type: 'checkbox', checked: true });
            taskCheckbox.addEventListener('change', (e) => { task.included = e.target.checked; taskEl.classList.toggle('excluded', !e.target.checked); updateLinearProxyExportCount(); });
            taskEl.append(taskCheckbox);
            const nameSpan = el('span', 'export-task-name', { text: task.name });
            taskEl.append(nameSpan);
            const statusClass = task.status === 'done' ? 'done' : task.status === 'in-progress' ? 'in-progress' : task.status === 'blocked' ? 'blocked' : task.status === 'planned' ? 'planned' : 'none';
            const statusText = task.status === 'done' ? 'Done' : task.status === 'in-progress' ? 'In Progress' : task.status === 'blocked' ? 'Blocked' : task.status === 'planned' ? 'Planned' : 'No Status';
            const statusBadge = el('span', `export-task-status ${statusClass}`, { text: statusText });
            taskEl.append(statusBadge);
            tasksList.append(taskEl);
        });
        epicDiv.append(header, description, tasksList);
        dom.linearProxyExportEpics.append(epicDiv);
    });

    updateLinearProxyExportCount();
};

const updateLinearProxyExportCount = () => {
    let parentCount = 0, subtaskCount = 0;
    linearProxyExportState.epicData.forEach(e => { if (e.included) { parentCount++; subtaskCount += e.tasks.filter(t => t.included).length; } });
    dom.linearProxyExportCount.textContent = `(${parentCount} issues, ${subtaskCount} sub-issues)`;
};

export const exportToLinearProxy = async () => {
    const items = [];
    const epicEls = dom.linearProxyExportEpics.querySelectorAll('.export-epic');

    epicEls.forEach((epicEl) => {
        const checkbox = epicEl.querySelector('.export-epic-checkbox');
        if (!checkbox.checked) return;
        const nameInput = epicEl.querySelector('.export-epic-name');
        const descTextarea = epicEl.querySelector('.export-epic-description');
        const subissues = [];
        epicEl.querySelectorAll('.export-task').forEach((taskEl) => {
            if (!taskEl.querySelector('.export-task-checkbox').checked) return;
            const sub = {
                name: taskEl.querySelector('.export-task-name')?.textContent || '',
                description: taskEl.dataset.body || ''
            };
            const pts = taskEl.dataset.points;
            if (pts != null && pts !== '') sub.estimate = Number(pts);
            subissues.push(sub);
        });
        if (subissues.length > 0) {
            items.push({
                name: nameInput.value || 'Untitled Issue',
                description: descTextarea.value || '',
                subissues
            });
        }
    });

    const apiKey = dom.linearProxyApiKey.value.trim();
    const teamKey = dom.linearProxyTeamKey.value.trim();

    if (!apiKey || !teamKey) {
        await showAlert('Please fill in your API key and team key.');
        return;
    }
    if (items.length === 0) {
        await showAlert('No issues selected to export.');
        return;
    }

    dom.linearProxyExportRun.disabled = true;
    dom.linearProxyExportBack.disabled = true;
    dom.linearProxyProgress.classList.remove('hidden');
    dom.linearProxyProgressSummary.textContent = '';
    dom.linearProxyProgressBar.style.width = '0';

    const progress = renderExportProgress(
        dom.linearProxyProgressItems, dom.linearProxyProgressBar,
        dom.linearProxyProgressSummary, linearProxyExportState.epicData,
        null  // URLs provided directly by Linear API via SSE data.url
    );

    try {
        const response = await fetch('/api/export/linear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, teamKey, items })
        });

        if (!response.ok) {
            const err = await response.json();
            dom.linearProxyProgressSummary.textContent = err.error || 'Request failed';
            dom.linearProxyExportRun.disabled = false;
            dom.linearProxyExportBack.disabled = false;
            return;
        }

        await readSSE(response, progress.onProgress, progress.onDone);
        dom.linearProxyExportBack.disabled = false;
        return;
    } catch (e) {
        dom.linearProxyProgressSummary.textContent = `Network error: ${e.message}`;
    }
    dom.linearProxyExportRun.disabled = false;
    dom.linearProxyExportBack.disabled = false;
};

export const verifyLinearProxy = () => {
    const apiKey = dom.linearProxyApiKey.value.trim();
    if (!apiKey) {
        dom.linearProxyVerifyStatus.className = 'export-verify-status error';
        dom.linearProxyVerifyStatus.textContent = 'Please enter your API key first';
        return;
    }
    verifyConnection('/api/export/linear/verify', { apiKey }, dom.linearProxyVerifyStatus, dom.linearProxyVerifyBtn);
};
