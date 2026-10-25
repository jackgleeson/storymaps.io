// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Log — real-time feed of map edits synced via Yjs Y.Array

import { getSessionId, getCursorColor, getPresenceName } from '/src/ui/presence.js';

const MAX_ENTRIES = 20;

export const quoted = (name, max = 30) => {
    if (!name) return '';
    const trimmed = name.length > max ? name.slice(0, max) + '...' : name;
    return ` "${trimmed}"`;
};

const _isMobile = window.matchMedia('(pointer: coarse)').matches;

let _yarray = null;
let _observer = null;
let _container = null;

// Header stats: dates and edit count come from the server, the rest from the log and presence
let _statsEl = null;
let _awareness = null;
let _mapId = null;
let _meta = null;
let _metaTimer = null;
let _tickTimer = null;

const isPanelOpen = () => document.getElementById('logPanel')?.classList.contains('open');

export const init = () => {
    _container = document.getElementById('logList');
    _statsEl = document.getElementById('logStats');

    // Only fetch while the Log panel is open, so viewers who never open it make no extra requests.
    // Re-render every minute while open so "last updated" stays current.
    const panel = document.getElementById('logPanel');
    if (panel) {
        new MutationObserver(() => {
            if (isPanelOpen()) {
                fetchMeta();
                if (!_tickTimer) _tickTimer = setInterval(renderStats, 60_000);
            } else {
                clearInterval(_tickTimer);
                _tickTimer = null;
            }
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
};

/**
 * Attach to a Yjs doc's Y.Array('log').
 */
export const bindYjs = (ydoc, provider = null, mapId = null) => {
    unbindYjs();
    _yarray = ydoc.getArray('log');
    _awareness = provider?.awareness || null;
    _mapId = mapId;

    _observer = () => {
        render();
        scheduleMetaRefresh();
    };
    _yarray.observe(_observer);
    _awareness?.on('change', renderStats);

    render();
    if (isPanelOpen()) fetchMeta();
};

/**
 * Detach from Yjs doc.
 */
export const unbindYjs = () => {
    // Log a pending edit into the map it was made in, not the next one opened
    flushTextEdit();
    if (_yarray && _observer) {
        _yarray.unobserve(_observer);
    }
    _yarray = null;
    _observer = null;
    _awareness?.off('change', renderStats);
    _awareness = null;
    _mapId = null;
    _meta = null;
    clearTimeout(_metaTimer);
    if (_container) _container.innerHTML = '';
    if (_statsEl) _statsEl.innerHTML = '';
};

const fetchMeta = async () => {
    const mapId = _mapId;
    if (!mapId) return;
    try {
        const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}/meta`);
        if (!res.ok || mapId !== _mapId) return;
        _meta = await res.json();
        renderStats();
    } catch {
        // Offline or server unreachable: the header shows what it can from the log and presence
    }
};

// The server saves updated_at 2s after the last change, so wait a little longer before asking
const scheduleMetaRefresh = () => {
    if (!isPanelOpen()) return;
    clearTimeout(_metaTimer);
    _metaTimer = setTimeout(fetchMeta, 3000);
};

const contributorName = (entry) => {
    if (entry.src === 'cli') return 'CLI';
    if (entry.src === 'mobile') return 'Mobile user';
    if (entry.sid === getSessionId()) return 'You';
    return entry.name || 'Web user';
};

const renderStats = () => {
    if (!_statsEl || !_yarray) return;
    const entries = _yarray.toArray();
    const rows = [];

    if (_meta?.created_at) rows.push(['Created', formatDate(_meta.created_at), _meta.created_at]);

    // Last edit = newest activity-log entry. The server's updated_at also moves when a map is
    // just opened (useful for activity stats), so it can't say when the map was last edited.
    const editedTs = entries.length ? entries[entries.length - 1].ts : 0;
    if (editedTs) rows.push(['Last edited', formatAgo(editedTs), new Date(editedTs).toISOString()]);

    const here = _awareness ? _awareness.getStates().size : 0;
    if (here) rows.push(['Here now', `${here} ${here === 1 ? 'person' : 'people'}`, null, 'log-stats-live']);

    const names = [];
    [...entries].reverse().forEach(entry => {
        const name = contributorName(entry);
        if (!names.includes(name)) names.push(name);
    });
    if (names.length) {
        const extra = names.length > 4 ? ` +${names.length - 4}` : '';
        rows.push(['Recent', names.slice(0, 4).join(', ') + extra]);
    }

    if (_meta) {
        // Maps older than the edit counter only have edits since it was added
        const since = _meta.edits_since && _meta.created_at && _meta.edits_since > _meta.created_at
            ? ` since ${formatDate(_meta.edits_since)}` : '';
        rows.push(['Edits', `${_meta.edit_count}${since}`]);
    }

    _statsEl.innerHTML = '';
    if (rows.length === 0) return;
    const list = document.createElement('dl');
    list.className = 'log-stats-list';
    rows.forEach(([label, value, isoTitle, className]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        if (className) dd.className = className;
        if (isoTitle) dd.title = new Date(isoTitle).toLocaleString();
        list.append(dt, dd);
    });
    _statsEl.appendChild(list);
};

/**
 * Log an event. Syncs to all clients via Yjs.
 * @param {string} text — short description, e.g. "Added step"
 * @param {string[]} ids — affected element IDs for hover-highlight
 */
export const logEvent = (text, ids = []) => {
    if (!_yarray) return;

    const entry = {
        ts: Date.now(),
        src: _isMobile ? 'mobile' : 'web',
        text,
        sid: getSessionId(),
        name: getPresenceName(),
        ids,
    };

    _yarray.doc.transact(() => {
        _yarray.push([entry]);
        // Trim oldest entries beyond limit
        while (_yarray.length > MAX_ENTRIES) {
            _yarray.delete(0);
        }
    }, 'local');
};

/**
 * Debounced text-edit logger. Waits 2s of inactivity before logging.
 * Moving on to another item logs the pending edit straight away, so it isn't lost.
 */
let _textEditTimer = null;
let _textEdit = null;

const flushTextEdit = () => {
    clearTimeout(_textEditTimer);
    if (_textEdit) logEvent(`Edited ${_textEdit.label}`, [_textEdit.itemId]);
    _textEdit = null;
};

export const logTextEdit = (label, itemId) => {
    if (_textEdit && (_textEdit.itemId !== itemId || _textEdit.label !== label)) flushTextEdit();
    _textEdit = { label, itemId };
    clearTimeout(_textEditTimer);
    _textEditTimer = setTimeout(flushTextEdit, 2000);
};

/**
 * Render the log list into the DOM container.
 */
const render = () => {
    if (!_container || !_yarray) return;
    renderStats();

    const entries = _yarray.toArray();

    if (entries.length === 0) {
        _container.innerHTML = '<div class="log-empty">No activity yet</div>';
        return;
    }

    // Newest first
    const sorted = [...entries].reverse();

    _container.innerHTML = '';

    sorted.forEach(entry => {
        const color = /^[a-f0-9-]{36}$/i.test(entry.sid) ? getCursorColor(entry.sid) : '#888';
        const safeColor = /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : '#888';
        const time = formatTime(entry.ts);
        const isMe = entry.sid === getSessionId();
        const source = entry.src === 'cli' ? ''
            : entry.src === 'mobile' ? ''
            : isMe ? 'You' : (entry.name || 'Web user');
        const safeText = escapeHtml(source ? `${source}: ${entry.text}` : entry.text);

        const row = document.createElement('div');
        row.className = 'log-entry';
        const ids = entry.ids || [];

        let srcIcon = '';
        if (entry.src === 'cli') {
            srcIcon = '<svg class="log-src-icon" viewBox="0 0 16 16" width="12" height="12"><path d="M2 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        } else if (entry.src === 'mobile') {
            srcIcon = '<span class="log-src-icon">📱</span>';
        }

        row.innerHTML =
            `<span class="log-dot" style="background:${safeColor}"></span>` +
            `<span class="log-time">${time}</span>` +
            `${srcIcon}` +
            `<span class="log-text">${safeText}</span>`;

        if (ids.length > 0) {
            row.classList.add('log-locatable');

            row.addEventListener('mouseenter', () => {
                for (const id of ids) {
                    document.querySelectorAll(
                        `[data-story-id="${id}"], [data-column-id="${id}"], [data-slice-id="${id}"]`
                    ).forEach(el => {
                        el.classList.add('log-highlight');
                    });
                }
            });
            row.addEventListener('mouseleave', () => {
                document.querySelectorAll('.log-highlight').forEach(el => {
                    el.classList.remove('log-highlight');
                });
            });
        }

        _container.appendChild(row);
    });
};

const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    // If same day, show just time
    if (d.toDateString() === now.toDateString()) return time;

    // Otherwise show date + time
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
};

const formatDate = (value) =>
    new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const formatAgo = (ts) => {
    const minutes = Math.floor((Date.now() - ts) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return formatDate(ts);
};

const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
