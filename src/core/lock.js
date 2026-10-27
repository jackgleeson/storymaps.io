// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Lock feature — password-protect maps

import { showAlert, showConfirm } from '/src/core/modals.js';

let _state = null;
let _dom = null;
let _getProvider = null;
let _getYdoc = null;
let _getCursorColor = null;
let _render = null;
let _notepadUpdate = null;
let _saveToStorage = null;
let _closeMainMenu = null;
let _initSortable = null;
let _renderLegend = null;
let _logEvent = null;

// Lock state - tracks whether map is locked and if current session has unlocked it
export const lockState = {
    isLocked: false,
    passwordHash: null,
    sessionUnlocked: false  // True if this session has successfully unlocked
};

let lockPollInterval = null;

// Track previous editability to avoid unnecessary sortable reinit
let wasEditable = true;

export const init = ({ state, getProvider, getYdoc, getCursorColor, render, notepadUpdate, saveToStorage, closeMainMenu, initSortable, renderLegend, logEvent }) => {
    _state = state;
    _dom = {
        lockMapBtn: document.getElementById('lockMapBtn'),
        readOnlyBanner: document.getElementById('readOnlyBanner'),
        relockBtn: document.getElementById('relockBtn'),
        updatePasswordBtn: document.getElementById('updatePasswordBtn'),
        removeLockBtn: document.getElementById('removeLockBtn'),
        lockDivider: document.getElementById('lockDivider'),
        samplesSubmenuTrigger: document.getElementById('samplesSubmenuTrigger'),
        importSubmenuTrigger: document.getElementById('importSubmenuTrigger'),
        lockModal: document.getElementById('lockModal'),
        lockModalTitle: document.getElementById('lockModalTitle'),
        lockModalDescription: document.getElementById('lockModalDescription'),
        lockModalClose: document.getElementById('lockModalClose'),
        lockModalCancel: document.getElementById('lockModalCancel'),
        lockModalConfirm: document.getElementById('lockModalConfirm'),
        lockPasswordInput: document.getElementById('lockPasswordInput'),
    };
    _getProvider = getProvider;
    _getYdoc = getYdoc;
    _getCursorColor = getCursorColor;
    _render = render;
    _notepadUpdate = notepadUpdate;
    _saveToStorage = saveToStorage;
    _closeMainMenu = closeMainMenu;
    _initSortable = initSortable;
    _renderLegend = renderLegend;
    _logEvent = logEvent;
};

// Hash password using SHA-256
const hashPassword = async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Check if map is effectively editable (not locked, or unlocked by this session)
export const isMapEditable = () => {
    if (!lockState.isLocked) return true;
    return lockState.sessionUnlocked;
};

// Load lock state from server
export const loadLockState = async (mapId) => {
    if (!mapId) return;
    try {
        const res = await fetch(`/api/lock/${mapId}`);
        const data = await res.json();
        if (data) {
            lockState.isLocked = !!data.isLocked;
        }
    } catch (err) {
        console.error('Failed to load lock state:', err);
    }
};

// Poll lock state changes from server
export const subscribeLockState = (mapId) => {
    if (!mapId) return;

    if (lockPollInterval) {
        clearInterval(lockPollInterval);
    }

    const pollLock = async () => {
        try {
            const res = await fetch(`/api/lock/${mapId}`);
            const data = await res.json();
            if (data) {
                const wasLocked = lockState.isLocked;
                lockState.isLocked = !!data.isLocked;

                if (!wasLocked && lockState.isLocked) {
                    restoreSessionUnlock(mapId);
                }
            } else {
                lockState.isLocked = false;
            }
            updateLockUI();
            updateEditability();
        } catch {
            // Silently fail - will retry on next poll
        }
    };

    lockPollInterval = setInterval(pollLock, 3000);
};

// Clear lock poll
export const clearLockSubscription = () => {
    if (lockPollInterval) {
        clearInterval(lockPollInterval);
        lockPollInterval = null;
    }
    lockState.isLocked = false;
    lockState.passwordHash = null;
    lockState.sessionUnlocked = false;
};

