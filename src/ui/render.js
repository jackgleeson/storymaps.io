// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Rendering and state mutations

import { el, DEFAULT_CARD_COLORS, CARD_COLORS, STATUS_OPTIONS, generateId } from '/src/core/constants.js';
import { createColumnCard, createStoryCard, createStoryColumn, createSliceContainer, createBackboneRow, createEmptyBackboneRow, createPhantomStep, PHANTOM_BUFFER, renderLegend as uiRenderLegend, getAllTagsInMap, createPartialMapRef, createPartialMapRefCell, renderPartialsList as uiRenderPartialsList, patchCard } from '/src/ui/ui.js';
import { partialMapEditState } from '/src/core/state.js';
import { showAlert, showConfirm, showPrompt } from '/src/core/modals.js';
import { quoted } from '/src/core/log.js';

let _state = null;
let _dom = null;
let _isMapEditable = null;
let _pushUndo = null;
let _saveToStorage = null;
let _renderAndSave = null;
let _ensureSortable = null;
let _scrollElementIntoView = null;
let _notepadUpdate = null;
let _getIsSafari = null;
let _zoomLevelGetter = null;
let _broadcastDragStart = null;
let _broadcastDragEnd = null;
let _getIsPinching = null;
let _createPartialMap = null;
let _deletePartialMap = null;
let _replaceWithPartial = null;
let _logEvent = null;
let _logTextEdit = null;

export const init = ({ state, isMapEditable, pushUndo, saveToStorage, renderAndSave, ensureSortable, scrollElementIntoView, notepadUpdate, getIsSafari, getZoomLevel, broadcastDragStart, broadcastDragEnd, getIsPinching, createPartialMap, deletePartialMap, replaceWithPartial, logEvent, logTextEdit }) => {
    _state = state;
    _dom = {
        storyMap: document.getElementById('storyMap'),
        storyMapWrapper: document.getElementById('storyMapWrapper'),
    };
    _isMapEditable = isMapEditable;
    _pushUndo = pushUndo;
    _saveToStorage = saveToStorage;
    _renderAndSave = renderAndSave;
    _ensureSortable = ensureSortable;
    _scrollElementIntoView = scrollElementIntoView;
    _notepadUpdate = notepadUpdate;
    _getIsSafari = getIsSafari;
    _zoomLevelGetter = getZoomLevel;
    _broadcastDragStart = broadcastDragStart;
    _broadcastDragEnd = broadcastDragEnd;
    _getIsPinching = getIsPinching;
    _createPartialMap = createPartialMap;
    _deletePartialMap = deletePartialMap;
    _replaceWithPartial = replaceWithPartial;
    _logEvent = logEvent;
    _logTextEdit = logTextEdit;
};

const _getEditingPartialColIds = () => {
    if (!partialMapEditState.activeId) return null;
    return partialMapEditState.editingColIds.size > 0 ? partialMapEditState.editingColIds : null;
};

// =============================================================================
// Rendering
// =============================================================================

export const render = () => {
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

    // Preserve scroll position across DOM rebuild
    const savedScrollLeft = _dom.storyMapWrapper.scrollLeft;
    const savedScrollTop = _dom.storyMapWrapper.scrollTop;

    // Preserve hover state across DOM rebuild (prevents button flicker on remote edits)
    const hoveredCard = _dom.storyMap.querySelector('.story-card:hover');
    const hoveredStep = _dom.storyMap.querySelector('.step:hover');
    let savedHover = null;
    if (hoveredCard && hoveredCard.dataset.storyId) {
        savedHover = { sel: `.story-card[data-story-id="${hoveredCard.dataset.storyId}"]` };
    } else if (hoveredStep && hoveredStep.dataset.columnId) {
        savedHover = { sel: `.step[data-column-id="${hoveredStep.dataset.columnId}"]` };
    }

    _dom.storyMap.classList.add('notransition');
    _dom.storyMap.innerHTML = '';

    // Apply partial editing class for dimming
    const editingPmId = partialMapEditState.activeId;
    const editingColIds = _getEditingPartialColIds();
    _dom.storyMap.classList.toggle('partial-editing', !!editingPmId);

    const expandedIds = partialMapEditState.expandedIds;
    const hasAnyExpanded = expandedIds.size > 0 && !editingPmId;

    // Check if users/activities have any cards (include partial map data when preview expanded)
    let hasUsersContent = Object.values(_state.users).some(cards => cards.length > 0);
    let hasActivitiesContent = Object.values(_state.activities).some(cards => cards.length > 0);
    if (hasAnyExpanded) {
        hasUsersContent = hasUsersContent || _state.partialMaps.some(pm => expandedIds.has(pm.id) && Object.values(pm.users || {}).some(cards => cards.length > 0));
        hasActivitiesContent = hasActivitiesContent || _state.partialMaps.some(pm => expandedIds.has(pm.id) && Object.values(pm.activities || {}).some(cards => cards.length > 0));
    }

    // Render Users row
    if (hasUsersContent) {
        _dom.storyMap.appendChild(createBackboneRow('Users', _state.users));
    } else {
        _dom.storyMap.appendChild(createEmptyBackboneRow('Users'));
    }

    // Render Activities row
    if (hasActivitiesContent) {
        _dom.storyMap.appendChild(createBackboneRow('Activities', _state.activities));
    } else {
        _dom.storyMap.appendChild(createEmptyBackboneRow('Activities'));
    }

    // Steps row (the backbone)
    const stepsRow = el('div', 'steps-row');
    const stepsLabel = el('div', 'steps-row-spacer');
    stepsLabel.appendChild(el('span', 'row-type-label', { text: 'Steps' }));
    stepsRow.appendChild(stepsLabel);

    _state.columns.forEach(col => {
        if (col.partialMapId) {
            if (col._editingHidden) return;
            const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
            if (pm) {
                if (hasAnyExpanded && expandedIds.has(col.partialMapId)) {
                    pm.columns.forEach(pmCol => {
                        const card = createColumnCard(pmCol);
                        card.classList.add('partial-map-preview-col');
                        stepsRow.appendChild(card);
                    });
                } else {
                    const refEl = createPartialMapRef(col, pm);
                    if (editingPmId && col.partialMapId === editingPmId) {
                        refEl.classList.add('partial-map-ref-editing');
                    }
                    stepsRow.appendChild(refEl);
                }
            } else {
                stepsRow.appendChild(createColumnCard(col));
            }
        } else {
            const card = createColumnCard(col);
            if (editingColIds?.has(col.id)) {
                card.classList.add('partial-map-editing');
            }
            stepsRow.appendChild(card);
        }
    });

    for (let i = 0; i < PHANTOM_BUFFER; i++) {
        stepsRow.appendChild(createPhantomStep(i));
    }

    _dom.storyMap.appendChild(stepsRow);

    // Slices (releases) - render below steps
    _state.slices.forEach((slice, index) => {
        _dom.storyMap.appendChild(createSliceContainer(slice, index));
    });

    // Restore scroll position
    _dom.storyMapWrapper.scrollLeft = savedScrollLeft;
    _dom.storyMapWrapper.scrollTop = savedScrollTop;

    // Initialize Sortable for drag and drop (deferred to coalesce multiple renders)
    if (_sortableInitPending) cancelAnimationFrame(_sortableInitPending);
    _sortableInitPending = requestAnimationFrame(() => {
        _sortableInitPending = null;
        initSortable();
    });

    // Restore focus if user was editing
    if (savedFocus) {
        const textarea = _dom.storyMap.querySelector(savedFocus.selector);
        if (textarea) {
            textarea.focus();
            const len = textarea.value.length;
            const selStart = Math.min(savedFocus.selStart, len);
            const selEnd = Math.min(savedFocus.selEnd, len);
            textarea.setSelectionRange(selStart, selEnd);
        }
    }

    // Restore hover state to prevent button flicker on remote edits
    if (savedHover) {
        const el = _dom.storyMap.querySelector(savedHover.sel);
        if (el) {
            el.classList.add('card-hovered');
            el.addEventListener('mouseleave', () => el.classList.remove('card-hovered'), { once: true });
        }
    }

    _dom.storyMap.offsetHeight; // force reflow to flush no-transition state
    _dom.storyMap.classList.remove('notransition');

    uiRenderLegend();
    uiRenderPartialsList();
    _notepadUpdate();
    updateSelectionUI();
};

