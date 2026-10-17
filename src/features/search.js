// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Search and filter panel

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { el, CARD_COLORS, DEFAULT_CARD_COLORS, STATUS_OPTIONS } from '/src/core/constants.js';
import { getAllTagsInMap } from '/src/ui/ui.js';

let searchDebounceTimer = null;
const filterState = { statuses: new Set(), colors: new Set(), tags: new Set() };

export const openSearch = () => {
    if (dom.searchBtn.disabled) return;
    dom.searchBar.classList.remove('hidden');
    dom.boardName.style.display = 'none';
    dom.storyMap.classList.add('search-active');
    dom.searchInput.focus();
};

export const closeSearch = () => {
    dom.searchBar.classList.add('hidden');
    dom.boardName.style.display = '';
    dom.storyMap.classList.remove('search-active');
    dom.searchInput.value = '';
    closeFilterPanel();
    clearAllFilters();
    clearSearchFilter();
};

export const clearSearchFilter = () => {
    dom.storyMap.querySelectorAll('.search-dimmed').forEach(el => el.classList.remove('search-dimmed'));
};

export const hasActiveFilters = () => filterState.statuses.size > 0 || filterState.colors.size > 0 || filterState.tags.size > 0;

// Look up the state object for a card element
export const getItemForStep = (step) => {
    const colId = step.dataset.columnId;
    const mainCol = state.columns.find(c => c.id === colId);
    if (mainCol) return mainCol;
    for (const pm of state.partialMaps) {
        const pmCol = pm.columns.find(c => c.id === colId);
        if (pmCol) return pmCol;
    }
    return undefined;
};

export const getItemForStoryCard = (card) => {
    const storyId = card.dataset.storyId;
    const sliceId = card.dataset.sliceId;
    const colId = card.dataset.columnId;
    const rowType = card.dataset.rowType;
    if (rowType === 'users') {
        const main = state.users[colId]?.find(s => s.id === storyId);
        if (main) return main;
        for (const pm of state.partialMaps) {
            const found = pm.users?.[colId]?.find(s => s.id === storyId);
            if (found) return found;
        }
        return undefined;
    }
    if (rowType === 'activities') {
        const main = state.activities[colId]?.find(s => s.id === storyId);
        if (main) return main;
        for (const pm of state.partialMaps) {
            const found = pm.activities?.[colId]?.find(s => s.id === storyId);
            if (found) return found;
        }
        return undefined;
    }
    const slice = state.slices.find(s => s.id === sliceId);
    const mainStory = slice?.stories[colId]?.find(s => s.id === storyId);
    if (mainStory) return mainStory;
    for (const pm of state.partialMaps) {
        const found = pm.stories?.[sliceId]?.[colId]?.find(s => s.id === storyId);
        if (found) return found;
    }
    return undefined;
};

export const itemMatchesFilters = (item) => {
    if (!item) return false;
    if (filterState.statuses.size > 0) {
        const itemStatus = item.status || 'none';
        if (!filterState.statuses.has(itemStatus)) return false;
    }
    if (filterState.colors.size > 0) {
        const itemColor = (item.color || DEFAULT_CARD_COLORS.story).toLowerCase();
        if (!filterState.colors.has(itemColor)) return false;
    }
    if (filterState.tags.size > 0) {
        const itemTags = item.tags || [];
        if (!itemTags.some(t => filterState.tags.has(t))) return false;
    }
    return true;
};

export const applySearchFilter = (query) => {
    clearSearchFilter();
    const q = query?.toLowerCase() || '';
    const filtering = hasActiveFilters();

    if (!q && !filtering) return;

    // Dim non-matching step cards
    dom.storyMap.querySelectorAll('.step').forEach(step => {
        const text = step.querySelector('.step-text')?.value?.toLowerCase() || '';
        const textMatch = !q || text.includes(q);
        const filterMatch = !filtering || itemMatchesFilters(getItemForStep(step));
        if (!textMatch || !filterMatch) step.classList.add('search-dimmed');
    });

    // Dim non-matching story cards
    dom.storyMap.querySelectorAll('.story-card').forEach(card => {
        const text = (card.querySelector('.story-text')?.value
            || card.querySelector('.story-text-preview')?.textContent || '').toLowerCase();
        const textMatch = !q || text.includes(q);
        const filterMatch = !filtering || itemMatchesFilters(getItemForStoryCard(card));
        if (!textMatch || !filterMatch) card.classList.add('search-dimmed');
    });
};

// Filter panel
const getUsedStatusesAndColors = () => {
    const statuses = new Set();
    const colors = new Set();
    state.columns.forEach(c => { if (c.color && !c.hidden) colors.add(c.color.toLowerCase()); });
    const addFromCards = (cards) => {
        cards.forEach(s => {
            if (s.status) statuses.add(s.status);
            else statuses.add('none');
            colors.add((s.color || DEFAULT_CARD_COLORS.story).toLowerCase());
        });
    };
    Object.values(state.users || {}).forEach(addFromCards);
    Object.values(state.activities || {}).forEach(addFromCards);
    state.slices.forEach(slice => {
        Object.values(slice.stories || {}).forEach(addFromCards);
    });
    (state.partialMaps || []).forEach(pm => {
        pm.columns.forEach(c => { if (c.color && !c.hidden) colors.add(c.color.toLowerCase()); });
        Object.values(pm.users || {}).forEach(addFromCards);
        Object.values(pm.activities || {}).forEach(addFromCards);
        Object.values(pm.stories || {}).forEach(sliceStories => {
            Object.values(sliceStories).forEach(addFromCards);
        });
    });
    return { statuses, colors };
};

