// End-to-end test in a real browser against the local harness: admin imports the class list, pastes an exam,
// publishes it; students take it (with tab switching); admin checks results; students review after closing.
const { chromium } = require('playwright');
const H = require('./harness');
const out = process.argv[2] || __dirname;
const PORT = 4300;
const base = `http://localhost:${PORT}/`;
let failures = 0;
const check = (ok, label, extra) => { console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? '  → ' + extra : '')); if (!ok) failures++; };

// ---- a fake record book like the module ones ----
const book = H.makeBook('Class Record 1st Sem');
const mmw = book.insertSheet('MMW - CEIT-03-101E');
mmw.getRange(1, 1, 3, 3).setValues([['RIZAL TECHNOLOGICAL UNIVERSITY', '', ''], ['YEAR AND SECTION:', 'CEIT-03-101E', ''], ['STUDENT NO.', 'NAME', 'PRELIM']]);
mmw.getRange(4, 1, 3, 3).setValues([['2026-100001', 'DELA CRUZ, JUAN P.', 90], ['2026-100002', 'SANTOS , MARIA L.', 88], ['2026-100003', 'REYES, JOSE', 75]]);
const cal = book.insertSheet('CAL00');
cal.getRange(1, 1, 2, 4).setValues([['YEAR AND SECTION:', '', 'CEIT-01-101A', ''], ['STUDENT NO.', 'NAME', '', '']]);
cal.getRange(3, 1, 2, 2).setValues([['2026-200001', 'GARCIA, ANA'], ['2026-100001', 'DELA CRUZ, JUAN P.']]);
book.insertSheet('Summary').getRange(1, 1).setValue('Grades summary');
H.books['BOOK1234567890123456789012'] = book;
const BOOK_URL = 'https://docs.google.com/spreadsheets/d/BOOK1234567890123456789012/edit#gid=0';

const PASTE = `MIDTERM EXAMINATION
Part I. Multiple choice
1. Which number comes next: 1, 1, 2, 3, 5, 8, ...?
A. 11
B. 12
C. 13
D. 15
2. Evaluate $\\sqrt{49}$.
A. 6   B. 7   C. 8   D. 49
3. Which is a prime number?
a) 21
*b) 23
c) 25
d) 27
4. The mean of 2, 4 and 9 is
A. 4
B. 5
C. 6
D. 15

Part II. Problem solving
1. A shirt costs ₱450 and is sold at a 20% discount. What is the sale price?
Answer: 360
Points: 5
Solution:
Step 1: discount = $0.20 \\times 450 = 90$
Step 2: sale price = 450 - 90 = 360 pesos
2. Find the probability of rolling a sum of 7 with two dice.
a) list the outcomes
b) give the probability
Answer: 1/6 | 0.1667
Tolerance: 1%
Solution:
There are 6 outcomes out of 36, so P = 6/36 = 1/6.

Answer key
1. C  2. B  4. B`;

