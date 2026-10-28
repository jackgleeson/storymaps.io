// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Presence tracking and cursor display (via Yjs awareness)

import { showPrompt } from '/src/core/modals.js';
import { mapTop } from '/src/ui/map-top.js';

let _dom = null;
let _getProvider = null;
let _getYdoc = null;
let _getState = null;

// Classic arrow pointer SVG path
const CURSOR_SVG_PATH = 'M8 0L8 22L13 17L17 28L21 26L17 15L24 15Z';

// Distinct colors for cursor identification (10 colors, maximally distinct)
const CURSOR_COLORS = [
    '#e53935', // red
    '#1e88e5', // blue
    '#43a047', // green
    '#fb8c00', // orange
    '#8e24aa', // purple
    '#00897b', // teal
    '#d81b60', // pink
    '#ffb300', // amber
    '#6d4c41', // brown
    '#546e7a', // slate
];

// Get consistent color for a session ID
export const getCursorColor = (sessionId) => {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
        hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
        hash |= 0;
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
};

// Session ID to track unique viewers
export const getSessionId = () => {
    if (!sessionStorage.sessionId) {
        sessionStorage.sessionId = crypto.randomUUID?.() ??
            ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    }
    return sessionStorage.sessionId;
};

// Store cursor elements
let cursorElements = new Map(); // clientId -> DOM element
let dragGhostElements = new Map(); // clientId -> DOM element
const peerCursors = new Map(); // clientId -> last cursor position received
let cursorThrottleTimeout = null;
const CURSOR_THROTTLE_MS = 50;

// Cursor visibility preference
let cursorsVisible = localStorage.getItem('cursorsVisible') !== 'false'; // Default true

let viewerCount = 0;
let _zoomLevelGetter = null;

// Presence name for cursor labels and log attribution
let _presenceName = '';

// Touch device detection (skip name prompt, broadcast as mobile)
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

export const getPresenceName = () => _presenceName || 'guest';

export const init = ({ getProvider, getYdoc, getZoomLevel, getState }) => {
    _getProvider = getProvider;
    _getYdoc = getYdoc;
    _dom = {
        storyMap: document.getElementById('storyMap'),
        storyMapWrapper: document.getElementById('storyMapWrapper'),
        toggleCursorsBtn: document.getElementById('toggleCursorsBtn'),
    };
    _zoomLevelGetter = getZoomLevel;
    _getState = getState;
};

const updateViewerCountUI = (count, awareness) => {
    viewerCount = count;
    const badge = document.getElementById('viewerCount');
    if (!badge) return;

    const nameEl = document.getElementById('viewerName');
    const liveEl = document.getElementById('viewerLive');

    // Always show the badge (name is always visible)
    badge.classList.add('visible');
    if (nameEl) nameEl.textContent = _presenceName || 'guest';

    if (count > 1 && liveEl) {
        liveEl.textContent = count;
        liveEl.classList.add('visible');

        // Build tooltip listing all connected users (you first)
        if (awareness) {
            const others = [];
            const localId = awareness.clientID;
            for (const [clientId, state] of awareness.getStates()) {
                if (clientId === localId) continue;
                const label = state.user?.device === 'mobile'
                    ? 'Mobile user'
                    : (state.user?.name || 'guest');
                others.push(label);
            }
            const lines = [(_presenceName || 'guest') + ' (you)', ...others];
            liveEl.dataset.tooltip = lines.join('\n');
        }
    } else if (liveEl) {
        liveEl.classList.remove('visible');
        liveEl.dataset.tooltip = '';
    }
};

// Allow editing name by clicking the viewer badge
let _nameClickBound = false;
const bindNameClick = () => {
    if (_nameClickBound) return;
    _nameClickBound = true;
    const nameEl = document.getElementById('viewerName');
    if (!nameEl) return;
    nameEl.addEventListener('click', async () => {
        const newName = await showPrompt('Change your display name', _presenceName || '');
        if (newName === null) return; // cancelled
        _presenceName = newName || '';
        if (_presenceName) {
            localStorage.setItem('presenceName', _presenceName);
        } else {
            localStorage.removeItem('presenceName');
        }
        // Update awareness
        const provider = _getProvider();
        if (provider) {
            const sessionId = getSessionId();
            provider.awareness.setLocalStateField('user', {
                sessionId,
                name: _presenceName || 'guest',
                device: 'desktop',
                color: getCursorColor(sessionId),
                colorLight: getCursorColor(sessionId) + '33',
                online: true,
            });
        }
        // Update badge text
        const el = document.getElementById('viewerName');
        if (el) el.textContent = _presenceName || 'guest';
    });
};

