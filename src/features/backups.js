// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Backup CRUD, modal UI, restore/delete, utility functions

import { dom } from '/src/ui/dom.js';
import { state, pushUndo } from '/src/core/state.js';
import { deserialize } from '/src/core/serialization.js';
import { isMapEditable, lockHeaders } from '/src/core/lock.js';
import { escHtml } from '/src/core/constants.js';
import { showAlert, showConfirm, showPrompt, showToast } from '/src/core/modals.js';
import * as log from '/src/core/log.js';
import { closeMainMenu } from '/src/ui/navigation.js';

let _deps = {};

export const init = (deps) => { _deps = deps; };

export const relativeTime = (isoStr) => {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString();
};

export const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
};

// Backup modal
export const showBackupsModal = async () => {
    if (!state.mapId) return;
    dom.createBackupBtn.style.display = isMapEditable() ? '' : 'none';
    dom.backupsModal.classList.add('visible');
    await refreshBackupsList();
};

export const hideBackupsModal = () => {
    dom.backupsModal.classList.remove('visible');
};

export const updateBackupBadge = (count) => {
    if (count > 0) {
        dom.backupCountBadge.textContent = count;
        dom.backupCountBadge.classList.remove('hidden');
    } else {
        dom.backupCountBadge.classList.add('hidden');
    }
};

const refreshBackupsList = async () => {
    try {
        const res = await fetch(`/api/backups/${state.mapId}`);
        const backups = await res.json();
        updateBackupBadge(backups.length);
        if (!backups.length) {
            dom.backupsList.innerHTML = `<div class="backups-empty">
                <svg class="backups-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                <span>No backups yet</span>
            </div>`;
            return;
        }
        const isAuto = (note) => note && note.startsWith('Auto:');
        const editable = isMapEditable();
        const iconSvg = (b) => b.imported
            ? '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>'
            : isAuto(b.note)
            ? '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>'
            : '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>';
        const iconClass = (b) => b.imported ? ' backup-icon-imported' : isAuto(b.note) ? ' backup-icon-auto' : '';
        const label = (b, safeNote) => {
            if (b.imported && safeNote) return safeNote;
            if (b.imported) return 'Imported backup';
            if (safeNote) return safeNote;
            return isAuto(b.note) ? 'Auto backup' : 'Manual backup';
        };
        dom.backupsList.innerHTML = backups.slice().sort((a, c) => new Date(c.timestamp) - new Date(a.timestamp)).map(b => {
            const safeId = escHtml(b.id);
            const safeNote = b.note ? escHtml(b.note) : '';
            return `
            <div class="backup-row" data-id="${safeId}">
                <div class="backup-icon${iconClass(b)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${iconSvg(b)}
                    </svg>
                </div>
                <div class="backup-info">
                    <div class="backup-time">${label(b, safeNote)}</div>
                    ${b.mapName ? `<div class="backup-meta">${b.imported ? '<span class="backup-imported-tag">Imported</span> &middot; ' : ''}${escHtml(b.mapName)}</div>` : (b.imported ? `<div class="backup-meta"><span class="backup-imported-tag">Imported</span></div>` : '')}
                    <div class="backup-meta" title="${new Date(b.timestamp).toLocaleString()}">${relativeTime(b.timestamp)} &middot; ${formatSize(b.size)}${Number(b.cardCount) > 0 ? ` &middot; ${Number(b.cardCount)} cards` : ''}</div>
                </div>
                <div class="backup-actions">
                    ${editable ? `<button class="backup-restore-btn" data-id="${safeId}">Restore</button>` : ''}
                    ${editable ? `<button class="backup-delete-btn" data-id="${safeId}" title="Delete">&times;</button>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch {
        dom.backupsList.innerHTML = '<div class="backups-empty">Failed to load backups</div>';
    }
};

const setCreateBtnLabel = (text) => {
    const svg = dom.createBackupBtn.querySelector('svg');
    dom.createBackupBtn.textContent = '';
    if (svg) dom.createBackupBtn.prepend(svg);
    dom.createBackupBtn.append(text);
};

const createBackup = async () => {
    const note = await showPrompt('Backup note (optional):');
    if (note === null) return;
    try {
        dom.createBackupBtn.disabled = true;
        setCreateBtnLabel('Creating...');
        await fetch(`/api/backups/${state.mapId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        });
        log.logEvent('Created backup');
        await refreshBackupsList();
    } catch {
        await showAlert('Failed to create backup');
    } finally {
        dom.createBackupBtn.disabled = false;
        setCreateBtnLabel('Create Backup');
    }
};

const restoreBackup = async (backupId) => {
    if (!isMapEditable()) {
        await showAlert('Cannot restore while the map is locked.');
        return;
    }
    if (!await showConfirm('Restore this backup? A safety backup of the current state will be created first.')) return;
    try {
        // Create safety backup
        await fetch(`/api/backups/${state.mapId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Auto: before restore' }),
        });
        // Fetch backup data
        const res = await fetch(`/api/backups/${state.mapId}/${backupId}`);
        if (!res.ok) throw new Error('Backup not found');
        const backup = await res.json();
        const data = JSON.parse(backup.data);
        pushUndo();
        deserialize(data);
        dom.boardName.value = state.name;
        _deps.renderAndSave();
        hideBackupsModal();
        log.logEvent('Restored backup');
        showToast('Backup restored');
    } catch {
        await showAlert('Failed to restore backup');
    }
};

const deleteBackup = async (backupId) => {
    if (!await showConfirm('Delete this backup?')) return;
    try {
        await fetch(`/api/backups/${state.mapId}/${backupId}`, { method: 'DELETE', headers: lockHeaders() });
        log.logEvent('Deleted backup');
        await refreshBackupsList();
    } catch {
        await showAlert('Failed to delete backup');
    }
};

export const initListeners = () => {
    dom.backupsBtn.addEventListener('click', () => {
        closeMainMenu();
        showBackupsModal();
    });
    dom.backupsModalClose.addEventListener('click', hideBackupsModal);
    dom.backupsModal.addEventListener('click', (e) => {
        if (e.target === dom.backupsModal) hideBackupsModal();
    });
    dom.createBackupBtn.addEventListener('click', createBackup);
    dom.backupsList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.classList.contains('backup-restore-btn')) restoreBackup(id);
        else if (btn.classList.contains('backup-delete-btn')) deleteBackup(id);
    });
};
