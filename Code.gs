/**
 * Online exam with tab-switch detection (Google Apps Script version).
 *
 * The teacher controls everything from the Google Sheet this script is attached to:
 *   Settings  - title, time limit, auto-submit rule, etc.
 *   Questions - the exam itself
 *   Sections  - block sections, and whether each one is open
 *   Students  - who may take the exam (by @rtu.edu.ph email)
 *   Results / Log - filled in automatically about once a minute
 *
 * Live exam state is kept in Script Properties (fast and safe with many students at once)
 * and copied to the Results and Log sheets by a 1-minute trigger.
 */

// Only Google accounts from this domain can take the exam. This is deliberately NOT a sheet
// setting, so nobody can loosen it by editing the spreadsheet.
const ALLOWED_DOMAIN = 'rtu.edu.ph';

const SHEETS = { settings: 'Settings', questions: 'Questions', sections: 'Sections', students: 'Students', results: 'Results', log: 'Log' };
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const Q_COLS = { type: 0, text: 1, points: 2, correct: 3, choices: 4, id: 10 }; // choices A-F = columns 5-10, ID = column 11
const MAX_EVENTS = 100;       // per student
const MAX_ANSWER_LEN = 300;   // characters per short answer
const GRACE_MS = 30 * 1000;   // late submissions accepted this long after the timer ends
const CFG_CACHE_KEY = 'cfg';
const CFG_CACHE_SECONDS = 600;

// [label shown in the Settings sheet, key, default value, note]
const SETTINGS = [
  ['Exam title', 'title', 'Sample Quiz: General Science', ''],
  ['Instructions', 'instructions', 'Answer every question. Do not leave this page or switch tabs during the exam. Each time you leave, it is recorded and your teacher will see it.', ''],
  ['Time limit (minutes)', 'duration', 30, ''],
  ['Auto-submit after leaving the page this many times', 'maxDepartures', 3, '0 = never auto-submit, only record it'],
  ['Block copy, paste and right-click', 'blockCopy', true, 'Attempts are recorded in the Log'],
  ['Use fullscreen if the browser allows it', 'fullscreen', true, 'Leaving fullscreen is recorded'],
  ['Shuffle question order for each student', 'shuffle', false, ''],
  ['Show score to students after they submit', 'showScore', false, ''],
];

// =====================================================================
// Web app entry point
// =====================================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Online Exam')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =====================================================================
// Reading the teacher's sheets
// =====================================================================
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function rows_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

const isTrue_ = (v) => v === true || String(v).trim().toUpperCase() === 'TRUE';
const isFalse_ = (v) => v === false || String(v).trim().toUpperCase() === 'FALSE';
const newQuestionId_ = () => 'q' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);

function getConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CFG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const cfg = buildConfig_();
  try { cache.put(CFG_CACHE_KEY, JSON.stringify(cfg), CFG_CACHE_SECONDS); } catch (e) { /* too large to cache: still works, just slower */ }
  return cfg;
}

function buildConfig_() {
  // Settings (looked up by the label in column A)
  const raw = {};
  rows_(SHEETS.settings).forEach((r) => { raw[String(r[0]).trim().toLowerCase()] = r[1]; });
  const s = {};
  SETTINGS.forEach(([label, key, def]) => {
    const v = raw[label.toLowerCase()];
    if (v === undefined || v === '') s[key] = def;
    else if (typeof def === 'boolean') s[key] = isTrue_(v);
    else if (typeof def === 'number') s[key] = Math.max(0, Number(v) || def);
    else s[key] = String(v);
  });
  s.duration = Math.max(1, s.duration);
  s.maxDepartures = Math.floor(s.maxDepartures);

  // Questions (make sure every question has a stable ID so edits mid-exam don't scramble answers)
  ensureQuestionIds_();
  const questions = [];
  rows_(SHEETS.questions).forEach((r) => {
    const text = String(r[Q_COLS.text] || '').trim();
    if (!text) return;
    const q = { id: String(r[Q_COLS.id]), text, points: r[Q_COLS.points] === '' ? 1 : Math.max(0, Number(r[Q_COLS.points]) || 0) };
    if (/short/i.test(String(r[Q_COLS.type]))) {
      q.type = 'short';
      q.answers = String(r[Q_COLS.correct]).split('|').map((x) => x.trim()).filter(String);
    } else {
      q.type = 'mc';
      q.choices = [];
      CHOICE_LETTERS.forEach((l, i) => {
        const c = String(r[Q_COLS.choices + i] === undefined ? '' : r[Q_COLS.choices + i]).trim();
        if (c) q.choices.push({ l, t: c });
      });
      q.answer = String(r[Q_COLS.correct]).trim().toUpperCase().charAt(0);
    }
    questions.push(q);
  });

  const sections = {};
  rows_(SHEETS.sections).forEach((r) => {
    const name = String(r[0]).trim();
    if (name) sections[name] = isTrue_(r[1]);
  });

  const students = {};
  rows_(SHEETS.students).forEach((r) => {
    const email = String(r[0]).trim().toLowerCase();
    if (email) students[email] = { name: String(r[1]).trim() || email, section: String(r[2]).trim(), blocked: isTrue_(r[3]) };
  });

  return { settings: s, questions, sections, students };
}

