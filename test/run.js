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
  // pdf.js is loaded from a public CDN in the real site; the tests serve a local copy (npm pack pdfjs-dist@3.11.174)
  const VENDOR = require('path').join(__dirname, 'vendor');
  const havePdfJs = require('fs').existsSync(VENDOR + '/pdf.min.js');
  await ctxB.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/.*\/(pdf(\.worker)?\.min\.js)$/, (route) => {
    const f = route.request().url().split('/').pop();
    route.fulfill({ path: VENDOR + '/' + f, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  // a PDF made like a printed exam: numbered questions, choices on lines and side by side, a power, page numbers
  const pdfPage = await b.newPage();
  await pdfPage.setContent(`<div style="font:14px Arial;line-height:1.5">
    <p><b>MIDTERM EXAMINATION</b></p><p>Part I. Multiple choice</p>
    <p>1. Which planet is closest to the Sun?<br>A. Venus<br>B. Mercury<br>C. Earth<br>D. Mars</p><p>Answer: B</p>
    <p>2. What is the value of x<sup>2</sup> when x = 3?</p><p>A. 6 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; B. 9 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; C. 12 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; D. 27</p><p>Answer: B</p>
    <div style="page-break-after:always"></div>
    <p>Part II. Problem solving</p><p>1. A car travels 120 km in 2 hours. What is its average speed in km/h? Give your answer as a whole number and show your solution clearly.</p>
    <p>Answer: 60</p><p>Solution: speed = distance / time = 120 / 2 = 60 km/h</p></div>`);
  const PDF_FILE = require('path').join(__dirname, 'fixture.pdf');
  await pdfPage.pdf({ path: PDF_FILE, format: 'A4', displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:10px;width:100%;text-align:center"><span class="pageNumber"></span></div>', margin: { top: '20mm', bottom: '20mm' } });
  // two columns, a title across both, choice grids, a power, a subscript and Word's math italic letters (𝑥)
  const q2 = (n, q, a, b, c, d, ans) => `<p>${n}. ${q}</p><table style="width:100%;font:inherit"><tr><td>A. ${a}</td><td>B. ${b}</td></tr><tr><td>C. ${c}</td><td>D. ${d}</td></tr></table><p>Answer: ${ans}</p>`;
  await pdfPage.setContent(`<div style="font:13px Arial;line-height:1.45"><p style="text-align:center"><b>FINAL EXAMINATION IN GENERAL CHEMISTRY AND PHYSICS FOR ENGINEERS</b></p>
    <div style="column-count:2;column-gap:40px">
    ${q2(1, 'What is the chemical formula of water, the most common liquid on the surface of the Earth?', 'H<sub>2</sub>O', 'CO<sub>2</sub>', 'NaCl', 'O<sub>2</sub>', 'A')}
    ${q2(2, 'If 𝑥 = 4, what is the value of 𝑥<sup>2</sup> + 1 in the expression given in the problem?', '9', '16', '17', '25', 'C')}
    ${q2(3, 'Which quantity is measured in newtons, the SI unit named after the English physicist?', 'mass', 'force', 'energy', 'power', 'B')}
    ${q2(4, 'How many protons does a neutral carbon atom have in its nucleus when it is not ionized?', '4', '6', '8', '12', 'B')}
    ${q2(5, 'Which of the following is a vector quantity that has both a magnitude and a direction?', 'speed', 'time', 'velocity', 'mass', 'C')}
    ${q2(6, 'What is the acceleration due to gravity near the surface of the Earth, approximately?', '9.8 m/s<sup>2</sup>', '8.9 m/s<sup>2</sup>', '1.6 m/s<sup>2</sup>', '98 m/s<sup>2</sup>', 'A')}
    </div></div>`);
  const PDF2 = require('path').join(__dirname, 'fixture-2col.pdf');
  await pdfPage.pdf({ path: PDF2, format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
  // one column of short questions with 2 x 2 choice grids: must NOT be read as two page columns
  await pdfPage.setContent(`<div style="font:14px Arial;line-height:1.5;width:420px">${[1, 2, 3, 4].map((n) => `<p>${n}. ${n} + ${n} = ?</p><table style="font:inherit"><tr><td style="width:150px">A. ${2 * n - 1}</td><td>B. ${2 * n}</td></tr><tr><td>C. ${2 * n + 1}</td><td>D. ${2 * n + 2}</td></tr></table><p>Answer: B</p>`).join('')}</div>`);
  const PDF3 = require('path').join(__dirname, 'fixture-grid.pdf');
  await pdfPage.pdf({ path: PDF3, format: 'A4' });
  await pdfPage.close();
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
  const PT = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, id: 2, ps: 5, es: 10, tol: 1 }),
    'Part I. Multiple choice\n1. Pick B (3 points)\nA. x   C. z\nB. y   D. w\nAnswer: B\nPart II. Identification\n1. Powerhouse of the cell\nAnswer: Mitochondria | mitochondrion\n2. Year the Philippines declared independence\nAnswer: 1898\n' +
    'Part III. Essay\n1. Explain why the sky is blue. (10 pts)\nRubric: mentions scattering\n2. Describe a pattern in nature.\nPart IV. Problem solving\n1. 2 + 2?\nAnswer: 4\n\nIDENTIFICATION\n1. Capital of the Philippines\nAnswer: Manila');
  check(PT.items.map((q) => q.type).join(',') === 'MC,ID,ID,ES,ES,PS,ID', 'paste: types from headings (identification, essay, problem solving)', PT.items.map((q) => q.type).join(','));
  check(PT.items[0].choices.join('') === 'xyzw' && PT.items[0].points === 3 && PT.items[0].text === 'Pick B', 'paste: grid choices put in A-D order, "(3 points)" read', JSON.stringify(PT.items[0]));
  check(PT.items[1].answer === 'Mitochondria | mitochondrion' && PT.items[2].answer === '1898' && PT.items[1].points === 2, 'paste: identification answers (a number stays identification under its heading)');
  check(PT.items[3].solution === 'mentions scattering' && PT.items[3].points === 10 && PT.items[4].points === 10 && PT.items[4].answer === '', 'paste: essay rubric and points');
  const PU = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, id: 1, ps: 5, es: 10, tol: 1 }), '1. Who wrote Noli Me Tangere?\nAnswer: Jose Rizal\n2. Discuss the role of mathematics in art.\n3. Solve 2x = 10.\nAnswer: 5');
  check(PU.items.map((q) => q.type).join(',') === 'ID,ES,PS', 'paste: without headings, the type is guessed from the answer', PU.items.map((q) => q.type).join(','));
  // problem solving with parts
  const PP = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, id: 1, ps: 6, es: 10, tol: 1 }),
    'Part I. Problem solving\n1. A ball is thrown up at 20 m/s.\na) Find the maximum height.\nAnswer: 20.4\nb) Find the time to reach it. (2 pts)\nAnswer: 2.04 s\n' +
    '2. Two dice are rolled.\na) How many outcomes are there?\nb) What is the probability of a sum of 7?\nAnswer: a) 36  b) \\frac{1}{6}\n' +
    '3. A car moves north at 10 m/s.\n(a) What is its direction?\n(b) How far does it go in 5 s?\n(c) Its speed in km/h?\nAnswers:\n(a) north\n(b) 50 m\n(c) 36\nSolution:\nd = vt\n' +
    '4. Find the probability of rolling a 7 with two dice.\na) list the outcomes\nb) give the probability\nAnswer: 1/6');
  check(PP.items.length === 4 && PP.items.slice(0, 3).every((q) => q.type === 'PS' && q.parts && q.parts.length >= 2), 'paste: problems with parts found', JSON.stringify(PP.items.map((q) => [q.type, q.parts && q.parts.length])));
  check(PP.items[0].parts.map((x) => x.a).join('|') === '20.4|2.04 s' && PP.items[0].parts.map((x) => x.p).join(',') === '4,2' && PP.items[0].points === 6 && PP.items[0].parts[1].t === 'Find the time to reach it.',
    'paste: "Answer:" under each part, "(2 pts)" on a part, the rest of the points shared', JSON.stringify(PP.items[0]));
  check(PP.items[1].parts.map((x) => x.a).join('|') === '36|\\frac{1}{6}' && PP.items[1].text === 'Two dice are rolled.', 'paste: one answer line for all parts (with LaTeX)', JSON.stringify(PP.items[1]));
  check(PP.items[2].parts.map((x) => x.a).join('|') === 'north|50 m|36' && PP.items[2].solution === 'd = vt' && PP.items[2].parts.every((x) => x.p === 2), 'paste: "Answers:" list of part answers, points shared equally', JSON.stringify(PP.items[2]));
  check(!PP.items[3].parts && PP.items[3].answer === '1/6' && /a\) list the outcomes/.test(PP.items[3].text), 'paste: one overall answer keeps a) b) lines inside the question');
  const PK = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, id: 1, ps: 5, es: 10, tol: 1 }), '1. Pick y\nA. x\nB. y\n2. Pick x\nA. x\nB. y\nAnswers\n1. B\n2. A');
  check(PK.items.length === 2 && PK.items.map((q) => q.answer).join('') === 'BA', 'paste: an "Answers" key section after questions with choices still works', JSON.stringify(PK.items.map((q) => q.answer)));
  const P2 = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), '1) What is 2+2?\n(a) 3\n(b) 4\nAns: b\n\n2. Velocity after 3 s from rest at 2 m/s²?\nAnswer: 6 m/s\nSolution: v = at\n1. wrong-looking step\n= 6 m/s');
  const P3 = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), '1. Explain your\nsolution clearly. What is 2 + 2?\nAnswer: 4\nSolution - add them\n2. Next?\nAnswer: 1\nSol.\nobvious');
  check(P3.items.length === 2 && P3.items[0].text.includes('solution clearly') && P3.items[0].solution === 'add them' && P3.items[1].solution === 'obvious', 'paste: a sentence starting with "solution" is not a Solution label', JSON.stringify(P3.items.map((q) => [q.text, q.solution])));
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
  check(/\[picture P\d+\]/.test(pasteBox) && await ad.$('[data-pcard="1"] .rendered img.qimg') !== null, 'word file: picture placed in its question and shown in the preview');
  check(/1 picture\(s\) from the file were placed/.test(await ad.textContent('#parsed')) && /could not be imported/.test(await ad.textContent('#parsed')), 'word file: notes say which pictures were imported or not');
  await ad.screenshot({ path: out + '/a-docx.png', fullPage: true });
  // change types in the preview
  await ad.selectOption('[data-ptype="0"]', 'ID'); await ad.waitForTimeout(150);
  const asId = await ad.textContent('[data-pcard="0"] .rendered');
  check(/A\. Venus/.test(asId) && /D\. Mars/.test(asId) && /1 identification/.test(await ad.textContent('#parsed')), 'preview: type changed; choices kept as lines of the question', asId.replace(/\s+/g, ' '));
  await ad.selectOption('[data-ptype="0"]', 'MC'); await ad.waitForTimeout(150);
  check((await ad.$$eval('[data-pcard="0"] .rendered li', (l) => l.map((x) => x.textContent))).join(',') === 'Venus,Mercury,Earth,Mars', 'preview: back to multiple choice, lines become choices again');
  check(await ad.$eval('[data-pcard="0"] .rendered li.key', (l) => l.textContent) === 'Mercury', 'preview: the correct choice is remembered when switching back');
  await ad.selectOption('[data-ptype="2"]', 'ES'); await ad.waitForTimeout(150);
  check(await ad.inputValue('[data-ppts="2"]') === '10', 'preview: points follow the new type when the file did not set them', await ad.inputValue('[data-ppts="2"]'));
  await ad.fill('[data-ppts="1"]', '4');
  // answers in the preview
  await ad.selectOption('[data-ptype="0"]', 'ID'); await ad.waitForTimeout(100);
  check(/No answer/.test(await ad.textContent('[data-pcard="0"]')), 'preview: identification without an answer is flagged');
  await ad.fill('[data-pans="0"]', 'Mercury | planet Mercury');
  check(!(await ad.isVisible('[data-pcard="0"] .warnline')), 'preview: typing the answer clears the warning');
  await ad.selectOption('#p-all', 'ID'); await ad.waitForTimeout(150);
  check(/Found 3 questions: 3 identification/.test(await ad.textContent('#parsed')), 'preview: "Set all to" changes every question');
  await ad.selectOption('[data-ptype="1"]', 'MC'); await ad.selectOption('[data-ptype="2"]', 'PS'); await ad.waitForTimeout(150);
  await ad.click('#p-add'); await ad.waitForTimeout(200);
  const types = await ad.$$eval('#qlist select[data-f="type"]', (s) => s.map((x) => x.value));
  check(types.join(',') === 'ID,MC,PS' && await ad.inputValue('#qlist [data-card="1"] input[data-f="points"]') === '4', 'preview: chosen types and points are added to the exam', types.join(','));
  check(await ad.inputValue('#qlist [data-card="0"] input[data-f="answer"]') === 'Mercury | planet Mercury', 'preview: answer typed in the preview is added');
  const q2text = await ad.inputValue('#qlist [data-card="1"] textarea[data-f="text"]');
  check(/\[image:IMG\w+\]/.test(q2text) && H.ss.getSheetByName('Images').data.length === 2 && await ad.$('#qlist [data-card="1"] .thumbs img') !== null,
    'word file: picture saved to the Images tab when the questions were added', q2text);
  await ad.setInputFiles('#qlist [data-pic="2"]', require('path').join(__dirname, 'fixture.png')); await ad.waitForTimeout(600);
  check(/\[image:IMG\w+\]/.test(await ad.inputValue('#qlist [data-card="2"] textarea[data-f="text"]')) && await ad.$('#qlist [data-card="2"] .thumbs img') !== null, 'editor: "Add picture" adds a picture to a question');
  await ad.selectOption('#qlist [data-card="0"] select[data-f="type"]', 'MC'); await ad.waitForTimeout(150);
  check(await ad.inputValue('#qlist [data-card="0"] textarea[data-f="choices"]') === 'Venus\nMercury\nEarth\nMars', 'editor: changing to multiple choice turns lettered lines into choices');
  if (havePdfJs) {
    await ad.setInputFiles('#file', PDF_FILE); await ad.waitForTimeout(2500);
    const pdfRes = (await ad.textContent('#parsed')).replace(/\s+/g, ' ');
    check(/Found 3 questions: 2 multiple choice, 1 problem solving/.test(pdfRes) && /Read from a PDF/.test(pdfRes), 'pdf file: questions, choices and answers read', pdfRes.slice(0, 200));
    const pdfText = await ad.inputValue('#paste');
    check(/x² when x = 3/.test(pdfText) && /B\. 9/.test(pdfText) && !/^\s*[12]\s*$/m.test(pdfText), 'pdf file: power kept on its line, side-by-side choices, page numbers dropped', JSON.stringify(pdfText.slice(0, 400)));
    const pp = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), pdfText);
    check(pp.items[1].choices.join('|') === '6|9|12|27' && pp.items[2].text.includes('show your solution clearly') && pp.items[2].answer === '60', 'pdf file: wrapped question text joined, answers right', JSON.stringify(pp.items.map((q) => [q.type, q.answer, q.choices.join('|'), q.text])));
    await ad.screenshot({ path: out + '/a-pdf.png', fullPage: true });
    // two-column PDF
    await ad.setInputFiles('#file', PDF2); await ad.waitForTimeout(2500);
    const t2 = await ad.inputValue('#paste');
    const p2 = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), t2);
    check(p2.items.length === 6 && ['chemical formula', 'If x = 4', 'newtons', 'protons', 'vector', 'gravity'].every((w, i) => p2.items[i].text.includes(w)), 'pdf 2 columns: 6 questions in order', JSON.stringify(t2.slice(0, 700)));
    check(p2.items[1].text === 'If x = 4, what is the value of x² + 1 in the expression given in the problem?', 'pdf: a line wrapped by the column width is joined', JSON.stringify(p2.items[1].text));
    check(p2.items.map((q) => q.answer).join('') === 'ACBBCA' && p2.items.every((q) => q.choices.length === 4), 'pdf 2 columns: answers and 4 choices each', JSON.stringify(p2.items.map((q) => [q.answer, q.choices])));
    check(p2.items[0].choices[0] === 'H₂O' && /x² \+ 1/.test(p2.items[1].text) && /If x = 4/.test(p2.items[1].text) && p2.items[5].choices[0] === '9.8 m/s²', 'pdf: subscripts, powers and math letters', JSON.stringify([p2.items[0].choices, p2.items[1].text, p2.items[5].choices[0]]));
    check(/2 columns/.test(await ad.textContent('#parsed')), 'pdf: says it read 2 columns');
    // one column with choice grids
    await ad.setInputFiles('#file', PDF3); await ad.waitForTimeout(2500);
    const t3 = await ad.inputValue('#paste');
    const p3 = await ad.evaluate((t) => window.__parsePaste(t, { mc: 1, ps: 5, tol: 1 }), t3);
    check(p3.items.length === 4 && p3.items.every((q, i) => q.choices.join(',') === [2 * i + 1, 2 * i + 2, 2 * i + 3, 2 * i + 4].join(',') && q.answer === 'B') && !/columns/.test(await ad.textContent('#parsed')),
      'pdf: choice grids in one column are not read as page columns', JSON.stringify(t3.slice(0, 300)));
  } else console.log('SKIP pdf file test (put pdf.min.js and pdf.worker.min.js from pdfjs-dist@3.11.174 in test/vendor)');
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

  // ---------- identification and essay: take, check, score ----------
  const png = 'data:image/png;base64,' + require('fs').readFileSync(require('path').join(__dirname, 'fixture.png')).toString('base64');
  const picId = H.as(H.ADMIN, () => H.ctx.admin_saveImage(png)).id;
  const quiz = H.as(H.ADMIN, () => H.ctx.admin_saveExam({ subject: 'MMW', title: 'Quiz 2', status: 'Published', limit: 20, maxLeave: 0, showScore: true,
    showSolutions: 'After submitting', questions: [
      { type: 'ID', text: 'Powerhouse of the cell\n[image:' + picId + ']', answer: 'Mitochondria | mitochondrion', points: 2 },
      { type: 'ID', text: 'Pythagorean ___', answer: 'theorem', points: 1 },
      { type: 'ES', text: 'Explain why the sky is blue.', points: 10, solution: 'Rayleigh scattering of shorter wavelengths.' }] }));
  const s5 = await open(juan);
  await s5.click(`[data-start="${quiz.id}"]`); await s5.click('#ov-ok'); await s5.waitForTimeout(500);
  const qq = await s5.$$eval('.q-card', (els) => els.map((e) => e.dataset.q));
  check(await s5.$eval('.q-card img.qimg', (i) => i.src.startsWith('data:image/png') && i.naturalWidth === 60), 'student: picture shown in the question');
  await s5.fill(`[data-idans="${qq[0]}"]`, '  MITOCHONDRIA. ');
  await s5.fill(`[data-idans="${qq[1]}"]`, 'theory');
  await s5.fill(`[data-essay="${qq[2]}"]`, 'Air molecules scatter blue light more than red light, so we see blue from every direction.');
  check(/\(16 words\)/.test(await s5.textContent(`.q-card[data-q="${qq[2]}"]`)), 'essay: word count shown');
  await s5.screenshot({ path: out + '/s-essay.png', fullPage: true });
  await s5.click('#submit'); await s5.click('#ov-ok'); await s5.waitForTimeout(600);
  const done5 = (await s5.textContent('#view')).replace(/\s+/g, ' ');
  check(/Score: 2 \/ 13/.test(done5) && /essay answers will be checked/.test(done5), 'identification auto-checked (case and dot ignored), essay waits for the instructor', done5);
  await ad.reload(); await ad.waitForTimeout(400);   // the quiz was created outside the admin page
  await ad.click('[data-tab=results]'); await ad.waitForTimeout(400);
  await ad.selectOption('#r-exam', quiz.id); await ad.waitForTimeout(700);
  check(/1 essay to check/.test(await ad.textContent('#r-body')), 'results: essay to check is flagged');
  await ad.click('#r-body tbody tr:has-text("DELA CRUZ") [data-open]'); await ad.waitForTimeout(300);
  await ad.fill(`[data-item="${quiz.questions[2].id}"]`, '8');
  await ad.fill(`[data-item="${quiz.questions[1].id}"]`, '1');   // accept "theory" by hand
  await ad.click('[data-items]'); await ad.waitForTimeout(600);
  check(/Score: 11 \/ 13/.test(await ad.textContent('#toast')), 'results: essay points and an override saved', await ad.textContent('#toast'));
  const row5 = (await ad.textContent('#r-body tbody tr:has-text("DELA CRUZ")')).replace(/\s+/g, ' ');
  check(/11 \/ 13/.test(row5) && !/to check/.test(row5), 'results: score updated, nothing left to check', row5);
  await ad.screenshot({ path: out + '/a-essay.png', fullPage: true });
  const att5 = H.ss.getSheetByName('Attempts').data.find((r) => r[1] === quiz.id);
  check(att5[13] === 11 && JSON.parse(att5[22])[quiz.questions[2].id] === 8, 'attempts sheet: score and points given saved', JSON.stringify([att5[13], att5[22]]));
  const s6 = await open(juan);
  await s6.click(`[data-review="${quiz.id}"]`); await s6.waitForTimeout(500);
  const rv5 = (await s6.textContent('#view')).replace(/\s+/g, ' ');
  check(await s6.$('.q-card img.qimg') !== null, 'review: picture shown');
  check(/Rayleigh scattering/.test(rv5) && /Accepted answers: Mitochondria, mitochondrion/.test(rv5) && /8 \/ 10/.test(rv5), 'review: identification, essay points and guide shown', rv5.slice(0, 300));
  await s6.screenshot({ path: out + '/s-review2.png', fullPage: true });

  // ---------- problem solving with parts: edit, take, check ----------
  await ad.click('[data-tab=exams]'); await ad.click('#new'); await ad.waitForTimeout(200);
  await ad.selectOption('#f-subject', 'MMW'); await ad.fill('#f-title', 'Quiz 3'); await ad.selectOption('#f-status', 'Published');
  await ad.fill('#paste', '1. A ball is thrown straight up at 20 m/s.\na) Find the maximum height in m.\nb) Find the time to reach it, in s.\nAnswer: 20.4\nSolution: v² = v0² − 2gh');
  await ad.click('#read'); await ad.waitForTimeout(150); await ad.click('#p-add'); await ad.waitForTimeout(300);
  await ad.click('#qlist [data-split="0"]'); await ad.waitForTimeout(200);
  check(await ad.inputValue('#qlist textarea[data-f="ptext"][data-j="1"]') === 'Find the time to reach it, in s.' && await ad.inputValue('#qlist input[data-f="pans"][data-j="0"]') === '20.4',
    'editor: "Split into parts" makes parts from a) b) lines and keeps the answer');
  await ad.fill('#qlist input[data-f="pans"][data-j="1"]', '2.04');
  await ad.fill('#qlist input[data-f="ppts"][data-j="0"]', '3'); await ad.fill('#qlist input[data-f="ppts"][data-j="1"]', '2');
  check(await ad.inputValue('#qlist input[data-f="points"]') === '5', 'editor: question points are the sum of the parts');
  await ad.click('#qlist [data-addpart="0"]'); await ad.waitForTimeout(150);
  await ad.fill('#qlist textarea[data-f="ptext"][data-j="2"]', 'Which direction is the ball moving at the top? (word)');
  await ad.fill('#qlist input[data-f="pans"][data-j="2"]', 'none | at rest | stationary');
  await ad.fill('#qlist input[data-f="ppts"][data-j="2"]', '1');
  await ad.click('#add-ps'); await ad.waitForTimeout(150);
  await ad.fill('#qlist [data-card="1"] textarea[data-f="text"]', 'Evaluate.\na) 3/8 as a decimal\nb) 2√3 squared');
  await ad.click('#qlist [data-split="1"]'); await ad.waitForTimeout(150);
  await ad.fill('#qlist [data-card="1"] input[data-f="pans"][data-j="0"]', '0.375'); await ad.fill('#qlist [data-card="1"] input[data-f="pans"][data-j="1"]', '12');
  await ad.click('#save'); await ad.waitForTimeout(600);
  const q3 = H.ctx.exams_().find((x) => x.title === 'Quiz 3');
  const q3q = H.ctx.questions_(q3.id);
  check(q3q[0].parts.length === 3 && q3q[0].points === 6 && q3q[0].parts[2].a === 'none | at rest | stationary' && q3q[1].parts.length === 2, 'saved: parts with their answers and points', JSON.stringify(q3q.map((q) => [q.points, q.parts])));
  await ad.screenshot({ path: out + '/a-parts.png', fullPage: true });
  const s7 = await open(juan);
  await s7.click(`[data-start="${q3.id}"]`); await s7.click('#ov-ok'); await s7.waitForTimeout(500);
  const pid = await s7.$$eval('.q-card', (els) => els.map((e) => e.dataset.q));
  await s7.fill(`[data-part="${pid[0]}"][data-l="a"]`, '20.4 m');
  await s7.fill(`[data-part="${pid[0]}"][data-l="b"]`, '\\frac{51}{25}');      // 2.04 typed as LaTeX
  await s7.fill(`[data-part="${pid[0]}"][data-l="c"]`, 'At rest.');
  await s7.fill(`[data-part="${pid[1]}"][data-l="a"]`, '\\frac{3}{8}');
  await s7.fill(`[data-part="${pid[1]}"][data-l="b"]`, '13');                    // wrong
  await s7.waitForTimeout(500);
  check(/Reads as/.test(await s7.textContent(`.q-card[data-q="${pid[0]}"] .part >> nth=1`)) && !(await s7.isVisible(`.q-card[data-q="${pid[0]}"] .part >> nth=2 >> .ans-pv`)), 'student: "Reads as" preview for LaTeX answers only');
  await s7.screenshot({ path: out + '/s-parts.png', fullPage: true });
  await s7.click('#submit'); await s7.click('#ov-ok'); await s7.waitForTimeout(600);
  await ad.reload(); await ad.waitForTimeout(400);
  await ad.click('[data-tab=results]'); await ad.waitForTimeout(400);
  await ad.selectOption('#r-exam', q3.id); await ad.waitForTimeout(700);
  const r7 = (await ad.textContent('#r-body tbody tr:has-text("DELA CRUZ")')).replace(/\s+/g, ' ');
  check(/8\.5 \/ 11/.test(r7), 'parts checked one by one: LaTeX, units and words accepted; one wrong part loses only its points', r7);
  await ad.click('#r-body tbody tr:has-text("DELA CRUZ") [data-open]'); await ad.waitForTimeout(300);
  const d7 = (await ad.textContent('#r-body .detail')).replace(/\s+/g, ' ');
  check(/❌ b\) .*answer: 13 · key: 12 · 0 \/ 2\.5/.test(d7) && /✅ c\)/.test(d7), 'results: each part with its answer, key and points', d7.slice(0, 400));
  await ad.screenshot({ path: out + '/a-parts-results.png', fullPage: true });
  H.as(H.ADMIN, () => { const x = H.ctx.admin_getExam(q3.id); x.showSolutions = 'After submitting'; H.ctx.admin_saveExam(x); });
  const s8 = await open(juan);
  await s8.click(`[data-review="${q3.id}"]`); await s8.waitForTimeout(500);
  const rv8 = (await s8.textContent('#view')).replace(/\s+/g, ' ');
  check(/✅ Your answer: \\frac\{51\}\{25\}/.test(rv8) && /❌ Your answer: 13 · 0 \/ 2\.5/.test(rv8) && /Correct answer: none or at rest or stationary/.test(rv8), 'review: each part with the student\'s answer and the correct one', rv8.slice(0, 500));

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
