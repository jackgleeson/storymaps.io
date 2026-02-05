// =============================================================================
// Firebase (lazy loaded)
// =============================================================================

import { firebaseConfig, recaptchaSiteKey } from './config.js';

// Firebase modules and instances - initialized lazily
let firebaseApp = null;
let db = null;
let rtdb = null;
let firebaseModules = null;
let firebaseInitPromise = null;

const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

const ensureFirebase = async () => {
    if (firebaseApp) return firebaseModules;
    if (firebaseInitPromise) return firebaseInitPromise;

    firebaseInitPromise = (async () => {
        // Dynamic imports - load all Firebase modules in parallel
        const [appModule, firestoreModule, databaseModule] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js'),
            import('https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js')
        ]);

        // Initialize Firebase
        firebaseApp = appModule.initializeApp(firebaseConfig);
        db = firestoreModule.initializeFirestore(firebaseApp, isSafari ? {
            experimentalForceLongPolling: true // Fix for Safari CORS issues
        } : {});
        rtdb = databaseModule.getDatabase(firebaseApp);

        // Store module exports for use by other functions
        firebaseModules = {
            // Firestore
            doc: firestoreModule.doc,
            getDoc: firestoreModule.getDoc,
            setDoc: firestoreModule.setDoc,
            onSnapshot: firestoreModule.onSnapshot,
            serverTimestamp: firestoreModule.serverTimestamp,
            // Realtime Database
            ref: databaseModule.ref,
            set: databaseModule.set,
            onValue: databaseModule.onValue,
            onDisconnect: databaseModule.onDisconnect,
            rtdbTimestamp: databaseModule.serverTimestamp
        };

        return firebaseModules;
    })();

    return firebaseInitPromise;
};

// Preload Firebase if we're loading a map (URL has an ID)
// This starts the load in parallel with page setup instead of waiting for init()
if (window.location.pathname.length > 1) {
    ensureFirebase();
}

// App Check - initialized lazily after Firebase is ready
let appCheckInstance = null;
let appCheckReady = null;

const ensureAppCheck = async () => {
    await ensureFirebase();

    if (!appCheckInstance) {
        const { initializeAppCheck, ReCaptchaV3Provider, getToken } = await import(
            'https://www.gstatic.com/firebasejs/12.8.0/firebase-app-check.js'
        );
        // Use debug token for localhost development (register token in Firebase Console → App Check)
        if (location.hostname === 'localhost') {
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        appCheckInstance = initializeAppCheck(firebaseApp, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true
        });
        appCheckReady = getToken(appCheckInstance, false).catch(() => {});
    }
    return appCheckReady;
};

// =============================================================================
// Yjs - Collaborative Editing (lazy loaded)
// =============================================================================

let Y = null;
const ensureYjs = async () => {
    if (!Y) {
        Y = await import('https://esm.sh/yjs@13.6.18');
    }
    return Y;
};

// =============================================================================
// Sortable.js - Drag and Drop (lazy loaded)
// =============================================================================

let Sortable = null;
let sortableLoadPromise = null;
const ensureSortable = () => {
    if (Sortable) return Promise.resolve(Sortable);
    if (sortableLoadPromise) return sortableLoadPromise;

    sortableLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js';
        script.onload = () => {
            Sortable = window.Sortable;
            resolve(Sortable);
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
    return sortableLoadPromise;
};

// =============================================================================
// Yjs Document & Custom Firestore Sync
// =============================================================================

let ydoc = null;
let ymap = null;
let yjsUnsubscribe = null;
let isSyncingFromRemote = false;

// Create a new Yjs document for a map
const createYjsDoc = async () => {
    await ensureYjs();
    if (ydoc) {
        ydoc.destroy();
    }
    ydoc = new Y.Doc();
    ymap = ydoc.getMap('storymap');

    // Observe local changes to sync to Firestore
    ydoc.on('update', (update, origin) => {
        // Only save if this is a local change (not from remote sync)
        if (origin !== 'remote' && state.mapId) {
            throttledYjsSave();
        }
    });

    return ydoc;
};

// Save Yjs document state to Firestore
const saveYjsToFirestore = async () => {
    if (!ydoc || !state.mapId) return;

    await ensureAppCheck();
    const { doc, setDoc, serverTimestamp } = firebaseModules;
    try {
        // Encode full document state as base64
        const stateVector = Y.encodeStateAsUpdate(ydoc);
        const base64State = btoa(String.fromCharCode(...stateVector));

        await setDoc(doc(db, 'maps', state.mapId), {
            yjsState: base64State,
            name: state.name || '',
            updatedAt: serverTimestamp(),
            updatedBy: getSessionId()
        }, { merge: true });
    } catch (err) {
        console.error('Failed to save Yjs state to Firestore:', err);
    }
};

// Throttled Yjs save - saves immediately, then rate-limits to every 50ms
// (Unlike debounce, this gives immediate feedback during typing)
let yjsThrottleTimeout = null;
let yjsPendingSave = false;
const YJS_THROTTLE_MS = 50;

const throttledYjsSave = () => {
    if (yjsThrottleTimeout) {
        // Already throttling - queue a save for when throttle expires
        yjsPendingSave = true;
        return;
    }

    // Save immediately
    saveYjsToFirestore();

    // Start throttle window
    yjsThrottleTimeout = setTimeout(() => {
        yjsThrottleTimeout = null;
        if (yjsPendingSave) {
            yjsPendingSave = false;
            throttledYjsSave(); // Process queued save
        }
    }, YJS_THROTTLE_MS);
};

// Load Yjs state from Firestore and apply to document
const loadYjsFromFirestore = async (mapId) => {
    await ensureAppCheck();
    const { doc, getDoc } = firebaseModules;
    try {
        const docSnap = await getDoc(doc(db, 'maps', mapId));
        if (docSnap.exists() && docSnap.data().yjsState) {
            const binaryState = Uint8Array.from(atob(docSnap.data().yjsState), c => c.charCodeAt(0));
            Y.applyUpdate(ydoc, binaryState, 'remote');
            return true;
        }
    } catch (err) {
        console.error('Failed to load from Firestore:', err);
    }
    return false;
};

// Subscribe to Yjs state changes from Firestore
const subscribeToYjsUpdates = (mapId) => {
    if (yjsUnsubscribe) {
        yjsUnsubscribe();
    }

    const { doc, onSnapshot } = firebaseModules;
    yjsUnsubscribe = onSnapshot(doc(db, 'maps', mapId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();

            // Only apply if from another session and has Yjs state
            if (data.updatedBy !== getSessionId() && data.yjsState) {
                isSyncingFromRemote = true;
                try {
                    const binaryState = Uint8Array.from(atob(data.yjsState), c => c.charCodeAt(0));
                    Y.applyUpdate(ydoc, binaryState, 'remote');
                    syncFromYjs();
                    render();
                } finally {
                    isSyncingFromRemote = false;
                }
            }
        }
    }, (err) => {
        console.error('Firestore subscription error:', err);
    });
};

// =============================================================================
// Yjs Nested CRDT Helpers
// =============================================================================

// Field definitions for cards (columns and stories share the same fields)
const CARD_FIELDS = {
    name:   { default: '' },
    color:  { default: null },
    url:    { default: null },
    hidden: { default: false },
    status: { default: null }
};

// Create a Y.Map from a plain object using field definitions
const createYCard = (obj) => {
    const yMap = new Y.Map();
    yMap.set('id', obj.id);
    for (const [field, { default: defaultVal }] of Object.entries(CARD_FIELDS)) {
        const value = obj[field];
        // Always set name, only set others if they differ from default
        if (field === 'name' || (value && value !== defaultVal)) {
            yMap.set(field, value ?? defaultVal);
        }
    }
    return yMap;
};

// Update Y.Map properties in place from a plain object (preserves CRDT benefits)
const updateYCard = (yMap, obj) => {
    for (const [field, { default: defaultVal }] of Object.entries(CARD_FIELDS)) {
        const newValue = field === 'name' ? (obj[field] || '') : obj[field];
        const currentValue = yMap.get(field);
        if (currentValue !== newValue) {
            if (newValue && newValue !== defaultVal) {
                yMap.set(field, newValue);
            } else if (field === 'name') {
                yMap.set(field, '');
            } else {
                yMap.delete(field);
            }
        }
    }
};

// Convert Yjs data back to a plain card object
const cardFromYjs = (data) => ({
    id: data.id,
    name: data.name || '',
    color: data.color || null,
    url: data.url || null,
    hidden: data.hidden || false,
    status: data.status || null
});

// Aliases for semantic clarity
const createYColumn = createYCard;
const createYStory = createYCard;
const updateYColumn = updateYCard;
const updateYStory = updateYCard;

// Create a Y.Map from a slice object with nested stories structure
const createYSlice = (slice, columns) => {
    const ySlice = new Y.Map();
    ySlice.set('id', slice.id);
    ySlice.set('name', slice.name || '');
    if (slice.separator === false) ySlice.set('separator', false);
    if (slice.rowType) ySlice.set('rowType', slice.rowType);
    if (slice.collapsed) ySlice.set('collapsed', true);

    // Create nested stories structure: Y.Map<columnId, Y.Array<Y.Map>>
    const yStories = new Y.Map();
    columns.forEach(col => {
        const yStoryArray = new Y.Array();
        const stories = slice.stories[col.id] || [];
        stories.forEach(story => {
            yStoryArray.push([createYStory(story)]);
        });
        yStories.set(col.id, yStoryArray);
    });
    ySlice.set('stories', yStories);

    return ySlice;
};

// Sync state from Yjs document to local state object
const syncFromYjs = () => {
    if (!ymap) return;

    const name = ymap.get('name');
    if (name !== undefined) state.name = name;

    // Read columns - use toJSON() for reliable conversion
    const yColumns = ymap.get('columns');
    if (yColumns) {
        const columnsData = typeof yColumns.toJSON === 'function' ? yColumns.toJSON() : yColumns;
        if (Array.isArray(columnsData)) {
            state.columns = columnsData.map(cardFromYjs);
        }
    }

    // Read slices - use toJSON() for reliable conversion
    const ySlices = ymap.get('slices');
    if (ySlices) {
        const slicesData = typeof ySlices.toJSON === 'function' ? ySlices.toJSON() : ySlices;
        if (Array.isArray(slicesData)) {
            state.slices = slicesData.map(sliceData => {
                const slice = {
                    id: sliceData.id,
                    name: sliceData.name || '',
                    separator: sliceData.separator !== false,
                    rowType: sliceData.rowType || null,
                    collapsed: sliceData.collapsed || false,
                    stories: {}
                };

                const storiesData = sliceData.stories || {};
                state.columns.forEach(col => {
                    const columnStories = storiesData[col.id];
                    slice.stories[col.id] = Array.isArray(columnStories)
                        ? columnStories.map(cardFromYjs)
                        : [];
                });

                return slice;
            });
        }
    }

    if (dom.boardName) dom.boardName.value = state.name;
};
// Sync Y.Array incrementally - update in place when structure matches, rebuild when it doesn't
const syncYArray = (yArray, items, getId, createFn, updateFn) => {
    // Check if structure matches (same IDs in same order)
    const structureMatches = items.length === yArray.length &&
        items.every((item, i) => {
            const yItem = yArray.get(i);
            return yItem && typeof yItem.get === 'function' && yItem.get('id') === getId(item);
        });

    if (structureMatches) {
        // Structure unchanged - update properties in place (preserves CRDT benefits)
        items.forEach((item, i) => {
            const yItem = yArray.get(i);
            updateFn(yItem, item);
        });
    } else {
        // Structure changed - rebuild array
        // Clear existing items
        while (yArray.length > 0) {
            yArray.delete(0);
        }
        // Add items in new order
        items.forEach(item => {
            yArray.push([createFn(item)]);
        });
    }
};

