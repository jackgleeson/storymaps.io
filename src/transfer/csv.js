// Storymaps.io — AGPL-3.0 — see LICENCE for details
// CSV ↔ JSON transform (grid layout mirroring the visual story map)

import { generateId, copySliceDetails } from '../core/constants.js';

const DEFAULT_STEP_COLOR = '#86efac';
const DEFAULT_STORY_COLOR = '#fef08a';
const VALID_STATUSES = new Set(['done', 'in-progress', 'planned', 'blocked']);
const VALID_CLOSED_REASONS = new Set(['complete', 'closed']);

// ============================================================================
// CSV Utilities
// ============================================================================

export const escapeCSV = (str) => {
    if (str == null) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
};

// RFC 4180 CSV parser — handles quoted fields, escaped quotes, newlines in fields, BOM
export const parseCsv = (text) => {
    // Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const rows = [];
    let row = [];
    let i = 0;
    const len = text.length;

    while (i <= len) {
        if (i === len) {
            // End of input — push the last row unless a line break already ended it
            if (row.length > 0) rows.push(row);
            break;
        }

        if (text[i] === '"') {
            // Quoted field
            let val = '';
            i++; // skip opening quote
            while (i < len) {
                if (text[i] === '"') {
                    if (i + 1 < len && text[i + 1] === '"') {
                        val += '"';
                        i += 2;
                    } else {
                        i++; // skip closing quote
                        break;
                    }
                } else {
                    val += text[i];
                    i++;
                }
            }
            row.push(val);
            // After quoted field, expect comma or newline. A comma at the very end leaves an empty last cell.
            if (i < len && text[i] === ',') {
                i++;
                if (i === len) row.push('');
            } else if (i < len && (text[i] === '\r' || text[i] === '\n')) {
                if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
                i++;
                rows.push(row);
                row = [];
            }
        } else if (text[i] === '\r' || text[i] === '\n') {
            // End of row. Cells consume their own line break, so a row with cells got here after a comma.
            if (row.length > 0) row.push('');
            if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
            i++;
            rows.push(row);
            row = [];
        } else {
            // Unquoted field
            let val = '';
            while (i < len && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
                val += text[i];
                i++;
            }
            row.push(val);
            if (i < len && text[i] === ',') {
                i++;
                if (i === len) row.push('');
            } else if (i < len && (text[i] === '\r' || text[i] === '\n')) {
                if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
                i++;
                rows.push(row);
                row = [];
            }
        }
    }

    // Remove trailing empty row
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
    }
    return rows;
};

// ============================================================================
// Inline [key:val, ...] notation
// ============================================================================

// The notation is a trailing [...] that starts with a known field, so a name like "Support [beta]"
// keeps its brackets, and brackets inside a body don't end the notation early
const INLINE_NOTATION = /^(.*?)\s*\[((?:status|points|tags|color|url|body):[\s\S]*)\]$/;

export const parseInlineNotation = (cellText) => {
    if (!cellText || typeof cellText !== 'string') return { name: cellText || '' };
    const text = cellText.trim();

    const match = text.match(INLINE_NOTATION);
    if (!match) return { name: text };

    const name = match[1].trim();
    const inner = match[2].trim();
    const result = { name };

    // body: is always last and may contain commas — extract it first
    const bodyMatch = inner.match(/,?\s*body:([\s\S]*)$/);
    const tokenStr = bodyMatch ? inner.slice(0, inner.length - bodyMatch[0].length) : inner;
    if (bodyMatch) {
        const bodyVal = bodyMatch[1].trim();
        if (bodyVal) result.body = bodyVal;
    }

    // Split remaining tokens on commas
    const tokens = tokenStr.split(',').map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
        const colonIdx = token.indexOf(':');
        if (colonIdx < 0) continue;
        const key = token.slice(0, colonIdx).trim();
        const val = token.slice(colonIdx + 1).trim();

        switch (key) {
            case 'status':
                if (VALID_STATUSES.has(val)) result.status = val;
                break;
            case 'points':
                { const n = Number(val); if (!isNaN(n)) result.points = n; }
                break;
            case 'tags':
                result.tags = val.split(';').map(t => t.trim()).filter(Boolean);
                break;
            case 'color':
                if (/^#[0-9a-fA-F]{3,8}$/.test(val)) result.color = val;
                break;
            case 'url':
                result.url = val;
                break;
        }
    }
    return result;
};

