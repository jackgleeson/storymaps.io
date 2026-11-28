// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Page view counts, button clicks and copies of the CLI install command with Umami Cloud, on
// storymaps.io only. A self-hosted copy, the dev server and the tests send nothing. Umami uses no
// cookies. All the tracking is in this file: the app loads it, and so do the docs and site pages
// (public/docs/docs.js), for their page views and for the commands people copy from them.

const WEBSITE_ID = '4c921c04-1a31-41cc-85b5-26b9e2e75451';
const LIVE_HOSTNAME = 'storymaps.io';

// The command that installs the CLI, wherever a page shows it
const CLI_INSTALL = 'npm install -g storymaps';
export const CLI_INSTALL_COPIED = 'cli-install-copied';
export const installsCli = (text) => (text || '').includes(CLI_INSTALL);

// The buttons to count: [selector, event name, text the button must start with]. These count
// clicks, so an action someone cancels or that fails afterwards still counts. Only ever send the
// name of the button, nothing from the map itself.
export const CLICKS = [
    // Getting started
    ['#newMapBtn, #welcomeNewBtn', 'map-created'],
    ['[data-sample]', (el) => `sample-${el.dataset.sample}`],
    ['#tourMenuBtn, #welcomeTourBtn', 'tour-started'],
    ['.tour-btn-next', 'tour-finished', 'Finish'],

    // Recent maps: opening the list, then picking a map from it
    ['#recentMapsBtn', 'recent-maps-homepage'],
    ['#recentSubmenuTrigger', 'recent-maps-menu'],
    ['a.recent-row', 'recent-map-opened-homepage'],
    ['a.recent-menu-item', 'recent-map-opened-menu'],

    // Sharing
    ['#shareCopyLink', 'map-link-shared'],
    ['#shareProjectLink', 'project-link-shared'],
    ['#shareScreenshot', 'map-image-copied'],
    ['#shareDownload', 'map-image-downloaded'],
    ['.canvas-context-menu button, .options-item', 'card-link-copied', 'Copy link to card'],
    ['#cardExpandCopyLink', 'card-link-copied'],
    ['.canvas-context-menu button', 'slice-link-copied', 'Copy link to slice'],

    // Imports, on the home page
    ['[data-import]', (el) => `import-${el.dataset.import}-homepage`],

    // Imports, in the main menu
    ['#importJsonMenuItem', 'import-json'],
    ['#importYamlMenuItem', 'import-yaml'],
    ['#importCsvMenuItem', 'import-csv'],
    ['#importJiraBtn', 'import-jira'],
    ['#importJiraCsvBtn', 'import-jira-csv'],
    ['#importAsanaBtn', 'import-asana'],
    ['#importAsanaCsvBtn', 'import-asana-csv'],
    ['#importPhabBtn', 'import-phabricator'],
    ['#importPhabCsvBtn', 'import-phabricator-csv'],
    ['#importLinearBtn', 'import-linear'],
    ['#importLinearCsvBtn', 'import-linear-csv'],
    ['#importAzureBtn', 'import-azure-devops'],
    ['#importAzureCsvBtn', 'import-azure-devops-csv'],

    // Inside an issue tracker import window (the events above are for opening it)
    ['[id$="ImportFetchBtn"], [id$="ImportParseBtn"], [id$="ImportConfirmBtn"]', (el) => importStep(el.id)],

    // Exports, on the button that does the export
    ['#exportCopyBtn, #exportDownloadBtn', 'export-json'],
    ['#exportYamlCopyBtn, #exportYamlDownloadBtn', 'export-yaml'],
    ['#exportCsvCopyBtn, #exportCsvDownloadBtn', 'export-csv'],
    ['#jiraExportDownload', 'export-jira-csv'],
    ['#asanaCsvExportDownload', 'export-asana-csv'],
    ['#azureExportDownload', 'export-azure-devops-csv'],
    ['#jiraProxyExportRun', 'export-jira'],
    ['#asanaProxyExportRun', 'export-asana'],
    ['#phabProxyExportRun', 'export-phabricator'],
    ['#linearProxyExportRun', 'export-linear'],
    ['#azureProxyExportRun', 'export-azure-devops'],
    ['#phabExportDone', 'export-phabricator-script'],

    // Keeping work
    ['#createBackupBtn', 'backup-created'],
    ['.backup-restore-btn', 'backup-restored'],
    ['#lockModalConfirm', 'map-locked', 'Lock Map'],

    // Getting the CLI: the Copy button on the command that installs it, on the Developers page
    // and the CLI docs. There is nothing to download, so copying that command is the nearest sign.
    ['.code-copy', (el) => (installsCli(el.closest('figure')?.textContent) ? CLI_INSTALL_COPIED : null)],

    // Other
    ['.project-panel-primary', 'project-created', 'Create project'],
    ['#buildAiBtn', 'build-with-ai'],
    ['#buildAiCopy', 'ai-prompt-copied'],
];

