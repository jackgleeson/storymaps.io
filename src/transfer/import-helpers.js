// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Shared import helpers used by all platform-specific importers

import { escHtml, CARD_COLORS, DEFAULT_CARD_COLORS } from '/src/core/constants.js';
import { state, isUntouched } from '/src/core/state.js';
import { backboneSteps } from '/src/core/serialization.js';

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

// An import of more than this many cards gets a warning, in the review step of a tracker import
// and before a file is imported. It is nearly always more than was meant: a whole project where
// one release would do.
export const BIG_IMPORT_CARDS = 1000;
export const isBigImport = (cards) => cards > BIG_IMPORT_CARDS;
export const BIG_IMPORT_REASON = `More than ${BIG_IMPORT_CARDS.toLocaleString('en-GB')} cards on one story map could result in performance issues and make it hard to find your way around.`;

// 1240 as 1,240
const withCommas = (n) => Number(n).toLocaleString('en-GB');

// The plural of an issue type as a tracker names it: Bug, Story, Sub-task, User Story
export const pluralType = (type) => {
    if (/s$/i.test(type)) return type;
    if (/[^aeiou]y$/i.test(type)) return `${type.slice(0, -1)}ies`;
    return `${type}s`;
};

// The quick trims offered on a big import: the Done ones, then up to three issue types, smallest
// first. The most common type is never offered, since leaving it out leaves little to import.
export const trimTypes = (typeCounts) => {
    const types = Object.entries(typeCounts).sort((a, b) => a[1] - b[1]).map(([type]) => type);
    return types.slice(0, -1).slice(0, 3);
};

const STATUS_ORDER = ['planned', 'in-progress', 'done'];
const STATUS_NAMES = { planned: 'Planned', 'in-progress': 'In Progress', done: 'Done' };
const statusOf = (row) => (STATUS_ORDER.includes(row.status) ? row.status : 'planned');

// ==================== Shared Preview Rendering ====================

// ==================== Add to the story map, or replace it ====================

// Importing into a story map that is open asks where the cards should go, with what each
// answer does. A story map nobody has worked on yet isn't asked: the import fills it, as it
// does from the home page. The radio that is ticked is the answer, so the importers read it as
// before: 'append' or 'replace'.
const MODE_TEXT = {
    underSteps: 'The cards go in a slice called Imported, under the steps you already have. Nothing is removed.',
    beside: 'The cards go in a slice called Imported, beside what is already there. Nothing is removed.',
    replace: 'Everything on the story map is swapped for the import. A backup is taken first.',
};
const MODE_BUTTON = { append: 'Add to story map', replace: 'Replace story map' };

export const importModeShown = (container) => !!container && !container.classList.contains('hidden');

export const showImportMode = (container) => {
    if (!container) return;
    const ask = !!state.mapLoaded && !isUntouched();
    const name = container.id;
    if (!container.dataset.built) {
        container.dataset.built = 'true';
        container.innerHTML = `<fieldset class="import-mode-choice">
    <legend class="import-mode-legend">Where should the cards go?</legend>
    <div class="import-mode-options">
        <label class="import-mode-option"><input type="radio" name="${name}" value="append"><span class="import-mode-text"><span class="import-mode-title">Add to this story map</span><span class="import-mode-detail" data-mode-detail="append"></span></span></label>
        <label class="import-mode-option"><input type="radio" name="${name}" value="replace"><span class="import-mode-text"><span class="import-mode-title">Replace this story map</span><span class="import-mode-detail">${MODE_TEXT.replace}</span></span></label>
    </div>
</fieldset>`;
        container.addEventListener('change', () => labelImportButton(container.closest('.export-stage')));
    }
    container.classList.toggle('hidden', !ask);
    container.querySelector('[data-mode-detail="append"]').textContent = backboneSteps().length ? MODE_TEXT.underSteps : MODE_TEXT.beside;
    // With nothing to ask, the import replaces the starter cards of the new story map
    container.querySelector(`input[value="${ask ? 'append' : 'replace'}"]`).checked = true;
    labelImportButton(container.closest('.export-stage'));
};

