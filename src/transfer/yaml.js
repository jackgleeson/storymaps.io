// Storymaps.io — AGPL-3.0 — see LICENCE for details
// YAML ↔ JSON transform + validation

import jsyaml from '#js-yaml';
import { generateId, copySliceDetails } from '../core/constants.js';

const DEFAULT_STEP_COLOR = '#86efac';
const DEFAULT_STORY_COLOR = '#fef08a';
const SPACER_COLOR = '#e5e7eb';
const VALID_STATUSES = new Set(['done', 'in-progress', 'planned', 'blocked']);

// ============================================================================
// Export: JSON (serialize() output) → YAML string
// ============================================================================

export function exportToYaml(jsonData) {
    const yamlObj = jsonToYamlObj(jsonData);
    return dumpYaml(yamlObj);
}

// Extract step order from a yamlObj and dump with correct key ordering.
// JS objects put integer-like keys (e.g. "2") before string keys regardless
// of insertion order, which breaks story key ordering in YAML output.
export function dumpYaml(yamlObj) {
    const stepOrder = {};
    (yamlObj.steps || []).forEach((s, i) => {
        const name = typeof s === 'string' && s !== 'spacer' ? s : s?.name;
        if (name) stepOrder[name] = i;
    });
    return jsyaml.dump(yamlObj, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: (a, b) => {
            const ai = a in stepOrder ? stepOrder[a] : -1;
            const bi = b in stepOrder ? stepOrder[b] : -1;
            if (ai >= 0 && bi >= 0) return ai - bi;
            return 0;
        },
        quotingType: '"',
    });
}