// The steps inside an issue tracker import window. Fetch (through the API) and Continue (a file)
// lead to the review step, and Import to Map is the last click. The last click has no way of its
// own to tell a file from the API, so it is named after the way in that was clicked before it.
const IMPORT_TRACKERS = { jira: 'jira', asana: 'asana', phab: 'phabricator', linear: 'linear', azure: 'azure-devops' };
const _importRoute = {};
export const importStep = (id) => {
    const [, key, csv, step] = /^(jira|asana|phab|linear|azure)(Csv)?Import(Fetch|Parse|Confirm)Btn$/.exec(id || '') || [];
    if (!key) return null;
    const tracker = IMPORT_TRACKERS[key];
    if (step === 'Confirm') return `import-${tracker}${_importRoute[tracker] || ''}-confirmed`;
    _importRoute[tracker] = csv ? '-csv' : '';
    return `import-${tracker}${_importRoute[tracker]}-continued`;
};

// The event for a click on this element, or null if it isn't one of the buttons above
export const clickEvent = (target) => {
    for (const [selector, name, text] of CLICKS) {
        const button = target.closest?.(selector);
        if (button && (!text || button.textContent.trim().startsWith(text))) {
            return typeof name === 'function' ? name(button) : name;
        }
    }
    return null;
};

// Listens before the buttons' own handlers, as some of them stop the click going any further
export const trackClicks = () => {
    document.addEventListener('click', (e) => {
        const name = clickEvent(e.target);
        if (name === CLI_INSTALL_COPIED) _installCounted = Date.now();
        if (name) window.umami?.track(name);
    }, { capture: true });
};

// Many people select a command and copy it by hand instead of using the Copy button. That counts
// too. Only the name of the event is sent, never what was copied.
// Where the clipboard can't be written to directly, the Copy button copies through a selection,
// which looks like a copy by hand. One just counted by its click isn't counted again.
let _installCounted = 0;
export const trackCopies = () => {
    document.addEventListener('copy', () => {
        if (!installsCli(String(document.getSelection?.() || ''))) return;
        if (Date.now() - _installCounted < 1000) return;
        _installCounted = Date.now();
        window.umami?.track(CLI_INSTALL_COPIED);
    });
};

// Samples, the tour and new maps swap the address for a new map as they open, often before the
// script has loaded, so the first page view uses the address the visitor arrived on. Clicks
// aren't page views, so they leave it for the page view.
export const arrivalHook = (href) => {
    let arrivedOn = href.split('#')[0];
    return (type, payload) => {
        if (!arrivedOn || payload.name) return payload;
        const hit = { ...payload, url: arrivedOn };
        arrivedOn = null;
        return hit;
    };
};

export const loadAnalytics = () => {
    if (window.location.hostname !== LIVE_HOSTNAME) return;
    // Umami finds the hook by its name on window
    window.umamiBeforeSend = arrivalHook(window.location.href);
    const script = document.createElement('script');
    script.src = 'https://cloud.umami.is/script.js';
    script.defer = true;
    script.dataset.websiteId = WEBSITE_ID;
    script.dataset.beforeSend = 'umamiBeforeSend';
    // A #slice- or #card- link is the same page as the map it's on
    script.dataset.excludeHash = 'true';
    document.head.appendChild(script);
    trackClicks();
    trackCopies();
};