(async () => {
  await new Promise((r) => H.server.listen(PORT, r));
  H.as(H.ADMIN, () => H.ctx.setup());
  check(!!H.ss.getSheetByName('Settings (old version)') && !!H.ss.getSheetByName('Questions (old version)') && H.ss.getSheetByName('Questions').data[0][0] === 'Exam ID',
    'setup: tabs of the first version are kept aside');
  check(!H.triggers.some((t) => t.getHandlerFunction() === 'syncResults'), 'setup: old every-minute trigger removed');
  const b = await chromium.launch();
  const ctxB = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  const open = async (email, admin) => {
    const p = await ctxB.newPage();
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(base + '?as=' + encodeURIComponent(email) + (admin ? '&page=admin' : ''));
    await p.waitForTimeout(300);
    return p;
  };

  // ---------- parser unit checks ----------
  const ad = await open(H.ADMIN, true);
  const P = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), PASTE);
  check(P.items.length === 6, 'paste: 6 questions found', P.items.length);
  check(P.items.slice(0, 4).every((q) => q.type === 'MC') && P.items.slice(4).every((q) => q.type === 'PS'), 'paste: 4 MC then 2 PS', P.items.map((q) => q.type).join(','));
  check(P.items.map((q) => q.answer).slice(0, 4).join('') === 'CBBB', 'paste: MC answers from key, star and inline', P.items.map((q) => q.answer).slice(0, 4).join(''));
  check(P.items[1].choices.length === 4 && P.items[1].choices[1] === '7', 'paste: choices on one line split', JSON.stringify(P.items[1].choices));
  check(P.items[4].solution.includes('Step 2') && P.items[4].points === 5, 'paste: PS solution and points', JSON.stringify(P.items[4].solution));
  check(P.items[5].text.includes('a) list the outcomes') && P.items[5].answer === '1/6 | 0.1667' && P.items[5].tol === 1, 'paste: PS sub-parts stay in the question', JSON.stringify(P.items[5]));
  check(P.warnings.some((w) => /Ignored/.test(w)), 'paste: heading before question 1 reported as ignored', P.warnings.join(' | '));
  const P2 = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), '1) What is 2+2?\n(a) 3\n(b) 4\nAns: b\n\n2. Velocity after 3 s from rest at 2 m/s²?\nAnswer: 6 m/s\nSolution: v = at\n1. wrong-looking step\n= 6 m/s');
  check(P2.items.length === 2 && P2.items[0].answer === 'B' && P2.items[1].solution.includes('wrong-looking'), 'paste: "1." inside a solution does not start a new question', JSON.stringify(P2.items.map((q) => q.answer)));

  // ---------- admin: import class list ----------
  await ad.click('[data-tab=roster]');
  await ad.fill('#b-url', BOOK_URL);
  await ad.click('#b-read'); await ad.waitForTimeout(400);
  const tabsText = (await ad.textContent('#b-out')).replace(/\s+/g, ' ');
  check(/MMW - CEIT-03-101E/.test(tabsText) && /CAL00/.test(tabsText) && !/Summary/.test(tabsText), 'record book: tabs with student numbers listed');
  check(await ad.inputValue('[data-subj="1"]') === 'CAL00' && await ad.inputValue('[data-sec="1"]') === 'CEIT-01-101A', 'record book: CAL00 block read from YEAR AND SECTION cell');
  check(await ad.inputValue('[data-subj="0"]') === 'MMW' && await ad.inputValue('[data-sec="0"]') === 'CEIT-03-101E', 'record book: subject and block from tab name');
  await ad.click('#b-import'); await ad.waitForTimeout(500);
  check(/Imported 5 students/.test(await ad.textContent('#b-out')), 'record book: 5 enrolments imported', await ad.textContent('#b-out'));
  const cls = H.ss.getSheetByName('Class List').data.slice(1).map((r) => r.slice(0, 5).join(' | '));
  check(cls.some((r) => r === '2026-100002 | SANTOS, MARIA L. | MMW | CEIT-03-101E | 2026-100002@rtu.edu.ph'), 'class list: name cleaned, email from student number', cls[1]);
  await ad.screenshot({ path: out + '/a-classlist.png', fullPage: true });

  // ---------- admin: create exam from paste ----------
  await ad.click('[data-tab=exams]'); await ad.click('#new');
  await ad.selectOption('#f-subject', 'MMW');
  await ad.fill('#f-title', 'Midterm Examination');
  await ad.fill('#f-limit', '45');
  await ad.fill('#paste', PASTE);
  await ad.click('#read'); await ad.waitForTimeout(200);
  check(/Found 6 questions: 4 multiple choice, 2 problem solving/.test(await ad.textContent('#parsed')), 'admin: paste preview summary');
  await ad.screenshot({ path: out + '/a-paste.png', fullPage: true });
  await ad.click('#p-add'); await ad.waitForTimeout(200);
  await ad.click('#open-now');
  await ad.selectOption('#f-status', 'Published');
  await ad.click('#save'); await ad.waitForTimeout(600);
  check(/Saved/.test(await ad.textContent('#toast')), 'admin: exam saved and published', await ad.textContent('#toast'));
  const qrows = H.ss.getSheetByName('Questions').data.slice(1).filter((r) => r[0] !== H.ctx.exams_()[0].id);
  check(qrows.length === 6 && qrows[5][6] === '1/6 | 0.1667', 'questions sheet: 6 rows, answers kept as text', qrows.length);
  await ad.screenshot({ path: out + '/a-editor.png', fullPage: true });

  // ---------- admin: subject list, block sections, reading a Word file ----------
  await ad.click('#back'); await ad.click('#new'); await ad.waitForTimeout(200);
  const subjOpts = await ad.$$eval('#f-subject option', (o) => o.map((x) => x.value));
  check(['CAL00', 'MMW'].every((x) => subjOpts.includes(x)) && subjOpts.includes('__new'), 'editor: subject dropdown lists every subject', subjOpts.join(','));
  await ad.selectOption('#f-subject', 'CAL00'); await ad.waitForTimeout(100);
  check((await ad.textContent('#f-secs')).includes('CEIT-01-101A') && !(await ad.textContent('#f-secs')).includes('CEIT-03-101E'), 'editor: block sections follow the subject');
  await ad.selectOption('#f-subject', 'MMW'); await ad.waitForTimeout(100);
  check((await ad.textContent('#f-secs')).includes('CEIT-03-101E'), 'editor: block sections change with the subject');
  await ad.setInputFiles('#file', require('path').join(__dirname, 'fixture.docx')); await ad.waitForTimeout(600);
  const docxRes = (await ad.textContent('#parsed')).replace(/\s+/g, ' ');
  check(/Found 3 questions: 2 multiple choice, 1 problem solving/.test(docxRes), 'word file: numbered questions and lettered choices read', docxRes.slice(0, 160));
  check(/picture/.test(docxRes) && /equation/.test(docxRes), 'word file: notes about pictures and equations');
  const pasteBox = await ad.inputValue('#paste');
  check(pasteBox.includes('2. Simplify $\\frac{x^{2}}{x}$.') && pasteBox.includes('B. Mercury') && pasteBox.includes('1. A car travels'), 'word file: equation converted to LaTeX, list numbers rebuilt', JSON.stringify(pasteBox.slice(0, 260)));
  await ad.screenshot({ path: out + '/a-docx.png', fullPage: true });
  await ad.click('#back'); await ad.waitForTimeout(200);

  // ---------- students ----------
  const juan = '2026-100001@rtu.edu.ph';
  const s1 = await open(juan);
  const home = (await s1.textContent('#view')).replace(/\s+/g, ' ');
  check(/Midterm Examination/.test(home) && !/Sample exam/.test(home), 'student: sees published MMW exam, not the draft sample');
  check(/MMW · CEIT-03-101E/.test(await s1.textContent('#chips')) && /CAL00 · CEIT-01-101A/.test(await s1.textContent('#chips')), 'student: both subjects shown');
  await s1.screenshot({ path: out + '/s-home.png', fullPage: true });
  await s1.click('[data-start]'); await s1.click('#ov-ok'); await s1.waitForTimeout(600);
  check(await s1.isVisible('#examtop'), 'student: exam opened with timer');
  const qs = await s1.$$eval('.q-card', (els) => els.map((e) => e.dataset.q));
  // answer: Q1 C (correct), Q2 A (wrong), Q3 B (correct), Q4 B (correct), PS1 "360 pesos" (correct with unit), PS2 "0.166" (within 1%)
  const pick = async (i, letterShown) => { await s1.click(`.q-card[data-q="${qs[i]}"] label:has-text("${letterShown}.")`); };
  await pick(0, 'C'); await pick(1, 'A'); await pick(2, 'B'); await pick(3, 'B');
  await s1.fill(`[data-final="${qs[4]}"]`, '360 pesos');
  await s1.fill(`[data-sol="${qs[4]}"]`, 'Discount $0.2 \\times 450 = 90$, so 360.');
  await s1.fill(`[data-final="${qs[5]}"]`, '0.166');
  await s1.click(`.solution-box:has([data-sol="${qs[5]}"]) .sym.tex >> nth=0`);
  check((await s1.inputValue(`[data-sol="${qs[5]}"]`)).includes('$\\frac{a}{b}$'), 'student: math toolbar inserts LaTeX');
  const hide = (p, h) => p.evaluate((x) => { Object.defineProperty(document, 'hidden', { value: x, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, h);
  await hide(s1, true); await s1.waitForTimeout(300); await hide(s1, false); await s1.waitForTimeout(500);
  check(/recorded \(1 of 3\)/.test(await s1.textContent('#ov-text')), 'student: leaving the page is detected', await s1.textContent('#ov-text'));
  await s1.screenshot({ path: out + '/s-warning.png' });
  await s1.click('#ov-ok');
  await s1.evaluate(() => document.dispatchEvent(new Event('paste', { cancelable: true })));
  await s1.waitForTimeout(200);
  await s1.screenshot({ path: out + '/s-exam.png', fullPage: true });
  await s1.click('#submit'); await s1.click('#ov-ok'); await s1.waitForTimeout(600);
  check(/Your answers were submitted/.test(await s1.textContent('#view')), 'student: submitted');

  const ana = await open('2026-200001@rtu.edu.ph');
  check(!/Midterm/.test(await ana.textContent('#view')), 'CAL00-only student does not see the MMW exam');
  const stranger = await open('2025-999999@rtu.edu.ph');
  check(/not on the class list/.test(await stranger.textContent('#view')), 'student not on the class list is refused');

  // second student starts and leaves 3 times -> auto-submit
  const maria = await open('2026-100002@rtu.edu.ph');
  await maria.click('[data-start]'); await maria.click('#ov-ok'); await maria.waitForTimeout(600);
  for (let i = 0; i < 3; i++) { await hide(maria, true); await maria.waitForTimeout(300); if (i < 2) { await hide(maria, false); await maria.waitForTimeout(400); await maria.click('#ov-ok'); } }
  await maria.waitForTimeout(300);
  check(/submitted automatically/.test(await maria.textContent('#view')), 'student: auto-submitted after leaving 3 times');

  // third student starts but never submits -> time limit expiry by the maintenance trigger
  const jose = await open('2026-100003@rtu.edu.ph');
  await jose.click('[data-start]'); await jose.click('#ov-ok'); await jose.waitForTimeout(500);
  await jose.click(`.q-card >> nth=0 >> label >> nth=2`); await jose.evaluate(() => 0);
  H.setClock(46 * 60000); H.ctx.maintenance(); H.setClock(0);

  // ---------- admin results ----------
  await ad.click('[data-tab=results]'); await ad.waitForTimeout(700);
  const rtext = (await ad.textContent('#r-body')).replace(/\s+/g, ' ');
  check(/Submitted\s*3/.test(rtext), 'results: 3 submitted', rtext.slice(0, 200));
  const juanRow = (await ad.textContent('#r-body tbody tr:has-text("DELA CRUZ")')).replace(/\s+/g, ' ');
  check(/13 \/ 14/.test(juanRow), 'results: Juan auto score 13/14 (one MC wrong)', juanRow);
  check(/Time ran out/.test(rtext), 'results: unfinished attempt submitted when time ran out');
  await ad.click('#r-body tbody tr:has-text("DELA CRUZ") [data-open]'); await ad.waitForTimeout(200);
  const det = (await ad.textContent('#r-body')).replace(/\s+/g, ' ');
  check(/left exam page/.test(det) && /tried to paste/.test(det) && /360 pesos/.test(det), 'results: answers, solution and activity log shown');
  await ad.fill('#r-body tbody tr:has-text("DELA CRUZ") input.score', '12');
  await ad.click('#r-body tbody tr:has-text("DELA CRUZ") [data-save]'); await ad.waitForTimeout(300);
  await ad.screenshot({ path: out + '/a-results.png', fullPage: true });

  // ---------- review after closing ----------
  const exam = H.ctx.exams_().find((x) => x.title === 'Midterm Examination');
  const r0 = H.as(juan, () => { try { return H.ctx.api_review(exam.id); } catch (e) { return e.message; } });
  check(/after the exam closes/.test(r0), 'review: hidden before closing', r0);
  // admin closes the exam from the editor
  await ad.click('[data-tab=exams]'); await ad.click(`[data-edit="${exam.id}"]`); await ad.waitForTimeout(400);
  check(/no closing time/.test(await ad.textContent('#view')), 'editor: warns that solutions need a closing time');
  await ad.fill('#f-opens', '2026-01-01T08:00'); // opened earlier (the test runs within one minute)
  await ad.click('#close-now'); await ad.click('#save'); await ad.waitForTimeout(500);
  check(/This exam is closed/.test(await ad.textContent('#toast')), 'editor: closed the exam with Close now', await ad.textContent('#toast'));
  H.setClock(60000);
  const s1b = await open(juan);
  await s1b.click('[data-review]'); await s1b.waitForTimeout(500);
  const rv = (await s1b.textContent('#view')).replace(/\s+/g, ' ');
  check(/Step 2: sale price/.test(rv) && /Correct answer: 1\/6 or 0.1667/.test(rv), 'review: solutions and answers shown after closing');
  check(/12 \/ 14 \(final/.test(await s1b.textContent('#lead')), 'review: final score from instructor', await s1b.textContent('#lead'));
  await s1b.screenshot({ path: out + '/s-review.png', fullPage: true });
  H.setClock(0);

  // ---------- retake ----------
  await ad.click('[data-tab=results]'); await ad.waitForTimeout(700);
  await ad.click('#r-body tbody tr:has-text("REYES") [data-retake]'); await ad.waitForTimeout(500);
  const reset = H.ss.getSheetByName('Attempts').data.some((r) => /reset-/.test(r[0]) && r[8] === 'Reset (retake allowed)');
  check(reset, 'retake: attempt marked as reset');

  // ---------- class list: remove and add ----------
  await ad.click('[data-tab=roster]'); await ad.waitForTimeout(500);
  await ad.selectOption('#ro-subj', 'CAL00'); await ad.waitForTimeout(100);
  await ad.click('#ro-rm-shown'); await ad.waitForTimeout(500);
  const left = H.ss.getSheetByName('Class List').data.slice(1).filter((r) => r[0]);
  check(left.length === 3 && left.every((r) => r[2] === 'MMW'), 'class list: removed all CAL00 students shown', left.length);
  await ad.selectOption('#ro-subj', ''); await ad.waitForTimeout(100);
  await ad.click('button[data-rm="2026-100003"]'); await ad.waitForTimeout(500);
  check(!H.ss.getSheetByName('Class List').data.some((r) => r[0] === '2026-100003'), 'class list: removed one student');
  await ad.fill('#add-no', '2026-300001'); await ad.fill('#add-name', 'LIM, CARLO'); await ad.fill('#add-subj', 'PHYMECH'); await ad.fill('#add-sec', 'CEIT-02-101B');
  await ad.click('#add-go'); await ad.waitForTimeout(500);
  const added = H.ss.getSheetByName('Class List').data.find((r) => r[0] === '2026-300001');
  check(added && added[2] === 'PHYMECH' && added[4] === '2026-300001@rtu.edu.ph', 'class list: student added by hand', JSON.stringify(added));
  await ad.screenshot({ path: out + '/a-classlist2.png', fullPage: true });
  await ad.click('[data-tab=exams]'); await ad.click('#new'); await ad.waitForTimeout(200);
  const subj2 = await ad.$$eval('#f-subject option', (o) => o.map((x) => x.value));
  check(subj2.includes('PHYMECH') && !subj2.includes('CAL00'), 'editor: subject list follows the class list', subj2.join(','));

  check(errors.length === 0, 'no page errors', errors.join(' | '));
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  await b.close(); H.server.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