// Sync stories within a slice (handles nested Y.Map<columnId, Y.Array<Y.Map>>)
const syncSliceStories = (yStories, slice, columns) => {
    columns.forEach(col => {
        const stories = slice.stories[col.id] || [];
        let yStoryArray = yStories.get(col.id);

        if (!yStoryArray || typeof yStoryArray.toArray !== 'function') {
            // Column doesn't exist in Yjs yet - create it
            yStoryArray = new Y.Array();
            yStories.set(col.id, yStoryArray);
        }

        syncYArray(
            yStoryArray,
            stories,
            story => story.id,
            createYStory,
            updateYStory
        );
    });

    // Remove columns that no longer exist
    const columnIds = new Set(columns.map(c => c.id));
    const keysToDelete = [];
    yStories.forEach((_, key) => {
        if (!columnIds.has(key)) keysToDelete.push(key);
    });
    keysToDelete.forEach(key => yStories.delete(key));
};

// Update slice properties and nested stories
const updateYSlice = (ySlice, slice, columns) => {
    if (ySlice.get('name') !== (slice.name || '')) ySlice.set('name', slice.name || '');
    if (ySlice.get('separator') !== slice.separator) {
        if (slice.separator === false) ySlice.set('separator', false);
        else ySlice.delete('separator');
    }
    if (ySlice.get('rowType') !== slice.rowType) {
        if (slice.rowType) ySlice.set('rowType', slice.rowType);
        else ySlice.delete('rowType');
    }
    if (ySlice.get('collapsed') !== slice.collapsed) {
        if (slice.collapsed) ySlice.set('collapsed', true);
        else ySlice.delete('collapsed');
    }

    // Sync nested stories
    let yStories = ySlice.get('stories');
    if (!yStories || typeof yStories.forEach !== 'function') {
        yStories = new Y.Map();
        ySlice.set('stories', yStories);
    }
    syncSliceStories(yStories, slice, columns);
};

// Sync local state to Yjs document
const syncToYjs = () => {
    if (!ymap || isSyncingFromRemote) return;

    // Don't sync if map is locked and user hasn't unlocked
    if (state.mapId && !isMapEditable()) return;

    ydoc.transact(() => {
        ymap.set('name', state.name);

        // Sync columns incrementally
        let yColumns = ymap.get('columns');
        if (!yColumns || typeof yColumns.toArray !== 'function') {
            yColumns = new Y.Array();
            ymap.set('columns', yColumns);
        }
        syncYArray(
            yColumns,
            state.columns,
            col => col.id,
            createYColumn,
            updateYColumn
        );

        // Sync slices incrementally
        let ySlices = ymap.get('slices');
        if (!ySlices || typeof ySlices.toArray !== 'function') {
            ySlices = new Y.Array();
            ymap.set('slices', ySlices);
        }

        // Check if slice structure matches
        const sliceStructureMatches = state.slices.length === ySlices.length &&
            state.slices.every((slice, i) => {
                const ySlice = ySlices.get(i);
                return ySlice && typeof ySlice.get === 'function' && ySlice.get('id') === slice.id;
            });

        if (sliceStructureMatches) {
            // Update slices in place
            state.slices.forEach((slice, i) => {
                const ySlice = ySlices.get(i);
                updateYSlice(ySlice, slice, state.columns);
            });
        } else {
            // Rebuild slices array
            while (ySlices.length > 0) {
                ySlices.delete(0);
            }
            state.slices.forEach(slice => {
                ySlices.push([createYSlice(slice, state.columns)]);
            });
        }
    }, 'local');
};

// Destroy Yjs document and unsubscribe
const destroyYjs = () => {
    if (yjsUnsubscribe) {
        yjsUnsubscribe();
        yjsUnsubscribe = null;
    }
    if (ydoc) {
        ydoc.destroy();
        ydoc = null;
        ymap = null;
    }
};

// =============================================================================
// Presence Tracking
// =============================================================================

// Session ID to track unique viewers
const getSessionId = () => {
    if (!sessionStorage.sessionId) {
        sessionStorage.sessionId = crypto.randomUUID();
    }
    return sessionStorage.sessionId;
};

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
    if (!mapId || !firebaseModules) return;

    const { ref, set, onValue, onDisconnect, rtdbTimestamp } = firebaseModules;
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
// Cursor Presence - Show other users' cursors
// =============================================================================

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
const getCursorColor = (sessionId) => {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
        hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
        hash |= 0;
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
};

// Store cursor elements and subscription
let cursorElements = new Map(); // sessionId -> DOM element
let cursorUnsubscribe = null;
let cursorThrottleTimeout = null;
const CURSOR_THROTTLE_MS = 50;

// Cursor visibility preference
let cursorsVisible = localStorage.getItem('cursorsVisible') !== 'false'; // Default true

const toggleCursorsVisibility = () => {
    cursorsVisible = !cursorsVisible;
    localStorage.setItem('cursorsVisible', cursorsVisible);
    updateCursorsVisibilityUI();

    // Show/hide existing cursor elements
    const overlay = document.querySelector('.cursor-overlay');
    if (overlay) {
        overlay.style.display = cursorsVisible ? 'block' : 'none';
    }
};

const updateCursorsVisibilityUI = () => {
    if (dom.toggleCursorsText) {
        dom.toggleCursorsText.textContent = cursorsVisible ? 'Hide External Cursors' : 'Show External Cursors';
    }
};

// Track and broadcast cursor position
const trackCursor = (mapId) => {
    if (!mapId || !firebaseModules) return;

    const { ref, set, onValue, onDisconnect } = firebaseModules;
    const sessionId = getSessionId();
    const cursorRef = ref(rtdb, `cursors/${mapId}/${sessionId}`);
    const allCursorsRef = ref(rtdb, `cursors/${mapId}`);

    // Check if touch device - don't broadcast (no persistent cursor), but still listen
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    if (!isTouchDevice) {
        // Remove cursor on disconnect (only for non-touch devices)
        onDisconnect(cursorRef).remove();

        // Throttled cursor position broadcast
        const broadcastCursor = (e) => {
            if (cursorThrottleTimeout) return;

            const wrapper = dom.storyMapWrapper;
            const wrapperRect = wrapper.getBoundingClientRect();

            // Check if mouse is over the map area
            if (e.clientX < wrapperRect.left || e.clientX > wrapperRect.right ||
                e.clientY < wrapperRect.top || e.clientY > wrapperRect.bottom) {
                // Mouse left the map - clear cursor
                set(cursorRef, null);
                return;
            }

            // Calculate position relative to storyMap content
            // Account for: scroll position, storyMap's offset within wrapper (from margin:auto), and zoom
            const mapOffsetLeft = dom.storyMap.offsetLeft;
            const mapOffsetTop = dom.storyMap.offsetTop;
            const x = (e.clientX - wrapperRect.left + wrapper.scrollLeft - mapOffsetLeft) / zoomLevel;
            const y = (e.clientY - wrapperRect.top + wrapper.scrollTop - mapOffsetTop) / zoomLevel;

            set(cursorRef, {
                x: Math.round(x),
                y: Math.round(y),
                color: getCursorColor(sessionId),
                lastSeen: Date.now()
            });

            cursorThrottleTimeout = setTimeout(() => {
                cursorThrottleTimeout = null;
            }, CURSOR_THROTTLE_MS);
        };

        // Listen for mouse movement on the map
        dom.storyMapWrapper.addEventListener('mousemove', broadcastCursor);
        dom.storyMapWrapper.addEventListener('mouseleave', () => {
            set(cursorRef, null);
        });
    }

    // Listen for other users' cursors (all devices, including touch)
    if (cursorUnsubscribe) {
        cursorUnsubscribe();
    }

    // Create cursor overlay container (appended to wrapper, not storyMap, so it survives re-renders)
    let cursorOverlay = dom.storyMapWrapper.querySelector('.cursor-overlay');
    if (!cursorOverlay) {
        cursorOverlay = document.createElement('div');
        cursorOverlay.className = 'cursor-overlay';
        cursorOverlay.style.display = cursorsVisible ? 'block' : 'none';
        dom.storyMapWrapper.appendChild(cursorOverlay);
    }

    cursorUnsubscribe = onValue(allCursorsRef, (snapshot) => {
        const cursors = snapshot.val() || {};

        // Track which cursors are still active
        const activeSessions = new Set(Object.keys(cursors));

        // Remove cursors for users who left
        for (const [sid, el] of cursorElements) {
            if (!activeSessions.has(sid)) {
                el.remove();
                cursorElements.delete(sid);
            }
        }

        // Get storyMap offset for positioning
        const mapOffsetLeft = dom.storyMap.offsetLeft;
        const mapOffsetTop = dom.storyMap.offsetTop;

        // Update/create cursors for active users
        const now = Date.now();
        const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
        for (const [sid, data] of Object.entries(cursors)) {
            // Skip our own cursor, missing data, or stale cursors (onDisconnect failed)
            if (sid === sessionId || !data) continue;
            if (!data.lastSeen || now - data.lastSeen > STALE_THRESHOLD_MS) continue;

            let cursorEl = cursorElements.get(sid);

            if (!cursorEl) {
                // Create new cursor element with hand pointer shape
                cursorEl = document.createElement('div');
                cursorEl.className = 'remote-cursor';
                cursorEl.innerHTML = `
                    <svg viewBox="0 0 32 32" width="24" height="24">
                        <path d="${CURSOR_SVG_PATH}" fill="${data.color}" stroke="#fff" stroke-width="1.5"/>
                    </svg>
                `;
                cursorOverlay.appendChild(cursorEl);
                cursorElements.set(sid, cursorEl);
            }

            // Convert content coordinates to visual coordinates (account for zoom and offset)
            const visualX = data.x * zoomLevel + mapOffsetLeft;
            const visualY = data.y * zoomLevel + mapOffsetTop;
            cursorEl.style.left = `${visualX}px`;
            cursorEl.style.top = `${visualY}px`;
        }
    });
};

const clearCursors = () => {
    if (cursorUnsubscribe) {
        cursorUnsubscribe();
        cursorUnsubscribe = null;
    }
    // Remove all cursor elements
    for (const el of cursorElements.values()) {
        el.remove();
    }
    cursorElements.clear();
};

// =============================================================================
// Lock Feature - Password-protect maps
// =============================================================================

// Lock state - tracks whether map is locked and if current session has unlocked it
const lockState = {
    isLocked: false,
    passwordHash: null,
    sessionUnlocked: false  // True if this session has successfully unlocked
};

let lockUnsubscribe = null;

// Hash password using SHA-256
const hashPassword = async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Check if map is effectively editable (not locked, or unlocked by this session)
const isMapEditable = () => {
    if (!lockState.isLocked) return true;
    return lockState.sessionUnlocked;
};

