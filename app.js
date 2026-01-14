// =============================================================================
// Utils
// =============================================================================

const generateId = () => Math.random().toString(36).substring(2, 9);

const isValidUrl = (url) => {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

const CARD_COLORS = {
    yellow: '#fef08a',
    green: '#86efac',
    teal: '#5eead4',
    blue: '#93c5fd',
    pink: '#fda4af',
    purple: '#d8b4fe',
    orange: '#fed7aa'
};

const STATUS_OPTIONS = {
    done: { label: 'Done', color: '#22c55e' },
    'in-progress': { label: 'In Progress', color: '#eab308' },
    planned: { label: 'Planned', color: '#f97316' }
};

const el = (tag, className, attrs = {}) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attrs).forEach(([key, value]) => {
        if (value == null) return; // Skip null/undefined for all attributes
        if (key === 'text') element.textContent = value;
        else if (key === 'html') element.innerHTML = value;
        else if (key.startsWith('data-')) {
            // kebab-case: data-column-id -> columnId
            const dataKey = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            element.dataset[dataKey] = value;
        }
        else if (key.startsWith('data') && key.length > 4) {
            // camelCase: dataColumnId -> columnId
            element.dataset[key.charAt(4).toLowerCase() + key.slice(5)] = value;
        }
        else if (key.startsWith('aria')) {
            // Special cases for ARIA attributes that don't follow simple lowercase
            const ariaMap = { ariaHasPopup: 'aria-haspopup' };
            const ariaKey = ariaMap[key] || 'aria-' + key.slice(4).toLowerCase();
            element.setAttribute(ariaKey, String(value));
        }
        else element[key] = value;
    });
    return element;
};

// =============================================================================
// State
// =============================================================================

const state = {
    name: '',
    columns: [],
    slices: []
};

const initState = () => {
    const column = createColumn('New Step/Task', null, null, false);
    state.name = '';
    state.columns = [column];
    state.slices = [
        { id: generateId(), name: '', separator: false, rowType: 'Personas', stories: { [column.id]: [createStory('User Type', '#fda4af')] } },
        { id: generateId(), name: '', separator: false, rowType: 'Activities', stories: { [column.id]: [createStory('New Activity', '#93c5fd')] } },
        { id: generateId(), name: '', separator: true, rowType: null, stories: { [column.id]: [createStory('New User Story')] } }
    ];
};

const hasContent = () => {
    if (state.name) return true;
    if (state.columns.some(s => s.name)) return true;
    if (state.slices.some(s => s.name)) return true;
    for (const slice of state.slices) {
        for (const stories of Object.values(slice.stories)) {
            if (stories.length > 0) return true;
        }
    }
    return false;
};

const confirmOverwrite = () => {
    return !hasContent() || confirm('This will replace your current story map. Continue?');
};

const createColumn = (name = '', color = null, url = null, hidden = false, status = null) => ({ id: generateId(), name, color, url, hidden, status });
const createStory = (name = '', color = null, url = null, hidden = false, status = null) => ({ id: generateId(), name, color, url, hidden, status });
const createSlice = (name = '', separator = true, rowType = null) => {
    const slice = { id: generateId(), name, separator, rowType, stories: {} };
    state.columns.forEach(s => slice.stories[s.id] = []);
    return slice;
};

// =============================================================================
// DOM References
// =============================================================================

const dom = {
    storyMap: document.getElementById('storyMap'),
    boardName: document.getElementById('boardName'),
    newMapBtn: document.getElementById('newMapBtn'),
    importBtn: document.getElementById('importMap'),
    exportBtn: document.getElementById('exportMap'),
    printBtn: document.getElementById('printMap'),
    fileInput: document.getElementById('fileInput'),
    samplesBtn: document.getElementById('samplesBtn'),
    samplesMenu: document.getElementById('samplesMenu'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    zoomReset: document.getElementById('zoomReset')
};

// Zoom state
let zoomLevel = 1;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;

const updateZoom = () => {
    dom.storyMap.style.transform = `scale(${zoomLevel})`;
    dom.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
};

// =============================================================================
// UI Components
// =============================================================================

const createDeleteBtn = (onConfirm, message) => {
    const btn = el('button', 'btn-delete', { html: '&#128465;', title: 'Delete', ariaLabel: 'Delete' });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(message)) onConfirm();
    });
    return btn;
};

