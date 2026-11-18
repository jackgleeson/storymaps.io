// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Tracker exports: Jira, Linear, Asana, Phabricator and Azure DevOps, by file, by API or from the console.
// Every export makes one issue per card. The slice and the step go across as labels.
// All nine windows share one layout: filters, one example of what a card becomes, the
// label choices, and the list of cards, closed until it's wanted.

import { el } from '/src/core/constants.js';
import { state } from '/src/core/state.js';
import { showConfirm, showAlert } from '/src/core/modals.js';
import { cardHash } from '/src/core/slice-hash.js';
import { mapLinkUrl } from '/src/features/slice-links.js';
import { readSSE, verifyConnection } from '/src/transfer/import-helpers.js';
import {
    STATUSES, STATUS_NAMES, PHAB_STATUS, collectCards, cardLabels, descriptionLines, toIssue,
    jiraCsv, asanaCsv, phabConsoleFunction, phabConsoleCall, parsePhabTags, extractAsanaProjectGid,
    azureCsv, azureOrganization, AZURE_PROCESSES,
} from '/src/transfer/export-issues.js';

export { extractAsanaProjectGid };

let sanitizeFilename = null;
const byId = (id) => document.getElementById(id);
const value = (id) => byId(id).value.trim();
const withScheme = (url) => (url.includes('://') ? url : `https://${url}`).replace(/\/+$/, '');

// ==================== What each tracker makes ====================

const DEFAULT_CARD_COLOR = '#fef08a';
const JIRA_STATUS = { none: 'To Do', planned: 'To Do', 'in-progress': 'In Progress', blocked: 'To Do', done: 'Done' };
const LINEAR_STATUS = { none: 'Backlog', planned: 'Todo', 'in-progress': 'In Progress', blocked: 'Backlog', done: 'Done' };
const PHAB_STATUS_NAMES = { open: 'Open', progress: 'In Progress', stalled: 'Stalled', resolved: 'Resolved' };
const ASANA_STATUS = (status) => (status === 'done' ? 'Completed' : 'Not completed');
// Each process has its own state names. These say where a card lands in any of them.
const AZURE_STATUS = { none: 'New', planned: 'New', 'in-progress': 'In progress', blocked: 'New', done: 'Done' };
const azureProcess = () => AZURE_PROCESSES[byId('azureExportProcess').value] || AZURE_PROCESSES.agile;
const azureOptions = {
    tracker: 'Azure DevOps', noun: ['work item', 'work items'],
    labels: 'Tags', listHeading: 'Tags', statusHeading: 'Azure DevOps status',
};
const azureCredentials = () => {
    const c = { organization: azureOrganization(value('azureProxyOrganization')), project: value('azureProxyProject'), token: value('azureProxyToken') };
    return Object.values(c).every(Boolean) ? c : null;
};

const jiraCsvStatusNames = () => ({
    none: value('jiraStatusNone'), planned: value('jiraStatusPlanned'), 'in-progress': value('jiraStatusInProgress'),
    blocked: value('jiraStatusBlocked'), done: value('jiraStatusDone'),
});

const phabOptions = {
    tracker: 'Phabricator', noun: ['task', 'tasks'], typeName: 'Task',
    labels: null, listHeading: 'Slice and step', statusHeading: 'Phabricator status',
    statusText: (status) => PHAB_STATUS_NAMES[PHAB_STATUS[status]],
};