export const formatInlineNotation = (card) => {
    const parts = [];
    if (card.status) parts.push(`status:${card.status}`);
    if (card.points != null) parts.push(`points:${card.points}`);
    if (card.tags?.length) parts.push(`tags:${card.tags.join(';')}`);
    if (card.color) parts.push(`color:${card.color}`);
    if (card.url) parts.push(`url:${card.url}`);
    if (card.body) parts.push(`body:${card.body}`);
    if (parts.length === 0) return card.name || '';
    return `${card.name || ''} [${parts.join(', ')}]`;
};

// ============================================================================
// Export: JSON (serialize() output) → CSV string
// ============================================================================

export function exportToCsv(jsonData) {
    const steps = jsonData.steps || [];
    const usersArr = jsonData.users || [];
    const activitiesArr = jsonData.activities || [];
    const slices = jsonData.slices || [];
    const partialMaps = jsonData.partialMaps || [];

    // Partial ID → slug
    const partialSlugMap = {};
    partialMaps.forEach(pm => {
        partialSlugMap[pm.id] = slugify(pm.name) || pm.id;
    });

    // All steps including spacers (hidden columns become empty CSV columns)
    const visibleSteps = [...steps];

    // Map original step index → column index (1:1 since we include spacers)
    const stepToCol = new Map();
    steps.forEach((step, i) => {
        stepToCol.set(i, i);
    });

    // Count ref steps per partial, then compute how many CSV columns each ref step expands to
    const partialRefCounts = {};
    visibleSteps.forEach(step => {
        if (step.partialMapId) {
            partialRefCounts[step.partialMapId] = (partialRefCounts[step.partialMapId] || 0) + 1;
        }
    });

    // refStepExpansion: vi → { startPmCol, colCount }
    const refStepExpansion = new Map();
    const _pmRefCounters = {};
    visibleSteps.forEach((step, vi) => {
        if (!step.partialMapId) return;
        const pm = partialMaps.find(p => p.id === step.partialMapId);
        const pmColCount = pm ? Math.max((pm.steps || []).length, 1) : 1;
        const refCount = partialRefCounts[step.partialMapId];
        if (!_pmRefCounters[step.partialMapId]) _pmRefCounters[step.partialMapId] = 0;
        const refIdx = _pmRefCounters[step.partialMapId]++;

        // Distribute partial columns across ref steps
        const base = Math.floor(pmColCount / refCount);
        const remainder = pmColCount % refCount;
        const colCount = base + (refIdx < remainder ? 1 : 0);
        const startPmCol = refIdx * base + Math.min(refIdx, remainder);
        refStepExpansion.set(vi, { startPmCol, colCount });
    });

    const rows = [];

    // --- comment rows ---
    rows.push([escapeCSV('# Storymaps.io CSV Export')]);
    rows.push([escapeCSV(`# ${new Date().toISOString()}`)]);
    rows.push([]);

    // --- name row ---
    rows.push([escapeCSV('name'), escapeCSV(jsonData.name || '')]);

    // --- Build steps row (used for column count, pushed after users/activities) ---
    const stepsRow = [escapeCSV('steps')];
    visibleSteps.forEach((step, vi) => {
        if (step.hidden) {
            stepsRow.push('');
            return;
        }
        if (step.partialMapId) {
            const slug = partialSlugMap[step.partialMapId];
            const pm = partialMaps.find(p => p.id === step.partialMapId);
            const pmSteps = pm ? (pm.steps || []) : [];
            const expansion = refStepExpansion.get(vi);
            for (let j = 0; j < expansion.colCount; j++) {
                const pmColIdx = expansion.startPmCol + j;
                if (pmColIdx < pmSteps.length) {
                    stepsRow.push(escapeCSV(`partial:${slug} > ${pmSteps[pmColIdx].name}`));
                } else {
                    stepsRow.push(escapeCSV(`partial:${slug} > ${pm ? pm.name : slug}`));
                }
            }
        } else {
            const meta = {};
            if (step.color && step.color !== DEFAULT_STEP_COLOR) meta.color = step.color;
            if (step.status) meta.status = step.status;
            if (step.points != null) meta.points = step.points;
            if (step.tags?.length) meta.tags = step.tags;
            if (step.url) meta.url = step.url;
            if (step.body) meta.body = step.body;
            stepsRow.push(escapeCSV(formatInlineNotation({ name: step.name || '', ...meta })));
        }
    });
    // Recompute actual column count after expanding partials
    const totalCols = stepsRow.length - 1; // minus the "steps:" cell

    // Build a mapping from visible step index to expanded column range
    const stepToExpandedCols = new Map();
    let expandedIdx = 0;
    visibleSteps.forEach((step, vi) => {
        if (step.partialMapId) {
            const expansion = refStepExpansion.get(vi);
            stepToExpandedCols.set(vi, { start: expandedIdx, count: expansion.colCount });
            expandedIdx += expansion.colCount;
        } else {
            stepToExpandedCols.set(vi, { start: expandedIdx, count: 1 });
            expandedIdx++;
        }
    });

    // --- users: rows ---
    // Build one row per max user card at any position
    const maxUsers = Math.max(...usersArr.map(c => c?.length || 0), 0);
    for (let u = 0; u < maxUsers; u++) {
        const row = new Array(totalCols + 1).fill('');
        row[0] = escapeCSV('users');
        let hasContent = false;
        usersArr.forEach((cards, origIdx) => {
            if (!cards?.[u]) return;
            const vi = stepToCol.get(origIdx);
            if (vi == null) return;
            const range = stepToExpandedCols.get(vi);
            if (!range) return;
            row[range.start + 1] = escapeCSV(formatInlineNotation(cards[u]));
            hasContent = true;
        });
        if (hasContent) rows.push(row);
    }

    // --- activities: rows ---
    // (users and activities come before steps to mirror the visual layout)
    const maxActivities = Math.max(...activitiesArr.map(c => c?.length || 0), 0);
    for (let a = 0; a < maxActivities; a++) {
        const row = new Array(totalCols + 1).fill('');
        row[0] = escapeCSV('activities');
        let hasContent = false;
        activitiesArr.forEach((cards, origIdx) => {
            if (!cards?.[a]) return;
            const vi = stepToCol.get(origIdx);
            if (vi == null) return;
            const range = stepToExpandedCols.get(vi);
            if (!range) return;
            row[range.start + 1] = escapeCSV(formatInlineNotation(cards[a]));
            hasContent = true;
        });
        if (hasContent) rows.push(row);
    }

    // --- steps: row (column headers, after backbone rows) ---
    rows.push(stepsRow);

    // --- slice rows ---
    slices.forEach((slice, sliceIdx) => {
        const sliceName = slice.name || '';
        const storiesArr = slice.stories || [];

        // The slice's goal, target date and collapsed state go on their own row, which older
        // imports skip
        const details = copySliceDetails(slice, {});
        const metaCells = [];
        if (details.goal) metaCells.push(`goal:${details.goal}`);
        if (details.targetDate) metaCells.push(`targetDate:${details.targetDate}`);
        if (slice.collapsed) metaCells.push('collapsed:true');
        if (slice.closedReason) metaCells.push(`closedReason:${slice.closedReason}`);
        // A slicemeta row also marks where a slice starts when it has the same name as the one before
        const sameNameAsPrevious = sliceIdx > 0 && (slices[sliceIdx - 1].name || '') === sliceName;
        if (metaCells.length || sameNameAsPrevious) rows.push([`slicemeta:${sliceName}`, ...metaCells].map(escapeCSV));

        // Find max cards per expanded column for this slice
        const maxPerCol = new Array(totalCols).fill(0);
        storiesArr.forEach((cards, origIdx) => {
            if (!cards?.length) return;
            const vi = stepToCol.get(origIdx);
            if (vi == null) return;
            const range = stepToExpandedCols.get(vi);
            if (!range) return;
            // All cards for a non-partial step go in one column
            if (range.count === 1) {
                maxPerCol[range.start] = Math.max(maxPerCol[range.start], cards.length);
            } else {
                // Partial: distribute cards across sub-columns
                maxPerCol[range.start] = Math.max(maxPerCol[range.start], cards.length);
            }
        });

        // Also handle partial map stories
        const partialStories = {};
        visibleSteps.forEach((step, vi) => {
            if (!step.partialMapId) return;
            const pm = partialMaps.find(p => p.id === step.partialMapId);
            if (!pm) return;
            const range = stepToExpandedCols.get(vi);
            const expansion = refStepExpansion.get(vi);
            for (let j = 0; j < expansion.colCount; j++) {
                const pmColIdx = expansion.startPmCol + j;
                const cards = pm.stories?.[sliceIdx]?.[pmColIdx] || [];
                if (cards.length) {
                    const expandedCol = range.start + j;
                    maxPerCol[expandedCol] = Math.max(maxPerCol[expandedCol], cards.length);
                    partialStories[expandedCol] = cards;
                }
            }
        });

        const maxRows = Math.max(...maxPerCol, 1);
        for (let r = 0; r < maxRows; r++) {
            const row = new Array(totalCols + 1).fill('');
            row[0] = escapeCSV(`slice:${sliceName}`);
            let hasContent = false;

            // Main map stories
            storiesArr.forEach((cards, origIdx) => {
                if (!cards?.length) return;
                const vi = stepToCol.get(origIdx);
                if (vi == null) return;
                const range = stepToExpandedCols.get(vi);
                if (!range) return;
                const step = visibleSteps[vi];
                if (step.partialMapId) return; // handled below
                const card = cards[r];
                if (card && card.name) {
                    const meta = {};
                    if (card.color && card.color !== DEFAULT_STORY_COLOR) meta.color = card.color;
                    if (card.status) meta.status = card.status;
                    if (card.points != null) meta.points = card.points;
                    if (card.tags?.length) meta.tags = card.tags;
                    if (card.url) meta.url = card.url;
                    if (card.body) meta.body = card.body;
                    row[range.start + 1] = escapeCSV('story:' + formatInlineNotation({ name: card.name, ...meta }));
                    hasContent = true;
                }
            });

            // Partial map stories
            for (const [colStr, cards] of Object.entries(partialStories)) {
                const col = Number(colStr);
                const card = cards[r];
                if (card && card.name) {
                    const meta = {};
                    if (card.color && card.color !== DEFAULT_STORY_COLOR) meta.color = card.color;
                    if (card.status) meta.status = card.status;
                    if (card.points != null) meta.points = card.points;
                    if (card.tags?.length) meta.tags = card.tags;
                    if (card.url) meta.url = card.url;
                    if (card.body) meta.body = card.body;
                    row[col + 1] = escapeCSV('story:' + formatInlineNotation({ name: card.name, ...meta }));
                    hasContent = true;
                }
            }

            if (hasContent || r === 0) rows.push(row);
        }
    });

    // --- legend: row ---
    if (jsonData.legend?.length) {
        const row = [escapeCSV('legend')];
        jsonData.legend.forEach(entry => {
            row.push(escapeCSV(`color:${entry.color} label:${entry.label}`));
        });
        rows.push(row);
    }

    // --- notes: row ---
    if (jsonData.notes) {
        rows.push([escapeCSV('notes'), escapeCSV(jsonData.notes)]);
    }

    // Pad all rows to same length
    const maxLen = Math.max(...rows.map(r => r.length));
    rows.forEach(r => { while (r.length < maxLen) r.push(''); });

    return rows.map(r => r.join(',')).join('\n');
}

