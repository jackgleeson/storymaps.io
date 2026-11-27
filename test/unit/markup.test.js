import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  markdownToJiraWiki, markdownToRemarkup, markdownToAdf, markdownToAsanaHtml, markdownToHtml,
  jiraWikiToMarkdown, remarkupToMarkdown, adfToMarkdown, htmlToMarkdown,
} from '/src/transfer/markup.js';

const MARKDOWN = [
  '## Problem',
  'A customer has **no *quick* way** to find `one`, see [COF-1](https://example.com/1) or https://example.com/2.',
  'Second line.',
  '',
  '- one',
  '  - nested *it*',
  '- [ ] todo',
  '- [x] done',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted ~~text~~',
  '',
  '```',
  'code **raw**',
  '```',
].join('\n');

describe('card descriptions out to each tracker', () => {
  test('Jira wiki markup, for a CSV file', () => {
    assert.equal(markdownToJiraWiki(MARKDOWN), [
      'h2. Problem', '',
      'A customer has *no _quick_ way* to find {{one}}, see [COF-1|https://example.com/1] or https://example.com/2.',
      'Second line.', '',
      '* one', '** nested _it_', '* ☐ todo', '* ☑ done', '',
      '# first', '# second', '',
      'bq. quoted -text-', '',
      '{code}', 'code **raw**', '{code}',
    ].join('\n'));
    assert.equal(markdownToJiraWiki(''), '');
  });

  test('Phabricator Remarkup', () => {
    assert.equal(markdownToRemarkup(MARKDOWN), [
      '== Problem ==', '',
      'A customer has **no //quick// way** to find `one`, see [[ https://example.com/1 | COF-1 ]] or https://example.com/2.',
      'Second line.', '',
      '- one', '  - nested //it//', '- [ ] todo', '- [X] done', '',
      '# first', '# second', '',
      '> quoted ~~text~~', '',
      '```', 'code **raw**', '```',
    ].join('\n'));
  });

  test('Atlassian Document Format, for the Jira API', () => {
    const doc = markdownToAdf('## Pay\nBy **card** or `cash`, see [spec](https://example.com/s)\nnext line\n\n- [ ] one\n\n> said\n\n```\nx\n```');
    assert.deepEqual(doc.content.map(node => node.type), ['heading', 'paragraph', 'bulletList', 'blockquote', 'codeBlock']);
    assert.deepEqual(doc.content[0], { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Pay' }] });
    assert.deepEqual(doc.content[1].content, [
      { type: 'text', text: 'By ' },
      { type: 'text', text: 'card', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' or ' },
      { type: 'text', text: 'cash', marks: [{ type: 'code' }] },
      { type: 'text', text: ', see ' },
      { type: 'text', text: 'spec', marks: [{ type: 'link', attrs: { href: 'https://example.com/s' } }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'next line' },
    ]);
    assert.deepEqual(doc.content[2].content[0].content[0].content, [{ type: 'text', text: '[ ] ' }, { type: 'text', text: 'one' }]);
    // Code keeps no other mark but a link, and no text node is empty
    assert.deepEqual(markdownToAdf('**`x`**').content[0].content, [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }]);
    assert.equal(markdownToAdf(''), null);
    assert.equal(markdownToAdf('\n\n'), null);
  });

  test('Asana notes, and HTML for Azure DevOps', () => {
    assert.equal(markdownToAsanaHtml('# Pay\nOne & <two>\n\nThree\n### Small\n- a\n1. b'),
      '<body><h1>Pay</h1>One &amp; &lt;two&gt;\n\nThree\n\n<strong>Small</strong>\n<ul><li>a</li></ul><ol><li>b</li></ol></body>');
    assert.equal(markdownToHtml('# Pay\n- a'), '<h1>Pay</h1><ul><li>a</li></ul>');
  });
});

describe('each tracker\'s descriptions in as Markdown', () => {
  test('Jira wiki markup', () => {
    assert.equal(jiraWikiToMarkdown([
      'h2. Goal', 'Make *it* _work_ with {{x}} and [docs|https://x.io] -old- {color:red}now{color}',
      '# one', '# two', '** deep', '* ☑ ticked',
      '{code:java}', 'int *a* = 1;', '{code}',
      '{quote}', 'said', '{quote}',
      '2021-10-12 a - b - c snake_case 2 * 3 * 4',
    ].join('\r\n')), [
      '## Goal', 'Make **it** *work* with `x` and [docs](https://x.io) ~~old~~ now',
      '1. one', '2. two', '  - deep', '- [x] ticked',
      '```', 'int *a* = 1;', '```',
      '> said',
      '2021-10-12 a - b - c snake_case 2 * 3 * 4',
    ].join('\n'));
    assert.equal(jiraWikiToMarkdown('{noformat}a{noformat}'), '```\na\n```');
    assert.equal(jiraWikiToMarkdown(''), '');
  });

  test('Phabricator Remarkup', () => {
    assert.equal(remarkupToMarkdown([
      '= Big =', '== Small', '//it// and ##mono## http://x.io/a//b [[ https://x.io | site ]] `//kept//`',
      '# one', '# two', '- [X] done', '```', '//raw//', '```',
    ].join('\n')), [
      '# Big', '## Small', '*it* and `mono` http://x.io/a//b [site](https://x.io) `//kept//`',
      '1. one', '2. two', '- [x] done', '```', '//raw//', '```',
    ].join('\n'));
  });

  test('HTML, from Azure DevOps and Asana', () => {
    assert.equal(htmlToMarkdown('<div>Hello <b>bold </b>and <a href="https://x.io/a">link</a></div><div><br></div><h2>Head</h2>'
      + '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>x</li><li>y</li></ol><pre><code>a &lt; b\n  c</code></pre>'),
      'Hello **bold** and [link](https://x.io/a)\n\n## Head\n- a\n- b\n  - c\n1. x\n2. y\n```\na < b\n  c\n```');
    assert.equal(htmlToMarkdown('<body><h1>Pay</h1>One\n\nTwo <em>three</em><ul><li>☐ a</li></ul></body>', { newLines: true }), '# Pay\nOne\n\nTwo *three*\n- [ ] a');
    assert.equal(htmlToMarkdown('<a href="javascript:x">bad</a> <a href="https://x.io">https://x.io</a><script>x</script>'), 'bad https://x.io');
    assert.equal(htmlToMarkdown('<b>left open'), '**left open**');
  });

  test('Atlassian Document Format, from the Jira API', () => {
    const text = (t, ...marks) => ({ type: 'text', text: t, ...(marks.length && { marks: marks.map(type => (typeof type === 'string' ? { type } : type)) }) });
    const p = (...content) => ({ type: 'paragraph', content });
    const item = (...content) => ({ type: 'listItem', content });
    assert.equal(adfToMarkdown({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [text('Pay')] },
      p(text('By '), text('card', 'strong'), text(' or '), text('cash', 'code'), text(' see '), text('spec', { type: 'link', attrs: { href: 'https://x.io' } })),
      { type: 'bulletList', content: [item(p(text('one')), { type: 'orderedList', content: [item(p(text('deep')))] }), item(p(text('two')))] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [text('ticked')] }] },
      { type: 'blockquote', content: [p(text('said'))] },
      { type: 'codeBlock', content: [text('x = 1')] },
    ] }), '## Pay\n\nBy **card** or `cash` see [spec](https://x.io)\n\n- one\n  1. deep\n- two\n\n- [x] ticked\n\n> said\n\n```\nx = 1\n```');
    assert.equal(adfToMarkdown(null), '');
    assert.equal(adfToMarkdown(undefined), '');
  });

  test('a description survives the trip out to a tracker and back', () => {
    const simple = '## Pay\nBy **card** or *cash*, see [spec](https://x.io)\n\n- one\n- [x] two\n\n1. first';
    assert.equal(remarkupToMarkdown(markdownToRemarkup(simple)), '## Pay\n\nBy **card** or *cash*, see [spec](https://x.io)\n\n- one\n- [x] two\n\n1. first');
    assert.equal(jiraWikiToMarkdown(markdownToJiraWiki(simple)), '## Pay\n\nBy **card** or *cash*, see [spec](https://x.io)\n\n- one\n- [x] two\n\n1. first');
    assert.equal(adfToMarkdown(markdownToAdf(simple)), '## Pay\n\nBy **card** or *cash*, see [spec](https://x.io)\n\n- one\n- [x] two\n\n1. first');
    assert.equal(htmlToMarkdown(markdownToHtml(simple)), '## Pay\nBy **card** or *cash*, see [spec](https://x.io)\n- one\n- [x] two\n1. first');
  });
});