// Save the unlock to session storage. The password hash is kept (not just true) so that after a
// reload this tab can still change or remove the lock.
const saveSessionUnlock = (mapId, hash) => {
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    unlockedMaps[mapId] = hash;
    sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));
};

// Restore this tab's unlock, and the password hash when it was saved (older entries are just true)
export const restoreSessionUnlock = (mapId) => {
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    lockState.sessionUnlocked = !!unlockedMaps[mapId];
    if (typeof unlockedMaps[mapId] === 'string') lockState.passwordHash = unlockedMaps[mapId];
};

// Lock the map with a password
const lockMap = async (password) => {
    if (!_state.mapId) return;

    const hash = await hashPassword(password);

    try {
        const res = await fetch(`/api/lock/${_state.mapId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // The current password lets this tab change the password of a map it has unlocked
            body: JSON.stringify({ passwordHash: hash, currentPasswordHash: lockState.passwordHash || undefined }),
        });
        if (res.status === 403) {
            const message = lockState.sessionUnlocked && !lockState.passwordHash
                ? 'Unlock the map again to change its lock.'
                : 'This map has already been locked by someone else.';
            await loadLockState(_state.mapId);
            updateLockUI();
            updateEditability();
            await showAlert(message);
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        lockState.isLocked = true;
        lockState.passwordHash = hash;
        lockState.sessionUnlocked = true;
        saveSessionUnlock(_state.mapId, hash);

        // Broadcast lock state change via awareness so other clients update immediately
        const provider = _getProvider();
        if (provider) {
            provider.awareness.setLocalStateField('lock', { isLocked: true, at: Date.now() });
        }

        _logEvent?.('Locked map');
        updateLockUI();
        updateEditability();

        await showAlert('Map is now read-only. Others will need the password to edit, but you can continue editing in this session.');
    } catch (err) {
        console.error('Failed to lock map:', err);
        await showAlert('Failed to lock map. Please try again.');
    }
};

// Remove lock entirely (make map publicly editable again)
export const removeLock = async () => {
    if (!_state.mapId) return;
    if (!lockState.passwordHash) {
        await showAlert('Unlock the map again to remove its lock.');
        return;
    }

    try {
        const res = await fetch(`/api/lock/${_state.mapId}/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: lockState.passwordHash }),
        });
        const data = await res.json();
        if (!data.ok) {
            await showAlert('Failed to remove lock.');
            return;
        }

        lockState.isLocked = false;
        lockState.passwordHash = null;
        lockState.sessionUnlocked = false;

        // Clear from session storage
        const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
        delete unlockedMaps[_state.mapId];
        sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));

        // Broadcast unlock via awareness
        const provider = _getProvider();
        if (provider) {
            provider.awareness.setLocalStateField('lock', { isLocked: false, at: Date.now() });
        }

        _logEvent?.('Removed map lock');
        updateLockUI();
        updateEditability();
    } catch (err) {
        console.error('Failed to remove lock:', err);
        await showAlert('Failed to remove lock. Please try again.');
    }
};

// Re-lock the map (for users who have already unlocked)
const relockMap = async () => {
    if (!_state.mapId || !lockState.passwordHash) return;

    try {
        await fetch(`/api/lock/${_state.mapId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: lockState.passwordHash }),
        });

        lockState.isLocked = true;

        const provider = _getProvider();
        if (provider) {
            provider.awareness.setLocalStateField('lock', { isLocked: true, at: Date.now() });
        }

        _logEvent?.('Locked map');
        updateLockUI();
        updateEditability();
    } catch (err) {
        console.error('Failed to re-lock map:', err);
        await showAlert('Failed to lock map. Please try again.');
    }
};

// Unlock map (verify password server-side)
const unlockMap = async (password) => {
    const inputHash = await hashPassword(password);

    try {
        const res = await fetch(`/api/lock/${_state.mapId}/unlock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passwordHash: inputHash }),
        });
        const data = await res.json();
        if (!data.ok) return false;
    } catch {
        return false;
    }

    lockState.passwordHash = inputHash;
    lockState.sessionUnlocked = true;
    saveSessionUnlock(_state.mapId, inputHash);
    _logEvent?.('Unlocked map');
    updateLockUI();
    updateEditability();
    return true;
};