const KINDS = {
    jiraCsv: {
        modal: 'jiraExportModal', tracker: 'Jira', noun: ['story', 'stories'], typeName: 'Story',
        labels: 'Labels', listHeading: 'Labels', statusHeading: 'Jira status',
        statusText: (status) => jiraCsvStatusNames()[status],
        download: (cards, options) => ({
            name: '-jira.csv',
            text: jiraCsv(cards.map(card => toIssue(card, { link: cardLink(card), labelOptions: options })), {
                projectName: value('jiraProjectName'), projectKey: value('jiraProjectKey').toUpperCase(),
                projectType: byId('jiraProjectType').value, statusNames: jiraCsvStatusNames(),
            }),
        }),
    },
    jiraApi: {
        modal: 'jiraProxyExportModal', tracker: 'Jira', noun: ['story', 'stories'], typeName: 'Story',
        labels: 'Labels', listHeading: 'Labels', statusHeading: 'Jira status',
        statusText: (status) => JIRA_STATUS[status],
        endpoint: '/api/export/jira',
        credentials: () => {
            const c = { instanceUrl: value('jiraProxyInstanceUrl'), email: value('jiraProxyEmail'), token: value('jiraProxyToken'), projectKey: value('jiraProxyProjectKey').toUpperCase() };
            return Object.values(c).every(Boolean) ? c : null;
        },
        missing: 'Please fill in all credential fields.',
        verify: () => {
            const c = { instanceUrl: value('jiraProxyInstanceUrl'), email: value('jiraProxyEmail'), token: value('jiraProxyToken') };
            return Object.values(c).every(Boolean) ? { url: '/api/export/jira/verify', body: c } : 'Please fill in all fields first';
        },
        resultUrl: (c, key) => `${withScheme(c.instanceUrl)}/browse/${key}`,
    },
    asanaCsv: {
        modal: 'asanaCsvExportModal', tracker: 'Asana', noun: ['task', 'tasks'], typeName: 'Task',
        labels: 'Columns', listHeading: 'Columns', statusHeading: 'Asana status', plainLabels: true,
        labelNote: 'Asana can\'t import tags from a file. It turns each of these columns into a custom field in the project.',
        statusText: () => 'Not completed',
        download: (cards, options) => ({ name: '-asana.csv', text: asanaCsv(cards, { link: cardLink, ...options }) }),
    },
    asanaApi: {
        modal: 'asanaProxyExportModal', tracker: 'Asana', noun: ['task', 'tasks'], typeName: 'Task',
        labels: 'Tags', listHeading: 'Tags', statusHeading: 'Asana status',
        statusText: ASANA_STATUS,
        endpoint: '/api/export/asana',
        credentials: () => {
            const c = { token: value('asanaProxyApiToken'), projectGid: extractAsanaProjectGid(value('asanaProxyProjectUrl')) };
            return c.token && c.projectGid ? c : null;
        },
        missing: 'Please fill in your API token and project URL.',
        verify: () => (value('asanaProxyApiToken')
            ? { url: '/api/export/asana/verify', body: { token: value('asanaProxyApiToken') } }
            : 'Please enter your API token first'),
        resultUrl: (c, gid) => `https://app.asana.com/0/0/${gid}`,
    },
    linearApi: {
        modal: 'linearProxyExportModal', tracker: 'Linear', noun: ['issue', 'issues'], typeName: 'Issue',
        labels: 'Labels', listHeading: 'Labels', statusHeading: 'Linear status',
        statusText: (status) => LINEAR_STATUS[status],
        endpoint: '/api/export/linear',
        credentials: () => {
            const c = { apiKey: value('linearProxyApiKey'), teamKey: value('linearProxyTeamKey') };
            return c.apiKey && c.teamKey ? c : null;
        },
        missing: 'Please fill in your API key and team key.',
        verify: () => (value('linearProxyApiKey')
            ? { url: '/api/export/linear/verify', body: { apiKey: value('linearProxyApiKey') } }
            : 'Please enter your API key first'),
        resultUrl: null, // Linear sends the link with each issue
    },
    phabApi: {
        ...phabOptions, modal: 'phabProxyExportModal',
        endpoint: '/api/export/phabricator',
        credentials: () => {
            const c = { instanceUrl: value('phabProxyInstanceUrl'), token: value('phabProxyApiToken'), tags: parsePhabTags(value('phabProxyTags')) };
            return c.instanceUrl && c.token ? c : null;
        },
        missing: 'Please fill in Instance URL and API Token.',
        verify: () => (value('phabProxyInstanceUrl') && value('phabProxyApiToken')
            ? { url: '/api/export/phabricator/verify', body: { instanceUrl: value('phabProxyInstanceUrl'), token: value('phabProxyApiToken') } }
            : 'Please fill in Instance URL and API Token first'),
        resultUrl: (c, id) => `${withScheme(c.instanceUrl)}/${id}`,
    },
    phabConsole: { ...phabOptions, modal: 'phabExportModal', console: true },
    azureCsv: {
        ...azureOptions, modal: 'azureExportModal',
        typeName: () => azureProcess().type,
        statusText: () => azureProcess().firstState,
        download: (cards, options) => ({
            name: '-azure-devops.csv',
            text: azureCsv(cards.map(card => toIssue(card, { link: cardLink(card), labelOptions: options })), { workItemType: azureProcess().type }),
        }),
    },
    azureApi: {
        ...azureOptions, modal: 'azureProxyExportModal',
        typeName: () => 'Work item',
        statusText: (status) => AZURE_STATUS[status],
        endpoint: '/api/export/azure-devops',
        credentials: azureCredentials,
        missing: 'Please fill in your organization, project and personal access token.',
        verify: () => {
            const c = azureCredentials();
            return c ? { url: '/api/export/azure-devops/verify', body: c } : 'Please fill in all fields first';
        },
        resultUrl: null, // the server sends the link with each work item
    },
};

