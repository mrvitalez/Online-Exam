/**
 * RTU Online Exams: student exam site with tab-switch detection, and an instructor admin site.
 *
 * One Apps Script project, bound to a Google Sheet, serves every subject (PHYMECH, CAL00, CAL01, CAL02, MMW, ...):
 *   <web app URL>              student site: exams for the subjects and block sections the student is enrolled in
 *   <web app URL>?page=admin   admin site: exams, pasted questions, results, class list (instructor only)
 *
 * Deploy as a web app with "Execute as: Me" and "Who has access: Anyone within Rizal Technological University".
 * Google then tells this script who the visitor is, so students never type their email.
 * Setup steps: README.md in the GitHub repository.
 */

var CONFIG = {
  // Who may open the admin site and preview exams. Add co-teachers here if needed.
  ADMIN_EMAILS: ['rmvitalez@rtu.edu.ph'],
  DOMAIN: 'rtu.edu.ph',
  TZ: 'Asia/Manila',
  PAGES_URL: 'https://mrvitalez.github.io/Online-Exam/',
  ICON_STUDENT: 'https://raw.githubusercontent.com/mrvitalez/Online-Exam/main/img/icon-student.png',
  ICON_ADMIN: 'https://raw.githubusercontent.com/mrvitalez/Online-Exam/main/img/icon-admin.png',
  LOGO: 'https://raw.githubusercontent.com/mrvitalez/Online-Exam/main/img/rtu-logo.jpg'
};

var TABS = { SETTINGS: 'Settings', EXAMS: 'Exams', QUESTIONS: 'Questions', CLASS: 'Class List', ATTEMPTS: 'Attempts' };
var EXAM_HEAD = ['Exam ID', 'Subject', 'Title', 'Status', 'Opens', 'Closes', 'Time Limit (min)', 'Block Sections',
                 'Auto-submit After Leaving', 'Shuffle Questions', 'Shuffle Choices', 'Block Copy/Paste',
                 'Show Score After Submitting', 'Show Solutions', 'Instructions', 'Updated'];
var Q_HEAD = ['Exam ID', 'Question ID', 'No.', 'Type', 'Question', 'Choices', 'Answer', 'Tolerance %', 'Points', 'Solution'];
var CLASS_HEAD = ['Student No.', 'Name', 'Subject', 'Block and Section', 'Email', 'Blocked'];
var ATT_HEAD = ['Attempt ID', 'Exam ID', 'Subject', 'Exam', 'Email', 'Student No.', 'Name', 'Block and Section', 'Status',
                'Started', 'Deadline', 'Submitted', 'How Submitted', 'Score', 'Total', 'Final Score', 'Remarks',
                'Times Left Page', 'Seconds Away', 'Answers (JSON)', 'Item Results (JSON)', 'Events (JSON)'];
var AC = { ID: 1, EXAM: 2, SUBJECT: 3, TITLE: 4, EMAIL: 5, NO: 6, NAME: 7, SECTION: 8, STATUS: 9, STARTED: 10,
           DEADLINE: 11, SUBMITTED: 12, HOW: 13, SCORE: 14, TOTAL: 15, FINAL: 16, REMARKS: 17, LEFT: 18, AWAY: 19,
           ANSWERS: 20, ITEMS: 21, EVENTS: 22 };
var DEFAULT_SETTINGS = [
  ['studentUrl', '', 'Web app address ending in /exec (Deploy > Manage deployments). Used for all links.'],
  ['siteTitle', 'RTU Online Exams', 'Shown at the top of the student site'],
  ['instructor', 'Instr. Ryan M. Vitalez, LPT', 'Shown to students who are not on the class list'],
  ['recordBooks', '', 'Record books imported into the Class List (set automatically)']
];
var SHOW_SOLUTIONS = ['After closing', 'After submitting', 'Never'];
var STATUS_LIVE = 'In progress', STATUS_DONE = 'Submitted', STATUS_RESET = 'Reset (retake allowed)';
var GRACE_MS = 30 * 1000;     // submissions accepted this long after the timer ends
var MAX_EVENTS = 60;          // per attempt
var MAX_FINAL = 200;          // characters in a final answer
var MAX_SOLUTION = 6000;      // characters in a written solution
var CACHE_SECONDS = 600;

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet(e) {
  var p = (e && e.parameter) || {};
  var email = currentEmail_();
  if (!isRtu_(email)) {
    return message_('RTU account required',
      'This exam site is for Rizal Technological University students. Sign in to Google with your ' +
      '<b>@' + CONFIG.DOMAIN + '</b> account (your student number @' + CONFIG.DOMAIN + '), then open the link again.' +
      (email ? '<br><br>You are signed in as <b>' + esc_(email) + '</b>.' : '') +
      '<br><br>Tip: open the link in a private/incognito window and sign in with only your RTU account.');
  }
  if (p.page === 'admin') {
    if (!isAdmin_(email)) return message_('Instructors only', 'This page is only for the instructor.');
    return app_('Admin', 'Exam Admin', { email: email, url: appUrl_(), sheetUrl: ss_().getUrl(), pagesUrl: CONFIG.PAGES_URL });
  }
  var boot = { email: email, url: appUrl_(), admin: isAdmin_(email), logo: CONFIG.LOGO };
  try { boot.home = api_home(); } catch (err) { boot.error = err.message; }
  return app_('Student', settings_().siteTitle || 'Online Exams', boot);
}