describe('hostile descriptions', () => {
  const N = 200_000;
  const rep = (unit) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
  const quick = (name, fn) => {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;
    // Each of these took seconds, or minutes, before the limits went in. The bound is generous for a slow machine.
    assert.ok(ms < 3000, `${name} took ${Math.round(ms)}ms`);
  };

  test('text built to be slow to read is read quickly, by every converter', () => {
    for (const unit of ['**a ', '__a ', '~~a ', '[', '[a](', '`a ', '[[ https://a | ', '//a ', '##a ', '[a|', '{{a ', '*a _b ', '**a\n', '- [ ] **a ']) {
      const text = rep(unit);
      quick(`${unit} to ADF`, () => markdownToAdf(text));
      quick(`${unit} to HTML`, () => markdownToHtml(text));
      quick(`${unit} to wiki`, () => markdownToJiraWiki(text));
      quick(`${unit} to Remarkup`, () => markdownToRemarkup(text));
      quick(`${unit} to Asana`, () => markdownToAsanaHtml(text));
      quick(`${unit} from Remarkup`, () => remarkupToMarkdown(text));
      quick(`${unit} from wiki`, () => jiraWikiToMarkdown(text));
    }
    for (const unit of ['<script>', '<!--', '<b>', '<', '<ul><li>', '<li>', '<pre>', '<blockquote>', '<a href="x">', '</b>']) {
      quick(`${unit} from HTML`, () => htmlToMarkdown(rep(unit)));
    }
    let deep = { type: 'text', text: 'x' };
    for (let i = 0; i < 5000; i++) deep = { type: 'paragraph', content: [deep] };
    quick('deep ADF', () => adfToMarkdown({ type: 'doc', content: [deep] }));
  });

  test('a line too dense to search comes through as plain text, not lost', () => {
    const line = rep('**a ').slice(0, 6000);
    assert.equal(markdownToRemarkup(line), line);
    assert.equal(remarkupToMarkdown(rep('//a ').slice(0, 6000)), rep('//a ').slice(0, 6000).trim());
    assert.deepEqual(markdownToAdf(line).content[0].content, [{ type: 'text', text: line }]);
  });

  test('nothing that runs script survives a conversion', () => {
    // Out to HTML: text is escaped, and only web addresses become links
    for (const toHtml of [markdownToHtml, markdownToAsanaHtml]) {
      const html = toHtml('<img src=x onerror=alert(1)> [x](javascript:alert) [y](data:text/html,x) **<script>alert(1)</script>** "q"');
      assert.equal(/<(img|script)/i.test(html), false, html);
      assert.equal(/href="(?!https?:)/i.test(html), false, html);
      assert.equal(html.includes('&lt;script&gt;'), true);
    }
    assert.equal(markdownToHtml('[a](https://x.io/"onmouseover="alert(1))').includes('"onmouseover'), false);
    const marks = JSON.stringify(markdownToAdf('[x](javascript:alert) [y](https://x.io)'));
    assert.equal(marks.includes('javascript'), false);
    assert.deepEqual([...marks.matchAll(/"href":"([^"]*)"/g)].map(m => m[1]), ['https://x.io']);

    // In from HTML: scripts, styles and comments go, and a link keeps its address only if it is a web or mail one
    assert.equal(htmlToMarkdown('<script>alert(1)</script>a<style>x{}</style><!-- <b>c</b> -->b<SCRIPT>x</SCRIPT>'), 'ab');
    assert.equal(htmlToMarkdown('<a href="javascript:alert(1)">x</a> <a href="&#106;avascript:alert(1)">y</a> <a href="JaVaScRiPt:x">z</a> <a href="data:text/html,x">d</a>'), 'x y z d');
    assert.equal(htmlToMarkdown('<a href="https://x.io">ok</a> <img src=x onerror=alert(1)> <b onclick="x">bold</b>'), '[ok](https://x.io) **bold**');
    assert.equal(htmlToMarkdown('<scr<script>ipt>alert(1)</script>'), '');
    assert.equal(htmlToMarkdown('a < b and <b>c'), 'a < b and **c**');
  });
});