// ==================== One export window ====================

const sessions = {};
const modalOf = (kind) => byId(KINDS[kind].modal);
const part = (kind, name) => modalOf(kind).querySelector(`[data-export="${name}"]`);
const cardLink = (card) => mapLinkUrl(cardHash(card));
const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

const includedCards = (kind) => sessions[kind].cards.filter(card => !sessions[kind].excluded.has(card.id));

// The tags a card carries across, for the example and the list. Phabricator makes no labels,
// so its list shows the slice and the step by name: they go in the description.
const pillsFor = (kind, card) => {
    const k = KINDS[kind];
    const options = sessions[kind].labelOptions;
    if (!k.labels) {
        return [card.sliceName && { kind: 'slice', name: card.sliceName }, card.stepName && { kind: 'step', name: card.stepName }].filter(Boolean);
    }
    if (!k.plainLabels) return cardLabels(card, options);
    return [
        options.slice && card.sliceName && { kind: 'slice', name: card.sliceName },
        options.step && card.stepName && { kind: 'step', name: card.stepName },
        ...(options.tags ? card.tags.map(name => ({ kind: 'tag', name })) : []),
    ].filter(Boolean);
};

const pill = (label) => el('span', `export-label export-label-${label.kind}`, { text: label.name });

const chip = (text, checked, onChange, countText) => {
    const label = el('label', `export-slice-checkbox${checked ? ' checked' : ''}`);
    const checkbox = el('input', null, { type: 'checkbox', checked });
    checkbox.addEventListener('change', () => {
        label.classList.toggle('checked', checkbox.checked);
        onChange(checkbox.checked);
    });
    label.append(checkbox, el('span', 'export-slice-name', { text }));
    if (countText != null) label.append(el('span', 'export-slice-count', { text: `(${countText})` }));
    return label;
};

const filterGroup = (title, chips) => {
    const group = el('div', 'export-filter-group');
    const row = el('div', 'export-slices');
    row.append(...chips);
    group.append(el('h3', 'export-section-title', { text: title }), row);
    return group;
};

const toggleIn = (set, key) => (on) => { if (on) set.add(key); else set.delete(key); };