// Load password hash from Firestore
const loadPasswordHash = async (mapId) => {
    if (!mapId) return;
    await ensureAppCheck();
    const { doc, getDoc } = firebaseModules;
    try {
        const docSnap = await getDoc(doc(db, 'maps', mapId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            lockState.passwordHash = data.passwordHash || null;
            lockState.isLocked = !!data.isLocked;
        }
    } catch (err) {
        console.error('Failed to load lock state:', err);
    }
};

// Subscribe to lock state changes via RTDB for real-time updates
const subscribeLockState = (mapId) => {
    if (!mapId || !firebaseModules) return;

    const { ref, onValue } = firebaseModules;
    const lockRef = ref(rtdb, `locks/${mapId}`);

    // Clean up previous listener
    if (lockUnsubscribe) {
        lockUnsubscribe();
    }

    lockUnsubscribe = onValue(lockRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const wasLocked = lockState.isLocked;
            lockState.isLocked = !!data.isLocked;

            // If map was just locked by someone else, check our session unlock status
            if (!wasLocked && lockState.isLocked) {
                lockState.sessionUnlocked = checkSessionUnlock(mapId);
            }
        } else {
            lockState.isLocked = false;
        }
        updateLockUI();
        updateEditability();
    });
};

// Clear lock subscription
const clearLockSubscription = () => {
    if (lockUnsubscribe) {
        lockUnsubscribe();
        lockUnsubscribe = null;
    }
    lockState.isLocked = false;
    lockState.passwordHash = null;
    lockState.sessionUnlocked = false;
};

// Lock the map with a password
const lockMap = async (password) => {
    if (!state.mapId) return;

    await ensureAppCheck();
    const { doc, setDoc, serverTimestamp } = firebaseModules;
    const { ref, set } = firebaseModules;

    const hash = await hashPassword(password);

    try {
        // Save to Firestore (password hash persisted)
        await setDoc(doc(db, 'maps', state.mapId), {
            isLocked: true,
            passwordHash: hash,
            lockedAt: serverTimestamp(),
            lockedBy: getSessionId()
        }, { merge: true });

        // Broadcast lock state via RTDB for real-time sync
        await set(ref(rtdb, `locks/${state.mapId}`), {
            isLocked: true,
            lockedAt: Date.now()
        });

        lockState.isLocked = true;
        lockState.passwordHash = hash;
        // The locker automatically has access
        lockState.sessionUnlocked = true;
        saveSessionUnlock(state.mapId);

        updateLockUI();
        updateEditability();

        // Show confirmation to the user who locked it
        alert('Map is now read-only. Others will need the password to edit, but you can continue editing in this session.');
    } catch (err) {
        console.error('Failed to lock map:', err);
        alert('Failed to lock map. Please try again.');
    }
};

// Remove lock entirely (make map publicly editable again)
const removeLock = async () => {
    if (!state.mapId) return;

    await ensureAppCheck();
    const { doc, setDoc } = firebaseModules;
    const { ref, set } = firebaseModules;

    try {
        // Clear lock state in Firestore
        await setDoc(doc(db, 'maps', state.mapId), {
            isLocked: false,
            passwordHash: null,
            lockedAt: null,
            lockedBy: null
        }, { merge: true });

        // Broadcast unlock via RTDB
        await set(ref(rtdb, `locks/${state.mapId}`), null);

        lockState.isLocked = false;
        lockState.passwordHash = null;
        lockState.sessionUnlocked = false;

        // Clear from session storage
        const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
        delete unlockedMaps[state.mapId];
        sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));

        updateLockUI();
        updateEditability();
    } catch (err) {
        console.error('Failed to remove lock:', err);
        alert('Failed to remove lock. Please try again.');
    }
};

// Re-lock the map (for users who have already unlocked)
const relockMap = async () => {
    if (!state.mapId || !lockState.passwordHash) return;

    await ensureAppCheck();
    const { doc, setDoc, serverTimestamp } = firebaseModules;
    const { ref, set } = firebaseModules;

    try {
        // Update lock state in Firestore
        await setDoc(doc(db, 'maps', state.mapId), {
            isLocked: true,
            lockedAt: serverTimestamp(),
            lockedBy: getSessionId()
        }, { merge: true });

        // Broadcast lock state via RTDB for real-time sync
        await set(ref(rtdb, `locks/${state.mapId}`), {
            isLocked: true,
            lockedAt: Date.now()
        });

        lockState.isLocked = true;
        // Keep sessionUnlocked true for this user
        updateLockUI();
        updateEditability();
    } catch (err) {
        console.error('Failed to re-lock map:', err);
        alert('Failed to lock map. Please try again.');
    }
};

// Unlock map locally (verify password client-side)
const unlockMapLocally = async (password) => {
    if (!lockState.passwordHash) {
        // Need to load password hash first
        await loadPasswordHash(state.mapId);
    }

    const inputHash = await hashPassword(password);

    if (inputHash === lockState.passwordHash) {
        lockState.sessionUnlocked = true;
        saveSessionUnlock(state.mapId);
        updateLockUI();
        updateEditability();
        return true;
    }

    return false;
};

// Save unlock status to session storage
const saveSessionUnlock = (mapId) => {
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    unlockedMaps[mapId] = true;
    sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));
};

// Check session storage for prior unlock
const checkSessionUnlock = (mapId) => {
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    return !!unlockedMaps[mapId];
};

// Update lock menu item and banner UI
const updateLockUI = () => {
    if (!dom.lockMapBtn || !dom.readOnlyBanner) return;

    // Only show lock option when viewing a shared map
    if (!state.mapId) {
        dom.lockMapBtn.classList.remove('visible');
        dom.relockBtn.classList.remove('visible');
        dom.updatePasswordBtn.classList.remove('visible');
        dom.removeLockBtn.classList.remove('visible');
        dom.lockDivider.classList.remove('visible');
        dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        return;
    }

    dom.lockDivider.classList.add('visible');

    if (lockState.isLocked && !lockState.sessionUnlocked) {
        // Locked and user hasn't unlocked - show unlock option only
        dom.lockMapBtn.classList.add('visible');
        dom.lockMapBtn.innerHTML = '<span class="lock-menu-icon">🔒</span> Unlock Map';
        dom.relockBtn.classList.remove('visible');
        dom.updatePasswordBtn.classList.remove('visible');
        dom.removeLockBtn.classList.remove('visible');
        dom.readOnlyBanner.classList.add('visible');
        document.body.classList.add('read-only-mode');
        // Disable samples and import when locked
        dom.samplesSubmenuTrigger?.classList.add('disabled');
        dom.importBtn?.classList.add('disabled');
    } else if (lockState.isLocked && lockState.sessionUnlocked) {
        // Locked but user has unlocked - show re-lock, update password, and remove lock
        dom.lockMapBtn.classList.remove('visible');
        dom.relockBtn.classList.add('visible');
        dom.updatePasswordBtn.classList.add('visible');
        dom.removeLockBtn.classList.add('visible');
        dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        // Enable samples and import when unlocked
        dom.samplesSubmenuTrigger?.classList.remove('disabled');
        dom.importBtn?.classList.remove('disabled');
    } else {
        // Not locked - show lock option only
        dom.lockMapBtn.classList.add('visible');
        dom.lockMapBtn.innerHTML = '<span class="lock-menu-icon">🔓</span> Lock Map (Read-only)';
        dom.relockBtn.classList.remove('visible');
        dom.updatePasswordBtn.classList.remove('visible');
        dom.removeLockBtn.classList.remove('visible');
        dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        // Enable samples and import when not locked
        dom.samplesSubmenuTrigger?.classList.remove('disabled');
        dom.importBtn?.classList.remove('disabled');
    }
};

// Track previous editability to avoid unnecessary sortable reinit
let wasEditable = true;

// Enable/disable editing based on lock state
const updateEditability = () => {
    const editable = isMapEditable();

    // The CSS class 'read-only-mode' handles most of the visual changes

    // If we're in read-only mode, blur any focused textareas to prevent typing
    if (!editable) {
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
            if (active !== dom.lockPasswordInput) {
                active.blur();
            }
        }
    }

    // Only reinit sortable if editability changed
    if (editable !== wasEditable) {
        wasEditable = editable;
        initSortable();
    }
};

// Show lock modal
const showLockModal = (mode) => {
    if (!dom.lockModal) return;

    dom.lockPasswordInput.value = '';
    const noteEl = document.getElementById('lockModalNote');

    if (mode === 'lock') {
        dom.lockModalTitle.textContent = 'Lock This Map';
        dom.lockModalDescription.textContent = 'Create a password to make this map read-only. Anyone with the password can unlock it to edit.';
        dom.lockModalConfirm.textContent = 'Lock Map';
        if (noteEl) noteEl.style.display = 'block';
    } else if (mode === 'relock') {
        dom.lockModalTitle.textContent = 'Change Password';
        dom.lockModalDescription.textContent = 'Set a new password for this read-only map. The old password will no longer work.';
        dom.lockModalConfirm.textContent = 'Set New Password';
        if (noteEl) noteEl.style.display = 'block';
    } else {
        dom.lockModalTitle.textContent = 'Unlock This Map';
        dom.lockModalDescription.textContent = 'This map is read-only. Enter the password to unlock it and enable editing.';
        dom.lockModalConfirm.textContent = 'Unlock';
        if (noteEl) noteEl.style.display = 'none';
    }

    dom.lockModal.classList.add('visible');
    dom.lockModal.dataset.mode = mode;
    dom.lockPasswordInput.focus();
};

// Hide lock modal
const hideLockModal = () => {
    if (!dom.lockModal) return;
    dom.lockModal.classList.remove('visible');
    dom.lockPasswordInput.value = '';
};

// Handle lock button click (Lock Map / Unlock Map)
const handleLockButtonClick = () => {
    if (lockState.isLocked && !lockState.sessionUnlocked) {
        // Need to unlock
        showLockModal('unlock');
    } else {
        // First time locking - need password
        showLockModal('lock');
    }
};

// Handle re-lock button click (lock again with existing password)
const handleRelockClick = async () => {
    await relockMap();
    // Clear session unlock so user sees read-only mode
    lockState.sessionUnlocked = false;
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    delete unlockedMaps[state.mapId];
    sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));
    updateLockUI();
    updateEditability();
};

// Handle update password button click
const handleUpdatePasswordClick = () => {
    showLockModal('relock');
};

// Handle lock modal confirm
const handleLockModalConfirm = async () => {
    const password = dom.lockPasswordInput.value.trim();
    const mode = dom.lockModal.dataset.mode;

    if (!password) {
        alert('Please enter a password.');
        return;
    }

    if (mode === 'lock' || mode === 'relock') {
        if (password.length < 4) {
            alert('Password must be at least 4 characters.');
            return;
        }
        await lockMap(password);
        hideLockModal();
    } else {
        const success = await unlockMapLocally(password);
        if (success) {
            hideLockModal();
        } else {
            alert('Incorrect password. Please try again.');
            dom.lockPasswordInput.value = '';
            dom.lockPasswordInput.focus();
        }
    }
};

// Initialize lock event listeners
const initLockListeners = () => {
    if (dom.lockMapBtn) {
        dom.lockMapBtn.addEventListener('click', () => {
            closeMainMenu();
            handleLockButtonClick();
        });
    }

    if (dom.relockBtn) {
        dom.relockBtn.addEventListener('click', () => {
            closeMainMenu();
            handleRelockClick();
        });
    }

    if (dom.updatePasswordBtn) {
        dom.updatePasswordBtn.addEventListener('click', () => {
            closeMainMenu();
            handleUpdatePasswordClick();
        });
    }

    if (dom.removeLockBtn) {
        dom.removeLockBtn.addEventListener('click', () => {
            closeMainMenu();
            if (confirm('Remove read-only lock? Anyone with the link will be able to edit this map.')) {
                removeLock();
            }
        });
    }

    if (dom.lockModalClose) {
        dom.lockModalClose.addEventListener('click', hideLockModal);
    }

    if (dom.lockModalCancel) {
        dom.lockModalCancel.addEventListener('click', hideLockModal);
    }

    if (dom.lockModalConfirm) {
        dom.lockModalConfirm.addEventListener('click', handleLockModalConfirm);
    }

    if (dom.lockPasswordInput) {
        dom.lockPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLockModalConfirm();
            }
        });
    }

    if (dom.lockModal) {
        dom.lockModal.addEventListener('click', (e) => {
            if (e.target === dom.lockModal) {
                hideLockModal();
            }
        });
    }
};

