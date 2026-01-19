// =============================================================================
// Firebase
// =============================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app-check.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { getDatabase, ref, set, onValue, onDisconnect, serverTimestamp as rtdbTimestamp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';
import { firebaseConfig, recaptchaSiteKey } from './config.js';

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);

// App Check - initialized lazily to speed up initial page load
let appCheckInitialized = false;
const initAppCheck = () => {
    if (appCheckInitialized) return;
    appCheckInitialized = true;
    initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true
    });
};

// Session ID to track who made changes (for real-time sync)
const getSessionId = () => {
    if (!sessionStorage.sessionId) {
        sessionStorage.sessionId = crypto.randomUUID();
    }
    return sessionStorage.sessionId;
};

// =============================================================================
// Presence Tracking
// =============================================================================

let presenceUnsubscribe = null;
let viewerCount = 0;

const updateViewerCountUI = (count) => {
    viewerCount = count;
    const badge = document.getElementById('viewerCount');
    if (badge) {
        if (count > 1) {
            badge.textContent = count;
            badge.classList.add('visible');
        } else {
            badge.classList.remove('visible');
        }
    }
};

const trackPresence = (mapId) => {
    if (!mapId) return;

    const sessionId = getSessionId();
    const presenceRef = ref(rtdb, `presence/${mapId}/${sessionId}`);
    const mapPresenceRef = ref(rtdb, `presence/${mapId}`);

    // Set presence data
    set(presenceRef, {
        online: true,
        lastSeen: rtdbTimestamp()
    });

    // Remove presence on disconnect
    onDisconnect(presenceRef).remove();

    // Clean up previous listener
    if (presenceUnsubscribe) {
        presenceUnsubscribe();
    }

    // Listen for all presence changes on this map
    presenceUnsubscribe = onValue(mapPresenceRef, (snapshot) => {
        const presenceData = snapshot.val();
        const count = presenceData ? Object.keys(presenceData).length : 0;
        updateViewerCountUI(count);
    });
};

const clearPresence = () => {
    if (presenceUnsubscribe) {
        presenceUnsubscribe();
        presenceUnsubscribe = null;
    }
    updateViewerCountUI(0);
};

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

// Default colors for card types (references CARD_COLORS values)
const DEFAULT_CARD_COLORS = {
    Personas: '#fda4af',    // pink
    Activities: '#93c5fd',  // blue
    story: '#fef08a'        // yellow
};

const STATUS_OPTIONS = {
    done: { label: 'Done', color: '#22c55e' },
    'in-progress': { label: 'In Progress', color: '#eab308' },
    planned: { label: 'Planned', color: '#f97316' }
};

const DEBOUNCE_DELAY = 300;
const MAGNIFIER_THRESHOLD = 0.75;
const ZOOM_LEVELS = [1, 0.75, 0.5, 0.25];

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
    mapId: null,
    name: '',
    columns: [],
    slices: []
};

// Undo/Redo stack (in-memory, lost on refresh)
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

const pushUndo = () => {
    undoStack.push(JSON.stringify(serialize()));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0; // Clear redo on new action
    updateUndoRedoButtons();
};

const undo = () => {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(serialize()));
    const previous = JSON.parse(undoStack.pop());
    deserialize(previous);
    dom.boardName.value = state.name;
    renderAndSave();
    updateUndoRedoButtons();
};

const redo = () => {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(serialize()));
    const next = JSON.parse(redoStack.pop());
    deserialize(next);
    dom.boardName.value = state.name;
    renderAndSave();
    updateUndoRedoButtons();
};

const updateUndoRedoButtons = () => {
    if (dom.undoBtn) dom.undoBtn.disabled = undoStack.length === 0;
    if (dom.redoBtn) dom.redoBtn.disabled = redoStack.length === 0;
};

