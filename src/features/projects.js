// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Project tabs: maps grouped under one name, shown as tabs under the header.
//
// A project is kept by the server next to the map index, never inside a map, so nothing here
// writes to a map. A map can be in any number of projects. A plain map link (/<map>) never shows
// them; a project link (/p/<project>/<map>) shows the tabs of that project. Each tab is a plain
// link that loads the map fresh, so nothing from one map is still in memory when the next opens.

import { dom } from '/src/ui/dom.js';
import { state } from '/src/core/state.js';
import { el } from '/src/core/constants.js';
import { showAlert, showConfirm, showToast } from '/src/core/modals.js';
import { parseMapId, parseLocation, projectPath, moveItem, MAX_PROJECT_MAPS } from '/src/core/project-links.js';
import { ensureSortable } from '/src/core/yjs.js';
import { readRecent, writeRecent, openedAgo } from '/src/core/recent-maps.js';

const REFRESH_MS = 30_000;
const CACHE_KEY = 'project:';

let _mapId = null;      // the open map
let _projectId = null;  // the project whose tabs show, from the page address
let _project = null;    // { id, name, maps: [{ id, name }] } once known
let _seq = 0;           // only the newest answer from the server is shown
let _changing = 0;      // changes waiting for the server; a refresh then could show the tabs from before
let _reveal = false;    // scroll the current tab into view at the next render
let _tabsMoved = false; // the person moved along the tabs, so stop bringing the current one back
let _tabSizes = null;   // watches the strip and its tabs, which widen as the font loads
let _provider = null;
let _panel = null;      // 'start', 'add' or 'manage' while that box is open
let _trigger = null;    // the button that opened the box, focused again when it closes
const _seenSignals = new Map();
let _onShown = null;    // told when the server answers with the project around the open map
let _onNamed = null;    // told when a project is started or renamed here; true when it showed something
let _renamed = false;   // the project was renamed while its box was open

const ICONS = {
    plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    stack: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    grip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
};


const mapLabel = (map) => map.id === _mapId ? (state.name || dom.boardName.value || 'Untitled map') : (map.name || 'Untitled map');

// =============================================================================
// Server
// =============================================================================

const request = async (path, body) => {
    const res = await fetch(`/api/projects${path}`, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(json.error || 'Something went wrong. Try again.');
        err.status = res.status;
        throw err;
    }
    return json.project ?? null;
};

// The last version of each project seen in this tab, so a tab that opens shows straight away
const readCache = (projectId) => {
    try {
        const cached = sessionStorage.getItem(CACHE_KEY + projectId);
        return cached ? JSON.parse(cached) : null;
    } catch {
        return null;
    }
};

const writeCache = (projectId, project) => {
    try {
        if (project) sessionStorage.setItem(CACHE_KEY + projectId, JSON.stringify(project));
        else sessionStorage.removeItem(CACHE_KEY + projectId);
    } catch { /* storage unavailable: tabs show once the server answers */ }
};

// Keep the page address in step with whether the tabs show, without adding a history entry
const setAddress = (path) => {
    if (location.pathname !== path) history.replaceState(history.state, '', path + location.search + location.hash);
};

// Show this map with the tabs of the project, or by itself when the project is gone or no
// longer has this map
const apply = (projectId, seq, project) => {
    if (projectId !== _projectId || seq !== _seq) return;
    writeCache(projectId, project);
    if (!project || !project.maps.some(m => m.id === _mapId)) {
        _projectId = null;
        _project = null;
        setAddress(`/${encodeURIComponent(_mapId)}`);
    } else {
        if (!_project) _reveal = true;
        _project = project;
    }
    render();
    _onShown?.();
};

// Call fn each time the project around the open map is confirmed by the server, or found gone
export const onShown = (fn) => { _onShown = fn; };

// Call fn when a project is started here, or renamed once its box closes
export const onNamed = (fn) => { _onNamed = fn; };

// Start showing a project around the open map
const enter = (project) => {
    _projectId = project.id;
    _project = null;
    _seq++;
    setAddress(projectPath(project.id, _mapId));
    apply(project.id, _seq, project);
};