const createOptionsMenu = (item, colors, onDelete, deleteMessage, onColorChange, onUrlChange, onStatusChange = null, onHide = null, onDeleteColumn = null) => {
    const container = el('div', 'card-options');

    const btn = el('button', 'btn-options', { text: '...', title: 'Options', ariaLabel: 'Options menu', ariaHasPopup: 'true', ariaExpanded: 'false' });
    const menu = el('div', 'options-menu');

    // Color option
    const colorOption = el('div', 'options-item options-color');
    colorOption.appendChild(el('span', null, { text: 'Color' }));
    const colorSwatches = el('div', 'color-swatches');
    Object.entries(colors).forEach(([name, hex]) => {
        const swatch = el('button', 'color-swatch', { title: name });
        swatch.style.backgroundColor = hex;
        if (item.color === hex) swatch.classList.add('selected');
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onColorChange(hex);
            menu.classList.remove('visible');
        });
        colorSwatches.appendChild(swatch);
    });
    colorOption.appendChild(colorSwatches);
    menu.appendChild(colorOption);

    // Status option
    if (onStatusChange) {
        const statusOption = el('div', 'options-item options-status');
        statusOption.appendChild(el('span', null, { text: 'Status' }));
        const statusSwatches = el('div', 'status-swatches');

        // Add "none" option to clear status
        const noneSwatch = el('button', 'status-swatch status-none', { title: 'None', text: '×' });
        if (!item.status) noneSwatch.classList.add('selected');
        noneSwatch.addEventListener('click', (e) => {
            e.stopPropagation();
            onStatusChange(null);
            menu.classList.remove('visible');
        });
        statusSwatches.appendChild(noneSwatch);

        Object.entries(STATUS_OPTIONS).forEach(([key, { label, color }]) => {
            const swatch = el('button', 'status-swatch', { title: label });
            swatch.style.backgroundColor = color;
            if (item.status === key) swatch.classList.add('selected');
            swatch.addEventListener('click', (e) => {
                e.stopPropagation();
                onStatusChange(key);
                menu.classList.remove('visible');
            });
            statusSwatches.appendChild(swatch);
        });
        statusOption.appendChild(statusSwatches);
        menu.appendChild(statusOption);
    }

    // URL option
    const urlOption = el('button', 'options-item', { text: item.url ? 'Edit URL...' : 'Add URL...' });
    urlOption.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = prompt('Enter URL (https:// or http://):', item.url || '');
        if (url !== null) {
            if (url === '' || isValidUrl(url)) {
                onUrlChange(url);
            } else {
                alert('Invalid URL. Please enter a valid http:// or https:// URL.');
            }
        }
        menu.classList.remove('visible');
    });
    menu.appendChild(urlOption);

    // Hide header option (for steps only)
    if (onHide) {
        const hideOption = el('button', 'options-item', { text: 'Hide Header' });
        hideOption.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.remove('visible');
            onHide();
        });
        menu.appendChild(hideOption);
    }

    // Delete option
    const deleteOption = el('button', 'options-item options-delete', { text: 'Delete' });
    deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('visible');
        if (deleteMessage) {
            if (confirm(deleteMessage)) onDelete();
        } else {
            onDelete();
        }
    });
    menu.appendChild(deleteOption);

    // Delete column option (for step cards only)
    if (onDeleteColumn) {
        const deleteColumnOption = el('button', 'options-item options-delete-column', { text: 'Delete Column' });
        deleteColumnOption.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.remove('visible');
            if (confirm('Delete this column and all its stories?')) {
                onDeleteColumn();
            }
        });
        menu.appendChild(deleteColumnOption);
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other open menus and reset their aria-expanded
        document.querySelectorAll('.options-menu.visible').forEach(m => {
            if (m !== menu) {
                m.classList.remove('visible');
                m.closest('.step, .story-card')?.classList.remove('menu-open');
                m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
            }
        });
        const isOpen = menu.classList.toggle('visible');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        // Elevate the card's z-index when menu is open
        const card = container.closest('.step, .story-card');
        if (isOpen) {
            card?.classList.add('menu-open');
        } else {
            card?.classList.remove('menu-open');
        }
    });

    container.append(btn, menu);
    return container;
};

