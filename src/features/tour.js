// Storymaps.io - AGPL-3.0 - see LICENCE for details
// Guided tour module - spotlight + tooltip walkthrough

let _zoomToFit = null;
let _addSlice = null;
let _deleteSlice = null;
let _getState = null;
let _renderAndSave = null;
let _createStory = null;
let _demoSliceId = null;
let _ctxMenuCleanup = null;
let _mvpSnapshot = null;

// The tour runs on the coffee app the docs and courses use (public/samples/tour.json):
// Browse Menu, Customise Drink, Add To Cart, Pay, Confirm and Collect Order, with an MVP slice.
// Partway through it adds a Later slice, then takes it away again.
const ensureDemoSlice = () => {
    if (_demoSliceId || !_addSlice || !_getState || !_createStory) return;
    const slice = _addSlice(1, { name: 'Later', openDetails: false });
    if (!slice) return;
    _demoSliceId = slice.id;
    const cols = _getState().columns;
    const demoCards = {
        0: [_createStory('Recommend popular combos', '#fef08a')],
        1: [_createStory('Save custom drinks', '#fef08a')],
        2: [_createStory('Group ordering', '#fef08a')],
        3: [_createStory('Gift cards', '#fef08a'), _createStory('Split payment', '#fef08a')],
    };
    for (const [i, cards] of Object.entries(demoCards)) {
        const col = cols[Number(i)];
        if (col) slice.stories[col.id] = cards;
    }
    _renderAndSave();
    // addSlice uses rAF internally to scroll to the new slice.
    // Double-rAF to run after that completes and reposition the
    // spotlight/tooltip to account for the scroll.
    requestAnimationFrame(() => requestAnimationFrame(positionCurrentStep));
};

const removeDemoSlice = () => {
    if (!_demoSliceId || !_deleteSlice || !_getState) return;
    const state = _getState();
    if (state.slices.length > 1) {
        _deleteSlice(_demoSliceId);
    }
    _demoSliceId = null;
};

const STEPS = [
    {
        target: null,
        title: 'What is a story map?',
        body: 'This short tour shows how a user story map works, using the example of a coffee ordering app.<br><br>A story map lays out the journey people take through a product, from left to right, with the work that makes each step possible underneath. Then it cuts that work into releases, so the first one works from start to finish.<br><br>The whole team can see what the product does, who it’s for, and what comes next, in one place.',
        icon: '\u{1F4A1}',
    },
    {
        target: ['#boardName', '.users-row', '.activities-row', '.steps-row', '.slice-container'],
        clipRight: '.step:not(.phantom-step)',
        tooltipTarget: '.panel-tabs',
        title: 'Our example: a coffee app',
        body: 'This is the story map for an app that lets people order coffee ahead and pick it up. Take a moment to look it over. We’ll go through each part next.',
        icon: '☕',
    },
    {
        target: '.users-row',
        title: 'Users',
        body: 'The top row says <strong>who</strong> the product is for. Here it’s the <strong>Customer</strong>.',
        icon: '\u{1F464}',
    },
    {
        target: '.activities-row',
        title: 'Activities',
        body: 'Activities say <strong>what</strong> each user is trying to do. The customer wants to <strong>Order Coffee</strong>.',
        icon: '\u{1F3AF}',
    },
    {
        target: '.steps-row > :nth-child(2)',
        title: 'Steps',
        body: 'Steps are the journey, from left to right, in the order the customer takes them. First they <strong>Browse Menu</strong>…',
        icon: '\u{1F9ED}',
    },
    {
        target: '.steps-row',
        clipRight: '.step:not(.phantom-step)',
        title: 'Steps',
        body: '…then customise the drink, add it to the cart, pay, confirm and collect the order. Read together, the steps tell the story of the product. They’re the <strong>backbone</strong> of the story map.',
        icon: '\u{1F9ED}',
    },
    {
        target: '.slice-container .story-column:nth-child(1) .story-card:first-child',
        title: 'Tasks',
        body: 'Under each step are the tasks that make it possible. To browse the menu, the app needs <strong>Drinks by category</strong>.',
        icon: '\u{1F4CB}',
    },
    {
        target: '.slice-container .story-column:nth-child(1) .story-card:nth-child(2)',
        title: 'Tasks',
        body: 'The most important tasks go at the top, so <strong>Search by name</strong> sits below. Reading across the top of every column gives you the simplest version of the whole journey.',
        icon: '\u{1F4CB}',
    },
    {
        target: '.slice-label-container',
        title: 'Release slices',
        body: 'Slices group tasks into releases. This one is the <strong>MVP</strong>, the first release: order and pay ahead, then pick up.',
        icon: '\u{1F4E6}',
    },
    {
        target: '.slice-container',
        title: 'A first release',
        body: 'The MVP runs across every step, so once it’s built, a customer can order a coffee from start to finish.<br><br><strong>Try it:</strong> drag a few cards around. They’ll go back when you move on.',
        icon: '\u{2705}',
        onEnter: () => {
            document.body.classList.add('tour-v1-done');
            const state = _getState?.();
            if (state?.slices?.[0]) {
                _mvpSnapshot = JSON.parse(JSON.stringify(state.slices[0].stories));
            }
            const block = e => { if (e.button === 2) e.stopPropagation(); };
            document.addEventListener('mouseup', block, true);
            _ctxMenuCleanup = () => { document.removeEventListener('mouseup', block, true); _ctxMenuCleanup = null; };
        },
        onLeave: () => {
            document.body.classList.remove('tour-v1-done');
            _ctxMenuCleanup?.();
            const state = _getState?.();
            if (_mvpSnapshot && state?.slices?.[0]) {
                state.slices[0].stories = _mvpSnapshot;
                _mvpSnapshot = null;
                _renderAndSave?.();
            }
        },
    },
    {
        target: '.slice-label-container .btn-add-slice',
        title: 'Add a slice',
        body: 'Everything that can wait goes in a later release. Let’s add a slice for it.',
        icon: '\u{2795}',
        onEnter: () => ensureDemoSlice(),
    },
    {
        target: '.slice-container + .slice-container',
        clipRight: '.step:not(.phantom-step)',
        title: 'The next release',
        body: 'Here’s <strong>Later</strong>, with gift cards, group orders and the rest. Same steps across the top, new tasks underneath. The story map keeps every release in view, so it’s clear what’s built and what’s next.',
        icon: '\u{1F4E6}',
        onEnter: () => ensureDemoSlice(),
        onLeave: () => removeDemoSlice(),
    },
    {
        target: null,
        title: 'You’re a story mapper',
        body: 'That’s the idea: <strong>users</strong>, <strong>activities</strong>, <strong>steps</strong>, <strong>tasks</strong> and <strong>releases</strong>.<br><br>This coffee app story map is yours now, at its own link. Change it, share the link to work on it together, or use it to start a story map of your own work. To start from a backlog you already have, use <strong>Import</strong> in the menu.',
        icon: '\u{1F389}',
    },
];