function app_(file, title, boot) {
  var json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  var page = HtmlService.createTemplateFromFile(file);
  page.boot = json;
  var html = HtmlService.createHtmlOutputFromFile('Styles').getContent() + page.evaluate().getContent();
  return HtmlService.createHtmlOutput(html).setTitle(title)
    .setFaviconUrl(file === 'Admin' ? CONFIG.ICON_ADMIN : CONFIG.ICON_STUDENT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function message_(title, body) {
  var html = HtmlService.createHtmlOutputFromFile('Styles').getContent() +
    '<body class="landing"><header class="hero"><div class="inner"><img class="logo" src="' + CONFIG.LOGO + '" alt="">' +
    '<div class="txt"><span class="eyebrow">Online Exams · Rizal Technological University</span><h1>' + esc_(title) + '</h1>' +
    '<p>' + body + '</p></div></div></header></body>';
  return HtmlService.createHtmlOutput(html).setTitle(title).setFaviconUrl(CONFIG.ICON_STUDENT)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Student API (google.script.run). The email always comes from Google, never from the page.
// ---------------------------------------------------------------------------

/** The student's home: who they are and which exams they can see. */
function api_home() {
  var email = requireRtu_();
  var admin = isAdmin_(email);
  var enr = roster_()[email] || [];
  var active = enr.filter(function (x) { return !x.blocked; });
  if (!admin && !enr.length) {
    throw new Error('Your account (' + email + ') is not on the class list of any subject. If you are enrolled, ' +
      'make sure you are signed in with your student-number account, or contact ' + (settings_().instructor || 'your instructor') + '.');
  }
  if (!admin && !active.length) throw new Error('Your access to the exams has been turned off. Please contact your instructor.');
  var now = Date.now();
  var mine = attemptsOf_(email);
  var list = [];
  exams_().forEach(function (x) {
    var who = admin ? null : enrollmentFor_(email, x);
    if (!admin && (x.status !== 'Published' || !who)) return;
    var att = mine[x.id] || null;
    var st = examState_(x, now);
    var item = {
      id: x.id, subject: x.subject, title: x.title, state: st, opens: x.opens, closes: x.closes, limit: x.limit,
      count: questions_(x.id).length, preview: admin && x.status !== 'Published', maxLeave: x.maxLeave,
      attempt: att ? { status: att.status, submitted: att.submitted } : null
    };
    if (att && att.status === STATUS_DONE) {
      item.canReview = canReview_(x, now);
      if (x.showScore || item.canReview) { item.score = att.score; item.total = att.total; item.final = att.final; }
    }
    item.canStart = (!att || att.status === STATUS_LIVE) && (st === 'open' || admin);
    list.push(item);
  });
  list.sort(function (a, b) { return cmp_(a.subject, b.subject) || (a.opens || 0) - (b.opens || 0) || cmp_(a.title, b.title); });
  return {
    email: email, admin: admin, now: now,
    name: active.length ? active[0].name : (admin ? 'Instructor' : ''),
    studentNo: active.length ? active[0].no : '',
    enrollments: active.map(function (x) { return { subject: x.subject, section: x.section }; }),
    exams: list
  };
}

/** Start or resume an exam. The timer starts on the first call. */
function api_start(examId) {
  var email = requireRtu_();
  var admin = isAdmin_(email);
  var exam = examFull_(examId);
  if (!exam) throw new Error('This exam no longer exists.');
  var who = admin ? null : enrollmentFor_(email, exam);
  if (!admin) {
    if (exam.status !== 'Published' || !who) throw new Error('This exam is not available to you.');
    if (who.blocked) throw new Error('Your access to this exam has been turned off. Please contact your instructor.');
  }
  if (!who) who = { no: 'PREVIEW', name: 'Instructor preview', section: '—' };
  var id = attemptId_(examId, email);
  var live = getLive_(id);
  var now = Date.now();
  if (live && expireIfLate_(live, exam)) live = null;
  var answers = {};
  if (live) {
    closeAway_(live);
    event_(live, 'opened the exam again');
    answers = readAnswers_(live);
  } else {
    var row = findAttemptRow_(id);
    if (row) {
      var status = sheet_(TABS.ATTEMPTS).getRange(row, AC.STATUS).getValue();
      if (status === STATUS_DONE) return { done: true, message: 'You have already submitted this exam.' };
    }
    var st = examState_(exam, now);
    if (!admin && st !== 'open') {
      throw new Error(st === 'upcoming' ? 'This exam opens on ' + niceTime_(exam.opens) + '.' : 'This exam is closed.');
    }
    if (!exam.questions.length) throw new Error('This exam has no questions yet.');
    var deadline = now + exam.limit * 60000;
    if (exam.closes && !admin) deadline = Math.min(deadline, exam.closes);
    var order = exam.questions.map(function (q) { return q.id; });
    if (exam.shuffleQ) shuffle_(order);
    var corder = {};
    exam.questions.forEach(function (q) {
      if (q.type !== 'MC') return;
      var letters = q.choices.map(function (c, i) { return letter_(i); });
      if (exam.shuffleC) shuffle_(letters);
      corder[q.id] = letters.join('');
    });
    live = { id: id, examId: examId, email: email, started: now, deadline: deadline, departures: 0, awayMs: 0,
             awaySince: 0, events: [], order: order, corder: corder, row: 0 };
    event_(live, 'started');
    if (!row) {
      var rec = [];
      rec[AC.ID - 1] = id; rec[AC.EXAM - 1] = examId; rec[AC.SUBJECT - 1] = exam.subject; rec[AC.TITLE - 1] = exam.title;
      rec[AC.EMAIL - 1] = email; rec[AC.NO - 1] = who.no; rec[AC.NAME - 1] = who.name; rec[AC.SECTION - 1] = who.section;
      rec[AC.STATUS - 1] = STATUS_LIVE; rec[AC.STARTED - 1] = new Date(now); rec[AC.DEADLINE - 1] = new Date(deadline);
      for (var c = AC.SUBMITTED; c <= AC.EVENTS; c++) rec[c - 1] = '';
      rec[AC.LEFT - 1] = 0; rec[AC.AWAY - 1] = 0; rec[AC.ANSWERS - 1] = '{}';
      sheet_(TABS.ATTEMPTS).appendRow(rec);  // appendRow is atomic, so many students can start at once
      row = findAttemptRow_(id);
    } else {
      sheet_(TABS.ATTEMPTS).getRange(row, AC.STATUS, 1, 3).setValues([[STATUS_LIVE, new Date(now), new Date(deadline)]]);
    }
    live.row = row;
  }
  saveLive_(live);
  writeProgress_(live);
  return {
    exam: publicExam_(exam, live),
    state: { deadline: live.deadline, serverNow: Date.now(), answers: answers, departures: live.departures },
    student: { name: who.name, no: who.no, section: who.section }
  };
}

function api_save(examId, answers) {
  return withLive_(examId, function (live, exam) {
    writeAnswers_(live, cleanAnswers_(answers, exam));
    return { ok: true };
  });
}

var LOGGABLE = { 'fullscreen-exit': 'left fullscreen', copy: 'tried to copy', cut: 'tried to cut', paste: 'tried to paste',
                 'right-click': 'tried to right-click', shortcut: 'blocked shortcut' };

function api_event(examId, type, detail, answers) {
  return withLive_(examId, function (live, exam) {
    if (answers) writeAnswers_(live, cleanAnswers_(answers, exam));
    if (type === 'left') {
      if (!live.awaySince) { live.departures++; live.awaySince = Date.now(); event_(live, 'left exam page', detail); }
      if (exam.maxLeave > 0 && live.departures >= exam.maxLeave) {
        var a = answers ? cleanAnswers_(answers, exam) : readAnswers_(live);
        finalize_(live, exam, a, 'Auto-submitted after leaving the page ' + live.departures + ' times');
        return { departures: live.departures, max: exam.maxLeave, submitted: true };
      }
    } else if (type === 'returned') {
      var since = live.awaySince;
      closeAway_(live);
      event_(live, 'came back', since ? 'away ' + Math.round((Date.now() - since) / 1000) + 's' : '');
    } else if (LOGGABLE[type]) {
      event_(live, LOGGABLE[type], detail);
    }
    saveLive_(live);
    writeProgress_(live);
    return { departures: live.departures, max: exam.maxLeave, submitted: false };
  });
}

function api_submit(examId, answers, reason) {
  return withLive_(examId, function (live, exam) {
    var g = finalize_(live, exam, cleanAnswers_(answers, exam), reason === 'time' ? 'Time ran out' : 'Submitted by student');
    var out = { submitted: true, canReview: canReview_(exam, Date.now()) };
    if (exam.showScore) { out.score = g.score; out.total = g.total; }
    return out;
  });
}

/** After the exam (when allowed): the student's answers, the correct answers and the instructor's solutions. */
function api_review(examId) {
  var email = requireRtu_();
  var exam = examFull_(examId);
  if (!exam) throw new Error('This exam no longer exists.');
  var row = findAttemptRow_(attemptId_(examId, email));
  if (!row) throw new Error('You have not taken this exam.');
  var r = sheet_(TABS.ATTEMPTS).getRange(row, 1, 1, ATT_HEAD.length).getValues()[0];
  if (r[AC.STATUS - 1] !== STATUS_DONE) throw new Error('This exam has not been submitted yet.');
  if (!canReview_(exam, Date.now()) && !isAdmin_(email)) {
    throw new Error(exam.showSolutions === 'Never' ? 'Solutions for this exam are not shown.' :
      'Solutions are shown after the exam closes' + (exam.closes ? ' on ' + niceTime_(exam.closes) : '') + '.');
  }
  var answers = parseJson_(r[AC.ANSWERS - 1], {});
  var g = grade_(exam, answers);
  return {
    title: exam.title, subject: exam.subject, score: g.score, total: g.total,
    final: r[AC.FINAL - 1] === '' ? '' : r[AC.FINAL - 1], remarks: r[AC.REMARKS - 1],
    questions: exam.questions.map(function (q, i) {
      return { n: i + 1, type: q.type, text: q.text, points: q.points, choices: q.choices, answer: q.answer,
               solution: q.solution, mine: answers[q.id] === undefined ? null : answers[q.id], ok: g.items[i].ok, got: g.items[i].got };
    })
  };
}

// ---------------------------------------------------------------------------
// Attempts: live state in Script Properties (small, fast), record in the Attempts sheet
// ---------------------------------------------------------------------------

function attemptId_(examId, email) { return examId + '|' + email; }
function props_() { return PropertiesService.getScriptProperties(); }
function getLive_(id) { var v = props_().getProperty('L|' + id); return v ? JSON.parse(v) : null; }
function saveLive_(live) { props_().setProperty('L|' + live.id, JSON.stringify(live)); }
function dropLive_(id) { props_().deleteProperty('L|' + id); }

function withLive_(examId, fn) {
  var email = requireRtu_();
  var exam = examFull_(examId);
  if (!exam) throw new Error('This exam no longer exists.');
  var live = getLive_(attemptId_(examId, email));
  if (!live) {
    var row = findAttemptRow_(attemptId_(examId, email));
    var done = row && sheet_(TABS.ATTEMPTS).getRange(row, AC.STATUS).getValue() === STATUS_DONE;
    if (done) return { submitted: true };
    throw new Error('Your exam session was not found. Reload the page.');
  }
  if (expireIfLate_(live, exam)) return { submitted: true, reason: 'time' };
  return fn(live, exam);
}

function event_(live, type, detail) {
  if (live.events.length < MAX_EVENTS) live.events.push([Date.now(), type, detail ? String(detail).slice(0, 60) : '']);
}

function closeAway_(live) {
  if (live.awaySince) { live.awayMs += Date.now() - live.awaySince; live.awaySince = 0; }
}

function expireIfLate_(live, exam) {
  if (Date.now() <= live.deadline + GRACE_MS) return false;
  finalize_(live, exam, readAnswers_(live), 'Time ran out');
  return true;
}

function liveRow_(live) {
  var row = findAttemptRow_(live.id, live.row);
  if (!row) throw new Error('Your exam record was not found. Please contact your instructor.');
  live.row = row;
  return row;
}

function writeProgress_(live) {
  var sh = sheet_(TABS.ATTEMPTS), row = liveRow_(live);
  sh.getRange(row, AC.LEFT, 1, 2).setValues([[live.departures, Math.round(live.awayMs / 1000)]]);
  sh.getRange(row, AC.EVENTS).setValue(JSON.stringify(live.events));
}

function writeAnswers_(live, answers) {
  sheet_(TABS.ATTEMPTS).getRange(liveRow_(live), AC.ANSWERS).setValue(JSON.stringify(answers));
}

function readAnswers_(live) {
  return parseJson_(sheet_(TABS.ATTEMPTS).getRange(liveRow_(live), AC.ANSWERS).getValue(), {});
}

function finalize_(live, exam, answers, reason) {
  closeAway_(live);
  event_(live, 'submitted', reason);
  var g = grade_(exam, answers);
  var sh = sheet_(TABS.ATTEMPTS), row = liveRow_(live);
  sh.getRange(row, AC.STATUS, 1, AC.TOTAL - AC.STATUS + 1).setValues([[STATUS_DONE, new Date(live.started),
    new Date(live.deadline), new Date(), reason, g.score, g.total]]);
  sh.getRange(row, AC.LEFT, 1, AC.EVENTS - AC.LEFT + 1).setValues([[live.departures, Math.round(live.awayMs / 1000),
    JSON.stringify(answers), JSON.stringify(g.items.map(function (x) { return [x.id, x.ok ? 1 : 0, x.got]; })),
    JSON.stringify(live.events)]]);
  dropLive_(live.id);
  return g;
}

/** Finds an attempt's row. A remembered row is checked first, since rows can move if the sheet is sorted. */
function findAttemptRow_(id, hint) {
  var sh = sheet_(TABS.ATTEMPTS);
  var last = sh.getLastRow();
  if (last < 2) return 0;
  if (hint && hint <= last && sh.getRange(hint, AC.ID).getValue() === id) return hint;
  var f = sh.getRange(2, AC.ID, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

/** The student's attempts (not reset), by exam ID. */
function attemptsOf_(email) {
  var sh = sheet_(TABS.ATTEMPTS);
  var out = {};
  if (sh.getLastRow() < 2) return out;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, AC.FINAL).getValues();
  rows.forEach(function (r) {
    if (String(r[AC.EMAIL - 1]).toLowerCase() !== email || r[AC.STATUS - 1] === STATUS_RESET) return;
    out[r[AC.EXAM - 1]] = { status: r[AC.STATUS - 1], submitted: r[AC.SUBMITTED - 1] instanceof Date ? r[AC.SUBMITTED - 1].getTime() : 0,
                            score: r[AC.SCORE - 1], total: r[AC.TOTAL - 1], final: r[AC.FINAL - 1] };
  });
  return out;
}

/** Runs every minute: submits attempts whose time ran out (for example, the student closed the laptop). */
function maintenance() {
  var p = props_();
  var keys = p.getKeys().filter(function (k) { return k.indexOf('L|') === 0; });
  keys.forEach(function (k) {
    var live = JSON.parse(p.getProperty(k) || 'null');
    if (!live || Date.now() <= live.deadline + GRACE_MS) return;
    var exam = examFull_(live.examId);
    try {
      if (exam) finalize_(live, exam, readAnswers_(live), 'Time ran out');
      else p.deleteProperty(k);
    } catch (e) {
      if (Date.now() > live.deadline + 7 * 86400000) p.deleteProperty(k); // record deleted from the sheet long ago
    }
  });
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function grade_(exam, answers) {
  var score = 0, total = 0;
  var items = exam.questions.map(function (q) {
    var a = answers[q.id];
    var ok = q.type === 'MC'
      ? typeof a === 'string' && a.toUpperCase() === String(q.answer).toUpperCase()
      : psCorrect_(a && typeof a === 'object' ? a.a : '', q);
    total += q.points;
    if (ok) score += q.points;
    return { id: q.id, ok: ok, got: ok ? q.points : 0 };
  });
  return { score: round_(score), total: round_(total), items: items };
}

/** A problem-solving final answer. The key may list several accepted answers separated by | */
function psCorrect_(text, q) {
  text = String(text == null ? '' : text).trim();
  if (!text || !String(q.answer).trim()) return false;
  return String(q.answer).split('|').some(function (key) { return matchOne_(text, key.trim(), q.tol); });
}

function matchOne_(text, key, tol) {
  if (!key) return false;
  var k = numberAnswer_(key);
  if (isFinite(k)) {
    var s = numberAnswer_(text);
    if (!isFinite(s)) s = numberAnswer_(stripUnits_(text));
    if (!isFinite(s)) return false;
    var allowed = Math.max(Math.abs(k) * (Number(tol) || 0) / 100, 1e-9 * Math.max(1, Math.abs(k)));
    return Math.abs(s - k) <= allowed;
  }
  var vars = varsOf_(key);
  if (vars) {
    try {
      var spec = { vars: vars, domain: {}, constant: MathExpr.hasC(MathExpr.parse(key, vars)) };
      if (spec.constant !== MathExpr.hasC(MathExpr.parse(text, vars))) return false;
      return MathExpr.sameFunction(text, key, spec);
    } catch (e) { /* not a formula the reader understands: compare as text */ }
  }
  return normText_(text) === normText_(key);
}

/** "20.4 m/s" -> "20.4"; "3.2 x 10^5 N" -> "3.2 x 10^5" */
function stripUnits_(text) {
  var m = String(text).trim().match(/^([-+−]?\s*(?:\d+(?:[.,]\d+)*|\.\d+)(?:\s*(?:[x×*]\s*10\s*\^?\s*[-+−]?\d+|e[-+]?\d+))?)(?=\s*[^\d.,\s])/i);
  return m ? m[1].replace(/\s+/g, '') : text;
}

function varsOf_(key) {
  var cands = [['x'], ['t'], ['x', 'y'], ['u']];
  for (var i = 0; i < cands.length; i++) {
    try { MathExpr.parse(key, cands[i]); return cands[i]; } catch (e) { /* try the next */ }
  }
  return null;
}

function normText_(s) { return String(s).toLowerCase().replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim(); }

/** A numeric answer: a plain number (3.77, 1.5e3, 2,124) or an exact value such as pi/4, 2ln(3), sqrt(2)/2. */
function numberAnswer_(raw) {
  var x = parseNumber_(raw);
  if (isFinite(x)) return x;
  try { return MathExpr.numberOf(raw); } catch (e) { return NaN; }
}

function parseNumber_(s) {
  var t = String(s == null ? '' : s).replace(/\s+/g, '').replace(/[−–]/g, '-');
  // "2,124" or "1,234.5" use a thousands comma; otherwise a comma is a decimal comma ("3,77").
  t = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  if (t === '') return NaN;
  var m = t.match(/^([-+]?\d*\.?\d+)(?:[x×*]10\^?([-+]?\d+))?$/i);
  if (m) return Number(m[1]) * Math.pow(10, m[2] ? Number(m[2]) : 0);
  return Number(t);
}

function cleanAnswers_(raw, exam) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  exam.questions.forEach(function (q) {
    var v = raw[q.id];
    if (v === undefined || v === null) return;
    if (q.type === 'MC') {
      if (typeof v === 'string' && /^[A-H]$/.test(v) && letterIndex_(v) < q.choices.length) out[q.id] = v;
    } else if (typeof v === 'object') {
      var a = String(v.a == null ? '' : v.a).slice(0, MAX_FINAL), s = String(v.s == null ? '' : v.s).slice(0, MAX_SOLUTION);
      if (a || s) out[q.id] = { a: a, s: s };
    }
  });
  return out;
}

function publicExam_(exam, live) {
  var byId = {};
  exam.questions.forEach(function (q) { byId[q.id] = q; });
  var order = live.order.filter(function (id) { return byId[id]; });
  exam.questions.forEach(function (q) { if (order.indexOf(q.id) < 0) order.push(q.id); });
  return {
    id: exam.id, title: exam.title, subject: exam.subject, instructions: exam.instructions,
    maxLeave: exam.maxLeave, blockCopy: exam.blockCopy,
    questions: order.map(function (id) {
      var q = byId[id];
      var out = { id: q.id, type: q.type, text: q.text, points: q.points };
      if (q.type === 'MC') {
        var letters = String(live.corder[q.id] || '').split('').filter(function (l) { return letterIndex_(l) < q.choices.length; });
        q.choices.forEach(function (c, i) { if (letters.indexOf(letter_(i)) < 0) letters.push(letter_(i)); });
        out.choices = letters.map(function (l) { return { l: l, t: q.choices[letterIndex_(l)] }; });
      }
      return out;
    })
  };
}

// ---------------------------------------------------------------------------
// Exams, questions and the class list (cached; the admin site clears the cache when it saves)
// ---------------------------------------------------------------------------

function exams_() {
  var hit = cacheGet_('exams');
  if (hit) return hit;
  var list = rows_(TABS.EXAMS, EXAM_HEAD.length).filter(function (r) { return String(r[0]).trim(); }).map(examFromRow_);
  cachePut_('exams', list);
  return list;
}

function examFromRow_(r) {
  var ms = function (v) { return v instanceof Date ? v.getTime() : 0; };
  return {
    id: String(r[0]).trim(), subject: String(r[1]).trim(), title: String(r[2]).trim(),
    status: String(r[3]).trim() === 'Published' ? 'Published' : 'Draft',
    opens: ms(r[4]), closes: ms(r[5]), limit: Math.max(1, Number(r[6]) || 60),
    sections: String(r[7]).split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(String),
    maxLeave: Math.max(0, Math.floor(Number(r[8]) || 0)),
    shuffleQ: truthy_(r[9]), shuffleC: truthy_(r[10]), blockCopy: r[11] === '' ? true : truthy_(r[11]), showScore: truthy_(r[12]),
    showSolutions: SHOW_SOLUTIONS.indexOf(String(r[13]).trim()) >= 0 ? String(r[13]).trim() : 'After closing',
    instructions: String(r[14] || '')
  };
}

function questions_(examId) {
  var hit = cacheGet_('q:' + examId);
  if (hit) return hit;
  var list = rows_(TABS.QUESTIONS, Q_HEAD.length).filter(function (r) { return String(r[0]) === examId; })
    .sort(function (a, b) { return Number(a[2]) - Number(b[2]); })
    .map(function (r) {
      var q = { id: String(r[1]), type: String(r[3]).trim().toUpperCase() === 'MC' ? 'MC' : 'PS', text: String(r[4]),
                answer: String(r[6]).trim(), tol: r[7] === '' ? 0 : Number(r[7]) || 0,
                points: r[8] === '' ? 1 : Math.max(0, Number(r[8]) || 0), solution: String(r[9] || '') };
      if (q.type === 'MC') { q.choices = String(r[5]).split('\n').filter(function (c) { return c.trim(); }); q.answer = q.answer.toUpperCase(); }
      return q;
    });
  cachePut_('q:' + examId, list);
  return list;
}

function examFull_(id) {
  var x = exams_().filter(function (e) { return e.id === id; })[0];
  if (!x) return null;
  var full = JSON.parse(JSON.stringify(x));
  full.questions = questions_(id);
  return full;
}

/** Class list by email: [{no, name, subject, section, blocked}] (a student can be in several subjects). */
function roster_() {
  var hit = cacheGet_('roster');
  if (hit) return hit;
  var map = {};
  rows_(TABS.CLASS, CLASS_HEAD.length, true).forEach(function (r) {
    var no = String(r[0]).trim();
    if (!no) return;
    var email = (String(r[4]).trim() || numberEmail_(no)).toLowerCase();
    (map[email] = map[email] || []).push({ no: no, name: String(r[1]).trim(), subject: String(r[2]).trim(),
      section: String(r[3]).trim(), blocked: truthy_(r[5]) });
  });
  cachePut_('roster', map);
  return map;
}

function enrollmentFor_(email, exam) {
  var list = roster_()[email] || [];
  var hit = list.filter(function (x) {
    return subjKey_(x.subject) === subjKey_(exam.subject) && (!exam.sections.length || exam.sections.indexOf(x.section) >= 0);
  });
  return hit.filter(function (x) { return !x.blocked; })[0] || hit[0] || null;
}

function examState_(x, now) {
  if (x.status !== 'Published') return 'draft';
  if (x.opens && now < x.opens) return 'upcoming';
  if (x.closes && now >= x.closes) return 'closed';
  return 'open';
}

function canReview_(exam, now) {
  if (exam.showSolutions === 'After submitting') return true;
  if (exam.showSolutions === 'After closing') return !!exam.closes && now >= exam.closes;
  return false;
}

function invalidate_(examIds) {
  var keys = ['exams', 'roster', 'settings'].concat((examIds || []).map(function (id) { return 'q:' + id; }));
  var c = CacheService.getScriptCache();
  c.removeAll(keys);
  // big values are stored in chunks
  keys.forEach(function (k) { var n = Number(c.get(k + '#n') || 0); for (var i = 0; i < n; i++) c.remove(k + '#' + i); c.remove(k + '#n'); });
}

// ---------------------------------------------------------------------------
// Admin API (instructor only)
// ---------------------------------------------------------------------------

function admin_load() {
  requireAdmin_();
  var counts = {};
  var sh = sheet_(TABS.ATTEMPTS);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, AC.STATUS).getValues().forEach(function (r) {
      var c = counts[r[AC.EXAM - 1]] = counts[r[AC.EXAM - 1]] || { live: 0, done: 0 };
      if (r[AC.STATUS - 1] === STATUS_LIVE) c.live++;
      if (r[AC.STATUS - 1] === STATUS_DONE) c.done++;
    });
  }
  var now = Date.now();
  var cls = classSummary_();
  return {
    email: currentEmail_(), now: now, settings: settings_(), studentUrl: appUrl_(), sheetUrl: ss_().getUrl(), pagesUrl: CONFIG.PAGES_URL,
    subjects: cls.subjects, students: cls.students, maintenance: hasTrigger_('maintenance'),
    exams: exams_().map(function (x) {
      return Object.assign({}, x, { state: examState_(x, now), count: questions_(x.id).length,
        counts: counts[x.id] || { live: 0, done: 0 }, opensText: dtLocal_(x.opens), closesText: dtLocal_(x.closes) });
    })
  };
}

function classSummary_() {
  var subjects = {}, students = 0;
  rows_(TABS.CLASS, CLASS_HEAD.length, true).forEach(function (r) {
    if (!String(r[0]).trim()) return;
    students++;
    var s = subjects[r[2]] = subjects[r[2]] || {};
    s[r[3]] = (s[r[3]] || 0) + 1;
  });
  exams_().forEach(function (x) { if (x.subject && !subjects[x.subject]) subjects[x.subject] = {}; });
  return { subjects: subjects, students: students };
}

function admin_getExam(id) {
  requireAdmin_();
  var x = examFull_(id);
  if (!x) throw new Error('Exam not found.');
  x.opensText = dtLocal_(x.opens);
  x.closesText = dtLocal_(x.closes);
  var c = { live: 0, done: 0 };
  var sh = sheet_(TABS.ATTEMPTS);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, AC.STATUS).getValues().forEach(function (r) {
      if (r[AC.EXAM - 1] !== id) return;
      if (r[AC.STATUS - 1] === STATUS_LIVE) c.live++;
      if (r[AC.STATUS - 1] === STATUS_DONE) c.done++;
    });
  }
  x.counts = c;
  return x;
}

