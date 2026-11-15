import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { backboneNeeds, guideSteps } from '/src/features/import-guide.js';

// A story map as the app holds it, straight after an import: blank backbone, cards in Imported
const imported = ({ user = '', activity = '', steps = ['', '', ''], pile = ['One', 'Two'] } = {}) => {
  const columns = steps.map((name, i) => ({ id: `c${i}`, name }));
  return {
    columns,
    users: { c0: [{ name: user }] },
    activities: { c0: [{ name: activity }] },
    slices: [
      { id: 's1', name: 'MVP', stories: Object.fromEntries(columns.map(c => [c.id, []])) },
      ...(pile ? [{ id: 's2', name: 'Imported', stories: { c0: pile.map(name => ({ name })), c1: [{ name: '  ' }] } }] : []),
    ],
  };
};
const titles = (map) => guideSteps(backboneNeeds(map)).map(step => step.title);

describe('the guide after a tracker import', () => {
  test('a blank backbone gets a step for the user, the activity and the steps, then the cards', () => {
    assert.deepEqual(backboneNeeds(imported()), { user: true, activity: true, steps: true, cards: 2 });
    assert.deepEqual(titles(imported()), ['Who is it for?', 'What are they trying to do?', 'What steps do they take?', 'Now place the cards']);
  });

  test('the first step says the imported cards are safe and can wait', () => {
    const [first, second] = guideSteps(backboneNeeds(imported()));
    assert.match(first.body, /^Your 2 imported cards are safe in the <strong>Imported<\/strong> slice\. Before you move any, build the backbone/);
    assert.doesNotMatch(second.body, /imported cards are safe/);
    // and links to the docs for anyone who doesn't know what a backbone is, in a new tab so the guide stays
    assert.match(first.body, /If you don't know what a backbone is, <a href="\/docs\/what-is-a-user-story-map" target="_blank" rel="noopener">catch up here<\/a>\./);
    assert.doesNotMatch(second.body, /catch up here/);
    assert.match(guideSteps(backboneNeeds(imported({ pile: ['One'] })))[0].body, /^Your 1 imported card is safe/);
  });

  test('a part of the backbone that is already named has no step', () => {
    assert.deepEqual(titles(imported({ user: 'Customer' })), ['What are they trying to do?', 'What steps do they take?', 'Now place the cards']);
    assert.deepEqual(titles(imported({ user: 'Customer', activity: 'Order', steps: ['Browse', '', ''] })), ['Now place the cards']);
    const [only] = guideSteps(backboneNeeds(imported({ user: 'Customer', activity: 'Order', steps: ['Browse'] })));
    assert.match(only.body, /^The backbone is already here/);
  });

  test('the steps of the backbone are typed one after another', () => {
    const steps = guideSteps(backboneNeeds(imported())).find(step => step.title === 'What steps do they take?');
    assert.equal(steps.fields, steps.focus);
    assert.match(steps.fields, /step-text/);
  });

  test('spacer columns and partial story maps are not steps to name', () => {
    const map = imported({ steps: ['', ''] });
    map.columns[0].hidden = true;
    map.columns[1].partialMapId = 'p1';
    assert.equal(backboneNeeds(map).steps, false);
  });

  test('with no imported cards waiting there is nothing to guide', () => {
    assert.equal(backboneNeeds(imported({ pile: null })).cards, 0);
    assert.equal(backboneNeeds(imported({ pile: [] })).cards, 0, 'blank cards do not count');
  });
});