let _active = false;
let _step = 0;
let _wasDarkOnStart = false;
const $ = (id) => document.getElementById(id);

const backdrop = () => $('tourBackdrop');
const spotlight = () => $('tourSpotlight');
const tooltip = () => $('tourTooltip');

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

const MARGIN = 12;
const TOOLTIP_GAP = 14;

const PAD = 6;
const RADIUS = 8;

const positionSpotlight = (rects) => {
    const bd = backdrop();
    const sl = spotlight();

    // Remove extra spotlights from previous step
    document.querySelectorAll('.tour-spotlight-extra').forEach(el => el.remove());

    if (!rects || rects.length === 0) {
        sl.style.display = 'none';
        bd.style.clipPath = 'none';
        bd.classList.add('tour-backdrop-dim');
        return;
    }

    bd.classList.remove('tour-backdrop-dim');

    // Build clip-path on backdrop - full screen with rounded-rect holes
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let d = `M0,0H${vw}V${vh}H0Z`;
    for (const rect of rects) {
        const x = rect.left - PAD;
        const y = rect.top - PAD;
        const w = rect.width + PAD * 2;
        const h = rect.height + PAD * 2;
        const r = RADIUS;
        d += ` M${x+r},${y}H${x+w-r}A${r},${r},0,0,1,${x+w},${y+r}V${y+h-r}A${r},${r},0,0,1,${x+w-r},${y+h}H${x+r}A${r},${r},0,0,1,${x},${y+h-r}V${y+r}A${r},${r},0,0,1,${x+r},${y}Z`;
    }
    bd.style.clipPath = `path(evenodd,"${d}")`;

    // Position glow spotlight(s)
    rects.forEach((rect, i) => {
        const el = i === 0 ? sl : createExtraSpotlight();
        el.style.display = '';
        el.style.top = `${rect.top - PAD}px`;
        el.style.left = `${rect.left - PAD}px`;
        el.style.width = `${rect.width + PAD * 2}px`;
        el.style.height = `${rect.height + PAD * 2}px`;
        el.style.borderRadius = `${RADIUS}px`;
    });
};

const createExtraSpotlight = () => {
    const el = document.createElement('div');
    el.className = 'tour-spotlight tour-spotlight-extra visible';
    spotlight().after(el);
    return el;
};

