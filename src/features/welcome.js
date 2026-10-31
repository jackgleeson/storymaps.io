// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Welcome screen, counter, tutorial toast, new/copy/sample map creation

import { dom } from '/src/ui/dom.js';
import { state, initState, hasContent, pushUndo, confirmOverwrite } from '/src/core/state.js';
import { deserialize } from '/src/core/serialization.js';
import { shiftSliceDates } from '/src/core/constants.js';
import { closeMainMenu, zoomToFit } from '/src/ui/navigation.js';
import { clearPresence, clearCursors } from '/src/ui/presence.js';
import { clearLockSubscription, updateLockUI } from '/src/core/lock.js';
import { destroyYjs } from '/src/core/yjs.js';
import { showAlert, showConfirm } from '/src/core/modals.js';
import * as tour from '/src/features/tour.js';
import { closeSearch } from '/src/features/search.js';
import * as projects from '/src/features/projects.js';
import * as recentMaps from '/src/features/recent-maps.js';
import * as bookmarkNudge from '/src/features/bookmark-nudge.js';
import { MAX_PROJECT_MAPS } from '/src/core/project-links.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

// Counter state
let counterLoaded = false;
let legendAutoOpened = false;
let activeMappersInterval = null;

const setCounterValue = (count) => {
    if (!dom.welcomeCounter) return;
    dom.welcomeCounter.innerHTML = `\u{1f4ca} <span class="count">${count.toLocaleString()}</span> story maps created`;
    dom.welcomeCounter.classList.add('visible');
};

const updateActiveMappers = async () => {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (!counterLoaded) {
            const count = data.mapCount || 0;
            if (count > 0) {
                localStorage.setItem('mapCount', count);
                setCounterValue(count);
            }
            counterLoaded = true;
        }
        if (dom.activeMappers && document.body.classList.contains('welcome-visible')) {
            if (data.activeUsers > 0) {
                dom.activeMappers.textContent = `${data.activeUsers} ${data.activeUsers === 1 ? 'user' : 'users'} mapping now`;
                dom.activeMappers.classList.add('visible');
            } else {
                dom.activeMappers.classList.remove('visible');
            }
        }
    } catch {
        // Silently fail - counter is non-essential
    }
};

const subscribeToCounter = async () => {
    if (!dom.welcomeCounter || counterLoaded) return;

    const cached = localStorage.getItem('mapCount');
    if (cached) {
        setCounterValue(parseInt(cached));
    }

    await updateActiveMappers();
    activeMappersInterval = setInterval(updateActiveMappers, 5_000);
};

const unsubscribeFromCounter = () => {
    counterLoaded = false;
    dom.welcomeCounter?.classList.remove('visible');
    dom.activeMappers?.classList.remove('visible');
    if (activeMappersInterval) {
        clearInterval(activeMappersInterval);
        activeMappersInterval = null;
    }
};

const incrementMapCounter = async () => {
    try {
        const res = await fetch('/api/stats', { method: 'POST' });
        const data = await res.json();
        localStorage.setItem('mapCount', data.mapCount);
    } catch {
        // Silently fail - counter is non-essential
    }
};

export const showWelcomeScreen = () => {
    state.mapLoaded = false;
    document.body.classList.add('welcome-visible');
    dom.welcomeScreen.classList.add('visible');
    bookmarkNudge.stop();
    recentMaps.updateHomeLine();
    dom.storyMapWrapper.classList.remove('visible');
    dom.boardName.classList.add('hidden');
    dom.zoomControls.classList.add('hidden');
    dom.controlsRight?.classList.add('hidden');
    dom.controlsRight?.classList.remove('panel-open');
    dom.panelBody?.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    closeSearch();
    clearPresence();
    clearCursors();
    clearLockSubscription();
    updateLockUI();
    subscribeToCounter();
};

export const hideWelcomeScreen = () => {
    state.mapLoaded = true;
    document.body.classList.remove('welcome-visible');
    // The home page scrolls, the map page doesn't: start the map at the top
    window.scrollTo(0, 0);
    dom.welcomeScreen.classList.remove('visible');
    dom.storyMapWrapper.classList.add('visible');
    dom.boardName.classList.remove('hidden');
    dom.zoomControls.classList.remove('hidden');
    dom.controlsRight?.classList.remove('hidden');
    dom.searchBtn.style.display = '';
    dom.undoBtn.style.display = '';
    dom.redoBtn.style.display = '';
    dom.buildAiBtn.style.display = '';
    unsubscribeFromCounter();
    if (!legendAutoOpened && window.matchMedia('(pointer: fine)').matches) {
        _deps.switchPanelTab('legend');
        legendAutoOpened = true;
    }
};