const createUrlIndicator = (url) => {
    if (!isValidUrl(url)) return null;
    const indicator = el('a', 'url-indicator', {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: url,
        html: '&#127760;' // Globe emoji
    });
    indicator.addEventListener('click', (e) => e.stopPropagation());
    return indicator;
};

const createTextarea = (className, placeholder, value, onChange) => {
    const textarea = el('textarea', className, { placeholder, value, rows: 2 });
    textarea.addEventListener('input', (e) => {
        onChange(e.target.value);
        debouncedSave();
    });
    return textarea;
};

const createColumnPlaceholder = (column) => {
    const placeholder = el('div', 'step-placeholder', { dataColumnId: column.id, title: 'Click to show step' });

    // Click to show the step
    placeholder.addEventListener('click', () => {
        column.hidden = false;
        render();
        saveToStorage();
    });

    return placeholder;
};

const createColumnCard = (column) => {
    // Render placeholder for hidden steps
    if (column.hidden) {
        return createColumnPlaceholder(column);
    }

    const card = el('div', 'step', { dataColumnId: column.id });
    if (column.color) card.style.backgroundColor = column.color;

    const textarea = createTextarea('step-text', 'Step...', column.name,
        (val) => column.name = val);

    const optionsMenu = createOptionsMenu(
        column,
        CARD_COLORS,
        () => {
            column.hidden = true;
            render();
            saveToStorage();
        },
        `Delete "${column.name || 'this step'}"?`,
        (color) => {
            column.color = color;
            render();
            saveToStorage();
        },
        (url) => {
            column.url = url || null;
            render();
            saveToStorage();
        },
        (status) => {
            column.status = status;
            render();
            saveToStorage();
        },
        null, // onHide - not used for step cards (Delete already hides)
        () => deleteColumn(column.id)
    );

    card.append(textarea, optionsMenu);

    const urlIndicator = createUrlIndicator(column.url);
    if (urlIndicator) card.appendChild(urlIndicator);

    // Status indicator
    if (column.status && STATUS_OPTIONS[column.status]) {
        const statusIndicator = el('div', 'status-indicator', { title: STATUS_OPTIONS[column.status].label });
        statusIndicator.style.backgroundColor = STATUS_OPTIONS[column.status].color;
        card.appendChild(statusIndicator);
    }

    return card;
};

const createStoryPlaceholder = (story) => {
    const placeholder = el('div', 'story-placeholder', { dataStoryId: story.id, title: 'Click to show card' });

    // Click to show the card
    placeholder.addEventListener('click', () => {
        story.hidden = false;
        render();
        saveToStorage();
    });

    return placeholder;
};

const createStoryCard = (story, columnId, sliceId, isBackboneRow = false) => {
    // Show placeholder for hidden stories in backbone rows
    if (story.hidden && isBackboneRow) {
        return createStoryPlaceholder(story);
    }

    const card = el('div', 'story-card', {
        dataStoryId: story.id,
        dataColumnId: columnId,
        dataSliceId: sliceId,
        draggable: true
    });
    if (story.color) card.style.backgroundColor = story.color;

    card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', JSON.stringify({
            storyId: story.id,
            fromColumnId: columnId,
            fromSliceId: sliceId
        }));
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
    });

    const placeholderText = isBackboneRow ? 'Card...' : 'User story...';
    const textarea = createTextarea('story-text', placeholderText, story.name,
        (val) => story.name = val);

    // For backbone rows, delete just hides; for regular slices, delete removes
    const onDelete = isBackboneRow
        ? () => { story.hidden = true; render(); saveToStorage(); }
        : () => deleteStory(columnId, sliceId, story.id);
    const deleteMessage = isBackboneRow
        ? `Delete "${story.name || 'this card'}"?`
        : `Delete "${story.name || 'this story'}"?`;

    const optionsMenu = createOptionsMenu(
        story,
        CARD_COLORS,
        onDelete,
        deleteMessage,
        (color) => {
            story.color = color;
            render();
            saveToStorage();
        },
        (url) => {
            story.url = url || null;
            render();
            saveToStorage();
        },
        (status) => {
            story.status = status;
            render();
            saveToStorage();
        },
        null, // onHide - not used
        isBackboneRow ? () => deleteColumn(columnId) : null
    );

    card.append(textarea, optionsMenu);

    const urlIndicator = createUrlIndicator(story.url);
    if (urlIndicator) card.appendChild(urlIndicator);

    // Status indicator
    if (story.status && STATUS_OPTIONS[story.status]) {
        const statusIndicator = el('div', 'status-indicator', { title: STATUS_OPTIONS[story.status].label });
        statusIndicator.style.backgroundColor = STATUS_OPTIONS[story.status].color;
        card.appendChild(statusIndicator);
    }

    return card;
};