// Store Sortable instances to destroy on re-render
let sortableInstances = [];
let _sortableInitPending = null;

// Edge auto-scroll while dragging cards or steps. Sortable's built-in version only reacts within 30px
// of the edge of whatever element is under the pointer, which the fixed controls and selection toolbar
// cover. This measures from the map area's edges instead and speeds up the closer you get.
const AUTO_SCROLL_ZONE = 80;
const AUTO_SCROLL_MAX_SPEED = 30; // px per frame at (or past) the edge
let _SortableLib = null;
let autoScrollFrame = null;
let autoScrollPointer = null;

const trackDragPointer = (e) => {
    const point = e.touches ? e.touches[0] : e;
    if (point) autoScrollPointer = { x: point.clientX, y: point.clientY };
};

const edgeSpeed = (distance) => distance >= AUTO_SCROLL_ZONE
    ? 0
    : Math.ceil(AUTO_SCROLL_MAX_SPEED * Math.min(1, 1 - distance / AUTO_SCROLL_ZONE));

const stopDragAutoScroll = () => {
    document.removeEventListener('mousemove', trackDragPointer, true);
    document.removeEventListener('touchmove', trackDragPointer, true);
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
    autoScrollPointer = null;
};

const autoScrollTick = () => {
    // Stop if the drag ended without an onEnd (e.g. a re-render destroyed the Sortable mid-drag)
    if (!_SortableLib?.active) { stopDragAutoScroll(); return; }
    autoScrollFrame = requestAnimationFrame(autoScrollTick);
    if (!autoScrollPointer) return;

    const wrapper = _dom.storyMapWrapper;
    const rect = wrapper.getBoundingClientRect();
    const { x, y } = autoScrollPointer;
    const dx = edgeSpeed(rect.right - x) - edgeSpeed(x - rect.left);
    const dy = edgeSpeed(rect.bottom - y) - edgeSpeed(y - rect.top);
    if (!dx && !dy) return;

    // The drag clone sits inside the zoomed map, so it scrolls with it. Measure how far it moved
    // on screen and shift it back under the pointer (in its own, zoom-scaled units).
    const ghost = _SortableLib.ghost;
    const before = ghost?.getBoundingClientRect();
    wrapper.scrollLeft += dx;
    wrapper.scrollTop += dy;
    if (ghost && before) {
        const after = ghost.getBoundingClientRect();
        const moveX = after.left - before.left;
        const moveY = after.top - before.top;
        if (moveX || moveY) {
            const scale = ghost.offsetWidth ? after.width / ghost.offsetWidth : 1;
            const current = getComputedStyle(ghost).transform;
            const matrix = new DOMMatrix(current === 'none' ? undefined : current);
            matrix.e -= moveX / scale;
            matrix.f -= moveY / scale;
            ghost.style.transform = matrix.toString();
        }
    }
};

const startDragAutoScroll = () => {
    stopDragAutoScroll();
    document.addEventListener('mousemove', trackDragPointer, true);
    document.addEventListener('touchmove', trackDragPointer, { capture: true, passive: true });
    autoScrollFrame = requestAnimationFrame(autoScrollTick);
};

export const initSortable = async () => {
    const Sortable = await _ensureSortable();
    _SortableLib = Sortable;

    // Destroy previous instances
    sortableInstances.forEach(s => s.destroy());
    sortableInstances = [];

    // Don't enable drag-drop if map is locked
    if (!_isMapEditable()) {
        return;
    }

    const isSafari = _getIsSafari();

    // Make story cards sortable within and between columns
    document.querySelectorAll('.story-column:not(.phantom-column):not(.partial-map-ref-cell):not(.partial-map-preview-col)').forEach(column => {
        const sortable = Sortable.create(column, {
            group: 'stories',
            animation: 150,
            forceFallback: true,
            delay: 150,
            delayOnTouchOnly: true,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '.btn-add-story, .btn-expand, .btn-options, .options-menu',
            preventOnFilter: false,
            scroll: false, // replaced by startDragAutoScroll
            // Added on grab so Sortable's drag clone includes it; CSS only shows it on the clone
            onChoose: (evt) => {
                const ids = getMultiDragIds(evt.item.dataset.storyId);
                if (ids) evt.item.appendChild(el('span', 'multi-drag-badge', { text: `${ids.length}` }));
            },
            onUnchoose: (evt) => {
                evt.item.querySelector('.multi-drag-badge')?.remove();
            },
            onStart: (evt) => {
                startDragAutoScroll();
                const multiIds = getMultiDragIds(evt.item.dataset.storyId);
                if (multiIds) {
                    multiIds.filter(id => id !== evt.item.dataset.storyId).forEach(id => {
                        _dom.storyMap.querySelector(`.story-card[data-story-id="${id}"]`)?.classList.add('multi-drag-pending');
                    });
                }
                if (_broadcastDragStart) {
                    const storyId = evt.item.dataset.storyId;
                    const sliceId = evt.from.dataset.sliceId;
                    const columnId = evt.from.dataset.columnId;
                    const rowType = evt.from.dataset.rowType;
                    let story;
                    if (rowType === 'users') {
                        story = _state.users[columnId]?.find(s => s.id === storyId);
                    } else if (rowType === 'activities') {
                        story = _state.activities[columnId]?.find(s => s.id === storyId);
                    } else {
                        const slice = _state.slices.find(s => s.id === sliceId);
                        story = slice?.stories[columnId]?.find(s => s.id === storyId);
                    }
                    _broadcastDragStart({ type: 'story', storyId, color: story?.color || '#fef08a' });
                }
            },
            onEnd: (evt) => {
                stopDragAutoScroll();
                if (_broadcastDragEnd) _broadcastDragEnd();
                _dom.storyMap.querySelectorAll('.multi-drag-pending').forEach(card => card.classList.remove('multi-drag-pending'));
                // If a pinch gesture is active, revert the card to its original position
                if (_getIsPinching && _getIsPinching()) {
                    const ref = evt.from.children[evt.oldIndex];
                    evt.from.insertBefore(evt.item, ref || null);
                    return;
                }
                const storyId = evt.item.dataset.storyId;
                const fromColumnId = evt.from.dataset.columnId;
                const fromSliceId = evt.from.dataset.sliceId;
                const fromRowType = evt.from.dataset.rowType || null;
                const toColumnId = evt.to.dataset.columnId;
                const toSliceId = evt.to.dataset.sliceId;
                const toRowType = evt.to.dataset.rowType || null;
                const toIndex = evt.newIndex;

                if (fromColumnId !== toColumnId || fromSliceId !== toSliceId || fromRowType !== toRowType || evt.oldIndex !== evt.newIndex) {
                    const multiIds = getMultiDragIds(storyId);
                    if (multiIds && moveSelectedStories(multiIds, evt.item, toColumnId, toSliceId, toRowType)) {
                        // The browser can still fire a click on the dropped card, which would reset the selection
                        const swallowClick = (e) => { e.preventDefault(); e.stopPropagation(); };
                        document.addEventListener('click', swallowClick, true);
                        setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
                    } else {
                        moveStory(storyId, fromColumnId, fromSliceId, toColumnId, toSliceId, toIndex, fromRowType, toRowType);
                    }
                }
            }
        });
        sortableInstances.push(sortable);
    });

    // Make release slices sortable (not backbone rows)
    const sliceContainers = document.querySelectorAll('.slice-container');
    if (sliceContainers.length > 0) {
        const sortable = Sortable.create(_dom.storyMap, {
            animation: 150,
            handle: '.slice-drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.slice-container',
            onEnd: () => {
                const sliceContainers = _dom.storyMap.querySelectorAll('.slice-container');

                const newSliceOrder = [...sliceContainers].map(el =>
                    _state.slices.find(s => s.id === el.dataset.sliceId)
                ).filter(Boolean);

                const orderChanged = newSliceOrder.some((slice, i) => slice.id !== _state.slices[i]?.id);
                if (!orderChanged) return;

                _pushUndo();
                _state.slices = newSliceOrder;
                _logEvent?.('Reordered slices');
                _renderAndSave();
            }
        });
        sortableInstances.push(sortable);
    }

    // Make steps (columns) sortable - moves entire column
    const stepsRow = document.querySelector('.steps-row');
    if (stepsRow) {
        let isDragging = false;
        let dragColumnId = null;
        let columnStartX = new Map();
        let startScrollLeft = 0;
        let animFrame = null;

        const captureStartPositions = () => {
            columnStartX.clear();
            startScrollLeft = _dom.storyMapWrapper.scrollLeft;
            _state.columns.forEach(col => {
                const firstStoryCol = document.querySelector(`.story-column[data-column-id="${col.id}"]`);
                if (firstStoryCol) {
                    columnStartX.set(col.id, firstStoryCol.getBoundingClientRect().left);
                }
            });
        };

        const updateColumnPositions = () => {
            if (!isDragging) return;

            stepsRow.querySelectorAll('.step').forEach(step => {
                const columnId = step.dataset.columnId;
                const startX = columnStartX.get(columnId);
                if (startX === undefined) return;

                const stepRect = step.getBoundingClientRect();
                // Auto-scroll moves the step and its cards together, so add the scroll back in
                const deltaX = stepRect.left - startX + (_dom.storyMapWrapper.scrollLeft - startScrollLeft);

                document.querySelectorAll(`.story-column[data-column-id="${columnId}"]`).forEach(el => {
                    el.style.transform = `translateX(${deltaX}px)`;
                });
            });

            animFrame = requestAnimationFrame(updateColumnPositions);
        };

        const sortable = Sortable.create(stepsRow, {
            animation: 150,
            forceFallback: true,
            handle: '.step-drag-handle',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            draggable: '.step',
            filter: '.steps-row-spacer, .phantom-step, .partial-map-ref, .partial-map-preview-col',
            scroll: false, // replaced by startDragAutoScroll
            onStart: (evt) => {
                startDragAutoScroll();
                isDragging = true;
                dragColumnId = evt.item.dataset.columnId;
                captureStartPositions();

                if (_broadcastDragStart) {
                    const col = _state.columns.find(c => c.id === dragColumnId);
                    _broadcastDragStart({ type: 'column', columnId: dragColumnId, color: col?.color || '#86efac' });
                }

                evt.item.classList.add('column-being-dragged');
                document.querySelectorAll(`.story-column[data-column-id="${dragColumnId}"] .story-card`).forEach(card => {
                    card.classList.add('column-being-dragged');
                });

                animFrame = requestAnimationFrame(updateColumnPositions);
            },
            onEnd: () => {
                stopDragAutoScroll();
                if (_broadcastDragEnd) _broadcastDragEnd();
                isDragging = false;

                if (animFrame) {
                    cancelAnimationFrame(animFrame);
                    animFrame = null;
                }

                document.querySelectorAll('.story-column').forEach(el => {
                    el.style.transform = '';
                });
                document.querySelectorAll('.column-being-dragged').forEach(el => {
                    el.classList.remove('column-being-dragged');
                });

                const stepElements = stepsRow.querySelectorAll('.step, .step-placeholder, .partial-map-ref');
                const visibleOrder = [...stepElements].map(el =>
                    _state.columns.find(c => c.id === el.dataset.columnId)
                ).filter(Boolean);

                // Re-insert hidden columns (e.g. _editingHidden ref cols) at their original positions
                const visibleIds = new Set(visibleOrder.map(c => c.id));
                const newOrder = [...visibleOrder];
                _state.columns.forEach((col, i) => {
                    if (!visibleIds.has(col.id)) {
                        // Find insertion point: right before the next visible column that was after it
                        const nextVisible = _state.columns.slice(i + 1).find(c => visibleIds.has(c.id));
                        const insertAt = nextVisible ? newOrder.indexOf(nextVisible) : newOrder.length;
                        newOrder.splice(insertAt, 0, col);
                    }
                });

                const orderChanged = newOrder.some((col, i) => col.id !== _state.columns[i]?.id);
                if (!orderChanged) {
                    dragColumnId = null;
                    return;
                }

                _pushUndo();
                _state.columns = newOrder;
                _logEvent?.('Reordered steps');
                dragColumnId = null;
                _renderAndSave();
            }
        });
        sortableInstances.push(sortable);
    }
};