export const refresh = async () => {
    const projectId = _projectId;
    if (!projectId || _changing) return;
    const seq = ++_seq;
    try {
        apply(projectId, seq, await request(`/${encodeURIComponent(projectId)}`));
    } catch (err) {
        // A project that's gone shows the map by itself; anything else keeps what is shown
        if (err.status === 404) apply(projectId, seq, null);
    }
};

// Tell people on this map with the same project open that the tabs changed
const signal = () => {
    if (_projectId) _provider?.awareness?.setLocalStateField('project', { id: _projectId, at: Date.now() });
};

// Make a change to the open project. Returns true when it was made.
const change = async (path, body, errorEl) => {
    const projectId = _projectId;
    const seq = ++_seq;
    if (errorEl) errorEl.hidden = true;
    _changing++;
    try {
        const project = await request(`/${encodeURIComponent(projectId)}${path}`, body);
        _changing--;
        apply(projectId, seq, project);
        signal();
        return true;
    } catch (err) {
        _changing--;
        showError(err, errorEl);
        refresh();
        return false;
    }
};

const showError = (err, errorEl) => {
    if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
    } else {
        showAlert(err.message);
    }
};

// Start a project with the open map in it, and any others picked
const start = async (name, others, errorEl) => {
    if (errorEl) errorEl.hidden = true;
    try {
        return await request('', { mapIds: [_mapId, ...others], name });
    } catch (err) {
        showError(err, errorEl);
        return null;
    }
};

// =============================================================================
// Tabs
// =============================================================================

const render = () => {
    const bar = dom.projectBar;
    if (!bar) return;
    bar.hidden = !_mapId;
    document.body.classList.toggle('in-project', !!(_mapId && _project));

    dom.projectName.hidden = !_project;
    dom.projectName.setAttribute('aria-label', _project ? `Project: ${_project.name}` : 'Project');
    dom.projectName.innerHTML = ICONS.stack;
    dom.projectName.append(el('span', 'project-name-text', { text: _project?.name || '' }));
    dom.projectTabs.replaceChildren(...(_project?.maps || []).map(map => {
        const current = map.id === _mapId;
        const href = projectPath(_project.id, map.id);
        return el('a', current ? 'project-tab current' : 'project-tab', {
            href,
            ariaCurrent: current ? 'page' : null,
            title: `${location.host}${href}`,
            text: mapLabel(map),
        });
    }));
    if (_reveal) {
        _tabsMoved = false;
        revealCurrentTab();
    }
    watchTabSizes();
    updateTabScroll();
    // In a project the button adds a map beside the tabs; before that it starts the project
    dom.projectAddBtn.innerHTML = _project ? `${ICONS.plus}<span>Add map</span>` : `${ICONS.stack}<span>Start a project</span>`;
    dom.projectAddBtn.title = _project ? `Add a map to ${_project.name}` : 'Keep related maps in one place, as tabs';
    dom.projectHint.hidden = !!_project;
    if (dom.projectMenuBtn) dom.projectMenuBtn.lastChild.textContent = _project ? ' Manage project' : ' Start a project';
    // This map left the project while the box was open
    if (_panel === 'manage' && !_project) closePanel({ restoreFocus: false });
    if (_panel === 'manage') renderManageList();
};

// Scroll the tab strip, and only the strip, so the current tab shows. It goes in the middle, clear
// of the faded edges and arrows when the tabs overflow.
const revealCurrentTab = () => {
    const strip = dom.projectTabs;
    const tab = strip.querySelector('.project-tab.current');
    if (!tab || !strip.clientWidth) return;
    _reveal = false;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = Math.max(0, left - (strip.clientWidth - tab.offsetWidth) / 2);
    }
};

// When the tabs don't all fit, fade the edges with more beyond them and show an arrow there
const updateTabScroll = () => {
    const strip = dom.projectTabs;
    if (!strip) return;
    const moreLeft = strip.scrollLeft > 1;
    const moreRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    strip.classList.toggle('more-left', moreLeft);
    strip.classList.toggle('more-right', moreRight);
    dom.projectScrollLeft.hidden = !moreLeft;
    dom.projectScrollRight.hidden = !moreRight;
};

// Tabs change width as the font loads and maps are renamed, and the strip narrows as the header
// settles on a phone. Until the person moves along the tabs, keep the current one in view.
const watchTabSizes = () => {
    _tabSizes ??= new ResizeObserver(() => {
        if (!_tabsMoved) revealCurrentTab();
        updateTabScroll();
    });
    _tabSizes.disconnect();
    _tabSizes.observe(dom.projectTabs);
    dom.projectTabs.querySelectorAll('.project-tab').forEach(tab => _tabSizes.observe(tab));
};