export const trackPresence = async () => {
    const provider = _getProvider();
    if (!provider) return;

    const awareness = provider.awareness;
    const sessionId = getSessionId();

    // Prompt for name if not stored (skip on touch devices and during tour)
    const isTourActive = document.body.classList.contains('tour-active');
    if (!isTouchDevice && !isTourActive) {
        let name = localStorage.getItem('presenceName');
        if (name === null) {
            name = await showPrompt('Enter your name for live collaboration (optional)', '', 'guest') || '';
            if (name) localStorage.setItem('presenceName', name);
        }
        _presenceName = name || '';
    } else {
        _presenceName = '';
    }

    // Set our local awareness state
    awareness.setLocalStateField('user', { sessionId, name: _presenceName || 'guest', device: isTouchDevice ? 'mobile' : 'desktop', color: getCursorColor(sessionId), colorLight: getCursorColor(sessionId) + '33', online: true });

    // Listen for awareness changes to update viewer count
    awareness.on('change', () => {
        updateViewerCountUI(awareness.getStates().size, awareness);
    });

    // Set initial count
    updateViewerCountUI(awareness.getStates().size, awareness);

    // Bind click-to-edit on name (skip on touch — badge is hidden)
    if (!isTouchDevice) bindNameClick();
};

export const clearPresence = () => {
    const badge = document.getElementById('viewerCount');
    if (badge) badge.classList.remove('visible');
    viewerCount = 0;
};

export const toggleCursorsVisibility = () => {
    cursorsVisible = !cursorsVisible;
    localStorage.setItem('cursorsVisible', cursorsVisible);
    updateCursorsVisibilityUI();

    // Show/hide existing cursor elements
    const overlay = document.querySelector('.cursor-overlay');
    if (overlay) {
        overlay.style.display = cursorsVisible ? 'block' : 'none';
    }
};

export const updateCursorsVisibilityUI = () => {
    if (_dom.toggleCursorsBtn) {
        _dom.toggleCursorsBtn.classList.toggle('active', !cursorsVisible);
        _dom.toggleCursorsBtn.title = cursorsVisible ? 'Hide external cursors' : 'Show external cursors';
    }
};