// =============================================================================
// Column Selection & Duplication
// =============================================================================

import { createColumn as _createColumn, createStory as _createStory, createSlice as _createSlice, selection, clearSelection } from '/src/core/state.js';

export const handleColumnSelection = (columnId, shiftKey, cardInfo = { type: 'step' }) => {
    if (!_isMapEditable()) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;

    if (shiftKey && selection.anchorId) {
        // Check if the target card is already selected (toggle off)
        const isAlreadySelected = selection.clickedCards.some(c =>
            c.columnId === columnId && c.type === cardInfo.type &&
            (c.type === 'step' || c.storyId === cardInfo.storyId)
        );

        if (isAlreadySelected && columnId !== selection.anchorId) {
            // Remove the card from selection
            selection.clickedCards = selection.clickedCards.filter(c =>
                !(c.columnId === columnId && c.type === cardInfo.type &&
                  (c.type === 'step' || c.storyId === cardInfo.storyId))
            );
            selection.columnIds = selection.columnIds.filter(id => id !== columnId);
            if (selection.clickedCards.length === 0) { clearSelection(); }
        } else {
            const anchorIdx = _state.columns.findIndex(c => c.id === selection.anchorId);
            const targetIdx = _state.columns.findIndex(c => c.id === columnId);
            if (anchorIdx === -1 || targetIdx === -1) return;

            // Extend range to cover existing selection + new target
            const currentIndices = selection.columnIds.map(id => _state.columns.findIndex(c => c.id === id)).filter(i => i !== -1);
            currentIndices.push(anchorIdx, targetIdx);
            const start = Math.min(...currentIndices);
            const end = Math.max(...currentIndices);
            selection.columnIds = _state.columns.slice(start, end + 1).map(c => c.id);

            // Rebuild clickedCards based on anchor card type
            const anchorCard = selection.clickedCards.find(c => c.columnId === selection.anchorId);
            const anchorType = anchorCard?.type || 'step';

            if (anchorType === 'step') {
                // Step mode: every column in range gets a step entry
                selection.clickedCards = selection.columnIds.map(colId => ({ columnId: colId, type: 'step' }));
            } else {
                // Story mode: keep previous clickedCards within range, add new target
                const rangeColIds = new Set(selection.columnIds);
                const kept = selection.clickedCards.filter(c => rangeColIds.has(c.columnId));
                const alreadyPresent = kept.some(c =>
                    c.columnId === columnId && c.type === cardInfo.type &&
                    (c.type === 'step' || c.storyId === cardInfo.storyId)
                );
                if (!alreadyPresent) {
                    kept.push({ columnId, ...cardInfo });
                }
                selection.clickedCards = kept;
            }
        }
    } else {
        if (selection.columnIds.length === 1 && selection.columnIds[0] === columnId) {
            clearSelection();
        } else {
            selection.columnIds = [columnId];
            selection.anchorId = columnId;
            selection.clickedCards = [{ columnId, ...cardInfo }];
        }
    }

    updateSelectionUI();
};