function ensureQuestionIds_() {
  const sh = ss_().getSheetByName(SHEETS.questions);
  if (!sh || sh.getLastRow() < 2) return;
  const n = sh.getLastRow() - 1;
  const needs = () => sh.getRange(2, 1, n, Q_COLS.id + 1).getValues().some((r) => String(r[Q_COLS.text]).trim() && !String(r[Q_COLS.id]).trim());
  if (!needs()) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const vals = sh.getRange(2, 1, n, Q_COLS.id + 1).getValues();
    const seen = {};
    const ids = vals.map((r) => {
      let id = String(r[Q_COLS.id]).trim();
      if (String(r[Q_COLS.text]).trim() && (!id || seen[id])) id = newQuestionId_();
      if (id) seen[id] = true;
      return [id];
    });
    sh.getRange(2, Q_COLS.id + 1, n, 1).setValues(ids);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

// =====================================================================
// Live attempt storage (Script Properties)
// =====================================================================
function props_() { return PropertiesService.getScriptProperties(); }

function loadAttempt_(email) {
  const p = props_();
  const a = p.getProperty('A|' + email);
  if (!a) return null;
  const attempt = JSON.parse(a);
  attempt.events = JSON.parse(p.getProperty('E|' + email) || '[]');
  return attempt;
}

function saveAttempt_(a) {
  const events = a.events;
  const copy = Object.assign({}, a);
  delete copy.events;
  const out = {};
  out['A|' + a.email] = JSON.stringify(copy);
  out['E|' + a.email] = JSON.stringify(events);
  out.changed = String(Date.now());
  if (out['A|' + a.email].length > 8800) throw new Error('Your answers are too long to save. Please shorten them.');
  props_().setProperties(out);
}

function logEvent_(a, type, detail) {
  if (a.events.length < MAX_EVENTS) a.events.push([Date.now(), type, detail ? String(detail).slice(0, 60) : '']);
}

function closeAway_(a) {
  if (a.awaySince) { a.awayMs += Date.now() - a.awaySince; a.awaySince = 0; }
}

const norm_ = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

function grade_(a, cfg) {
  let score = 0, total = 0;
  cfg.questions.forEach((q) => {
    total += q.points;
    const ans = a.answers[q.id];
    if (ans === undefined || ans === '') return;
    if (q.type === 'mc' ? ans === q.answer : q.answers.some((x) => norm_(x) === norm_(ans))) score += q.points;
  });
  return { score, total };
}

function finalize_(a, reason, cfg) {
  if (a.submittedAt) return;
  closeAway_(a);
  a.submittedAt = Date.now();
  a.submitReason = reason;
  logEvent_(a, 'submitted', reason);
  Object.assign(a, grade_(a, cfg));
}

function expireIfLate_(a, cfg) {
  if (!a.submittedAt && Date.now() > a.deadline + GRACE_MS) { finalize_(a, 'Time ran out', cfg); return true; }
  return false;
}

function cleanAnswers_(raw, cfg) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  cfg.questions.forEach((q) => {
    const v = raw[q.id];
    if (typeof v !== 'string' || v === '') return;
    if (q.type === 'mc') { if (q.choices.some((c) => c.l === v)) out[q.id] = v; }
    else out[q.id] = v.slice(0, MAX_ANSWER_LEN);
  });
  return out;
}