export function jsonToYamlObj(data) {
    const steps = data.steps || [];
    const usersArr = data.users || [];
    const activitiesArr = data.activities || [];
    const slices = data.slices || [];
    const partialMaps = data.partialMaps || [];

    // Partial ID → slug
    const partialSlugMap = {};
    partialMaps.forEach(pm => {
        partialSlugMap[pm.id] = slugify(pm.name) || pm.id;
    });

    // Classify each step. A hidden step with a name or cards is written as a normal step so its
    // cards survive (only empty, unnamed hidden steps are spacers).
    const hasCards = (i) => !!(usersArr[i]?.length || activitiesArr[i]?.length || slices.some(s => s.stories?.[i]?.length));
    const stepTypes = steps.map((step, i) => {
        if (step.partialMapId) return 'partial';
        if (step.hidden && !step.name && !hasCards(i)) return 'spacer';
        return 'step';
    });

    // Find duplicate step names
    const nameCounts = {};
    steps.forEach((step, i) => {
        if (stepTypes[i] === 'step') {
            nameCounts[step.name || ''] = (nameCounts[step.name || ''] || 0) + 1;
        }
    });
    const duplicateNames = new Set(Object.keys(nameCounts).filter(n => nameCounts[n] > 1));

    // Number duplicate names (Confirm[0], Confirm[1]) so cards point at the right step.
    // Import strips the number, so the names come back unchanged.
    const counters = {};
    const resolvedNames = steps.map((step, i) => {
        if (stepTypes[i] !== 'step') return null;
        const name = step.name || '';
        if (!duplicateNames.has(name)) return name;
        const idx = counters[name] || 0;
        counters[name] = idx + 1;
        return `${name}[${idx}]`;
    });

    // Build YAML object
    const result = {};
    result.name = data.name || '';
    if (data.id) result.id = data.id;
    if (data.site) result.site = data.site;
    if (data.locked != null) result.locked = data.locked;

    const yamlUsers = backboneToYaml(usersArr, resolvedNames);
    if (yamlUsers.length) result.users = yamlUsers;

    const yamlActivities = backboneToYaml(activitiesArr, resolvedNames);
    if (yamlActivities.length) result.activities = yamlActivities;

    // Partials
    if (partialMaps.length) {
        const yamlPartials = {};
        partialMaps.forEach(pm => {
            const slug = partialSlugMap[pm.id];
            const pmStepNames = (pm.steps || []).map(s => s.name);
            const pmObj = { name: pm.name || slug };
            if (pmStepNames.length) pmObj.steps = pmStepNames;

            const pmU = backboneToYaml(pm.users || [], pmStepNames);
            if (pmU.length) pmObj.users = pmU;
            const pmA = backboneToYaml(pm.activities || [], pmStepNames);
            if (pmA.length) pmObj.activities = pmA;

            // Stories — pm.stories is [sliceIdx][colIdx] = [cards]
            const storiesArr = pm.stories || [];
            let hasStories = false;
            let allSame = true;
            const first = JSON.stringify(storiesArr[0] || []);
            for (let si = 0; si < slices.length; si++) {
                const ss = storiesArr[si] || [];
                if (ss.some(col => col?.length)) hasStories = true;
                if (si > 0 && JSON.stringify(ss) !== first) allSame = false;
            }

            if (hasStories) {
                if (allSame && slices.length > 0) {
                    const flat = {};
                    (storiesArr[0] || []).forEach((cards, ci) => {
                        if (cards?.length) flat[pmStepNames[ci]] = cards.map(cardToYaml);
                    });
                    if (Object.keys(flat).length) pmObj.stories = flat;
                } else {
                    const perSlice = {};
                    slices.forEach((slice, si) => {
                        const ss = storiesArr[si] || [];
                        const obj = {};
                        ss.forEach((cards, ci) => {
                            if (cards?.length) obj[pmStepNames[ci]] = cards.map(cardToYaml);
                        });
                        if (Object.keys(obj).length) perSlice[slice.name] = obj;
                    });
                    if (Object.keys(perSlice).length) pmObj.slices = perSlice;
                }
            }
            yamlPartials[slug] = pmObj;
        });
        result.partials = yamlPartials;
    }

    // Steps
    result.steps = steps.map((step, i) => {
        if (stepTypes[i] === 'spacer') return 'spacer';
        if (stepTypes[i] === 'partial') return { partial: partialSlugMap[step.partialMapId] };
        const name = resolvedNames[i];
        const hasExtra = (step.color && step.color !== DEFAULT_STEP_COLOR)
            || step.body || step.url || step.status || step.points != null || step.tags?.length;
        if (!hasExtra) return name;
        const s = { name };
        if (step.color && step.color !== DEFAULT_STEP_COLOR) s.color = step.color;
        if (step.body) s.body = step.body;
        if (step.url) s.url = step.url;
        if (step.status) s.status = step.status;
        if (step.points != null) s.points = step.points;
        if (step.tags?.length) s.tags = step.tags;
        return s;
    });

    // Legend
    if (data.legend?.length) result.legend = data.legend.map(e => ({ color: e.color, label: e.label }));

    // Slices
    if (slices.length) {
        result.slices = slices.map(slice => {
            const obj = { name: slice.name || '' };
            if (slice.collapsed) obj.collapsed = true;
            if (slice.closedReason) obj.closedReason = slice.closedReason;
            copySliceDetails(slice, obj);
            const stories = {};
            (slice.stories || []).forEach((cards, i) => {
                if (!cards?.length) return;
                const stepName = resolvedNames[i];
                if (stepName == null) return;
                stories[stepName] = cards.map(cardToYaml);
            });
            if (Object.keys(stories).length) obj.stories = stories;
            return obj;
        });
    }

    if (data.notes) result.notes = data.notes;
    if (data.backups?.length) result.backups = data.backups.map(b => ({
        id: b.id, timestamp: b.timestamp, note: b.note, data: b.data,
    }));
    return result;
}

// ============================================================================
// Import: YAML string → JSON (compatible with deserializeV1)
// ============================================================================

export function importFromYaml(yamlString) {
    const obj = jsyaml.load(yamlString);
    if (!obj || typeof obj !== 'object') throw new Error('Invalid YAML');
    const validation = validateYaml(obj);
    if (!validation.valid) {
        const err = new Error(validation.errors.join('\n'));
        err.validationErrors = validation.errors;
        err.validationWarnings = validation.warnings;
        throw err;
    }
    return yamlObjToJson(obj);
}

