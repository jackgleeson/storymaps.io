// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Build with AI modal

import { dom } from '/src/ui/dom.js';
import { serialize } from '/src/core/serialization.js';
import { exportToYaml } from '/src/transfer/yaml.js';
import { showConfirm } from '/src/core/modals.js';

let _deps = {};

const _link = (url, label) => `<a href="https://${url}" target="_blank" rel="noopener noreferrer">${label || url}</a>`;

const buildAiInstructions = {
    lovable: `Paste this prompt at ${_link('lovable.dev')}`,
    v0: `Paste this prompt at ${_link('v0.app')}`,
    bolt: `Paste this prompt at ${_link('bolt.new')}`,
    replit: `Paste this prompt at ${_link('replit.com')}`,
    base44: `Paste this prompt at ${_link('base44.com')}`,
    chatgpt: `Paste this prompt at ${_link('chatgpt.com')}`,
    claude: `Paste this prompt at ${_link('claude.ai')}`,
    'claude-code': 'Paste this prompt into Claude Code in your terminal',
    codex: 'Paste this prompt into Codex CLI in your terminal',
    cursor: `Paste this prompt into Cursor composer (${/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}+I)`,
    windsurf: `Paste this prompt into Windsurf Cascade (${/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}+L)`,
    'github-copilot': 'Paste this prompt into GitHub Copilot agent chat',
    gemini: `Paste this prompt at ${_link('gemini.google.com')}`,
    'gemini-cli': 'Paste this prompt into Gemini CLI in your terminal',
};