export const showLoading = () => {
    dom.loadingIndicator.classList.add('visible');
};

export const hideLoading = () => {
    dom.loadingIndicator.classList.remove('visible');
};

export const showTutorialToast = () => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
    const shortcutEl = dom.tutorialToast.querySelector('.reset-shortcut-key');
    if (isMac && shortcutEl) shortcutEl.textContent = 'Shift + 0';
    dom.tutorialToast.classList.add('visible');
    const dismiss = () => {
        dom.tutorialToast.classList.remove('visible');
        clearTimeout(timer);
    };
    const timer = setTimeout(dismiss, 5000);
    dom.tutorialToastClose.addEventListener('click', dismiss, { once: true });
};

export const startNewMap = async () => {
    hideWelcomeScreen();
    showLoading();
    initState();
    const mapId = await _deps.newMapId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);
    dom.boardName.value = state.name;
    _deps.render();
    await _deps.createYjsDoc(mapId);
    _deps.subscribeToMap(mapId);
    hideLoading();
    requestAnimationFrame(zoomToFit);
    setTimeout(showTutorialToast, 800);
    _deps.saveToStorage();
    incrementMapCounter();
};

// Fetch a sample map, with its slice dates moved so the first is two weeks from today
const fetchSample = async (name) => {
    const response = await fetch(`/samples/${name}.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error();
    const start = new Date();
    start.setDate(start.getDate() + 14);
    const pad = (n) => String(n).padStart(2, '0');
    return shiftSliceDates(await response.json(), `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
};

export const startWithSample = async (sampleName, { showToast = true } = {}) => {
    hideWelcomeScreen();
    showLoading();
    destroyYjs();
    initState();
    const mapId = await _deps.newMapId();
    state.mapId = mapId;
    history.replaceState({ mapId }, '', `/${mapId}`);

    try {
        deserialize(await fetchSample(sampleName));
    } catch {
        await showAlert('Failed to load sample');
    }
    dom.boardName.value = state.name;
    _deps.render();
    await _deps.createYjsDoc(mapId);
    _deps.subscribeToMap(mapId);
    hideLoading();
    requestAnimationFrame(zoomToFit);
    if (showToast) setTimeout(showTutorialToast, 800);
    _deps.saveToStorage();
    incrementMapCounter();
};

export const newMap = async () => {
    _deps.saveToStorage();
    if (hasContent() && !await showConfirm('Create a new story map?\n\nYou can return to this map using the back button.')) {
        return;
    }
    destroyYjs();

    state.mapId = null;

    hideWelcomeScreen();

    initState();
    dom.boardName.value = '';
    _deps.render();
    requestAnimationFrame(zoomToFit);

    const mapId = await _deps.newMapId();
    state.mapId = mapId;
    history.pushState({ mapId }, '', `/${mapId}`);

    await _deps.createYjsDoc(mapId);
    _deps.subscribeToMap(mapId);
    _deps.saveToStorage();
    incrementMapCounter();
};

// A copy of a map shown in a project goes in the project too, next to the original
export const copyMap = async () => {
    _deps.saveToStorage();
    const project = projects.current();
    const original = state.mapId;
    const joins = project && project.mapCount < MAX_PROJECT_MAPS;
    let message = 'Copy this map?\n\nA copy will be created with a new URL.';
    if (joins) message = `Copy this map?\n\nA copy will be created with a new URL, and added to ${project.name} next to this map.`;
    else if (project) message += ` ${project.name} already has ${MAX_PROJECT_MAPS} maps, the most a project can hold, so the copy won't be in it.`;
    if (!await showConfirm(message)) {
        return;
    }
    destroyYjs();

    const currentName = dom.boardName.value || 'Untitled';
    state.name = `${currentName} (Copy)`;
    dom.boardName.value = state.name;

    const mapId = await _deps.newMapId();
    state.mapId = mapId;
    history.pushState({ mapId }, '', `/${mapId}`);

    await _deps.createYjsDoc(mapId);
    _deps.subscribeToMap(mapId);
    if (joins) await projects.joinNew(project.id, original);
    _deps.saveToStorage();
    incrementMapCounter();
};

export const loadSample = async (name) => {
    if (!state.mapId) {
        return startWithSample(name);
    }

    _deps.saveToStorage();
    if (!await confirmOverwrite()) return;

    showLoading();
    try {
        const data = await fetchSample(name);
        pushUndo();
        deserialize(data);
        dom.boardName.value = state.name;
        _deps.renderAndSave();
    } catch {
        await showAlert('Failed to load sample');
    }
    hideLoading();
};

export const initListeners = () => {
    dom.welcomeNewBtn.addEventListener('click', startNewMap);

    const launchTour = async () => {
        closeMainMenu();
        if (state.mapId && hasContent() && !await showConfirm('Load the tour sample?\n\nYou can return to this map using the back button.')) {
            return;
        }
        await startWithSample('story-mapping-101', { showToast: false });
        // Close legend panel so tour starts clean
        dom.controlsRight?.classList.remove('panel-open');
        dom.panelBody?.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tour.startTour();
    };
    dom.welcomeTourBtn.addEventListener('click', launchTour);
    dom.tourMenuBtn.addEventListener('click', launchTour);

    document.querySelector('.welcome-samples-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-sample');
        if (btn?.dataset.sample) {
            e.stopPropagation();
            startWithSample(btn.dataset.sample);
        }
    });

    initCursors();
};