function admin_saveExam(obj) {
  requireAdmin_();
  obj = obj || {};
  var subject = clean_(obj.subject, 40), title = clean_(obj.title, 150);
  if (!subject) throw new Error('Choose or type the subject.');
  if (!title) throw new Error('Type the exam title.');
  var limit = Math.round(Number(obj.limit));
  if (!(limit >= 1 && limit <= 600)) throw new Error('The time limit must be 1 to 600 minutes.');
  var opens = obj.opensText ? parseLocal_(obj.opensText) : '';
  var closes = obj.closesText ? parseLocal_(obj.closesText) : '';
  if (opens && closes && closes <= opens) throw new Error('The closing time must be after the opening time.');
  var maxLeave = Math.max(0, Math.floor(Number(obj.maxLeave) || 0));
  var qs = (obj.questions || []).map(function (q, i) {
    var n = i + 1;
    var type = q.type === 'MC' ? 'MC' : 'PS';
    var text = String(q.text || '').trim();
    if (!text) throw new Error('Question ' + n + ' has no text.');
    var out = { id: /^[\w-]{4,40}$/.test(q.id || '') ? q.id : newId_('Q'), type: type, text: text.slice(0, 20000),
                points: Math.max(0, Number(q.points) || 0), solution: String(q.solution || '').slice(0, 40000) };
    if (type === 'MC') {
      out.choices = (q.choices || []).map(function (c) { return String(c).replace(/\n+/g, ' ').trim(); }).filter(String);
      if (out.choices.length < 2) throw new Error('Question ' + n + ' needs at least 2 choices.');
      if (out.choices.length > 8) throw new Error('Question ' + n + ' has more than 8 choices.');
      out.answer = String(q.answer || '').trim().toUpperCase();
      if (!/^[A-H]$/.test(out.answer) || letterIndex_(out.answer) >= out.choices.length) {
        throw new Error('Question ' + n + ': the answer must be one of the choice letters (A to ' + letter_(out.choices.length - 1) + ').');
      }
      out.tol = '';
    } else {
      out.choices = [];
      out.answer = String(q.answer || '').trim().slice(0, 300);
      out.tol = q.tol === '' || q.tol == null ? 0 : Math.max(0, Number(q.tol) || 0);
    }
    return out;
  });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var id = obj.id && exams_().some(function (x) { return x.id === obj.id; }) ? obj.id : newId_('EX');
    var row = [id, subject, title, obj.status === 'Published' ? 'Published' : 'Draft', opens, closes, limit,
               (obj.sections || []).map(function (s) { return clean_(s, 60); }).filter(String).join(', '), maxLeave,
               !!obj.shuffleQ, !!obj.shuffleC, obj.blockCopy !== false, !!obj.showScore,
               SHOW_SOLUTIONS.indexOf(obj.showSolutions) >= 0 ? obj.showSolutions : 'After closing',
               String(obj.instructions || '').slice(0, 5000), new Date()];
    var sh = sheet_(TABS.EXAMS);
    var r = findRow_(sh, 1, id);
    if (r) sh.getRange(r, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    if (obj.questions) {
      var keep = rows_(TABS.QUESTIONS, Q_HEAD.length).filter(function (x) { return String(x[0]) && String(x[0]) !== id; });
      var mine = qs.map(function (q, i) {
        return [id, q.id, i + 1, q.type, txt_(q.text), txt_(q.choices.join('\n')), txt_(q.answer), q.tol, q.points, txt_(q.solution)];
      });
      // Plain-text columns, so answers such as 3/8 or 1-2 are not turned into dates
      writeTable_(TABS.QUESTIONS, Q_HEAD, keep.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? txt_(v) : v; }); }).concat(mine), [5, 6, 7, 10]);
    }
  } finally {
    lock.releaseLock();
  }
  invalidate_([id]);
  return admin_getExam(id);
}