// An arrow moves along most of a strip's width, keeping a tab's worth in view for context
const scrollTabs = (direction) => {
    _tabsMoved = true;
    const strip = dom.projectTabs;
    strip.scrollBy({ left: direction * Math.max(120, strip.clientWidth - 120), behavior: 'smooth' });
};

// The tab for the current map follows the title as it changes
const updateCurrentTab = () => {
    const tab = dom.projectTabs?.querySelector('.project-tab.current');
    if (tab) tab.textContent = mapLabel({ id: _mapId });
};

// =============================================================================
// Add and manage boxes
// =============================================================================

const closePanel = ({ restoreFocus = true } = {}) => {
    if (!_panel) return;
    _panel = null;
    dom.projectPanel.hidden = true;
    dom.projectPanel.replaceChildren();
    dom.projectBackdrop.hidden = true;
    dom.projectBar.classList.remove('panel-open');
    dom.projectAddBtn.setAttribute('aria-expanded', 'false');
    dom.projectName.setAttribute('aria-expanded', 'false');
    if (restoreFocus) _trigger?.focus();
    _trigger = null;
    if (_renamed) {
        _renamed = false;
        _onNamed?.();
    }
};

const openPanel = (kind, trigger) => {
    closePanel({ restoreFocus: false });
    _panel = kind;
    _trigger = trigger;
    trigger?.setAttribute('aria-expanded', 'true');
    const panel = dom.projectPanel;
    panel.className = `project-panel project-panel-${kind}`;
    panel.replaceChildren(...({ start: buildStart, add: buildAdd, manage: buildManage })[kind]());
    panel.hidden = false;
    dom.projectBackdrop.hidden = false;
    dom.projectBar.classList.add('panel-open');
    // Line the box up under the button that opened it, kept inside the bar
    const bar = dom.projectBar.getBoundingClientRect();
    const at = (trigger || dom.projectAddBtn).getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(at.left - bar.left, bar.width - panel.offsetWidth))}px`;
    // The start box starts on the name field; the add box on its first recent map, or New map; the
    // manage box on the box itself, so a phone doesn't open its keyboard for a name that's already set
    if (kind === 'start') panel.querySelector('input')?.focus();
    else if (kind === 'add') panel.querySelector('.project-recent-tick, button')?.focus();
    else panel.focus();
};

const errorLine = () => {
    const error = el('p', 'project-panel-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    return error;
};

// Maps opened recently in this browser, newest first, leaving out the ones given
const recentMaps = (leaveOut) => readRecent().filter(e => e.kind === 'map' && !leaveOut.includes(e.id));

// Maps opened recently, with tick boxes, for the start and add boxes. The fixed map is shown
// ticked and can't be unticked. Ticks stop once room maps are ticked, so the project can take
// them all. onChange is told how many are ticked.
const recentPicker = (entries, { room, fixed = null, onChange }) => {
    const now = Date.now();
    const row = (e, { checked = false, disabled = false, note = '' } = {}) => {
        const name = e.name || 'Untitled map';
        const box = el('input', 'project-recent-tick', { type: 'checkbox', value: e.id, checked, disabled });
        const text = el('span', 'project-recent-name', { text: name, title: `${name}, ${location.host}/${e.id}` });
        if (note) text.append(el('span', 'project-panel-item-note', { text: ` ${note}` }));
        const label = el('label');
        label.append(box, text, el('span', 'project-recent-when', { text: openedAgo(e.at, now) }));
        const item = el('li', 'project-recent-item');
        item.append(label);
        return item;
    };
    const heading = el('p', 'project-panel-label', { id: 'projectRecentLabel', text: 'Maps you\'ve opened recently' });
    const list = el('ul', 'project-recent', { ariaLabelledby: 'projectRecentLabel' });
    if (fixed) list.append(row(fixed, { checked: true, disabled: true, note: '(this map)' }));
    list.append(...entries.map(e => row(e)));
    const picked = () => [...list.querySelectorAll('.project-recent-tick:checked:not(:disabled)')].map(box => box.value);
    const recount = () => {
        const full = picked().length >= room;
        list.querySelectorAll('.project-recent-tick:not(:checked)').forEach((box) => { box.disabled = full; });
        onChange(picked().length);
    };
    list.addEventListener('change', recount);
    const clear = el('button', 'project-recent-clear', { type: 'button', text: 'Clear list' });
    clear.addEventListener('click', async () => {
        if (!await showConfirm('Clear the list of recent maps?\n\nThe maps aren\'t deleted, and still open from their links.')) return;
        writeRecent([]);
        if (_panel) openPanel(_panel, _trigger);
    });
    const foot = el('p', 'project-recent-foot');
    foot.append(el('span', '', { text: 'Maps opened in this browser. Only you see this list.' }), clear);
    // A map now in the project leaves the list
    const drop = (mapId) => {
        list.querySelector(`.project-recent-tick[value="${CSS.escape(mapId)}"]`)?.closest('li').remove();
        room--;
    };
    return { nodes: [heading, list, foot], picked, recount, drop };
};

// Start a project with this map in it, and any maps opened recently that are ticked. Other maps
// are added afterwards, from Add map.
const buildStart = () => {
    const heading = el('h2', 'project-panel-title', { id: 'projectPanelTitle', text: 'Start a project' });
    const intro = el('p', 'project-panel-hint', { text: 'A project keeps related maps in one place. The maps sit alongside each other as tabs, and you can move between them in one click.' });
    const label = el('label', 'project-panel-label', { htmlFor: 'projectStartName', text: 'Project name' });
    const input = el('input', 'project-panel-input', { id: 'projectStartName', type: 'text', placeholder: 'Untitled project', maxLength: 100, autocomplete: 'off' });
    const create = el('button', 'project-panel-primary', { type: 'button', text: 'Create project' });
    const error = errorLine();
    const recent = recentMaps([_mapId]);
    const fixed = { id: _mapId, name: state.name || dom.boardName.value, at: readRecent().find(e => e.kind === 'map' && e.id === _mapId)?.at ?? Date.now() };
    const picker = recent.length ? recentPicker(recent, {
        room: MAX_PROJECT_MAPS - 1,
        fixed,
        onChange: (n) => { create.textContent = n ? `Create project with ${n + 1} maps` : 'Create project'; },
    }) : null;
    const submit = async () => {
        create.disabled = true;
        const project = await start(input.value, picker?.picked() || [], error);
        create.disabled = false;
        if (!project) return;
        closePanel();
        enter(project);
        // The reminder to bookmark the project, or else a note on sharing it
        if (!_onNamed?.()) showToast('Project created. To share it, use Share project link.', 6000);
    };
    create.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    });
    return [heading, intro, label, input, ...(picker?.nodes || []), error, create];
};

const buildAdd = () => {
    const heading = el('h2', 'project-panel-title', { id: 'projectPanelTitle', text: `Add a map to ${_project.name}` });
    // A full project offers nothing to add, rather than making a map it can't take
    if (_project.maps.length >= MAX_PROJECT_MAPS) {
        const full = el('p', 'project-panel-hint', { text: `This project has ${MAX_PROJECT_MAPS} maps, the most a project can hold. Remove a map to add another.` });
        const done = el('button', 'project-panel-secondary project-panel-done', { type: 'button', text: 'Done' });
        done.addEventListener('click', () => closePanel());
        return [heading, full, done];
    }
    const newBtn = el('button', 'project-panel-primary', { type: 'button', text: 'New map' });
    newBtn.addEventListener('click', () => window.location.assign(projectPath(_project.id, 'new')));
    const label = el('label', 'project-panel-label', { htmlFor: 'projectLinkInput', text: 'Or paste the link to a map you have' });
    const input = el('input', 'project-panel-input', { id: 'projectLinkInput', type: 'text', placeholder: `${location.host}/...`, autocomplete: 'off', spellcheck: false });
    const addBtn = el('button', 'project-panel-secondary', { type: 'button', text: 'Add' });
    const error = errorLine();
    const add = async () => {
        const mapId = parseMapId(input.value);
        if (!mapId) {
            error.textContent = `Paste a map link, like ${location.host}/abc12345`;
            error.hidden = false;
            return;
        }
        if (mapId === _mapId) {
            error.textContent = "That's the map you're on. Paste a link to a different map.";
            error.hidden = false;
            return;
        }
        addBtn.disabled = true;
        if (await change('/maps', { mapId }, error)) closePanel();
        addBtn.disabled = false;
    };
    addBtn.addEventListener('click', add);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            add();
        }
    });
    const row = el('div', 'project-panel-row');
    row.append(input, addBtn);
    const hint = el('p', 'project-panel-hint', { text: 'Adding a map to a project doesn\'t change the map or the map link, and a map can be in other projects too. Removing a map from a project never deletes the map.' });
    const recent = recentMaps(_project.maps.map(m => m.id));
    if (!recent.length) return [heading, newBtn, label, row, error, hint];

    // With maps opened recently, ticking them comes first, then pasting a link, then New map
    const addPicked = el('button', 'project-panel-primary', { type: 'button', text: 'Add maps', disabled: true });
    const picker = recentPicker(recent, {
        room: MAX_PROJECT_MAPS - _project.maps.length,
        onChange: (n) => {
            addPicked.textContent = n ? `Add ${n} ${n === 1 ? 'map' : 'maps'}` : 'Add maps';
            addPicked.disabled = !n;
        },
    });
    addPicked.addEventListener('click', async () => {
        addPicked.disabled = true;
        for (const mapId of picker.picked()) {
            // Stop at a map the project can't take, with the ones added so far gone from the list
            if (!await change('/maps', { mapId }, error)) return picker.recount();
            picker.drop(mapId);
        }
        closePanel();
    });
    heading.textContent = `Add maps to ${_project.name}`;
    newBtn.className = 'project-panel-secondary';
    label.textContent = 'Or paste the link to a map';
    return [heading, ...picker.nodes, addPicked, label, row, newBtn, error, hint];
};

const buildManage = () => {
    const heading = el('h2', 'project-panel-title', { id: 'projectPanelTitle', text: 'Project' });
    const label = el('label', 'project-panel-label', { htmlFor: 'projectNameInput', text: 'Name' });
    const input = el('input', 'project-panel-input', { id: 'projectNameInput', type: 'text', value: _project?.name || '', maxLength: 100, autocomplete: 'off' });
    const error = errorLine();
    input.addEventListener('change', () => {
        if (input.value.trim() && input.value.trim() !== _project?.name) {
            // The reminder waits for the box to close, which may be before the server answers
            change('/name', { name: input.value }, error).then((done) => {
                if (!done) return;
                if (_panel === 'manage') _renamed = true;
                else _onNamed?.();
            });
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Saves the name, keeping the keyboard in the box so Escape still closes it
            dom.projectPanel.focus();
        }
    });
    // The project link, to share in place of links to single maps
    const linkLabel = el('label', 'project-panel-label', { htmlFor: 'projectLinkCopy', text: 'Project link' });
    const link = el('input', 'project-panel-input project-panel-link', { id: 'projectLinkCopy', type: 'text', value: projectLink() || '', readOnly: true, spellcheck: false });
    link.addEventListener('focus', () => link.select());
    const copy = el('button', 'project-panel-secondary', { type: 'button', text: 'Copy' });
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link.value);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
        } catch {
            link.focus();
        }
    });
    const linkRow = el('div', 'project-panel-row');
    linkRow.append(link, copy);
    const listLabel = el('p', 'project-panel-label', { id: 'projectMapsLabel', text: 'Maps' });
    const list = el('ol', 'project-panel-list', { id: 'projectMapsList', ariaLabelledby: 'projectMapsLabel' });
    // Deleting the project is its own action, never a side effect of removing maps
    const remove = el('button', 'project-panel-remove project-panel-delete', { type: 'button', text: 'Delete project' });
    remove.addEventListener('click', async () => {
        const message = `Delete the project "${_project.name}"?\n\nThe maps in it aren't deleted, but the project link will no longer work.`;
        if (await showConfirm(message)) change('/delete', {}, error);
    });
    const done = el('button', 'project-panel-secondary', { type: 'button', text: 'Done' });
    done.addEventListener('click', () => closePanel());
    const footer = el('div', 'project-panel-footer');
    footer.append(remove, done);
    queueMicrotask(() => {
        renderManageList();
        makeListSortable(list);
    });
    return [heading, label, input, linkLabel, linkRow, listLabel, list, error, footer];
};