// =============================================================================
// Utils
// =============================================================================

// Generate cryptographically secure 8-char ID
// 6 random bytes → BigInt → base36 string (0-9, a-z) → last 8 chars
const generateId = () => {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const num = Array.from(bytes).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
    return num.toString(36).slice(-8).padStart(8, '0');
};

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
    red: '#fca5a5',
    rose: '#fecdd3',
    orange: '#fdba74',
    amber: '#fcd34d',
    yellow: '#fef08a',
    lime: '#bef264',
    green: '#86efac',
    teal: '#5eead4',
    cyan: '#a5f3fc',
    blue: '#93c5fd',
    indigo: '#a5b4fc',
    purple: '#d8b4fe',
    fuchsia: '#f0abfc',
    pink: '#f9a8d4'
};

// Default colors for card types (references CARD_COLORS values)
const DEFAULT_CARD_COLORS = {
    Users: '#fca5a5',       // red
    Activities: '#93c5fd',  // blue
    story: '#fef08a'        // yellow
};

const STATUS_OPTIONS = {
    done: { label: 'Done', color: '#22c55e' },
    'in-progress': { label: 'In Progress', color: '#eab308' },
    planned: { label: 'Planned', color: '#f97316' }
};

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
window.el = el;

// =============================================================================
// State
// =============================================================================

const state = {
    mapId: null,
    name: '',
    columns: [],
    slices: []
};
window.state = state;

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
    const beforeState = serialize();
    redoStack.push(JSON.stringify(beforeState));
    const previous = JSON.parse(undoStack.pop());
    const changes = findChangedPositions(beforeState, previous);
    deserialize(previous);
    dom.boardName.value = state.name;
    renderAndSave();
    highlightChangedElements(changes);
    updateUndoRedoButtons();
};

const redo = () => {
    if (redoStack.length === 0) return;
    const beforeState = serialize();
    undoStack.push(JSON.stringify(beforeState));
    const next = JSON.parse(redoStack.pop());
    const changes = findChangedPositions(beforeState, next);
    deserialize(next);
    dom.boardName.value = state.name;
    renderAndSave();
    highlightChangedElements(changes);
    updateUndoRedoButtons();
};

const updateUndoRedoButtons = () => {
    if (dom.undoBtn) dom.undoBtn.disabled = undoStack.length === 0;
    if (dom.redoBtn) dom.redoBtn.disabled = redoStack.length === 0;
};

// Compare two serialized states and return positions of changed elements
const findChangedPositions = (before, after) => {
    const changes = { columns: [], stories: [], sliceNames: [] };

    // Compare columns (steps)
    const maxCols = Math.max(before.a?.length || 0, after.a?.length || 0);
    for (let i = 0; i < maxCols; i++) {
        const bCol = before.a?.[i];
        const aCol = after.a?.[i];
        if (JSON.stringify(bCol) !== JSON.stringify(aCol)) {
            changes.columns.push(i);
        }
    }

    // Compare slices and stories
    const maxSlices = Math.max(before.s?.length || 0, after.s?.length || 0);
    for (let si = 0; si < maxSlices; si++) {
        const bSlice = before.s?.[si];
        const aSlice = after.s?.[si];

        // Check slice name
        if ((bSlice?.n || '') !== (aSlice?.n || '')) {
            changes.sliceNames.push(si);
        }

        // Compare stories in each column
        for (let ci = 0; ci < maxCols; ci++) {
            const bStories = bSlice?.t?.[ci] || [];
            const aStories = aSlice?.t?.[ci] || [];
            const maxStories = Math.max(bStories.length, aStories.length);

            for (let sti = 0; sti < maxStories; sti++) {
                if (JSON.stringify(bStories[sti]) !== JSON.stringify(aStories[sti])) {
                    changes.stories.push({ slice: si, col: ci, story: sti });
                }
            }
        }
    }

    return changes;
};

// Apply highlight to changed elements after render
const highlightChangedElements = (changes) => {
    // Highlight changed columns (steps row)
    changes.columns.forEach(colIdx => {
        const col = state.columns[colIdx];
        if (col) {
            const step = dom.storyMap.querySelector(`.step[data-column-id="${col.id}"]`);
            if (step) step.classList.add('undo-highlight');
        }
    });

    // Highlight changed stories
    changes.stories.forEach(({ slice: sliceIdx, col: colIdx, story: storyIdx }) => {
        const slice = state.slices[sliceIdx];
        const col = state.columns[colIdx];
        if (!slice || !col) return;

        const sliceContainer = dom.storyMap.querySelector(`[data-slice-id="${slice.id}"]`);
        if (!sliceContainer) return;

        const column = sliceContainer.querySelector(`.story-column[data-column-id="${col.id}"]`);
        if (!column) return;

        const card = column.querySelectorAll('.story-card')[storyIdx];
        if (card) card.classList.add('undo-highlight');
    });

    // Highlight changed slice names (only for release slices with labels)
    changes.sliceNames.forEach(sliceIdx => {
        const slice = state.slices[sliceIdx];
        if (!slice) return;

        const label = dom.storyMap.querySelector(`.slice-label-container[data-slice-id="${slice.id}"]`);
        if (label) label.classList.add('undo-highlight');
    });

    // Remove highlight class after animation completes
    setTimeout(() => {
        dom.storyMap.querySelectorAll('.undo-highlight').forEach(el => {
            el.classList.remove('undo-highlight');
        });
    }, 1600);
};