function publicExam_(a, cfg) {
  const byId = {};
  cfg.questions.forEach((q) => { byId[q.id] = q; });
  const order = a.order.filter((id) => byId[id]).concat(cfg.questions.map((q) => q.id).filter((id) => a.order.indexOf(id) < 0));
  const s = cfg.settings;
  return {
    title: s.title, instructions: s.instructions, maxDepartures: s.maxDepartures,
    blockCopy: s.blockCopy, fullscreen: s.fullscreen,
    questions: order.map((id) => {
      const q = byId[id];
      return { id: q.id, type: q.type, text: q.text, points: q.points, choices: q.type === 'mc' ? q.choices : undefined };
    }),
  };
}

function stateFor_(a) {
  return { deadline: a.deadline, serverNow: Date.now(), answers: a.answers, departures: a.departures };
}

// =====================================================================
// Who is this student, and may they take the exam?
// =====================================================================
function identify_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) return { error: `We could not read your Google account. Open this link while signed in to your @${ALLOWED_DOMAIN} account only (a private/incognito window helps if you have several accounts).` };
  if (!email.endsWith('@' + ALLOWED_DOMAIN)) return { error: `You are signed in as ${email}. Only @${ALLOWED_DOMAIN} accounts can take this exam.` };
  return { email };
}

function eligibility_(email, cfg) {
  const st = cfg.students[email];
  if (!st) return { error: `Your account (${email}) is not on the list for this exam. Please contact your teacher.` };
  if (st.blocked) return { error: 'Your access to this exam has been turned off. Please contact your teacher.' };
  if (!cfg.sections[st.section]) return { error: `The exam is not open for your section${st.section ? ' (' + st.section + ')' : ''} right now.` };
  return { student: st };
}

// =====================================================================
// Functions the exam page calls (google.script.run)
// =====================================================================

/** Before starting: who am I, and can I take the exam? Does not start the timer. */
function apiCheck() {
  const who = identify_();
  if (who.error) return who;
  const cfg = getConfig_();
  const a = loadAttempt_(who.email);
  if (a) {
    if (expireIfLate_(a, cfg)) saveAttempt_(a);
    if (a.submittedAt) return { done: true, email: who.email, message: 'You have already submitted this exam.' };
  }
  const el = eligibility_(who.email, cfg);
  if (el.error && !a) return Object.assign({ email: who.email }, el);
  const st = cfg.students[who.email] || { name: a.name, section: a.section };
  return {
    ok: true, email: who.email, name: st.name, section: st.section, resuming: !!a,
    title: cfg.settings.title, instructions: cfg.settings.instructions, duration: cfg.settings.duration,
    count: cfg.questions.length, maxDepartures: cfg.settings.maxDepartures, fullscreen: cfg.settings.fullscreen,
    minutesLeft: a ? Math.max(0, Math.ceil((a.deadline - Date.now()) / 60000)) : null,
  };
}

/** Start (or resume) the exam. The timer starts on the first call. */
function apiStart() {
  const who = identify_();
  if (who.error) return who;
  const cfg = getConfig_();
  let a = loadAttempt_(who.email);
  if (a && expireIfLate_(a, cfg)) saveAttempt_(a);
  if (a && a.submittedAt) return { done: true, message: 'You have already submitted this exam.' };
  if (!a) {
    const el = eligibility_(who.email, cfg);
    if (el.error) return el;
    if (!cfg.questions.length) return { error: 'This exam has no questions yet. Please contact your teacher.' };
    const order = cfg.questions.map((q) => q.id);
    if (cfg.settings.shuffle) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const now = Date.now();
    a = { email: who.email, name: el.student.name, section: el.student.section, startedAt: now, deadline: now + cfg.settings.duration * 60000,
          order, answers: {}, departures: 0, awayMs: 0, awaySince: 0, submittedAt: 0, submitReason: '', events: [] };
    logEvent_(a, 'started');
  } else {
    closeAway_(a);
    logEvent_(a, 'opened the exam again');
  }
  saveAttempt_(a);
  return { name: a.name, exam: publicExam_(a, cfg), state: stateFor_(a) };
}

function withAttempt_(fn) {
  const who = identify_();
  if (who.error) return who;
  const cfg = getConfig_();
  const a = loadAttempt_(who.email);
  if (!a) return { error: 'Your exam session was not found. Reload the page.', reload: true };
  if (expireIfLate_(a, cfg)) { saveAttempt_(a); return { submitted: true, departures: a.departures, reason: 'time' }; }
  if (a.submittedAt) return { submitted: true, departures: a.departures };
  return fn(a, cfg);
}