// Track and broadcast cursor position via Yjs awareness
export const trackCursor = () => {
    const provider = _getProvider();
    const ydoc = _getYdoc();
    if (!provider) return;

    const awareness = provider.awareness;
    const sessionId = getSessionId();

    // Check if touch device - don't broadcast (no persistent cursor), but still listen
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    if (!isTouchDevice) {
        // Throttled cursor position broadcast
        const broadcastCursor = (e) => {
            if (cursorThrottleTimeout) return;

            const wrapper = _dom.storyMapWrapper;
            const wrapperRect = wrapper.getBoundingClientRect();
            const zoomLevel = _zoomLevelGetter();

            // Check if mouse is over the map area
            if (e.clientX < wrapperRect.left || e.clientX > wrapperRect.right ||
                e.clientY < wrapperRect.top || e.clientY > wrapperRect.bottom) {
                awareness.setLocalStateField('mapCursor', null);
                return;
            }

            // Calculate position relative to storyMap content
            const mapOffsetLeft = _dom.storyMap.offsetLeft;
            const mapOffsetTop = _dom.storyMap.offsetTop;
            const x = (e.clientX - wrapperRect.left + wrapper.scrollLeft - mapOffsetLeft) / zoomLevel;
            let y = (e.clientY - wrapperRect.top + wrapper.scrollTop - mapOffsetTop) / zoomLevel;

            // Over the top rows, send the position within them: frozen rows sit lower down than
            // their place in the map, on this screen or the other person's. Unfrozen, it's the
            // same number either way, so older versions still place it right.
            const topRect = mapTop(_dom.storyMap)?.getBoundingClientRect();
            const overTop = !!topRect && e.clientY >= topRect.top && e.clientY < topRect.bottom;
            if (overTop) y = (e.clientY - topRect.top) / zoomLevel;

            awareness.setLocalStateField('mapCursor', {
                x: Math.round(x),
                y: Math.round(y),
                ...(overTop && { top: true }),
                color: getCursorColor(sessionId),
            });

            cursorThrottleTimeout = setTimeout(() => {
                cursorThrottleTimeout = null;
            }, CURSOR_THROTTLE_MS);
        };

        _dom.storyMapWrapper.addEventListener('mousemove', broadcastCursor);
        _dom.storyMapWrapper.addEventListener('mouseleave', () => {
            awareness.setLocalStateField('mapCursor', null);
        });
    }

    // Create cursor overlay container (appended to wrapper, not storyMap, so it survives re-renders)
    let cursorOverlay = _dom.storyMapWrapper.querySelector('.cursor-overlay');
    if (!cursorOverlay) {
        cursorOverlay = document.createElement('div');
        cursorOverlay.className = 'cursor-overlay';
        cursorOverlay.style.display = cursorsVisible ? 'block' : 'none';
        _dom.storyMapWrapper.appendChild(cursorOverlay);
        _dom.storyMapWrapper.addEventListener('scroll', placeCursorsOverTopRows, { passive: true });
    }

    // Listen for other users' cursors via awareness
    const localClientId = ydoc.clientID;

    awareness.on('change', () => {
        const states = awareness.getStates();
        const activeClientIds = new Set();
        const zoomLevel = _zoomLevelGetter();

        // Get storyMap offset for positioning
        const mapOffsetLeft = _dom.storyMap.offsetLeft;
        const mapOffsetTop = _dom.storyMap.offsetTop;

        for (const [clientId, state] of states) {
            if (clientId === localClientId) continue;
            const cursorData = state.mapCursor;
            if (!cursorData) continue;

            const key = String(clientId);
            activeClientIds.add(key);

            let cursorEl = cursorElements.get(key);
            const peerName = state.user?.name || 'guest';
            if (!cursorEl) {
                cursorEl = document.createElement('div');
                cursorEl.className = 'remote-cursor';
                const color = /^#[0-9a-fA-F]{3,6}$/.test(cursorData.color) ? cursorData.color : '#888';
                cursorEl.innerHTML = `
                    <svg viewBox="0 0 32 32" width="24" height="24">
                        <path d="${CURSOR_SVG_PATH}" fill="${color}" stroke="#fff" stroke-width="1.5"/>
                    </svg>
                `;
                if (peerName) {
                    const label = document.createElement('span');
                    label.className = 'cursor-label';
                    label.textContent = peerName;
                    label.style.backgroundColor = color;
                    cursorEl.appendChild(label);
                }
                cursorOverlay.appendChild(cursorEl);
                cursorElements.set(key, cursorEl);
            } else {
                // Update label if name changed
                let label = cursorEl.querySelector('.cursor-label');
                if (peerName) {
                    if (!label) {
                        const color = /^#[0-9a-fA-F]{3,6}$/.test(cursorData.color) ? cursorData.color : '#888';
                        label = document.createElement('span');
                        label.className = 'cursor-label';
                        label.style.backgroundColor = color;
                        cursorEl.appendChild(label);
                    }
                    if (label.textContent !== peerName) label.textContent = peerName;
                } else if (label) {
                    label.remove();
                }
            }

            peerCursors.set(key, cursorData);
            const { x: visualX, y: visualY } = cursorPosition(cursorData, zoomLevel, mapOffsetLeft, mapOffsetTop);
            cursorEl.style.transition = '';
            cursorEl.style.left = `${visualX}px`;
            cursorEl.style.top = `${visualY}px`;
        }

        // Remove cursors for users who left
        for (const [key, el] of cursorElements) {
            if (!activeClientIds.has(key)) {
                el.remove();
                cursorElements.delete(key);
                peerCursors.delete(key);
            }
        }

        // Render drag ghosts for remote clients
        const activeGhostIds = new Set();

        for (const [clientId, state] of states) {
            if (clientId === localClientId) continue;
            const ghost = state.dragGhost;
            const cursorData = state.mapCursor;
            if (!ghost || !cursorData) continue;

            const key = String(clientId);
            const isColumn = ghost.type === 'column';
            const ghostKey = key + (isColumn ? ':col' : ':story');
            activeGhostIds.add(ghostKey);

            let ghostEl = dragGhostElements.get(ghostKey);
            const safeAccent = /^#[0-9a-fA-F]{3,6}$/.test(ghost.cursorColor) ? ghost.cursorColor : '#888';

            if (!ghostEl) {
                // Remove any stale ghost for this client (type may have changed)
                for (const [k, el] of dragGhostElements) {
                    if (k.startsWith(key + ':')) {
                        el.remove();
                        dragGhostElements.delete(k);
                    }
                }
                ghostEl = document.createElement('div');
                if (isColumn) {
                    ghostEl.className = 'remote-drag-ghost remote-drag-ghost-column';
                    ghostEl.style.setProperty('--ghost-accent', safeAccent);
                    buildColumnGhost(ghostEl, ghost.columnId);
                } else {
                    ghostEl.className = 'remote-drag-ghost';
                }
                cursorOverlay.appendChild(ghostEl);
                dragGhostElements.set(ghostKey, ghostEl);
            }

            // Update content and styling for story ghosts (column ghosts built once)
            if (!isColumn) {
                const text = findStoryText(ghost.storyId);
                ghostEl.textContent = text || '';
                const safeColor = /^#[0-9a-fA-F]{3,6}$/.test(ghost.color) ? ghost.color : '#fef08a';
                ghostEl.style.backgroundColor = safeColor;
                ghostEl.style.setProperty('--ghost-accent', safeAccent);
            }

            // Position at cursor + offset
            const { x: visualX, y: visualY } = cursorPosition(cursorData, zoomLevel, mapOffsetLeft, mapOffsetTop);
            ghostEl.style.left = `${visualX + 12}px`;
            ghostEl.style.top = `${visualY + 12}px`;
        }

        // Animate out ghosts for clients that stopped dragging or left
        for (const [key, el] of dragGhostElements) {
            if (!activeGhostIds.has(key)) {
                el.classList.add('ghost-drop');
                dragGhostElements.delete(key);
                el.addEventListener('animationend', () => el.remove(), { once: true });
            }
        }
    });
};