const initState = () => {
    const column = createColumn('New Step', null, null, false);
    state.name = '';
    state.columns = [column];
    state.slices = [
        { id: generateId(), name: '', separator: false, rowType: 'Users', stories: { [column.id]: [createStory('User Type', '#fca5a5')] } },
        { id: generateId(), name: '', separator: false, rowType: 'Activities', stories: { [column.id]: [createStory('New Activity', '#93c5fd')] } },
        { id: generateId(), name: '', separator: true, rowType: null, stories: { [column.id]: [createStory('New Task or Detail', '#fef08a')] } }
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
    copyExistingBtn: document.getElementById('copyExistingBtn'),
    importBtn: document.getElementById('importMap'),
    exportBtn: document.getElementById('exportMap'),
    printBtn: document.getElementById('printMap'),
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
    welcomeCounter: document.getElementById('welcomeCounter'),
    storyMapWrapper: document.getElementById('storyMapWrapper'),
    samplesSubmenuTrigger: document.getElementById('samplesSubmenuTrigger'),
    samplesSubmenu: document.getElementById('samplesSubmenu'),
    exportSubmenuTrigger: document.getElementById('exportSubmenuTrigger'),
    exportSubmenu: document.getElementById('exportSubmenu'),
    zoomControls: document.getElementById('zoomControls'),
    magnifierToggle: document.getElementById('magnifierToggle'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    importModal: document.getElementById('importModal'),
    importModalClose: document.getElementById('importModalClose'),
    importJsonText: document.getElementById('importJsonText'),
    importJsonBtn: document.getElementById('importJsonBtn'),
    importDropzone: document.getElementById('importDropzone'),
    importFileInput: document.getElementById('importFileInput'),
    exportModal: document.getElementById('exportModal'),
    exportModalClose: document.getElementById('exportModalClose'),
    exportJsonText: document.getElementById('exportJsonText'),
    exportMinify: document.getElementById('exportMinify'),
    exportCopyBtn: document.getElementById('exportCopyBtn'),
    exportFilename: document.getElementById('exportFilename'),
    exportDownloadBtn: document.getElementById('exportDownloadBtn'),
    // Jira export
    exportJiraBtn: document.getElementById('exportJiraBtn'),
    jiraExportModal: document.getElementById('jiraExportModal'),
    jiraExportModalClose: document.getElementById('jiraExportModalClose'),
    jiraProjectName: document.getElementById('jiraProjectName'),
    jiraProjectKey: document.getElementById('jiraProjectKey'),
    jiraProjectType: document.getElementById('jiraProjectType'),
    jiraExportSlices: document.getElementById('jiraExportSlices'),
    jiraExportEpics: document.getElementById('jiraExportEpics'),
    jiraExportCount: document.getElementById('jiraExportCount'),
    jiraExportCancel: document.getElementById('jiraExportCancel'),
    jiraExportDownload: document.getElementById('jiraExportDownload'),
    jiraStatusNone: document.getElementById('jiraStatusNone'),
    jiraStatusDone: document.getElementById('jiraStatusDone'),
    jiraStatusInProgress: document.getElementById('jiraStatusInProgress'),
    jiraStatusPlanned: document.getElementById('jiraStatusPlanned'),
    jiraFilterNone: document.getElementById('jiraFilterNone'),
    jiraFilterPlanned: document.getElementById('jiraFilterPlanned'),
    jiraFilterInProgress: document.getElementById('jiraFilterInProgress'),
    jiraFilterDone: document.getElementById('jiraFilterDone'),
    // Phabricator export
    exportPhabBtn: document.getElementById('exportPhabBtn'),
    phabExportModal: document.getElementById('phabExportModal'),
    phabExportModalClose: document.getElementById('phabExportModalClose'),
    phabExportTitle: document.getElementById('phabExportTitle'),
    phabStage1: document.getElementById('phabStage1'),
    phabStage2: document.getElementById('phabStage2'),
    phabExportSlices: document.getElementById('phabExportSlices'),
    phabExportEpics: document.getElementById('phabExportEpics'),
    phabExportCount: document.getElementById('phabExportCount'),
    phabFilterNone: document.getElementById('phabFilterNone'),
    phabFilterPlanned: document.getElementById('phabFilterPlanned'),
    phabFilterInProgress: document.getElementById('phabFilterInProgress'),
    phabFilterDone: document.getElementById('phabFilterDone'),
    phabExportCancel: document.getElementById('phabExportCancel'),
    phabExportNext: document.getElementById('phabExportNext'),
    phabExportBack: document.getElementById('phabExportBack'),
    phabExportDone: document.getElementById('phabExportDone'),
    phabInstanceUrl: document.getElementById('phabInstanceUrl'),
    phabApiToken: document.getElementById('phabApiToken'),
    phabTags: document.getElementById('phabTags'),
    phabImportFunction: document.getElementById('phabImportFunction'),
    phabImportCall: document.getElementById('phabImportCall'),
    phabCopyFunction: document.getElementById('phabCopyFunction'),
    phabCopyCall: document.getElementById('phabCopyCall'),
    // Jira API export
    exportJiraApiBtn: document.getElementById('exportJiraApiBtn'),
    jiraApiExportModal: document.getElementById('jiraApiExportModal'),
    jiraApiExportModalClose: document.getElementById('jiraApiExportModalClose'),
    jiraApiExportTitle: document.getElementById('jiraApiExportTitle'),
    jiraApiStage1: document.getElementById('jiraApiStage1'),
    jiraApiStage2: document.getElementById('jiraApiStage2'),
    jiraApiExportSlices: document.getElementById('jiraApiExportSlices'),
    jiraApiExportEpics: document.getElementById('jiraApiExportEpics'),
    jiraApiExportCount: document.getElementById('jiraApiExportCount'),
    jiraApiFilterNone: document.getElementById('jiraApiFilterNone'),
    jiraApiFilterPlanned: document.getElementById('jiraApiFilterPlanned'),
    jiraApiFilterInProgress: document.getElementById('jiraApiFilterInProgress'),
    jiraApiFilterDone: document.getElementById('jiraApiFilterDone'),
    jiraApiExportCancel: document.getElementById('jiraApiExportCancel'),
    jiraApiExportNext: document.getElementById('jiraApiExportNext'),
    jiraApiExportBack: document.getElementById('jiraApiExportBack'),
    jiraApiExportDone: document.getElementById('jiraApiExportDone'),
    jiraApiEmail: document.getElementById('jiraApiEmail'),
    jiraApiToken: document.getElementById('jiraApiToken'),
    jiraApiProjectKey: document.getElementById('jiraApiProjectKey'),
    jiraApiImportFunction: document.getElementById('jiraApiImportFunction'),
    jiraApiImportCall: document.getElementById('jiraApiImportCall'),
    jiraApiCopyFunction: document.getElementById('jiraApiCopyFunction'),
    jiraApiCopyCall: document.getElementById('jiraApiCopyCall'),
    // Cursor toggle
    toggleCursorsBtn: document.getElementById('toggleCursorsBtn'),
    toggleCursorsText: document.getElementById('toggleCursorsText'),
    // Lock feature
    lockMapBtn: document.getElementById('lockMapBtn'),
    relockBtn: document.getElementById('relockBtn'),
    updatePasswordBtn: document.getElementById('updatePasswordBtn'),
    removeLockBtn: document.getElementById('removeLockBtn'),
    lockDivider: document.getElementById('lockDivider'),
    lockModal: document.getElementById('lockModal'),
    lockModalTitle: document.getElementById('lockModalTitle'),
    lockModalDescription: document.getElementById('lockModalDescription'),
    lockModalClose: document.getElementById('lockModalClose'),
    lockPasswordInput: document.getElementById('lockPasswordInput'),
    lockModalCancel: document.getElementById('lockModalCancel'),
    lockModalConfirm: document.getElementById('lockModalConfirm'),
    readOnlyBanner: document.getElementById('readOnlyBanner')
};
window.dom = dom;

// Menu helpers
const closeMainMenu = () => {
    dom.mainMenu.classList.remove('visible');
    dom.samplesSubmenu.classList.remove('visible');
    dom.samplesSubmenuTrigger.classList.remove('expanded');
    dom.exportSubmenu.classList.remove('visible');
    dom.exportSubmenuTrigger.classList.remove('expanded');
    document.body.classList.remove('main-menu-open');
};

const closeAllOptionsMenus = () => {
    document.querySelectorAll('.options-menu.visible').forEach(m => {
        m.classList.remove('visible');
        m.closest('.step, .story-card')?.classList.remove('menu-open');
        m.parentElement?.querySelector('.btn-options')?.setAttribute('aria-expanded', 'false');
    });
    // Also close slice menus
    document.querySelectorAll('.slice-menu-dropdown.visible').forEach(m => {
        m.classList.remove('visible');
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
    // Show magnifier toggle at 50% zoom or less, disable if going above
    const showMagnifier = zoomLevel <= 0.5;
    dom.magnifierToggle.classList.toggle('visible', showMagnifier);
    if (!showMagnifier && magnifierEnabled) {
        magnifierEnabled = false;
        dom.magnifierToggle.innerHTML = '&#128269;';
        hideMagnifier();
    }
};

// Auto-fit content to viewport width
const zoomToFit = () => {
    const wrapper = dom.storyMapWrapper;

    // Calculate content width based on column count
    // Layout: label-gutter (80px) + columns (180px each) + gaps (10px) + add-btn (36px)
    const CARD_WIDTH = 180;
    const LABEL_WIDTH = 80;
    const GAP = 10;
    const ADD_BTN_WIDTH = 36;
    const BODY_PADDING = 48; // 24px on each side

    const columnCount = state.columns.length;
    const contentWidth = LABEL_WIDTH + (columnCount * CARD_WIDTH) + (columnCount * GAP) + ADD_BTN_WIDTH;

    // Get available width (viewport minus body padding)
    const availableWidth = wrapper.clientWidth - BODY_PADDING;

    // Calculate zoom to fit width (leave small buffer)
    const fitZoom = Math.min(1, (availableWidth - 20) / contentWidth);

    // Round down to nearest 5% and clamp
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(fitZoom * 20) / 20));

    updateZoom();
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

// Pan/drag state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

// Update pan mode based on zoom level
const updatePanMode = () => {
    const wrapper = dom.storyMapWrapper;
    const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth || wrapper.scrollHeight > wrapper.clientHeight;
    if (hasOverflow) {
        wrapper.classList.add('pan-enabled');
    } else {
        wrapper.classList.remove('pan-enabled');
    }
};

// Pan handlers
const startPan = (e) => {
    // Only enable pan when there's overflow and not clicking on interactive elements
    const wrapper = dom.storyMapWrapper;
    const hasOverflow = wrapper.scrollWidth > wrapper.clientWidth || wrapper.scrollHeight > wrapper.clientHeight;
    if (!hasOverflow) return;
    if (e.target.closest('button, textarea, input, .story-card, .step, .options-menu, .slice-drag-handle, .step-drag-handle')) return;

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
let magnifierEnabled = false;
const MAGNIFIER_WIDTH = 500;
const MAGNIFIER_HEIGHT = 400;
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
    if (!magnifier || !magnifierEnabled || isPanning) {
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

// Slice menu with Mark Complete and Delete options
const createSliceMenu = (slice, onDelete, deleteMessage) => {
    const container = el('div', 'slice-menu');

    const btn = el('button', 'btn-slice-menu', { text: '☰', title: 'Slice options', ariaLabel: 'Slice options menu' });
    const menu = el('div', 'slice-menu-dropdown');

    // Mark as complete / Reopen option
    const completeOption = el('button', 'slice-menu-item');
    if (slice.collapsed) {
        completeOption.innerHTML = '<span class="slice-menu-icon">↩</span> Reopen';
        completeOption.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSliceCollapsed(slice.id, false);
            menu.classList.remove('visible');
        });
    } else {
        completeOption.innerHTML = '<span class="slice-menu-icon">✓</span> Mark Complete';
        completeOption.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSliceCollapsed(slice.id, true);
            menu.classList.remove('visible');
        });
    }
    menu.appendChild(completeOption);

    // Delete option
    const deleteOption = el('button', 'slice-menu-item slice-menu-item-danger');
    deleteOption.innerHTML = '<span class="slice-menu-icon">🗑</span> Delete';
    deleteOption.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('visible');
        if (confirm(deleteMessage)) onDelete();
    });
    menu.appendChild(deleteOption);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other menus
        document.querySelectorAll('.slice-menu-dropdown.visible').forEach(m => {
            if (m !== menu) m.classList.remove('visible');
        });
        menu.classList.toggle('visible');
    });

    container.appendChild(btn);
    container.appendChild(menu);
    return container;
};

// Toggle slice collapsed state
const toggleSliceCollapsed = (sliceId, collapsed) => {
    const slice = state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    slice.collapsed = collapsed;
    saveToStorage();
    render();
};

