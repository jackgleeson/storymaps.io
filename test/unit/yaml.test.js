import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import jsyaml from '#js-yaml';
import { exportToYaml, importFromYaml, validateYaml } from '../../src/transfer/yaml.js';
import { samples, cardLayout } from '../fixtures.js';

const MAP = 'name: Test\nsteps:\n  - Sign up\n';

const roundTrip = (map) => importFromYaml(exportToYaml(map));

// Every field the YAML format supports
const richMap = () => ({
  app: 'storymap',
  v: 1,
  name: 'Coffee app',
  steps: [
    { name: 'Browse', color: '#fecdd3', body: 'The menu', url: 'https://example.com/browse', status: 'done', points: 3, tags: ['ux'] },
    { name: 'Order', color: '#86efac' },
  ],
  users: [[{ name: 'Customer', color: '#fca5a5' }], []],
  activities: [[{ name: 'Find a drink', color: '#93c5fd' }], [{ name: 'Pay', body: 'At the till' }]],
  slices: [
    {
      name: 'MVP',
      stories: [
        [{ name: 'List drinks', body: 'Hot and cold', color: '#a5f3fc', url: 'https://example.com/list', status: 'in-progress', points: 0, tags: ['menu', 'api'] }],
        [{ name: 'Card payment' }],
      ],
      goal: 'Take the first order',
      targetDate: '2026-11-14',
    },
    { name: 'Later', stories: [[], []], collapsed: true, closedReason: 'complete' },
  ],
  legend: [{ color: '#fef08a', label: 'Tasks' }],
  notes: 'Remember the oat milk',
});

describe('YAML round trip', () => {
  test('a map with every supported field survives', () => {
    assert.deepEqual(roundTrip(richMap()), richMap());
  });

  for (const { file, data } of samples()) {
    test(`the ${file} sample keeps every step and card in place`, () => {
      assert.deepEqual(cardLayout(roundTrip(data)), cardLayout(data));
    });
  }

  test('steps with the same name are numbered in the file', () => {
    const yaml = exportToYaml({ name: 'x', steps: [{ name: 'Confirm' }, { name: 'Pay' }, { name: 'Confirm' }], slices: [] });
    assert.deepEqual(jsyaml.load(yaml).steps, ['Confirm[0]', 'Pay', 'Confirm[1]']);
  });

  test('older files that prefix duplicate steps with the activity still import', () => {
    const out = importFromYaml('name: x\nsteps:\n  - "Buy: Search"\n  - "Sell: Search"\nslices:\n  - name: MVP\n    stories:\n      "Sell: Search":\n        - name: Find buyers\n');
    assert.deepEqual(out.steps.map(s => s.name), ['Buy: Search', 'Sell: Search']);
    assert.deepEqual(out.slices[0].stories[1], [{ name: 'Find buyers' }]);
  });

  test('several unnamed steps stay unnamed and keep their cards', () => {
    const out = roundTrip({ name: 'x', steps: [{ name: '' }, { name: '' }], slices: [{ name: 'MVP', stories: [[{ name: 'One' }], [{ name: 'Two' }]] }] });
    assert.deepEqual(out.steps.map(s => s.name), ['', '']);
    assert.deepEqual(out.slices[0].stories.map(c => c.map(s => s.name)), [['One'], ['Two']]);
  });

  test('steps with the same name keep their names and their cards', () => {
    const map = {
      name: 'x',
      steps: [{ name: 'Search' }, { name: 'Search' }],
      activities: [[{ name: 'Buy' }], [{ name: 'Sell' }]],
      slices: [{ name: 'MVP', stories: [[{ name: 'Find homes' }], [{ name: 'Find buyers' }]] }],
    };
    const out = roundTrip(map);
    assert.deepEqual(out.slices[0].stories.map(c => c.map(s => s.name)), [['Find homes'], ['Find buyers']]);
    assert.deepEqual(out.steps.map(s => s.name), ['Search', 'Search']);
  });

  test('a hidden step with a name comes back as a normal step', () => {
    const out = roundTrip({ name: 'x', steps: [{ name: 'Browse' }, { name: 'Old step', hidden: true }], slices: [] });
    assert.equal(out.steps[1].name, 'Old step');
    assert.equal(out.steps[1].hidden, undefined);
  });

  test('a hidden step with cards comes back as a normal step with its cards', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'Browse' }, { name: '', hidden: true }],
      slices: [{ name: 'MVP', stories: [[{ name: 'List drinks' }], [{ name: 'Kept card' }]] }],
    });
    assert.equal(out.steps[1].hidden, undefined);
    assert.deepEqual(out.slices[0].stories[1], [{ name: 'Kept card' }]);
  });

  test('an empty, unnamed hidden step is still a spacer', () => {
    const yaml = exportToYaml({ name: 'x', steps: [{ name: 'A' }, { name: '', hidden: true }, { name: 'B' }], slices: [] });
    assert.deepEqual(jsyaml.load(yaml).steps, ['A', 'spacer', 'B']);
    assert.equal(importFromYaml(yaml).steps[1].hidden, true);
  });

  test('user and activity cards keep their link, status, points and tags', () => {
    const card = { name: 'Customer', url: 'https://example.com/persona', status: 'done', points: 2, tags: ['persona'] };
    const out = roundTrip({ name: 'x', steps: [{ name: 'Browse' }], users: [[card]], activities: [[card]], slices: [] });
    assert.deepEqual(out.users[0][0], card);
    assert.deepEqual(out.activities[0][0], card);
  });

  test('partial maps and the steps that use them survive', () => {
    const out = roundTrip({
      name: 'x',
      steps: [{ name: 'Browse' }, { partialMapId: 'pm000001', partialMapOrigin: true }, { name: 'Done' }, { partialMapId: 'pm000001' }],
      slices: [{ name: 'MVP', stories: [[{ name: 'List' }], [], [], []] }],
      partialMaps: [{
        id: 'pm000001',
        name: 'Checkout',
        users: [[]],
        activities: [[{ name: 'Pay up' }]],
        steps: [{ name: 'Pay' }],
        stories: [[[{ name: 'Apple Pay' }]]],
      }],
    });
    const [pm] = out.partialMaps;
    assert.equal(pm.name, 'Checkout');
    assert.deepEqual(pm.steps.map(s => s.name), ['Pay']);
    assert.deepEqual(pm.activities, [[{ name: 'Pay up' }]]);
    assert.deepEqual(pm.stories, [[[{ name: 'Apple Pay' }]]]);
    assert.deepEqual(out.steps[1], { partialMapId: pm.id, partialMapOrigin: true });
    assert.deepEqual(out.steps[3], { partialMapId: pm.id });
  });
});