const shellEscape = (s) => s.replace(/["\\`$]/g, '\\$&');

const chatTargets = new Set(['chatgpt', 'gemini']);
const promptSuffixTargets = new Set(['chatgpt', 'gemini', 'claude']);

const cliCommands = {
    'claude-code': 'claude',
    codex: 'codex',
    'gemini-cli': 'gemini',
};

const allTargetGrids = () => [dom.buildAiTargets, dom.buildAiTargets2, dom.buildAiTargets3];

const getSelectedTarget = () => {
    for (const grid of allTargetGrids()) {
        const sel = grid.querySelector('.selected');
        if (sel) return sel;
    }
    return null;
};

let _lastTargetId = null;

function updateBuildPrompt() {
    const { state } = _deps;
    const target = getSelectedTarget();
    const targetId = target?.dataset.target || 'lovable';
    const kind = target?.dataset.kind || 'builder';
    const isCli = targetId in cliCommands;
    const targetChanged = targetId !== _lastTargetId;
    _lastTargetId = targetId;
    const sel = dom.buildAiSlice;
    const sliceVal = sel.value;
    const sliceName = sel.options[sel.selectedIndex]?.text || 'Slice 1';
    const extra = dom.buildAiInstructionsInput.value.trim();
    const isChat = chatTargets.has(targetId);
    const hasPromptSuffix = promptSuffixTargets.has(targetId);
    dom.buildAiCliToggleRow.style.display = isCli ? '' : 'none';
    if (!isCli) dom.buildAiCliToggle.checked = false;
    // Reset toggles when switching targets
    if (targetChanged) {
        dom.buildAiCliToggle.checked = isCli;
        dom.buildAiFetchToggle.checked = !isChat;
    }
    // Chat targets can't fetch URLs, so the map goes in the prompt. Terminal tools always fetch
    // or pull it: YAML doesn't survive being squeezed into a quoted shell command
    dom.buildAiFetchToggleRow.style.display = isChat || isCli ? 'none' : '';
    if (isChat) dom.buildAiFetchToggle.checked = false;
    if (isCli) dom.buildAiFetchToggle.checked = true;
    const useCli = isCli && dom.buildAiCliToggle.checked;
    const useFetch = dom.buildAiFetchToggle.checked;
    const isPrototype = (dom.buildAiModeSelect?.value || 'prototype') === 'prototype';
    const qualifier = isPrototype ? 'functional prototype' : 'full app';
    const slice = sliceVal === 'all' ? null : state.slices[sliceVal];
    // A slice with no name shows as "Slice 1" here, but the map has no slice by that name: point at it by position
    const sliceRef = (q) => !slice ? 'the full map'
        : slice.name ? `the ${q}${sliceName}${q} slice`
        : `slice ${+sliceVal + 1} in the slices list (it has no name)`;
    const scope = sliceRef('"');
    // The map on the site this app is served from, so a self-hosted copy points at itself
    const mapUrl = `${window.location.origin}/${encodeURIComponent(state.mapId)}`;
    let prompt;
    if (isCli) {
        const cmd = cliCommands[targetId];
        const cliScope = slice?.name ? `the '${sliceName.replace(/'/g, "\\'")}' slice` : sliceRef();
        if (useCli) {
            const fileRef = targetId === 'codex' ? 'storymap.yml' : '@storymap.yml';
            let inner = `The storymap file ${fileRef} describes a product plan in user story map format. Use it as a structured specification. Your task: build a ${qualifier} of the features listed in ${cliScope}.`;
            if (extra) inner += ` ${shellEscape(extra)}`;
            prompt = `npx storymaps pull --force ${mapUrl} && ${cmd} "${inner}"`;
        } else {
            let inner = `The YAML at ${mapUrl}.yaml describes a product plan in user story map format. Use it as a structured specification. Your task: build a ${qualifier} of the features listed in ${cliScope}.`;
            if (extra) inner += ` ${shellEscape(extra)}`;
            prompt = `${cmd} "${inner}"`;
        }
    } else if (useFetch) {
        let instructions = `The YAML at the URL below describes a product plan in user story map format.\nUse it as a structured specification. Your task: build a ${qualifier} of the features listed in ${scope}.`;
        if (hasPromptSuffix && isPrototype) instructions += ' Output a single self-contained HTML file with inline CSS and JavaScript. Do not use frameworks that require a build step.';
        if (hasPromptSuffix && !isPrototype) instructions += ' Pick the tech stack yourself and provide the code.';
        if (extra) instructions += ` ${extra}`;
        prompt = `${instructions}\n\n${mapUrl}.yaml`;
    } else {
        let instructions = `The YAML below describes a product plan in user story map format.\nUse it as a structured specification. Your task: build a ${qualifier} of the features listed in ${scope}.`;
        if (hasPromptSuffix && isPrototype) instructions += ' Output a single self-contained HTML file with inline CSS and JavaScript. Do not use frameworks that require a build step.';
        if (hasPromptSuffix && !isPrototype) instructions += ' Pick the tech stack yourself and provide the code.';
        if (extra) instructions += ` ${extra}`;
        prompt = `${instructions}\n\n${exportToYaml(serialize())}`;
    }
    dom.buildAiPrompt.value = prompt;
    dom.buildAiPrompt.rows = (useFetch || useCli) ? 3 : Math.min(12, prompt.split('\n').length + 1);
    dom.buildAiInstructions.innerHTML = isCli
        ? 'Run this command in your terminal'
        : buildAiInstructions[targetId];
    dom.buildAiInstructionsInput.placeholder = kind === 'builder'
        ? 'Look and feel, key features, target audience...'
        : isCli || ['cursor', 'windsurf', 'github-copilot'].includes(targetId)
            ? 'Framework preferences, coding guidelines, testing strategy...'
            : 'Tech stack, look and feel, target audience...';
    dom.buildAiCopy.querySelector('span').textContent = isCli ? 'Copy Command' : 'Copy Prompt';
}

export const closeModal = () => dom.buildAiModal.classList.remove('visible');

export const confirmClose = async () => {
    if (!dom.buildAiModal.classList.contains('visible')) return;
    if (await showConfirm('Close Build with AI?')) closeModal();
};

export const init = (deps) => {
    _deps = deps;
    const { state, showPrompt } = deps;

    dom.buildAiBtn.addEventListener('click', () => {
        const sel = dom.buildAiSlice;
        sel.innerHTML = '';
        state.slices.forEach((s, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = s.name || `Slice ${i + 1}`;
            sel.appendChild(opt);
        });
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Slices';
        sel.appendChild(allOpt);
        allTargetGrids().forEach(g => g.querySelectorAll('.build-ai-target').forEach(b => b.classList.remove('selected')));
        dom.buildAiTargets.querySelector('.build-ai-target').classList.add('selected');
        _lastTargetId = null;
        dom.buildAiInstructionsInput.value = '';
        updateBuildPrompt();
        dom.buildAiModal.classList.add('visible');
    });

    const handleTargetClick = (e) => {
        const btn = e.target.closest('.build-ai-target');
        if (!btn) return;
        allTargetGrids().forEach(g => g.querySelectorAll('.build-ai-target').forEach(b => b.classList.remove('selected')));
        btn.classList.add('selected');
        updateBuildPrompt();
    };
    dom.buildAiTargets.addEventListener('click', handleTargetClick);
    dom.buildAiTargets2.addEventListener('click', handleTargetClick);
    dom.buildAiTargets3.addEventListener('click', handleTargetClick);
    dom.buildAiSlice.addEventListener('change', updateBuildPrompt);
    dom.buildAiFetchToggle.addEventListener('change', updateBuildPrompt);
    dom.buildAiCliToggle.addEventListener('change', updateBuildPrompt);
    dom.buildAiModeSelect?.addEventListener('change', updateBuildPrompt);
    dom.buildAiInstructionsInput.addEventListener('input', updateBuildPrompt);
    dom.buildAiCopy.addEventListener('click', async () => {
        const label = dom.buildAiCopy.querySelector('span');
        try {
            await navigator.clipboard.writeText(dom.buildAiPrompt.value);
            const prev = label.textContent;
            label.textContent = 'Copied!';
            setTimeout(() => label.textContent = prev, 2000);
        } catch {
            await showPrompt('Copy this AI build prompt:', dom.buildAiPrompt.value);
        }
    });
    dom.buildAiModalClose.addEventListener('click', closeModal);
    dom.buildAiModal.addEventListener('click', (e) => { if (e.target === dom.buildAiModal) confirmClose(); });
};
