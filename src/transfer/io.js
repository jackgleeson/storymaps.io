// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Import/export orchestration for JSON, YAML, CSV formats

import { dom } from '/src/ui/dom.js';
import { state, initState, pushUndo, confirmOverwrite } from '/src/core/state.js';
import { el } from '/src/core/constants.js';
import { serialize, deserialize, appendImport } from '/src/core/serialization.js';
import { exportToYaml, importFromYaml } from '/src/transfer/yaml.js';
import { exportToCsv, importFromCsv } from '/src/transfer/csv.js';
import { showAlert } from '/src/core/modals.js';
import { isMapEditable, lockState } from '/src/core/lock.js';
import { closeMainMenu, zoomToFit } from '/src/ui/navigation.js';
import * as yjs from '/src/core/yjs.js';
import * as log from '/src/core/log.js';
import * as exportsMod from '/src/transfer/exports.js';
import * as jiraImportsMod from '/src/transfer/jira-imports.js';
import * as asanaImportsMod from '/src/transfer/asana-imports.js';
import * as phabImportsMod from '/src/transfer/phabricator-imports.js';
import * as linearImportsMod from '/src/transfer/linear-imports.js';

let _deps = {};

export const init = (deps) => {
    _deps = deps;

    exportsMod.init({ sanitizeFilename });

    const onImportComplete = async (data, { mode = 'replace' } = {}) => {
        const isFromWelcome = !state.mapId;
        const isAppend = mode === 'append' && !isFromWelcome;

        if (!isFromWelcome && !isAppend) {
            _deps.saveToStorage();
            if (!await confirmOverwrite()) return;
        }

        try {
            if (isFromWelcome) {
                _deps.hideWelcomeScreen();
                initState();
                const mapId = await _deps.newMapId();
                state.mapId = mapId;
                history.replaceState({ mapId }, '', `/${mapId}`);
                await _deps.createYjsDoc(mapId);
            } else {
                await createAutoBackup(isAppend ? 'Auto: before append import' : 'Auto: before import');
                pushUndo();
            }

            if (isAppend) {
                appendImport(data);
            } else {
                deserialize(data);
            }

            if (!isAppend) dom.boardName.value = state.name;
            _deps.renderAndSave();
            log.logEvent(isAppend ? 'Appended import' : 'Imported map');
            requestAnimationFrame(zoomToFit);
            if (isFromWelcome) {
                _deps.subscribeToMap(state.mapId);
            }
        } catch {
            await showAlert('Failed to import: Invalid data format');
        }
    };

    jiraImportsMod.init({ onImportComplete });
    asanaImportsMod.init({ onImportComplete });
    phabImportsMod.init({ onImportComplete });
    linearImportsMod.init({ onImportComplete });
};

// Re-export integration modules for listener wiring in app.js
export { exportsMod, jiraImportsMod, asanaImportsMod, phabImportsMod, linearImportsMod };

// Utility functions
export const sanitizeFilename = (name) => {
    return name
        .toLowerCase()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|-+$/g, '')
        .substring(0, 200)
        || 'story-map';
};

export const formatTimestamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
};

export const importBackupsIfPresent = async (data) => {
    if (!state.mapId || !Array.isArray(data?.backups) || !data.backups.length) return;
    for (const backup of data.backups) {
        try {
            await fetch(`/api/backups/${state.mapId}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backups: [backup] }),
            });
        } catch { /* best-effort */ }
    }
};

export const createAutoBackup = async (note) => {
    if (!state.mapId) return;
    try {
        await fetch(`/api/backups/${state.mapId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note }),
        });
    } catch { /* best-effort */ }
};

const syncImportedNotes = () => {
    const ydoc = yjs.getYdoc();
    if (!ydoc) return;
    const ytext = ydoc.getText('notes');
    ydoc.transact(() => {
        ytext.delete(0, ytext.length);
        if (state.notes) ytext.insert(0, state.notes);
    }, 'local');
};

// Helper for "import from welcome" boilerplate
const doImport = async (deserializeFn) => {
    const isFromWelcome = !state.mapId;

    if (!isFromWelcome) {
        _deps.saveToStorage();
        if (!await confirmOverwrite()) return false;
    }

    try {
        if (isFromWelcome) {
            _deps.hideWelcomeScreen();
            initState();
            const mapId = await _deps.newMapId();
            state.mapId = mapId;
            history.replaceState({ mapId }, '', `/${mapId}`);
            await _deps.createYjsDoc(mapId);
        } else {
            await createAutoBackup('Auto: before import');
            pushUndo();
        }
        deserializeFn();
        dom.boardName.value = state.name;
        _deps.renderAndSave();
        requestAnimationFrame(zoomToFit);
        if (isFromWelcome) {
            _deps.subscribeToMap(state.mapId);
        }
        return true;
    } catch {
        return false;
    }
};