const initState = () => {
    const column = createColumn('New Step', null, null, false);
    state.name = '';
    state.columns = [column];
    state.slices = [
        { id: generateId(), name: '', separator: false, rowType: 'Personas', stories: { [column.id]: [createStory('User Type', '#fda4af')] } },
        { id: generateId(), name: '', separator: false, rowType: 'Activities', stories: { [column.id]: [createStory('New Activity', '#93c5fd')] } },
        { id: generateId(), name: '', separator: true, rowType: null, stories: { [column.id]: [createStory('New Task')] } }
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
    logoLink: document.getElementById('logoLink'),
    storyMap: document.getElementById('storyMap'),
    boardName: document.getElementById('boardName'),
    newMapBtn: document.getElementById('newMapBtn'),
    importBtn: document.getElementById('importMap'),
    exportBtn: document.getElementById('exportMap'),
    printBtn: document.getElementById('printMap'),
    fileInput: document.getElementById('fileInput'),
    menuBtn: document.getElementById('menuBtn'),
    mainMenu: document.getElementById('mainMenu'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    zoomReset: document.getElementById('zoomReset'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    shareBtn: document.getElementById('shareBtn'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    welcomeNewBtn: document.getElementById('welcomeNewBtn'),
    storyMapWrapper: document.getElementById('storyMapWrapper'),
    samplesSubmenuTrigger: document.getElementById('samplesSubmenuTrigger'),
    samplesSubmenu: document.getElementById('samplesSubmenu'),
    navArrowLeft: document.getElementById('navArrowLeft'),
    navArrowRight: document.getElementById('navArrowRight'),
    zoomControls: document.getElementById('zoomControls'),
    magnifierToggle: document.getElementById('magnifierToggle'),
    loadingIndicator: document.getElementById('loadingIndicator')
};

// Menu helpers
const closeMainMenu = () => {
    dom.mainMenu.classList.remove('visible');
    dom.samplesSubmenu.classList.remove('visible');
    dom.samplesSubmenuTrigger.classList.remove('expanded');
};

const closeAllOptionsMenus = () => {
    document.querySelectorAll('.options-menu.visible').forEach(m => {
        m.classList.remove('visible');
        m.closest('.step, .story-card')?.classList.remove('menu-open');
        m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
    });
};

// Zoom state
let zoomLevel = 1;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;

const updateZoom = () => {
    dom.storyMap.style.transform = `scale(${zoomLevel})`;
    dom.zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
    updatePanMode();
    // Show magnifier toggle only when zoom is below threshold
    dom.magnifierToggle.classList.toggle('visible', zoomLevel < MAGNIFIER_THRESHOLD);
};

// =============================================================================
// Navigation Helpers
// =============================================================================

// Scroll element into view with padding
const scrollElementIntoView = (element) => {
    if (!element) return;
    const wrapper = dom.storyMapWrapper;
    const rect = element.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const padding = 100;

    // Check if element is outside visible area (accounting for zoom)
    const effectiveRight = (rect.right - wrapperRect.left) / zoomLevel;
    const effectiveBottom = (rect.bottom - wrapperRect.top) / zoomLevel;
    const visibleWidth = wrapper.clientWidth;
    const visibleHeight = wrapper.clientHeight;

    // Scroll right if element is beyond right edge
    if (effectiveRight > visibleWidth - padding) {
        wrapper.scrollLeft += (effectiveRight - visibleWidth + padding) * zoomLevel;
    }
    // Scroll down if element is beyond bottom edge
    if (effectiveBottom > visibleHeight - padding) {
        wrapper.scrollTop += (effectiveBottom - visibleHeight + padding) * zoomLevel;
    }
};

// Update navigation arrow visibility based on scroll position
const updateNavArrows = () => {
    const wrapper = dom.storyMapWrapper;
    const scrollLeft = wrapper.scrollLeft;
    const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;

    // Show/hide arrows based on scroll position
    if (maxScroll > 10) {
        dom.navArrowLeft.classList.toggle('visible', scrollLeft > 10);
        dom.navArrowRight.classList.toggle('visible', scrollLeft < maxScroll - 10);
    } else {
        dom.navArrowLeft.classList.remove('visible');
        dom.navArrowRight.classList.remove('visible');
    }
};

// Scroll by amount with smooth animation
const scrollByAmount = (amount) => {
    dom.storyMapWrapper.scrollBy({ left: amount, behavior: 'smooth' });
};

// Pan/drag state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

// Update pan mode based on zoom level
const updatePanMode = () => {
    if (zoomLevel < 1) {
        dom.storyMapWrapper.classList.add('pan-enabled');
    } else {
        dom.storyMapWrapper.classList.remove('pan-enabled');
    }
};

// Pan handlers
const startPan = (e) => {
    // Only enable pan when zoomed out and not clicking on interactive elements
    if (zoomLevel >= 1) return;
    if (e.target.closest('button, textarea, input, .story-card, .step, .options-menu')) return;

    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollLeft = dom.storyMapWrapper.scrollLeft;
    panScrollTop = dom.storyMapWrapper.scrollTop;
    dom.storyMapWrapper.classList.add('panning');
};

const doPan = (e) => {
    if (!isPanning) return;
    e.preventDefault();
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    dom.storyMapWrapper.scrollLeft = panScrollLeft - dx;
    dom.storyMapWrapper.scrollTop = panScrollTop - dy;
};

const endPan = () => {
    isPanning = false;
    dom.storyMapWrapper.classList.remove('panning');
};

// =============================================================================
// Magnifier (desktop only)
// =============================================================================

let magnifier = null;
let magnifierContent = null;
let magnifierEnabled = true;
const MAGNIFIER_WIDTH = 350;
const MAGNIFIER_HEIGHT = 200;
const MAGNIFIER_SCALE = 0.75;

const createMagnifier = () => {
    // Only create on desktop (non-touch devices)
    if (window.matchMedia('(pointer: coarse)').matches) return;

    magnifier = document.createElement('div');
    magnifier.className = 'magnifier';
    magnifierContent = document.createElement('div');
    magnifierContent.className = 'magnifier-content';
    magnifier.appendChild(magnifierContent);
    document.body.appendChild(magnifier);
};

const updateMagnifier = (e) => {
    if (!magnifier || !magnifierEnabled || zoomLevel >= MAGNIFIER_THRESHOLD || isPanning) {
        magnifier?.classList.remove('active');
        return;
    }

    const wrapperRect = dom.storyMapWrapper.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Check if mouse is over the story map wrapper
    if (mouseX < wrapperRect.left || mouseX > wrapperRect.right ||
        mouseY < wrapperRect.top || mouseY > wrapperRect.bottom) {
        magnifier.classList.remove('active');
        return;
    }

    magnifier.classList.add('active');

    // Position magnifier centered above cursor
    const offsetX = -MAGNIFIER_WIDTH / 2;
    const offsetY = -MAGNIFIER_HEIGHT - 15;
    const magLeft = mouseX + offsetX;
    const magTop = mouseY + offsetY;
    magnifier.style.left = `${magLeft}px`;
    magnifier.style.top = `${magTop}px`;

    // Clone the story map content if needed (lazy clone)
    if (magnifierContent.dataset.stale === 'true' || !magnifierContent.hasChildNodes()) {
        magnifierContent.innerHTML = '';
        const clone = dom.storyMap.cloneNode(true);
        clone.style.transform = 'none';
        magnifierContent.appendChild(clone);
        magnifierContent.dataset.stale = 'false';
    }

    // Get the map's position within the wrapper (accounts for margin: auto centering)
    const mapRect = dom.storyMap.getBoundingClientRect();

    // Calculate center of the magnifier rectangle on screen
    const magCenterX = magLeft + MAGNIFIER_WIDTH / 2;
    const magCenterY = magTop + MAGNIFIER_HEIGHT / 2;

    // Calculate position relative to the map (where the magnifier is, not the cursor)
    const mapX = (magCenterX - mapRect.left) / zoomLevel;
    const mapY = (magCenterY - mapRect.top) / zoomLevel;

    // Offset content so the magnifier center shows the zoomed view of that area
    const contentX = (MAGNIFIER_WIDTH / 2) / MAGNIFIER_SCALE - mapX;
    const contentY = (MAGNIFIER_HEIGHT / 2) / MAGNIFIER_SCALE - mapY;
    magnifierContent.style.transform = `scale(${MAGNIFIER_SCALE}) translate(${contentX}px, ${contentY}px)`;
};

const hideMagnifier = () => {
    magnifier?.classList.remove('active');
};

const toggleMagnifier = () => {
    magnifierEnabled = !magnifierEnabled;
    // Show X when enabled (to indicate clicking will disable), no X when disabled
    dom.magnifierToggle.innerHTML = magnifierEnabled ? '&#128269;&#10005;' : '&#128269;';
    if (!magnifierEnabled) {
        hideMagnifier();
    }
};

const refreshMagnifierContent = () => {
    // Mark as stale - actual refresh happens lazily when magnifier is shown
    if (magnifierContent) {
        magnifierContent.dataset.stale = 'true';
    }
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
    const isCardText = className === 'step-text' || className === 'story-text';
    const isSliceLabel = className === 'slice-label';
    const textarea = el('textarea', className, { placeholder, value, rows: isCardText ? 1 : (isSliceLabel ? 3 : 2) });

    if (isCardText) {
        const autoResize = () => {
            textarea.rows = 1;
            const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 18;
            const neededRows = Math.ceil(textarea.scrollHeight / lineHeight);
            textarea.rows = Math.min(Math.max(neededRows, 1), 3);
        };

        textarea.addEventListener('input', (e) => {
            onChange(e.target.value);
            autoResize();
            debouncedSave();
        });

        // Auto-resize on initial render
        requestAnimationFrame(autoResize);
    } else {
        textarea.addEventListener('input', (e) => {
            onChange(e.target.value);
            debouncedSave();
        });
    }

    return textarea;
};

const createColumnPlaceholder = (column) => {
    const placeholder = el('div', 'step-placeholder', { dataColumnId: column.id, title: 'Click to show step' });

    // Click to show the step
    placeholder.addEventListener('click', () => {
        column.hidden = false;
        renderAndSave();
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
            renderAndSave();
        },
        `Delete "${column.name || 'this step'}"?`,
        (color) => {
            column.color = color;
            renderAndSave();
        },
        (url) => {
            column.url = url || null;
            renderAndSave();
        },
        (status) => {
            column.status = status;
            renderAndSave();
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
        renderAndSave();
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
        dataSliceId: sliceId
    });
    if (story.color) card.style.backgroundColor = story.color;

    const placeholderText = isBackboneRow ? 'Card...' : 'Task...';
    const textarea = createTextarea('story-text', placeholderText, story.name,
        (val) => story.name = val);

    // For backbone rows, delete just hides; for regular slices, delete removes
    const onDelete = isBackboneRow
        ? () => { story.hidden = true; renderAndSave(); }
        : () => deleteStory(columnId, sliceId, story.id);
    const deleteMessage = isBackboneRow
        ? `Delete "${story.name || 'this card'}"?`
        : `Delete "${story.name || 'this task'}"?`;

    const optionsMenu = createOptionsMenu(
        story,
        CARD_COLORS,
        onDelete,
        deleteMessage,
        (color) => {
            story.color = color;
            renderAndSave();
        },
        (url) => {
            story.url = url || null;
            renderAndSave();
        },
        (status) => {
            story.status = status;
            renderAndSave();
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

    // Label container (only for release slices, not backbone rows)
    if (slice.separator !== false) {
        const labelContainer = el('div', 'slice-label-container', { dataSliceId: slice.id });

        // Drag handle for Sortable
        const dragHandle = el('div', 'slice-drag-handle', { html: '⋮⋮', title: 'Drag to reorder' });
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

    // Initialize Sortable for drag and drop
    initSortable();

    // Update navigation arrows after DOM settles
    setTimeout(updateNavArrows, 0);

    // Refresh magnifier content (if active)
    refreshMagnifierContent();
};

// Store Sortable instances to destroy on re-render
let sortableInstances = [];

const initSortable = () => {
    // Destroy previous instances
    sortableInstances.forEach(s => s.destroy());
    sortableInstances = [];

    // Make story cards sortable within and between columns
    document.querySelectorAll('.story-column').forEach(column => {
        const sortable = Sortable.create(column, {
            group: 'stories',
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '.btn-add-story',
            onEnd: (evt) => {
                const storyId = evt.item.dataset.storyId;
                const fromColumnId = evt.from.dataset.columnId;
                const fromSliceId = evt.from.dataset.sliceId;
                const toColumnId = evt.to.dataset.columnId;
                const toSliceId = evt.to.dataset.sliceId;
                const toIndex = evt.newIndex;

                // Only update state if something actually changed
                if (fromColumnId !== toColumnId || fromSliceId !== toSliceId || evt.oldIndex !== evt.newIndex) {
                    moveStory(storyId, fromColumnId, fromSliceId, toColumnId, toSliceId, toIndex);
                }
            }
        });
        sortableInstances.push(sortable);
    });

    // Make release slices sortable (not backbone rows)
    const sliceContainers = document.querySelectorAll('.slice-container');
    if (sliceContainers.length > 0) {
        const sortable = Sortable.create(dom.storyMap, {
            animation: 150,
            handle: '.slice-drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.slice-container',
            onEnd: () => {
                // After Sortable moved the DOM, read the new order directly from the DOM
                const sliceContainers = dom.storyMap.querySelectorAll('.slice-container');
                const releaseSlices = state.slices.filter(s => s.separator !== false);

                // Map DOM order to slice objects
                const newSliceOrder = [...sliceContainers].map(el =>
                    releaseSlices.find(s => s.id === el.dataset.sliceId)
                ).filter(Boolean);

                // Check if order actually changed
                const orderChanged = newSliceOrder.some((slice, i) => slice.id !== releaseSlices[i]?.id);
                if (!orderChanged) return;

                // Rebuild state.slices: backbone rows stay in place, release slices get new order
                let releaseIndex = 0;
                const newSlices = state.slices.map(s => {
                    if (s.separator === false) {
                        return s;
                    } else {
                        return newSliceOrder[releaseIndex++];
                    }
                });

                pushUndo();
                state.slices = newSlices;
                renderAndSave();
            }
        });
        sortableInstances.push(sortable);
    }
};

// =============================================================================
// State Mutations
// =============================================================================

const focusLastElement = (selector, textareaClass) => {
    const elements = dom.storyMap.querySelectorAll(selector);
    const last = elements[elements.length - 1];
    if (last) {
        scrollElementIntoView(last);
        last.querySelector(textareaClass)?.focus();
    }
};

const addColumn = (hidden = true) => {
    pushUndo();
    const column = createColumn('', null, null, hidden);
    state.columns.push(column);
    state.slices.forEach(slice => slice.stories[column.id] = []);
    renderAndSave();

    // Scroll to the new step after DOM settles
    setTimeout(() => {
        const steps = dom.storyMap.querySelectorAll('.step');
        const lastStep = steps[steps.length - 1];
        if (lastStep) {
            scrollElementIntoView(lastStep);
            if (!hidden) {
                lastStep.querySelector('.step-text')?.focus();
            }
        }
        updateNavArrows();
    }, 0);
};

const addStory = (columnId, sliceId) => {
    const slice = state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    pushUndo();

    // Set default color based on row type
    const defaultColor = slice.rowType ? DEFAULT_CARD_COLORS[slice.rowType] : null;

    slice.stories[columnId] = slice.stories[columnId] || [];
    slice.stories[columnId].push(createStory('', defaultColor));
    renderAndSave();

    // Scroll to new card after DOM settles
    const storyIndex = slice.stories[columnId].length - 1;
    setTimeout(() => {
        const column = dom.storyMap.querySelector(
            `.story-column[data-column-id="${columnId}"][data-slice-id="${sliceId}"]`
        );
        const newCard = column?.querySelectorAll('.story-card')[storyIndex];
        if (newCard) {
            scrollElementIntoView(newCard);
            newCard.querySelector('.story-text')?.focus();
        }
        updateNavArrows();
    }, 0);
};

const addSlice = (afterIndex, separator = true, rowType = null) => {
    pushUndo();
    const slice = createSlice('', separator, rowType);
    state.slices.splice(afterIndex, 0, slice);
    renderAndSave();

    // Scroll to new slice after DOM settles
    setTimeout(() => {
        const sliceElement = dom.storyMap.querySelectorAll('.slice-container')[afterIndex];
        if (sliceElement) {
            scrollElementIntoView(sliceElement);
            if (separator) {
                sliceElement.querySelector('.slice-label')?.focus();
            }
        }
    }, 0);
    return slice;
};

const deleteColumn = (columnId) => {
    if (state.columns.length <= 1) {
        alert('Cannot delete the last column.');
        return;
    }
    const index = state.columns.findIndex(s => s.id === columnId);
    if (index === -1) return;

    pushUndo();
    state.columns.splice(index, 1);
    state.slices.forEach(slice => delete slice.stories[columnId]);
    renderAndSave();
};

const deleteStory = (columnId, sliceId, storyId) => {
    const slice = state.slices.find(s => s.id === sliceId);
    const stories = slice?.stories[columnId];
    if (!stories) return;

    const index = stories.findIndex(s => s.id === storyId);
    if (index > -1) {
        pushUndo();
        stories.splice(index, 1);
        renderAndSave();
    }
};

const moveStory = (storyId, fromColumnId, fromSliceId, toColumnId, toSliceId, toIndex) => {
    pushUndo();
    const fromSlice = state.slices.find(s => s.id === fromSliceId);
    const toSlice = state.slices.find(s => s.id === toSliceId);
    if (!fromSlice || !toSlice) return;

    const fromStories = fromSlice.stories[fromColumnId];
    if (!fromStories) return;

    const storyIndex = fromStories.findIndex(s => s.id === storyId);
    if (storyIndex === -1) return;

    const [story] = fromStories.splice(storyIndex, 1);

    if (!toSlice.stories[toColumnId]) toSlice.stories[toColumnId] = [];

    toSlice.stories[toColumnId].splice(toIndex, 0, story);
    renderAndSave();
};

const deleteSlice = (sliceId) => {
    if (state.slices.length <= 1) return;

    const index = state.slices.findIndex(s => s.id === sliceId);
    if (index > -1) {
        pushUndo();
        state.slices.splice(index, 1);
        renderAndSave();
    }
};

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY = 'storymap';

// Firestore functions
// Store map data as JSON string to avoid Firestore's nested array limitation
const saveMapToFirestore = async (mapId, data) => {
    initAppCheck();
    try {
        await setDoc(doc(db, 'maps', mapId), {
            mapData: JSON.stringify(data),
            updatedAt: serverTimestamp(),
            updatedBy: getSessionId()
        });
    } catch (err) {
        console.error('Failed to save to Firestore:', err);
    }
};

const loadMapFromFirestore = async (mapId) => {
    initAppCheck();
    try {
        const docSnap = await getDoc(doc(db, 'maps', mapId));
        if (docSnap.exists()) {
            const { mapData } = docSnap.data();
            return mapData ? JSON.parse(mapData) : null;
        }
    } catch (err) {
        console.error('Failed to load from Firestore:', err);
    }
    return null;
};

// Subscribe to real-time updates
let unsubscribe = null;
const subscribeToMap = (mapId) => {
    if (unsubscribe) unsubscribe();

    unsubscribe = onSnapshot(doc(db, 'maps', mapId), (docSnap) => {
        if (docSnap.exists()) {
            const { mapData, updatedBy } = docSnap.data();
            // Only update if change came from another session
            if (updatedBy !== getSessionId() && mapData) {
                deserialize(JSON.parse(mapData));
                dom.boardName.value = state.name;
                render();
            }
        }
    }, (err) => {
        console.error('Firestore subscription error:', err);
    });

    // Track presence for this map
    trackPresence(mapId);
};

// Local storage save (also syncs to Firestore)
const saveToStorage = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    if (state.mapId) {
        saveMapToFirestore(state.mapId, serialize());
    }
};

// Combined render and save - used after state mutations
const renderAndSave = () => {
    render();
    saveToStorage();
};

// Debounced save for frequent updates (e.g., typing)
let saveTimeout = null;

const debouncedSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToStorage, DEBOUNCE_DELAY);
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
    // Don't export from welcome screen
    if (dom.welcomeScreen.classList.contains('visible')) return;

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
            pushUndo(); // Save state before import
            deserialize(JSON.parse(e.target.result));
            dom.boardName.value = state.name;
            renderAndSave();
        } catch {
            alert('Failed to import: Invalid file format');
        }
    };
    reader.readAsText(file);
};

const loadSample = async (name) => {
    // If on welcome screen (no map yet), use startWithSample instead
    if (!state.mapId) {
        return startWithSample(name);
    }

    flushSave();
    if (!confirmOverwrite()) return;

    try {
        const response = await fetch(`samples/${name}.json`);
        if (!response.ok) throw new Error();
        pushUndo(); // Save state before loading sample
        deserialize(await response.json());
        dom.boardName.value = state.name;
        renderAndSave();
    } catch {
        alert('Failed to load sample');
    }
};

const newMap = () => {
    flushSave();
    if (hasContent() && !confirm('Create a new story map?\n\nYou can return to this map using the back button.')) {
        return;
    }
    // Unsubscribe from current map
    if (unsubscribe) unsubscribe();

    // Clear mapId BEFORE initState to prevent overwriting old map
    state.mapId = null;

    initState();
    dom.boardName.value = '';
    render();

    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.pushState({ mapId }, '', `/${mapId}`);
    saveToStorage();
    // Save to Firestore in background (non-blocking)
    saveMapToFirestore(mapId, serialize());
    subscribeToMap(mapId);
};

// =============================================================================
// Event Listeners
// =============================================================================

const initEventListeners = () => {
    // Logo click - confirm before leaving current map
    dom.logoLink.addEventListener('click', (e) => {
        // If on welcome screen already, just reload
        if (!state.mapId) return;

        e.preventDefault();
        if (!hasContent() || confirm('Go to home page?\n\nYou can return to this map using the back button.')) {
            window.location.href = '/';
        }
    });

    // Welcome screen buttons
    dom.welcomeNewBtn.addEventListener('click', startNewMap);

    // Welcome screen sample buttons (using event delegation)
    document.querySelector('.welcome-samples-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-sample');
        if (btn?.dataset.sample) {
            e.stopPropagation();
            startWithSample(btn.dataset.sample);
        }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', async (e) => {
        const mapId = window.location.pathname.slice(1) || null;
        if (mapId) {
            await loadMapById(mapId);
            hideWelcomeScreen();
            dom.boardName.value = state.name;
            render();
        } else {
            showWelcomeScreen();
        }
    });

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

    dom.newMapBtn.addEventListener('click', () => {
        closeMainMenu();
        newMap();
    });
    dom.exportBtn.addEventListener('click', () => {
        closeMainMenu();
        exportMap();
    });
    dom.printBtn.addEventListener('click', () => {
        closeMainMenu();
        window.print();
    });
    dom.importBtn.addEventListener('click', () => {
        closeMainMenu();
        dom.fileInput.click();
    });

    // Share button - copy URL to clipboard
    dom.shareBtn.addEventListener('click', async () => {
        const url = window.location.href;
        try {
            await navigator.clipboard.writeText(url);
            dom.shareBtn.textContent = 'Copied!';
            setTimeout(() => dom.shareBtn.textContent = 'Share', 2000);
        } catch {
            prompt('Copy this link to share:', url);
        }
    });

    // Undo/Redo buttons
    dom.undoBtn.addEventListener('click', undo);
    dom.redoBtn.addEventListener('click', redo);

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
        // Cycle through zoom levels: 100% -> 75% -> 50% -> 25% -> 100%
        const currentIndex = ZOOM_LEVELS.indexOf(zoomLevel);
        zoomLevel = ZOOM_LEVELS[(currentIndex + 1) % ZOOM_LEVELS.length];
        updateZoom();
    });
    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            importMap(e.target.files[0]);
            e.target.value = '';
        }
    });

    // Main menu dropdown
    dom.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.mainMenu.classList.toggle('visible');
    });

    // Samples submenu toggle
    dom.samplesSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.samplesSubmenuTrigger.classList.toggle('expanded');
        dom.samplesSubmenu.classList.toggle('visible');
    });

    // Handle clicks on sample items in main menu
    dom.mainMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item?.dataset.sample) {
            loadSample(item.dataset.sample);
            closeMainMenu();
        }
    });

    document.addEventListener('click', () => {
        closeMainMenu();
        closeAllOptionsMenus();
    });

    document.addEventListener('keydown', (e) => {
        // Skip undo/redo if focused on a text input (let browser handle it)
        const isTextInput = e.target.matches('input, textarea');

        // Undo: Ctrl+Z (or Cmd+Z on Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !isTextInput) {
            e.preventDefault();
            undo();
        }
        // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd+Shift+Z on Mac)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isTextInput) {
            e.preventDefault();
            redo();
        }
        if (e.key === 'Escape') {
            closeMainMenu();
            closeAllOptionsMenus();
        }
    });

    // Navigation arrows
    dom.navArrowLeft.addEventListener('click', () => scrollByAmount(-300));
    dom.navArrowRight.addEventListener('click', () => scrollByAmount(300));

    // Update nav arrows on scroll
    dom.storyMapWrapper.addEventListener('scroll', updateNavArrows);

    // Pan/drag navigation when zoomed out
    dom.storyMapWrapper.addEventListener('mousedown', startPan);
    document.addEventListener('mousemove', doPan);
    document.addEventListener('mouseup', endPan);

    // Magnifier (desktop only)
    createMagnifier();
    document.addEventListener('mousemove', updateMagnifier);
    dom.storyMapWrapper.addEventListener('mouseleave', hideMagnifier);
    dom.magnifierToggle.addEventListener('click', toggleMagnifier);
};

