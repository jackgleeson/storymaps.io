// Storymaps.io - AGPL-3.0 - see LICENCE for details
// Guided tour module - spotlight + tooltip walkthrough

let _addSlice = null;
let _deleteSlice = null;
let _getState = null;
let _renderAndSave = null;
let _createStory = null;
let _zoomToFit = null;
let _demoSliceId = null;
let _demoLegendCards = null;
let _ctxMenuCleanup = null;
let _v1Snapshot = null;

const ensureDemoSlice = () => {
    if (_demoSliceId || !_addSlice || !_getState || !_createStory) return;
    const slice = _addSlice(1);
    if (!slice) return;
    _demoSliceId = slice.id;
    const state = _getState();
    const cols = state.columns;
    // Populate V2 slice with demo task cards under relevant steps.
    // cols[0] = "Look at picture on box", cols[2] = "Layout lego pieces",
    // cols[3] = "Read instructions", cols[4] = "Build walls",
    // cols[5] = "Add doors and windows", cols[6] = "Add roof"
    const demoCards = {
        0: [_createStory('Update box art to show two-story house', '#fef08a')],
        2: [_createStory('Add extra pieces for second floor', '#fef08a')],
        3: [_createStory('Update instructions for second floor', '#fef08a')],
        4: [_createStory('Build second-floor walls', '#fef08a'),
            _createStory('Add staircase between floors', '#fef08a')],
        5: [_createStory('Add upper-level windows', '#fef08a')],
        6: [_createStory('Extend roof over second floor', '#fef08a')],
    };
    for (const [i, cards] of Object.entries(demoCards)) {
        const col = cols[Number(i)];
        if (col) slice.stories[col.id] = cards;
    }
    _renderAndSave();
    // addSlice uses rAF internally to scroll/focus the new label.
    // Double-rAF to run after that completes: set label text and
    // reposition the spotlight/tooltip to account for the scroll.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const sliceEl = document.querySelector(`[data-slice-id="${slice.id}"]`);
        if (sliceEl) {
            const label = sliceEl.querySelector('.slice-label');
            if (label) {
                label.value = 'V2:\nTwo Story House';
                label.dispatchEvent(new Event('input', { bubbles: true }));
                label.blur();
            }
        }
        positionCurrentStep();
    }));
};

const removeDemoSlice = () => {
    if (!_demoSliceId || !_deleteSlice || !_getState) return;
    const state = _getState();
    if (state.slices.length > 1) {
        _deleteSlice(_demoSliceId);
    }
    _demoSliceId = null;
};

const ensureDemoLegendCards = () => {
    if (_demoLegendCards || !_createStory || !_getState || !_renderAndSave) return;
    const state = _getState();
    const slice = state.slices[0];
    if (!slice) return;
    const cols = state.columns;
    // Add a Question, Note, and Edge Case card to different steps in V1
    const cards = [
        { colIdx: 1, story: _createStory('Can kids open this alone?', '#bef264') },
        { colIdx: 4, story: _createStory('Walls must support second floor later', '#a5f3fc') },
        { colIdx: 5, story: _createStory('Small pieces - choking hazard for under 3s', '#fecdd3') },
    ];
    _demoLegendCards = [];
    for (const { colIdx, story } of cards) {
        const col = cols[colIdx];
        if (!col) continue;
        slice.stories[col.id] = slice.stories[col.id] || [];
        slice.stories[col.id].push(story);
        _demoLegendCards.push({ colId: col.id, storyId: story.id });
    }
    _renderAndSave();
};

const removeDemoLegendCards = () => {
    if (!_demoLegendCards || !_getState || !_renderAndSave) return;
    const state = _getState();
    const slice = state.slices[0];
    if (!slice) return;
    for (const { colId, storyId } of _demoLegendCards) {
        const stories = slice.stories[colId];
        if (!stories) continue;
        const idx = stories.findIndex(s => s.id === storyId);
        if (idx > -1) stories.splice(idx, 1);
    }
    _demoLegendCards = null;
    _renderAndSave();
};