// The button says what it will do. With no question, it keeps its usual words. On a big import
// it also says how many cards, so the number is on the thing about to be pressed.
const BIG_MODE_BUTTON = { append: (n) => `Add ${n} cards`, replace: (n) => `Replace with ${n} cards` };
const labelImportButton = (stage) => {
    const button = stage?.querySelector('[id$="ImportConfirmBtn"]');
    if (!button) return;
    const container = stage.querySelector('.import-mode');
    const mode = importModeShown(container) ? container.querySelector('input:checked')?.value : null;
    const cards = button.dataset.bigImport;
    if (cards) button.textContent = mode ? BIG_MODE_BUTTON[mode](cards) : `Import ${cards} cards`;
    else button.textContent = mode ? MODE_BUTTON[mode] : 'Import to Map';
};

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
    // After any tick or untick: the count, then the quick trims, which say how many cards each
    // would take out of what is ticked now
    let refreshTrims = () => {};
    const changed = () => {
        updateCountFn();
        refreshTrims();
        refreshLabels();
    };
    const setIncluded = (row, on) => {
        row.data._included = on;
        row.checkbox.checked = on;
        row.el.classList.toggle('excluded', !on);
    };

    // What was found
    const header = domRefs.previewHeader;
    header.innerHTML = '';
    const found = groups.length
        ? `Found <strong>${withCommas(groups.length)}</strong> ${plural(groups.length, words.group)} and <strong>${withCommas(items.length)}</strong> ${plural(items.length, words.item)}`
        : `Found <strong>${withCommas(items.length)}</strong> ${plural(items.length, words.item)}`;
    const intro = document.createElement('p');
    intro.className = 'import-intro';
    // The question about where the cards go says which slice they land in, so the line above it doesn't
    const asking = importModeShown(domRefs.mode);
    intro.innerHTML = `${found} in <strong>${escHtml(projectKey)}</strong>. Each one becomes a card, ${asking ? '' : 'in a slice called Imported, '}ready to arrange into steps and slices.`;
    header.append(intro);
    // It sits under that line. The header is drawn again when the grouping changes, and the same
    // element goes back in, so the answer already given is kept.
    if (domRefs.mode) header.append(domRefs.mode);

    // Shown by updateImportCount while more than BIG_IMPORT_CARDS cards are ticked
    const warning = document.createElement('div');
    warning.className = 'import-big-warning';
    warning.setAttribute('role', 'status');
    warning.hidden = true;
    warning.innerHTML = `<svg class="import-big-warning-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
<p><strong class="import-big-warning-count"></strong> ${BIG_IMPORT_REASON} Untick what you don't need, or import one project at a time.</p>`;
    header.append(warning);

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
            changed();
        });
        return label;
    };
    // What each quick trim would leave out, with the filter box it ticks and unticks
    const trims = [];

    // Filter by type, when the tracker has types: Epic, Story, Task, Bug
    const types = [...new Set(items.map(story => story.type).filter(Boolean))];
    if (types.length) {
        const typeChips = [];
        if (groups.length) {
            typeChips.push(chip(capital(words.group[0]), groups.length, true, 'type', '_group', (on) => {
                rows.filter(row => row.group).forEach(row => setIncluded(row, on));
            }));
        }
        const typeCounts = {};
        types.forEach(type => {
            typeCounts[type] = items.filter(story => story.type === type).length;
            const typeChip = chip(type, typeCounts[type], true, 'type', type, (on) => {
                rows.filter(row => !row.group && row.data.type === type).forEach(row => setIncluded(row, on));
            });
            typeChips.push(typeChip);
            trims.push({ kind: 'type', value: type, name: pluralType(type), box: typeChip.querySelector('input'), takes: (row) => !row.group && row.data.type === type });
        });
        const offered = trimTypes(typeCounts);
        // Only the types on offer stay, in the order offered
        trims.splice(0, trims.length, ...offered.map(type => trims.find(trim => trim.value === type)));
        filters.append(chipGroup(`${capital(words.item[0])} type`, typeChips));
    }

    // Filter by status
    const foundStatuses = STATUS_ORDER.filter(status => [...groups.filter(e => e.status), ...items].some(row => statusOf(row) === status));
    if (foundStatuses.length > 1 || excludedStatuses.size) {
        const hasStatus = (row, status) => (!row.group || row.data.status) && statusOf(row.data) === status;
        filters.append(chipGroup('Status', foundStatuses.map(status => {
            const withStatus = [...groups.filter(e => e.status), ...items].filter(row => statusOf(row) === status).length;
            const statusChip = chip(statusNames[status], withStatus, !excludedStatuses.has(status), 'status', status, (on) => {
                rows.filter(row => hasStatus(row, status)).forEach(row => setIncluded(row, on));
            });
            // Done goes first: finished work is what most often has no place on a story map
            if (status === 'done') trims.unshift({ kind: 'status', value: status, name: statusNames[status], box: statusChip.querySelector('input'), takes: (row) => hasStatus(row, status) });
            return statusChip;
        })));
    }
    // Quick trims, on an import that came in big: one press leaves a whole kind out, and says how
    // many cards that takes off. Each is a shortcut for a filter box below it, so the two agree.
    if (isBigImport(groups.length + items.length) && trims.length) {
        const trimButtons = trims.map(trim => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'import-trim';
            button.dataset.trim = `${trim.kind}:${trim.value}`;
            button.addEventListener('click', () => {
                trim.box.checked = !trim.box.checked;
                trim.box.dispatchEvent(new Event('change'));
            });
            return button;
        });
        const trimGroup = chipGroup('Quick trims', trimButtons);
        trimGroup.classList.add('import-trims');
        // The trims come into view the first time more than BIG_IMPORT_CARDS cards are ticked, and
        // then stay, so a trim that brought the import under can be taken back. An import whose
        // done cards start unticked, as Phabricator's do, may never need them.
        trimGroup.hidden = true;
        refreshTrims = () => trims.forEach((trim, i) => {
            if (isBigImport(rows.filter(row => row.data._included).length)) trimGroup.hidden = false;
            const button = trimButtons[i];
            const leftOut = !trim.box.checked;
            button.setAttribute('aria-pressed', String(leftOut));
            button.textContent = leftOut ? `${trim.name} left out` : `Leave out ${trim.name}`;
            if (leftOut) return;
            const count = document.createElement('span');
            count.className = 'import-trim-count';
            count.textContent = `-${withCommas(rows.filter(row => row.data._included && trim.takes(row)).length)}`;
            button.append(count);
        });
        header.append(trimGroup);
    }
    if (filters.children.length) header.append(filters);
    if (domRefs.statusFilter) domRefs.statusFilter.innerHTML = '';

    // Labels: a list of every label the import carries. Unticking one leaves out every card that
    // has it, so a card with several labels is left out when any of them is unticked. What is
    // left out shows beside the button, so it can be seen and taken back without opening the list.
    const NO_LABEL = '\u0000none';
    const labelsOf = (data) => (Array.isArray(data.labels) ? data.labels.filter(Boolean) : []);
    const labelled = [...groups, ...items];
    const labelCounts = new Map();
    labelled.forEach(data => labelsOf(data).forEach(label => labelCounts.set(label, (labelCounts.get(label) || 0) + 1)));
    const labelNames = [...labelCounts.keys()].sort((a, b) => labelCounts.get(b) - labelCounts.get(a) || a.localeCompare(b));
    const leftOutLabels = new Set();
    // The label that keeps a card out, if any
    const outBy = (data) => {
        const own = labelsOf(data);
        if (!own.length) return leftOutLabels.has(NO_LABEL) ? NO_LABEL : null;
        return own.find(label => leftOutLabels.has(label)) ?? null;
    };
    let refreshLabels = () => {};
    if (labelNames.length) {
        const withNone = labelled.filter(data => !labelsOf(data).length).length;
        const labelGroup = document.createElement('div');
        labelGroup.className = 'export-filter-group import-labels';
        const heading = document.createElement('h3');
        heading.className = 'export-section-title';
        heading.textContent = 'Labels';
        const bar = document.createElement('div');
        bar.className = 'import-labels-bar';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'import-labels-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        const leftOut = document.createElement('span');
        leftOut.className = 'import-labels-left-out';
        bar.append(toggle, leftOut);

        const panel = document.createElement('div');
        panel.className = 'import-labels-panel';
        panel.hidden = true;
        const find = document.createElement('input');
        find.type = 'text';
        find.className = 'import-labels-find';
        find.placeholder = 'Find a label';
        find.setAttribute('aria-label', 'Find a label');
        const hint = document.createElement('p');
        hint.className = 'import-labels-hint';
        hint.textContent = 'Untick a label to leave out every card that has it.';
        const list = document.createElement('div');
        list.className = 'import-labels-list';
        const actions = document.createElement('div');
        actions.className = 'import-labels-actions';
        const action = (text, on) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.addEventListener('click', () => setLabels([...labelNames, ...(withNone ? [NO_LABEL] : [])], on));
            return button;
        };
        actions.append(action('Tick all', true), action('Untick all', false));
        panel.append(find, hint, list, actions);

        // Tick or untick labels, then bring every row into line: a row with a left-out label is
        // out, and a row a label had kept out comes back when none of its labels is left out
        const setLabels = (labels, on) => {
            const wasOut = new Map(rows.map(row => [row, outBy(row.data) !== null]));
            labels.forEach(label => (on ? leftOutLabels.delete(label) : leftOutLabels.add(label)));
            rows.forEach(row => {
                const out = outBy(row.data) !== null;
                if (out) setIncluded(row, false);
                else if (wasOut.get(row)) setIncluded(row, true);
            });
            changed();
        };

        const options = [...labelNames, ...(withNone ? [NO_LABEL] : [])].map(label => {
            const option = document.createElement('label');
            option.className = 'import-labels-option' + (label === NO_LABEL ? ' import-labels-none' : '');
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = true;
            box.dataset.label = label === NO_LABEL ? '' : label;
            const name = document.createElement('span');
            name.className = 'import-labels-name';
            name.textContent = label === NO_LABEL ? 'No label' : label;
            const count = document.createElement('span');
            count.className = 'import-labels-count';
            option.append(box, name, count);
            box.addEventListener('change', () => setLabels([label], box.checked));
            list.append(option);
            return { label, option, box, count, total: label === NO_LABEL ? withNone : labelCounts.get(label) };
        });

        find.addEventListener('input', () => {
            const q = find.value.trim().toLowerCase();
            options.forEach(o => { o.option.hidden = !!q && !o.option.textContent.toLowerCase().includes(q); });
        });

        const close = () => {
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            document.removeEventListener('mousedown', closeOutside, true);
        };
        const closeOutside = (e) => { if (!labelGroup.contains(e.target)) close(); };
        toggle.addEventListener('click', () => {
            if (!panel.hidden) return close();
            panel.hidden = false;
            // The list opens beside the button, to its right, level with the bottom of this row and
            // reaching up over what has already been read. Where there is not the room above, on a
            // short import, it hangs down from the top of the row.
            panel.style.left = `${toggle.offsetLeft + toggle.offsetWidth + 8}px`;
            const room = labelGroup.getBoundingClientRect().bottom - (labelGroup.closest('.modal-body') || header).getBoundingClientRect().top;
            panel.classList.toggle('below', room < panel.offsetHeight + 12);
            toggle.setAttribute('aria-expanded', 'true');
            document.addEventListener('mousedown', closeOutside, true);
            find.focus();
        });
        // Escape closes the list, not the whole import
        labelGroup.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || panel.hidden) return;
            e.stopPropagation();
            close();
            toggle.focus();
        });

        refreshLabels = () => {
            const out = labelNames.filter(label => leftOutLabels.has(label));
            toggle.textContent = `${withCommas(labelNames.length - out.length)} of ${withCommas(labelNames.length)} ${labelNames.length === 1 ? 'label' : 'labels'}`;
            options.forEach(o => {
                const isOut = leftOutLabels.has(o.label);
                o.box.checked = !isOut;
                o.option.classList.toggle('left-out', isOut);
                o.count.textContent = `${isOut ? '-' : ''}${withCommas(o.total)}`;
            });
            // What is left out, each with a cross to bring it back, and how many cards that takes off
            leftOut.innerHTML = '';
            const shown = [...out, ...(leftOutLabels.has(NO_LABEL) ? [NO_LABEL] : [])];
            if (shown.length) {
                const says = document.createElement('span');
                says.className = 'import-labels-says';
                says.textContent = 'Left out:';
                leftOut.append(says);
                shown.forEach(label => {
                    const text = label === NO_LABEL ? 'No label' : label;
                    const pill = document.createElement('span');
                    pill.className = 'import-labels-pill';
                    pill.append(text);
                    const back = document.createElement('button');
                    back.type = 'button';
                    back.textContent = '\u00d7';
                    back.setAttribute('aria-label', label === NO_LABEL ? 'Bring back the cards with no label' : `Bring back the cards labelled ${text}`);
                    back.addEventListener('click', () => setLabels([label], true));
                    pill.append(back);
                    leftOut.append(pill);
                });
                const off = document.createElement('span');
                off.className = 'import-trim-count';
                off.textContent = `-${withCommas(labelled.filter(data => outBy(data) !== null).length)}`;
                leftOut.append(off);
            }
            // Each row a label keeps out says which one
            rows.forEach(row => {
                const by = outBy(row.data);
                row.el.querySelector('.import-row-left-label')?.remove();
                if (by === null) return;
                const mark = document.createElement('span');
                mark.className = 'import-row-left-label';
                mark.textContent = by === NO_LABEL ? 'No label' : by;
                row.el.querySelector('.import-row-summary').append(mark);
            });
        };

        // Under the type and status boxes, on a row of its own
        labelGroup.append(heading, bar, panel);
        filters.append(labelGroup);
        if (!filters.parentNode) header.append(filters);
    }

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
        changed();
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
        // A tracker that names its own states shows the name this row has there
        status.textContent = group && !data.status ? '' : (data.stateName || statusNames[statusOf(data)]);

        el.append(checkbox, key, summary, tagCell, status);
        table.append(el);
        const row = { data, el, checkbox, group, epic };
        rows.push(row);

        checkbox.addEventListener('change', () => {
            setIncluded(row, checkbox.checked);
            // Unticking a group leaves its issues out too; ticking it brings them back
            if (group) rows.filter(r => r.epic === data).forEach(r => setIncluded(r, checkbox.checked));
            changed();
        });
    };

    ordered.forEach(epic => {
        const tag = tags.get(epic) || null;
        if (isGroup(epic)) addRow(epic, { group: true, tag });
        epic.stories.forEach(story => addRow(story, { tag, epic: isGroup(epic) ? epic : null }));
    });

    container.append(table);
    refreshTrims();
    refreshLabels();
};