const createStoryColumn = (col, slice) => {
    const columnEl = el('div', 'story-column', {
        dataColumnId: col.id,
        dataSliceId: slice.id
    });

    const isBackboneRow = slice.separator === false;

    if (!slice.stories[col.id]) slice.stories[col.id] = [];

    slice.stories[col.id].forEach(story => {
        columnEl.appendChild(createStoryCard(story, col.id, slice.id, isBackboneRow));
    });

    // For backbone rows with no cards, make column clickable to add a card
    if (isBackboneRow && slice.stories[col.id].length === 0) {
        columnEl.classList.add('empty-backbone-column');
        columnEl.addEventListener('click', (e) => {
            if (e.target === columnEl) {
                addStory(col.id, slice.id);
            }
        });
    }

    columnEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        columnEl.classList.add('drag-over');

        const dragging = document.querySelector('.dragging');
        if (!dragging) return;

        const cards = [...columnEl.querySelectorAll('.story-card:not(.dragging)')];
        const afterElement = cards.find(card => {
            const rect = card.getBoundingClientRect();
            return e.clientY < rect.top + rect.height / 2;
        });

        if (afterElement) {
            columnEl.insertBefore(dragging, afterElement);
        } else {
            const addBtn = columnEl.querySelector('.btn-add-story');
            columnEl.insertBefore(dragging, addBtn);
        }
    });

    columnEl.addEventListener('dragleave', (e) => {
        if (!columnEl.contains(e.relatedTarget)) {
            columnEl.classList.remove('drag-over');
        }
    });

    columnEl.addEventListener('drop', (e) => {
        e.preventDefault();
        columnEl.classList.remove('drag-over');

        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const toColumnId = col.id;
        const toSliceId = slice.id;

        const dragging = document.querySelector('.dragging');
        const cards = [...columnEl.querySelectorAll('.story-card:not(.dragging)')];
        const dropIndex = cards.findIndex(card => {
            const rect = card.getBoundingClientRect();
            return e.clientY < rect.top + rect.height / 2;
        });

        moveStory(data.storyId, data.fromColumnId, data.fromSliceId, toColumnId, toSliceId, dropIndex === -1 ? cards.length : dropIndex);
    });

    const addBtn = el('button', 'btn-add-story', { text: '+' });
    addBtn.addEventListener('click', () => addStory(col.id, slice.id));
    columnEl.appendChild(addBtn);

    return columnEl;
};

const createEmptyBackboneRow = (rowType, insertIndex) => {
    const containerClass = rowType === 'Personas' ? 'personas-row empty-backbone-row' :
                           rowType === 'Activities' ? 'activities-row empty-backbone-row' :
                           'backbone-row empty-backbone-row';
    const container = el('div', containerClass);

    // Label container
    const labelContainer = el('div', 'row-label-container');
    const label = el('span', 'row-type-label', { text: rowType });
    labelContainer.appendChild(label);
    container.appendChild(labelContainer);

    // Stories area with empty clickable columns
    const storiesArea = el('div', 'slice-stories-area');
    const storiesRow = el('div', 'stories-row');

    state.columns.forEach(col => {
        const columnEl = el('div', 'story-column empty-backbone-column', {
            dataColumnId: col.id
        });
        columnEl.addEventListener('click', () => {
            // Create the backbone row and add a card in this column
            const newSlice = addSlice(insertIndex, false, rowType);
            addStory(col.id, newSlice.id);
        });
        storiesRow.appendChild(columnEl);
    });

    // Add column button
    const addColumnBtn = el('button', 'btn-add-column-inline', { text: '+', title: 'Add Step' });
    addColumnBtn.addEventListener('click', () => addColumn(true));
    storiesRow.appendChild(addColumnBtn);

    storiesArea.appendChild(storiesRow);
    container.appendChild(storiesArea);

    return container;
};