const createOptionsMenu = (item, colors, onDelete, deleteMessage, onColorChange, onUrlChange, onStatusChange = null, onHide = null, onDeleteColumn = null) => {
    const container = el('div', 'card-options');

    const btn = el('button', 'btn-options', { text: '...', title: 'Options', ariaLabel: 'Options menu', ariaHasPopup: 'true', ariaExpanded: 'false' });
    const menu = el('div', 'options-menu');

    // Color option
    const colorOption = el('div', 'options-item options-color');
    colorOption.appendChild(el('span', null, { text: 'Color' }));
    const colorSwatches = el('div', 'color-swatches');
    const itemColor = item.color?.toLowerCase();
    Object.entries(colors).forEach(([name, hex]) => {
        const swatch = el('button', 'color-swatch', { title: name });
        swatch.style.backgroundColor = hex;
        if (itemColor === hex.toLowerCase()) swatch.classList.add('selected');
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

    // Push undo when user starts editing
    textarea.addEventListener('focus', () => pushUndo());

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
            saveToStorage();
        });

        // Auto-resize on initial render
        requestAnimationFrame(autoResize);
    } else {
        textarea.addEventListener('input', (e) => {
            onChange(e.target.value);
            saveToStorage();
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

    // Drag handle for reordering columns
    const dragHandle = el('div', 'step-drag-handle', { html: '↔', title: 'Drag to move entire column' });
    card.appendChild(dragHandle);

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

const createStoryCard = (story, columnId, sliceId, isBackboneRow = false, rowType = null) => {
    const card = el('div', 'story-card', {
        dataStoryId: story.id,
        dataColumnId: columnId,
        dataSliceId: sliceId
    });
    if (story.color) card.style.backgroundColor = story.color;

    let placeholderText = 'Task or Detail...';
    if (rowType === 'Users') {
        placeholderText = 'e.g. admin, customer, client';
    } else if (isBackboneRow) {
        placeholderText = 'Card...';
    }
    const textarea = createTextarea('story-text', placeholderText, story.name,
        (val) => story.name = val);

    const onDelete = () => deleteStory(columnId, sliceId, story.id);
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
        columnEl.appendChild(createStoryCard(story, col.id, slice.id, isBackboneRow, slice.rowType));
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

    const hasCards = slice.stories[col.id].length > 0;
    if ((!isBackboneRow || hasCards) && slice.rowType !== 'Activities') {
        let btnText = '+';
        if (hasCards && slice.rowType === 'Users') btnText = '+ user';
        const addBtn = el('button', 'btn-add-story', { text: btnText });
        addBtn.addEventListener('click', () => addStory(col.id, slice.id));
        columnEl.appendChild(addBtn);
    }

    return columnEl;
};

const createEmptyBackboneRow = (rowType, insertIndex) => {
    const containerClass = rowType === 'Users' ? 'users-row empty-backbone-row' :
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

// Calculate progress for a slice (% of tasks marked done)
const getSliceProgress = (slice) => {
    let total = 0;
    let done = 0;
    Object.values(slice.stories || {}).forEach(stories => {
        stories.forEach(story => {
            total++;
            if (story.status === 'done') done++;
        });
    });
    return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
};

const createSliceContainer = (slice, index) => {
    // Use semantic class names based on row type
    let containerClass = 'slice-container';
    if (slice.separator === false) {
        containerClass = slice.rowType === 'Users' ? 'users-row' :
                         slice.rowType === 'Activities' ? 'activities-row' :
                         'backbone-row';
    }
    if (slice.collapsed) {
        containerClass += ' slice-collapsed';
    }
    const container = el('div', containerClass, { dataSliceId: slice.id });

    // Label container (only for release slices, not backbone rows)
    if (slice.separator !== false) {
        const labelContainer = el('div', 'slice-label-container', { dataSliceId: slice.id });

        // If collapsed, show gutter with controls and banner in stories area
        if (slice.collapsed) {
            // Gutter controls
            const controlsRow = el('div', 'slice-controls-row');
            const dragHandle = el('div', 'slice-drag-handle', { html: '↕', title: 'Drag to reorder' });
            controlsRow.appendChild(dragHandle);

            if (state.slices.length > 1) {
                controlsRow.appendChild(createSliceMenu(slice, () => deleteSlice(slice.id),
                    `Delete "${slice.name || 'this slice'}" and all its stories?`));
            }
            labelContainer.appendChild(controlsRow);
            container.appendChild(labelContainer);

            // Stories area with row structure to maintain width
            const storiesArea = el('div', 'slice-stories-area');
            const storiesRow = el('div', 'stories-row slice-completed-row');

            // Add placeholder columns to maintain width, with banner centered over them
            state.columns.forEach(() => {
                const placeholder = el('div', 'story-column collapsed-column-placeholder');
                storiesRow.appendChild(placeholder);
            });

            // Add column button to match width of open slices
            const addColumnBtn = el('button', 'btn-add-column-inline', { text: '+', title: 'Add Step' });
            addColumnBtn.addEventListener('click', () => addColumn(true));
            storiesRow.appendChild(addColumnBtn);

            // Centered banner overlay
            const completedBanner = el('div', 'slice-completed-banner');
            const sliceName = slice.name ? `${slice.name} - ` : '';
            const bannerText = el('span', 'slice-completed-text', { text: `${sliceName}Complete` });
            completedBanner.appendChild(bannerText);
            storiesRow.appendChild(completedBanner);

            storiesArea.appendChild(storiesRow);
            container.appendChild(storiesArea);

            return container;
        }

        // Label at top
        const labelInput = createTextarea('slice-label', 'Release...', slice.name,
            (val) => slice.name = val);
        labelContainer.appendChild(labelInput);

        // Progress bar in middle
        const progress = getSliceProgress(slice);
        if (progress.total > 0) {
            const progressContainer = el('div', 'slice-progress', {
                title: `${progress.percent}% complete`
            });
            const progressTrack = el('div', 'slice-progress-track');
            const progressBar = el('div', 'slice-progress-bar');
            progressBar.style.width = `${progress.percent}%`;
            progressTrack.appendChild(progressBar);
            progressContainer.appendChild(progressTrack);
            const progressText = el('span', 'slice-progress-text', {
                text: `${progress.done}/${progress.total}`
            });
            progressContainer.appendChild(progressText);
            labelContainer.appendChild(progressContainer);
        }

        // Controls row at bottom: drag handle on left, menu on right
        const controlsRow = el('div', 'slice-controls-row');
        const dragHandle = el('div', 'slice-drag-handle', { html: '↕', title: 'Drag to reorder' });
        controlsRow.appendChild(dragHandle);

        if (state.slices.length > 1) {
            controlsRow.appendChild(createSliceMenu(slice, () => deleteSlice(slice.id),
                `Delete "${slice.name || 'this slice'}" and all its stories?`));
        }
        labelContainer.appendChild(controlsRow);

        // Add slice button in gutter
        const addSliceBtn = el('button', 'btn-add-slice', { text: '+ Slice' });
        addSliceBtn.addEventListener('click', () => addSlice(index + 1, true));
        labelContainer.appendChild(addSliceBtn);

        container.appendChild(labelContainer);
    } else {
        // Label container for backbone rows
        const labelContainer = el('div', 'row-label-container');

        // Row type label
        if (slice.rowType) {
            const label = el('span', 'row-type-label', { text: slice.rowType });
            labelContainer.appendChild(label);
        }

        // Delete button for rows (not for Users or Activities)
        if (slice.rowType !== 'Users' && slice.rowType !== 'Activities') {
            const deleteBtn = createDeleteBtn(
                () => deleteSlice(slice.id),
                `Delete the ${slice.rowType || 'row'} row and all its cards?`
            );
            labelContainer.appendChild(deleteBtn);
        }

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

    container.appendChild(storiesArea);
    return container;
};

// =============================================================================
// Rendering
// =============================================================================

const render = () => {
    // Save focused textarea before clearing DOM
    let savedFocus = null;
    const active = document.activeElement;
    if (active && active.tagName === 'TEXTAREA') {
        const card = active.closest('.story-card');
        const step = active.closest('.step');
        const sliceLabel = active.closest('.slice-label-container');

        if (card && card.dataset.storyId) {
            savedFocus = {
                selector: `.story-card[data-story-id="${card.dataset.storyId}"] .story-text`,
                selStart: active.selectionStart || 0,
                selEnd: active.selectionEnd || 0
            };
        } else if (step && step.dataset.columnId) {
            savedFocus = {
                selector: `.step[data-column-id="${step.dataset.columnId}"] .step-text`,
                selStart: active.selectionStart || 0,
                selEnd: active.selectionEnd || 0
            };
        } else if (sliceLabel && sliceLabel.dataset.sliceId) {
            savedFocus = {
                selector: `.slice-label-container[data-slice-id="${sliceLabel.dataset.sliceId}"] .slice-label`,
                selStart: active.selectionStart || 0,
                selEnd: active.selectionEnd || 0
            };
        }
    }

    dom.storyMap.innerHTML = '';

    // Separate backbone rows (Users, Activities) from release slices
    const rows = [];
    const slices = [];
    state.slices.forEach((slice, index) => {
        if (slice.separator === false) {
            rows.push({ slice, index });
        } else {
            slices.push({ slice, index });
        }
    });

    // Find specific row types
    const usersRow = rows.find(r => r.slice.rowType === 'Users');
    const activitiesRow = rows.find(r => r.slice.rowType === 'Activities');

    // Render Users row (or empty placeholder)
    if (usersRow) {
        dom.storyMap.appendChild(createSliceContainer(usersRow.slice, usersRow.index));
    } else {
        dom.storyMap.appendChild(createEmptyBackboneRow('Users', 0));
    }

    // Render Activities row (or empty placeholder)
    if (activitiesRow) {
        dom.storyMap.appendChild(createSliceContainer(activitiesRow.slice, activitiesRow.index));
    } else {
        const idx = usersRow ? usersRow.index + 1 : 0;
        dom.storyMap.appendChild(createEmptyBackboneRow('Activities', idx));
    }

    // Render any other backbone rows (non-Users, non-Activities)
    rows.filter(r => r.slice.rowType !== 'Users' && r.slice.rowType !== 'Activities')
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

    // Refresh magnifier content (if active)
    refreshMagnifierContent();

    // Restore focus if user was editing (but don't override value from state)
    if (savedFocus) {
        const textarea = dom.storyMap.querySelector(savedFocus.selector);
        if (textarea) {
            textarea.focus();
            // Only restore cursor position, not value - value comes from synced state
            const len = textarea.value.length;
            const selStart = Math.min(savedFocus.selStart, len);
            const selEnd = Math.min(savedFocus.selEnd, len);
            textarea.setSelectionRange(selStart, selEnd);
        }
    }
};

// Store Sortable instances to destroy on re-render
let sortableInstances = [];

const initSortable = async () => {
    await ensureSortable();

    // Destroy previous instances
    sortableInstances.forEach(s => s.destroy());
    sortableInstances = [];

    // Don't enable drag-drop if map is locked
    if (!isMapEditable()) {
        return;
    }

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

    // Make steps (columns) sortable - moves entire column
    const stepsRow = document.querySelector('.steps-row');
    if (stepsRow) {
        let isDragging = false;
        let dragColumnId = null;
        let columnStartX = new Map(); // columnId -> start X of story columns
        let animFrame = null;

        const captureStartPositions = () => {
            columnStartX.clear();
            // Capture start position of first story column for each column
            state.columns.forEach(col => {
                const firstStoryCol = document.querySelector(`.story-column[data-column-id="${col.id}"]`);
                if (firstStoryCol) {
                    columnStartX.set(col.id, firstStoryCol.getBoundingClientRect().left);
                }
            });
        };

        const updateColumnPositions = () => {
            if (!isDragging) return;

            // For each step, calculate where it is now vs where its story column started
            stepsRow.querySelectorAll('.step').forEach(step => {
                const columnId = step.dataset.columnId;
                const startX = columnStartX.get(columnId);
                if (startX === undefined) return;

                // Get the step's current visual position
                const stepRect = step.getBoundingClientRect();
                const deltaX = stepRect.left - startX;

                // Apply same transform to all story columns
                document.querySelectorAll(`.story-column[data-column-id="${columnId}"]`).forEach(el => {
                    el.style.transform = `translateX(${deltaX}px)`;
                });
            });

            animFrame = requestAnimationFrame(updateColumnPositions);
        };

        const sortable = Sortable.create(stepsRow, {
            animation: 150,
            handle: '.step-drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.step',
            filter: '.steps-row-spacer, .btn-add-step-inline',
            onStart: (evt) => {
                isDragging = true;
                dragColumnId = evt.item.dataset.columnId;
                captureStartPositions();

                // Mark dragged column's visible cards for styling
                evt.item.classList.add('column-being-dragged');
                document.querySelectorAll(`.story-column[data-column-id="${dragColumnId}"] .story-card`).forEach(card => {
                    card.classList.add('column-being-dragged');
                });

                animFrame = requestAnimationFrame(updateColumnPositions);
            },
            onEnd: () => {
                isDragging = false;

                if (animFrame) {
                    cancelAnimationFrame(animFrame);
                    animFrame = null;
                }

                // Reset all transforms and styles
                document.querySelectorAll('.story-column').forEach(el => {
                    el.style.transform = '';
                });
                document.querySelectorAll('.column-being-dragged').forEach(el => {
                    el.classList.remove('column-being-dragged');
                });

                // Read new order from DOM
                const stepElements = stepsRow.querySelectorAll('.step');
                const newOrder = [...stepElements].map(el =>
                    state.columns.find(c => c.id === el.dataset.columnId)
                ).filter(Boolean);

                // Check if order actually changed
                const orderChanged = newOrder.some((col, i) => col.id !== state.columns[i]?.id);
                if (!orderChanged) {
                    dragColumnId = null;
                    return;
                }

                pushUndo();
                state.columns = newOrder;
                dragColumnId = null;
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

    // Scroll to the new step after layout completes
    requestAnimationFrame(() => {
        // Find the new element by column ID (could be .step or .step-placeholder)
        const newStep = dom.storyMap.querySelector(`[data-column-id="${column.id}"]`);
        if (newStep) {
            scrollElementIntoView(newStep);
            if (!hidden) {
                newStep.querySelector('.step-text')?.focus();
            }
        }
    });
};

const addStory = (columnId, sliceId) => {
    const slice = state.slices.find(s => s.id === sliceId);
    if (!slice) return;

    pushUndo();

    slice.stories[columnId] = slice.stories[columnId] || [];

    // Use default color based on row type (yellow for regular tasks)
    const color = DEFAULT_CARD_COLORS[slice.rowType] || DEFAULT_CARD_COLORS.story;

    slice.stories[columnId].push(createStory('', color));
    renderAndSave();

    // Scroll to new card after layout completes
    const storyIndex = slice.stories[columnId].length - 1;
    requestAnimationFrame(() => {
        const column = dom.storyMap.querySelector(
            `.story-column[data-column-id="${columnId}"][data-slice-id="${sliceId}"]`
        );
        const newCard = column?.querySelectorAll('.story-card')[storyIndex];
        if (newCard) {
            scrollElementIntoView(newCard);
            newCard.querySelector('.story-text')?.focus();
        }
    });
};

const addSlice = (afterIndex, separator = true, rowType = null) => {
    pushUndo();
    const slice = createSlice('', separator, rowType);
    state.slices.splice(afterIndex, 0, slice);
    renderAndSave();

    // Scroll to new slice and focus label after layout completes
    requestAnimationFrame(() => {
        const sliceElement = dom.storyMap.querySelector(`[data-slice-id="${slice.id}"]`);
        if (sliceElement) {
            scrollElementIntoView(sliceElement);
            if (separator) {
                sliceElement.querySelector('.slice-label')?.focus();
            }
        }
    });
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

// Subscribe to real-time updates via Yjs
const subscribeToMap = async (mapId) => {
    await ensureAppCheck();

    if (!ydoc) {
        await createYjsDoc();
    }

    // Load existing data from Firestore
    if (await loadYjsFromFirestore(mapId)) {
        syncFromYjs();
        render();
    }

    subscribeToYjsUpdates(mapId);

    // Defer presence, cursor, and lock tracking to after initial render completes
    const deferredTracking = () => {
        trackPresence(mapId);
        trackCursor(mapId);
        // Check session unlock and subscribe to lock state
        lockState.sessionUnlocked = checkSessionUnlock(mapId);
        subscribeLockState(mapId);
    };
    if ('requestIdleCallback' in window) {
        requestIdleCallback(deferredTracking);
    } else {
        setTimeout(deferredTracking, 0);
    }
};

// Local storage save (also syncs to Yjs/Firestore)
const saveToStorage = () => {
    // Don't sync to remote if map is locked and user hasn't unlocked
    if (state.mapId && !isMapEditable()) {
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    // Sync to Yjs (which then syncs to Firestore)
    if (state.mapId && ymap) {
        syncToYjs();
    }
};

// Combined render and save - used after state mutations
const renderAndSave = () => {
    render();
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
        if (slice.collapsed) obj.col = true;
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
        return createColumn(a.n || '', a.c || null, sanitizeUrl(a.u), !!a.h, a.st || null);
    });
    state.slices = data.s.map(slice => {
        const newSlice = {
            id: generateId(),
            name: slice.n || '',
            separator: slice.sep !== false,
            rowType: slice.rt || null,
            collapsed: !!slice.col,
            stories: {}
        };
        const stories = Array.isArray(slice.t) ? slice.t : [];
        state.columns.forEach((col, i) => {
            newSlice.stories[col.id] = (stories[i] || []).map(t => {
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
    saveToStorage();
    showExportModal();
};

const importMap = (file) => {
    const isFromWelcome = !state.mapId;

    if (!isFromWelcome) {
        saveToStorage();
        if (!confirmOverwrite()) return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            if (isFromWelcome) {
                hideWelcomeScreen();
                initState();
                const mapId = generateId();
                state.mapId = mapId;
                history.replaceState({ mapId }, '', `/${mapId}`);
                await createYjsDoc();
            } else {
                pushUndo(); // Save state before import
            }
            deserialize(JSON.parse(e.target.result));
            dom.boardName.value = state.name;
            renderAndSave();
            if (isFromWelcome) {
                subscribeToMap(state.mapId);
            }
        } catch {
            alert('Failed to import: Invalid file format');
        }
    };
    reader.readAsText(file);
};

// Import Modal
const showImportModal = () => {
    dom.importModal.classList.add('visible');
    dom.importJsonText.value = '';
    dom.importJsonText.focus();
};

const hideImportModal = () => {
    dom.importModal.classList.remove('visible');
    dom.importJsonText.value = '';
};

const importFromJsonText = async (jsonText) => {
    const isFromWelcome = !state.mapId;

    if (!isFromWelcome) {
        saveToStorage();
        if (!confirmOverwrite()) return;
    }

    try {
        const data = JSON.parse(jsonText);
        if (isFromWelcome) {
            hideWelcomeScreen();
            initState();
            const mapId = generateId();
            state.mapId = mapId;
            history.replaceState({ mapId }, '', `/${mapId}`);
            await createYjsDoc();
        } else {
            pushUndo();
        }
        deserialize(data);
        dom.boardName.value = state.name;
        renderAndSave();
        hideImportModal();
        if (isFromWelcome) {
            subscribeToMap(state.mapId);
        }
    } catch {
        alert('Failed to import: Invalid JSON format');
    }
};

// Export Modal
const updateExportJson = () => {
    const minify = dom.exportMinify.checked;
    const json = minify ? JSON.stringify(serialize()) : JSON.stringify(serialize(), null, 2);
    dom.exportJsonText.value = json;
};

const sanitizeFilename = (name) => {
    return name
        .toLowerCase()                           // Lowercase
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') // Replace unsafe chars
        .replace(/^\.+/, '')                     // Remove leading dots
        .replace(/\s+/g, '-')                    // Replace whitespace with hyphens
        .replace(/-+/g, '-')                     // Collapse multiple hyphens
        .replace(/^-+|-+$/g, '')                 // Trim leading/trailing hyphens
        .substring(0, 200)                       // Limit length
        || 'story-map';                          // Fallback if empty
};
window.sanitizeFilename = sanitizeFilename;

const showExportModal = () => {
    dom.exportModal.classList.add('visible');
    dom.exportFilename.value = sanitizeFilename(state.name || 'story-map');
    dom.exportMinify.checked = false;
    updateExportJson();
};

const hideExportModal = () => {
    dom.exportModal.classList.remove('visible');
};

const copyExportJson = async () => {
    const json = dom.exportJsonText.value;
    try {
        await navigator.clipboard.writeText(json);
        dom.exportCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCopyBtn.textContent = 'Copy to Clipboard', 2000);
    } catch {
        dom.exportJsonText.select();
        document.execCommand('copy');
        dom.exportCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCopyBtn.textContent = 'Copy to Clipboard', 2000);
    }
};

const downloadExportFile = () => {
    const filename = sanitizeFilename(dom.exportFilename.value) + '.json';
    const json = dom.exportJsonText.value;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideExportModal();
};


const loadSample = async (name) => {
    // If on welcome screen (no map yet), use startWithSample instead
    if (!state.mapId) {
        return startWithSample(name);
    }

    saveToStorage();
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

const newMap = async () => {
    saveToStorage();
    if (hasContent() && !confirm('Create a new story map?\n\nYou can return to this map using the back button.')) {
        return;
    }
    // Destroy existing Yjs connection
    destroyYjs();

    // Clear mapId BEFORE initState to prevent overwriting old map
    state.mapId = null;

    // Hide welcome screen if visible
    hideWelcomeScreen();

    initState();
    dom.boardName.value = '';
    render();

    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.pushState({ mapId }, '', `/${mapId}`);

    await createYjsDoc();
    subscribeToMap(mapId);
    saveToStorage();
    incrementMapCounter();
};

const copyMap = async () => {
    saveToStorage();
    if (!confirm('Copy this map?\n\nA copy will be created with a new URL.')) {
        return;
    }
    // Destroy existing Yjs connection
    destroyYjs();

    // Update board name to indicate it's a copy
    const currentName = dom.boardName.value || 'Untitled';
    state.name = `${currentName} (Copy)`;
    dom.boardName.value = state.name;

    // Generate new map ID but keep current data
    const mapId = generateId();
    state.mapId = mapId;
    history.pushState({ mapId }, '', `/${mapId}`);

    await createYjsDoc();
    subscribeToMap(mapId);
    saveToStorage();
    incrementMapCounter();
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
        saveToStorage();
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
    dom.copyExistingBtn.addEventListener('click', () => {
        closeMainMenu();
        copyMap();
    });
    dom.exportBtn.addEventListener('click', () => {
        closeMainMenu();
        exportMap();
    });
    dom.printBtn.addEventListener('click', () => {
        closeMainMenu();
        const originalTitle = document.title;
        document.title = sanitizeFilename(state.name || 'story-map');
        window.print();
        document.title = originalTitle;
    });
    dom.toggleCursorsBtn?.addEventListener('click', () => {
        closeMainMenu();
        toggleCursorsVisibility();
    });
    dom.importBtn.addEventListener('click', () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            alert('This map is read-only. Unlock it first to import.');
            return;
        }
        showImportModal();
    });

    // Import modal events
    dom.importModalClose.addEventListener('click', hideImportModal);
    dom.importModal.addEventListener('click', (e) => {
        if (e.target === dom.importModal) hideImportModal();
    });
    dom.importJsonBtn.addEventListener('click', () => {
        const jsonText = dom.importJsonText.value.trim();
        if (jsonText) {
            importFromJsonText(jsonText);
        }
    });
    dom.importJsonText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const jsonText = dom.importJsonText.value.trim();
            if (jsonText) {
                importFromJsonText(jsonText);
            }
        }
    });
    dom.importDropzone.addEventListener('click', () => {
        dom.importFileInput.click();
    });
    dom.importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            hideImportModal();
            importMap(e.target.files[0]);
            e.target.value = '';
        }
    });
    dom.importDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.importDropzone.classList.add('dragover');
    });
    dom.importDropzone.addEventListener('dragleave', () => {
        dom.importDropzone.classList.remove('dragover');
    });
    dom.importDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.importDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            hideImportModal();
            importMap(file);
        }
    });

    // Export modal events
    dom.exportModalClose.addEventListener('click', hideExportModal);
    dom.exportModal.addEventListener('click', (e) => {
        if (e.target === dom.exportModal) hideExportModal();
    });
    dom.exportMinify.addEventListener('change', updateExportJson);
    dom.exportCopyBtn.addEventListener('click', copyExportJson);
    dom.exportDownloadBtn.addEventListener('click', downloadExportFile);

    // Jira Export Modal
    dom.exportJiraBtn.addEventListener('click', () => {
        closeMainMenu();
        showJiraExportModal();
    });
    dom.jiraExportModalClose.addEventListener('click', confirmCloseJiraExportModal);
    dom.jiraExportModal.addEventListener('click', (e) => {
        if (e.target === dom.jiraExportModal) confirmCloseJiraExportModal();
    });
    dom.jiraExportCancel.addEventListener('click', confirmCloseJiraExportModal);
    dom.jiraExportDownload.addEventListener('click', () => {
        downloadJiraCsv();
    });
    // Update task statuses when mapping inputs change
    [dom.jiraStatusNone, dom.jiraStatusPlanned, dom.jiraStatusInProgress, dom.jiraStatusDone].forEach(input => {
        input.addEventListener('input', populateJiraExportEpics);
    });
    // Status filter checkboxes
    const statusFilters = [
        { el: dom.jiraFilterNone, status: 'none' },
        { el: dom.jiraFilterPlanned, status: 'planned' },
        { el: dom.jiraFilterInProgress, status: 'in-progress' },
        { el: dom.jiraFilterDone, status: 'done' }
    ];
    statusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                jiraExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                jiraExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateJiraExportEpics();
        });
    });

    // Phabricator Export Modal
    dom.exportPhabBtn.addEventListener('click', () => {
        if (dom.exportPhabBtn.disabled) return;
        closeMainMenu();
        showPhabExportModal();
    });
    dom.phabExportModalClose.addEventListener('click', confirmClosePhabModal);
    dom.phabExportModal.addEventListener('click', (e) => {
        if (e.target === dom.phabExportModal) confirmClosePhabModal();
    });
    dom.phabExportCancel.addEventListener('click', confirmClosePhabModal);
    dom.phabExportNext.addEventListener('click', showPhabStage2);
    dom.phabExportBack.addEventListener('click', showPhabStage1);
    dom.phabExportDone.addEventListener('click', hidePhabExportModal);
    dom.phabCopyFunction.addEventListener('click', () => {
        copyPhabCode(dom.phabImportFunction, dom.phabCopyFunction);
    });
    dom.phabCopyCall.addEventListener('click', () => {
        copyPhabCode(dom.phabImportCall, dom.phabCopyCall);
    });
    document.getElementById('phabTokenHelpLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        alert('To get your API token:\n\n1. Click your profile picture in Phabricator\n2. Go to Settings\n3. Click "Conduit API Tokens"\n4. Click "Generate Token"');
    });
    dom.phabInstanceUrl.addEventListener('input', () => {
        // Update the function code when URL changes
        dom.phabImportFunction.textContent = generatePhabImportFunction();
    });
    dom.phabApiToken.addEventListener('input', () => {
        // Update the import call when token changes
        dom.phabImportCall.textContent = generatePhabImportCall();
    });
    dom.phabTags.addEventListener('input', () => {
        // Update the import call when tags change
        dom.phabImportCall.textContent = generatePhabImportCall();
    });
    // Phabricator status filter checkboxes
    const phabStatusFilters = [
        { el: dom.phabFilterNone, status: 'none' },
        { el: dom.phabFilterPlanned, status: 'planned' },
        { el: dom.phabFilterInProgress, status: 'in-progress' },
        { el: dom.phabFilterDone, status: 'done' }
    ];
    phabStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                phabExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                phabExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populatePhabExportEpics();
        });
    });

    // Jira API Export Modal
    dom.exportJiraApiBtn.addEventListener('click', () => {
        if (dom.exportJiraApiBtn.disabled) return;
        closeMainMenu();
        showJiraApiExportModal();
    });
    dom.jiraApiExportModalClose.addEventListener('click', confirmCloseJiraApiModal);
    dom.jiraApiExportModal.addEventListener('click', (e) => {
        if (e.target === dom.jiraApiExportModal) confirmCloseJiraApiModal();
    });
    dom.jiraApiExportCancel.addEventListener('click', confirmCloseJiraApiModal);
    dom.jiraApiExportNext.addEventListener('click', showJiraApiStage2);
    dom.jiraApiExportBack.addEventListener('click', showJiraApiStage1);
    dom.jiraApiExportDone.addEventListener('click', hideJiraApiExportModal);
    dom.jiraApiCopyFunction.addEventListener('click', () => {
        copyPhabCode(dom.jiraApiImportFunction, dom.jiraApiCopyFunction);
    });
    dom.jiraApiCopyCall.addEventListener('click', () => {
        copyPhabCode(dom.jiraApiImportCall, dom.jiraApiCopyCall);
    });
    dom.jiraApiEmail.addEventListener('input', () => {
        dom.jiraApiImportCall.textContent = generateJiraApiImportCall();
    });
    dom.jiraApiToken.addEventListener('input', () => {
        dom.jiraApiImportCall.textContent = generateJiraApiImportCall();
    });
    dom.jiraApiProjectKey.addEventListener('input', () => {
        dom.jiraApiImportCall.textContent = generateJiraApiImportCall();
    });
    // Jira API status filter checkboxes
    const jiraApiStatusFilters = [
        { el: dom.jiraApiFilterNone, status: 'none' },
        { el: dom.jiraApiFilterPlanned, status: 'planned' },
        { el: dom.jiraApiFilterInProgress, status: 'in-progress' },
        { el: dom.jiraApiFilterDone, status: 'done' }
    ];
    jiraApiStatusFilters.forEach(({ el: checkbox, status }) => {
        checkbox.addEventListener('change', (e) => {
            const label = checkbox.closest('label');
            if (e.target.checked) {
                jiraApiExportState.selectedStatuses.add(status);
                label.classList.add('checked');
            } else {
                jiraApiExportState.selectedStatuses.delete(status);
                label.classList.remove('checked');
            }
            populateJiraApiExportEpics();
        });
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
    // Main menu dropdown
    dom.menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.mainMenu.classList.toggle('visible');
        document.body.classList.toggle('main-menu-open', dom.mainMenu.classList.contains('visible'));
        // Disable certain options when on welcome screen (no map loaded)
        const onMap = !dom.welcomeScreen.classList.contains('visible');
        dom.copyExistingBtn.disabled = !onMap;
        dom.exportSubmenuTrigger.disabled = !onMap;
        dom.printBtn.disabled = !onMap;
    });

    // Samples submenu toggle
    dom.samplesSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.samplesSubmenuTrigger.classList.toggle('expanded');
        dom.samplesSubmenu.classList.toggle('visible');
        // Close export submenu when opening samples
        dom.exportSubmenu.classList.remove('visible');
        dom.exportSubmenuTrigger.classList.remove('expanded');
    });

    // Export submenu toggle
    dom.exportSubmenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.exportSubmenuTrigger.classList.toggle('expanded');
        dom.exportSubmenu.classList.toggle('visible');
        // Close samples submenu when opening export
        dom.samplesSubmenu.classList.remove('visible');
        dom.samplesSubmenuTrigger.classList.remove('expanded');
    });

    // Handle clicks on sample items in main menu
    dom.mainMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item?.dataset.sample) {
            if (lockState.isLocked && !lockState.sessionUnlocked) {
                alert('This map is read-only. Unlock it first to load a sample.');
                closeMainMenu();
                return;
            }
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
            hideImportModal();
            hideExportModal();
            hideJiraExportModal();
            hidePhabExportModal();
            if (magnifierEnabled) {
                magnifierEnabled = false;
                dom.magnifierToggle.innerHTML = '&#128269;';
                hideMagnifier();
            }
        }
        // Arrow key panning (only when not in text input)
        if (!isTextInput && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            const PAN_AMOUNT = 100;
            const wrapper = dom.storyMapWrapper;
            switch (e.key) {
                case 'ArrowLeft':
                    wrapper.scrollBy({ left: -PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowRight':
                    wrapper.scrollBy({ left: PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowUp':
                    wrapper.scrollBy({ top: -PAN_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowDown':
                    wrapper.scrollBy({ top: PAN_AMOUNT, behavior: 'smooth' });
                    break;
            }
            e.preventDefault();
        }
    });

    // Pan/drag navigation
    dom.storyMapWrapper.addEventListener('mousedown', startPan);
    document.addEventListener('mousemove', doPan);
    document.addEventListener('mouseup', endPan);

    // Magnifier toggle (desktop only) - initialize lazily when first entering map view
    dom.magnifierToggle.addEventListener('click', toggleMagnifier);

    // Lock feature event listeners
    initLockListeners();
};

// Magnifier initialization (deferred until first map view)
let magnifierInitialized = false;
const initMagnifier = () => {
    if (magnifierInitialized) return;
    magnifierInitialized = true;

    createMagnifier();
    document.addEventListener('mousemove', updateMagnifier);
    dom.storyMapWrapper.addEventListener('mouseleave', hideMagnifier);
};

// =============================================================================
// Initialize
// =============================================================================

// Load a map by ID (used by init and popstate)
const loadMapById = async (mapId) => {
    // Destroy existing Yjs connection
    destroyYjs();

    if (mapId) {
        state.mapId = mapId;
        // Create Yjs doc and subscribe - this will load data from Firestore
        await createYjsDoc();
        await subscribeToMap(mapId);

        // Check if we got any data (ymap will have content if map exists)
        const data = ymap?.toJSON();
        if (data && (data.columns || data.slices)) {
            return true;
        }
    }
    return false;
};

let counterUnsubscribe = null;

const setCounterValue = (count) => {
    if (!dom.welcomeCounter) return;
    dom.welcomeCounter.innerHTML = `📊 <span class="count">${count.toLocaleString()}</span> story maps created`;
    dom.welcomeCounter.classList.add('visible');
};

const subscribeToCounter = async () => {
    if (!dom.welcomeCounter || counterUnsubscribe) return;

    // Show cached value immediately
    const cached = localStorage.getItem('mapCount');
    if (cached) {
        setCounterValue(parseInt(cached));
    }

    try {
        await ensureFirebase();
        await ensureAppCheck();
        const { ref, onValue } = firebaseModules;
        counterUnsubscribe = onValue(ref(rtdb, 'counters/maps'), (snapshot) => {
            const count = snapshot.val() || 0;
            if (count > 0) {
                localStorage.setItem('mapCount', count);
                setCounterValue(count);
            }
        });
    } catch (e) {
        // Silently fail - counter is non-essential
    }
};

const unsubscribeFromCounter = () => {
    if (counterUnsubscribe) {
        counterUnsubscribe();
        counterUnsubscribe = null;
    }
    dom.welcomeCounter?.classList.remove('visible');
};

const incrementMapCounter = async () => {
    try {
        await ensureFirebase();
        await ensureAppCheck();
        const { ref, set, onValue } = firebaseModules;
        const counterRef = ref(rtdb, 'counters/maps');
        // Get current value and increment
        onValue(counterRef, (snapshot) => {
            const current = snapshot.val() || 0;
            set(counterRef, current + 1);
        }, { onlyOnce: true });
    } catch (e) {
        // Silently fail - counter is non-essential
    }
};

const showWelcomeScreen = () => {
    document.body.classList.add('welcome-visible');
    dom.welcomeScreen.classList.add('visible');
    dom.storyMapWrapper.classList.remove('visible');
    dom.boardName.classList.add('hidden');
    dom.zoomControls.classList.add('hidden');
    clearPresence();
    clearCursors();
    clearLockSubscription();
    updateLockUI();
    subscribeToCounter();
};

const hideWelcomeScreen = () => {
    document.body.classList.remove('welcome-visible');
    dom.welcomeScreen.classList.remove('visible');
    dom.storyMapWrapper.classList.add('visible');
    dom.boardName.classList.remove('hidden');
    dom.zoomControls.classList.remove('hidden');
    unsubscribeFromCounter();

    // Initialize magnifier on first map view (deferred from startup)
    initMagnifier();
};

const showLoading = () => {
    dom.loadingIndicator.classList.add('visible');
};

const hideLoading = () => {
    dom.loadingIndicator.classList.remove('visible');
};

const startNewMap = async () => {
    hideWelcomeScreen();
    initState();
    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);
    dom.boardName.value = state.name;
    render();
    requestAnimationFrame(zoomToFit);
    await createYjsDoc();
    subscribeToMap(mapId);
    saveToStorage();
    incrementMapCounter();
};

const startWithSample = async (sampleName) => {
    hideWelcomeScreen();
    initState();
    // Generate map ID and update URL immediately
    const mapId = generateId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);

    // Create Yjs doc first
    await createYjsDoc();

    // Load sample data (local fetch is fast)
    try {
        const response = await fetch(`samples/${sampleName}.json`);
        if (!response.ok) throw new Error();
        deserialize(await response.json());
        dom.boardName.value = state.name;
        render();
        requestAnimationFrame(zoomToFit);
        subscribeToMap(mapId);
        saveToStorage();
    } catch {
        alert('Failed to load sample');
        dom.boardName.value = state.name;
        render();
        requestAnimationFrame(zoomToFit);
        subscribeToMap(mapId);
        saveToStorage();
    }
    incrementMapCounter();
};

const init = async () => {
    // Get map ID from URL path (e.g., /abc123 -> abc123)
    const mapId = window.location.pathname.slice(1) || null;

    initEventListeners();
    updateCursorsVisibilityUI();

    if (mapId) {
        // Show loading indicator while fetching from Firestore
        showLoading();
        const loaded = await loadMapById(mapId);
        hideLoading();
        if (loaded) {
            hideWelcomeScreen();
            dom.boardName.value = state.name;
            render();
            // Auto-fit to viewport after DOM settles
            requestAnimationFrame(zoomToFit);
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