function admin_deleteExam(id) {
  requireAdmin_();
  var sh = sheet_(TABS.EXAMS);
  var r = findRow_(sh, 1, id);
  if (!r) throw new Error('Exam not found.');
  sh.deleteRow(r);
  writeTable_(TABS.QUESTIONS, Q_HEAD, rows_(TABS.QUESTIONS, Q_HEAD.length).filter(function (x) { return String(x[0]) && String(x[0]) !== id; })
    .map(function (r) { return r.map(function (v) { return typeof v === 'string' ? txt_(v) : v; }); }), [5, 6, 7, 10]);
  invalidate_([id]);
  return admin_load();
}

function admin_duplicateExam(id) {
  requireAdmin_();
  var x = admin_getExam(id);
  x.id = '';
  x.title = 'Copy of ' + x.title;
  x.status = 'Draft';
  x.questions = x.questions.map(function (q) { var c = Object.assign({}, q); c.id = ''; return c; });
  return admin_saveExam(x);
}

/** Every enrolled student for the exam (with or without an attempt), plus attempts of students not on the list. */
function admin_results(examId) {
  requireAdmin_();
  var exam = examFull_(examId);
  if (!exam) throw new Error('Exam not found.');
  var sh = sheet_(TABS.ATTEMPTS);
  var last = sh.getLastRow();
  var byEmail = {};
  if (last > 1) {
    var ids = sh.getRange(2, AC.EXAM, last - 1, 1).getValues();
    var rowsWanted = [];
    ids.forEach(function (r, i) { if (r[0] === examId) rowsWanted.push(i + 2); });
    blocks_(rowsWanted).forEach(function (b) {
      sh.getRange(b[0], 1, b[1], ATT_HEAD.length).getValues().forEach(function (r, i) {
        if (r[AC.STATUS - 1] === STATUS_RESET) return;
        var a = attemptView_(r, exam);
        a.row = b[0] + i;
        byEmail[String(r[AC.EMAIL - 1]).toLowerCase()] = a;
      });
    });
  }
  var out = [];
  var seen = {};
  var map = roster_();
  Object.keys(map).forEach(function (email) {
    map[email].forEach(function (s) {
      if (subjKey_(s.subject) !== subjKey_(exam.subject)) return;
      if (exam.sections.length && exam.sections.indexOf(s.section) < 0) return;
      if (seen[email]) return;
      seen[email] = 1;
      out.push({ email: email, no: s.no, name: s.name, section: s.section, blocked: s.blocked, attempt: byEmail[email] || null });
    });
  });
  Object.keys(byEmail).forEach(function (email) {
    if (seen[email]) return;
    var a = byEmail[email];
    out.push({ email: email, no: a.no, name: a.name, section: a.section, extra: true, attempt: a });
  });
  out.sort(function (a, b) { return cmp_(a.section, b.section) || cmp_(a.name, b.name); });
  exam.opensText = dtLocal_(exam.opens);
  exam.closesText = dtLocal_(exam.closes);
  return { exam: exam, rows: out, now: Date.now() };
}