const createSplitButton = (btnClass, modes, onModeChange) => {
    const splitBtn = el('div', 'selection-toolbar-split');
    let activeAction = modes[0].action;
    const setMainLabel = (mode) => {
        if (mode.html) mainBtn.innerHTML = mode.html;
        else mainBtn.textContent = mode.label;
    };
    const mainBtn = el('button', btnClass);
    if (modes[0].html) mainBtn.innerHTML = modes[0].html;
    else mainBtn.textContent = modes[0].label;
    mainBtn.addEventListener('click', () => activeAction());
    const arrowBtn = el('button', 'selection-toolbar-split-arrow ' + btnClass + '-arrow', { html: '&#9662;' });
    const dropdown = el('div', 'selection-toolbar-split-menu');

    modes.forEach((mode, i) => {
        const option = el('button', 'selection-toolbar-split-option', { text: mode.label });
        if (mode.action === activeAction) option.classList.add('active');
        option.addEventListener('click', () => {
            activeAction = mode.action;
            setMainLabel(mode);
            dropdown.querySelectorAll('.selection-toolbar-split-option').forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            dropdown.classList.remove('visible');
            if (onModeChange) onModeChange(i);
        });
        dropdown.appendChild(option);
    });

    arrowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close any other open split menus
        document.querySelectorAll('.selection-toolbar-split-menu.visible').forEach(m => {
            if (m !== dropdown) m.classList.remove('visible');
        });
        const opening = !dropdown.classList.contains('visible');
        dropdown.classList.toggle('visible');
        if (opening) {
            const close = (ev) => {
                if (!splitBtn.contains(ev.target)) {
                    dropdown.classList.remove('visible');
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        }
    });
    splitBtn.append(mainBtn, arrowBtn, dropdown);
    return splitBtn;
};

const updateSelectionHighlights = () => {
    document.querySelectorAll('.column-selected').forEach(elem => elem.classList.remove('column-selected'));
    document.querySelectorAll('.card-selected').forEach(elem => elem.classList.remove('card-selected'));

    const allClicksAreSteps = selection.clickedCards.length > 0 && selection.clickedCards.every(c => c.type === 'step');

    for (const card of selection.clickedCards) {
        if (card.type === 'step') {
            const step = _dom.storyMap.querySelector(`.step[data-column-id="${card.columnId}"], .step-placeholder[data-column-id="${card.columnId}"]`);
            if (step) step.classList.add('column-selected');
        } else if (card.type === 'story' && card.storyId) {
            const storyCard = _dom.storyMap.querySelector(`.story-card[data-story-id="${card.storyId}"]`);
            if (storyCard) storyCard.classList.add('card-selected');
        }
    }

    // Faint column background only when column-level action is active
    if (selection.columnHighlight) {
        for (const colId of selection.columnIds) {
            const step = _dom.storyMap.querySelector(`.step[data-column-id="${colId}"], .step-placeholder[data-column-id="${colId}"]`);
            if (step) step.classList.add('column-selected');
            _dom.storyMap.querySelectorAll(`.story-column[data-column-id="${colId}"]`).forEach(elem => {
                elem.classList.add('column-selected');
            });
        }
    }
};

let _preserveToolbar = false;
export const setPreserveToolbar = (v) => { _preserveToolbar = v; };

export const updateSelectionUI = () => {
    const validColumnIds = new Set(_state.columns.map(c => c.id));
    selection.columnIds = selection.columnIds.filter(id => validColumnIds.has(id));
    selection.clickedCards = selection.clickedCards.filter(c => validColumnIds.has(c.columnId));
    if (selection.columnIds.length === 0) { selection.anchorId = null; }

    updateSelectionHighlights();

    if (_preserveToolbar) { _preserveToolbar = false; return; }
    document.querySelector('.selection-toolbar')?.remove();

    if (selection.columnIds.length > 0 && !window.matchMedia('(pointer: coarse)').matches) {
        const count = selection.columnIds.length;
        const cardCount = selection.clickedCards.length;
        const columnsText = `${count} column${count > 1 ? 's' : ''}`;
        const toolbar = el('div', 'selection-toolbar');
        const label = el('span', 'selection-toolbar-label', {
            text: cardCount ? `${cardCount} card${cardCount > 1 ? 's' : ''}, ${columnsText} selected` : `${columnsText} selected`
        });

        const items = [label];

        if (count === 1 && cardCount <= 1) {
            const hint = el('span', 'selection-toolbar-hint', { text: 'Shift+click for more' });
            items.push(hint);
        }

        // Create Map Partial / Replace with Partial split button (when 2+ non-ref columns selected, not editing a partial)
        if (!partialMapEditState.activeId) {
            const selectedCols = _state.columns.filter(c => selection.columnIds.includes(c.id));
            const nonRefSelected = selectedCols.filter(c => !c.partialMapId);
            if (nonRefSelected.length >= 2) {
                const nonRefIds = nonRefSelected.map(c => c.id);
                const partialIcon = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="#fef08a" stroke="#d4aa00" stroke-width="1"/><rect x="14" y="3" width="7" height="7" rx="1" fill="#fecdd3" stroke="#e88a9a" stroke-width="1"/><rect x="3" y="14" width="7" height="7" rx="1" fill="#a5f3fc" stroke="#67c5d6" stroke-width="1"/><rect x="14" y="14" width="7" height="7" rx="1" fill="#14b8a6" stroke="#0d9488" stroke-width="1"/></svg>';
                const modes = [
                    { label: 'Create Map Partial', html: partialIcon + 'Create Map Partial', action: async () => {
                        const name = await showPrompt('Name this Map Partial:');
                        if (name === null) return;
                        if (_createPartialMap) _createPartialMap(name || 'Untitled', nonRefIds);
                    }},
                ];
                _state.partialMaps.forEach(pm => {
                    modes.push({ label: `Replace with "${pm.name}"`, html: partialIcon + `Replace with "${pm.name}"`, action: () => {
                        if (_replaceWithPartial) _replaceWithPartial(pm.id, nonRefIds);
                    }});
                });
                items.push(createSplitButton('selection-toolbar-partial', modes));
            }
        }

        const cardS = cardCount > 1 ? 's' : '';
        const s = count > 1 ? 's' : '';
        const onColumnModeChange = (modeIndex) => {
            selection.columnHighlight = modeIndex === 1;
            updateSelectionHighlights();
        };
        items.push(createSplitButton('selection-toolbar-duplicate', [
            { label: `Duplicate Card${cardS}`, action: duplicateCards },
            { label: `Duplicate Column${s}`, action: duplicateColumns },
        ], onColumnModeChange));

        items.push(createSplitButton('selection-toolbar-delete', [
            { label: `Delete Card${cardS}`, action: deleteSelectedCards },
            { label: `Delete Column${s}`, action: deleteSelectedColumns },
        ], onColumnModeChange));

        // Detect common color/status across selected cards
        const selectedColors = new Set();
        const selectedStatuses = new Set();
        for (const card of selection.clickedCards) {
            const item = getItemForCard(card);
            if (item) {
                const defaultColor = card.type === 'step' ? DEFAULT_CARD_COLORS.Activities : DEFAULT_CARD_COLORS.story;
                selectedColors.add(item.color || defaultColor);
                selectedStatuses.add(item.status || null);
            }
        }
        const commonColor = selectedColors.size === 1 ? [...selectedColors][0] : undefined;
        const commonStatus = selectedStatuses.size === 1 ? [...selectedStatuses][0] : undefined;

        // Bulk Color button
        const colorGroup = el('div', 'selection-toolbar-dropdown-group');
        const colorBtn = el('button', 'selection-toolbar-action selection-toolbar-color', { text: 'Color' });
        const colorDropdown = el('div', 'selection-toolbar-dropdown');
        const noneColorSwatch = el('button', 'selection-toolbar-color-swatch selection-toolbar-swatch-none', { text: '\u00d7', title: 'None' });
        noneColorSwatch.addEventListener('click', () => { bulkChangeColor(null); colorDropdown.classList.remove('visible'); });
        colorDropdown.appendChild(noneColorSwatch);
        Object.entries(CARD_COLORS).forEach(([name, hex]) => {
            const swatch = el('button', 'selection-toolbar-color-swatch', { title: name });
            swatch.style.backgroundColor = hex;
            if (commonColor === hex) swatch.classList.add('swatch-active');
            swatch.addEventListener('click', () => { bulkChangeColor(hex); colorDropdown.classList.remove('visible'); });
            colorDropdown.appendChild(swatch);
        });
        colorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.selection-toolbar-dropdown.visible').forEach(d => { if (d !== colorDropdown) d.classList.remove('visible'); });
            colorDropdown.classList.toggle('visible');
        });
        colorGroup.append(colorBtn, colorDropdown);
        items.push(colorGroup);

        // Bulk Status button
        const statusGroup = el('div', 'selection-toolbar-dropdown-group');
        const statusBtn = el('button', 'selection-toolbar-action selection-toolbar-status', { text: 'Status' });
        const statusDropdown = el('div', 'selection-toolbar-dropdown selection-toolbar-status-dropdown');
        const noneRow = el('button', 'selection-toolbar-status-row');
        if (commonStatus === null) noneRow.classList.add('active');
        const noneDot = el('span', 'selection-toolbar-status-dot');
        noneDot.style.backgroundColor = '#555';
        noneRow.append(noneDot, el('span', null, { text: 'No Status' }));
        noneRow.addEventListener('click', () => { bulkChangeStatus(null); statusDropdown.classList.remove('visible'); });
        statusDropdown.appendChild(noneRow);
        Object.entries(STATUS_OPTIONS).forEach(([key, { label, color }]) => {
            const row = el('button', 'selection-toolbar-status-row');
            if (commonStatus === key) row.classList.add('active');
            const dot = el('span', 'selection-toolbar-status-dot');
            dot.style.backgroundColor = color;
            row.append(dot, el('span', null, { text: label }));
            row.addEventListener('click', () => { bulkChangeStatus(key); statusDropdown.classList.remove('visible'); });
            statusDropdown.appendChild(row);
        });
        statusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.selection-toolbar-dropdown.visible').forEach(d => { if (d !== statusDropdown) d.classList.remove('visible'); });
            statusDropdown.classList.toggle('visible');
        });
        statusGroup.append(statusBtn, statusDropdown);
        items.push(statusGroup);

        // Bulk Tags button
        const tagsGroup = el('div', 'selection-toolbar-dropdown-group');
        const tagsBtn = el('button', 'selection-toolbar-action selection-toolbar-tags', { text: 'Tags' });
        const tagsDropdown = el('div', 'selection-toolbar-dropdown selection-toolbar-tags-dropdown');

        const buildTagsDropdown = () => {
            tagsDropdown.innerHTML = '';

            // Scrollable container for tag sections
            const scrollArea = el('div', 'selection-toolbar-tags-scroll');

            // Collect tags currently on selected cards
            const selectedTags = new Map();
            for (const card of selection.clickedCards) {
                const item = getItemForCard(card);
                if (item?.tags) item.tags.forEach(t => selectedTags.set(t, (selectedTags.get(t) || 0) + 1));
            }
            const totalSelected = selection.clickedCards.length;

            // Show tags already on selection (with remove)
            if (selectedTags.size > 0) {
                const currentSection = el('div', 'selection-toolbar-tags-section');
                for (const [tag, count] of selectedTags) {
                    const row = el('div', 'selection-toolbar-tag-row');
                    const label = el('span', 'selection-toolbar-tag-label', {
                        text: count < totalSelected ? `${tag} (${count})` : tag
                    });
                    const removeBtn = el('button', 'selection-toolbar-tag-remove', { text: '\u00d7', title: 'Remove from selected' });
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        bulkRemoveTag(tag);
                        buildTagsDropdown();
                    });
                    row.append(label, removeBtn);
                    currentSection.appendChild(row);
                }
                scrollArea.appendChild(currentSection);
                scrollArea.appendChild(el('div', 'selection-toolbar-tags-divider'));
            }

            // Show all map tags to add
            const allTags = getAllTagsInMap().filter(t => !selectedTags.has(t) || selectedTags.get(t) < totalSelected);
            if (allTags.length > 0) {
                const addSection = el('div', 'selection-toolbar-tags-section');
                allTags.forEach(tag => {
                    const btn = el('button', 'selection-toolbar-tag-option', { text: tag });
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        bulkAddTag(tag);
                        buildTagsDropdown();
                    });
                    addSection.appendChild(btn);
                });
                scrollArea.appendChild(addSection);
            }

            tagsDropdown.appendChild(scrollArea);

            // Input to add a new tag (pinned at bottom)
            const inputRow = el('div', 'selection-toolbar-tag-input-row');
            const tagInput = el('input', 'selection-toolbar-tag-input');
            tagInput.type = 'text';
            tagInput.placeholder = 'New tag...';
            tagInput.addEventListener('click', (e) => e.stopPropagation());
            tagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    bulkAddTag(tagInput.value);
                    buildTagsDropdown();
                }
            });
            inputRow.appendChild(tagInput);
            tagsDropdown.appendChild(inputRow);
        };

        tagsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.selection-toolbar-dropdown.visible').forEach(d => { if (d !== tagsDropdown) d.classList.remove('visible'); });
            const opening = !tagsDropdown.classList.contains('visible');
            tagsDropdown.classList.toggle('visible');
            if (opening) {
                buildTagsDropdown();
                requestAnimationFrame(() => {
                    tagsDropdown.querySelector('.selection-toolbar-tag-input')?.focus();
                });
            } else {
                _preserveToolbar = true;
                _renderAndSave();
            }
        });
        tagsGroup.append(tagsBtn, tagsDropdown);
        items.push(tagsGroup);

        const clearBtn = el('button', 'selection-toolbar-clear', { text: '\u00d7' });
        clearBtn.addEventListener('click', () => {
            clearSelection();
            updateSelectionUI();
        });
        items.push(clearBtn);

        toolbar.append(...items);
        document.body.appendChild(toolbar);
    }
};

