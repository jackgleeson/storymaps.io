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

export const DEFAULT_FREEZE_MODE = 'all';

export const normalizeFreezeMode = (mode) =>
    Object.hasOwn(FREEZE_MODES, mode) ? mode : DEFAULT_FREEZE_MODE;
