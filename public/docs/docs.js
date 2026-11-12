// Storymaps.io — AGPL-3.0 — see LICENCE for details
// Docs pages: the theme switch, the phone menu, search, course progress and the "On this page"
// highlight

(function () {
    var root = document.documentElement;

    // Theme, shared with the app through localStorage.darkMode
    var SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    var MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    var themeBtn = document.querySelector('[data-theme-toggle]');
    var showTheme = function () {
        if (!themeBtn) return;
        var dark = root.classList.contains('dark-mode');
        var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
        themeBtn.innerHTML = dark ? SUN : MOON;
        themeBtn.setAttribute('aria-label', label);
        themeBtn.title = label;
    };
    showTheme();
    if (themeBtn) themeBtn.addEventListener('click', function () {
        var dark = !root.classList.contains('dark-mode');
        root.classList.toggle('dark-mode', dark);
        try { localStorage.setItem('darkMode', String(dark)); } catch (e) {}
        showTheme();
        // A practice story map open beside a lesson follows the switch too
        var practiceFrame = document.querySelector('[data-practice-frame]');
        try { practiceFrame.contentDocument.documentElement.classList.toggle('dark-mode', dark); } catch (e) {}
    });

    // Phone menu
    var openBtn = document.querySelector('[data-nav-open]');
    var setNav = function (open) {
        document.body.classList.toggle('nav-open', open);
        if (openBtn) openBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            var current = document.querySelector('.docs-side a.on') || document.querySelector('.docs-side a');
            if (current) current.focus({ preventScroll: false });
        } else if (openBtn && document.activeElement && document.activeElement.closest('.docs-side')) {
            openBtn.focus();
        }
    };
    if (openBtn) {
        if (!document.getElementById('docsNav')) openBtn.hidden = true;
        openBtn.addEventListener('click', function () { setNav(true); });
    }
    document.querySelectorAll('[data-nav-close]').forEach(function (el) {
        el.addEventListener('click', function () { setNav(false); });
    });

    // Copy on a terminal copies its commands, without the $, and on a file its lines
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
        var label = btn.querySelector('span');
        btn.addEventListener('click', function () {
            var box = btn.closest('figure');
            var cmds = box.querySelectorAll('[data-cmd]');
            var text = cmds.length
                ? Array.prototype.map.call(cmds, function (c) { return c.textContent.replace(/^\$ /, ''); }).join('\n')
                : Array.prototype.map.call(box.querySelectorAll('.file-line code'), function (c) { return c.textContent; }).join('\n');
            if (!navigator.clipboard) return;
            navigator.clipboard.writeText(text).then(function () {
                label.textContent = 'Copied';
                setTimeout(function () { label.textContent = 'Copy'; }, 1500);
            }, function () {});
        });
    });

    // Search, from an index built with the pages
    var index = null;
    var loading = null;
    var loadIndex = function () {
        if (index) return Promise.resolve(index);
        if (!loading) loading = fetch('/docs/search.json').then(function (r) { return r.json(); }).then(function (data) { index = data; return data; });
        return loading;
    };
    var escapeHtml = function (s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    // Every word must appear somewhere; titles and headings count for more than body text
    var search = function (query) {
        var words = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        var results = [];
        index.forEach(function (page) {
            var title = page.title.toLowerCase();
            var body = (page.description + ' ' + page.text).toLowerCase();
            var score = 0;
            var all = words.every(function (w) {
                var hit = false;
                if (title.indexOf(w) !== -1) { score += 10; hit = true; }
                page.headings.forEach(function (h) { if (h.text.toLowerCase().indexOf(w) !== -1) { score += 4; hit = true; } });
                if (body.indexOf(w) !== -1) { score += 1; hit = true; }
                return hit;
            });
            if (!all) return;
            results.push({ url: page.url, title: page.title, sub: page.section, score: score });
            page.headings.forEach(function (h) {
                var text = h.text.toLowerCase();
                if (words.every(function (w) { return text.indexOf(w) !== -1 || title.indexOf(w) !== -1; }) && words.some(function (w) { return text.indexOf(w) !== -1; })) {
                    results.push({ url: page.url + '#' + h.id, title: h.text, sub: page.title, score: score + 5 });
                }
            });
        });
        return results.sort(function (a, b) { return b.score - a.score; }).slice(0, 8);
    };
    document.querySelectorAll('[data-search]').forEach(function (input) {
        var box = input.parentElement;
        var list = null;
        var active = -1;
        var close = function () { if (list) { list.remove(); list = null; } active = -1; };
        var show = function () {
            var q = input.value.trim();
            if (!q) { close(); return; }
            loadIndex().then(function () {
                var found = search(q);
                if (!list) {
                    list = document.createElement('div');
                    list.className = 'search-results';
                    list.setAttribute('role', 'listbox');
                    box.appendChild(list);
                }
                active = found.length ? 0 : -1;
                list.innerHTML = found.length
                    ? found.map(function (r, i) {
                        return '<a href="' + escapeHtml(r.url) + '" role="option"' + (i === 0 ? ' class="active"' : '') + '><b>' + escapeHtml(r.title) + '</b><span>' + escapeHtml(r.sub) + '</span></a>';
                    }).join('')
                    : '<div class="none">Nothing found for "' + escapeHtml(q) + '"</div>';
            }).catch(function () { close(); });
        };
        var move = function (by) {
            if (!list) return;
            var links = list.querySelectorAll('a');
            if (!links.length) return;
            if (links[active]) links[active].classList.remove('active');
            active = (active + by + links.length) % links.length;
            links[active].classList.add('active');
            links[active].scrollIntoView({ block: 'nearest' });
        };
        input.addEventListener('input', show);
        input.addEventListener('focus', function () { loadIndex().catch(function () {}); if (input.value.trim()) show(); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') {
                var link = list && list.querySelectorAll('a')[active];
                if (link) { e.preventDefault(); location.href = link.href; }
            } else if (e.key === 'Escape') { close(); input.blur(); }
        });
        document.addEventListener('pointerdown', function (e) { if (!box.contains(e.target)) close(); });
    });

    // Phones: the search button opens the search box under the logo
    var searchBtn = document.querySelector('[data-search-open]');
    if (searchBtn) searchBtn.addEventListener('click', function () {
        var header = searchBtn.closest('.site-header');
        var open = header.classList.toggle('search-open');
        searchBtn.setAttribute('aria-expanded', String(open));
        if (open) header.querySelector('.header-search input').focus();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { setNav(false); return; }
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        var input = Array.prototype.find.call(document.querySelectorAll('[data-search]'), function (el) { return el.offsetParent !== null; });
        if (input) { e.preventDefault(); input.focus(); }
    });

    // Course progress, kept in this browser only: { "first-map/3": { ticks: [true, false], done: false } }
    var PROGRESS_KEY = 'docsProgress';
    var progress = {};
    try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) {}
    var saveProgress = function () { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {} };
    var doneIn = function (course) {
        return Object.keys(progress).filter(function (k) { return k.indexOf(course + '/') === 0 && progress[k].done; }).length;
    };
    var showProgress = function () {
        document.querySelectorAll('[data-lesson-mark]').forEach(function (el) {
            var done = !!(progress[el.getAttribute('data-lesson-mark')] || {}).done;
            el.classList.toggle(el.tagName === 'I' ? 'done-mark' : 'done', done);
        });
        document.querySelectorAll('[data-course-progress]').forEach(function (el) {
            var done = doneIn(el.getAttribute('data-course-progress'));
            var total = el.getAttribute('data-lessons');
            var onLesson = el.classList.contains('lesson-count');
            el.textContent = onLesson ? done + ' of ' + total + ' lessons done' : done ? done + ' of ' + total + ' done' : '';
        });
        document.querySelectorAll('[data-course-bar]').forEach(function (el) {
            el.style.width = (doneIn(el.getAttribute('data-course-bar')) / Number(el.getAttribute('data-lessons')) * 100) + '%';
        });
        // The courses page: each course's button carries on from the first lesson not yet done
        document.querySelectorAll('[data-course-go]').forEach(function (el) {
            var course = el.getAttribute('data-course-go');
            var written = el.getAttribute('data-written').split(',').map(Number);
            var done = doneIn(course);
            var next = written.find(function (n) { return !(progress[course + '/' + n] || {}).done; });
            el.href = '/learn/' + course + '/' + (done && next ? next : written[0]);
            el.textContent = !done ? 'Start the course' : next ? 'Continue with lesson ' + next : 'Go through it again';
        });
    };
    var lesson = document.querySelector('[data-lesson]');
    if (lesson) {
        var key = lesson.getAttribute('data-lesson');
        var boxes = Array.prototype.slice.call(lesson.querySelectorAll('[data-task]'));
        var hint = lesson.querySelector('[data-lesson-hint]');
        var saved = (progress[key] || {}).ticks || [];
        boxes.forEach(function (box, i) { box.checked = !!saved[i]; });
        // A burst of confetti in the sticky-note colours, from the Next button, when the last task ticks
        var celebrate = function () {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            var from = lesson.querySelector('.lesson-foot a, .lesson-foot .btn') || hint || lesson;
            var box = from.getBoundingClientRect();
            var x = box.left + box.width / 2, y = box.top + box.height / 2;
            // Scrolled out of view: burst from the middle of the lesson column instead
            if (y < 0 || y > window.innerHeight) {
                var col = lesson.getBoundingClientRect();
                x = col.left + col.width / 2;
                y = window.innerHeight * 0.6;
            }
            var colours = ['#fef08a', '#86efac', '#fca5a5', '#93c5fd', '#2dd4bf', '#c4b5fd'];
            var layer = document.createElement('div');
            layer.className = 'confetti';
            layer.setAttribute('aria-hidden', 'true');
            document.body.appendChild(layer);
            for (var i = 0; i < 70; i++) {
                var bit = document.createElement('span');
                bit.style.left = x + 'px';
                bit.style.top = y + 'px';
                bit.style.background = colours[i % colours.length];
                layer.appendChild(bit);
                var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
                var speed = 180 + Math.random() * 260;
                var dx = Math.cos(angle) * speed, dy = Math.sin(angle) * speed;
                var spin = (Math.random() - 0.5) * 1080;
                bit.animate([
                    { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
                    { transform: 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + spin / 2 + 'deg)', opacity: 1, offset: 0.45 },
                    { transform: 'translate(' + dx * 1.4 + 'px, ' + (dy + 420) + 'px) rotate(' + spin + 'deg)', opacity: 0 }
                ], { duration: 1400 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
            }
            setTimeout(function () { layer.remove(); }, 2200);
        };
        var wasDone = !!(progress[key] || {}).done;
        var hintText = hint ? hint.textContent : '';
        // A lesson written as steps (docs/build.js renderSteps) shows one in focus: the first not
        // done. Steps done fold to their title with a tick, and the ones after show only their title.
        var stepItems = Array.prototype.slice.call(lesson.querySelectorAll('[data-step]'));
        var stepsBar = lesson.querySelector('[data-steps-bar]');
        var stepsCount = lesson.querySelector('[data-steps-count]');
        var drawSteps = function (done) {
            if (!stepItems.length) return;
            var current = -1, count = 0;
            stepItems.forEach(function (li, i) {
                var ticked = li.querySelector('[data-task]').checked;
                if (ticked) count++;
                var now = !ticked && current < 0;
                if (now) current = i;
                li.classList.toggle('done', ticked);
                li.classList.toggle('current', now);
                li.classList.toggle('upcoming', !ticked && !now);
                if (now) li.classList.remove('peek');
            });
            // Done, the steps fold to one line, so what the lesson was for and the way on are in view
            var list = stepItems[0].closest('.lsteps');
            if (list) list.classList.toggle('lsteps-complete', !!done && !list.classList.contains('lsteps-shown'));
            if (stepsBar) stepsBar.style.width = (count / stepItems.length * 100) + '%';
            if (stepsCount) stepsCount.textContent = count + ' of ' + stepItems.length;
            lesson.querySelectorAll('[data-moment]').forEach(function (el) { el.hidden = !done; });
            lesson.dispatchEvent(new CustomEvent('steps-drawn', { detail: { done: !!done } }));
        };
        var update = function (changed) {
            var ticks = boxes.map(function (b) { return b.checked; });
            var done = ticks.every(Boolean);
            if (changed) { progress[key] = { ticks: ticks, done: done }; saveProgress(); }
            drawSteps(done);
            if (changed && done && !wasDone) {
                // Bring what the lesson was for into view, with the Next button under it
                var moment = lesson.querySelector('[data-moment]');
                if (moment) moment.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
                celebrate();
            }
            wasDone = done;
            lesson.classList.toggle('lesson-done', done);
            lesson.querySelectorAll('.tasks').forEach(function (t) { t.classList.toggle('all-done', done); });
            if (hint) hint.textContent = done ? 'Lesson complete.' : hintText;
            showProgress();
        };
        boxes.forEach(function (box) { box.addEventListener('change', function () { update(true); }); });
        // Start again on the practice story map clears this lesson's ticks, and only this lesson's
        var resetLesson = function () {
            boxes.forEach(function (box) {
                box.checked = false;
                var li = box.closest('li');
                if (!li) return;
                li.classList.remove('ticked-for-you', 'peek');
                var hintEl = li.querySelector('.task-hint');
                if (hintEl) hintEl.hidden = true;
            });
            lesson.querySelectorAll('.lsteps').forEach(function (list) { list.classList.remove('lsteps-shown'); });
            wasDone = false;
            update(true);
        };
        lesson.querySelectorAll('[data-steps-show]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var list = btn.closest('.lsteps');
                list.classList.add('lsteps-shown');
                list.classList.remove('lsteps-complete');
            });
        });
        stepItems.forEach(function (li) {
            var box = li.querySelector('[data-task]');
            // A step the learner marks done, or any step on a narrow screen, where nothing ticks itself
            li.querySelector('[data-step-done]').addEventListener('click', function () {
                if (box.checked) return;
                box.checked = true;
                box.dispatchEvent(new Event('change'));
            });
            // A step that isn't in focus opens for a look when its title is clicked
            li.querySelector('[data-step-head]').addEventListener('click', function () {
                if (!li.classList.contains('current')) li.classList.toggle('peek');
            });
        });
        // A reading lesson has no tasks: it's done once the reader moves on from it
        if (!boxes.length) {
            update = function (changed) {
                if (changed) { progress[key] = { ticks: [], done: true }; saveProgress(); }
                var done = !!(progress[key] || {}).done;
                lesson.classList.toggle('lesson-done', done);
                if (hint) hint.textContent = '';
                showProgress();
            };
            lesson.querySelectorAll('[data-lesson-finish]').forEach(function (el) {
                el.addEventListener('click', function () { update(true); });
            });
        }
        update(false);
    } else {
        showProgress();
    }

    // Practice mode: on a wide screen, the practice story map opens beside the lesson in a frame.
    // The lesson remembers the story map it made, so coming back opens the same one, and the
    // pane stays open across reloads. Phones open it in a new tab, as the link does on its own.
    var pane = document.querySelector('[data-practice-pane]');
    if (pane && lesson) {
        var PRACTICE_KEY = 'docsPractice';
        var practice = {};
        try { practice = JSON.parse(localStorage.getItem(PRACTICE_KEY)) || {}; } catch (e) {}
        var savePractice = function () { try { localStorage.setItem(PRACTICE_KEY, JSON.stringify(practice)); } catch (e) {} };
        var lessonKey = lesson.getAttribute('data-lesson');
        var mine = practice[lessonKey] || {};
        var courseOpenKey = lessonKey.split('/')[0] + ':open';
        var frame = pane.querySelector('[data-practice-frame]');
        // The story map's controls live in the header (docs/build.js practiceControls)
        var tabLink = document.querySelector('[data-practice-tab]');
        var openLinks = Array.prototype.slice.call(document.querySelectorAll('[data-practice]'));
        // The same width as the split in docs.css
        var wide = window.matchMedia('(min-width: 1260px)');
        var watch = null;
        // The app swaps /new or /sample/<name> for the link of the story map it made
        // A story map in a project keeps its project link, so the tabs come back too
        var MAP_PATH = /^\/(p\/[a-z0-9]{8}\/)?[a-z0-9]{8}$/;
        // A lesson that carries on from the one before starts on that story map, until Start again
        var before = pane.getAttribute('data-continues');
        if (!mine.path && !mine.restarted && before && practice[before] && practice[before].path) mine.path = practice[before].path;
        var mapUrl = function () { return mine.path ? mine.path + '?lesson' : pane.getAttribute('data-src'); };
        // Commands in a CLI lesson name the practice story map. Over http, such as a server on this
        // computer, they need the whole address, as the CLI goes over https otherwise.
        var mapLinks = document.querySelectorAll('[data-practice-map]');
        // A link that opens the practice story map with a set of cards added (docs/build.js !add)
        var addLinks = Array.prototype.slice.call(document.querySelectorAll('[data-add-cards]'));
        var projectLinks = document.querySelectorAll('[data-practice-project]');
        var label = function () {
            openLinks.forEach(function (a) {
                a.textContent = mine.path ? 'Back to your practice story map' : 'Open practice story map';
                a.href = mapUrl();
            });
            tabLink.href = mapUrl();
            addLinks.forEach(function (a) { a.href = mapUrl() + '&add=' + a.getAttribute('data-add-cards'); });
            var site = location.protocol === 'https:' ? location.host : location.origin;
            if (mine.path) mapLinks.forEach(function (el) { el.textContent = site + mine.path; });
            // Once the story map is in a project, commands can name the whole project
            var inProject = (mine.path || '').match(/^\/p\/([a-z0-9]{8})\//);
            if (inProject) projectLinks.forEach(function (el) { el.textContent = site + '/p/' + inProject[1]; });
        };
        // Tasks with a check (data-check, written by docs/build.js) tick themselves once the story
        // map beside the lesson shows they're done. A check only ever adds a tick.
        var norm = function (s) { return String(s == null ? '' : s).trim().toLowerCase(); };
        var has = function (list, name) { return list.some(function (x) { return norm(x) === norm(name); }); };
        var pair = function (words, sep) { return words.split(sep).map(function (w) { return w.trim(); }); };
        var allTasks = function (m) { return m.slices.reduce(function (all, sl) { return all.concat(sl.tasks); }, []); };
        var findTask = function (m, name) { return allTasks(m).filter(function (t) { return norm(t.name) === norm(name); })[0]; };
        // A name of the learner's own, not empty and not what a new card says
        var named = function (n, blank) { return !!norm(n) && norm(n) !== norm(blank); };
        var namedSteps = function (m) { return m.steps.filter(function (n) { return named(n, 'New Step'); }); };
        // The first step the first slice has no task under, where a customer would get stuck
        var stuckAt = function (m) {
            var sl = m.slices[0];
            if (!sl) return null;
            var gap = m.steps.filter(function (st) { return !sl.tasks.some(function (t) { return norm(t.step) === norm(st) && t.name; }); });
            return gap.length ? (gap[0] || 'a step') : null;
        };
        // The card sets the lesson's checks name, from docs/card-sets.json
        var SETS = {};
        try { SETS = JSON.parse(document.getElementById('cardSets').textContent); } catch (e) { /* no sets on this lesson */ }
        var findSlice = function (m, name) { return m.slices.filter(function (sl) { return norm(sl.name) === norm(name); })[0]; };
        var CHECKS = {
            'name': function (m, w) { return norm(m.name) === norm(w); },
            'user': function (m, w) { return has(m.users, w); },
            'activity': function (m, w) { return has(m.activities, w); },
            'step': function (m, w) { return has(m.steps, w); },
            'steps': function (m, w) { return pair(w, ',').every(function (st) { return has(m.steps, st); }); },
            'step-before': function (m, w) {
                var p = pair(w, ','), at = m.steps.map(norm);
                var a = at.indexOf(norm(p[0])), b = at.indexOf(norm(p[1]));
                return a >= 0 && b >= 0 && a < b;
            },
            'task': function (m, w) {
                var p = pair(w, '>');
                return allTasks(m).some(function (t) { return norm(t.step) === norm(p[0]) && norm(t.name) === norm(p[1]); });
            },
            'tasks-under-every-step': function (m) {
                var tasks = allTasks(m);
                return m.steps.length > 0 && m.steps.every(function (st) { return tasks.some(function (t) { return norm(t.step) === norm(st) && t.name; }); });
            },
            'task-body': function (m) { return allTasks(m).some(function (t) { return t.body.trim(); }); },
            'slice': function (m, w) { return !!findSlice(m, w); },
            'slice-goal': function (m, w) { var sl = findSlice(m, w); return !!(sl && sl.goal.trim()); },
            'slice-date': function (m, w) { var sl = findSlice(m, w); return !!(sl && sl.targetDate); },
            'task-in-slice': function (m, w) {
                var p = pair(w, '>'), sl = findSlice(m, p[0]);
                return !!sl && sl.tasks.some(function (t) { return norm(t.name) === norm(p[1]); });
            },
            'status': function (m, w) { var p = pair(w, '='), t = findTask(m, p[0]); return !!t && norm(t.status) === norm(p[1]); },
            'color': function (m, w) { var p = pair(w, '='), t = findTask(m, p[0]); return !!t && norm(t.color) === norm(p[1]); },
            'tag': function (m, w) { var p = pair(w, '='), t = findTask(m, p[0]); return !!t && has(t.tags, p[1]); },
            'gone': function (m, w) { return !findTask(m, w); },
            'partial': function (m, w) { return m.partials.some(function (pm) { return norm(pm.name) === norm(w); }); },
            'partial-uses': function (m, w) {
                var p = pair(w, '=');
                return m.partials.some(function (pm) { return norm(pm.name) === norm(p[0]) && pm.uses === Number(p[1]); });
            },
            'points': function (m, w) { var p = pair(w, '='), t = findTask(m, p[0]); return !!t && Number(t.points) === Number(p[1]); },
            'slice-complete': function (m, w) { var sl = findSlice(m, w); return !!(sl && sl.closed === 'complete'); },
            'legend': function (m, w) { return has(m.legend, w); },
            'notes': function (m, w) { return norm(m.notes).indexOf(norm(w)) >= 0; },
            // A CLI lesson: a change pushed from the terminal, or a CLI log entry starting with these words
            'cli-push': function (m) { return (m.log || []).some(function (e) { return e.src === 'cli'; }); },
            'cli-log': function (m, w) { return (m.log || []).some(function (e) { return e.src === 'cli' && norm(e.text).indexOf(norm(w)) === 0; }); },
            // Something done beside the lesson that the story map can't show, such as a button
            // clicked (named as analytics.js names it) or a change made with a second window open
            'did': function (m, w) { return (m.did || []).indexOf(w.trim()) >= 0; },
            'did-any': function (m, w) { return pair(w, ',').some(function (x) { return (m.did || []).indexOf(x) >= 0; }); },
            // Checks on the shape of the story map, so any sensible answer ticks
            'map-named': function (m) { return named(m.name, 'Untitled map'); },
            'user-named': function (m) { return m.users.some(function (n) { return named(n, 'User Type'); }); },
            'activity-named': function (m) { return m.activities.some(function (n) { return named(n, 'New Activity'); }); },
            'steps-at-least': function (m, w) { return namedSteps(m).length >= Number(w); },
            'cards-added': function (m, w) { var set = SETS[w.trim()]; return !!set && set.cards.every(function (c) { return !!findTask(m, c); }); },
            'sorted': function (m, w) {
                var set = SETS[w.trim()];
                return !!set && !has(m.steps, set.step) && set.cards.every(function (c) { return !!findTask(m, c); });
            },
            'new-task-last-step': function (m, w) {
                var set = SETS[w.trim()];
                var last = m.steps[m.steps.length - 1];
                return !!set && last !== undefined && allTasks(m).some(function (t) {
                    return norm(t.step) === norm(last) && named(t.name, 'New Task or Detail') && !has(set.cards, t.name);
                });
            },
            'release-goal': function (m) { var sl = m.slices[0]; return !!sl && !!sl.name && !!String(sl.goal || '').trim(); },
            'thin-release': function (m) {
                var sl = m.slices[0];
                return !!sl && !stuckAt(m) && m.slices.slice(1).some(function (later) { return later.tasks.some(function (t) { return t.name; }); });
            }
        };
        var passes = function (check, m) {
            return check.split(';').every(function (part) {
                var at = part.indexOf(':');
                var kind = (at < 0 ? part : part.slice(0, at)).trim();
                return CHECKS[kind] ? CHECKS[kind](m, at < 0 ? '' : part.slice(at + 1)) : false;
            });
        };
        // A name the story map nearly has: a letter or two out, such as a typo. The hint only says
        // to check the spelling, never which name, so it can't give the answer away or be wrong.
        var distance = function (a, b) {
            if (Math.abs(a.length - b.length) > 2) return 3;
            var prev = [], cur, i, j;
            for (j = 0; j <= b.length; j++) prev[j] = j;
            for (i = 1; i <= a.length; i++) {
                cur = [i];
                for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = cur;
            }
            return prev[b.length];
        };
        var NAMED = { 'name': 1, 'user': 1, 'activity': 1, 'step': 1, 'steps': 1, 'step-before': 1, 'task': 1, 'slice': 1,
            'slice-goal': 1, 'slice-date': 1, 'slice-complete': 1, 'task-in-slice': 1, 'status': 1, 'points': 1, 'color': 1,
            'tag': 1, 'legend': 1, 'partial': 1, 'partial-uses': 1 };
        var wantedNames = function (check) {
            var wanted = [];
            check.split(';').forEach(function (part) {
                var at = part.indexOf(':');
                var kind = (at < 0 ? part : part.slice(0, at)).trim();
                if (!NAMED[kind]) return;
                var words = at < 0 ? '' : part.slice(at + 1).split('=')[0];
                words.split(/[>,]/).forEach(function (w) { if (w.trim()) wanted.push(norm(w)); });
            });
            return wanted;
        };
        var nearMiss = function (check, m) {
            var have = [m.name].concat(m.users, m.activities, m.steps, m.legend || [],
                (m.partials || []).map(function (p) { return p.name; }),
                m.slices.map(function (sl) { return sl.name; }),
                allTasks(m).map(function (t) { return t.name; })).map(norm);
            return wantedNames(check).some(function (w) {
                if (w.length < 5 || have.indexOf(w) >= 0) return false;
                return have.some(function (h) { var d = distance(w, h); return d > 0 && d <= 2; });
            });
        };
        // What a step is missing, in story terms, without giving the answer away
        var STORY_HINTS = {
            'steps-at-least': function (m, w) {
                var k = namedSteps(m).length;
                return k > 0 && k < Number(w) ? k + ' of at least ' + Number(w) + ' steps so far.' : null;
            },
            'sorted': function (m, w) {
                var set = SETS[w.trim()];
                if (!set) return null;
                if (has(m.steps, set.step)) {
                    var left = allTasks(m).filter(function (t) { return norm(t.step) === norm(set.step) && t.name; }).length;
                    return left ? left + (left === 1 ? ' ticket' : ' tickets') + ' left to sort.' : 'All sorted. Right-click ' + set.step + ' and choose Delete column.';
                }
                var missing = set.cards.filter(function (c) { return !findTask(m, c); }).length;
                return missing && missing < set.cards.length ? missing + ' tickets went with the column. Ctrl+Z brings them back.' : null;
            },
            'new-task-last-step': function (m, w) {
                var set = SETS[w.trim()];
                if (!set || has(m.steps, set.step) || !m.steps.length) return null;
                return 'Nothing new under ' + m.steps[m.steps.length - 1] + ' yet.';
            },
            'thin-release': function (m) {
                var sl = m.slices[0];
                if (!sl || m.slices.length < 2) return null;
                var stuck = stuckAt(m);
                return stuck ? 'A customer can\'t get past ' + stuck + ' in this release.' : 'Move what can wait into the slice below.';
            }
        };
        var storyHint = function (check, m) {
            var text = null;
            check.split(';').some(function (part) {
                var at = part.indexOf(':');
                var kind = (at < 0 ? part : part.slice(0, at)).trim();
                text = STORY_HINTS[kind] ? STORY_HINTS[kind](m, at < 0 ? '' : part.slice(at + 1)) : null;
                return !!text;
            });
            return text;
        };
        var hintFor = function (box) {
            var li = box.closest('li');
            var hint = li.querySelector('.task-hint');
            if (!hint) {
                hint = document.createElement('p');
                hint.className = 'task-hint';
                hint.hidden = true;
                // In a step, above its button
                var meta = li.querySelector('.lstep-meta');
                if (meta) meta.parentNode.insertBefore(hint, meta); else li.appendChild(hint);
            }
            return hint;
        };
        var tickDone = function () {
            var m;
            try { m = frame.contentWindow.storymapsLesson && frame.contentWindow.storymapsLesson.summary(); } catch (e) { return; }
            if (!m) return;
            // Nothing ticks while the learner is still typing in the card that made it pass, so a step
            // doesn't fold on the first letter of a name. It ticks once they leave that card, by
            // clicking away or with Tab into the next one.
            var editingEl = null;
            try {
                var active = frame.contentDocument.activeElement;
                if (active && (/^(INPUT|TEXTAREA)$/.test(active.tagName) || active.isContentEditable)) editingEl = active;
            } catch (e) { /* the story map isn't on this site */ }
            boxes.forEach(function (box) {
                var check = box.getAttribute('data-check');
                if (!check) return;
                var done = box.checked || passes(check, m);
                var li = box.closest('li');
                var hint = li.querySelector('.task-hint');
                // In a lesson of steps, only the step in focus gives a hint
                var text = done || (li.hasAttribute('data-step') && !li.classList.contains('current')) ? null
                    : storyHint(check, m) || (nearMiss(check, m) ? 'Almost there. Check the spelling matches the lesson.' : null);
                if (text) { hint = hintFor(box); hint.textContent = text; hint.hidden = false; }
                else if (hint) hint.hidden = true;
                // A step that waits for its button: the button works once the story map shows the check
                if (box.hasAttribute('data-gated')) {
                    var gate = li.querySelector('[data-step-done]');
                    if (gate) gate.disabled = !done;
                    return;
                }
                if (box.checked || !done) { box._typingIn = null; return; }
                // Passing while the learner types: wait until focus leaves the field they were typing
                // in when it first passed
                if (editingEl) {
                    if (!box._typingIn) box._typingIn = editingEl;
                    if (box._typingIn === editingEl && editingEl.isConnected) return;
                }
                box._typingIn = null;
                box.checked = true;
                box.closest('li').classList.add('ticked-for-you');
                box.dispatchEvent(new Event('change'));
            });
        };
        var remember = function () {
            tickDone();
            var path;
            try { path = frame.contentWindow.location.pathname; } catch (e) { return; }
            if (MAP_PATH.test(path) && path !== mine.path) {
                mine.path = path;
                practice[lessonKey] = mine;
                savePractice();
                label();
            }
        };
        var setOpen = function (open) {
            document.body.classList.toggle('practicing', open);
            pane.hidden = !open;
            mine.open = open;
            practice[lessonKey] = mine;
            // Practising carries on through the course: the next lesson opens its story map too
            practice[courseOpenKey] = open;
            savePractice();
            clearInterval(watch);
            if (open) {
                if (!frame.getAttribute('src')) frame.src = mapUrl();
                watch = setInterval(remember, 1000);
            }
        };
        openLinks.forEach(function (a) {
            a.addEventListener('click', function (e) {
                if (!wide.matches) return;
                e.preventDefault();
                setOpen(true);
                frame.focus();
            });
        });
        addLinks.forEach(function (a) {
            a.addEventListener('click', function (e) {
                if (!wide.matches) return;
                e.preventDefault();
                setOpen(true);
                frame.src = a.href;
            });
        });
        document.querySelector('[data-practice-close]').addEventListener('click', function () {
            // Leaving full screen first, so closing never leaves an empty full screen behind
            if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
            setOpen(false);
        });
        // The bar above the story map: its tips, and Full screen, which gives the story map the whole
        // screen and shows the step the learner is on, with its button for a step they mark done
        if (/Mac/.test(navigator.platform || navigator.userAgent)) {
            document.querySelectorAll('[data-practice-reset-key]').forEach(function (k) { k.textContent = 'Shift + 0'; });
        }
        var fullBtn = document.querySelector('[data-practice-full]');
        var stepLine = pane.querySelector('[data-practice-step]');
        var stepDone = pane.querySelector('[data-practice-step-done]');
        var isFull = function () { return document.fullscreenElement === pane; };
        // In full screen the header is out of view, so the pane's own bar shows the step, its button
        // for a step the learner marks done, and the way out, which also says Esc works
        var showStep = function () {
            var full = isFull();
            var items = Array.prototype.slice.call(lesson.querySelectorAll('[data-step]'));
            var current = lesson.querySelector('.lstep.current');
            stepLine.textContent = '';
            stepDone.hidden = true;
            if (!full || !items.length) return;
            if (!current) { stepLine.textContent = 'All ' + items.length + ' steps done'; return; }
            stepLine.textContent = 'Step ' + (items.indexOf(current) + 1) + ' of ' + items.length + ': ' + current.querySelector('.lstep-title').textContent;
            // A step the learner marks done keeps its button within reach
            var own = current.querySelector('[data-step-done]');
            if (own && !own.classList.contains('lstep-done-narrow')) {
                stepDone.textContent = own.textContent;
                stepDone.disabled = own.disabled;
                stepDone.hidden = false;
            }
        };
        if (!document.fullscreenEnabled) fullBtn.hidden = true;
        fullBtn.addEventListener('click', function () { pane.requestFullscreen().catch(function () {}); });
        pane.querySelector('[data-practice-exit]').addEventListener('click', function () {
            if (isFull()) document.exitFullscreen().catch(function () {});
        });

        stepDone.addEventListener('click', function () {
            var own = lesson.querySelector('.lstep.current [data-step-done]');
            if (own && !own.disabled) own.click();
        });
        document.addEventListener('fullscreenchange', showStep);
        lesson.addEventListener('steps-drawn', function (e) {
            // Done in full screen: come back to the lesson to see what it was for
            if (e.detail.done && isFull()) document.exitFullscreen();
            showStep();
        });
        // A gated button enables as the story map changes, so the copy in the bar follows it
        setInterval(function () { if (isFull()) showStep(); }, 1000);
        // Start again checks first, in a box on the page like the app's own, not a browser pop-up
        var restartDialog = pane.querySelector('[data-practice-restart-dialog]');
        document.querySelector('[data-practice-restart]').addEventListener('click', function () {
            restartDialog.returnValue = '';
            restartDialog.showModal();
        });
        // A click on the dimmed page around the box cancels
        restartDialog.addEventListener('click', function (e) { if (e.target === restartDialog) restartDialog.close('cancel'); });
        restartDialog.addEventListener('close', function () {
            if (restartDialog.returnValue !== 'restart') return;
            resetLesson();
            delete mine.path;
            mine.restarted = true;
            practice[lessonKey] = mine;
            savePractice();
            label();
            frame.src = mapUrl();
        });
        // The reset view shortcut works from the lesson too, by passing it on to the story map
        document.addEventListener('keydown', function (e) {
            if (!document.body.classList.contains('practicing')) return;
            var reset = (e.altKey && e.code === 'KeyR') || (e.shiftKey && e.code === 'Digit0');
            if (!reset || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
            var win = frame.contentWindow;
            if (!win || !win.document.body) return;
            e.preventDefault();
            win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: e.altKey ? 'r' : e.key, code: e.code, altKey: e.altKey, shiftKey: e.shiftKey, bubbles: true }));
        });
        // Narrowing the window past the split closes the pane
        var onWidth = function () { if (!wide.matches && document.body.classList.contains('practicing')) setOpen(false); };
        if (wide.addEventListener) wide.addEventListener('change', onWidth);
        label();
        // Open again where it was left open, or on a lesson not visited yet when the reader was
        // practising in the lesson before. Closing it on a lesson keeps it closed there.
        if (wide.matches && (mine.open || (mine.open === undefined && practice[courseOpenKey]))) setOpen(true);
    }

    // "On this page": highlight the section being read
    var toc = document.querySelectorAll('.docs-toc a');
    var headings = Array.prototype.map.call(toc, function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    if (headings.length) {
        var mark = function () {
            var line = 120;
            var current = headings[0];
            headings.forEach(function (h) { if (h.getBoundingClientRect().top < line) current = h; });
            toc.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + current.id); });
        };
        var ticking = false;
        var onScroll = function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function () { ticking = false; mark(); });
        };
        // Wide screens scroll the panel under the header, phones scroll the page
        window.addEventListener('scroll', onScroll, { passive: true });
        var panel = document.getElementById('docsScroll');
        if (panel) panel.addEventListener('scroll', onScroll, { passive: true });
        mark();
    }

    // A screenshot opens at full size when clicked, as it can be too small to read in a narrow
    // column, such as beside the practice story map. A click anywhere or Escape closes it.
    document.querySelectorAll('.shot-pic img').forEach(function (img) {
        img.addEventListener('click', function () {
            var zoom = document.createElement('div');
            zoom.className = 'shot-zoom';
            zoom.setAttribute('role', 'dialog');
            zoom.setAttribute('aria-label', img.alt || 'Screenshot');
            var big = document.createElement('img');
            big.src = img.currentSrc || img.src;
            big.alt = img.alt;
            zoom.appendChild(big);
            var close = function () {
                zoom.remove();
                document.removeEventListener('keydown', onKey);
            };
            var onKey = function (e) { if (e.key === 'Escape') close(); };
            zoom.addEventListener('click', close);
            document.addEventListener('keydown', onKey);
            document.body.appendChild(zoom);
        });
    });

    // A browser puts the page itself back where it was, but not the panel that scrolls under the
    // header on wide screens, so Back and Forward put that back here
    var scrollPanel = document.getElementById('docsScroll');
    if (scrollPanel) {
        var scrollKey = 'docsScroll:' + location.pathname;
        var navigation = performance.getEntriesByType('navigation')[0];
        if (navigation && navigation.type === 'back_forward') {
            try {
                var saved = Number(sessionStorage.getItem(scrollKey));
                if (saved) scrollPanel.scrollTop = saved;
            } catch (e) { /* storage unavailable: the page opens at the top */ }
        }
        window.addEventListener('pagehide', function () {
            try { sessionStorage.setItem(scrollKey, String(Math.round(scrollPanel.scrollTop))); } catch (e) { /* as above */ }
        });
    }
})();