export const duplicateColumns = () => {
    if (selection.columnIds.length === 0) return;
    if (!_isMapEditable()) return;

    // Snapshot selected column IDs in state.columns order (exclude ref columns)
    const selectedIds = _state.columns
        .filter(c => selection.columnIds.includes(c.id) && !c.partialMapId)
        .map(c => c.id);

    if (selectedIds.length === 0) return;

    _pushUndo();

    const lastSelectedIdx = Math.max(
        ...selectedIds.map(id => _state.columns.findIndex(c => c.id === id))
    );

    // Create spacer column + deep copies
    const spacerCol = { id: generateId(), name: '', color: null, url: null, hidden: true, status: null, tags: [] };
    const newColumns = [spacerCol];
    const idMap = {};

    selectedIds.forEach(oldId => {
        const original = _state.columns.find(c => c.id === oldId);
        const newCol = { ...original, id: generateId(), tags: [...(original.tags || [])] };
        idMap[oldId] = newCol.id;
        newColumns.push(newCol);
    });

    _state.columns.splice(lastSelectedIdx + 1, 0, ...newColumns);

    // Copy users/activities for new columns
    _state.users[spacerCol.id] = [];
    _state.activities[spacerCol.id] = [];
    selectedIds.forEach(oldId => {
        const newId = idMap[oldId];
        _state.users[newId] = (_state.users[oldId] || []).map(card => ({ ...card, id: generateId(), tags: [...(card.tags || [])] }));
        _state.activities[newId] = (_state.activities[oldId] || []).map(card => ({ ...card, id: generateId(), tags: [...(card.tags || [])] }));
    });

    // Copy stories for each slice
    _state.slices.forEach(slice => {
        slice.stories[spacerCol.id] = [];

        selectedIds.forEach(oldId => {
            const newId = idMap[oldId];
            const originalStories = slice.stories[oldId] || [];
            slice.stories[newId] = originalStories.map(story => ({ ...story, id: generateId(), tags: [...(story.tags || [])] }));
        });
    });

    clearSelection();
    _renderAndSave();

    // Scroll to first new column
    requestAnimationFrame(() => {
        const firstCopiedCol = newColumns[1];
        if (firstCopiedCol) {
            const newStep = _dom.storyMap.querySelector(
                `.step[data-column-id="${firstCopiedCol.id}"], .step-placeholder[data-column-id="${firstCopiedCol.id}"]`
            );
            if (newStep) _scrollElementIntoView(newStep);
        }
    });
};