const createSliceContainer = (slice, index) => {
    // Use semantic class names based on row type
    let containerClass = 'slice-container';
    if (slice.separator === false) {
        containerClass = slice.rowType === 'Personas' ? 'personas-row' :
                         slice.rowType === 'Activities' ? 'activities-row' :
                         'backbone-row';
    }
    const container = el('div', containerClass, { dataSliceId: slice.id });

    container.addEventListener('dragstart', (e) => {
        if (e.target !== container) return;
        container.classList.add('slice-dragging');
        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'slice', sliceId: slice.id }));
        e.dataTransfer.effectAllowed = 'move';
    });

    container.addEventListener('dragend', () => {
        container.classList.remove('slice-dragging');
        container.draggable = false;
        document.querySelectorAll('.slice-drag-over').forEach(el => el.classList.remove('slice-drag-over'));
    });

    container.addEventListener('dragover', (e) => {
        const data = e.dataTransfer.types.includes('text/plain');
        if (!data) return;
        e.preventDefault();
        container.classList.add('slice-drag-over');
    });

    container.addEventListener('dragleave', (e) => {
        if (!container.contains(e.relatedTarget)) {
            container.classList.remove('slice-drag-over');
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('slice-drag-over');

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.type === 'slice' && data.sliceId !== slice.id) {
                moveSlice(data.sliceId, slice.id);
            }
        } catch {}
    });

    // Label container (only for release slices, not backbone rows)
    if (slice.separator !== false) {
        const labelContainer = el('div', 'slice-label-container', { dataSliceId: slice.id });

        // Drag handle
        const dragHandle = el('div', 'slice-drag-handle', { html: '⋮⋮', title: 'Drag to reorder' });
        dragHandle.addEventListener('mousedown', () => container.draggable = true);
        dragHandle.addEventListener('mouseup', () => container.draggable = false);
        labelContainer.appendChild(dragHandle);

        if (state.slices.length > 1) {
            labelContainer.appendChild(createDeleteBtn(
                () => deleteSlice(slice.id),
                `Delete "${slice.name || 'this slice'}" and all its stories?`
            ));
        }

        const labelInput = createTextarea('slice-label', 'Release...', slice.name,
            (val) => slice.name = val);
        labelContainer.appendChild(labelInput);
        container.appendChild(labelContainer);
    } else {
        // Label container for backbone rows
        const labelContainer = el('div', 'row-label-container');

        // Row type label
        if (slice.rowType) {
            const label = el('span', 'row-type-label', { text: slice.rowType });
            labelContainer.appendChild(label);
        }

        // Delete button for rows
        const deleteBtn = createDeleteBtn(
            () => deleteSlice(slice.id),
            `Delete the ${slice.rowType || 'row'} row and all its cards?`
        );
        labelContainer.appendChild(deleteBtn);

        container.appendChild(labelContainer);
    }

    // Stories area
    const storiesArea = el('div', 'slice-stories-area');
    const storiesRow = el('div', 'stories-row');

    state.columns.forEach(col => {
        storiesRow.appendChild(createStoryColumn(col, slice));
    });

    // Add a "+" button to add new columns
    const addColumnBtn = el('button', 'btn-add-column-inline', { text: '+', title: 'Add Step' });
    addColumnBtn.addEventListener('click', () => addColumn(true));
    storiesRow.appendChild(addColumnBtn);
    storiesArea.appendChild(storiesRow);

    // Add slice button (only for release slices, not backbone rows)
    if (slice.separator !== false) {
        const addSliceRow = el('div', 'add-slice-row');
        const addSliceBtn = el('button', 'btn-add-slice', { text: '+ Add Slice' });
        addSliceBtn.addEventListener('click', () => addSlice(index + 1, true));
        addSliceRow.appendChild(addSliceBtn);
        storiesArea.appendChild(addSliceRow);
    }

    container.appendChild(storiesArea);
    return container;
};

