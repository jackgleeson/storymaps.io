// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Tell people when the connection to the server drops, and warn before they close the tab with
// changes that haven't reached the server. Nothing is stored in the browser: edits made offline
// stay in memory and sync when the connection comes back.

import { el } from '/src/core/constants.js';

// Brief drops reconnect on their own, so wait before saying anything
const SHOW_AFTER_MS = 2000;
// How long "Back online" stays before it goes
const ONLINE_FOR_MS = 3000;

let _provider = null;
let _ydoc = null;
let _notice = null;
let _showTimer = null;
let _hideTimer = null;
// Changes made in this browser since the connection dropped
let _unsynced = false;

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
    if (origin === _provider || _provider?.wsconnected) return;
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
};

export const unbind = () => {
    _provider?.off('status', onStatus);
    _provider?.off('sync', onSync);
    _ydoc?.off('update', onUpdate);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    _provider = null;
    _ydoc = null;
    _unsynced = false;
    hide();
};
