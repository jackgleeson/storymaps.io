// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Page view counts with Umami Cloud, on storymaps.io only. A self-hosted copy, the dev server and
// the tests send nothing. Umami uses no cookies.

const WEBSITE_ID = '4c921c04-1a31-41cc-85b5-26b9e2e75451';
const LIVE_HOSTNAME = 'storymaps.io';

// Samples, the tour and new maps swap the address for a new map as they open, often before the
// script has loaded, so the first hit uses the address the visitor arrived on
export const arrivalHook = (href) => {
    let arrivedOn = href.split('#')[0];
    return (type, payload) => {
        if (!arrivedOn) return payload;
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
};
