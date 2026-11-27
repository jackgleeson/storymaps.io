import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { lineBlock, isFence, inlineMarks, markdownToHtml } from '../../src/core/markdown-marks.js';
import { enterAction } from '../../src/core/story-lines.js';

const types = (line, start) => inlineMarks(line, start).map(m => `${m.type}:${line.slice(m.from, m.to)}`);

describe('Markdown in a card description', () => {
    test('headings, lists, tasks and quotes are told apart by how the line starts', () => {
        assert.deepEqual(lineBlock('## Problem'), { type: 'heading', level: 2, marker: 3 });
        assert.equal(lineBlock('#hashtag'), null);
        assert.deepEqual(lineBlock('- item'), { type: 'bullet', markerFrom: 0, marker: 2 });
        assert.deepEqual(lineBlock('  * item'), { type: 'bullet', markerFrom: 2, marker: 4 });
        assert.equal(lineBlock('- [x] done').checked, true);
        assert.deepEqual(lineBlock('- [ ] todo').box, { from: 2, to: 5, end: 6 });
        assert.equal(lineBlock('2. second').type, 'number');
        assert.equal(lineBlock('> said').type, 'quote');
        assert.equal(lineBlock('**bold** start'), null);
        assert.equal(lineBlock('*italic* start'), null);
        assert.equal(lineBlock('---'), null);
        assert.equal(isFence('```js'), true);
        assert.equal(isFence('~~~'), true);
        assert.equal(isFence('```points``` in a sentence'), false);
    });

    test('bold, italic, strike, code and links are found with their symbols', () => {
        assert.deepEqual(types('a **b** c *d* ~~e~~ `f`'), ['bold:**b**', 'italic:*d*', 'strike:~~e~~', 'code:`f`']);
        const [bold] = inlineMarks('x **yes** z');
        assert.deepEqual([bold.open, bold.close], [[2, 4], [7, 9]]);
        const [link] = inlineMarks('see [COF-120](https://example.com/a_b_c) now');
        assert.equal(link.url, 'https://example.com/a_b_c');
        assert.deepEqual([link.open, link.close], [[4, 5], [12, 40]]);
    });

    test('symbols inside code, link addresses and words are left alone', () => {
        assert.deepEqual(types('`a **b** c`'), ['code:`a **b** c`']);
        // Two or three backticks each side work in a sentence too, and can hold a single one
        assert.deepEqual(types('about 8 more ```points```.'), ['code:```points```']);
        assert.deepEqual(types('run ``a `b` c`` now'), ['code:``a `b` c``']);
        assert.deepEqual(inlineMarks('x ```y``` z')[0].open, [2, 5]);
        assert.deepEqual(types('snake_case_name and 2 * 3 * 4'), []);
        assert.deepEqual(types('go to https://example.com/x_y_z.'), ['url:https://example.com/x_y_z']);
        assert.deepEqual(types('* item with *stress*', 2), ['italic:*stress*']);
        assert.deepEqual(types('![alt](https://example.com/p.png)'), ['url:https://example.com/p.png']);
        // A strike or bold around a web address or a link takes in the whole of it
        assert.deepEqual(types('~~see https://x.io/a~~'), ['strike:~~see https://x.io/a~~', 'url:https://x.io/a']);
        assert.deepEqual(types('~~pay by [card](https://x.io/c)~~'), ['strike:~~pay by [card](https://x.io/c)~~', 'link:[card](https://x.io/c)']);
    });

    test('copied Markdown has a formatted copy for apps that take formatting', () => {
        assert.equal(markdownToHtml('## Problem\nNo **quick** way, see [COF-1](https://example.com/1).'),
            '<h2>Problem</h2><p>No <strong>quick</strong> way, see <a href="https://example.com/1">COF-1</a>.</p>');
        assert.equal(markdownToHtml('- one\n- [x] *two*\n\n1. three'), '<ul><li>one</li><li>\u2611 <em>two</em></li></ul><ol><li>three</li></ol>');
        assert.equal(markdownToHtml('a\nb\n\n> c'), '<p>a<br>b</p><blockquote>c</blockquote>');
        assert.equal(markdownToHtml('```\n<b> & **x**\n```'), '<pre><code>&lt;b&gt; &amp; **x**</code></pre>');
        // Text is escaped, and only http and https addresses become links
        assert.equal(markdownToHtml('<script> [x](javascript:alert)'), '<p>&lt;script&gt; <a>x</a></p>');
    });

    test('Enter carries on a list of any kind and ends it on an empty item', () => {
        const at = (text) => enterAction(text, text.length, text.length);
        assert.equal(at('- one').insert, '\n- ');
        assert.equal(at('* one').insert, '\n* ');
        assert.equal(at('  + one').insert, '\n  + ');
        assert.equal(at('- [x] one').insert, '\n- [ ] ');
        assert.equal(at('9. nine').insert, '\n10. ');
        assert.deepEqual(at('one\n* '), { from: 4, to: 6, insert: '', caret: 4 });
        assert.deepEqual(at('- [ ] '), { from: 0, to: 6, insert: '', caret: 0 });
        assert.equal(at('plain'), null);
        assert.equal(at('**bold**'), null);
    });
});