function attemptView_(r, exam) {
  var id = r[AC.ID - 1];
  var answers = parseJson_(r[AC.ANSWERS - 1], {});
  var live = r[AC.STATUS - 1] === STATUS_LIVE ? getLive_(id) : null;
  var g = grade_(exam, answers); // re-graded with the current key, so fixing a key updates everyone
  var ms = function (v) { return v instanceof Date ? v.getTime() : 0; };
  return {
    id: id, no: String(r[AC.NO - 1]), name: r[AC.NAME - 1], section: r[AC.SECTION - 1], status: r[AC.STATUS - 1],
    started: ms(r[AC.STARTED - 1]), deadline: ms(r[AC.DEADLINE - 1]), submitted: ms(r[AC.SUBMITTED - 1]), how: r[AC.HOW - 1],
    score: g.score, total: g.total, stored: r[AC.SCORE - 1], final: r[AC.FINAL - 1], remarks: r[AC.REMARKS - 1],
    left: live ? live.departures : Number(r[AC.LEFT - 1]) || 0,
    away: live ? Math.round((live.awayMs + (live.awaySince ? Date.now() - live.awaySince : 0)) / 1000) : Number(r[AC.AWAY - 1]) || 0,
    awayNow: !!(live && live.awaySince), answers: answers, items: g.items,
    events: live ? live.events : parseJson_(r[AC.EVENTS - 1], [])
  };
}