// Build the first stage: the filters, the card list, the example and the label choices
const buildChoose = (kind) => {
    const k = KINDS[kind];
    const session = sessions[kind];
    const container = part(kind, 'choose');
    container.innerHTML = '';

    const namedCards = (slice) => state.columns.reduce((n, column) => n + (slice.stories[column.id] || []).filter(s => s.name.trim()).length, 0);
    const sliceChips = state.slices.map(slice => chip(slice.name || 'Unnamed Release', true, (on) => {
        toggleIn(session.sliceIds, slice.id)(on);
        refresh(kind);
    }, namedCards(slice)));
    const statusChips = STATUSES.map(status => chip(STATUS_NAMES[status], true, (on) => {
        toggleIn(session.statuses, status)(on);
        refresh(kind);
    }));
    statusChips.forEach((c, i) => { c.querySelector('input').dataset.status = STATUSES[i]; });
    const filters = el('div', 'export-filters');
    filters.append(
        filterGroup('Releases', sliceChips.length ? sliceChips : [el('span', 'export-empty-note', { text: 'No releases found' })]),
        filterGroup('Status', statusChips),
    );

    const example = el('div', 'export-example-section');
    example.dataset.export = 'example';

    container.append(filters);
    // Only the task cards go across unless this is unticked: the yellow ones, and any other card
    // with a status. It's left out when every card is a
    // task card, or none is, since it would change nothing or leave nothing to export.
    if (session.otherCards && session.taskCards) {
        const tasksOnly = el('label', 'export-label-option export-tasks-only');
        const checkbox = el('input', null, { type: 'checkbox', checked: session.tasksOnly });
        checkbox.dataset.export = 'tasks-only';
        checkbox.addEventListener('change', () => {
            session.tasksOnly = checkbox.checked;
            refresh(kind);
        });
        tasksOnly.append(checkbox, el('span', null, { text: 'Export task cards only' }),
            el('span', 'export-tasks-only-note', { text: `Leaves out ${count(session.otherCards, ['card', 'cards'])} in other colours with no status, such as notes and questions` }));
        container.append(tasksOnly);
    }
    // The card list comes straight after the filters that decide what is in it, so it is in view
    // without scrolling. The example and the tag choices follow.
    const details = el('details', 'export-disclosure');
    const summary = el('summary', 'export-disclosure-summary');
    const summaryText = el('span');
    summaryText.dataset.export = 'cards-summary';
    summary.append(summaryText);
    summary.insertAdjacentHTML('beforeend', '<svg class="export-disclosure-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
    const list = el('div', 'export-cards');
    list.dataset.export = 'cards';
    details.append(summary, list);
    container.append(details);
    container.append(example);

    if (k.labels) {
        const section = el('div', 'export-filter-group');
        const row = el('div', 'export-label-options');
        [['slice', 'Slice name'], ['step', 'Step name'], ['tags', 'Card tags']].forEach(([key, text]) => {
            const label = el('label', 'export-label-option');
            const checkbox = el('input', null, { type: 'checkbox', checked: true });
            checkbox.dataset.label = key;
            checkbox.addEventListener('change', () => {
                session.labelOptions[key] = checkbox.checked;
                refresh(kind);
            });
            label.append(checkbox, el('span', null, { text }));
            row.append(label);
        });
        section.append(el('h3', 'export-section-title', { text: k.labels }), row);
        if (k.labelNote) section.append(el('p', 'export-label-note', { text: k.labelNote }));
        container.append(section);
    }
};

// One card as it is on the story map, and the issue it becomes
const renderExample = (kind) => {
    const k = KINDS[kind];
    const section = part(kind, 'example');
    section.innerHTML = '';
    const card = includedCards(kind)[0];
    if (!card) return;

    const note = el('div', 'export-example-card');
    note.style.background = card.color || DEFAULT_CARD_COLOR;
    note.append(el('p', 'export-example-name', { text: card.name }));
    const where = card.stepName && card.sliceName ? `${card.stepName}, in the ${card.sliceName} slice`
        : card.sliceName ? `In the ${card.sliceName} slice` : card.stepName;
    if (where) note.append(el('p', 'export-example-where', { text: where }));
    if (card.tags.length) {
        const tags = el('div', 'export-example-tags');
        tags.append(...card.tags.map(tag => el('span', 'export-example-tag', { text: tag })));
        note.append(tags);
    }

    const issue = el('div', 'export-example-issue');
    const status = k.statusText(card.status);
    const typeName = typeof k.typeName === 'function' ? k.typeName() : k.typeName;
    issue.append(
        el('p', 'export-example-type', { text: k.tracker === 'Asana' ? `${typeName}, ${status.toLowerCase()}` : `${typeName}, status ${status || 'not set'}` }),
        el('p', 'export-example-name', { text: card.name }),
    );
    const labels = el('div', 'export-example-labels');
    labels.append(el('span', 'export-example-labels-title', { text: k.labels || 'Tags' }));
    const pills = k.labels ? pillsFor(kind, card) : [];
    if (pills.length) labels.append(...pills.map(pill));
    else labels.append(el('span', 'export-example-none', { text: k.labels ? 'None' : 'Only the ones you type in the next step' }));
    issue.append(labels);
    const description = el('div', 'export-example-description');
    if (card.body.trim()) description.append(el('p', 'export-example-body', { text: card.body.trim() }));
    const link = cardLink(card);
    descriptionLines(card, { tagsLine: !k.labels }).forEach(line => description.append(el('p', null, { text: line })));
    const linkLine = el('p', null, { text: 'Story map: ' });
    linkLine.append(el('a', null, { href: link, text: link.replace(/^https?:\/\//, ''), target: '_blank', rel: 'noopener' }));
    description.append(linkLine);
    issue.append(description);

    const sides = el('div', 'export-example');
    const left = el('div', 'export-example-side export-example-from');
    left.append(el('p', 'export-example-heading', { text: 'On the story map' }), note);
    const right = el('div', 'export-example-side export-example-to');
    right.append(el('p', 'export-example-heading', { text: `In ${k.tracker}` }), issue);
    sides.append(left);
    sides.insertAdjacentHTML('beforeend', '<svg class="export-example-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
    sides.append(right);
    section.append(el('h3', 'export-section-title', { text: 'What each card becomes' }), sides);
};

const renderCards = (kind) => {
    const k = KINDS[kind];
    const session = sessions[kind];
    const list = part(kind, 'cards');
    list.innerHTML = '';
    if (!session.cards.length) {
        list.append(el('p', 'export-cards-empty', { text: 'No cards to export. Add some cards to the story map, or tick more releases and statuses above.' }));
        return;
    }
    const head = el('div', 'export-card-row export-card-head');
    head.append(el('span'), el('span', null, { text: 'Card' }), el('span', null, { text: k.listHeading }), el('span', null, { text: k.statusHeading }));
    list.append(head);
    session.cards.forEach(card => {
        const row = el('label', `export-card-row${session.excluded.has(card.id) ? ' excluded' : ''}`);
        row.dataset.cardId = card.id;
        const checkbox = el('input', null, { type: 'checkbox', checked: !session.excluded.has(card.id) });
        checkbox.addEventListener('change', () => {
            toggleIn(session.excluded, card.id)(!checkbox.checked);
            row.classList.toggle('excluded', !checkbox.checked);
            renderExample(kind);
            renderCounts(kind);
        });
        const labels = el('span', 'export-card-labels');
        labels.append(...pillsFor(kind, card).map(pill));
        row.append(checkbox, el('span', 'export-card-name', { text: card.name }), labels, el('span', 'export-card-status', { text: k.statusText(card.status) }));
        list.append(row);
    });
};

const renderCounts = (kind) => {
    const k = KINDS[kind];
    const total = sessions[kind].cards.length;
    const included = includedCards(kind).length;
    part(kind, 'cards-summary').innerHTML = '';
    part(kind, 'cards-summary').append(
        'Choose cards ',
        el('span', 'export-disclosure-count', { text: !total ? '(none to export)' : included === total ? `(all ${total} included)` : `(${included} of ${total} included)` }),
    );
    part(kind, 'count').textContent = included ? count(included, k.noun) : 'No cards to export';
    part(kind, 'next').disabled = !included;
};

// Work the card list out again after a filter or a label choice changes
const refresh = (kind) => {
    const session = sessions[kind];
    session.cards = collectCards(state, { sliceIds: session.sliceIds, statuses: session.statuses, tasksOnly: session.tasksOnly });
    renderExample(kind);
    renderCards(kind);
    renderCounts(kind);
};

const showStage = (kind, stage) => {
    modalOf(kind).querySelectorAll('[data-export-stage]').forEach(node => {
        node.classList.toggle('hidden', node.dataset.exportStage !== String(stage));
    });
};

export const openExport = (kind) => {
    const all = collectCards(state).length;
    const taskCards = collectCards(state, { tasksOnly: true }).length;
    sessions[kind] = {
        sliceIds: new Set(state.slices.map(slice => slice.id)),
        statuses: new Set(STATUSES),
        // Only the task cards to start with, so the notes and questions around them don't become
        // tickets. A story map with no task cards exports everything.
        taskCards,
        otherCards: all - taskCards,
        tasksOnly: taskCards > 0,
        excluded: new Set(),
        labelOptions: { slice: true, step: true, tags: true },
        cards: [],
    };
    buildChoose(kind);
    refresh(kind);
    showStage(kind, 1);
    modalOf(kind).classList.add('visible');
};

export const hideExport = (kind) => modalOf(kind).classList.remove('visible');
export const hideAllExports = () => Object.keys(KINDS).forEach(hideExport);

const confirmClose = async (kind) => {
    if (await showConfirm('Close export dialog?')) hideExport(kind);
};

// ==================== File downloads ====================

const downloadFile = (kind) => {
    const { name, text } = KINDS[kind].download(includedCards(kind), sessions[kind].labelOptions);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
    el('a', null, { href: url, download: sanitizeFilename(state.name || 'story-map') + name }).click();
    URL.revokeObjectURL(url);
    hideExport(kind);
};

// ==================== API exports ====================

const issuesFor = (kind) => includedCards(kind).map(card => toIssue(card, {
    link: cardLink(card),
    labelOptions: KINDS[kind].labels ? sessions[kind].labelOptions : null,
    tagsLine: !KINDS[kind].labels,
}));

const ICON = {
    pending: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/></svg>',
    creating: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    done: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8.5l2.5 2.5L12 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    failed: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};
const ICON_LINK = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4.5 1.5H2.5a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-2M7.5 1.5h3m0 0v3m0-3L5.5 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const clearProgress = (kind) => {
    const progress = part(kind, 'progress');
    progress.classList.add('hidden');
    progress.querySelectorAll('.export-progress-header, .export-done-summary').forEach(node => node.remove());
    part(kind, 'progress-items').innerHTML = '';
    part(kind, 'progress-bar').style.width = '0';
    part(kind, 'progress-summary').textContent = '';
};

// One row per issue, ticked off in order as the server reports each one
const renderProgress = (kind, issues, buildUrl) => {
    clearProgress(kind);
    const progress = part(kind, 'progress');
    const container = part(kind, 'progress-items');
    const bar = part(kind, 'progress-bar');
    progress.classList.remove('hidden');

    const header = el('div', 'export-progress-header');
    const label = el('span', 'export-progress-label', { text: 'Exporting' });
    const countEl = el('span', 'export-progress-count', { text: `0/${issues.length}` });
    header.append(label, countEl);
    progress.prepend(header);

    const rows = issues.map(issue => {
        const row = el('div', 'export-progress-item pending');
        const icon = el('span', 'status-icon', { html: ICON.pending });
        const result = el('span', 'item-result');
        row.append(icon, el('span', 'item-name', { text: issue.title }), result);
        container.append(row);
        return { row, icon, result };
    });

    let pointer = 0, created = 0, failed = 0;
    const setRow = (rowState, text, url, note) => {
        const item = rows[pointer];
        if (!item) return;
        item.row.className = `export-progress-item ${rowState}`;
        item.icon.innerHTML = ICON[rowState];
        item.result.innerHTML = '';
        if (url) {
            const a = el('a', null, { href: url, target: '_blank', rel: 'noopener', text: `${text} ` });
            a.insertAdjacentHTML('beforeend', ICON_LINK);
            item.result.append(a);
        } else if (text) {
            item.result.append(text);
        }
        if (note) item.result.append(el('span', 'item-note', { text: ` (${note})` }));
        item.row.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    const step = () => {
        pointer++;
        bar.style.width = `${issues.length ? (created + failed) / issues.length * 100 : 0}%`;
        countEl.textContent = `${created + failed}/${issues.length}`;
    };

    const onProgress = (event, data) => {
        if (data.type === 'labels') {
            label.textContent = `Getting ${(KINDS[kind].labels || 'labels').toLowerCase()} ready`;
        } else if (data.status === 'creating') {
            label.textContent = 'Exporting';
            setRow('creating');
        } else if (data.status === 'created') {
            const id = data.key || data.id || data.gid || '';
            setRow('done', id, data.url || (buildUrl && id ? buildUrl(id) : null), data.note);
            created++;
            step();
        } else if (data.status === 'error') {
            setRow('failed', typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
            failed++;
            step();
        }
    };

    const onDone = (data) => {
        label.textContent = data.error ? 'Stopped' : 'Complete';
        bar.style.width = '100%';
        const made = data.created ?? created;
        const notMade = data.failed ?? failed;
        const card = el('div', `export-done-summary${notMade > 0 || data.error ? ' has-failures' : ''}`);
        const text = el('div');
        text.append(el('div', 'done-text', { text: data.error || `${count(made, KINDS[kind].noun)} created` }));
        if (notMade > 0) text.append(el('div', 'done-detail', { text: `${notMade} failed` }));
        card.append(el('div', 'done-icon', { html: ICON.done }), text);
        container.after(card);
    };

    return { onProgress, onDone };
};

const showConnect = (kind) => {
    const k = KINDS[kind];
    showStage(kind, 2);
    clearProgress(kind);
    part(kind, 'run').disabled = false;
    part(kind, 'run').hidden = false;
    // Only the windows that send cards to a tracker swap to this button when they finish
    if (part(kind, 'done') && part(kind, 'run')) part(kind, 'done').hidden = true;
    part(kind, 'back').disabled = false;
    part(kind, 'verify').disabled = false;
    part(kind, 'verify-status').textContent = 'Optional - test before exporting';
    part(kind, 'verify-status').className = 'export-verify-status';
    const n = includedCards(kind).length;
    part(kind, 'summary').innerHTML = `Exporting <strong>${n}</strong> ${n === 1 ? k.noun[0] : k.noun[1]}`;
};

const verify = (kind) => {
    const check = KINDS[kind].verify();
    const statusEl = part(kind, 'verify-status');
    if (typeof check === 'string') {
        statusEl.className = 'export-verify-status error';
        statusEl.textContent = check;
        return;
    }
    verifyConnection(check.url, check.body, statusEl, part(kind, 'verify'));
};

const runExport = async (kind) => {
    const k = KINDS[kind];
    const credentials = k.credentials();
    if (!credentials) {
        await showAlert(k.missing);
        return;
    }
    const issues = issuesFor(kind);
    if (!issues.length) {
        await showAlert('No cards selected to export.');
        return;
    }

    const run = part(kind, 'run');
    const back = part(kind, 'back');
    const summary = part(kind, 'progress-summary');
    run.disabled = true;
    back.disabled = true;
    const progress = renderProgress(kind, issues, k.resultUrl && ((id) => k.resultUrl(credentials, id)));
    let finished = false;

    try {
        const response = await fetch(k.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...credentials, issues }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            summary.textContent = err.error || 'Request failed';
        } else {
            const done = (data) => { finished = true; progress.onDone(data); };
            await readSSE(response, progress.onProgress, done, done);
        }
    } catch (e) {
        summary.textContent = `Network error: ${e.message}`;
    }
    // Once the issues are made, running again would make them twice, so the button that ran the
    // export gives way to one that closes the window. A request that never got going can be tried again.
    run.disabled = finished;
    back.disabled = false;
    const done = part(kind, 'done');
    if (finished && done) {
        run.hidden = true;
        done.hidden = false;
        done.focus();
    }
};

// ==================== Phabricator console export ====================

const phabBaseUrl = () => (value('phabInstanceUrl') ? withScheme(value('phabInstanceUrl')) : 'https://phabricator.example.com');

const renderPhabConsole = () => {
    byId('phabImportFunction').textContent = phabConsoleFunction(phabBaseUrl());
    byId('phabImportCall').textContent = phabConsoleCall(value('phabApiToken') || '<enter token above>', issuesFor('phabConsole'), parsePhabTags(value('phabTags')));
};

const copyCode = async (element, button) => {
    const text = element.textContent;
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const textarea = el('textarea', null, { value: text });
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => { button.textContent = original; }, 2000);
};

// ==================== Wiring ====================

const PHAB_TOKEN_HELP = 'To get your API token:\n\n1. Click your profile picture in Phabricator\n2. Go to Settings\n3. Click "Conduit API Tokens"\n4. Click "Generate Token"';

export const init = (deps) => {
    sanitizeFilename = deps.sanitizeFilename;

    Object.entries(KINDS).forEach(([kind, k]) => {
        const modal = modalOf(kind);
        if (!modal) return;
        modal.addEventListener('click', (e) => { if (e.target === modal) confirmClose(kind); });
        part(kind, 'close').addEventListener('click', () => confirmClose(kind));
        part(kind, 'cancel').addEventListener('click', () => confirmClose(kind));
        part(kind, 'next').addEventListener('click', () => {
            if (k.download) downloadFile(kind);
            else if (k.console) { showStage(kind, 2); renderPhabConsole(); }
            else showConnect(kind);
        });
        part(kind, 'back')?.addEventListener('click', () => showStage(kind, 1));
        part(kind, 'run')?.addEventListener('click', () => runExport(kind));
        part(kind, 'verify')?.addEventListener('click', () => verify(kind));
        part(kind, 'done')?.addEventListener('click', () => hideExport(kind));
    });

    // Jira CSV: the Jira status names show in the example and the card list
    ['jiraStatusNone', 'jiraStatusPlanned', 'jiraStatusInProgress', 'jiraStatusBlocked', 'jiraStatusDone'].forEach(id => {
        byId(id)?.addEventListener('input', () => { if (sessions.jiraCsv) refresh('jiraCsv'); });
    });

    // Azure DevOps CSV: the process decides the work item type and the first state
    byId('azureExportProcess')?.addEventListener('change', () => { if (sessions.azureCsv) refresh('azureCsv'); });

    ['phabInstanceUrl', 'phabApiToken', 'phabTags'].forEach(id => byId(id)?.addEventListener('input', renderPhabConsole));
    byId('phabCopyFunction')?.addEventListener('click', () => copyCode(byId('phabImportFunction'), byId('phabCopyFunction')));
    byId('phabCopyCall')?.addEventListener('click', () => copyCode(byId('phabImportCall'), byId('phabCopyCall')));
    ['phabTokenHelpLink', 'phabProxyTokenHelpLink'].forEach(id => byId(id)?.addEventListener('click', async (e) => {
        e.preventDefault();
        await showAlert(PHAB_TOKEN_HELP);
    }));
};