const DEMO_LOG_ENTRIES = [
    { time: '10:42', color: '#f472b6', text: 'Sarah: Added step "Add roof"' },
    { time: '10:40', color: '#60a5fa', text: 'Mike: Added card "Design ridge cap to seal roof"' },
    { time: '10:38', color: '#60a5fa', text: 'Mike: Added card "Include angled roof pieces"' },
    { time: '10:35', color: '#f472b6', text: 'Sarah: Edited notes' },
    { time: '10:33', color: '#34d399', text: 'Jordan: Added card "Include window frame pieces"' },
    { time: '10:31', color: '#f472b6', text: 'Sarah: Added step "Add doors and windows"' },
    { time: '10:28', color: '#34d399', text: 'Jordan: Added card "Design interlocking wall sections"' },
    { time: '10:25', color: '#60a5fa', text: 'Mike: Added step "Start: Build walls"' },
    { time: '10:22', color: '#f472b6', text: 'Sarah: Added card "Package pieces in numbered bags"' },
    { time: '10:18', color: '#34d399', text: 'Jordan: Created map' },
];

const injectDemoLogEntries = () => {
    const container = document.getElementById('logList');
    if (!container) return;
    container.innerHTML = '';
    for (const entry of DEMO_LOG_ENTRIES) {
        const row = document.createElement('div');
        row.className = 'log-entry tour-demo-log';
        row.innerHTML =
            `<span class="log-dot" style="background:${entry.color}"></span>` +
            `<span class="log-time">${entry.time}</span>` +
            `<span class="log-text">${entry.text}</span>`;
        container.appendChild(row);
    }
};

const clearDemoLogEntries = () => {
    const container = document.getElementById('logList');
    if (!container) return;
    container.querySelectorAll('.tour-demo-log').forEach(el => el.remove());
    if (container.children.length === 0) {
        container.innerHTML = '<div class="log-empty">No activity yet</div>';
    }
};

const openLegendPanel = () => {
    const section = document.querySelector('.panel-section[data-section="legend"]');
    const tab = document.querySelector('.panel-tab[data-section="legend"]');
    if (!section || section.classList.contains('open')) return;
    document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    section.classList.add('open');
    tab?.classList.add('active');
    document.getElementById('controlsRight')?.classList.add('panel-open');
};

const openNotepadPanel = () => {
    const section = document.querySelector('.panel-section[data-section="notepad"]');
    const tab = document.querySelector('.panel-tab[data-section="notepad"]');
    if (!section || section.classList.contains('open')) return;
    document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    section.classList.add('open');
    tab?.classList.add('active');
    document.getElementById('controlsRight')?.classList.add('panel-open');
};

const closeNotepadPanel = () => {
    const section = document.querySelector('.panel-section[data-section="notepad"]');
    if (!section || !section.classList.contains('open')) return;
    section.classList.remove('open');
    document.querySelector('.panel-tab[data-section="notepad"]')?.classList.remove('active');
    document.getElementById('controlsRight')?.classList.remove('panel-open');
};

const openLogPanel = () => {
    const section = document.querySelector('.panel-section[data-section="log"]');
    const tab = document.querySelector('.panel-tab[data-section="log"]');
    if (!section || section.classList.contains('open')) return;
    document.querySelectorAll('.panel-section').forEach(s => s.classList.remove('open'));
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    section.classList.add('open');
    tab?.classList.add('active');
    document.getElementById('controlsRight')?.classList.add('panel-open');
};

const closeLogPanel = () => {
    const section = document.querySelector('.panel-section[data-section="log"]');
    if (!section || !section.classList.contains('open')) return;
    section.classList.remove('open');
    document.querySelector('.panel-tab[data-section="log"]')?.classList.remove('active');
    document.getElementById('controlsRight')?.classList.remove('panel-open');
};

const closeLegendPanel = () => {
    const section = document.querySelector('.panel-section[data-section="legend"]');
    if (!section || !section.classList.contains('open')) return;
    section.classList.remove('open');
    document.querySelector('.panel-tab[data-section="legend"]')?.classList.remove('active');
    document.getElementById('controlsRight')?.classList.remove('panel-open');
};

