import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { backboneNeeds, guideSteps, addStep, fitBackbone } from '/src/features/import-guide.js';

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
    assert.match(first.body, /^Your 2 imported cards are safe in the <strong>Imported<\/strong> slice\. Before you move any, build the backbone: who it's for, what they're trying to do and the steps they take\. /);
    assert.doesNotMatch(second.body, /imported cards are safe/);
    // and links to the docs for anyone who doesn't know what a backbone is, in a new tab so the guide stays
    assert.match(first.body, /If you don't know what a backbone is, <a href="\/docs\/define-the-story-map-backbone" target="_blank" rel="noopener">catch up here<\/a>\./);
    assert.doesNotMatch(second.body, /catch up here/);
    assert.match(guideSteps(backboneNeeds(imported({ pile: ['One'] })))[0].body, /^Your 1 imported card is safe/);
  });

  test('a part of the backbone that is already named has no step', () => {
    assert.deepEqual(titles(imported({ user: 'Customer' })), ['What are they trying to do?', 'What steps do they take?', 'Now place the cards']);
    assert.deepEqual(titles(imported({ user: 'Customer', activity: 'Order', steps: ['Browse', '', ''] })), ['Now place the cards']);
    const [only] = guideSteps(backboneNeeds(imported({ user: 'Customer', activity: 'Order', steps: ['Browse'] })));
    assert.match(only.body, /^The backbone is already here/);
  });

  test('the last step dims nothing and leaves the app free to use', () => {
    const steps = guideSteps(backboneNeeds(imported()));
    assert.deepEqual(steps.map(step => !!step.free), [false, false, false, true]);
    assert.equal(steps.at(-1).target, undefined);
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

  describe('the backbone is exactly the steps that were named', () => {
    // Columns as the import makes them, with the pile dealt along the rows: A B C D E F G H, then I J
    const pileMap = (names) => {
      const columns = names.map((name, i) => ({ id: `c${i}`, name }));
      const deal = 'ABCDEFGHIJ'.split('');
      const stories = Object.fromEntries(columns.map(c => [c.id, []]));
      deal.forEach((name, i) => stories[columns[i % columns.length].id].push({ name }));
      return {
        columns,
        users: Object.fromEntries(columns.map((c, i) => [c.id, i === 0 ? [{ name: 'Customer' }] : []])),
        activities: Object.fromEntries(columns.map((c, i) => [c.id, i === 0 ? [{ name: 'Order' }] : []])),
        slices: [
          { id: 's1', name: 'MVP', stories: Object.fromEntries(columns.map(c => [c.id, []])) },
          { id: 's2', name: 'Imported', stories },
        ],
      };
    };
    const cells = (map, slice = 1) => map.columns.map(c => map.slices[slice].stories[c.id].map(card => card.name).join(''));

    test('unnamed steps go, and the pile is dealt again under the named ones in the same order', () => {
      const map = pileMap(['Browse', 'Customise', 'Pay', '', '', '', '', '']);
      assert.equal(fitBackbone(map), true);
      assert.deepEqual(map.columns.map(c => c.name), ['Browse', 'Customise', 'Pay']);
      assert.deepEqual(cells(map), ['ADGJ', 'BEH', 'CFI']);
      assert.deepEqual(Object.keys(map.slices[0].stories), ['c0', 'c1', 'c2']);
      assert.deepEqual(Object.keys(map.users), ['c0', 'c1', 'c2']);
    });

    test('no card is lost or made twice', () => {
      const map = pileMap(['', 'Pay', '', 'Collect', '', '', '', '']);
      fitBackbone(map);
      assert.equal(cells(map).join('').split('').sort().join(''), 'ABCDEFGHIJ');
    });

    test('a user and an activity named under a spare step move to the first named step', () => {
      const map = pileMap(['', 'Pay', 'Collect', '', '', '', '', '']);
      fitBackbone(map);
      assert.deepEqual(map.columns.map(c => c.name), ['Pay', 'Collect']);
      assert.deepEqual(map.users.c1.map(card => card.name), ['Customer']);
      assert.deepEqual(map.activities.c1.map(card => card.name), ['Order']);
    });

    test('a card already placed under a spare step moves to the first named step of its slice', () => {
      const map = pileMap(['Browse', '', '', '', '', '', '', '']);
      map.slices[0].stories.c5.push({ name: 'Placed early' });
      fitBackbone(map);
      assert.deepEqual(cells(map, 0), ['Placed early']);
      assert.deepEqual(cells(map), ['ABCDEFGHIJ']);
    });

    test('with no step named, or none spare, nothing changes', () => {
      const blank = pileMap(['', '', '']);
      const before = JSON.stringify(blank);
      assert.equal(fitBackbone(blank), false);
      assert.equal(JSON.stringify(blank), before);
      assert.equal(fitBackbone(pileMap(['One', 'Two'])), false);
    });

    test('spacer columns are left alone, with whatever is under them', () => {
      const map = pileMap(['Browse', '', '']);
      map.columns[1].hidden = true;
      assert.equal(fitBackbone(map), true);
      assert.deepEqual(map.columns.map(c => c.id), ['c0', 'c1']);
      assert.deepEqual(map.slices[1].stories.c1.map(card => card.name), ['B', 'E', 'H']);
    });

    test('a step can be added at the end, with a place for cards in every row', () => {
      const map = pileMap(['Browse', 'Pay']);
      const added = addStep(map);
      assert.equal(map.columns.at(-1), added);
      assert.equal(added.name, '');
      assert.deepEqual([map.users[added.id], map.activities[added.id], map.slices[0].stories[added.id], map.slices[1].stories[added.id]], [[], [], [], []]);
    });
  });
});
