// Storymaps.io -- AGPL-3.0 -- see LICENCE for details
// Shared import helpers used by all platform-specific importers

import { escHtml, CARD_COLORS } from '/src/core/constants.js';

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


// ==================== Shared Preview Rendering ====================

export const renderImportPreview = (epics, projectKey, domRefs, updateCountFn, opts = {}) => {
    // Header
    const epicCount = epics.length;
    const storyCount = epics.reduce((n, e) => n + e.stories.length, 0);
    const groupLabel = opts.groupLabel || (epicCount !== 1 ? 'epics' : 'epic');
    const itemLabel = opts.itemLabel || (storyCount !== 1 ? 'stories' : 'story');
    domRefs.previewHeader.innerHTML =
        `Found <strong>${epicCount}</strong> ${groupLabel} and <strong>${storyCount}</strong> ` +
        `${itemLabel} in <strong>${escHtml(projectKey)}</strong>` +
        ` <a href="#" class="import-toggle-all">Deselect all</a>`;
    domRefs.previewHeader.querySelector('.import-toggle-all').addEventListener('click', (e) => {
        e.preventDefault();
        const allSelected = epics.every(ep => ep._included && ep.stories.every(s => s._included));
        const setTo = !allSelected;
        epics.forEach(ep => {
            ep._included = setTo;
            ep.stories.forEach(s => { s._included = setTo; });
        });
        domRefs.preview.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = setTo; });
        domRefs.preview.querySelectorAll('.import-epic').forEach(el => el.classList.toggle('excluded', !setTo));
        domRefs.preview.querySelectorAll('.import-story').forEach(el => el.classList.toggle('excluded', !setTo));
        e.target.textContent = setTo ? 'Deselect all' : 'Select all';
        updateCountFn();
    });

    // Status filter pills (opt-in)
    const statusDisplayNames = { planned: 'Planned', 'in-progress': 'In Progress', done: 'Done' };
    const allStatuses = ['planned', 'in-progress', 'done'];
    const defaultExcluded = opts.defaultExcludedStatuses || ['done'];
    let activeStatuses = null; // null means no filter

    if (opts.statusFilter && domRefs.statusFilter) {
        // Discover which statuses exist in the data
        const found = new Set();
        epics.forEach(ep => ep.stories.forEach(s => {
            const st = allStatuses.includes(s.status) ? s.status : 'planned';
            found.add(st);
        }));
        activeStatuses = new Set([...found].filter(s => !defaultExcluded.includes(s)));

        domRefs.statusFilter.innerHTML = '';
        if (found.size > 0) {
            const label = document.createElement('h3');
            label.textContent = 'Status';
            domRefs.statusFilter.append(label);

            const pillsRow = document.createElement('div');
            pillsRow.className = 'import-status-pills';

            for (const status of allStatuses) {
                const pill = document.createElement('label');
                pill.className = 'export-slice-checkbox' + (activeStatuses.has(status) ? ' checked' : '');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = activeStatuses.has(status);
                cb.dataset.status = status;
                const span = document.createElement('span');
                span.className = 'export-slice-name';
                span.textContent = statusDisplayNames[status] || status;
                pill.append(cb, span);

                cb.addEventListener('change', () => {
                    if (cb.checked) activeStatuses.add(status);
                    else activeStatuses.delete(status);
                    pill.classList.toggle('checked', cb.checked);

                    // Toggle all stories with this status
                    domRefs.preview.querySelectorAll(`.import-story[data-status="${status}"]`).forEach(el => {
                        const storyIdx = parseInt(el.querySelector('input').dataset.storyIdx);
                        const epicIdx = parseInt(el.closest('.import-epic').dataset.epicIdx);
                        const story = epics[epicIdx].stories[storyIdx];
                        story._included = cb.checked;
                        el.querySelector('input').checked = cb.checked;
                        el.classList.toggle('excluded', !cb.checked);
                    });

                    // Recalculate epic checkboxes
                    domRefs.preview.querySelectorAll('.import-epic').forEach(epicEl => {
                        const idx = parseInt(epicEl.dataset.epicIdx);
                        const epic = epics[idx];
                        const anyIncluded = epic.stories.some(s => s._included);
                        epic._included = anyIncluded;
                        epicEl.querySelector('.import-epic-header input').checked = anyIncluded;
                        epicEl.classList.toggle('excluded', !anyIncluded);
                    });

                    updateCountFn();
                });

                pillsRow.append(pill);
            }
            domRefs.statusFilter.append(pillsRow);
        }
    } else if (domRefs.statusFilter) {
        domRefs.statusFilter.innerHTML = '';
    }

    // Preview list
    const container = domRefs.preview;
    container.innerHTML = '';

    epics.forEach((epic, epicIdx) => {
        epic.stories.forEach(s => {
            if (activeStatuses) {
                const st = allStatuses.includes(s.status) ? s.status : 'planned';
                s._included = activeStatuses.has(st);
            } else {
                s._included = true;
            }
        });
        epic._included = activeStatuses ? epic.stories.some(s => s._included) : true;

        const epicDiv = document.createElement('div');
        epicDiv.className = 'import-epic expanded' + (!epic._included ? ' excluded' : '');
        epicDiv.dataset.epicIdx = epicIdx;

        // Header row
        const header = document.createElement('div');
        header.className = 'import-epic-header';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = epic._included;
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            epic._included = e.target.checked;
            epicDiv.classList.toggle('excluded', !e.target.checked);
            // Toggle all child stories
            const storyCheckboxes = epicDiv.querySelectorAll('.import-stories input[type="checkbox"]');
            storyCheckboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const storyIdx = parseInt(cb.dataset.storyIdx);
                epic.stories[storyIdx]._included = e.target.checked;
                cb.closest('.import-story').classList.toggle('excluded', !e.target.checked);
            });
            updateCountFn();
        });
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const toggle = document.createElement('span');
        toggle.className = 'import-epic-toggle';
        toggle.textContent = '\u25B6';

        const keyBadge = document.createElement('span');
        keyBadge.className = 'import-issue-key';
        keyBadge.textContent = epic.key || 'Other';

        const name = document.createElement('span');
        name.className = 'import-epic-name';
        name.textContent = epic.summary;

        const count = document.createElement('span');
        count.className = 'import-story-count';
        count.textContent = `(${epic.stories.length} ${epic.stories.length === 1 ? 'story' : 'stories'})`;

        header.append(checkbox, toggle, keyBadge, name, count);
        header.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;
            epicDiv.classList.toggle('expanded');
        });

        // Stories list
        const storiesDiv = document.createElement('div');
        storiesDiv.className = 'import-stories';

        epic.stories.forEach((story, storyIdx) => {
            const safeStatus = allStatuses.includes(story.status) ? story.status : 'planned';

            const storyDiv = document.createElement('div');
            storyDiv.className = 'import-story' + (!story._included ? ' excluded' : '');
            storyDiv.dataset.status = safeStatus;

            const sCb = document.createElement('input');
            sCb.type = 'checkbox';
            sCb.checked = story._included;
            sCb.dataset.storyIdx = storyIdx;
            sCb.addEventListener('change', (e) => {
                story._included = e.target.checked;
                storyDiv.classList.toggle('excluded', !e.target.checked);
                updateCountFn();
            });

            const sKey = document.createElement('span');
            sKey.className = 'import-issue-key';
            sKey.textContent = story.key;

            const sName = document.createElement('span');
            sName.className = 'import-story-name';
            sName.textContent = story.summary;

            const sBadge = document.createElement('span');
            sBadge.className = 'import-status-badge ' + safeStatus;
            sBadge.textContent = statusDisplayNames[safeStatus] || safeStatus;

            storyDiv.append(sCb, sKey, sName, sBadge);

            if (story.points != null) {
                const pts = document.createElement('span');
                pts.className = 'import-points-badge';
                pts.textContent = story.points + ' pts';
                storyDiv.append(pts);
            }

            storiesDiv.append(storyDiv);
        });

        epicDiv.append(header, storiesDiv);
        container.append(epicDiv);
    });
};