function apiSave(answers) {
  return withAttempt_((a, cfg) => {
    a.answers = cleanAnswers_(answers, cfg);
    saveAttempt_(a);
    return { ok: true };
  });
}

const LOGGABLE = { 'fullscreen-exit': 'left fullscreen', copy: 'tried to copy', cut: 'tried to cut', paste: 'tried to paste', 'right-click': 'tried to right-click', shortcut: 'blocked shortcut' };

function apiEvent(type, detail, answers) {
  return withAttempt_((a, cfg) => {
    if (answers) a.answers = cleanAnswers_(answers, cfg);
    if (type === 'left') {
      if (!a.awaySince) { a.departures++; a.awaySince = Date.now(); logEvent_(a, 'left exam page', detail); }
      const max = cfg.settings.maxDepartures;
      if (max > 0 && a.departures >= max) finalize_(a, `Auto-submitted after leaving the page ${a.departures} times`, cfg);
    } else if (type === 'returned') {
      const since = a.awaySince;
      closeAway_(a);
      logEvent_(a, 'came back', since ? `away ${Math.round((Date.now() - since) / 1000)}s` : '');
    } else if (LOGGABLE[type]) {
      logEvent_(a, LOGGABLE[type], detail);
    }
    saveAttempt_(a);
    return { departures: a.departures, max: cfg.settings.maxDepartures, submitted: !!a.submittedAt };
  });
}

function apiSubmit(answers, reason) {
  return withAttempt_((a, cfg) => {
    a.answers = cleanAnswers_(answers, cfg);
    finalize_(a, reason === 'time' ? 'Time ran out' : 'Submitted by student', cfg);
    saveAttempt_(a);
    const out = { submitted: true };
    if (cfg.settings.showScore) { out.score = a.score; out.total = a.total; }
    return out;
  });
}

// =====================================================================
// Copy live results into the Results and Log sheets (runs every minute)
// =====================================================================
function syncResults(force) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const p = props_();
    const all = p.getProperties();
    if (force !== true && Number(all.changed || 0) <= Number(all.synced || 0)) return;
    const started = Date.now();
    CacheService.getScriptCache().remove(CFG_CACHE_KEY);
    const cfg = getConfig_();

    const attempts = {};
    Object.keys(all).forEach((k) => {
      if (k.indexOf('A|') !== 0) return;
      const a = JSON.parse(all[k]);
      a.events = JSON.parse(all['E|' + a.email] || '[]');
      if (expireIfLate_(a, cfg)) saveAttempt_(a);
      attempts[a.email] = a;
    });

    const qNum = {};
    cfg.questions.forEach((q, i) => { qNum[q.id] = i + 1; });
    const fmtAnswers = (a) => cfg.questions.filter((q) => a.answers[q.id] !== undefined).map((q) => `${qNum[q.id]}: ${String(a.answers[q.id]).trim()}`).join('  ·  ');

    const people = Object.keys(cfg.students).map((e) => Object.assign({ email: e }, cfg.students[e]));
    Object.keys(attempts).forEach((e) => { if (!cfg.students[e]) people.push({ email: e, name: attempts[e].name, section: attempts[e].section + ' (removed from list)' }); });
    people.sort((x, y) => (x.section + '\u0000' + x.name).localeCompare(y.section + '\u0000' + y.name));

    const now = Date.now();
    const resultRows = people.map((s) => {
      const a = attempts[s.email];
      if (!a) return [s.email, s.name, s.section, s.blocked ? 'Blocked' : 'Not started', '', '', '', '', '', '', '', '', ''];
      const g = grade_(a, cfg); // live re-grade, so fixing the answer key updates everyone
      const away = a.awayMs + (a.awaySince && !a.submittedAt ? now - a.awaySince : 0);
      return [a.email, s.name, s.section, a.submittedAt ? 'Submitted' : 'In progress', g.score, g.total, a.departures,
        Math.round(away / 1000), a.awaySince && !a.submittedAt ? 'AWAY NOW' : '', new Date(a.startedAt),
        a.submittedAt ? new Date(a.submittedAt) : '', a.submitReason || '', fmtAnswers(a)];
    });
    writeTable_(SHEETS.results, resultRows, 13);

    const logRows = [];
    Object.keys(attempts).forEach((e) => {
      const a = attempts[e];
      a.events.forEach((ev) => logRows.push([new Date(ev[0]), a.email, a.name, a.section, ev[1], ev[2]]));
    });
    logRows.sort((x, y) => x[0] - y[0]);
    writeTable_(SHEETS.log, logRows, 6);

    p.setProperty('synced', String(started));
  } finally { lock.releaseLock(); }
}