// Drag a map by the handle to a new place in the list; the arrows do the same from the keyboard
const makeListSortable = async (list) => {
    const Sortable = await ensureSortable().catch(() => null);
    if (!Sortable || !list.isConnected) return;
    Sortable.create(list, {
        handle: '.project-panel-grip',
        animation: 150,
        onEnd: (e) => {
            if (e.oldIndex === e.newIndex) return;
            const order = [...list.children].map(row => row.dataset.mapId);
            change('/order', { mapIds: order });
        },
    });
    list.dataset.sortable = 'ready';
};

const renderManageList = () => {
    const list = document.getElementById('projectMapsList');
    if (!list) return;
    const maps = _project?.maps || [];
    const ids = maps.map(m => m.id);
    const focused = document.activeElement?.closest?.('#projectMapsList') ? document.activeElement.dataset.action + ':' + document.activeElement.dataset.mapId : null;
    list.replaceChildren(...maps.map((map, i) => {
        const name = mapLabel(map);
        const row = el('li', 'project-panel-item', { dataMapId: map.id });
        const grip = el('span', 'project-panel-grip', { title: 'Drag to reorder', html: ICONS.grip });
        const text = el('span', 'project-panel-item-name', { text: name, title: name });
        if (map.id === _mapId) text.append(el('span', 'project-panel-item-note', { text: ' (this map)' }));
        const move = (delta, icon, label) => {
            const btn = el('button', 'project-panel-icon', { type: 'button', ariaLabel: `Move ${name} ${label}`, title: `Move ${label}`, html: icon, dataAction: label, dataMapId: map.id });
            const order = moveItem(ids, i, delta);
            btn.disabled = !order;
            btn.addEventListener('click', () => order && change('/order', { mapIds: order }));
            return btn;
        };
        const remove = el('button', 'project-panel-remove', { type: 'button', text: 'Remove', ariaLabel: `Remove ${name} from the project`, dataAction: 'remove', dataMapId: map.id });
        remove.addEventListener('click', async () => {
            const last = _project.maps.length === 1 ? ' The project stays, with no maps, until someone deletes it.' : '';
            const message = `Remove "${name}" from ${_project.name}?\n\nThe map isn't deleted, and still opens at ${location.host}/${map.id}.${last}`;
            if (await showConfirm(message)) change('/remove', { mapId: map.id });
        });
        row.append(grip, text, move(-1, ICONS.up, 'up'), move(1, ICONS.down, 'down'), remove);
        return row;
    }));
    // Keep focus on the button that was used, now in the new row
    if (focused) {
        const [action, mapId] = focused.split(':');
        const again = list.querySelector(`button[data-action="${action}"][data-map-id="${CSS.escape(mapId)}"]`);
        (again && !again.disabled ? again : list.querySelector(`button[data-map-id="${CSS.escape(mapId)}"]:not(:disabled)`))?.focus();
    }
};

