import { describe, test, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJson, writeJson, updateJson } from '../../server/data.js';

// The JSON files (locks, backups) on a real disk, changed by many requests at once
let dir, file;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'storymaps-data-'));
  file = join(dir, 'count.json');
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('updateJson', () => {
  test('changes made at the same moment all land, one after another', async () => {
    await writeJson(file, { n: 5000 });
    await Promise.all(Array.from({ length: 100 }, () => updateJson(file, { n: 0 }, (d) => { d.n++; })));
    assert.deepEqual(await readJson(file, null), { n: 5100 });
  });

  test('someone reading while it saves never sees an empty or half-written file', async () => {
    await writeJson(file, { n: 0, pad: 'x'.repeat(50_000) });
    const reads = [];
    const writes = Array.from({ length: 50 }, () => updateJson(file, null, (d) => { d.n++; }));
    for (let i = 0; i < 200; i++) reads.push(readFile(file, 'utf8').then(text => JSON.parse(text).n));
    await Promise.all(writes);
    for (const n of await Promise.all(reads)) assert.ok(Number.isInteger(n));
    assert.equal((await readJson(file, null)).n, 50);
  });

  test('starts from the fallback when there is no file', async () => {
    assert.deepEqual(await updateJson(file, [], (list) => { list.push('a'); }), ['a']);
    assert.deepEqual(await readJson(file, null), ['a']);
  });

  test('takes the data fn returns, and leaves the file alone when fn returns false', async () => {
    await writeJson(file, [1, 2, 3]);
    await updateJson(file, [], (list) => list.slice(-2));
    assert.deepEqual(await readJson(file, null), [2, 3]);
    const before = await readFile(file, 'utf8');
    await updateJson(file, [], () => false);
    assert.equal(await readFile(file, 'utf8'), before);
  });

  test('never saves over a file it cannot read, so a damaged lock file is not wiped', async () => {
    await writeFile(file, '{"abc12345": {"isLocked": tr');
    await assert.rejects(updateJson(file, {}, (locks) => { locks.x = 1; }));
    assert.equal(await readFile(file, 'utf8'), '{"abc12345": {"isLocked": tr');
  });

  test('a change that fails does not hold up the next one', async () => {
    await writeJson(file, { n: 1 });
    await assert.rejects(updateJson(file, {}, () => { throw new Error('no'); }));
    assert.deepEqual(await updateJson(file, {}, (d) => { d.n++; }), { n: 2 });
  });

  test('leaves no temporary files behind', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateJson(file, {}, (d) => { d[i] = i; })));
    assert.deepEqual(await readdir(dir), ['count.json']);
  });
});