function admin_saveResult(attemptId, finalScore, remarks) {
  requireAdmin_();
  var row = findAttemptRow_(attemptId);
  if (!row) throw new Error('Attempt not found.');
  var f = String(finalScore == null ? '' : finalScore).trim();
  if (f !== '' && !isFinite(Number(f))) throw new Error('The final score must be a number (or blank).');
  sheet_(TABS.ATTEMPTS).getRange(row, AC.FINAL, 1, 2).setValues([[f === '' ? '' : Number(f), clean_(remarks, 500)]]);
  return { ok: true };
}

function admin_allowRetake(attemptId) {
  requireAdmin_();
  var row = findAttemptRow_(attemptId);
  if (!row) throw new Error('Attempt not found.');
  var sh = sheet_(TABS.ATTEMPTS);
  sh.getRange(row, AC.ID).setValue(attemptId + '|reset-' + Date.now());
  sh.getRange(row, AC.STATUS).setValue(STATUS_RESET);
  dropLive_(attemptId);
  return { ok: true };
}

/** Writes the current scores (after an answer-key fix) into the Attempts sheet. */
function admin_regrade(examId) {
  requireAdmin_();
  var exam = examFull_(examId);
  var sh = sheet_(TABS.ATTEMPTS);
  var last = sh.getLastRow();
  var n = 0;
  if (last < 2) return { updated: 0 };
  var all = sh.getRange(2, 1, last - 1, ATT_HEAD.length).getValues();
  all.forEach(function (r, i) {
    if (r[AC.EXAM - 1] !== examId || r[AC.STATUS - 1] !== STATUS_DONE) return;
    var g = grade_(exam, parseJson_(r[AC.ANSWERS - 1], {}));
    if (g.score === r[AC.SCORE - 1] && g.total === r[AC.TOTAL - 1]) return;
    sh.getRange(i + 2, AC.SCORE, 1, 2).setValues([[g.score, g.total]]);
    sh.getRange(i + 2, AC.ITEMS).setValue(JSON.stringify(g.items.map(function (x) { return [x.id, x.ok ? 1 : 0, x.got]; })));
    n++;
  });
  return { updated: n };
}

function admin_saveSettings(obj) {
  requireAdmin_();
  var clean = {};
  ['studentUrl', 'siteTitle', 'instructor'].forEach(function (k) { if (obj && obj[k] !== undefined) clean[k] = String(obj[k]).trim(); });
  if (clean.studentUrl && !/^https:\/\/script\.google\.com\/.+\/exec$/.test(clean.studentUrl)) {
    throw new Error('The student site address must be the web app URL that ends in /exec (Deploy > Manage deployments).');
  }
  writeSettings_(clean);
  return admin_load();
}

// ----- Class list from the record book -----

function admin_classList() {
  requireAdmin_();
  var rows = rows_(TABS.CLASS, CLASS_HEAD.length, true).filter(function (r) { return String(r[0]).trim(); });
  var s = settings_();
  return { rows: rows, books: String(s.recordBooks || '').split('\n').filter(String), sheetUrl: ss_().getUrl() };
}

/** Lists the tabs of a record book that contain student numbers, with the subject and block section read from each. */
function admin_readBook(url) {
  requireAdmin_();
  var book = openBook_(url);
  var tabs = [];
  book.getSheets().forEach(function (t) {
    var data = t.getDataRange().getDisplayValues();
    var students = studentsIn_(data);
    if (!students.length) return;
    var name = t.getName();
    var dash = name.lastIndexOf(' - ');
    var subject = dash >= 0 ? name.slice(0, dash).trim() : name.trim();
    var section = dash >= 0 ? name.slice(dash + 3).trim() : yearAndSection_(data);
    tabs.push({ tab: name, subject: subject, section: section, count: students.length,
                sample: students.slice(0, 3).map(function (x) { return x[0] + ' ' + x[1]; }) });
  });
  if (!tabs.length) throw new Error('No tab of that spreadsheet has student numbers (like 2026-101878) in column A.');
  return { title: book.getName(), tabs: tabs };
}

/**
 * Imports the chosen tabs. picks: [{tab, subject, section}]. The class list rows of those subject + block section
 * pairs are replaced; other subjects and sections are kept. "Blocked" ticks are kept for students who stay.
 */
