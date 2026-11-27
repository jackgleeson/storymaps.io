// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Remember the issue tracker details typed into the import and export windows, so they don't have
// to be found again next time: the site address, project, email, team and tags. They are kept
// in this browser only. API tokens and keys are never kept.

const STORAGE_KEY = 'trackerDetails';

// Each remembered detail, and every field that shows it. An import and an export to the same
// issue tracker share their details. No token or key field may ever be listed here.
export const DETAILS = {
    'jira.instanceUrl': ['jiraImportInstanceUrl', 'jiraCsvInstanceUrl', 'jiraProxyInstanceUrl'],
    'jira.projectKey': ['jiraImportProjectKey', 'jiraProxyProjectKey'],
    'jira.email': ['jiraImportEmail', 'jiraProxyEmail'],
    'asana.projectUrl': ['asanaImportProjectUrl', 'asanaProxyProjectUrl'],
    'phabricator.instanceUrl': ['phabImportInstanceUrl', 'phabProxyInstanceUrl', 'phabInstanceUrl'],
    'phabricator.tags': ['phabImportProjectTags', 'phabProxyTags', 'phabTags'],
    'linear.teamKey': ['linearImportTeamKey', 'linearProxyTeamKey'],
    'azure.organization': ['azureImportOrganization', 'azureCsvOrganization', 'azureProxyOrganization'],
    'azure.project': ['azureImportProject', 'azureCsvProject', 'azureProxyProject'],
};

// Browser storage can be off or full, such as in a private window. Then nothing is remembered.
export const loadDetails = (storage = globalThis.localStorage) => {
    try {
        const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
        return Object.fromEntries(Object.entries(saved).filter(([key, value]) => key in DETAILS && typeof value === 'string'));
    } catch {
        return {};
    }
};

// An emptied field forgets its detail
export const saveDetail = (key, value, storage = globalThis.localStorage) => {
    if (!(key in DETAILS)) return;
    const details = loadDetails(storage);
    const text = String(value || '').trim();
    if (text) details[key] = text;
    else delete details[key];
    try {
        if (Object.keys(details).length) storage.setItem(STORAGE_KEY, JSON.stringify(details));
        else storage.removeItem(STORAGE_KEY);
    } catch { /* not remembered */ }
};

const fieldsFor = (key) => DETAILS[key].map(id => document.getElementById(id)).filter(Boolean);

// Put the remembered details back into their fields
export const fillTrackerDetails = () => {
    const details = loadDetails();
    Object.keys(DETAILS).forEach(key => fieldsFor(key).forEach(field => { field.value = details[key] || ''; }));
};

export const initTrackerDetails = () => {
    fillTrackerDetails();
    Object.keys(DETAILS).forEach(key => {
        fieldsFor(key).forEach(field => {
            field.addEventListener('input', () => {
                saveDetail(key, field.value);
                // The other windows for the same issue tracker show the same detail
                fieldsFor(key).forEach(other => { if (other !== field) other.value = field.value; });
            });
        });
    });
};