// Simulated collaboration cursors on hero screenshot
function initCursors() {
    const container = document.querySelector('.welcome-visual');
    if (!container) return;

    function mulberry32(a) {
        return function() {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    const rngs = [mulberry32(12345), mulberry32(67890), mulberry32(24680)];

    const waypoints = [
        // Jessica - top half, backbone and upper cards
        [
            { x: 12, y: 14, pause: 500 },
            { x: 28, y: 18, pause: 1600 },
            { x: 48, y: 15, pause: 300 },
            { x: 72, y: 18, pause: 1800 },
            { x: 85, y: 22, pause: 400 },
            { x: 78, y: 38, pause: 2200 },
            { x: 55, y: 42, pause: 350 },
            { x: 35, y: 36, pause: 1400 },
            { x: 18, y: 32, pause: 800 },
            { x: 10, y: 20, pause: 600 },
            { x: 42, y: 25, pause: 1900 },
            { x: 65, y: 30, pause: 250 },
        ],
        // Alex - left-to-center, card rows
        [
            { x: 8, y: 45, pause: 1000 },
            { x: 15, y: 55, pause: 2200 },
            { x: 30, y: 50, pause: 400 },
            { x: 48, y: 58, pause: 1600 },
            { x: 62, y: 52, pause: 300 },
            { x: 45, y: 68, pause: 2000 },
            { x: 25, y: 72, pause: 500 },
            { x: 12, y: 65, pause: 1800 },
            { x: 35, y: 60, pause: 150 },
            { x: 55, y: 45, pause: 1200 },
            { x: 40, y: 40, pause: 700 },
            { x: 20, y: 48, pause: 900 },
        ],
        // Priya - right half and bottom
        [
            { x: 88, y: 30, pause: 700 },
            { x: 75, y: 42, pause: 1500 },
            { x: 60, y: 50, pause: 400 },
            { x: 50, y: 65, pause: 2400 },
            { x: 70, y: 72, pause: 300 },
            { x: 85, y: 68, pause: 1800 },
            { x: 90, y: 50, pause: 500 },
            { x: 78, y: 35, pause: 1200 },
            { x: 65, y: 28, pause: 2000 },
            { x: 55, y: 38, pause: 350 },
            { x: 72, y: 55, pause: 1600 },
            { x: 82, y: 45, pause: 250 },
        ]
    ];

    const cursorEls = [
        document.getElementById('cursor-jessica'),
        document.getElementById('cursor-alex'),
        document.getElementById('cursor-priya')
    ];

    const states = cursorEls.map((el, i) => {
        const wp = waypoints[i];
        const startIdx = Math.floor(rngs[i]() * wp.length);
        return {
            el, waypoints: wp, rng: rngs[i],
            x: wp[startIdx].x, y: wp[startIdx].y,
            targetIdx: startIdx, phase: 'pause', phaseStart: 0,
            phaseDuration: 800 + rngs[i]() * 1200,
            fromX: wp[startIdx].x, fromY: wp[startIdx].y,
            toX: wp[startIdx].x, toY: wp[startIdx].y,
            cpX: 0, cpY: 0, jitterSeed: rngs[i]() * 1000,
        };
    });

    let started = false, globalStart = 0, rafId = 0;

    function calcControlPoint(fx, fy, tx, ty, rng) {
        const mx = (fx + tx) / 2, my = (fy + ty) / 2;
        const dx = tx - fx, dy = ty - fy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const offset = (rng() - 0.5) * dist * 0.5;
        const nx = -dy / (dist || 1), ny = dx / (dist || 1);
        return { x: mx + nx * offset, y: my + ny * offset };
    }

    function bezier(a, cp, b, t) {
        const mt = 1 - t;
        return mt * mt * a + 2 * mt * t * cp + t * t * b;
    }

    function humanEase(t) {
        if (t < 0.15) return t * t * 22.22;
        const nt = (t - 0.15) / 0.85;
        return 0.5 + 0.5 * (1 - Math.pow(1 - nt, 3));
    }

    function noise(seed, t, scale) {
        const v = Math.sin(seed + t * 0.7) * 0.5
              + Math.sin(seed * 1.7 + t * 1.3) * 0.3
              + Math.sin(seed * 0.3 + t * 2.1) * 0.2;
        return v * scale;
    }

    function pickNextTarget(s) {
        const total = s.waypoints.length;
        const advance = s.rng() < 0.7 ? 1 : (s.rng() < 0.5 ? 2 : -1);
        return (s.targetIdx + advance + total) % total;
    }

    function moveDuration(fx, fy, tx, ty, rng) {
        const dist = Math.sqrt((tx - fx) * (tx - fx) + (ty - fy) * (ty - fy));
        return (350 + dist * 18) * (0.7 + rng() * 0.6);
    }

    function tick(now) {
        if (!globalStart) globalStart = now;
        const t = now - globalStart;

        states.forEach(s => {
            const elapsed = now - s.phaseStart;
            const progress = Math.max(0, Math.min(elapsed / s.phaseDuration, 1));

            if (s.phase === 'pause') {
                const driftX = noise(s.jitterSeed, t * 0.001, 0.3);
                const driftY = noise(s.jitterSeed + 50, t * 0.001, 0.25);
                s.x = s.fromX + driftX;
                s.y = s.fromY + driftY;

                if (progress >= 1) {
                    const nextIdx = pickNextTarget(s);
                    const wp = s.waypoints[nextIdx];
                    s.targetIdx = nextIdx;
                    s.fromX = s.x; s.fromY = s.y;
                    s.toX = wp.x + (s.rng() - 0.5) * 3;
                    s.toY = wp.y + (s.rng() - 0.5) * 2;
                    const cp = calcControlPoint(s.fromX, s.fromY, s.toX, s.toY, s.rng);
                    s.cpX = cp.x; s.cpY = cp.y;
                    s.phase = 'moving';
                    s.phaseStart = now;
                    s.phaseDuration = moveDuration(s.fromX, s.fromY, s.toX, s.toY, s.rng);
                }
            } else if (s.phase === 'moving') {
                const eased = humanEase(progress);
                s.x = bezier(s.fromX, s.cpX, s.toX, eased);
                s.y = bezier(s.fromY, s.cpY, s.toY, eased);
                const jitterScale = (1 - progress) * 0.4;
                s.x += noise(s.jitterSeed + 100, t * 0.003, jitterScale);
                s.y += noise(s.jitterSeed + 200, t * 0.003, jitterScale);

                if (progress >= 1) {
                    s.fromX = s.toX; s.fromY = s.toY;
                    s.x = s.toX; s.y = s.toY;
                    s.phase = 'pause';
                    s.phaseStart = now;
                    s.phaseDuration = s.waypoints[s.targetIdx].pause * (0.6 + s.rng() * 0.8);
                }
            }

            s.el.style.left = s.x + '%';
            s.el.style.top = s.y + '%';
        });

        rafId = requestAnimationFrame(tick);
    }

    const obs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !started) {
            started = true;
            const now = performance.now();
            states.forEach((s, i) => { s.phaseStart = now + i * 600; });
            setTimeout(() => container.classList.add('cursors-visible'), 300);
            rafId = requestAnimationFrame(tick);
        } else if (!entries[0].isIntersecting && started) {
            cancelAnimationFrame(rafId);
            started = false;
            globalStart = 0;
            container.classList.remove('cursors-visible');
        }
    }, { threshold: 0.3 });
    obs.observe(container);
}
