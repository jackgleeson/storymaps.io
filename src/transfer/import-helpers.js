// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Shared import helpers used by all platform-specific importers

import { escHtml, CARD_COLORS, DEFAULT_CARD_COLORS } from '/src/core/constants.js';

// ==================== SSE Reader (shared) ====================

export const readSSE = async (response, onProgress, onDone, onError) => {
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
                    else if (eventType === 'error') onError(data);
                    else onProgress(eventType, data);
                } catch { /* skip malformed event */ }
            }
        }
    }
};

// ==================== Verify Connection (shared) ====================

export const verifyConnection = async (verifyUrl, body, statusEl, verifyBtn) => {
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


// ==================== Groups, tags and words ====================

// Imports arrive as groups: an epic with its issues, a parent task with its subtasks, a section
// or project with its tasks. A group with a key becomes a card in its own colour, and its
// issues are tagged to match. Issues in a group without a key belong to nothing and get no tag.

const DEFAULT_WORDS = { group: ['epic', 'epics'], item: ['issue', 'issues'], entityName: 'epic' };
const wordsFor = (opts) => ({ ...DEFAULT_WORDS, ...opts });
const plural = (n, [one, many]) => (n === 1 ? one : many);
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export const isGroup = (epic) => !!epic.key;

// The tag is the group's own key when it reads like one (COFFEE-3, ENG-12, T123). Names can
// be long, so a group whose key is just an ID is numbered instead: section-01, project-02.
const looksLikeKey = (key) => /^[A-Za-z][A-Za-z0-9]*-?\d+$/.test(key);
export const groupTags = (epics, entityName = DEFAULT_WORDS.entityName) => {
    const tags = new Map();
    let n = 0;
    epics.filter(isGroup).forEach(epic => {
        n++;
        tags.set(epic, looksLikeKey(epic.key) ? epic.key : `${entityName}-${String(n).padStart(2, '0')}`);
    });
    return tags;
};

// Groups first, then the issues that belong to nothing
const groupsFirst = (epics) => [...epics.filter(isGroup), ...epics.filter(epic => !isGroup(epic))];

const STATUS_ORDER = ['planned', 'in-progress', 'done'];
const STATUS_NAMES = { planned: 'Planned', 'in-progress': 'In Progress', done: 'Done' };
const statusOf = (row) => (STATUS_ORDER.includes(row.status) ? row.status : 'planned');

// ==================== Shared Preview Rendering ====================

// The review step of every tracker import: what was found, filters by type and status, and
// one row per card that will be made. Group rows come first, each followed by its issues.
export const renderImportPreview = (epics, projectKey, domRefs, updateCountFn, opts = {}) => {
    const words = wordsFor(opts);
    const statusNames = { ...STATUS_NAMES, ...opts.statusNames };
    const ordered = groupsFirst(epics);
    const groups = ordered.filter(isGroup);
    const tags = groupTags(epics, words.entityName);
    const items = ordered.flatMap(epic => epic.stories);
    const excludedStatuses = new Set(opts.defaultExcludedStatuses || []);

    groups.forEach(epic => { epic._included = !excludedStatuses.has(statusOf(epic)) || !epic.status; });
    ordered.filter(epic => !isGroup(epic)).forEach(epic => { epic._included = true; });
    items.forEach(story => { story._included = !excludedStatuses.has(statusOf(story)); });

    // Every row, so the filters and the checkboxes can find each other
    const rows = [];
    const setIncluded = (row, on) => {
        row.data._included = on;
        row.checkbox.checked = on;
        row.el.classList.toggle('excluded', !on);
    };

    // What was found
    const header = domRefs.previewHeader;
    header.innerHTML = '';
    const found = groups.length
        ? `Found <strong>${groups.length}</strong> ${plural(groups.length, words.group)} and <strong>${items.length}</strong> ${plural(items.length, words.item)}`
        : `Found <strong>${items.length}</strong> ${plural(items.length, words.item)}`;
    const intro = document.createElement('p');
    intro.className = 'import-intro';
    intro.innerHTML = `${found} in <strong>${escHtml(projectKey)}</strong>. Each one becomes a card, in a slice called Imported, ready to arrange into steps and slices.`;
    header.append(intro);

    const filters = document.createElement('div');
    filters.className = 'export-filters';
    const chipGroup = (title, chips) => {
        const group = document.createElement('div');
        group.className = 'export-filter-group';
        const heading = document.createElement('h3');
        heading.className = 'export-section-title';
        heading.textContent = title;
        const row = document.createElement('div');
        row.className = 'export-slices';
        row.append(...chips);
        group.append(heading, row);
        return group;
    };
    const chip = (text, countText, checked, dataKey, dataValue, onChange) => {
        const label = document.createElement('label');
        label.className = 'export-slice-checkbox' + (checked ? ' checked' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.dataset[dataKey] = dataValue;
        const name = document.createElement('span');
        name.className = 'export-slice-name';
        name.textContent = text;
        label.append(cb, name);
        if (countText != null) {
            const n = document.createElement('span');
            n.className = 'export-slice-count';
            n.textContent = `(${countText})`;
            label.append(n);
        }
        cb.addEventListener('change', () => {
            label.classList.toggle('checked', cb.checked);
            onChange(cb.checked);
            updateCountFn();
        });
        return label;
    };

    // Filter by type, when the tracker has types: Epic, Story, Task, Bug
    const types = [...new Set(items.map(story => story.type).filter(Boolean))];
    if (types.length) {
        const typeChips = [];
        if (groups.length) {
            typeChips.push(chip(capital(words.group[0]), groups.length, true, 'type', '_group', (on) => {
                rows.filter(row => row.group).forEach(row => setIncluded(row, on));
            }));
        }
        types.forEach(type => {
            typeChips.push(chip(type, items.filter(story => story.type === type).length, true, 'type', type, (on) => {
                rows.filter(row => !row.group && row.data.type === type).forEach(row => setIncluded(row, on));
            }));
        });
        filters.append(chipGroup(`${capital(words.item[0])} type`, typeChips));
    }

    // Filter by status
    const foundStatuses = STATUS_ORDER.filter(status => [...groups.filter(e => e.status), ...items].some(row => statusOf(row) === status));
    if (foundStatuses.length > 1 || excludedStatuses.size) {
        filters.append(chipGroup('Status', foundStatuses.map(status =>
            chip(statusNames[status], null, !excludedStatuses.has(status), 'status', status, (on) => {
                rows.filter(row => (!row.group || row.data.status) && statusOf(row.data) === status).forEach(row => setIncluded(row, on));
            }))));
    }
    if (filters.children.length) header.append(filters);
    if (domRefs.statusFilter) domRefs.statusFilter.innerHTML = '';

    if (groups.length) {
        const note = document.createElement('p');
        note.className = 'import-note';
        const [group, groupsWord] = words.group;
        note.textContent = `${capital(groupsWord)} come in as cards in their own colour, with their description, status and link, so their details are on the story map. `
            + `Delete the ones you don't need. Each ${words.item[0]} is tagged to match its ${group}. `
            + `Untick ${/^[aeiou]/.test(group) ? 'an' : 'a'} ${group} to leave it and its ${words.item[1]} out.`;
        header.append(note);
    }

    // One row per card
    const container = domRefs.preview;
    container.innerHTML = '';
    const table = document.createElement('div');
    table.className = 'import-table' + (groups.length ? ' has-groups' : '');

    const head = document.createElement('div');
    head.className = 'import-row import-row-head';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.checked = true;
    selectAll.setAttribute('aria-label', 'Select all');
    selectAll.addEventListener('change', () => {
        rows.forEach(row => setIncluded(row, selectAll.checked));
        updateCountFn();
    });
    const headCell = (text) => {
        const cell = document.createElement('span');
        cell.textContent = text;
        return cell;
    };
    head.append(selectAll, headCell(capital(words.item[0])), headCell('Summary'), headCell(groups.length ? `${capital(words.group[0])} tag` : ''), headCell('Status'));
    table.append(head);

    const addRow = (data, { group = false, tag = null, epic = null } = {}) => {
        const el = document.createElement('label');
        // Only an issue that belongs to a group sits indented under it
        el.className = 'import-row' + (group ? ' import-row-group' : '') + (epic ? ' import-row-child' : '') + (data._included ? '' : ' excluded');
        el.dataset.status = statusOf(data);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = data._included;

        const key = document.createElement('span');
        key.className = 'import-row-key';
        key.textContent = (group ? (looksLikeKey(data.key) ? data.key : '') : data.key) || '';

        const summary = document.createElement('span');
        summary.className = 'import-row-summary';
        const swatch = document.createElement('span');
        swatch.className = 'import-row-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'import-row-name';
        name.textContent = data.summary;
        summary.append(swatch, name);
        if (data.points != null) {
            const pts = document.createElement('span');
            pts.className = 'import-points-badge';
            pts.textContent = data.points + ' pts';
            summary.append(pts);
        }

        const tagCell = document.createElement('span');
        tagCell.className = 'import-row-tag';
        if (tag) {
            const pillEl = document.createElement('span');
            pillEl.className = 'import-tag';
            pillEl.textContent = tag;
            tagCell.append(pillEl);
        }

        const status = document.createElement('span');
        status.className = 'import-row-status';
        status.textContent = group && !data.status ? '' : statusNames[statusOf(data)];

        el.append(checkbox, key, summary, tagCell, status);
        table.append(el);
        const row = { data, el, checkbox, group, epic };
        rows.push(row);

        checkbox.addEventListener('change', () => {
            setIncluded(row, checkbox.checked);
            // Unticking a group leaves its issues out too; ticking it brings them back
            if (group) rows.filter(r => r.epic === data).forEach(r => setIncluded(r, checkbox.checked));
            updateCountFn();
        });
    };

    ordered.forEach(epic => {
        const tag = tags.get(epic) || null;
        if (isGroup(epic)) addRow(epic, { group: true, tag });
        epic.stories.forEach(story => addRow(story, { tag, epic: isGroup(epic) ? epic : null }));
    });

    container.append(table);
};

// ==================== Shared Import Count ====================

export const updateImportCount = (epics, countEl, opts = {}) => {
    const words = wordsFor(opts);
    const groupCount = epics.filter(epic => isGroup(epic) && epic._included).length;
    const itemCount = epics.reduce((n, epic) => n + epic.stories.filter(s => s._included).length, 0);
    const total = groupCount + itemCount;
    const cards = `Importing ${total} ${total === 1 ? 'card' : 'cards'}`;
    countEl.textContent = groupCount
        ? `${cards}: ${groupCount} ${plural(groupCount, words.group)} and ${itemCount} ${plural(itemCount, words.item)}`
        : cards;
};

// ==================== Shared Storymap Builder ====================

const GROUP_COLOR = CARD_COLORS.lime;
const ITEM_COLOR = CARD_COLORS.yellow;

// Every group and issue that is ticked becomes a card, in a slice called Imported, with an
// empty MVP slice above it to drag the first release into. A group's
// card comes first, in its own colour, then its issues, tagged to match. Issues that belong to
// no group come last, with no tag. The legend says which colour is which.
export const buildStorymapFromImport = (epics, projectName, buildUrlFn, opts = {}) => {
    const words = wordsFor(opts);
    const tags = groupTags(epics, words.entityName);
    const allCards = [];
    let groupCards = 0;

    const fill = (card, source) => {
        if (source.description) card.body = source.description;
        if (source.status) card.status = source.status;
        if (source.points != null) card.points = source.points;
        const url = buildUrlFn(source.key);
        if (url) card.url = url;
        return card;
    };

    groupsFirst(epics).forEach(epic => {
        const tag = tags.get(epic) || null;

        if (isGroup(epic) && epic._included) {
            allCards.push(fill({ name: epic.summary, color: GROUP_COLOR, tags: [tag] }, epic));
            groupCards++;
        }

        epic.stories.forEach(story => {
            if (!story._included) return;
            const card = { name: story.summary };
            const cardTags = [...(tag ? [tag] : []), ...(story.labels || [])];
            if (cardTags.length) card.tags = cardTags;
            allCards.push(fill(card, story));
        });
    });

    const name = projectName + ' Import';
    if (allCards.length === 0) return { app: 'storymap', v: 1, name, steps: [], users: [], activities: [], slices: [] };

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
        name,
        steps,
        users,
        activities,
        slices: [
            { name: 'MVP', stories: Array.from({ length: cols }, () => []) },
            { name: 'Imported', stories: grid },
        ],
        ...(groupCards > 0 && { legend: [
            { color: GROUP_COLOR, label: capital(words.group[0]) },
            { color: ITEM_COLOR, label: capital(words.item[0]) },
        ] }),
    };
};

// When an import is added to a map that already has cards, its own cards are the default
// colour too, so only the group colour is new. It joins the legend unless the legend names
// that colour already.
export const legendToAdd = (imported = [], existing = []) => imported
    .filter(entry => entry.color !== DEFAULT_CARD_COLORS.story && !existing.some(e => e.color === entry.color))
    .map(entry => ({ color: entry.color, label: entry.label }));