function admin_importBook(url, picks) {
  requireAdmin_();
  var book = openBook_(url);
  picks = (picks || []).map(function (p) { return { tab: String(p.tab), subject: clean_(p.subject, 40), section: clean_(p.section, 60) }; })
    .filter(function (p) { return p.tab && p.subject && p.section; });
  if (!picks.length) throw new Error('Choose at least one tab, with its subject and block section filled in.');
  var found = [], seen = {}, perTab = [];
  picks.forEach(function (p) {
    var t = book.getSheetByName(p.tab);
    if (!t) throw new Error('No tab named "' + p.tab + '" in that spreadsheet.');
    var list = studentsIn_(t.getDataRange().getDisplayValues());
    var n = 0;
    list.forEach(function (s) {
      var key = s[0] + '|' + subjKey_(p.subject);
      if (seen[key]) return;
      seen[key] = 1;
      found.push([s[0], s[1], p.subject, p.section, numberEmail_(s[0])]);
      n++;
    });
    perTab.push({ tab: p.tab, subject: p.subject, section: p.section, count: n });
  });
  var pairs = {};
  picks.forEach(function (p) { pairs[subjKey_(p.subject) + '|' + p.section] = 1; });
  var old = rows_(TABS.CLASS, CLASS_HEAD.length, true).filter(function (r) { return String(r[0]).trim(); });
  var blocked = {};
  old.forEach(function (r) { if (truthy_(r[5])) blocked[String(r[0]).trim() + '|' + subjKey_(r[2])] = true; });
  var keep = old.filter(function (r) {
    return !pairs[subjKey_(r[2]) + '|' + String(r[3]).trim()] && !seen[String(r[0]).trim() + '|' + subjKey_(r[2])];
  });
  var removed = old.length - keep.length;
  var rows = keep.map(function (r) { return [r[0], r[1], r[2], r[3], r[4], truthy_(r[5])]; })
    .concat(found.map(function (f) { return f.concat([!!blocked[f[0] + '|' + subjKey_(f[2])]]); }));
  rows.sort(function (a, b) { return cmp_(a[2], b[2]) || cmp_(a[3], b[3]) || cmp_(a[1], b[1]); });
  writeTable_(TABS.CLASS, CLASS_HEAD, rows, [1]);
  var books = String(settings_().recordBooks || '').split('\n').filter(String);
  if (books.indexOf(url) < 0) books.push(url);
  writeSettings_({ recordBooks: books.join('\n') });
  invalidate_([]);
  var res = admin_classList();
  res.imported = { tabs: perTab, total: found.length, replaced: removed };
  return res;
}

function admin_setBlocked(studentNo, subject, blocked) {
  requireAdmin_();
  var sh = sheet_(TABS.CLASS);
  if (sh.getLastRow() < 2) throw new Error('The class list is empty.');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, CLASS_HEAD.length).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(studentNo).trim() && subjKey_(rows[i][2]) === subjKey_(subject)) {
      sh.getRange(i + 2, 6).setValue(!!blocked);
      invalidate_([]);
      return { ok: true };
    }
  }
  throw new Error('Student not found on the class list.');
}

/** Removes enrolments from the class list. list: [[student no., subject], ...] */
function admin_removeStudents(list) {
  requireAdmin_();
  var drop = {};
  (list || []).forEach(function (p) { drop[String(p[0]).trim() + '|' + subjKey_(p[1])] = 1; });
  var rows = rows_(TABS.CLASS, CLASS_HEAD.length, true).filter(function (r) { return String(r[0]).trim(); });
  var keep = rows.filter(function (r) { return !drop[String(r[0]).trim() + '|' + subjKey_(r[2])]; });
  writeTable_(TABS.CLASS, CLASS_HEAD, keep.map(classRow_), [1]);
  invalidate_([]);
  var res = admin_classList();
  res.removed = rows.length - keep.length;
  return res;
}

/** Adds one student to a subject (or updates their name and block section if already there). */
function admin_addStudent(s) {
  requireAdmin_();
  s = s || {};
  var no = String(s.no || '').trim(), name = clean_(s.name, 120), subject = clean_(s.subject, 40), section = clean_(s.section, 60);
  if (!/^\d{4}-\d{4,8}$/.test(no)) throw new Error('Type the student number like 2026-101878.');
  if (!name || !subject || !section) throw new Error('Fill in the name, subject and block section.');
  var rows = rows_(TABS.CLASS, CLASS_HEAD.length, true).filter(function (r) { return String(r[0]).trim(); }).map(classRow_);
  var hit = rows.filter(function (r) { return r[0] === no && subjKey_(r[2]) === subjKey_(subject); })[0];
  if (hit) { hit[1] = name; hit[3] = section; }
  else rows.push([no, name, subject, section, numberEmail_(no), false]);
  rows.sort(function (a, b) { return cmp_(a[2], b[2]) || cmp_(a[3], b[3]) || cmp_(a[1], b[1]); });
  writeTable_(TABS.CLASS, CLASS_HEAD, rows, [1]);
  invalidate_([]);
  var res = admin_classList();
  res.added = hit ? 'updated' : 'added';
  return res;
}

function classRow_(r) {
  var no = String(r[0]).trim();
  return [no, r[1], r[2], r[3], String(r[4]).trim() || numberEmail_(no), truthy_(r[5])];
}

function openBook_(url) {
  var m = String(url || '').match(/\/d\/([\w-]{20,})/);
  if (!m) throw new Error('Paste the address of your record book (a Google Sheets link).');
  try { return SpreadsheetApp.openById(m[1]); }
  catch (e) { throw new Error('Could not open that spreadsheet. Check the link and that your account can open it.'); }
}

/** [student no., name] for every row with a student number (like 2026-101878) in column A. */
function studentsIn_(data) {
  var out = [];
  data.forEach(function (r) {
    var no = String(r[0] || '').trim();
    if (!/^\d{4}-\d{4,8}$/.test(no)) return;
    var name = '';
    for (var k = 1; k < r.length; k++) if (String(r[k]).trim()) { name = String(r[k]).replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim(); break; }
    out.push([no, name]);
  });
  return out;
}

function yearAndSection_(data) {
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    for (var j = 0; j < r.length; j++) {
      if (/^YEAR AND SECTION:?$/i.test(String(r[j]).trim())) {
        for (var k = j + 1; k < r.length; k++) if (String(r[k]).trim()) return String(r[k]).trim();
      }
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Setup (run once from the Apps Script editor: choose "setup", click Run). Safe to run again.
// ---------------------------------------------------------------------------

function setup() {
  var who = currentEmail_();
  if (who && !isAdmin_(who)) throw new Error('Only the instructor can run setup. Add your email to CONFIG.ADMIN_EMAILS first.');
  var ss = ss_();
  ss.setSpreadsheetTimeZone(CONFIG.TZ);
  // Coming from the first (one-sheet) version: keep its tabs under another name instead of mixing them in,
  // and remove its every-minute trigger, whose function no longer exists.
  [[TABS.SETTINGS, 'Setting'], [TABS.QUESTIONS, 'Type']].forEach(function (t) {
    var old = ss.getSheetByName(t[0]);
    if (old && String(old.getRange(1, 1).getValue()) === t[1]) old.setName(t[0] + ' (old version)');
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncResults') ScriptApp.deleteTrigger(t);
  });
  sheetFor_(TABS.SETTINGS, ['Key', 'Value', 'Notes']);
  var s = settings_(true);
  var missing = DEFAULT_SETTINGS.filter(function (d) { return !(d[0] in s); });
  if (missing.length) {
    var sh = sheet_(TABS.SETTINGS);
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  }
  sheetFor_(TABS.EXAMS, EXAM_HEAD);
  sheetFor_(TABS.QUESTIONS, Q_HEAD);
  sheetFor_(TABS.CLASS, CLASS_HEAD);
  sheetFor_(TABS.ATTEMPTS, ATT_HEAD);
  sheet_(TABS.EXAMS).getRange('E:F').setNumberFormat('yyyy-mm-dd hh:mm');
  sheet_(TABS.ATTEMPTS).getRange('J:L').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet_(TABS.CLASS).getRange('A:A').setNumberFormat('@');
  ['E:G', 'J:J'].forEach(function (a) { sheet_(TABS.QUESTIONS).getRange(a).setNumberFormat('@'); });
  var stray = ss.getSheetByName('Sheet1');
  if (stray && stray.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(stray);
  if (!hasTrigger_('maintenance')) ScriptApp.newTrigger('maintenance').timeBased().everyMinutes(1).create();
  if (!exams_().length) admin_saveExam(sampleExam_());
  invalidate_([]);
  ss.toast('Next: Deploy > New deployment > Web app, then open the admin site (web app link + ?page=admin).', 'Setup complete', 20);
}

function sampleExam_() {
  return {
    subject: 'MMW', title: 'Sample exam (practice)', status: 'Draft', limit: 30, maxLeave: 3, blockCopy: true,
    showSolutions: 'After submitting', instructions: 'This sample shows how the exam looks. Delete it when you add your own.',
    questions: [
      { type: 'MC', text: 'Which number comes next in the Fibonacci sequence 1, 1, 2, 3, 5, 8, ...?', choices: ['11', '12', '13', '15'], answer: 'C', points: 1 },
      { type: 'MC', text: 'What is the value of \\(\\sqrt{49}\\)?', choices: ['6', '7', '8', '49'], answer: 'B', points: 1 },
      { type: 'PS', text: 'A shirt costs ₱450 and is sold at a 20% discount. What is the sale price, in pesos?', answer: '360', tol: 0, points: 3,
        solution: 'The discount is $0.20 \\times 450 = 90$, so the sale price is $450 - 90 = 360$ pesos.' }
    ]
  };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Exam').addItem('Open the admin site', 'showAdminLink').addItem('Run setup', 'setup').addToUi();
}

function showAdminLink() {
  var url = appUrl_();
  var html = url
    ? '<p style="font-family:sans-serif">Admin site: <a target="_blank" href="' + esc_(url) + '?page=admin">' + esc_(url) + '?page=admin</a></p>' +
      '<p style="font-family:sans-serif">Student site: <a target="_blank" href="' + esc_(CONFIG.PAGES_URL) + '">' + esc_(CONFIG.PAGES_URL) + '</a></p>'
    : '<p style="font-family:sans-serif">Deploy the web app first (Extensions > Apps Script > Deploy > New deployment > Web app), ' +
      'then paste its /exec address in the Settings tab (studentUrl).</p>';
  SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(140), 'Exam links');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run setup from the Apps Script editor.');
  return sh;
}

function sheetFor_(name, head) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#F6E2E5');
  sh.setFrozenRows(1);
  return sh;
}

function rows_(name, width, display) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var r = sh.getRange(2, 1, sh.getLastRow() - 1, width);
  return display ? r.getDisplayValues() : r.getValues();
}