const positionTooltip = (rect) => {
    const tt = tooltip();
    // Reset for measurement
    tt.style.top = '0';
    tt.style.left = '0';
    tt.removeAttribute('data-arrow');

    const ttRect = tt.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
        // Centered
        tt.style.top = `${Math.max(MARGIN, (vh - ttRect.height) / 2)}px`;
        tt.style.left = `${Math.max(MARGIN, (vw - ttRect.width) / 2)}px`;
        return;
    }

    const pad = 6;
    const spotTop = rect.top - pad;
    const spotLeft = rect.left - pad;
    const spotW = rect.width + pad * 2;
    const spotH = rect.height + pad * 2;
    const spotCenterX = spotLeft + spotW / 2;
    const spotBottom = spotTop + spotH;

    // Try below
    if (spotBottom + TOOLTIP_GAP + ttRect.height + MARGIN < vh) {
        tt.style.top = `${spotBottom + TOOLTIP_GAP}px`;
        tt.style.left = `${clampX(spotCenterX - ttRect.width / 2, ttRect.width, vw)}px`;
        tt.setAttribute('data-arrow', 'top');
        return;
    }
    // Try above
    if (spotTop - TOOLTIP_GAP - ttRect.height - MARGIN > 0) {
        tt.style.top = `${spotTop - TOOLTIP_GAP - ttRect.height}px`;
        tt.style.left = `${clampX(spotCenterX - ttRect.width / 2, ttRect.width, vw)}px`;
        tt.setAttribute('data-arrow', 'bottom');
        return;
    }
    // Try right
    const spotRight = spotLeft + spotW;
    if (spotRight + TOOLTIP_GAP + ttRect.width + MARGIN < vw) {
        tt.style.left = `${spotRight + TOOLTIP_GAP}px`;
        tt.style.top = `${clampY(spotTop + spotH / 2 - ttRect.height / 2, ttRect.height, vh)}px`;
        tt.setAttribute('data-arrow', 'left');
        return;
    }
    // Fall back to left
    tt.style.left = `${Math.max(MARGIN, spotLeft - TOOLTIP_GAP - ttRect.width)}px`;
    tt.style.top = `${clampY(spotTop + spotH / 2 - ttRect.height / 2, ttRect.height, vh)}px`;
    tt.setAttribute('data-arrow', 'right');
};

const clampX = (x, w, vw) => Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
const clampY = (y, h, vh) => Math.max(MARGIN, Math.min(y, vh - h - MARGIN));

// ---------------------------------------------------------------------------
// Progress dots
// ---------------------------------------------------------------------------

const buildProgressDots = () => {
    const container = $('tourProgress');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < STEPS.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'tour-progress-dot';
        container.appendChild(dot);
    }
};

const updateProgressDots = () => {
    const dots = $('tourProgress')?.querySelectorAll('.tour-progress-dot');
    if (!dots) return;
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === _step);
        dot.classList.toggle('visited', i < _step);
    });
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const positionCurrentStep = () => {
    const step = STEPS[_step];

    // Scroll target into view if needed
    let rects = resolveTargetRects(step.target);

    // Clip rects to the right edge of the last matching element
    if (rects && step.clipRight) {
        const clipEls = document.querySelectorAll(step.clipRight);
        const lastEl = clipEls.length ? clipEls[clipEls.length - 1] : null;
        if (lastEl) {
            const maxRight = lastEl.getBoundingClientRect().right;
            rects = rects.map(r => {
                const clippedWidth = maxRight - r.left;
                return clippedWidth < r.width
                    ? { top: r.top, left: r.left, width: clippedWidth, height: r.height }
                    : r;
            });
        }
    }

    if (step.noDim) {
        // Hide backdrop and spotlight but keep tooltip positioned at target
        backdrop().style.clipPath = 'none';
        backdrop().classList.remove('tour-backdrop-dim');
        backdrop().style.opacity = '0';
        spotlight().style.display = 'none';
        document.querySelectorAll('.tour-spotlight-extra').forEach(el => el.remove());
    } else {
        backdrop().style.opacity = '';
        positionSpotlight(rects);
    }

    // Tooltip can anchor to a different element via tooltipTarget
    const tooltipAnchor = step.tooltipTarget
        ? document.querySelector(step.tooltipTarget)?.getBoundingClientRect()
        : (rects ? unionRect(rects) : null);
    positionTooltip(tooltipAnchor);
};

const renderStep = () => {
    const step = STEPS[_step];
    const tt = tooltip();

    // Content transition - brief fade
    const content = tt.querySelector('.tour-tooltip-content');
    content.classList.remove('tour-step-enter');
    // Force reflow to restart animation
    void content.offsetWidth;
    content.classList.add('tour-step-enter');

    tt.querySelector('.tour-tooltip-icon').textContent = step.icon;
    tt.querySelector('.tour-tooltip-title').textContent = step.title;
    tt.querySelector('.tour-tooltip-body').innerHTML = step.body;

    const backBtn = tt.querySelector('.tour-btn-back');
    backBtn.style.display = _step === 0 ? 'none' : '';

    const nextBtn = tt.querySelector('.tour-btn-next');
    const arrow = nextBtn.querySelector('.tour-btn-next-arrow');
    if (_step === STEPS.length - 1) {
        nextBtn.firstChild.textContent = 'Finish ';
        if (arrow) arrow.style.display = 'none';
    } else {
        nextBtn.firstChild.textContent = 'Next ';
        if (arrow) arrow.style.display = '';
    }

    updateProgressDots();

    // Run onEnter hook before positioning (it may change the DOM)
    step.onEnter?.();

    positionCurrentStep();

};