// ============================================================================
// Import: CSV string → JSON (compatible with deserializeV1 format)
// ============================================================================

export function importFromCsv(csvString) {
    const grid = parseCsv(csvString);
    if (!grid.length) throw new Error('Empty CSV');

    let name = '';
    let notes = '';
    const legend = [];
    const stepHeaders = []; // from steps: row
    const userRows = [];
    const activityRows = [];
    // Slices in file order. A slice is a run of slice:NAME rows with the same name. A slicemeta:NAME
    // row starts a new one, so two slices with the same name (e.g. both unnamed) stay separate.
    const sliceBlocks = []; // { name, rows, details }
    let currentSlice = null;

    // Classify rows by first column
    for (const row of grid) {
        const first = (row[0] || '').trim();
        if (!first || first.startsWith('#')) continue;
        if (!first.startsWith('slice:') && !first.startsWith('slicemeta:')) currentSlice = null;
        if (first === 'name') {
            name = (row[1] || '').trim();
        } else if (first === 'steps') {
            for (let c = 1; c < row.length; c++) {
                const val = (row[c] || '').trim();
                stepHeaders.push({ col: c, raw: val });
            }
        } else if (first === 'users') {
            userRows.push(row);
        } else if (first === 'activities') {
            activityRows.push(row);
        } else if (first === 'legend') {
            for (let c = 1; c < row.length; c++) {
                const val = (row[c] || '').trim();
                if (!val) continue;
                const colorMatch = val.match(/^color:(#[0-9a-fA-F]{3,8})\s+label:(.+)$/);
                if (colorMatch) {
                    legend.push({ color: colorMatch[1], label: colorMatch[2].trim() });
                }
            }
        } else if (first === 'notes') {
            notes = (row[1] || '').trim();
        } else if (first.startsWith('slice:')) {
            const sliceName = first.slice(6);
            if (currentSlice?.name !== sliceName) {
                currentSlice = { name: sliceName, rows: [], details: null };
                sliceBlocks.push(currentSlice);
            }
            currentSlice.rows.push(row);
        } else if (first.startsWith('slicemeta:')) {
            const details = {};
            for (let c = 1; c < row.length; c++) {
                const val = (row[c] || '').trim();
                if (val.startsWith('goal:')) details.goal = val.slice(5);
                else if (val.startsWith('targetDate:')) details.targetDate = val.slice(11).trim();
                else if (val === 'collapsed:true') details.collapsed = true;
                else if (val.startsWith('closedReason:')) details.closedReason = val.slice(13).trim();
            }
            currentSlice = { name: first.slice(10), rows: [], details };
            sliceBlocks.push(currentSlice);
        }
    }

    if (stepHeaders.length === 0) {
        throw new Error('Missing "steps" row — CSV must have a steps row defining column headers');
    }

    // Export pads every row to the same width, so empty step cells past the last column with cards
    // are padding (e.g. from a long legend row), not spacers
    const cardRows = [...userRows, ...activityRows, ...sliceBlocks.flatMap(block => block.rows)];
    const columnHasCards = (col) => cardRows.some(row => (row[col] || '').trim());
    while (stepHeaders.length > 1 && !stepHeaders.at(-1).raw && !columnHasCards(stepHeaders.at(-1).col)) stepHeaders.pop();

    // Parse steps — handle partials and regular steps
    const partialDefs = {}; // slug → { name, stepNames, colIndices }
    const jsonSteps = [];
    const stepColMap = new Map(); // column index → step array index
    const partialIdMap = {}; // slug → generated ID
    const seenPartials = new Set();

    let prevPartialSlug = null; // track consecutive partial columns

    stepHeaders.forEach(({ col, raw }, headerIdx) => {
        // Empty column = spacer
        if (!raw) {
            prevPartialSlug = null;
            const stepIdx = jsonSteps.length;
            jsonSteps.push({ name: '', color: DEFAULT_STEP_COLOR, hidden: true });
            stepColMap.set(col, stepIdx);
            return;
        }

        const parsed = parseInlineNotation(raw);
        const stepName = parsed.name;

        if (stepName.startsWith('partial:')) {
            // partial:slug > StepName
            const rest = stepName.slice(8); // after "partial:"
            const arrowIdx = rest.indexOf('>');
            if (arrowIdx < 0) return;
            const slug = rest.slice(0, arrowIdx).trim();
            const pmStepName = rest.slice(arrowIdx + 1).trim();

            if (!partialIdMap[slug]) partialIdMap[slug] = generateId();
            if (!partialDefs[slug]) partialDefs[slug] = { name: pmStepName, stepNames: [], colIndices: [] };
            partialDefs[slug].stepNames.push(pmStepName);
            partialDefs[slug].colIndices.push(col);

            if (prevPartialSlug === slug) {
                // Continuation of same partial group — reuse existing ref step
                stepColMap.set(col, partialDefs[slug]._currentRefIdx);
            } else {
                // New group — create a ref step
                const isOrigin = !seenPartials.has(slug);
                if (isOrigin) seenPartials.add(slug);
                const stepIdx = jsonSteps.length;
                jsonSteps.push({ partialMapId: partialIdMap[slug], partialMapOrigin: isOrigin });
                stepColMap.set(col, stepIdx);
                partialDefs[slug]._currentRefIdx = stepIdx;
            }
            prevPartialSlug = slug;
        } else {
            prevPartialSlug = null;
            // Regular step with inline notation: "step:StepName [color:#...]"
            let realName = stepName;
            if (realName.startsWith('step:')) realName = realName.slice(5);

            const stepIdx = jsonSteps.length;
            const step = { name: realName, color: parsed.color || DEFAULT_STEP_COLOR };
            if (parsed.status) step.status = parsed.status;
            if (parsed.points != null) step.points = parsed.points;
            if (parsed.tags?.length) step.tags = parsed.tags;
            if (parsed.url) step.url = parsed.url;
            if (parsed.body) step.body = parsed.body;
            jsonSteps.push(step);
            stepColMap.set(col, stepIdx);
        }
    });

    const n = jsonSteps.length;

    // Parse users
    const jsonUsers = Array.from({ length: n }, () => []);
    userRows.forEach(row => {
        for (let c = 1; c < row.length; c++) {
            const val = (row[c] || '').trim();
            if (!val) continue;
            let cardText = val;
            if (cardText.startsWith('user:')) cardText = cardText.slice(5);
            const parsed = parseInlineNotation(cardText);
            const stepIdx = stepColMap.get(c);
            if (stepIdx != null) {
                const card = { name: parsed.name };
                if (parsed.color) card.color = parsed.color;
                if (parsed.status) card.status = parsed.status;
                if (parsed.points != null) card.points = parsed.points;
                if (parsed.tags?.length) card.tags = parsed.tags;
                if (parsed.url) card.url = parsed.url;
                if (parsed.body) card.body = parsed.body;
                jsonUsers[stepIdx].push(card);
            }
        }
    });

    // Parse activities
    const jsonActivities = Array.from({ length: n }, () => []);
    activityRows.forEach(row => {
        for (let c = 1; c < row.length; c++) {
            const val = (row[c] || '').trim();
            if (!val) continue;
            let cardText = val;
            if (cardText.startsWith('activity:')) cardText = cardText.slice(9);
            const parsed = parseInlineNotation(cardText);
            const stepIdx = stepColMap.get(c);
            if (stepIdx != null) {
                const card = { name: parsed.name };
                if (parsed.color) card.color = parsed.color;
                if (parsed.status) card.status = parsed.status;
                if (parsed.points != null) card.points = parsed.points;
                if (parsed.tags?.length) card.tags = parsed.tags;
                if (parsed.url) card.url = parsed.url;
                if (parsed.body) card.body = parsed.body;
                jsonActivities[stepIdx].push(card);
            }
        }
    });

    // A slicemeta row with no slice rows after it describes no slice
    const sliceList = sliceBlocks.filter(block => block.rows.length > 0);

    const jsonSlices = sliceList.map(({ name: sliceName, rows: cellRows, details }) => {
        const stories = Array.from({ length: n }, () => []);
        cellRows.forEach(cells => {
            for (let c = 1; c < cells.length; c++) {
                const val = (cells[c] || '').trim();
                if (!val) continue;
                let cardText = val;
                if (cardText.startsWith('story:')) cardText = cardText.slice(6);
                const parsed = parseInlineNotation(cardText);
                if (!parsed.name) continue;
                const stepIdx = stepColMap.get(c);
                if (stepIdx != null) {
                    const card = { name: parsed.name };
                    if (parsed.color) card.color = parsed.color;
                    if (parsed.status) card.status = parsed.status;
                    if (parsed.points != null) card.points = parsed.points;
                    if (parsed.tags?.length) card.tags = parsed.tags;
                    if (parsed.url) card.url = parsed.url;
                    if (parsed.body) card.body = parsed.body;
                    stories[stepIdx].push(card);
                }
            }
        });
        const slice = { name: sliceName, stories };
        if (details) {
            if (details.collapsed) slice.collapsed = true;
            if (VALID_CLOSED_REASONS.has(details.closedReason)) slice.closedReason = details.closedReason;
            copySliceDetails(details, slice);
        }
        return slice;
    });

    // Build partial maps
    const jsonPartialMaps = [];
    for (const [slug, def] of Object.entries(partialDefs)) {
        const pmSteps = def.stepNames.map(name => ({ name, color: DEFAULT_STEP_COLOR }));
        const pmN = pmSteps.length;
        const pmUsers = Array.from({ length: pmN }, () => []);
        const pmActivities = Array.from({ length: pmN }, () => []);

        // Build column index → partial step index
        const pmColToIdx = new Map();
        def.colIndices.forEach((col, i) => { pmColToIdx.set(col, i); });

        // Collect stories for each slice
        const pmStories = jsonSlices.map((slice, si) => {
            const sliceCellRows = sliceList[si].rows;
            const perStep = Array.from({ length: pmN }, () => []);
            sliceCellRows.forEach(cells => {
                for (const [col, pmIdx] of pmColToIdx) {
                    const val = (cells[col] || '').trim();
                    if (!val) continue;
                    let cardText = val;
                    if (cardText.startsWith('story:')) cardText = cardText.slice(6);
                    const parsed = parseInlineNotation(cardText);
                    if (!parsed.name) continue;
                    const card = { name: parsed.name };
                    if (parsed.color) card.color = parsed.color;
                    if (parsed.status) card.status = parsed.status;
                    if (parsed.points != null) card.points = parsed.points;
                    if (parsed.tags?.length) card.tags = parsed.tags;
                    if (parsed.url) card.url = parsed.url;
                    if (parsed.body) card.body = parsed.body;
                    perStep[pmIdx].push(card);
                }
            });
            return perStep;
        });

        jsonPartialMaps.push({
            id: partialIdMap[slug],
            name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            users: pmUsers,
            activities: pmActivities,
            steps: pmSteps,
            stories: pmStories,
        });
    }

    const result = {
        app: 'storymap',
        v: 1,
        name,
        users: jsonUsers,
        activities: jsonActivities,
        steps: jsonSteps,
        slices: jsonSlices,
    };

    if (legend.length) result.legend = legend;
    if (notes) result.notes = notes;
    if (jsonPartialMaps.length) result.partialMaps = jsonPartialMaps;
    return result;
}

// ============================================================================
// Helpers
// ============================================================================

function slugify(str) {
    return (str || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
