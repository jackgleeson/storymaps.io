// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Issue tracker exports: turn the cards on a story map into one issue per card. No epics, parent
// tasks or sections are made. The slice and the step travel with the card as labels and as
// lines in the description. Nothing here touches the page, so it can be tested on its own.

import { escapeCSV } from '/src/transfer/csv.js';
import { markdownToHtml, markdownToJiraWiki, markdownToRemarkup } from '/src/transfer/markup.js';

export const STATUSES = ['none', 'planned', 'in-progress', 'blocked', 'done'];
export const STATUS_NAMES = { none: 'No Status', planned: 'Planned', 'in-progress': 'In Progress', blocked: 'Blocked', done: 'Done' };

// Jira labels can't hold spaces, so every label is lower case with hyphens, in every issue tracker
export const labelSlug = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, '-');

// A card with no colour of its own is a task card, which shows yellow. The other colours are for
// whatever a team marks around the tasks, such as problems, questions and notes. A card of another
// colour that has a status is being worked on too, so it counts as a task card.
export const TASK_COLOR = '#fef08a';
export const isTaskCard = (story) => (story.color || TASK_COLOR).toLowerCase() === TASK_COLOR || !!story.status;

// Every named card in the slices, release by release, then step by step from the left.
// "tasksOnly" leaves out the cards of any other colour, so they don't become tickets.
export const collectCards = (state, { sliceIds = null, statuses = null, tasksOnly = false } = {}) => {
    const cards = [];
    state.slices.forEach(slice => {
        if (sliceIds && !sliceIds.has(slice.id)) return;
        state.columns.forEach(column => {
            (slice.stories[column.id] || []).forEach(story => {
                if (!story.name.trim()) return;
                const status = story.status || 'none';
                if (statuses && !statuses.has(status)) return;
                if (tasksOnly && !isTaskCard(story)) return;
                cards.push({
                    id: story.id,
                    name: story.name.trim(),
                    body: story.body || '',
                    status,
                    points: story.points ?? null,
                    color: story.color || null,
                    tags: (story.tags || []).filter(Boolean),
                    sliceName: (slice.name || '').trim(),
                    stepName: (column.name || '').trim(),
                });
            });
        });
    });
    return cards;
};

// The labels a card carries: its slice, its step and its own tags, each one optional
export const cardLabels = (card, { slice = true, step = true, tags = true } = {}) => {
    const labels = [];
    if (slice && card.sliceName) labels.push({ kind: 'slice', name: labelSlug(card.sliceName) });
    if (step && card.stepName) labels.push({ kind: 'step', name: labelSlug(card.stepName) });
    if (tags) card.tags.forEach(tag => labels.push({ kind: 'tag', name: labelSlug(tag) }));
    const seen = new Set();
    return labels.filter(label => label.name && !seen.has(label.name) && seen.add(label.name));
};

// The lines added under the card's own description, so the place it had on the story map is
// kept even where the issue tracker has no labels
export const descriptionLines = (card, { link = '', tagsLine = false } = {}) => {
    const lines = [];
    if (card.sliceName) lines.push(`Slice: ${card.sliceName}`);
    if (card.stepName) lines.push(`Step: ${card.stepName}`);
    if (tagsLine && card.tags.length) lines.push(`Tags: ${card.tags.join(', ')}`);
    if (link) lines.push(`Story map: ${link}`);
    return lines;
};

export const issueDescription = (card, opts = {}) =>
    [card.body.trim(), descriptionLines(card, opts).join('\n')].filter(Boolean).join('\n\n');

// One issue for the issue trackers' APIs. `labelOptions: null` sends no labels at all.
export const toIssue = (card, { link = '', labelOptions = {}, tagsLine = false } = {}) => {
    const issue = {
        title: card.name,
        description: issueDescription(card, { link, tagsLine }),
        status: card.status,
        labels: labelOptions ? cardLabels(card, labelOptions).map(label => label.name) : [],
    };
    if (card.points != null && card.points !== '') issue.points = Number(card.points);
    return issue;
};

const csvRows = (rows) => rows.map(row => row.map(escapeCSV).join(',')).join('\n');

// Jira reads several labels from several columns that share the heading "Labels"
export const jiraCsv = (issues, { projectName = '', projectKey = '', projectType = 'software', statusNames = {} } = {}) => {
    const hasProject = !!(projectName && projectKey);
    const labelColumns = Math.max(0, ...issues.map(issue => issue.labels.length));
    const header = [
        ...(hasProject ? ['Project name', 'Project key'] : []),
        'Work type', 'Summary', 'Description', 'Status', 'Project type',
        ...Array(labelColumns).fill('Labels'),
    ];
    const rows = issues.map(issue => [
        ...(hasProject ? [projectName, projectKey] : []),
        // Jira reads the description of a CSV file as its wiki markup
        'Story', issue.title, markdownToJiraWiki(issue.description), statusNames[issue.status] ?? '', projectType,
        ...issue.labels, ...Array(labelColumns - issue.labels.length).fill(''),
    ]);
    return csvRows([header, ...rows]);
};