// =============================================================================
// Rendering
// =============================================================================

const render = () => {
    dom.storyMap.innerHTML = '';

    // Separate backbone rows (Personas, Activities) from release slices
    const rows = [];
    const slices = [];
    state.slices.forEach((slice, index) => {
        if (slice.separator === false) {
            rows.push({ slice, index });
        } else {
            slices.push({ slice, index });
        }
    });

    // Check which row types exist
    const hasPersonas = rows.some(r => r.slice.rowType === 'Personas');
    const hasActivities = rows.some(r => r.slice.rowType === 'Activities');
    const personasRow = rows.find(r => r.slice.rowType === 'Personas');
    const activitiesRow = rows.find(r => r.slice.rowType === 'Activities');

    // Render Personas row (or empty placeholder)
    if (personasRow) {
        dom.storyMap.appendChild(createSliceContainer(personasRow.slice, personasRow.index));
    } else {
        dom.storyMap.appendChild(createEmptyBackboneRow('Personas', 0));
    }

    // Render Activities row (or empty placeholder)
    if (activitiesRow) {
        dom.storyMap.appendChild(createSliceContainer(activitiesRow.slice, activitiesRow.index));
    } else {
        const idx = hasPersonas ? personasRow.index + 1 : 0;
        dom.storyMap.appendChild(createEmptyBackboneRow('Activities', idx));
    }

    // Render any other backbone rows (non-Personas, non-Activities)
    rows.filter(r => r.slice.rowType !== 'Personas' && r.slice.rowType !== 'Activities')
        .forEach(({ slice, index }) => {
            dom.storyMap.appendChild(createSliceContainer(slice, index));
        });

    // Steps row (the backbone)
    const stepsRow = el('div', 'steps-row');
    const stepsLabel = el('div', 'steps-row-spacer');
    stepsLabel.appendChild(el('span', 'row-type-label', { text: 'Steps' }));
    stepsRow.appendChild(stepsLabel);

    state.columns.forEach(col => {
        stepsRow.appendChild(createColumnCard(col));
    });

    const addColumnBtn = el('button', 'btn-add-step-inline', { text: '+', title: 'Add Step' });
    addColumnBtn.addEventListener('click', () => addColumn(true));
    stepsRow.appendChild(addColumnBtn);

    dom.storyMap.appendChild(stepsRow);

    // Slices (releases) - render below steps
    slices.forEach(({ slice, index }) => {
        dom.storyMap.appendChild(createSliceContainer(slice, index));
    });
};

// =============================================================================
// State Mutations
// =============================================================================

const focusLastElement = (selector, textareaClass) => {
    const elements = dom.storyMap.querySelectorAll(selector);
    const last = elements[elements.length - 1];
    last?.querySelector(textareaClass)?.focus();
};

const addColumn = (hidden = true) => {
    const column = createColumn('', null, null, hidden);
    state.columns.push(column);
    state.slices.forEach(slice => slice.stories[column.id] = []);
    render();
    saveToStorage();
    if (!hidden) {
        focusLastElement('.step', '.step-text');
    }
};

// Default colors for card types
const DEFAULT_COLORS = {
    Personas: '#fda4af',    // pink
    Activities: '#93c5fd',  // blue
    story: '#fef08a'        // yellow (user stories)
};

const addStory = (columnId, sliceId) => {
    const slice = state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    // Set default color based on row type
    const defaultColor = slice.rowType ? DEFAULT_COLORS[slice.rowType] : null;

    slice.stories[columnId] = slice.stories[columnId] || [];
    slice.stories[columnId].push(createStory('', defaultColor));
    render();
    saveToStorage();

    const column = dom.storyMap.querySelector(
        `.story-column[data-column-id="${columnId}"][data-slice-id="${sliceId}"]`
    );
    column?.querySelectorAll('.story-card')[slice.stories[columnId].length - 1]
        ?.querySelector('.story-text')?.focus();
};

const addSlice = (afterIndex, separator = true, rowType = null) => {
    const slice = createSlice('', separator, rowType);
    state.slices.splice(afterIndex, 0, slice);
    render();
    saveToStorage();
    if (separator) {
        dom.storyMap.querySelectorAll('.slice-container')[afterIndex]
            ?.querySelector('.slice-label')?.focus();
    }
    return slice;
};