// =============================================================================
// Opening a map
// =============================================================================

// Show the tabs for a map that has just opened, when the page address names a project: from
// the last visit straight away, then from the server
export const load = (mapId) => {
    _renamed = false;
    closePanel({ restoreFocus: false });
    const where = parseLocation(location.pathname);
    _mapId = mapId;
    _projectId = where.mapId === mapId ? where.projectId : null;
    _project = _projectId ? readCache(_projectId) : null;
    if (_project && !_project.maps?.some(m => m.id === mapId)) _project = null;
    _reveal = true;
    _seenSignals.clear();
    render();
    refresh();
};

// Hide the tabs when no map is open
export const clear = () => {
    _renamed = false;
    closePanel({ restoreFocus: false });
    _mapId = null;
    _projectId = null;
    _project = null;
    _provider = null;
    _seq++;
    render();
};

// A project for a link to the project alone (/p/<project>), or null when there isn't one
export const fetchProject = async (projectId) => {
    try {
        return await request(`/${encodeURIComponent(projectId)}`);
    } catch {
        return null;
    }
};

// Follow the open map: tab changes from someone else in the same project, and title changes
export const watch = (provider, ymap) => {
    _provider = provider;
    provider.awareness.on('change', ({ added, updated }) => {
        let changed = false;
        for (const clientId of [...added, ...updated]) {
            if (clientId === provider.awareness.clientID) continue;
            const signalled = provider.awareness.getStates().get(clientId)?.project;
            if (!signalled?.at || signalled.id !== _projectId || _seenSignals.get(clientId) === signalled.at) continue;
            // Someone already here when the map opened changed the tabs before the first fetch
            if (_seenSignals.has(clientId) || updated.includes(clientId)) changed = true;
            _seenSignals.set(clientId, signalled.at);
        }
        if (changed) refresh();
    });
    ymap?.observe((event) => {
        if (event.keysChanged.has('name')) updateCurrentTab();
    });
};