// ==================== Shared Import Count ====================

export const updateImportCount = (epics, countEl, opts = {}) => {
    const words = wordsFor(opts);
    const groupCount = epics.filter(epic => isGroup(epic) && epic._included).length;
    const itemCount = epics.reduce((n, epic) => n + epic.stories.filter(s => s._included).length, 0);
    const total = groupCount + itemCount;
    const big = isBigImport(total);
    const cards = `Importing ${withCommas(total)} ${total === 1 ? 'card' : 'cards'}`;
    countEl.textContent = groupCount
        ? `${cards}: ${withCommas(groupCount)} ${plural(groupCount, words.group)} and ${withCommas(itemCount)} ${plural(itemCount, words.item)}`
        : cards;
    // In amber while the import is big. The warning above says why.
    countEl.classList?.toggle('import-count-big', big);

    // The warning, and the number on the button, while the import is big. It never stops the import.
    const stage = countEl.closest?.('.export-stage');
    if (!stage) return;
    const warning = stage.querySelector('.import-big-warning');
    if (warning) {
        warning.hidden = !big;
        warning.querySelector('.import-big-warning-count').textContent = `${withCommas(total)} cards is a lot for one story map.`;
    }
    const button = stage.querySelector('[id$="ImportConfirmBtn"]');
    if (button) {
        if (big) button.dataset.bigImport = withCommas(total);
        else delete button.dataset.bigImport;
        labelImportButton(stage);
    }
};

// ==================== Shared Storymap Builder ====================

const GROUP_COLOR = CARD_COLORS.lime;
const ITEM_COLOR = CARD_COLORS.yellow;

// Every group and issue that is ticked becomes a card, in a slice called Imported, with an
// empty slice above it to drag the first release into. That slice has no name: the first
// release is theirs to name, and not everyone calls it an MVP. A group's
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
            { name: '', stories: Array.from({ length: cols }, () => []) },
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