export function validateYaml(obj) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
        errors.push('Missing or empty "steps" list');
        return { valid: false, errors, warnings };
    }

    const stepNames = [];
    obj.steps.forEach((step, i) => {
        if (step === 'spacer') return;
        if (typeof step === 'object' && step !== null && step.partial) return;
        const name = typeof step === 'string' ? step : String(step?.name ?? '');
        if (name) stepNames.push(name);
    });

    // Duplicate check
    const counts = {};
    stepNames.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    const dupes = Object.keys(counts).filter(n => counts[n] > 1);
    if (dupes.length) {
        errors.push(`Duplicate step names: ${dupes.join(', ')}. Use "Activity: Step" namespacing to disambiguate.`);
    }

    const stepNameSet = new Set(stepNames);

    // Step references in users/activities
    for (const key of ['users', 'activities']) {
        (obj[key] || []).forEach((item, i) => {
            if (item.step && !stepNameSet.has(item.step)) {
                errors.push(`${key}[${i}] references unknown step "${item.step}"`);
            }
        });
    }

    // Story step references + status checks
    (obj.slices || []).forEach((slice, si) => {
        const label = slice.name || `#${si}`;
        if (slice.stories) {
            for (const [stepName, cards] of Object.entries(slice.stories)) {
                if (!stepName) continue;
                if (!stepNameSet.has(stepName)) {
                    errors.push(`Slice "${label}" references unknown step "${stepName}"`);
                }
                (cards || []).forEach((card, ci) => {
                    if (card.status && !VALID_STATUSES.has(card.status)) {
                        warnings.push(`Slice "${label}" → "${stepName}"[${ci}]: unknown status "${card.status}"`);
                    }
                });
            }
        }
    });

    // Partial references
    const slugs = new Set(Object.keys(obj.partials || {}));
    obj.steps.forEach((step, i) => {
        if (typeof step === 'object' && step !== null && step.partial && !slugs.has(step.partial)) {
            errors.push(`steps[${i}] references undefined partial "${step.partial}"`);
        }
    });

    return { valid: errors.length === 0, errors, warnings };
}

