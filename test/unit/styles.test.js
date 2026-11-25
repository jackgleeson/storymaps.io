import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// With a :has() rule that reaches into the map, the browser restyles every element in the map
// whenever anything in it is added, removed or restyled. On a story map of 1,750 cards that was
// 70 to 90ms on every change and most of the time of a drag. Set a class from script instead, as
// .slice-name-dimmed and .tags-hover do.
test('no :has() rule in the stylesheet names a part of the map', () => {
    const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const mapPart = /\.(story-map|map-top|map-body|steps-row|step\b|story-card|story-column|slice-|card-)/;
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim());
    const found = selectors.filter(s => s.includes(':has(') && mapPart.test(s));
    assert.deepEqual(found, []);
});