/** Replaces everything under the header. textCols: 1-based columns kept as plain text (student numbers). */
function writeTable_(name, head, rows, textCols) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  (textCols || []).forEach(function (c) { if (rows.length) sh.getRange(2, c, rows.length, 1).setNumberFormat('@'); });
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
}

function findRow_(sh, col, value) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var f = sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

/** Groups sorted row numbers into [start, count] blocks so they can be read with few calls. */
function blocks_(rows) {
  var out = [];
  rows.forEach(function (r) {
    var b = out[out.length - 1];
    if (b && r === b[0] + b[1]) b[1]++;
    else out.push([r, 1]);
  });
  return out;
}

function settings_(fresh) {
  if (!fresh) { var hit = cacheGet_('settings'); if (hit) return hit; }
  var out = {};
  rows_(TABS.SETTINGS, 2, true).forEach(function (r) { if (String(r[0]).trim()) out[String(r[0]).trim()] = r[1]; });
  cachePut_('settings', out);
  return out;
}

function writeSettings_(obj) {
  var sh = sheet_(TABS.SETTINGS);
  Object.keys(obj).forEach(function (k) {
    var r = findRow_(sh, 1, k);
    if (r) sh.getRange(r, 2).setValue(obj[k]);
    else sh.appendRow([k, obj[k], '']);
  });
  invalidate_([]);
}

// Cache values over 100 KB are split into chunks.
function cacheGet_(key) {
  var c = CacheService.getScriptCache();
  var v = c.get(key);
  if (v) return JSON.parse(v);
  var n = Number(c.get(key + '#n') || 0);
  if (!n) return null;
  var parts = [];
  for (var i = 0; i < n; i++) { var p = c.get(key + '#' + i); if (p == null) return null; parts.push(p); }
  return JSON.parse(parts.join(''));
}

function cachePut_(key, value) {
  var c = CacheService.getScriptCache();
  var s = JSON.stringify(value);
  try {
    if (s.length < 90000) { c.put(key, s, CACHE_SECONDS); return; }
    var size = 90000, n = Math.ceil(s.length / size);
    if (n > 20) return;
    for (var i = 0; i < n; i++) c.put(key + '#' + i, s.slice(i * size, (i + 1) * size), CACHE_SECONDS);
    c.put(key + '#n', String(n), CACHE_SECONDS);
  } catch (e) { /* caching is only a speed-up */ }
}

function currentEmail_() {
  try { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; }
}

function isRtu_(email) {
  return new RegExp('@' + CONFIG.DOMAIN.replace(/\./g, '\\.') + '$', 'i').test(email || '');
}

function isAdmin_(email) {
  return CONFIG.ADMIN_EMAILS.map(function (x) { return x.toLowerCase(); }).indexOf(String(email).toLowerCase()) >= 0;
}

function requireRtu_() {
  var email = currentEmail_();
  if (!isRtu_(email)) throw new Error('Please sign in with your @' + CONFIG.DOMAIN + ' account.');
  return email;
}

function requireAdmin_() {
  var email = currentEmail_();
  if (!isAdmin_(email)) throw new Error('Instructors only.');
  return email;
}

/** The RTU email of a student number, e.g. 2026-101878 -> 2026-101878@rtu.edu.ph. */
function numberEmail_(studentNo) {
  var no = String(studentNo || '').trim().toLowerCase();
  return no ? no + '@' + CONFIG.DOMAIN : '';
}

function appUrl_() {
  // ScriptApp.getService().getUrl() can return null or the editor-only /dev address, so the saved address wins.
  var saved = settings_().studentUrl;
  var url = /\/exec$/.test(saved || '') ? saved : String(ScriptApp.getService().getUrl() || '');
  if (!/\/exec$/.test(url)) return '';
  // The /a/macros/<domain>/ form always opens with the RTU account.
  return url.replace(/^https:\/\/script\.google\.com\/macros\/s\//, 'https://script.google.com/a/macros/' + CONFIG.DOMAIN + '/s/');
}

function hasTrigger_(fn) {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; });
}

function subjKey_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function letter_(i) { return String.fromCharCode(65 + i); }
function letterIndex_(l) { return String(l).toUpperCase().charCodeAt(0) - 65; }
function round_(x) { return Math.round(x * 100) / 100; }
function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }

function shuffle_(a) {
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function parseJson_(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
}

/** "2026-11-20T08:00" (Philippine time) -> Date */
function parseLocal_(text) {
  var t = String(text).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) throw new Error('Dates must look like 2026-11-20 08:00.');
  return Utilities.parseDate(t, CONFIG.TZ, "yyyy-MM-dd'T'HH:mm");
}

function dtLocal_(ms) { return ms ? Utilities.formatDate(new Date(ms), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm") : ''; }
function niceTime_(ms) { return Utilities.formatDate(new Date(ms), CONFIG.TZ, "MMMM d, yyyy 'at' h:mm a"); }

function truthy_(v) { return v === true || /^(true|yes|1|on)$/i.test(String(v).trim()); }
function cmp_(a, b) { return String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base' }); }

function clean_(v, max) {
  var t = String(v == null ? '' : v).trim().slice(0, max);
  return /^[=+\-@]/.test(t) ? "'" + t : t; // stop spreadsheet formula injection
}

/** Text for a plain-text cell: a leading = + or @ would otherwise start a formula. */
function txt_(s) { s = String(s == null ? '' : s); return /^[=+@]/.test(s) ? "'" + s : s; }

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
