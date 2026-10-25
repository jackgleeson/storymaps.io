// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Constants and pure utility functions

// Generate cryptographically secure 8-char ID
// 6 random bytes → BigInt → base36 string (0-9, a-z) → last 8 chars
const _crypto = globalThis.crypto ?? (await import('node:crypto')).webcrypto;
export const generateId = () => {
    const bytes = new Uint8Array(6);
    _crypto.getRandomValues(bytes);
    const num = Array.from(bytes).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
    return num.toString(36).slice(-8).padStart(8, '0');
};

export const isValidUrl = (url) => {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

// Slice goal and target date are optional. The date is stored as YYYY-MM-DD; YAML can parse an
// unquoted date as a Date, so accept that too. Anything else is dropped.
export const SLICE_GOAL_MAX_LENGTH = 200;

export const normalizeSliceGoal = (value) =>
    typeof value === 'string' ? value.trim().slice(0, SLICE_GOAL_MAX_LENGTH) : '';

export const normalizeSliceDate = (value) => {
    if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    return isNaN(new Date(`${value}T00:00:00Z`)) ? '' : value;
};

// Story points are a number or nothing. Numeric text ("5") becomes a number; anything else is dropped.
export const normalizePoints = (value) => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

// Copies a slice's goal and target date from one object to another, leaving out empty values
export const copySliceDetails = (from, to) => {
    const goal = normalizeSliceGoal(from.goal);
    const targetDate = normalizeSliceDate(from.targetDate);
    if (goal) to.goal = goal;
    if (targetDate) to.targetDate = targetDate;
    return to;
};

export const CARD_COLORS = {
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
export const DEFAULT_CARD_COLORS = {
    Users: '#fca5a5',       // red
    Activities: '#93c5fd',  // blue
    story: '#fef08a'        // yellow
};

export const STATUS_OPTIONS = {
    done: { label: 'Done', color: '#22c55e' },
    'in-progress': { label: 'In Progress', color: '#eab308' },
    planned: { label: 'Planned', color: '#3b82f6' },
    blocked: { label: 'Blocked', color: '#ef4444' }
};

export const TITLE_MAX_LENGTH = 38;

export const ZOOM_LEVELS = [1, 0.75, 0.5, 0.25, 0.1];

export const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const el = (tag, className, attrs = {}) => {
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