// Where a peer's cursor goes in the cursor overlay, which scrolls with the map. A cursor over the
// top rows goes where those rows are on this screen, which is lower down while they're frozen.
const cursorPosition = (cursorData, zoomLevel, mapOffsetLeft, mapOffsetTop) => {
    const x = cursorData.x * zoomLevel + mapOffsetLeft;
    const top = cursorData.top && mapTop(_dom.storyMap);
    if (!top) return { x, y: cursorData.y * zoomLevel + mapOffsetTop };
    const wrapper = _dom.storyMapWrapper;
    const topY = top.getBoundingClientRect().top - wrapper.getBoundingClientRect().top + wrapper.scrollTop;
    return { x, y: topY + cursorData.y * zoomLevel };
};

// Frozen rows stay put while this screen scrolls, so cursors over them move with them
const placeCursorsOverTopRows = () => {
    const zoomLevel = _zoomLevelGetter();
    const mapOffsetLeft = _dom.storyMap.offsetLeft;
    const mapOffsetTop = _dom.storyMap.offsetTop;
    for (const [key, cursorData] of peerCursors) {
        if (!cursorData.top) continue;
        const { x, y } = cursorPosition(cursorData, zoomLevel, mapOffsetLeft, mapOffsetTop);
        const cursorEl = cursorElements.get(key);
        if (cursorEl) {
            cursorEl.style.transition = 'none';
            cursorEl.style.top = `${y}px`;
            cursorEl.style.left = `${x}px`;
        }
        for (const [ghostKey, ghostEl] of dragGhostElements) {
            if (!ghostKey.startsWith(key + ':')) continue;
            ghostEl.style.top = `${y + 12}px`;
            ghostEl.style.left = `${x + 12}px`;
        }
    }
};

// Find story text by ID from current state
const findStoryText = (storyId) => {
    const state = _getState?.();
    if (!state) return '';
    for (const slice of state.slices) {
        for (const stories of Object.values(slice.stories)) {
            const story = stories.find(s => s.id === storyId);
            if (story) return story.name || '';
        }
    }
    return '';
};

// Find column (step) text by ID from current state
const findColumnText = (columnId) => {
    const state = _getState?.();
    if (!state) return '';
    const col = state.columns.find(c => c.id === columnId);
    return col?.name || '';
};

// Build a full-column ghost (step header + story cards) matching local drag appearance
const buildColumnGhost = (container, columnId) => {
    const state = _getState?.();
    if (!state) return;

    const col = state.columns.find(c => c.id === columnId);

    // Step header
    const header = document.createElement('div');
    header.className = 'ghost-column-step';
    header.textContent = col?.name || '';
    container.appendChild(header);

    // Story cards from each slice
    for (const slice of state.slices) {
        const stories = slice.stories[columnId] || [];
        for (const story of stories) {
            const card = document.createElement('div');
            card.className = 'ghost-column-card';
            card.textContent = story.name || '';
            const color = /^#[0-9a-fA-F]{3,6}$/.test(story.color) ? story.color : '#fef08a';
            card.style.backgroundColor = color;
            container.appendChild(card);
        }
    }
};

// Broadcast drag start to remote clients
// Accepts { type: 'story', storyId, color } or { type: 'column', columnId, color }
export const broadcastDragStart = ({ type, storyId, columnId, color }) => {
    const provider = _getProvider();
    if (!provider) return;
    const sessionId = getSessionId();
    provider.awareness.setLocalStateField('dragGhost', {
        type: type || 'story',
        storyId,
        columnId,
        color,
        cursorColor: getCursorColor(sessionId),
    });
};

// Broadcast drag end to remote clients
export const broadcastDragEnd = () => {
    const provider = _getProvider();
    if (!provider) return;
    provider.awareness.setLocalStateField('dragGhost', null);
};

export const clearCursors = () => {
    for (const el of cursorElements.values()) {
        el.remove();
    }
    cursorElements.clear();
    for (const el of dragGhostElements.values()) {
        el.remove();
    }
    dragGhostElements.clear();
};