// Update lock menu item and banner UI
export const updateLockUI = () => {
    if (!_dom.lockMapBtn || !_dom.readOnlyBanner) return;

    // Only show lock option when viewing a shared map
    if (!_state.mapId) {
        _dom.lockMapBtn.classList.remove('visible');
        _dom.relockBtn.classList.remove('visible');
        _dom.updatePasswordBtn.classList.remove('visible');
        _dom.removeLockBtn.classList.remove('visible');
        _dom.lockDivider.classList.remove('visible');
        _dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        return;
    }

    _dom.lockDivider.classList.add('visible');

    if (lockState.isLocked && !lockState.sessionUnlocked) {
        _dom.lockMapBtn.classList.add('visible');
        _dom.lockMapBtn.innerHTML = '<span class="lock-menu-icon">🔒</span> Unlock Map';
        _dom.relockBtn.classList.remove('visible');
        _dom.updatePasswordBtn.classList.remove('visible');
        _dom.removeLockBtn.classList.remove('visible');
        _dom.readOnlyBanner.classList.add('visible');
        document.body.classList.add('read-only-mode');
        _dom.samplesSubmenuTrigger?.classList.add('disabled');
        _dom.importSubmenuTrigger?.classList.add('disabled');
    } else if (lockState.isLocked && lockState.sessionUnlocked) {
        _dom.lockMapBtn.classList.remove('visible');
        _dom.relockBtn.classList.add('visible');
        _dom.updatePasswordBtn.classList.add('visible');
        _dom.removeLockBtn.classList.add('visible');
        _dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        _dom.samplesSubmenuTrigger?.classList.remove('disabled');
        _dom.importSubmenuTrigger?.classList.remove('disabled');
    } else {
        _dom.lockMapBtn.classList.add('visible');
        _dom.lockMapBtn.innerHTML = '<span class="lock-menu-icon">🔓</span> Lock Map (Read-only)';
        _dom.relockBtn.classList.remove('visible');
        _dom.updatePasswordBtn.classList.remove('visible');
        _dom.removeLockBtn.classList.remove('visible');
        _dom.readOnlyBanner.classList.remove('visible');
        document.body.classList.remove('read-only-mode');
        _dom.samplesSubmenuTrigger?.classList.remove('disabled');
        _dom.importSubmenuTrigger?.classList.remove('disabled');
    }
};

// Fields that never edit the map, so typing in them is fine on a locked map: dialogs (including the
// lock password), search and its filters, and the project boxes. This runs on every lock check, so
// blurring them would pull focus out mid-word every few seconds.
const NOT_MAP_FIELDS = '.modal-overlay, .search-bar, .filter-panel, #projectPanel';

// Enable/disable editing based on lock state
export const updateEditability = () => {
    const editable = isMapEditable();

    if (!editable) {
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
            if (active !== _dom.lockPasswordInput && !active.closest(NOT_MAP_FIELDS)) {
                active.blur();
            }
        }
    }

    // Only reinit sortable if editability changed
    if (editable !== wasEditable) {
        wasEditable = editable;
        _initSortable();
        _renderLegend();
        _notepadUpdate();
    }
};