const deleteColumn = (columnId) => {
    if (state.columns.length <= 1) {
        alert('Cannot delete the last column.');
        return;
    }
    const index = state.columns.findIndex(s => s.id === columnId);
    if (index === -1) return;

    state.columns.splice(index, 1);
    state.slices.forEach(slice => delete slice.stories[columnId]);
    render();
    saveToStorage();
};

const deleteStory = (columnId, sliceId, storyId) => {
    const slice = state.slices.find(s => s.id === sliceId);
    const stories = slice?.stories[columnId];
    if (!stories) return;

    const index = stories.findIndex(s => s.id === storyId);
    if (index > -1) {
        stories.splice(index, 1);
        render();
        saveToStorage();
    }
};

const moveStory = (storyId, fromColumnId, fromSliceId, toColumnId, toSliceId, toIndex) => {
    const fromSlice = state.slices.find(s => s.id === fromSliceId);
    const toSlice = state.slices.find(s => s.id === toSliceId);
    if (!fromSlice || !toSlice) return;

    const fromStories = fromSlice.stories[fromColumnId];
    if (!fromStories) return;

    const storyIndex = fromStories.findIndex(s => s.id === storyId);
    if (storyIndex === -1) return;

    const [story] = fromStories.splice(storyIndex, 1);

    if (!toSlice.stories[toColumnId]) toSlice.stories[toColumnId] = [];

    // Adjust index if moving within same column (removal shifts indices)
    let adjustedIndex = toIndex;
    if (fromColumnId === toColumnId && fromSliceId === toSliceId && storyIndex < toIndex) {
        adjustedIndex = toIndex - 1;
    }

    toSlice.stories[toColumnId].splice(adjustedIndex, 0, story);
    render();
    saveToStorage();
};

const deleteSlice = (sliceId) => {
    if (state.slices.length <= 1) return;

    const index = state.slices.findIndex(s => s.id === sliceId);
    if (index > -1) {
        state.slices.splice(index, 1);
        render();
        saveToStorage();
    }
};

const moveSlice = (fromSliceId, toSliceId) => {
    const fromIndex = state.slices.findIndex(s => s.id === fromSliceId);
    const toIndex = state.slices.findIndex(s => s.id === toSliceId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [slice] = state.slices.splice(fromIndex, 1);
    state.slices.splice(toIndex, 0, slice);
    render();
    saveToStorage();
};

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY = 'storymap';

const saveToStorage = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
};

// Debounced save for frequent updates (e.g., typing)
let saveTimeout = null;
const debouncedSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToStorage, 300);
};
const flushSave = () => {
    clearTimeout(saveTimeout);
    saveToStorage();
};

const loadFromStorage = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            deserialize(JSON.parse(data));
            return true;
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }
    }
    return false;
};

// =============================================================================
// Serialization
// =============================================================================

const serialize = () => ({
    app: 'storymap',
    v: 1,
    exported: new Date().toISOString(),
    name: state.name,
    a: state.columns.map(s => {
        const obj = { n: s.name };
        if (s.color) obj.c = s.color;
        if (s.url) obj.u = s.url;
        if (s.hidden) obj.h = true;
        if (s.status) obj.st = s.status;
        return obj;
    }),
    s: state.slices.map(slice => {
        const obj = {
            n: slice.name,
            t: state.columns.map(s => (slice.stories[s.id] || []).map(story => {
                const sObj = { n: story.name };
                if (story.color) sObj.c = story.color;
                if (story.url) sObj.u = story.url;
                if (story.hidden) sObj.h = true;
                if (story.status) sObj.st = story.status;
                return sObj;
            }))
        };
        if (slice.separator === false) obj.sep = false;
        if (slice.rowType) obj.rt = slice.rowType;
        return obj;
    })
});

