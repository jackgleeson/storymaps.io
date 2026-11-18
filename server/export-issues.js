// Shared by the tracker export routes. An export is a flat list of issues, one per card:
// { title, description, status, labels, points }. No epics, parent tasks or sections.

import { sendSSE } from './http-helpers.js';

export const MAX_ISSUES = 2000;
const MAX_LABELS = 50;
const STATUSES = new Set(['none', 'planned', 'in-progress', 'blocked', 'done']);

// Returns the issues in a known shape, or null when the list is missing, too long or holds
// something that isn't an issue with a title
export const cleanIssues = (issues) => {
  if (!Array.isArray(issues) || issues.length > MAX_ISSUES) return null;
  const clean = [];
  for (const issue of issues) {
    if (!issue || typeof issue.title !== 'string' || !issue.title.trim()) return null;
    const labels = Array.isArray(issue.labels)
      ? [...new Set(issue.labels.filter(l => typeof l === 'string').map(l => l.trim().slice(0, 80)).filter(Boolean))].slice(0, MAX_LABELS)
      : [];
    clean.push({
      title: issue.title.trim().slice(0, 500),
      description: typeof issue.description === 'string' ? issue.description.slice(0, 30_000) : '',
      status: STATUSES.has(issue.status) ? issue.status : 'none',
      labels,
      points: typeof issue.points === 'number' && Number.isFinite(issue.points) && issue.points >= 0 ? issue.points : null,
    });
  }
  return clean;
};

export const invalidIssues = (res) => {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Missing or invalid issues. Send up to ${MAX_ISSUES}, each with a title.` }));
};

// Every label used by the issues, once each, in the order they first appear
export const uniqueLabels = (issues) => [...new Set(issues.flatMap(issue => issue.labels))];

export const errorText = (error) => (typeof error === 'string' ? error : JSON.stringify(error) || 'Unknown error').slice(0, 300);

// Create the issues one after another, sending progress as each one starts and ends.
// `create(issue)` returns what to report ({ key, url, note }) or throws.
export const createEach = async (res, issues, create) => {
  let created = 0, failed = 0;
  for (const issue of issues) {
    sendSSE(res, 'progress', { type: 'issue', title: issue.title, status: 'creating' });
    try {
      const result = await create(issue);
      sendSSE(res, 'progress', { type: 'issue', title: issue.title, status: 'created', ...result });
      created++;
    } catch (e) {
      sendSSE(res, 'progress', { type: 'issue', title: issue.title, status: 'error', error: errorText(e.message) });
      failed++;
    }
  }
  sendSSE(res, 'done', { created, failed });
  res.end();
};

// Jira descriptions are Atlassian Document Format. Blank lines split paragraphs, single line
// breaks stay as line breaks, and web addresses become links. Empty text gives null.
export const toAdf = (text) => {
  const inline = (line) => line.split(/(https?:\/\/\S+)/).filter(Boolean).map(part =>
    /^https?:\/\//.test(part)
      ? { type: 'text', text: part, marks: [{ type: 'link', attrs: { href: part } }] }
      : { type: 'text', text: part });
  const paragraphs = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(paragraph => {
    const content = [];
    paragraph.split('\n').forEach((line, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      if (line) content.push(...inline(line));
    });
    return { type: 'paragraph', content };
  });
  return paragraphs.length ? { type: 'doc', version: 1, content: paragraphs } : null;
};

// Azure DevOps descriptions are HTML. Blank lines split paragraphs, single line breaks stay
// as line breaks, and web addresses become links. Empty text gives ''.
export const toHtml = (text) => {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (line) => line.split(/(https?:\/\/\S+)/).filter(Boolean).map(part =>
    /^https?:\/\//.test(part) ? `<a href="${escape(part)}">${escape(part)}</a>` : escape(part)).join('');
  return String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(paragraph => `<div>${paragraph.split('\n').map(inline).join('<br>')}</div>`).join('<div><br></div>');
};