// Before /p/<project>/new makes a map, check the project is there and has room, so a map is
// never made that can't join it. Returns null when there's room (or the server can't say), or
// the reason there isn't and, for a full project, its first map to open instead.
export const roomForNewMap = async (projectId) => {
    try {
        const project = await request(`/${encodeURIComponent(projectId)}`);
        if (project.maps.length < MAX_PROJECT_MAPS) return null;
        return {
            message: `${project.name} already has ${MAX_PROJECT_MAPS} maps, the most a project can hold, so no new map was created.`,
            firstMap: project.maps[0].id,
        };
    } catch (err) {
        if (err.status === 404) return { message: 'This project no longer exists, so no new map was created.', firstMap: null };
        return null;
    }
};

// The link to the project shown around the open map, which opens on its first tab, or null
export const projectLink = () => _project ? `${location.origin}/p/${encodeURIComponent(_project.id)}` : null;

// The project shown around the open map, or null
export const current = () => _project ? { id: _project.id, name: _project.name, mapCount: _project.maps.length } : null;

// A new map made from the add box of a project (/p/<project>/new) joins that project at the end.
// A copy of a map in a project joins it straight after the original.
export const joinNew = async (projectId, after) => {
    if (!_mapId) return;
    _projectId = projectId;
    const seq = ++_seq;
    try {
        const project = await request(`/${encodeURIComponent(projectId)}/maps`, { mapId: _mapId, after });
        setAddress(projectPath(projectId, _mapId));
        apply(projectId, seq, project);
    } catch (err) {
        _projectId = null;
        render();
        showAlert(`This map was created, but it couldn't be added to the project: ${err.message}`);
    }
};