// JSON Import
export const exportMap = () => {
    if (dom.welcomeScreen.classList.contains('visible')) return;
    _deps.saveToStorage();
    showExportModal();
};

export const importMap = async (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            const ok = await doImport(() => deserialize(parsed));
            if (ok) importBackupsIfPresent(parsed);
        } catch {
            await showAlert('Failed to import: Invalid file format');
        }
    };
    reader.readAsText(file);
};

export const showImportModal = () => {
    dom.importModal.classList.add('visible');
    dom.importJsonText.value = '';
    dom.importJsonText.focus();
};

export const hideImportModal = () => {
    dom.importModal.classList.remove('visible');
    dom.importJsonText.value = '';
};

const importFromJsonText = async (jsonText) => {
    try {
        const data = JSON.parse(jsonText);
        const ok = await doImport(() => { deserialize(data); syncImportedNotes(); });
        if (ok) {
            hideImportModal();
            importBackupsIfPresent(data);
        }
    } catch {
        await showAlert('Failed to import: Invalid JSON format');
    }
};

// YAML Import
export const showImportYamlModal = () => {
    dom.importYamlModal.classList.add('visible');
    dom.importYamlText.value = '';
    dom.importYamlValidationError.classList.add('hidden');
    dom.importYamlText.focus();
};

export const hideImportYamlModal = () => {
    dom.importYamlModal.classList.remove('visible');
    dom.importYamlText.value = '';
};

const importFromYamlText = async (yamlText) => {
    dom.importYamlValidationError.classList.add('hidden');

    let data;
    try {
        data = importFromYaml(yamlText);
    } catch (err) {
        if (err.validationErrors) {
            dom.importYamlValidationError.textContent = err.validationErrors.join('\n');
            dom.importYamlValidationError.classList.remove('hidden');
        } else {
            await showAlert('Failed to import: Invalid YAML format');
        }
        return;
    }

    try {
        const ok = await doImport(() => { deserialize(data); syncImportedNotes(); });
        if (ok) {
            hideImportYamlModal();
            importBackupsIfPresent(data);
        }
    } catch {
        await showAlert('Failed to import: Invalid data structure');
    }
};

const importYamlFile = async (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = importFromYaml(e.target.result);
            const ok = await doImport(() => deserialize(data));
            if (ok) importBackupsIfPresent(data);
        } catch (err) {
            const msg = err.validationErrors ? err.validationErrors.join('\n') : 'Invalid YAML format';
            await showAlert('Failed to import: ' + msg);
        }
    };
    reader.readAsText(file);
};

// JSON Export
let _exportBackups = null;

const updateExportJson = () => {
    const minify = dom.exportMinify.checked;
    const data = serialize();
    if (_exportBackups?.length) data.backups = _exportBackups;
    const json = minify ? JSON.stringify(data) : JSON.stringify(data, null, 2);
    dom.exportJsonText.value = json;
};

const showExportModal = async () => {
    _exportBackups = null;
    dom.exportModal.classList.add('visible');
    dom.exportFilename.value = sanitizeFilename(state.name || 'story-map');
    dom.exportMinify.checked = false;
    updateExportJson();
    if (state.mapId) {
        try {
            const res = await fetch(`/api/backups/${state.mapId}`);
            const meta = await res.json();
            if (meta.length) {
                const fullBackups = [];
                for (const b of meta) {
                    const r = await fetch(`/api/backups/${state.mapId}/${b.id}`);
                    if (r.ok) fullBackups.push(await r.json());
                }
                _exportBackups = fullBackups;
                updateExportJson();
            }
        } catch { /* best-effort */ }
    }
};

export const hideExportModal = () => {
    dom.exportModal.classList.remove('visible');
};

const copyExportJson = async () => {
    const json = dom.exportJsonText.value;
    try {
        await navigator.clipboard.writeText(json);
        dom.exportCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCopyBtn.textContent = 'Copy to Clipboard', 2000);
    } catch {
        dom.exportJsonText.select();
        document.execCommand('copy');
        dom.exportCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCopyBtn.textContent = 'Copy to Clipboard', 2000);
    }
};

const downloadExportFile = () => {
    const filename = sanitizeFilename(dom.exportFilename.value) + '.json';
    const json = dom.exportJsonText.value;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideExportModal();
};

// YAML Export
const exportYaml = () => {
    if (dom.welcomeScreen.classList.contains('visible')) return;
    _deps.saveToStorage();
    showExportYamlModal();
};