export const duplicateCards = () => {
    if (selection.clickedCards.length === 0) return;
    if (!_isMapEditable()) return;

    _pushUndo();

    // Group clicked cards by columnId
    const grouped = new Map();
    for (const card of selection.clickedCards) {
        if (!grouped.has(card.columnId)) grouped.set(card.columnId, []);
        grouped.get(card.columnId).push(card);
    }

    const orderedColumnIds = _state.columns
        .map(c => c.id)
        .filter(id => grouped.has(id));

    if (orderedColumnIds.length === 0) return;

    const lastSelectedIdx = Math.max(
        ...orderedColumnIds.map(id => _state.columns.findIndex(c => c.id === id))
    );

    // Create spacer + new columns
    const spacerCol = { id: generateId(), name: '', color: null, url: null, hidden: true, status: null, tags: [] };
    const newColumns = [spacerCol];

    const columnCardMap = new Map(); // newColId -> cards from that group

    orderedColumnIds.forEach(oldId => {
        const cards = grouped.get(oldId);
        const hasStepClick = cards.some(c => c.type === 'step');
        const original = _state.columns.find(c => c.id === oldId);

        const newCol = hasStepClick
            ? { ...original, id: generateId(), tags: [...(original.tags || [])] }
            : { id: generateId(), name: '', color: null, url: null, hidden: true, status: null, tags: [] };

        columnCardMap.set(newCol.id, { oldId, cards });
        newColumns.push(newCol);
    });

    _state.columns.splice(lastSelectedIdx + 1, 0, ...newColumns);

    // Build users/activities/stories for new columns
    _state.users[spacerCol.id] = [];
    _state.activities[spacerCol.id] = [];

    for (const newCol of newColumns.slice(1)) {
        const { oldId, cards } = columnCardMap.get(newCol.id);

        // Copy backbone row cards if any story clicks target them
        for (const [rowKey, cardMap] of [['users', _state.users], ['activities', _state.activities]]) {
            const rowClicks = cards.filter(c => c.type === 'story' && c.rowType === rowKey);
            if (rowClicks.length > 0) {
                const originalCards = cardMap[oldId] || [];
                cardMap[newCol.id] = originalCards
                    .filter(s => rowClicks.some(c => c.storyId === s.id))
                    .map(s => ({ ...s, id: generateId(), tags: [...(s.tags || [])] }));
            } else {
                cardMap[newCol.id] = [];
            }
        }
    }

    _state.slices.forEach(slice => {
        slice.stories[spacerCol.id] = [];

        for (const newCol of newColumns.slice(1)) {
            const { oldId, cards } = columnCardMap.get(newCol.id);
            const storyClicks = cards.filter(c => c.type === 'story' && c.sliceId === slice.id);

            if (storyClicks.length > 0) {
                const originalStories = slice.stories[oldId] || [];
                slice.stories[newCol.id] = originalStories
                    .filter(s => storyClicks.some(c => c.storyId === s.id))
                    .map(s => ({ ...s, id: generateId(), tags: [...(s.tags || [])] }));
            } else {
                slice.stories[newCol.id] = [];
            }
        }
    });

    const dupCount = selection.clickedCards.length;
    const newColIds = newColumns.slice(1).map(c => c.id);
    _logEvent?.(`Duplicated ${dupCount} card${dupCount > 1 ? 's' : ''}`, newColIds);
    clearSelection();
    _renderAndSave();

    // Scroll to first new column
    requestAnimationFrame(() => {
        const firstCopiedCol = newColumns[1];
        if (firstCopiedCol) {
            const newStep = _dom.storyMap.querySelector(
                `.step[data-column-id="${firstCopiedCol.id}"], .step-placeholder[data-column-id="${firstCopiedCol.id}"]`
            );
            if (newStep) _scrollElementIntoView(newStep);
        }
    });
};

export const deleteSelectedColumns = async () => {
    if (selection.columnIds.length === 0) return;
    if (!_isMapEditable()) return;

    const selectedCols = _state.columns.filter(c => selection.columnIds.includes(c.id));
    const regularIds = selectedCols.filter(c => !c.partialMapId).map(c => c.id);
    const refCols = selectedCols.filter(c => c.partialMapId);

    if (regularIds.length === 0 && refCols.length === 0) return;

    // Check which ref columns are the last reference to their partial
    const partialsToRemove = [];
    for (const ref of refCols) {
        const otherRefs = _state.columns.filter(c =>
            c.partialMapId === ref.partialMapId && !selection.columnIds.includes(c.id)
        );
        if (otherRefs.length === 0) {
            const pm = _state.partialMaps.find(p => p.id === ref.partialMapId);
            if (pm && !partialsToRemove.find(p => p.id === pm.id)) {
                partialsToRemove.push(pm);
            }
        }
    }

    const remaining = _state.columns.filter(c => !c.partialMapId).length - regularIds.length;
    if (remaining < 1 && refCols.length === 0) {
        await showAlert('Cannot delete all columns.');
        return;
    }

    // Build confirmation message
    const parts = [];
    const totalCols = regularIds.length + refCols.length;
    parts.push(`Delete ${totalCols} column${totalCols > 1 ? 's' : ''}${regularIds.length > 0 ? ' and all their stories' : ''}?`);
    if (partialsToRemove.length > 0) {
        const names = partialsToRemove.map(p => `"${p.name || 'Untitled'}"`).join(', ');
        parts.push(`\nThis will remove partial${partialsToRemove.length > 1 ? 's' : ''} ${names} from the partials list. You can undo this.`);
    }
    if (!await showConfirm(parts.join(''))) return;

    _pushUndo();

    // Delete regular columns
    _state.columns = _state.columns.filter(c => !regularIds.includes(c.id));
    regularIds.forEach(id => {
        delete _state.users[id];
        delete _state.activities[id];
    });
    _state.slices.forEach(slice => {
        regularIds.forEach(id => delete slice.stories[id]);
    });

    // Delete ref columns and their partials
    const refIds = refCols.map(c => c.id);
    // Transfer partialMapOrigin to surviving refs before deletion
    for (const ref of refCols) {
        if (ref.partialMapOrigin) {
            const survivor = _state.columns.find(c =>
                c.partialMapId === ref.partialMapId && !refIds.includes(c.id)
            );
            if (survivor) survivor.partialMapOrigin = true;
        }
    }
    _state.columns = _state.columns.filter(c => !refIds.includes(c.id));
    refIds.forEach(id => {
        delete _state.users[id];
        delete _state.activities[id];
        _state.slices.forEach(slice => delete slice.stories[id]);
    });
    for (const pm of partialsToRemove) {
        _state.partialMaps = _state.partialMaps.filter(p => p.id !== pm.id);
        if (partialMapEditState.activeId === pm.id) {
            partialMapEditState.activeId = null;
        }
    }

    // Ensure at least one column remains
    if (_state.columns.filter(c => !c.partialMapId).length === 0) {
        const col = _createColumn('New Step', CARD_COLORS.green, null, false);
        _state.columns.push(col);
        _state.users[col.id] = [];
        _state.activities[col.id] = [];
        _state.slices.forEach(slice => slice.stories[col.id] = []);
    }

    _logEvent?.(`Deleted ${totalCols} step${totalCols > 1 ? 's' : ''}`);
    clearSelection();
    _renderAndSave();
};