// ==================== Shared Import Count ====================

export const updateImportCount = (epics, countEl, opts = {}) => {
    let epicCount = 0, storyCount = 0;
    epics.forEach(epic => {
        if (!epic._included) return;
        epicCount++;
        storyCount += epic.stories.filter(s => s._included).length;
    });
    const groupLabel = opts.groupLabel || (epicCount !== 1 ? 'epics' : 'epic');
    const itemLabel = opts.itemLabel || (storyCount !== 1 ? 'stories' : 'story');
    countEl.textContent = `Importing ${epicCount} ${groupLabel}, ${storyCount} ${itemLabel}`;
};

// ==================== Shared Storymap Builder ====================

export const buildStorymapFromImport = (epics, projectName, buildUrlFn, opts = {}) => {
    const entityName = opts.entityName || 'epic';
    const allCards = [];
    let groupIndex = 0;

    epics.forEach(epic => {
        if (!epic._included) return;
        const isGroup = !!epic.key;
        const tag = isGroup ? `${entityName}-${String(++groupIndex).padStart(2, '0')}` : null;

        if (isGroup) {
            const card = { name: epic.summary, color: CARD_COLORS.lime, tags: [tag] };
            if (epic.description) card.body = epic.description;
            if (epic.status) card.status = epic.status;
            if (epic.points != null) card.points = epic.points;
            const url = buildUrlFn(epic.key);
            if (url) card.url = url;
            allCards.push(card);
        }

        epic.stories.forEach(story => {
            if (!story._included) return;
            const card = { name: story.summary };
            const tags = [];
            if (tag) tags.push(`${tag}-task`);
            if (story.labels?.length) tags.push(...story.labels);
            if (tags.length) card.tags = tags;
            if (story.description) card.body = story.description;
            if (story.status) card.status = story.status;
            if (story.points != null) card.points = story.points;
            const url = buildUrlFn(story.key);
            if (url) card.url = url;
            allCards.push(card);
        });
    });

    if (allCards.length === 0) return { app: 'storymap', v: 1, name: projectName + ' Import', steps: [], users: [], activities: [], slices: [] };

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

    const sliceLabel = opts.sliceLabel || 'IMPORTED: Epics & stories';
    return {
        app: 'storymap',
        v: 1,
        name: projectName + ' Import',
        steps,
        users,
        activities,
        slices: [
            { name: 'MVP', stories: Array.from({ length: cols }, () => []) },
            { name: sliceLabel, stories: grid }
        ]
    };
};