// =============================================================================
// Initialize
// =============================================================================

// Load a map by ID (used by init and popstate)
const loadMapById = async (mapId) => {
    if (unsubscribe) unsubscribe();

    if (mapId) {
        const mapData = await loadMapFromFirestore(mapId);
        if (mapData) {
            deserialize(mapData);
            state.mapId = mapId;
            subscribeToMap(mapId);
            return true;
        }
    }
    return false;
};

const showWelcomeScreen = () => {
    dom.welcomeScreen.classList.add('visible');
    dom.storyMapWrapper.classList.remove('visible');
    dom.boardName.classList.add('hidden');
    dom.zoomControls.classList.add('hidden');
    clearPresence();
};

const hideWelcomeScreen = () => {
    dom.welcomeScreen.classList.remove('visible');
    dom.storyMapWrapper.classList.add('visible');
    dom.boardName.classList.remove('hidden');
    dom.zoomControls.classList.remove('hidden');
};

const showLoading = () => {
    dom.loadingIndicator.classList.add('visible');
};

const hideLoading = () => {
    dom.loadingIndicator.classList.remove('visible');
};

const startNewMap = () => {
    hideWelcomeScreen();
    initState();
    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);
    dom.boardName.value = state.name;
    render();
    // Save to Firestore in background (non-blocking)
    saveMapToFirestore(mapId, serialize());
    subscribeToMap(mapId);
};

const startWithSample = async (sampleName) => {
    hideWelcomeScreen();
    initState();
    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);

    // Load sample data (local fetch is fast)
    try {
        const response = await fetch(`samples/${sampleName}.json`);
        if (!response.ok) throw new Error();
        deserialize(await response.json());
        dom.boardName.value = state.name;
        renderAndSave();
        subscribeToMap(mapId);
    } catch {
        alert('Failed to load sample');
        dom.boardName.value = state.name;
        render();
        subscribeToMap(mapId);
    }
};

const init = async () => {
    // Get map ID from URL path (e.g., /abc123 -> abc123)
    const mapId = window.location.pathname.slice(1) || null;

    initEventListeners();

    if (mapId) {
        // Show loading indicator while fetching from Firestore
        showLoading();
        const loaded = await loadMapById(mapId);
        hideLoading();
        if (loaded) {
            hideWelcomeScreen();
            dom.boardName.value = state.name;
            render();
        } else {
            // Map not found - show welcome screen
            showWelcomeScreen();
        }
    } else {
        // No ID in URL - show welcome screen for first-time visitors
        showWelcomeScreen();
    }
};

init();