function writeTable_(name, rows, width) {
  const sh = ss_().getSheetByName(name);
  if (!sh) return;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
}

// =====================================================================
// Teacher menu
// =====================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Exam')
    .addItem('Set up sheets', 'setup')
    .addItem('Show the exam link', 'showLink')
    .addSeparator()
    .addItem('Update results now', 'updateResultsNow')
    .addItem('Allow retake for selected students', 'allowRetake')
    .addItem('Archive and clear all results', 'archiveAndClear')
    .addToUi();
}

/** Any edit to the sheet makes the next student request use the new settings right away. */
function onEdit(e) {
  CacheService.getScriptCache().remove(CFG_CACHE_KEY);
}

function updateResultsNow() {
  syncResults(true);
  SpreadsheetApp.getActive().toast('Results updated.');
}

function showLink() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  const msg = url
    ? `Share this link with your students:\n\n${url}\n\nIf you change the code, use Deploy > Manage deployments > Edit > New version so the link keeps working.`
    : 'The exam has not been deployed yet. In Extensions > Apps Script, click Deploy > New deployment > Web app.';
  SpreadsheetApp.getUi().alert('Exam link', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function allowRetake() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if ([SHEETS.results, SHEETS.students].indexOf(sh.getName()) < 0) return ui.alert('Select the students\' rows in the Results or Students sheet first.');
  const emails = [];
  sh.getActiveRangeList().getRanges().forEach((r) => {
    const first = Math.max(2, r.getRow());
    const last = r.getLastRow();
    if (last < first) return;
    sh.getRange(first, 1, last - first + 1, 1).getValues().forEach((v) => { const e = String(v[0]).trim().toLowerCase(); if (e) emails.push(e); });
  });
  const p = props_();
  const found = emails.filter((e) => p.getProperty('A|' + e));
  if (!found.length) return ui.alert('None of the selected students has started the exam.');
  if (ui.alert('Allow retake?', `Delete the attempt of:\n${found.join('\n')}\n\nThey can then take the exam again from the start.`, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  found.forEach((e) => { p.deleteProperty('A|' + e); p.deleteProperty('E|' + e); });
  syncResults(true);
  SpreadsheetApp.getActive().toast(`${found.length} student(s) can now retake the exam.`);
}

function archiveAndClear() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Archive and clear all results?', 'Copies of the Results and Log sheets are kept, then every attempt is deleted so all students can take the next exam. Do this between exams.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  syncResults(true);
  const ss = ss_();
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH.mm');
  [SHEETS.results, SHEETS.log].forEach((n) => { const sh = ss.getSheetByName(n); if (sh) sh.copyTo(ss).setName(`${n} ${stamp}`); });
  const p = props_();
  Object.keys(p.getProperties()).forEach((k) => { if (k.indexOf('A|') === 0 || k.indexOf('E|') === 0) p.deleteProperty(k); });
  syncResults(true);
  ss.toast('Results archived and cleared.');
}

// =====================================================================
// One-time setup: creates the sheets with examples, and the 1-minute results trigger
// =====================================================================
function setup() {
  const ss = ss_();
  const make = (name, headers, sample, widths) => {
    let sh = ss.getSheetByName(name);
    const isNew = !sh;
    if (isNew) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eaf6');
    sh.setFrozenRows(1);
    if (isNew && sample.length) sh.getRange(2, 1, sample.length, sample[0].length).setValues(sample);
    (widths || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
    return { sh, isNew };
  };

  // Settings
  const st = make(SHEETS.settings, ['Setting', 'Value', 'Notes'], SETTINGS.map((r) => [r[0], r[2], r[3]]), [330, 420, 300]);
  st.sh.getRange(2, 2, SETTINGS.length, 1).setWrap(true).setHorizontalAlignment('left');
  SETTINGS.forEach((r, i) => { if (typeof r[2] === 'boolean') st.sh.getRange(i + 2, 2).insertCheckboxes(); });
  if (st.isNew) SETTINGS.forEach((r, i) => { if (typeof r[2] === 'boolean') st.sh.getRange(i + 2, 2).setValue(r[2]); });

  // Questions
  const qs = make(SHEETS.questions,
    ['Type', 'Question', 'Points', 'Correct answer', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Choice E', 'Choice F', 'ID (automatic, do not edit)'],
    [
      ['Multiple choice', 'Which planet is closest to the Sun?', 1, 'B', 'Venus', 'Mercury', 'Earth', 'Mars', '', '', ''],
      ['Multiple choice', 'What gas do plants absorb from the air for photosynthesis?', 1, 'C', 'Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen', '', '', ''],
      ['Short answer', 'What is the chemical formula of water?', 2, 'H2O | H₂O', '', '', '', '', '', '', ''],
    ], [130, 380, 60, 160, 140, 140, 140, 140, 120, 120, 170]);
  qs.sh.getRange('A2:A500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Multiple choice', 'Short answer'], true).build());
  qs.sh.getRange('B2:B500').setWrap(true);
  qs.sh.getRange('K:K').setFontColor('#999999');
  qs.sh.getRange('D1').setNote('Multiple choice: the letter of the correct choice (A-F).\nShort answer: every accepted answer, separated by | (not case-sensitive).');

  // Sections
  const sc = make(SHEETS.sections, ['Section', 'Open', 'Students'], [['Section A', true, ''], ['Section B', false, '']], [220, 80, 90]);
  sc.sh.getRange('B2:B200').insertCheckboxes();
  if (sc.isNew) sc.sh.getRange('B2:B3').setValues([[true], [false]]);
  sc.sh.getRange('C2').setFormula(`=ARRAYFORMULA(IF(A2:A200="","",COUNTIF(${SHEETS.students}!C2:C,A2:A200)))`);
  sc.sh.getRange('B1').setNote('Tick to let this section take the exam. Untick to close it.');

  // Students
  const su = make(SHEETS.students, ['Email', 'Full name', 'Section', 'Blocked'], [
    [`student.one@${ALLOWED_DOMAIN}`, 'Sample Student One', 'Section A', false],
    [`student.two@${ALLOWED_DOMAIN}`, 'Sample Student Two', 'Section A', false],
    [`student.three@${ALLOWED_DOMAIN}`, 'Sample Student Three', 'Section B', false],
  ], [280, 240, 160, 80]);
  su.sh.getRange('C2:C2000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(SHEETS.sections).getRange('A2:A200'), true).setAllowInvalid(true).build());
  su.sh.getRange('D2:D2000').insertCheckboxes();
  su.sh.getRange('D1').setNote('Tick to stop this student from opening the exam.');
  su.sh.getRange('A1').setNote(`Must be an @${ALLOWED_DOMAIN} Google account.`);

  // Results and Log (filled automatically)
  make(SHEETS.results, ['Email', 'Name', 'Section', 'Status', 'Score', 'Total', 'Times left page', 'Seconds away', 'Away now', 'Started', 'Submitted', 'How submitted', 'Answers'],
    [], [240, 200, 130, 100, 60, 60, 110, 100, 90, 150, 150, 260, 400]);
  make(SHEETS.log, ['Time', 'Email', 'Name', 'Section', 'Event', 'Detail'], [], [160, 240, 200, 130, 170, 260]);
  ss.getSheetByName(SHEETS.results).getRange('J:K').setNumberFormat('mmm d, h:mm:ss am/pm');
  ss.getSheetByName(SHEETS.log).getRange('A:A').setNumberFormat('mmm d, h:mm:ss am/pm');

  const stray = ss.getSheetByName('Sheet1');
  if (stray && stray.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(stray);

  // Results trigger
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'syncResults')) {
    ScriptApp.newTrigger('syncResults').timeBased().everyMinutes(1).create();
  }
  ensureQuestionIds_();
  CacheService.getScriptCache().remove(CFG_CACHE_KEY);
  syncResults(true);
  ss.getSheetByName(SHEETS.settings).activate();
  SpreadsheetApp.getUi().alert('Setup complete', 'Edit the Settings, Questions, Sections and Students sheets. Then deploy the web app (see the setup guide) and use Exam > Show the exam link.', SpreadsheetApp.getUi().ButtonSet.OK);
}
