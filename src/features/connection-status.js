// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Tell people when the connection to the server drops, and warn before they close the tab with
// changes that haven't reached the server. Nothing is stored in the browser: edits made offline
// stay in memory and sync when the connection comes back.

import { el } from '/src/core/constants.js';

// Brief drops reconnect on their own, so wait before saying anything
const SHOW_AFTER_MS = 2000;

let _provider = null;
let _ydoc = null;
let _notice = null;
let _showTimer = null;
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
};

const show = () => {
    render();
    _notice.hidden = false;
};

const hide = () => {
    clearTimeout(_showTimer);
    _showTimer = null;
    if (_notice) _notice.hidden = true;
};

const onStatus = ({ status }) => {
    if (status === 'connected') return;
    if (!_showTimer && _notice?.hidden !== false) _showTimer = setTimeout(show, SHOW_AFTER_MS);
};

// Everything in this browser has reached the server again
const onSync = (synced) => {
    if (!synced) return;
    _unsynced = false;
    hide();
};

const onUpdate = (_update, origin) => {
    // Updates from the server carry the provider as their origin
    if (origin === _provider || _provider?.wsconnected) return;
    _unsynced = true;
    if (_notice && !_notice.hidden) render();
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
};

export const unbind = () => {
    _provider?.off('status', onStatus);
    _provider?.off('sync', onSync);
    _ydoc?.off('update', onUpdate);
    window.removeEventListener('beforeunload', onBeforeUnload);
    _provider = null;
    _ydoc = null;
    _unsynced = false;
    hide();
};