const deserialize = (data) => {
    if (data?.app !== 'storymap' || data?.v !== 1 || !Array.isArray(data.a) || !Array.isArray(data.s)) {
        throw new Error('Invalid format');
    }

    // Sanitize URL - only allow valid http/https URLs
    const sanitizeUrl = (url) => isValidUrl(url) ? url : null;

    state.name = data.name || '';
    state.columns = data.a.map(a => {
        // Support both old format (string) and new format (object with n, c, u, h, st)
        if (typeof a === 'string') return createColumn(a);
        return createColumn(a.n || '', a.c || null, sanitizeUrl(a.u), !!a.h, a.st || null);
    });
    state.slices = data.s.map(slice => {
        const newSlice = {
            id: generateId(),
            name: slice.n || '',
            separator: slice.sep !== false,
            rowType: slice.rt || null,
            stories: {}
        };
        const stories = Array.isArray(slice.t) ? slice.t : [];
        state.columns.forEach((col, i) => {
            newSlice.stories[col.id] = (stories[i] || []).map(t => {
                // Support both old format (string) and new format (object with n, c, u, h, st)
                if (typeof t === 'string') return createStory(t);
                return createStory(t.n || '', t.c || null, sanitizeUrl(t.u), !!t.h, t.st || null);
            });
        });
        return newSlice;
    });
    dom.boardName.value = state.name;
};

// =============================================================================
// Import / Export
// =============================================================================

const exportMap = () => {
    flushSave();
    const filename = prompt('Enter filename:', 'story-map');
    if (!filename) return;

    const json = JSON.stringify(serialize());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = el('a', null, {
        href: url,
        download: filename.endsWith('.json') ? filename : `${filename}.json`
    });
    link.click();
    URL.revokeObjectURL(url);
};

const importMap = (file) => {
    flushSave();
    if (!confirmOverwrite()) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            deserialize(JSON.parse(e.target.result));
            render();
            saveToStorage();
        } catch {
            alert('Failed to import: Invalid file format');
        }
    };
    reader.readAsText(file);
};

const loadSample = async (name) => {
    flushSave();
    if (!confirmOverwrite()) return;

    try {
        const response = await fetch(`samples/${name}.json`);
        if (!response.ok) throw new Error();
        deserialize(await response.json());
        render();
        saveToStorage();
    } catch {
        alert('Failed to load sample');
    }
};

const newMap = () => {
    flushSave();
    if (hasContent() && !confirm('Create a new story map?\n\nYour current work will be lost. Use Export to save it first if you want to keep your current board.')) {
        return;
    }
    initState();
    dom.boardName.value = '';
    render();
    saveToStorage();
};

// =============================================================================
// Event Listeners
// =============================================================================

const initEventListeners = () => {
    dom.boardName.addEventListener('input', (e) => {
        state.name = e.target.value;
        debouncedSave();
    });

    dom.boardName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dom.boardName.blur();
        }
    });

    dom.newMapBtn.addEventListener('click', newMap);
    dom.exportBtn.addEventListener('click', exportMap);
    dom.printBtn.addEventListener('click', () => window.print());
    dom.importBtn.addEventListener('click', () => dom.fileInput.click());

    // Zoom controls
    dom.zoomIn.addEventListener('click', () => {
        zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP);
        updateZoom();
    });
    dom.zoomOut.addEventListener('click', () => {
        zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP);
        updateZoom();
    });
    dom.zoomReset.addEventListener('click', () => {
        zoomLevel = 1;
        updateZoom();
    });
    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            importMap(e.target.files[0]);
            e.target.value = '';
        }
    });

    // Samples dropdown
    dom.samplesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.samplesMenu.classList.toggle('visible');
    });

    document.addEventListener('click', () => {
        dom.samplesMenu.classList.remove('visible');
        document.querySelectorAll('.options-menu.visible').forEach(m => {
            m.classList.remove('visible');
            m.closest('.step, .story-card')?.classList.remove('menu-open');
            m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dom.samplesMenu.classList.remove('visible');
            document.querySelectorAll('.options-menu.visible').forEach(m => {
                m.classList.remove('visible');
                m.closest('.step, .story-card')?.classList.remove('menu-open');
                m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
            });
        }
    });

    dom.samplesMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item?.dataset.sample) {
            loadSample(item.dataset.sample);
            dom.samplesMenu.classList.remove('visible');
        }
    });
};

// =============================================================================
// Initialize
// =============================================================================

const init = () => {
    if (!loadFromStorage()) {
        initState();
    }
    dom.boardName.value = state.name;
    initEventListeners();
    render();
};

init();