const resolveTargetRects = (target) => {
    if (!target) return null;
    const selectors = Array.isArray(target) ? target : [target];
    const elements = selectors.map(s => document.querySelector(s)).filter(Boolean);
    if (elements.length === 0) return null;

    // Scroll the first element into view
    const wrapper = document.getElementById('storyMapWrapper');
    if (wrapper && wrapper.contains(elements[0])) {
        elements[0].scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    }

    return elements.map(el => el.getBoundingClientRect());
};

const unionRect = (rects) => {
    const top = Math.min(...rects.map(r => r.top));
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { top, left, width: right - left, height: bottom - top };
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const next = () => {
    if (_step < STEPS.length - 1) {
        STEPS[_step].onLeave?.();
        _step++;
        // Immediately clear stale highlight, as Safari may not repaint in the rAF
        spotlight().style.display = 'none';
        document.querySelectorAll('.tour-spotlight-extra').forEach(el => el.remove());
        backdrop().style.clipPath = 'none';
        requestAnimationFrame(() => renderStep());
    } else {
        endTour();
    }
};

const back = () => {
    if (_step > 0) {
        STEPS[_step].onLeave?.();
        _step--;
        // Immediately clear stale highlight, as Safari may not repaint in the rAF
        spotlight().style.display = 'none';
        document.querySelectorAll('.tour-spotlight-extra').forEach(el => el.remove());
        backdrop().style.clipPath = 'none';
        requestAnimationFrame(() => renderStep());
    }
};

const onKeyDown = (e) => {
    if (!_active) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        next();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        back();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endTour();
    }
};

// CSS blocks pointer clicks on slice gutter controls; this also blocks keyboard activation
const onSliceControlClick = (e) => {
    if (!_active) return;
    if (e.target.closest?.('.btn-add-slice, .btn-slice-menu')) {
        e.preventDefault();
        e.stopPropagation();
    }
};

const onWheel = (e) => {
    if (!_active) return;
    e.preventDefault();
};

const onResize = () => {
    if (!_active) return;
    renderStep();
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const isActive = () => _active;
export const isTourCompleted = () => localStorage.getItem('tourCompleted') === 'true';

export const startTour = () => {
    _active = true;
    _step = 0;
    _wasDarkOnStart = document.documentElement.classList.contains('dark-mode');
    if (_wasDarkOnStart) {
        document.getElementById('toggleDarkModeBtn')?.click();
    }
    document.body.classList.add('tour-active');
    backdrop().classList.add('visible');
    spotlight().classList.add('visible');
    tooltip().classList.add('visible');

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onSliceControlClick, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    buildProgressDots();
    renderStep();
};

export const endTour = () => {
    STEPS[_step].onLeave?.();
    _active = false;
    localStorage.setItem('tourCompleted', 'true');
    document.body.classList.remove('tour-active');
    backdrop().classList.remove('visible', 'tour-backdrop-dim');
    backdrop().style.clipPath = '';
    backdrop().style.opacity = '';
    spotlight().classList.remove('visible');
    tooltip().classList.remove('visible');
    document.querySelectorAll('.tour-spotlight-extra').forEach(el => el.remove());

    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onSliceControlClick, true);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);

    if (_wasDarkOnStart) {
        _wasDarkOnStart = false;
        document.getElementById('toggleDarkModeBtn')?.click();
    }

    // The steps scroll the story map to each part in turn. Fit it to the window again, which
    // scrolls back to where it opened, so the tour ends on the whole story map.
    _zoomToFit?.();
};

export const init = (config = {}) => {
    _addSlice = config.addSlice || null;
    _deleteSlice = config.deleteSlice || null;
    _getState = config.getState || null;
    _renderAndSave = config.renderAndSave || null;
    _createStory = config.createStory || null;
    _zoomToFit = config.zoomToFit || null;

    // Wire tooltip buttons
    const tt = tooltip();
    if (!tt) return;

    tt.querySelector('.tour-btn-next').addEventListener('click', next);
    tt.querySelector('.tour-btn-back').addEventListener('click', back);
    tt.querySelector('.tour-btn-skip').addEventListener('click', endTour);
    // Backdrop click is intentionally a no-op - only Skip/Finish exits the tour
};