// The project item in the main menu: manage the project, or start one
export const openFromMenu = () => {
    if (!_mapId) return;
    openPanel(_project ? 'manage' : 'start', _project ? dom.projectName : dom.projectAddBtn);
};

export const initListeners = () => {
    dom.projectAddBtn.addEventListener('click', () => {
        const kind = _project ? 'add' : 'start';
        if (_panel === kind) closePanel();
        else openPanel(kind, dom.projectAddBtn);
    });
    dom.projectName.addEventListener('click', () => {
        if (_panel === 'manage') closePanel();
        else openPanel('manage', dom.projectName);
    });
    dom.projectTabs.addEventListener('scroll', updateTabScroll, { passive: true });
    dom.projectTabs.addEventListener('touchstart', () => { _tabsMoved = true; }, { passive: true });
    dom.projectScrollLeft.addEventListener('click', () => scrollTabs(-1));
    dom.projectScrollRight.addEventListener('click', () => scrollTabs(1));
    // An up-and-down wheel moves along the tabs, as they only scroll sideways
    dom.projectTabs.addEventListener('wheel', (e) => {
        const strip = dom.projectTabs;
        if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
        e.preventDefault();
        _tabsMoved = true;
        // Firefox can count in lines rather than pixels
        strip.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    }, { passive: false });
    // The current tab is the map already open
    dom.projectTabs.addEventListener('click', (e) => {
        if (e.target.closest('.project-tab.current') && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) e.preventDefault();
    });
    dom.projectBackdrop.addEventListener('click', () => closePanel());
    dom.projectPanel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closePanel();
        }
    });
    document.addEventListener('pointerdown', (e) => {
        if (_panel && !dom.projectPanel.contains(e.target) && !e.target.closest?.('#projectAddBtn, #projectName, #projectMenuBtn, .modal-overlay, .modal')) closePanel({ restoreFocus: false });
    });
    dom.boardName.addEventListener('input', updateCurrentTab);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
    });
    setInterval(() => {
        if (document.visibilityState === 'visible' && !_panel) refresh();
    }, REFRESH_MS);
};