const showExportYamlModal = async () => {
    dom.exportYamlModal.classList.add('visible');
    dom.exportYamlFilename.value = sanitizeFilename(state.name || 'story-map');
    const data = serialize();
    dom.exportYamlText.value = exportToYaml(data);
    if (state.mapId) {
        try {
            const res = await fetch(`/api/backups/${state.mapId}`);
            const meta = await res.json();
            if (meta.length) {
                const fullBackups = [];
                for (const b of meta) {
                    const r = await fetch(`/api/backups/${state.mapId}/${b.id}`);
                    if (r.ok) fullBackups.push(await r.json());
                }
                data.backups = fullBackups;
                dom.exportYamlText.value = exportToYaml(data);
            }
        } catch { /* best-effort */ }
    }
};

export const hideExportYamlModal = () => {
    dom.exportYamlModal.classList.remove('visible');
};

const copyExportYaml = async () => {
    const yaml = dom.exportYamlText.value;
    try {
        await navigator.clipboard.writeText(yaml);
        dom.exportYamlCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportYamlCopyBtn.textContent = 'Copy to Clipboard', 2000);
    } catch {
        dom.exportYamlText.select();
        document.execCommand('copy');
        dom.exportYamlCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportYamlCopyBtn.textContent = 'Copy to Clipboard', 2000);
    }
};

const downloadExportYamlFile = () => {
    const filename = sanitizeFilename(dom.exportYamlFilename.value) + '.yaml';
    const yaml = dom.exportYamlText.value;
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideExportYamlModal();
};

// CSV Import
export const showImportCsvModal = () => {
    dom.importCsvModal.classList.add('visible');
    dom.importCsvText.value = '';
    dom.importCsvValidationError.classList.add('hidden');
    dom.importCsvText.focus();
};

export const hideImportCsvModal = () => {
    dom.importCsvModal.classList.remove('visible');
    dom.importCsvText.value = '';
};

const importFromCsvText = async (csvText) => {
    dom.importCsvValidationError.classList.add('hidden');

    let data;
    try {
        data = importFromCsv(csvText);
    } catch (err) {
        dom.importCsvValidationError.textContent = err.message;
        dom.importCsvValidationError.classList.remove('hidden');
        return;
    }

    try {
        const ok = await doImport(() => deserialize(data));
        if (ok) hideImportCsvModal();
    } catch {
        await showAlert('Failed to import: Invalid data structure');
    }
};

const importCsvFile = async (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = importFromCsv(e.target.result);
            await doImport(() => deserialize(data));
        } catch (err) {
            await showAlert('Failed to import: ' + (err.message || 'Invalid CSV format'));
        }
    };
    reader.readAsText(file);
};

// CSV Export
const exportCsv = () => {
    if (dom.welcomeScreen.classList.contains('visible')) return;
    _deps.saveToStorage();
    showExportCsvModal();
};

const showExportCsvModal = () => {
    dom.exportCsvModal.classList.add('visible');
    dom.exportCsvFilename.value = sanitizeFilename(state.name || 'story-map');
    const data = serialize();
    dom.exportCsvText.value = exportToCsv(data);
};

export const hideExportCsvModal = () => {
    dom.exportCsvModal.classList.remove('visible');
};

const copyExportCsv = async () => {
    const csv = dom.exportCsvText.value;
    try {
        await navigator.clipboard.writeText(csv);
        dom.exportCsvCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCsvCopyBtn.textContent = 'Copy to Clipboard', 2000);
    } catch {
        dom.exportCsvText.select();
        document.execCommand('copy');
        dom.exportCsvCopyBtn.textContent = 'Copied!';
        setTimeout(() => dom.exportCsvCopyBtn.textContent = 'Copy to Clipboard', 2000);
    }
};

