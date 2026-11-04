// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Tell people when the connection to the server drops, and warn before they close the tab with
// changes that haven't reached the server. Nothing is stored in the browser: edits made offline
// stay in memory and sync when the connection comes back.

import { el } from '/src/core/constants.js';

// Brief drops reconnect on their own, so wait before saying anything
const SHOW_AFTER_MS = 2000;
// How long "Back online" stays before it goes
const ONLINE_FOR_MS = 3000;
// After this long with nothing from the server, ask it for a reply, and give up on the
// connection if none comes within the same time again
const QUIET_MS = 3000;
const CHECK_EVERY_MS = 1000;

let _provider = null;
let _ydoc = null;
let _notice = null;
let _showTimer = null;
let _hideTimer = null;
let _checkTimer = null;
// When the server was last asked for a reply, or null when it hasn't been
let _askedAt = null;
// Changes made in this browser since the connection dropped
let _unsynced = false;
// When this browser last changed the map
let _lastEditAt = 0;

const ensureNotice = () => {
    if (_notice) return _notice;
    _notice = el('div', 'connection-notice', { id: 'connectionNotice', hidden: true });
    _notice.setAttribute('role', 'status');
    document.body.appendChild(_notice);
    return _notice;
};

const render = () => {
    const notice = ensureNotice();
    notice.textContent = _unsynced
        ? 'Offline. Your changes will sync when you reconnect.'
        : 'Offline. Reconnecting...';
    notice.classList.toggle('has-changes', _unsynced);
    notice.classList.remove('is-online');
};

const show = () => {
    clearTimeout(_hideTimer);
    _hideTimer = null;
    render();
    _notice.hidden = false;
};

const hide = () => {
    clearTimeout(_showTimer);
    clearTimeout(_hideTimer);
    _showTimer = null;
    _hideTimer = null;
    if (_notice) _notice.hidden = true;
};

// After the offline notice has shown, say the connection is back, and that any changes made
// meanwhile are saved, for a moment. Drops too brief to show the notice stay silent.
const showBackOnline = (hadChanges) => {
    clearTimeout(_showTimer);
    _showTimer = null;
    _notice.textContent = hadChanges ? 'Back online. Your changes are saved.' : 'Back online.';
    _notice.classList.remove('has-changes');
    _notice.classList.add('is-online');
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(hide, ONLINE_FOR_MS);
};

const onStatus = ({ status }) => {
    if (status === 'connected') return;
    if (!_showTimer && _notice?.hidden !== false) _showTimer = setTimeout(show, SHOW_AFTER_MS);
};

// Everything in this browser has reached the server again
const onSync = (synced) => {
    if (!synced) return;
    const hadChanges = _unsynced;
    _unsynced = false;
    if (_notice && !_notice.hidden && !_notice.classList.contains('is-online')) showBackOnline(hadChanges);
    else if (!_notice?.classList.contains('is-online')) hide();
};

const onUpdate = (_update, origin) => {
    // Updates from the server carry the provider as their origin
    if (origin === _provider) return;
    _lastEditAt = Date.now();
    // Until the server has answered since the last (re)connect, a change hasn't reached it
    if (_provider?.synced) return;
    _unsynced = true;
    if (_notice && !_notice.hidden) render();
};

// The socket only notices a lost network after 30 seconds without a message, but the browser
// knows straight away. Drop the connection and say so at once, and reconnect when it's back.
const onOffline = () => {
    _provider?.disconnect();
    clearTimeout(_showTimer);
    _showTimer = null;
    show();
};

const onOnline = () => {
    _provider?.connect();
};

// A lost network doesn't always close the socket, and the browser doesn't always say it's offline
// (on Linux, any other network, such as Docker's, keeps it online). The socket itself only gives up
// after 30 seconds without a message, and when someone is alone on a map the only regular message
// is the echo of their own presence every 15 seconds. So when it goes quiet, send the presence
// again: the server echoes it straight back. No answer means the connection is gone.
const checkConnection = () => {
    const provider = _provider;
    if (!provider?.wsconnected) { _askedAt = null; return; }
    const now = Date.now();
    if (_askedAt !== null) {
        if (provider.wsLastMessageReceived >= _askedAt) _askedAt = null;
        else if (now - _askedAt > QUIET_MS) {
            _askedAt = null;
            // Changes made since the server last answered may not have reached it
            if (_lastEditAt >= provider.wsLastMessageReceived) _unsynced = true;
            // Disconnecting lets go of the socket at once, rather than waiting for a close that a
            // dead network may never finish, so edits from now on count as unsynced. Connecting
            // again keeps trying until the network is back.
            provider.disconnect();
            provider.connect();
            clearTimeout(_showTimer);
            _showTimer = null;
            show();
        }
        return;
    }
    const state = provider.awareness.getLocalState();
    if (state && now - provider.wsLastMessageReceived > QUIET_MS) {
        _askedAt = now;
        provider.awareness.setLocalState(state);
    }
};

const onBeforeUnload = (e) => {
    if (!_unsynced) return;
    e.preventDefault();
    e.returnValue = '';
};

export const bind = (provider, ydoc) => {
    unbind();
    _provider = provider;
    _ydoc = ydoc;
    provider.on('status', onStatus);
    provider.on('sync', onSync);
    ydoc.on('update', onUpdate);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    _checkTimer = setInterval(checkConnection, CHECK_EVERY_MS);
};

export const unbind = () => {
    _provider?.off('status', onStatus);
    _provider?.off('sync', onSync);
    _ydoc?.off('update', onUpdate);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    clearInterval(_checkTimer);
    _checkTimer = null;
    _askedAt = null;
    _provider = null;
    _ydoc = null;
    _unsynced = false;
    hide();
};
