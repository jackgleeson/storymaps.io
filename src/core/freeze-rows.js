// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Pure helpers for freezing the top rows while scrolling down

// The rows each choice freezes, top to bottom. Always the bottom of the stack, so the frozen rows
// sit together at the top.
export const FREEZE_MODES = {
    off: [],
    steps: ['steps-row'],
    activities: ['activities-row', 'steps-row'],
    all: ['users-row', 'activities-row', 'steps-row']
};

// Nothing is frozen until someone chooses it: a new visitor who scrolls down expects the whole
// story map to move, and rows that stay behind look like a fault.
export const DEFAULT_FREEZE_MODE = 'off';

export const normalizeFreezeMode = (mode) =>
    Object.hasOwn(FREEZE_MODES, mode) ? mode : DEFAULT_FREEZE_MODE;