// Asana's CSV import can't make tags. A column it doesn't know becomes a custom field in the
// project, so the slice, the step and the tags each get a column of their own.
export const asanaCsv = (cards, { link = () => '', slice = true, step = true, tags = true } = {}) => {
    const header = ['Name', 'Description', ...(slice ? ['Slice'] : []), ...(step ? ['Step'] : []), ...(tags ? ['Tags'] : [])];
    const rows = cards.map(card => [
        card.name, issueDescription(card, { link: link(card) }),
        ...(slice ? [card.sliceName] : []), ...(step ? [card.stepName] : []), ...(tags ? [card.tags.join(', ')] : []),
    ]);
    return csvRows([header, ...rows]);
};


// The work item type for backlog work, and the state new work starts in, depend on the
// process a project uses
export const AZURE_PROCESSES = {
    agile: { type: 'User Story', firstState: 'New' },
    scrum: { type: 'Product Backlog Item', firstState: 'New' },
    basic: { type: 'Issue', firstState: 'To Do' },
    cmmi: { type: 'Requirement', firstState: 'Proposed' },
};

// Azure DevOps imports new work items from a file in their first state, so there is no State
// column. Tags share one column, with semicolons between them.
export const azureCsv = (issues, { workItemType = AZURE_PROCESSES.agile.type } = {}) => {
    const hasTags = issues.some(issue => issue.labels.length);
    const header = ['Work Item Type', 'Title', 'Description', ...(hasTags ? ['Tags'] : [])];
    const rows = issues.map(issue => [
        // Azure DevOps reads descriptions as HTML
        workItemType, issue.title.slice(0, 255), markdownToHtml(issue.description),
        ...(hasTags ? [issue.labels.join('; ')] : []),
    ]);
    return csvRows([header, ...rows]);
};

// The organization name, from the name itself or from a link to it:
// dev.azure.com/acme, dev.azure.com/acme/Shop or acme.visualstudio.com
export const azureOrganization = (input) => {
    const text = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/^[^@/]*@/, '');
    const link = text.match(/^dev\.azure\.com\/([^/?#]+)/i) || text.match(/^([^./]+)\.visualstudio\.com/i);
    return link ? link[1] : text.replace(/\/.*$/, '');
};

// The project name in a link to a project or to a page inside it, such as
// dev.azure.com/acme/Web%20Shop/_boards. Empty when the text is no link or names no project.
export const azureProject = (input) => {
    const text = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/^[^@/]*@/, '');
    const link = text.match(/^dev\.azure\.com\/[^/?#]+\/([^/?#]+)/i) || text.match(/^[^./]+\.visualstudio\.com\/([^/?#]+)/i);
    // Pages of the organization itself start with an underscore, such as _settings
    if (!link || link[1].startsWith('_')) return '';
    try { return decodeURIComponent(link[1]); } catch { return link[1]; }
};

export const PHAB_STATUS = { none: 'open', planned: 'open', 'in-progress': 'progress', blocked: 'stalled', done: 'resolved' };

// Phabricator tags are projects that must already exist, so a comma-separated list is all there is
export const parsePhabTags = (text) => String(text || '').split(',').map(tag => labelSlug(tag)).filter(Boolean);

// The Phabricator console export: a function to paste into the browser console on the
// Phabricator site, then a call to it with the tasks
export const phabConsoleFunction = (baseUrl) => `async function importTasks(token, tasks, tags) {
  const url = '${baseUrl}/api/maniphest.edit';
  for (const t of tasks) {
    const params = new URLSearchParams();
    params.set('api.token', token);
    let i = 0;
    params.set('transactions[' + i + '][type]', 'title');
    params.set('transactions[' + i++ + '][value]', t.title);
    params.set('transactions[' + i + '][type]', 'description');
    params.set('transactions[' + i++ + '][value]', t.description || '');
    params.set('transactions[' + i + '][type]', 'status');
    params.set('transactions[' + i++ + '][value]', t.status);
    if (tags.length) {
      params.set('transactions[' + i + '][type]', 'projects.add');
      tags.forEach((tag, j) => params.set('transactions[' + i + '][value][' + j + ']', tag));
    }
    const r = await (await fetch(url, {method:'POST', body:params, credentials:'omit'})).json();
    if (r.error_code) console.log('\\u2717 ' + t.title + ': ' + r.error_info);
    else console.log('\\u2713 T' + r.result.object.id + ': ' + t.title);
  }
  console.log('Import complete!');
}`;

export const phabConsoleCall = (token, issues, tags) => {
    const tasks = issues.map(issue => ({ title: issue.title, description: markdownToRemarkup(issue.description), status: PHAB_STATUS[issue.status] || 'open' }));
    return `importTasks(${JSON.stringify(token)}, ${JSON.stringify(tasks, null, 2)}, ${JSON.stringify(tags)});`;
};

// The numeric project ID in an Asana project link
export const extractAsanaProjectGid = (input) => {
    if (!input) return '';
    // New links: app.asana.com/1/.../project/PROJECT_GID/...
    const projectMatch = input.match(/\/project\/(\d+)/);
    if (projectMatch) return projectMatch[1];
    // Old links: app.asana.com/0/PROJECT_GID/...
    const legacyMatch = input.match(/app\.asana\.com\/0\/(\d+)/);
    if (legacyMatch) return legacyMatch[1];
    if (/^\d+$/.test(input)) return input;
    return '';
};
