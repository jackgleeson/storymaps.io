// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Story line chips for the expanded card body: a user story, a scenario, or an acceptance criteria list

export const STORY_LINES = {
    story: { lines: ['As a ', 'I want ', 'So that '], caretLine: 0 },
    scenario: { lines: ['Given ', 'When ', 'Then '], caretLine: 0 },
    criteria: { lines: ['Acceptance criteria', '- '], caretLine: 1 },
};

// Lines that Enter jumps to while they hold only their opening words
const CHAINED = ['I want ', 'So that ', 'When ', 'Then '];

const lineBounds = (text, at) => {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    const end = text.indexOf('\n', at);
    return { start, end: end === -1 ? text.length : end };
};

// Add a set of lines after the line the cursor is on, or on that line when it's empty, with a blank
// line between them and any text around them. Returns the range to replace, the text to put there,
// and where the cursor goes: the end of the line numbered caretLine.
export const addLines = (text, at, { lines, caretLine }) => {
    const line = lineBounds(text, at);
    const empty = text.slice(line.start, line.end).trim() === '';
    const from = empty ? line.start : line.end;
    const to = line.end;
    const before = text.slice(0, from);
    const after = text.slice(to);
    const lead = !before.trim() || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = !after.trim() || after.startsWith('\n\n') ? '' : '\n';
    const insert = lead + lines.join('\n') + trail;
    const caret = from + lead.length + lines.slice(0, caretLine + 1).join('\n').length;
    return { from, to, insert, caret };
};

// What Enter does at the cursor, or null to let it add a new line as usual. At the end of a line
// followed by an unfilled chained line, it moves to the end of that line. In a "- " list it starts
// the next item, and on an empty item it ends the list.
export const enterAction = (text, start, end) => {
    if (start !== end) return null;
    const line = lineBounds(text, start);
    if (start !== line.end) return null;
    if (line.end < text.length) {
        const next = lineBounds(text, line.end + 1);
        if (CHAINED.includes(text.slice(next.start, next.end))) return { caret: next.end };
    }
    const current = text.slice(line.start, line.end);
    if (!current.startsWith('- ')) return null;
    if (current.trim() === '-') return { from: line.start, to: line.end, insert: '', caret: line.start };
    return { from: start, to: start, insert: '\n- ', caret: start + 3 };
};