const STEPS = [
    {
        target: null,
        title: 'What is Storymaps.io?',
        body: 'This short interactive tour takes you through the basics of storymaps.io, a free tool for planning and building digital products.<br><br>It\'s based on User Story Mapping, a technique where you map out the workflow your users will go through, and let that shape the features you build. Starting from the journey (rather than a backlog of ideas) keeps you focused on real user needs, trims waste, and makes it clear what\'s essential versus nice-to-have.<br><br>Having a visual map helps teams build a shared understanding of what the product does, who it serves, and how it delivers value. Your finished map then serves as a comprehension tool, showing the product vision and evolution in a single artefact. At a glance, you can see what has been built and what is coming next.<br><br>To see how it works, let\'s start with a basic example. Imagine you\'re the creator of Lego. You want to think about how your customers will build one of your sets, the steps they\'ll take, and what you need to do to make the experience great. Let\'s map that with a story map.',
        icon: '\u{1F4A1}',
    },
    {
        target: ['#boardName', '.users-row', '.activities-row', '.steps-row', '.slice-container'],
        clipRight: '.step:not(.phantom-step)',
        tooltipTarget: '.panel-tabs',
        title: 'Our Example: A Lego House',
        body: 'This is a story map. Take a moment to look it over. We will walk through each section next.',
        icon: '\u{1F9F1}',
    },
    {
        target: '.users-row',
        title: 'Users',
        body: 'The top row defines <strong>who</strong> the users are. Each user or persona spans a group of activities below.',
        icon: '\u{1F464}',
    },
    {
        target: '.activities-row',
        title: 'Activities',
        body: 'Activities describe <strong>what</strong> each user is trying to achieve, high-level goals like \u201CBuild a Lego House\u201D.',
        icon: '\u{1F3AF}',
    },
    {
        target: '.steps-row > :nth-child(2)',
        title: 'Steps',
        body: 'Steps capture the user\'s journey from start to finish. They describe how users will use your product. First up: <strong>look at the picture on the box</strong>.',
        icon: '\u{1F9ED}',
    },
    {
        target: '.steps-row > :nth-child(3)',
        title: 'Steps',
        body: 'Then <strong>open the box</strong>\u2026',
        icon: '\u{1F9ED}',
    },
    {
        target: '.steps-row > :nth-child(4)',
        title: 'Steps',
        body: '\u2026and <strong>layout the pieces</strong>\u2026',
        icon: '\u{1F9ED}',
    },
    {
        target: '.steps-row > :nth-child(5)',
        title: 'Steps',
        body: '\u2026then <strong>read the instructions</strong>. Each step is something the user does along the way. Together they form the <strong>backbone</strong> of your story map.',
        icon: '\u{1F9ED}',
    },
    {
        target: '.slice-container .story-column:nth-child(4) .story-card:first-child',
        title: 'Task Cards',
        body: 'Below each step are task cards that define the work needed to support it. e.g., providing the user with instructions means we first have to write the instructions, so we\u2019ll add a task for that: <strong>Write instructions</strong>, which facilitates the step <strong>Read instructions</strong>.',
        icon: '\u{1F4CB}',
    },
    {
        target: '.slice-container .story-column:nth-child(4) .story-card:nth-child(2)',
        title: 'Task Cards',
        body: '\u2026next, <strong>indicate the pieces required at each step</strong>. Task cards are arranged vertically in order of priority - you work on the most important work first. Next, you\u2019ll see how task cards are grouped into priority &amp; release slices to manage versions.',
        icon: '\u{1F4CB}',
    },
    {
        target: '.slice-label-container',
        title: 'Release Slices',
        body: 'Horizontal rows group tasks into releases. This map has one slice, <strong>Version 1: Basic House</strong>. It represents version 1 of the product, the essentials you ship first.',
        icon: '\u{1F4E6}',
    },
    {
        target: '.slice-container',
        title: 'Version 1: Done',
        body: 'Once all the tasks in this slice are delivered, version 1 is done. You have your basic Lego house. Every task across every step has been completed, and your first release is shipped.<br><br><strong>Bonus:</strong> try moving some of the cards around, to get a sense of how cards are managed on the map.',
        icon: '\u{2705}',
        onEnter: () => {
            document.body.classList.add('tour-v1-done');
            const state = _getState?.();
            if (state?.slices?.[0]) {
                _v1Snapshot = JSON.parse(JSON.stringify(state.slices[0].stories));
            }
            const block = e => { if (e.button === 2) e.stopPropagation(); };
            document.addEventListener('mouseup', block, true);
            _ctxMenuCleanup = () => { document.removeEventListener('mouseup', block, true); _ctxMenuCleanup = null; };
        },
        onLeave: () => {
            document.body.classList.remove('tour-v1-done');
            _ctxMenuCleanup?.();
            const state = _getState?.();
            if (_v1Snapshot && state?.slices?.[0]) {
                state.slices[0].stories = _v1Snapshot;
                _v1Snapshot = null;
                _renderAndSave?.();
            }
        },
    },
    {
        target: '.slice-label-container .btn-add-slice',
        title: 'Add a Slice',
        body: 'Let\u2019s add another release slice. Imagine you want to upgrade the Lego house set to include a two-story build. That additional work goes in a dedicated release slice called Version 2. This is how story maps group work into versions.',
        icon: '\u{2795}',
        onEnter: () => ensureDemoSlice(),
    },
    {
        target: '.slice-container + .slice-container',
        title: 'Your Version 2 Slice',
        body: 'Here\'s your Version 2 slice with the extra work needed for a two-story house. Same steps across the top, but a whole new set of tasks underneath. Each version builds on the last, and your map keeps everything in context.',
        onEnter: () => ensureDemoSlice(),
        onLeave: () => removeDemoSlice(),
    },
    {
        target: null,
        title: 'Congratulations, you\'re a story mapper!',
        body: 'We just covered the basics of user story mapping. <strong>Users</strong>, <strong>Activities</strong>, <strong>Steps</strong>, <strong>Tasks</strong> and <strong>Releases</strong>. It really is that simple. You know enough now to start testing out the technique in your own work.<br><br>Now, let\u2019s look at a few bonus features that Storymaps.io provides on top of the core story mapping technique.',
        icon: '\u{1F389}',
    },
    {
        target: '#controlsRight',
        title: 'Storymaps.io Extras: Overview',
        body: 'The Overview tab sums up your map: how many cards, steps and slices it has, and how far along it is. Below that is the legend, where you define colour-coded categories for your cards. Like the yellow Tasks you saw, you can also add cards for inline Notes, Questions, and Edge Cases. Giving each type its own colour makes it easy to tell them apart at a glance.',
        icon: '\u{1F3A8}',
        onEnter: () => { _zoomToFit?.(); openLegendPanel(); },
    },
    {
        target: '.slice-container',
        title: 'Storymaps.io Extras: Legend',
        body: 'See how different card types stand out? The green Question, blue Note, and pink Edge Case are immediately recognisable alongside the yellow Tasks. This makes it easy to scan the map and spot extra context and questions.',
        icon: '\u{1F3A8}',
        onEnter: () => ensureDemoLegendCards(),
        onLeave: () => {
            removeDemoLegendCards();
            closeLegendPanel();
        },
    },
    {
        target: '#notesPanel',
        tooltipTarget: '#notesPanel',
        title: 'Storymaps.io Extras: Notepad',
        body: 'A shared document for meeting notes, decisions, or anything your team needs to capture alongside the map.',
        icon: '\u{1F4DD}',
        onEnter: () => { _zoomToFit?.(); document.getElementById('notesToggle')?.click(); },
        onLeave: () => closeNotepadPanel(),
    },
    {
        target: '#logPanel',
        tooltipTarget: '#logPanel',
        title: 'Storymaps.io Extras: Activity Log',
        body: 'The activity log tracks changes made to the map, who made it, and when.',
        icon: '\u{1F4DC}',
        onEnter: () => { document.getElementById('logToggle')?.click(); injectDemoLogEntries(); },
        onLeave: () => { clearDemoLogEntries(); closeLogPanel(); },
    },
    {
        target: '#logToggle',
        noDim: true,
        title: 'Storymaps.io Extras: Dark Mode',
        body: 'Easy on the eyes for late-night planning sessions. Dark mode is great for reducing eye strain and looks sharp on big screens during team presentations.',
        icon: '\u{1F319}',
        onEnter: function () {
            document.getElementById('toggleDarkModeBtn')?.click();
        },
        onLeave: function () {
            document.getElementById('toggleDarkModeBtn')?.click();
        },
    },
    {
        target: null,
        title: 'Tour Complete!',
        body: 'Feel free to edit this Lego house map. Every story map gets a unique URL, so this one is yours to play with or use as a template and turn it into a map of your own work. You can also share map URLs and collaborate live with colleagues on your story maps.<br><br>You could also try the other samples in the menu, or if you want to get up and running fast, import the story map hidden inside your existing backlog using the Import options in the menu.<br><br>Thanks for taking the Storymaps.io tour :)',
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
        // Immediately clear stale highlight — Safari may not repaint in the rAF
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
        // Immediately clear stale highlight — Safari may not repaint in the rAF
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