export const deleteSelectedCards = async () => {
    if (selection.clickedCards.length === 0) return;
    if (!_isMapEditable()) return;

    const stepClicks = selection.clickedCards.filter(c => c.type === 'step');
    const storyClicks = selection.clickedCards.filter(c => c.type === 'story');

    const cardCount = stepClicks.length + storyClicks.length;
    if (cardCount === 0) return;
    if (!await showConfirm(`Delete ${cardCount} card${cardCount > 1 ? 's' : ''}?`)) return;

    _pushUndo();

    // Delete step cards: reset to hidden/empty
    for (const click of stepClicks) {
        const col = _state.columns.find(c => c.id === click.columnId);
        if (col) {
            col.name = '';
            col.color = null;
            col.url = null;
            col.hidden = true;
            col.status = null;
            col.tags = [];
        }
    }

    // Delete story cards (from users, activities, and slices)
    const storyIds = new Set(storyClicks.map(c => c.storyId));
    for (const colId of Object.keys(_state.users)) {
        _state.users[colId] = _state.users[colId].filter(s => !storyIds.has(s.id));
    }
    for (const colId of Object.keys(_state.activities)) {
        _state.activities[colId] = _state.activities[colId].filter(s => !storyIds.has(s.id));
    }
    _state.slices.forEach(slice => {
        for (const colId of Object.keys(slice.stories)) {
            slice.stories[colId] = slice.stories[colId].filter(s => !storyIds.has(s.id));
        }
    });

    // Remove columns that are now completely empty (hidden step + no content)
    const emptyColIds = stepClicks
        .map(c => c.columnId)
        .filter(colId => {
            const col = _state.columns.find(c => c.id === colId);
            if (!col || !col.hidden) return false;
            if ((_state.users[colId] || []).length > 0) return false;
            if ((_state.activities[colId] || []).length > 0) return false;
            return !_state.slices.some(slice => (slice.stories[colId] || []).length > 0);
        });

    if (emptyColIds.length > 0) {
        const nonRefCount = _state.columns.filter(c => !c.partialMapId).length;
        if (nonRefCount - emptyColIds.length >= 1) {
            _state.columns = _state.columns.filter(c => !emptyColIds.includes(c.id));
            emptyColIds.forEach(id => {
                delete _state.users[id];
                delete _state.activities[id];
                _state.slices.forEach(slice => delete slice.stories[id]);
            });
        }
    }

    _logEvent?.(`Deleted ${cardCount} card${cardCount > 1 ? 's' : ''}`);
    clearSelection();
    _renderAndSave();
};

// =============================================================================
// Bulk Operations
// =============================================================================

const getItemForCard = (card) => {
    if (card.type === 'step') {
        return _state.columns.find(c => c.id === card.columnId);
    } else if (card.type === 'story' && card.storyId) {
        // Check users and activities first
        const usersCards = _state.users[card.columnId];
        if (usersCards) {
            const found = usersCards.find(s => s.id === card.storyId);
            if (found) return found;
        }
        const activitiesCards = _state.activities[card.columnId];
        if (activitiesCards) {
            const found = activitiesCards.find(s => s.id === card.storyId);
            if (found) return found;
        }
        for (const slice of _state.slices) {
            const stories = slice.stories[card.columnId];
            if (stories) {
                const found = stories.find(s => s.id === card.storyId);
                if (found) return found;
            }
        }
    }
    return null;
};

const getSelectedIds = () => selection.clickedCards.map(c => c.type === 'step' ? c.columnId : c.storyId).filter(Boolean);

const bulkChangeColor = (color) => {
    if (selection.clickedCards.length === 0) return;
    _pushUndo();
    const n = selection.clickedCards.length;
    const ids = getSelectedIds();
    for (const card of selection.clickedCards) {
        const item = getItemForCard(card);
        if (item) {
            item.color = color;
            const domEl = card.type === 'step'
                ? _dom.storyMap.querySelector(`.step[data-column-id="${card.columnId}"]`)
                : _dom.storyMap.querySelector(`.story-card[data-story-id="${card.storyId}"]`);
            if (domEl) patchCard(domEl, item);
        }
    }
    _logEvent?.(`Changed color on ${n} card${n > 1 ? 's' : ''}`, ids);
    _preserveToolbar = true;
    _saveToStorage();
};

const bulkChangeStatus = (status) => {
    if (selection.clickedCards.length === 0) return;
    _pushUndo();
    const n = selection.clickedCards.length;
    const ids = getSelectedIds();
    for (const card of selection.clickedCards) {
        const item = getItemForCard(card);
        if (item) {
            item.status = status;
            const domEl = card.type === 'step'
                ? _dom.storyMap.querySelector(`.step[data-column-id="${card.columnId}"]`)
                : _dom.storyMap.querySelector(`.story-card[data-story-id="${card.storyId}"]`);
            if (domEl) patchCard(domEl, item);
        }
    }
    _logEvent?.(`Changed status on ${n} card${n > 1 ? 's' : ''}`, ids);
    _preserveToolbar = true;
    _saveToStorage();
};

const bulkAddTag = (tag) => {
    if (selection.clickedCards.length === 0 || !tag) return;
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    _pushUndo();
    const n = selection.clickedCards.length;
    const ids = getSelectedIds();
    for (const card of selection.clickedCards) {
        const item = getItemForCard(card);
        if (!item) continue;
        if (!item.tags) item.tags = [];
        if (!item.tags.includes(trimmed)) item.tags.push(trimmed);
    }
    _logEvent?.(`Tagged ${n} card${n > 1 ? 's' : ''}`, ids);
    _saveToStorage();
};

const bulkRemoveTag = (tag) => {
    if (selection.clickedCards.length === 0 || !tag) return;
    _pushUndo();
    const n = selection.clickedCards.length;
    const ids = getSelectedIds();
    for (const card of selection.clickedCards) {
        const item = getItemForCard(card);
        if (item?.tags) item.tags = item.tags.filter(t => t !== tag);
    }
    _logEvent?.(`Removed tag from ${n} card${n > 1 ? 's' : ''}`, ids);
    _saveToStorage();
};

// =============================================================================
// State Mutations
// =============================================================================

const focusLastElement = (selector, textareaClass) => {
    const elements = _dom.storyMap.querySelectorAll(selector);
    const last = elements[elements.length - 1];
    if (last) {
        _scrollElementIntoView(last);
        last.querySelector(textareaClass)?.focus();
    }
};

export const addColumn = (hidden = true) => {
    _pushUndo();
    const column = _createColumn('', CARD_COLORS.green, null, hidden);
    _state.columns.push(column);
    _state.users[column.id] = [];
    _state.activities[column.id] = [];
    _state.slices.forEach(slice => slice.stories[column.id] = []);
    if (!hidden) _logEvent?.(`Added step${quoted(column.name)}`, [column.id]);
    _renderAndSave();

    requestAnimationFrame(() => {
        const newStep = _dom.storyMap.querySelector(`[data-column-id="${column.id}"]`);
        if (newStep) {
            _scrollElementIntoView(newStep);
            if (!hidden) {
                newStep.querySelector('.step-text')?.focus();
            }
        }
    });
};

export const addColumnAt = (index, hidden = false) => {
    _pushUndo();
    const column = _createColumn('', CARD_COLORS.green, null, hidden);
    _state.columns.splice(index, 0, column);
    _state.users[column.id] = [];
    _state.activities[column.id] = [];
    _state.slices.forEach(slice => slice.stories[column.id] = []);
    if (!hidden) _logEvent?.(`Added step${quoted(column.name)}`, [column.id]);
    _renderAndSave();
};

export const addStory = (columnId, sliceId, rowType = null, { skipFocus = false } = {}) => {
    _pushUndo();

    let storiesArray;
    let color;

    if (rowType === 'users') {
        _state.users[columnId] = _state.users[columnId] || [];
        color = DEFAULT_CARD_COLORS.Users;
        _state.users[columnId].push(_createStory('', color));
        storiesArray = _state.users[columnId];
    } else if (rowType === 'activities') {
        _state.activities[columnId] = _state.activities[columnId] || [];
        color = DEFAULT_CARD_COLORS.Activities;
        _state.activities[columnId].push(_createStory('', color));
        storiesArray = _state.activities[columnId];
    } else {
        const slice = _state.slices.find(s => s.id === sliceId);
        if (!slice) return;
        slice.stories[columnId] = slice.stories[columnId] || [];
        color = DEFAULT_CARD_COLORS.story;
        slice.stories[columnId].push(_createStory('', color));
        storiesArray = slice.stories[columnId];
    }

    const newStory = storiesArray[storiesArray.length - 1];
    const addLabel = rowType === 'users' ? 'Added user card'
                   : rowType === 'activities' ? 'Added activity card'
                   : 'Added card';
    _logEvent?.(`${addLabel}${quoted(newStory.name)}`, [newStory.id]);
    _renderAndSave();

    const storyIndex = storiesArray.length - 1;
    const selector = rowType
        ? `.story-column[data-column-id="${columnId}"][data-row-type="${rowType}"]`
        : `.story-column[data-column-id="${columnId}"][data-slice-id="${sliceId}"]`;
    requestAnimationFrame(() => {
        const column = _dom.storyMap.querySelector(selector);
        const newCard = column?.querySelectorAll('.story-card')[storyIndex];
        if (newCard) {
            _scrollElementIntoView(newCard);
            if (!skipFocus) newCard.querySelector('.story-text')?.focus();
        }
    });

    return newStory;
};

