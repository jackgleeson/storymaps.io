// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Page view counts and button clicks with Umami Cloud, on storymaps.io only. A self-hosted copy,
// the dev server and the tests send nothing. Umami uses no cookies. All the tracking is in this file.

const WEBSITE_ID = '4c921c04-1a31-41cc-85b5-26b9e2e75451';
const LIVE_HOSTNAME = 'storymaps.io';

// The buttons to count: [selector, event name, text the button must start with]. These count
// clicks, so an action someone cancels or that fails afterwards still counts. Only ever send the
// name of the button, nothing from the map itself.
export const CLICKS = [
    // Getting started
    ['#newMapBtn, #welcomeNewBtn', 'map-created'],
    ['[data-sample]', (el) => `sample-${el.dataset.sample}`],
    ['#tourMenuBtn, #welcomeTourBtn', 'tour-started'],
    ['.tour-btn-next', 'tour-finished', 'Finish'],

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

    // Exports, on the button that does the export
    ['#exportCopyBtn, #exportDownloadBtn', 'export-json'],
    ['#exportYamlCopyBtn, #exportYamlDownloadBtn', 'export-yaml'],
    ['#exportCsvCopyBtn, #exportCsvDownloadBtn', 'export-csv'],
    ['#jiraExportDownload', 'export-jira-csv'],
    ['#asanaCsvExportDownload', 'export-asana-csv'],
    ['#jiraProxyExportRun', 'export-jira'],
    ['#asanaProxyExportRun', 'export-asana'],
    ['#phabProxyExportRun', 'export-phabricator'],
    ['#linearProxyExportRun', 'export-linear'],
    ['#jiraApiExportDone', 'export-jira-script'],
    ['#asanaExportDone', 'export-asana-script'],
    ['#phabExportDone', 'export-phabricator-script'],

    // Keeping work
    ['#createBackupBtn', 'backup-created'],
    ['.backup-restore-btn', 'backup-restored'],
    ['#lockModalConfirm', 'map-locked', 'Lock Map'],

    // Other
    ['.project-panel-primary', 'project-created', 'Create project'],
    ['#buildAiBtn', 'build-with-ai'],
    ['#buildAiCopy', 'ai-prompt-copied'],
];

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
        if (name) window.umami?.track(name);
    }, { capture: true });
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
};