describe('importFromYaml', () => {
  test('a spacer step becomes a hidden step', () => {
    const out = importFromYaml('name: x\nsteps:\n  - Browse\n  - spacer\n');
    assert.equal(out.steps[1].hidden, true);
    assert.equal(out.steps[1].name, '');
  });

  test('user and activity cards without a step go under the first step', () => {
    const out = importFromYaml('name: x\nsteps:\n  - A\n  - B\nusers:\n  - name: Guest\nactivities:\n  - name: Pay\n    step: B\n');
    assert.deepEqual(out.users, [[{ name: 'Guest' }], []]);
    assert.deepEqual(out.activities, [[], [{ name: 'Pay' }]]);
  });

  test('an unquoted target date is read as a date', () => {
    const out = importFromYaml(MAP + 'slices:\n  - name: MVP\n    targetDate: 2026-11-14\n');
    assert.equal(out.slices[0].targetDate, '2026-11-14');
  });

  test('YAML that is not a map is rejected', () => {
    assert.throws(() => importFromYaml('just some text'), /Invalid YAML/);
    assert.throws(() => importFromYaml(''), /Invalid YAML/);
  });

  test('a map that fails validation throws with the errors attached', () => {
    assert.throws(() => importFromYaml('name: x\nsteps: []\n'), (err) => err.validationErrors?.length === 1);
  });

  test('notes come through as written', () => {
    assert.equal(importFromYaml(MAP + 'notes: Ship it\n').notes, 'Ship it');
  });

  test('empty notes are kept so a push can clear them', () => {
    assert.equal(importFromYaml(MAP + 'notes: ""\n').notes, '');
  });

  test('no notes key means no notes field', () => {
    assert.ok(!('notes' in importFromYaml(MAP)));
  });
});

describe('validateYaml', () => {
  const check = (yaml) => validateYaml(jsyaml.load(yaml));

  test('a valid map passes', () => {
    assert.deepEqual(check(MAP + 'slices:\n  - name: MVP\n    stories:\n      Sign up:\n        - name: Form\n'), { valid: true, errors: [], warnings: [] });
  });

  test('needs at least one step', () => {
    assert.deepEqual(check('name: x\n').errors, ['Missing or empty "steps" list']);
  });

  test('rejects duplicate step names', () => {
    assert.match(check('name: x\nsteps:\n  - A\n  - A\n').errors[0], /Duplicate step names: A/);
  });

  test('rejects cards that point at a step that does not exist', () => {
    const { errors } = check(MAP + 'users:\n  - name: Guest\n    step: Nope\nslices:\n  - name: MVP\n    stories:\n      Missing:\n        - name: Form\n');
    assert.deepEqual(errors, ['users[0] references unknown step "Nope"', 'Slice "MVP" references unknown step "Missing"']);
  });

  test('rejects a step that uses a partial that is not defined', () => {
    assert.deepEqual(check('name: x\nsteps:\n  - partial: checkout\n').errors, ['steps[0] references undefined partial "checkout"']);
  });

  test('warns about an unknown status but still passes', () => {
    const result = check(MAP + 'slices:\n  - name: MVP\n    stories:\n      Sign up:\n        - name: Form\n          status: someday\n');
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 1);
  });
});