export const addSlice = (afterIndex) => {
    _pushUndo();
    const slice = _createSlice('');
    _state.slices.splice(afterIndex, 0, slice);
    _logEvent?.(`Added slice${quoted(slice.name)}`, [slice.id]);
    _renderAndSave();

    requestAnimationFrame(() => {
        const sliceElement = _dom.storyMap.querySelector(`[data-slice-id="${slice.id}"]`);
        if (sliceElement) {
            const label = sliceElement.querySelector('.slice-label');
            _scrollElementIntoView(label || sliceElement);
            if (label) {
                label.focus();
            }
        }
    });
    return slice;
};

export const deleteColumn = async (columnId) => {
    const col = _state.columns.find(c => c.id === columnId);
    if (!col) return;

    if (col.partialMapId) {
        // Check if this is the last reference to the partial
        const otherRefs = _state.columns.filter(c => c.partialMapId === col.partialMapId && c.id !== columnId);
        if (otherRefs.length === 0) {
            const pm = _state.partialMaps.find(p => p.id === col.partialMapId);
            const name = pm ? `"${pm.name || 'Untitled'}"` : 'this partial';
            if (!await showConfirm(`This will remove partial ${name} from the partials list. You can undo this.`)) return;
            if (_deletePartialMap) _deletePartialMap(col.partialMapId);
        } else {
            _pushUndo();
            // Transfer partialMapOrigin to a surviving ref if needed
            if (col.partialMapOrigin) otherRefs[0].partialMapOrigin = true;
            _state.columns = _state.columns.filter(c => c.id !== columnId);
            delete _state.users[columnId];
            delete _state.activities[columnId];
            _state.slices.forEach(slice => delete slice.stories[columnId]);
            _logEvent?.(`Deleted step${quoted(col.name)}`);
            _renderAndSave();
        }
        return;
    }

    if (_state.columns.filter(c => !c.partialMapId).length <= 1) {
        await showAlert('Cannot delete the last column.');
        return;
    }
    const index = _state.columns.indexOf(col);

    _pushUndo();
    _state.columns.splice(index, 1);
    delete _state.users[columnId];
    delete _state.activities[columnId];
    _state.slices.forEach(slice => delete slice.stories[columnId]);
    _logEvent?.(`Deleted step${quoted(col.name)}`);
    _renderAndSave();
};

export const deleteStory = (columnId, sliceId, storyId, rowType = null) => {
    let stories;
    if (rowType === 'users') {
        stories = _state.users[columnId];
    } else if (rowType === 'activities') {
        stories = _state.activities[columnId];
    } else {
        const slice = _state.slices.find(s => s.id === sliceId);
        stories = slice?.stories[columnId];
    }
    if (!stories) return;

    const index = stories.findIndex(s => s.id === storyId);
    if (index > -1) {
        _pushUndo();
        const story = stories[index];
        stories.splice(index, 1);
        _logEvent?.(`Deleted card${quoted(story.name)}`);
        _renderAndSave();
    }
};

const getStoriesArray = (columnId, sliceId, rowType) => {
    if (rowType === 'users') return _state.users[columnId];
    if (rowType === 'activities') return _state.activities[columnId];
    const slice = _state.slices.find(s => s.id === sliceId);
    return slice?.stories[columnId];
};

const ensureStoriesArray = (columnId, sliceId, rowType) => {
    if (rowType === 'users') {
        if (!_state.users[columnId]) _state.users[columnId] = [];
        return _state.users[columnId];
    }
    if (rowType === 'activities') {
        if (!_state.activities[columnId]) _state.activities[columnId] = [];
        return _state.activities[columnId];
    }
    const slice = _state.slices.find(s => s.id === sliceId);
    if (!slice) return null;
    if (!slice.stories[columnId]) slice.stories[columnId] = [];
    return slice.stories[columnId];
};

export const moveStory = (storyId, fromColumnId, fromSliceId, toColumnId, toSliceId, toIndex, fromRowType = null, toRowType = null) => {
    _pushUndo();
    const fromStories = getStoriesArray(fromColumnId, fromSliceId, fromRowType);
    if (!fromStories) return;

    const storyIndex = fromStories.findIndex(s => s.id === storyId);
    if (storyIndex === -1) return;

    const [story] = fromStories.splice(storyIndex, 1);

    const toStories = ensureStoriesArray(toColumnId, toSliceId, toRowType);
    if (!toStories) return;

    toStories.splice(toIndex, 0, story);
    _logEvent?.(`Moved card${quoted(story.name)}`, [storyId]);
    _renderAndSave();
};

// Selected story card IDs, when the given card is part of a multi-card selection
export const getMultiDragIds = (storyId) => {
    const ids = selection.clickedCards.filter(c => c.type === 'story' && c.storyId).map(c => c.storyId);
    return ids.length > 1 && ids.includes(storyId) ? ids : null;
};

const findStoryLocation = (storyId) => {
    for (const rowType of ['users', 'activities']) {
        for (const [columnId, list] of Object.entries(_state[rowType] || {})) {
            const index = list.findIndex(s => s.id === storyId);
            if (index !== -1) return { story: list[index], list, index, columnId, sliceId: null, rowType };
        }
    }
    for (const slice of _state.slices) {
        for (const [columnId, list] of Object.entries(slice.stories || {})) {
            const index = list.findIndex(s => s.id === storyId);
            if (index !== -1) return { story: list[index], list, index, columnId, sliceId: slice.id, rowType: null };
        }
    }
    return null;
};

// Move all selected cards to where the dragged card was dropped, stacked in map reading order
// (users, activities, then slices top to bottom; left to right within a row; top to bottom within a cell)
export const moveSelectedStories = (storyIds, droppedEl, toColumnId, toSliceId, toRowType = null) => {
    const locations = storyIds.map(findStoryLocation).filter(Boolean);
    if (locations.length < 2) return false;
    const toStories = ensureStoriesArray(toColumnId, toSliceId, toRowType);
    if (!toStories) return false;

    // Sortable has already placed the dragged card; insert before the first unselected card after it
    const movingIds = new Set(locations.map(l => l.story.id));
    let beforeId = null;
    for (let sib = droppedEl.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const id = sib.dataset?.storyId;
        if (id && !movingIds.has(id)) { beforeId = id; break; }
    }

    const rowOrder = (l) => l.rowType === 'users' ? 0 : l.rowType === 'activities' ? 1 : 2 + _state.slices.findIndex(s => s.id === l.sliceId);
    const colOrder = (l) => _state.columns.findIndex(c => c.id === l.columnId);
    locations.sort((a, b) => rowOrder(a) - rowOrder(b) || colOrder(a) - colOrder(b) || a.index - b.index);

    _pushUndo();
    for (const l of locations) l.list.splice(l.list.indexOf(l.story), 1);
    const beforeIndex = beforeId ? toStories.findIndex(s => s.id === beforeId) : -1;
    toStories.splice(beforeIndex === -1 ? toStories.length : beforeIndex, 0, ...locations.map(l => l.story));

    // Keep the moved cards selected in their new position
    const stepClicks = selection.clickedCards.filter(c => c.type === 'step');
    selection.clickedCards = [
        ...stepClicks,
        ...locations.map(l => ({ columnId: toColumnId, type: 'story', storyId: l.story.id, sliceId: toSliceId, rowType: toRowType })),
    ];
    selection.columnIds = [...new Set(selection.clickedCards.map(c => c.columnId))];
    selection.anchorId = toColumnId;

    _logEvent?.(`Moved ${locations.length} cards`, locations.map(l => l.story.id));
    _renderAndSave();
    return true;
};

export const deleteSlice = (sliceId) => {
    if (_state.slices.length <= 1) return;

    const index = _state.slices.findIndex(s => s.id === sliceId);
    if (index > -1) {
        _pushUndo();
        const slice = _state.slices[index];
        _state.slices.splice(index, 1);
        _logEvent?.(`Deleted slice${quoted(slice.name)}`);
        _renderAndSave();
    }
};