const downloadExportCsvFile = () => {
    const filename = sanitizeFilename(dom.exportCsvFilename.value) + '.csv';
    const csv = dom.exportCsvText.value;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = el('a', null, { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    hideExportCsvModal();
};

// Event listeners for JSON/YAML/CSV import/export modals and menu items
export const initListeners = () => {
    // Import menu items
    dom.importJsonMenuItem.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showImportModal();
    });
    dom.importYamlMenuItem.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showImportYamlModal();
    });
    dom.importCsvMenuItem.addEventListener('click', async () => {
        closeMainMenu();
        if (lockState.isLocked && !lockState.sessionUnlocked) {
            await showAlert('This map is read-only. Unlock it first to import.');
            return;
        }
        showImportCsvModal();
    });

    // Import JSON modal events
    dom.importModalClose.addEventListener('click', hideImportModal);
    dom.importModal.addEventListener('click', (e) => {
        if (e.target === dom.importModal) hideImportModal();
    });
    dom.importJsonBtn.addEventListener('click', () => {
        const jsonText = dom.importJsonText.value.trim();
        if (jsonText) importFromJsonText(jsonText);
    });
    dom.importJsonText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const jsonText = dom.importJsonText.value.trim();
            if (jsonText) importFromJsonText(jsonText);
        }
    });
    dom.importDropzone.addEventListener('click', () => {
        dom.importFileInput.click();
    });
    dom.importFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            hideImportModal();
            importMap(e.target.files[0]);
            e.target.value = '';
        }
    });
    dom.importDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.importDropzone.classList.add('dragover');
    });
    dom.importDropzone.addEventListener('dragleave', () => {
        dom.importDropzone.classList.remove('dragover');
    });
    dom.importDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.importDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            hideImportModal();
            importMap(file);
        }
    });

    // Import YAML modal events
    dom.importYamlModalClose.addEventListener('click', hideImportYamlModal);
    dom.importYamlModal.addEventListener('click', (e) => {
        if (e.target === dom.importYamlModal) hideImportYamlModal();
    });
    dom.importYamlBtn.addEventListener('click', () => {
        const yamlText = dom.importYamlText.value.trim();
        if (yamlText) importFromYamlText(yamlText);
    });
    dom.importYamlText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const yamlText = dom.importYamlText.value.trim();
            if (yamlText) importFromYamlText(yamlText);
        }
    });
    dom.importYamlDropzone.addEventListener('click', () => {
        dom.importYamlFileInput.click();
    });
    dom.importYamlFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            hideImportYamlModal();
            importYamlFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    dom.importYamlDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.importYamlDropzone.classList.add('dragover');
    });
    dom.importYamlDropzone.addEventListener('dragleave', () => {
        dom.importYamlDropzone.classList.remove('dragover');
    });
    dom.importYamlDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.importYamlDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.yaml') || file.name.endsWith('.yml'))) {
            hideImportYamlModal();
            importYamlFile(file);
        }
    });

    // Import CSV modal events
    dom.importCsvModalClose.addEventListener('click', hideImportCsvModal);
    dom.importCsvModal.addEventListener('click', (e) => {
        if (e.target === dom.importCsvModal) hideImportCsvModal();
    });
    dom.importCsvBtn.addEventListener('click', () => {
        const csvText = dom.importCsvText.value.trim();
        if (csvText) importFromCsvText(csvText);
    });
    dom.importCsvText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            const csvText = dom.importCsvText.value.trim();
            if (csvText) importFromCsvText(csvText);
        }
    });
    dom.importCsvDropzone.addEventListener('click', () => {
        dom.importCsvFileInput.click();
    });
    dom.importCsvFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            hideImportCsvModal();
            importCsvFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    dom.importCsvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.importCsvDropzone.classList.add('dragover');
    });
    dom.importCsvDropzone.addEventListener('dragleave', () => {
        dom.importCsvDropzone.classList.remove('dragover');
    });
    dom.importCsvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.importCsvDropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            hideImportCsvModal();
            importCsvFile(file);
        }
    });

    // Export JSON modal events
    dom.exportModalClose.addEventListener('click', hideExportModal);
    dom.exportModal.addEventListener('click', (e) => {
        if (e.target === dom.exportModal) hideExportModal();
    });
    dom.exportMinify.addEventListener('change', updateExportJson);
    dom.exportCopyBtn.addEventListener('click', copyExportJson);
    dom.exportDownloadBtn.addEventListener('click', downloadExportFile);

    // Export YAML modal events
    dom.exportYamlBtn.addEventListener('click', () => {
        closeMainMenu();
        exportYaml();
    });
    dom.exportYamlModalClose.addEventListener('click', hideExportYamlModal);
    dom.exportYamlModal.addEventListener('click', (e) => {
        if (e.target === dom.exportYamlModal) hideExportYamlModal();
    });
    dom.exportYamlCopyBtn.addEventListener('click', copyExportYaml);
    dom.exportYamlDownloadBtn.addEventListener('click', downloadExportYamlFile);

    // Export CSV modal events
    dom.exportCsvBtn.addEventListener('click', () => {
        closeMainMenu();
        exportCsv();
    });
    dom.exportCsvModalClose.addEventListener('click', hideExportCsvModal);
    dom.exportCsvModal.addEventListener('click', (e) => {
        if (e.target === dom.exportCsvModal) hideExportCsvModal();
    });
    dom.exportCsvCopyBtn.addEventListener('click', copyExportCsv);
    dom.exportCsvDownloadBtn.addEventListener('click', downloadExportCsvFile);
};