export function yamlObjToJson(obj) {
    const yamlSteps = obj.steps || [];
    const yamlPartials = obj.partials || {};

    // Generate stable IDs for partials
    const partialIdMap = {};
    for (const slug of Object.keys(yamlPartials)) {
        partialIdMap[slug] = generateId();
    }

    const seenPartials = new Set();

    // Parse steps
    const jsonSteps = [];
    const stepNameToIndex = {};

    yamlSteps.forEach(step => {
        if (step === 'spacer') {
            jsonSteps.push({ name: '', color: SPACER_COLOR, hidden: true });
            return;
        }
        if (typeof step === 'object' && step !== null && step.partial) {
            const slug = step.partial;
            const isOrigin = !seenPartials.has(slug);
            seenPartials.add(slug);
            const s = { partialMapId: partialIdMap[slug] };
            if (isOrigin) s.partialMapOrigin = true;
            jsonSteps.push(s);
            return;
        }
        const rawName = typeof step === 'string' ? step : String(step?.name ?? '');
        const displayName = rawName.replace(/:\[\d+\]\s*/, ': ').replace(/\[\d+\]$/, '');
        const color = typeof step === 'string' ? DEFAULT_STEP_COLOR : (step.color || DEFAULT_STEP_COLOR);
        stepNameToIndex[rawName] = jsonSteps.length;
        const s = { name: displayName, color };
        if (typeof step === 'object' && step !== null) {
            if (step.body) s.body = step.body;
            if (step.url) s.url = step.url;
            if (step.status) s.status = step.status;
            if (step.points != null) s.points = step.points;
            if (step.tags?.length) s.tags = step.tags;
        }
        jsonSteps.push(s);
    });

    const n = jsonSteps.length;

    // Users / Activities → positional arrays
    const jsonUsers = Array.from({ length: n }, () => []);
    (obj.users || []).forEach(card => {
        const idx = card.step != null ? stepNameToIndex[card.step] : 0;
        if (idx != null) jsonUsers[idx].push(cardToJson(card));
    });

    const jsonActivities = Array.from({ length: n }, () => []);
    (obj.activities || []).forEach(card => {
        const idx = card.step != null ? stepNameToIndex[card.step] : 0;
        if (idx != null) jsonActivities[idx].push(cardToJson(card));
    });

    // Slices
    const jsonSlices = (obj.slices || []).map(slice => {
        const stories = Array.from({ length: n }, () => []);
        if (slice.stories) {
            for (const [stepName, cards] of Object.entries(slice.stories)) {
                const idx = stepNameToIndex[stepName];
                if (idx != null) stories[idx] = (cards || []).map(cardToJson);
            }
        }
        const s = { name: slice.name || '', stories };
        if (slice.collapsed) s.collapsed = true;
        if (slice.closedReason) s.closedReason = slice.closedReason;
        copySliceDetails(slice, s);
        return s;
    });

    // Partial maps
    const jsonPartialMaps = [];
    for (const [slug, def] of Object.entries(yamlPartials)) {
        const pmNames = def.steps || [];
        const pmSteps = pmNames.map(name => ({ name, color: DEFAULT_STEP_COLOR }));
        const pmN = pmSteps.length;
        const pmIdx = {};
        pmNames.forEach((name, i) => { pmIdx[name] = i; });

        const pmUsers = Array.from({ length: pmN }, () => []);
        (def.users || []).forEach(card => {
            const i = card.step != null ? pmIdx[card.step] : 0;
            if (i != null) pmUsers[i].push(cardToJson(card));
        });

        const pmActivities = Array.from({ length: pmN }, () => []);
        (def.activities || []).forEach(card => {
            const i = card.step != null ? pmIdx[card.step] : 0;
            if (i != null) pmActivities[i].push(cardToJson(card));
        });

        let pmStories;
        if (def.slices) {
            pmStories = jsonSlices.map(slice => {
                const sliceData = def.slices[slice.name] || {};
                return pmNames.map(name => (sliceData[name] || []).map(cardToJson));
            });
        } else if (def.stories) {
            const base = pmNames.map(name => (def.stories[name] || []).map(cardToJson));
            pmStories = jsonSlices.map(() => base.map(col => col.map(c => ({ ...c }))));
        } else {
            pmStories = jsonSlices.map(() => Array.from({ length: pmN }, () => []));
        }

        jsonPartialMaps.push({
            id: partialIdMap[slug],
            name: def.name || slug,
            users: pmUsers,
            activities: pmActivities,
            steps: pmSteps,
            stories: pmStories,
        });
    }

    const result = {
        app: 'storymap',
        v: 1,
        name: obj.name || '',
        users: jsonUsers,
        activities: jsonActivities,
        steps: jsonSteps,
        slices: jsonSlices,
    };

    if (obj.legend?.length) result.legend = obj.legend;
    // Keep empty notes so a push with notes: "" clears them (no notes key leaves them alone)
    if (typeof obj.notes === 'string') result.notes = obj.notes;
    if (jsonPartialMaps.length) result.partialMaps = jsonPartialMaps;
    if (obj.backups?.length) result.backups = obj.backups;
    return result;
}

// ============================================================================
// Helpers
// ============================================================================

function backboneToYaml(positionalArr, namesByIndex) {
    const result = [];
    positionalArr.forEach((cards, i) => {
        if (!cards?.length) return;
        const stepName = namesByIndex[i];
        if (stepName == null) return;
        cards.forEach(card => {
            const obj = { name: card.name };
            if (card.body) obj.body = card.body;
            if (card.color) obj.color = card.color;
            if (card.status) obj.status = card.status;
            if (card.points != null) obj.points = card.points;
            if (card.tags?.length) obj.tags = [...card.tags];
            if (card.url) obj.url = card.url;
            obj.step = stepName;
            result.push(obj);
        });
    });
    return result;
}

function cardToYaml(card) {
    const obj = { name: card.name };
    if (card.body) obj.body = card.body;
    if (card.color && card.color !== DEFAULT_STORY_COLOR) obj.color = card.color;
    if (card.status) obj.status = card.status;
    if (card.points != null) obj.points = card.points;
    if (card.tags?.length) obj.tags = [...card.tags];
    if (card.url) obj.url = card.url;
    return obj;
}

function cardToJson(card) {
    const obj = { name: card.name || '' };
    if (card.body) obj.body = card.body;
    if (card.color) obj.color = card.color;
    if (card.url) obj.url = card.url;
    if (card.status) obj.status = card.status;
    if (card.points != null) obj.points = card.points;
    if (card.tags?.length) obj.tags = [...card.tags];
    return obj;
}

function slugify(str) {
    return (str || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
