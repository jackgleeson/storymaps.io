// Shared by the Azure DevOps import and export routes. Every call goes to dev.azure.com, to
// the organization and project typed in, with a personal access token.

import { fetchWithTimeout } from './http-helpers.js';

export const API_VERSION = 'api-version=7.1';

const ORGANIZATION = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
// Azure DevOps bars these characters in a project name, a name that starts with an underscore
// and one that starts or ends with a full stop
const PROJECT = /^[^\\/:*?"<>|;#$*{},+=[\]\x00-\x1f]{1,64}$/;

// Check what was typed in and work out the addresses and the sign-in header.
// Returns { error } when something is missing or can't be a real organization or project.
export const azureTarget = ({ organization, project, token } = {}) => {
  if (!organization || !project || !token || [organization, project, token].some(v => typeof v !== 'string')) {
    return { error: 'Missing required fields: organization, project, token' };
  }
  if (!ORGANIZATION.test(organization)) return { error: 'Invalid organization. Use the name in dev.azure.com/your-organization.' };
  const name = project.trim();
  if (!PROJECT.test(name) || /^[_.]|\.$/.test(name)) return { error: 'Invalid project name.' };
  if (token.length > 256) return { error: 'Personal access token too long.' };
  const orgBase = `https://dev.azure.com/${organization}`;
  const base = `${orgBase}/${encodeURIComponent(name)}`;
  return {
    organization, project: name, orgBase, base,
    // A personal access token signs in as the password of a user with no name
    headers: { 'Authorization': `Basic ${Buffer.from(`:${token}`).toString('base64')}`, 'Accept': 'application/json' },
    itemUrl: (id) => `${base}/_workitems/edit/${id}`,
  };
};

const AUTH_FAILED = 'Authentication failed. Check the personal access token and that it covers work items.';

// One call to Azure DevOps. Returns the JSON it sends, or throws with a message to show.
// A token that is wrong or has run out gets the sign-in page, which is not JSON.
export const azureFetch = async (url, headers, { method = 'GET', body, contentType = 'application/json' } = {}, ms = 30_000) => {
  const r = await fetchWithTimeout(url, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': contentType },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }, ms);
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status === 401 || r.status === 203) throw new Error(AUTH_FAILED);
  if (r.status >= 400) {
    if (data?.message) throw new Error(data.message);
    throw new Error(r.status === 403 ? AUTH_FAILED : r.status === 404 ? 'Organization or project not found' : `HTTP ${r.status}`);
  }
  if (data === null) throw new Error(AUTH_FAILED);
  return data;
};