// Show lock modal
const showLockModal = (mode) => {
    if (!_dom.lockModal) return;

    _dom.lockPasswordInput.value = '';
    const noteEl = document.getElementById('lockModalNote');

    if (mode === 'lock') {
        _dom.lockModalTitle.textContent = 'Lock This Map';
        _dom.lockModalDescription.textContent = 'Create a password to make this map read-only. Anyone with the password can unlock it to edit.';
        _dom.lockModalConfirm.textContent = 'Lock Map';
        if (noteEl) noteEl.style.display = 'block';
    } else if (mode === 'relock') {
        _dom.lockModalTitle.textContent = 'Change Password';
        _dom.lockModalDescription.textContent = 'Set a new password for this read-only map. The old password will no longer work.';
        _dom.lockModalConfirm.textContent = 'Set New Password';
        if (noteEl) noteEl.style.display = 'block';
    } else {
        _dom.lockModalTitle.textContent = 'Unlock This Map';
        _dom.lockModalDescription.textContent = 'This map is read-only. Enter the password to unlock it and enable editing.';
        _dom.lockModalConfirm.textContent = 'Unlock';
        if (noteEl) noteEl.style.display = 'none';
    }

    _dom.lockModal.classList.add('visible');
    _dom.lockModal.dataset.mode = mode;
    _dom.lockPasswordInput.focus();
};

// Hide lock modal
export const hideLockModal = () => {
    if (!_dom.lockModal) return;
    _dom.lockModal.classList.remove('visible');
    _dom.lockPasswordInput.value = '';
};

// Handle lock button click (Lock Map / Unlock Map)
const handleLockButtonClick = () => {
    if (lockState.isLocked && !lockState.sessionUnlocked) {
        showLockModal('unlock');
    } else {
        showLockModal('lock');
    }
};

// Handle re-lock button click (lock again with existing password)
const handleRelockClick = async () => {
    await relockMap();
    lockState.sessionUnlocked = false;
    const unlockedMaps = JSON.parse(sessionStorage.getItem('unlockedMaps') || '{}');
    delete unlockedMaps[_state.mapId];
    sessionStorage.setItem('unlockedMaps', JSON.stringify(unlockedMaps));
    updateLockUI();
    updateEditability();
};

// Handle update password button click
const handleUpdatePasswordClick = () => {
    showLockModal('relock');
};

// Handle lock modal confirm
const handleLockModalConfirm = async () => {
    const password = _dom.lockPasswordInput.value.trim();
    const mode = _dom.lockModal.dataset.mode;

    if (!password) {
        await showAlert('Please enter a password.');
        return;
    }

    if (mode === 'lock' || mode === 'relock') {
        if (password.length < 4) {
            await showAlert('Password must be at least 4 characters.');
            return;
        }
        await lockMap(password);
        hideLockModal();
    } else {
        const success = await unlockMap(password);
        if (success) {
            hideLockModal();
        } else {
            await showAlert('Incorrect password. Please try again.');
            _dom.lockPasswordInput.value = '';
            _dom.lockPasswordInput.focus();
        }
    }
};

// Initialize lock event listeners
export const initLockListeners = () => {
    if (_dom.lockMapBtn) {
        _dom.lockMapBtn.addEventListener('click', () => {
            _closeMainMenu();
            handleLockButtonClick();
        });
    }

    if (_dom.relockBtn) {
        _dom.relockBtn.addEventListener('click', () => {
            _closeMainMenu();
            handleRelockClick();
        });
    }

    if (_dom.updatePasswordBtn) {
        _dom.updatePasswordBtn.addEventListener('click', () => {
            _closeMainMenu();
            handleUpdatePasswordClick();
        });
    }

    if (_dom.removeLockBtn) {
        _dom.removeLockBtn.addEventListener('click', async () => {
            _closeMainMenu();
            if (await showConfirm('Remove read-only lock? Anyone with the link will be able to edit this map.')) {
                removeLock();
            }
        });
    }

    if (_dom.lockModalClose) {
        _dom.lockModalClose.addEventListener('click', hideLockModal);
    }

    if (_dom.lockModalCancel) {
        _dom.lockModalCancel.addEventListener('click', hideLockModal);
    }

    if (_dom.lockModalConfirm) {
        _dom.lockModalConfirm.addEventListener('click', handleLockModalConfirm);
    }

    if (_dom.lockPasswordInput) {
        _dom.lockPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLockModalConfirm();
            }
        });
    }

    if (_dom.lockModal) {
        _dom.lockModal.addEventListener('click', (e) => {
            if (e.target === _dom.lockModal) {
                hideLockModal();
            }
        });
    }
};