const populateFilterPanel = () => {
    const used = getUsedStatusesAndColors();
    // Status checkboxes
    dom.filterStatusList.innerHTML = '';
    const statusEntries = [['none', 'No Status', '#e5e5e5'], ...Object.entries(STATUS_OPTIONS).map(([k, v]) => [k, v.label, v.color])];
    statusEntries.forEach(([key, label, color]) => {
        const inUse = used.statuses.has(key);
        const lbl = el('label', 'filter-checkbox');
        if (!inUse) lbl.classList.add('filter-disabled');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = filterState.statuses.has(key);
        cb.disabled = !inUse;
        const dot = el('span', 'filter-status-dot');
        dot.style.backgroundColor = color;
        const text = el('span', null, { text: label });
        cb.addEventListener('change', () => {
            if (cb.checked) filterState.statuses.add(key); else filterState.statuses.delete(key);
            updateFilterCountBadge();
            applySearchFilter(dom.searchInput.value.trim());
        });
        lbl.append(cb, dot, text);
        dom.filterStatusList.appendChild(lbl);
    });

    // Color swatches
    dom.filterColorList.innerHTML = '';
    const colorEntries = Object.entries(CARD_COLORS);
    // Cards from older samples or imports can use colors outside the palette; give those a swatch too
    const paletteHexes = new Set(colorEntries.map(([, hex]) => hex.toLowerCase()));
    used.colors.forEach(hex => { if (!paletteHexes.has(hex)) colorEntries.push([hex, hex]); });
    const usedColors = colorEntries.filter(([, hex]) => used.colors.has(hex.toLowerCase()));
    const unusedColors = colorEntries.filter(([, hex]) => !used.colors.has(hex.toLowerCase()));
    [...usedColors, ...unusedColors].forEach(([name, hex]) => {
        const inUse = used.colors.has(hex.toLowerCase());
        const swatch = el('button', 'filter-color-swatch', { title: name });
        swatch.style.backgroundColor = hex;
        if (!inUse) { swatch.classList.add('filter-disabled'); swatch.disabled = true; }
        if (filterState.colors.has(hex.toLowerCase())) swatch.classList.add('selected');
        swatch.addEventListener('click', () => {
            const lc = hex.toLowerCase();
            if (filterState.colors.has(lc)) {
                filterState.colors.delete(lc);
                swatch.classList.remove('selected');
            } else {
                filterState.colors.add(lc);
                swatch.classList.add('selected');
            }
            updateFilterCountBadge();
            applySearchFilter(dom.searchInput.value.trim());
        });
        dom.filterColorList.appendChild(swatch);
    });

    // Tag checkboxes
    dom.filterTagsList.innerHTML = '';
    const allTags = getAllTagsInMap();
    if (allTags.length === 0) {
        dom.filterTagsList.appendChild(el('span', 'filter-empty', { text: 'No tags in map' }));
    } else {
        allTags.forEach(tag => {
            const lbl = el('label', 'filter-checkbox');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = filterState.tags.has(tag);
            const text = el('span', null, { text: tag });
            cb.addEventListener('change', () => {
                if (cb.checked) filterState.tags.add(tag); else filterState.tags.delete(tag);
                updateFilterCountBadge();
                applySearchFilter(dom.searchInput.value.trim());
            });
            lbl.append(cb, text);
            dom.filterTagsList.appendChild(lbl);
        });
    }
};

const openFilterPanel = () => {
    populateFilterPanel();
    dom.filterPanel.classList.remove('hidden');
    dom.searchFilterBtn.classList.add('active');
};

export const closeFilterPanel = () => {
    dom.filterPanel.classList.add('hidden');
    dom.searchFilterBtn.classList.remove('active');
};

const toggleFilterPanel = () => {
    if (dom.filterPanel.classList.contains('hidden')) openFilterPanel(); else closeFilterPanel();
};

const updateFilterCountBadge = () => {
    const count = filterState.statuses.size + filterState.colors.size + filterState.tags.size;
    dom.filterCount.textContent = count;
    dom.filterCount.classList.toggle('hidden', count === 0);
    dom.searchFilterBtn.classList.toggle('has-filters', count > 0);
};

const clearAllFilters = () => {
    filterState.statuses.clear();
    filterState.colors.clear();
    filterState.tags.clear();
    updateFilterCountBadge();
    applySearchFilter(dom.searchInput.value.trim());
};

export const initListeners = () => {
    // Search
    dom.searchBtn.addEventListener('click', openSearch);
    dom.searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => applySearchFilter(dom.searchInput.value.trim()), 150);
    });
    dom.searchClose.addEventListener('click', closeSearch);

    // Filter panel
    dom.searchFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilterPanel();
    });
    dom.filterClearBtn.addEventListener('click', () => {
        clearAllFilters();
        populateFilterPanel();
    });
    dom.filterPanel.addEventListener('click', (e) => e.stopPropagation());
    dom.filterDoneBtn.addEventListener('click', closeFilterPanel);
};
