import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exportToCsv, importFromCsv } from '../src/transfer/csv.js';

const map = (slices) => ({
  name: 'Test map',
  steps: [{ name: 'Sign up' }, { name: 'Pay' }],
  users: [],
  activities: [],
  slices,
});

const slice = (name, details = {}) => ({ name, stories: [[{ name: `${name} card` }], []], ...details });

const roundTrip = (slices) => importFromCsv(exportToCsv(map(slices))).slices;

describe('CSV slice details', () => {
  test('export writes a slicemeta row before the slice', () => {
    const lines = exportToCsv(map([slice('MVP', { goal: 'Redeem vouchers', targetDate: '2026-11-14' })])).split('\n');
    const meta = lines.findIndex(l => l.startsWith('slicemeta:MVP,'));
    assert.ok(meta >= 0, 'has a slicemeta row');
    assert.match(lines[meta], /^slicemeta:MVP,goal:Redeem vouchers,targetDate:2026-11-14/);
    assert.ok(lines[meta + 1].startsWith('slice:MVP,'), 'slice rows follow it');
  });

  test('slices without a goal or date get no slicemeta row', () => {
    assert.ok(!exportToCsv(map([slice('Backlog')])).includes('slicemeta:'));
  });

  test('goal and date survive a round trip', () => {
    const [mvp, r2, backlog] = roundTrip([
      slice('MVP', { goal: 'Redeem vouchers', targetDate: '2026-11-14' }),
      slice('Release 2', { targetDate: '2026-12-12' }),
      slice('Backlog'),
    ]);
    assert.equal(mvp.goal, 'Redeem vouchers');
    assert.equal(mvp.targetDate, '2026-11-14');
    assert.equal(r2.goal, undefined);
    assert.equal(r2.targetDate, '2026-12-12');
    assert.equal(backlog.goal, undefined);
    assert.equal(backlog.targetDate, undefined);
    assert.equal(mvp.stories[0][0].name, 'MVP card');
  });

  test('goals with commas, quotes and line breaks survive', () => {
    const goal = 'Pay, then "track"\nacross both apps';
    assert.equal(roundTrip([slice('MVP', { goal })])[0].goal, goal);
  });

  test('an invalid date is dropped on import', () => {
    const csv = 'name,Test map\nsteps,Sign up\nslicemeta:MVP,goal:Ship it,targetDate:soon\nslice:MVP,story:Card\n';
    const [mvp] = importFromCsv(csv).slices;
    assert.equal(mvp.goal, 'Ship it');
    assert.equal(mvp.targetDate, undefined);
  });

  test('CSV without slicemeta rows imports as before', () => {
    const csv = 'name,Test map\nsteps,Sign up\nslice:MVP,story:Card\n';
    const [mvp] = importFromCsv(csv).slices;
    assert.equal(mvp.name, 'MVP');
    assert.equal(mvp.goal, undefined);
    assert.equal(mvp.stories[0][0].name, 'Card');
  });

  test('completed and collapsed slices survive a round trip', () => {
    const [done, shelved, open] = roundTrip([
      slice('Q3', { collapsed: true, closedReason: 'complete', goal: 'Both apps' }),
      slice('Spike', { collapsed: true, closedReason: 'closed' }),
      slice('Backlog'),
    ]);
    assert.equal(done.collapsed, true);
    assert.equal(done.closedReason, 'complete');
    assert.equal(done.goal, 'Both apps');
    assert.equal(shelved.collapsed, true);
    assert.equal(shelved.closedReason, 'closed');
    assert.equal(open.collapsed, undefined);
    assert.equal(open.closedReason, undefined);
  });

  test('a collapsed slice with no goal or date still gets a slicemeta row', () => {
    const csv = exportToCsv(map([slice('Spike', { collapsed: true, closedReason: 'closed' })]));
    assert.match(csv, /^slicemeta:Spike,collapsed:true,closedReason:closed/m);
  });

  test('an unknown closedReason is dropped on import', () => {
    const csv = 'name,Test map\nsteps,Sign up\nslicemeta:MVP,collapsed:true,closedReason:abandoned\nslice:MVP,story:Card\n';
    const [mvp] = importFromCsv(csv).slices;
    assert.equal(mvp.collapsed, true);
    assert.equal(mvp.closedReason, undefined);
  });

  test('a slicemeta row with no matching slice adds nothing', () => {
    const csv = 'name,Test map\nsteps,Sign up\nslicemeta:Ghost,goal:Nope\nslice:MVP,story:Card\n';
    const slices = importFromCsv(csv).slices;
    assert.deepEqual(slices.map(s => s.name), ['MVP']);
  });
});
