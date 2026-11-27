import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { STORY_LINES, addLines, enterAction } from '../../src/core/story-lines.js';

// Apply an edit to the text and mark the cursor with |, so each case reads as before and after
const apply = (text, edit) => {
  const out = edit.insert === undefined ? text : text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return out.slice(0, edit.caret) + '|' + out.slice(edit.caret);
};
const add = (marked, kind) => {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  return apply(text, addLines(text, at, STORY_LINES[kind]));
};
const enter = (marked) => {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  const edit = enterAction(text, at, at);
  return edit && apply(text, edit);
};

describe('addLines', () => {
  test('a user story in an empty body, with the cursor after As a', () => {
    assert.equal(add('|', 'story'), '**As a** |\n**I want** \n**So that** ');
  });

  test('a scenario after the line the cursor is on, with a blank line between', () => {
    assert.equal(add('Some notes|', 'scenario'), 'Some notes\n\n**Given** |\n**When** \n**Then** ');
  });

  test('the cursor in the middle of a line adds after the line rather than splitting it', () => {
    assert.equal(add('Some| notes', 'story'), 'Some notes\n\n**As a** |\n**I want** \n**So that** ');
  });

  test('an empty line is used, with a blank line after text above it', () => {
    assert.equal(add('Some notes\n|', 'scenario'), 'Some notes\n\n**Given** |\n**When** \n**Then** ');
    assert.equal(add('Some notes\n\n|', 'scenario'), 'Some notes\n\n**Given** |\n**When** \n**Then** ');
  });

  test('text below keeps a blank line between it and the new lines', () => {
    assert.equal(add('First|\nSecond', 'story'), 'First\n\n**As a** |\n**I want** \n**So that** \n\nSecond');
    assert.equal(add('First|\n\nSecond', 'story'), 'First\n\n**As a** |\n**I want** \n**So that** \n\nSecond');
  });

  test('a second scenario goes after the first, separated by a blank line', () => {
    const once = add('|', 'scenario').replace('|', 'a cart').replace('**When** ', '**When** I pay').replace('**Then** ', '**Then** it works');
    assert.equal(add(once + '|', 'scenario'), '**Given** a cart\n**When** I pay\n**Then** it works\n\n**Given** |\n**When** \n**Then** ');
  });

  test('an acceptance criteria list puts the cursor on its first item', () => {
    assert.equal(add('|', 'criteria'), '## Acceptance criteria\n- [ ] |');
  });
});

describe('enterAction', () => {
  test('moves to the end of the next chained line while it is unfilled', () => {
    assert.equal(enter('**As a** cook|\n**I want** \n**So that** '), '**As a** cook\n**I want** |\n**So that** ');
    assert.equal(enter('**Given** a cart|\n**When** \n**Then** '), '**Given** a cart\n**When** |\n**Then** ');
  });

  test('adds a new line as usual once the next line is filled', () => {
    assert.equal(enter('**As a** cook|\n**I want** recipes\n**So that** '), null);
    assert.equal(enter('So that I eat well|'), null);
  });

  test('starts the next item in a list', () => {
    assert.equal(enter('## Acceptance criteria\n- [ ] Shows matches|'), '## Acceptance criteria\n- [ ] Shows matches\n- [ ] |');
  });

  test('ends the list on an empty item', () => {
    assert.equal(enter('## Acceptance criteria\n- [ ] Shows matches\n- [ ] |'), '## Acceptance criteria\n- [ ] Shows matches\n|');
  });

  test('leaves Enter alone mid-line, with a selection, or on a plain line', () => {
    assert.equal(enter('- Shows| matches'), null);
    assert.equal(enterAction('- Shows matches', 2, 7), null);
    assert.equal(enter('Some notes|'), null);
  });
});
