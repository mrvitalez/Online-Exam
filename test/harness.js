// Local test harness: runs apps-script/*.gs against strict in-memory fakes of the Google services and
// serves Admin.html / Student.html with a fake google.script.run. Not used by the real deployment.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'apps-script');

// Only methods that really exist in Apps Script are allowed, so a misspelled name fails here, not in Google.
const strict = (base = {}, chainable = []) => {
  const p = new Proxy(base, { get: (t, k) => {
    if (k in t) return t[k];
    if (chainable.includes(k)) return () => p;
    if (typeof k === 'symbol' || k === 'then' || k === 'toJSON' || k === 'inspect') return undefined;
    throw new TypeError(`${String(k)} is not a function (not a known Apps Script method in the test fakes)`);
  } });
  return p;
};
const RANGE_FORMAT = ['setFontWeight', 'setBackground', 'setNumberFormat', 'setWrap'];
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const display = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  cell(r, c) { const v = (this.data[r - 1] || [])[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // a leading apostrophe means "text"
    if (typeof v === 'string' && v.startsWith('=')) throw new Error('A formula was written into ' + this.name);
    row[c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() { for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '' && v != null)) return r; return 0; }
  getLastColumn() { return Math.max(0, ...this.data.map((row) => { for (let c = row.length; c > 0; c--) if (row[c - 1] !== '') return c; return 0; })); }
  getRange(a, b, nr = 1, nc = 1) {
    if (typeof a === 'string') {
      const [s, e] = a.split(':'); const m1 = s.match(/([A-Z]+)(\d*)/), m2 = (e || s).match(/([A-Z]+)(\d*)/);
      const r1 = Number(m1[2] || 1), r2 = Number(m2[2] || 1000);
      return this.range(r1, colNum(m1[1]), r2 - r1 + 1, colNum(m2[1]) - colNum(m1[1]) + 1);
    }
    if (nr < 1 || nc < 1) throw new Error('The number of rows/columns in the range must be at least 1');
    return this.range(a, b, nr, nc);
  }
  getDataRange() { return this.range(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  range(r, c, nr, nc) {
    const sh = this;
    const vals = () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.cell(r + i, c + j)));
    const self = strict({
      getRow: () => r, getLastRow: () => r + nr - 1,
      getValues: vals, getDisplayValues: () => vals().map((row) => row.map(display)), getValue: () => sh.cell(r, c),
      setValues: (v) => { if (v.length !== nr || v[0].length !== nc) throw new Error(`setValues size mismatch on ${sh.name}: ${v.length}x${v[0].length} into ${nr}x${nc}`); v.forEach((row, i) => row.forEach((x, j) => sh.set(r + i, c + j, x))); return self; },
      setValue: (v) => { sh.set(r, c, v); return self; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.set(r + i, c + j, ''); return self; },
      createTextFinder: (text) => {
        let whole = false;
        const tf = strict({
          matchEntireCell: (on) => { whole = on; return tf; },
          findNext: () => {
            for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
              const v = display(sh.cell(r + i, c + j));
              if (whole ? v === text : v.includes(text)) return strict({ getRow: () => r + i });
            }
            return null;
          },
        });
        return tf;
      },
    }, RANGE_FORMAT);
    return self;
  }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, j) => this.set(r, j + 1, v)); return this; }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setName(n) { this.name = n; return this; }
  setFrozenRows() {}
}
function makeBook(name) {
  const sheets = [];
  return strict({
    _sheets: sheets,
    getName: () => name,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets, deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/EXAMBOOK/edit',
    setSpreadsheetTimeZone() {}, toast() {},
  });
}
const ss = makeBook('Online Exams');
ss.insertSheet('Sheet1');
// tabs of the first (one-sheet) version, to check that setup moves them aside
ss.insertSheet('Settings').getRange(1, 1, 2, 3).setValues([['Setting', 'Value', 'Notes'], ['Exam title', 'Old quiz', '']]);
ss.insertSheet('Questions').getRange(1, 1, 2, 4).setValues([['Type', 'Question', 'Points', 'Correct answer'], ['Multiple choice', 'Old question', 1, 'B']]);
const books = {};
const store = new Map();
const cache = new Map();
let currentEmail = '';
const triggers = [{ getHandlerFunction: () => 'syncResults' }]; // left over from the first version
let clock = 0; // ms added to the real clock, to test time limits
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + clock); }
  static now() { return RealDate.now() + clock; }
}
const MANILA = 8 * 3600000;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDate(d, tz, fmt) {
  const m = new RealDate(d.getTime() + MANILA);
  const Y = m.getUTCFullYear(), M = m.getUTCMonth(), D = m.getUTCDate(), h = m.getUTCHours(), mi = m.getUTCMinutes();
  if (fmt === "yyyy-MM-dd'T'HH:mm") return `${Y}-${pad(M + 1)}-${pad(D)}T${pad(h)}:${pad(mi)}`;
  if (fmt === "MMMM d, yyyy 'at' h:mm a") return `${MONTHS[M]} ${D}, ${Y} at ${h % 12 || 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`;
  throw new Error('Unsupported date format in fake: ' + fmt);
}
function parseDate(t, tz, fmt) {
  if (fmt !== "yyyy-MM-dd'T'HH:mm") throw new Error('Unsupported parse format in fake: ' + fmt);
  const [d, hm] = t.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
  return new FakeDate(RealDate.UTC(Y, M - 1, D, h, mi) - MANILA);
}

const ctx = vm.createContext({
  console, JSON, Math, Object, String, Number, Array, RegExp, Error, TypeError, isFinite, isNaN, parseFloat, Date: FakeDate,
  SpreadsheetApp: strict({
    getActiveSpreadsheet: () => ss,
    openById: (id) => { if (!books[id]) throw new Error('not found'); return books[id]; },
    getUi: () => strict({}, ['createMenu', 'addItem', 'addToUi']),
  }),
  PropertiesService: strict({ getScriptProperties: () => strict({
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too big: ' + k); store.set(k, String(v)); },
    getKeys: () => [...store.keys()], deleteProperty: (k) => store.delete(k),
  }) }),
  CacheService: strict({ getScriptCache: () => strict({
    get: (k) => (cache.has(k) ? cache.get(k) : null),
    put: (k, v) => { if (v.length > 100000) throw new Error('cache value too big'); cache.set(k, v); },
    remove: (k) => cache.delete(k), removeAll: (ks) => ks.forEach((k) => cache.delete(k)),
  }) }),
  LockService: strict({ getScriptLock: () => strict({ waitLock() {}, tryLock: () => true, releaseLock() {} }) }),
  Session: strict({ getActiveUser: () => strict({ getEmail: () => currentEmail }) }),
  Utilities: strict({ getUuid: () => crypto.randomUUID(), formatDate, parseDate }),
  ScriptApp: strict({
    getProjectTriggers: () => triggers, deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1), newTrigger: () => strict({}, ['timeBased', 'everyMinutes', 'create']),
    getService: () => strict({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
  }),
});
for (const f of ['MathExpr.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });

const ADMIN = 'rmvitalez@rtu.edu.ph';
function as(email, fn) { const prev = currentEmail; currentEmail = email; try { return fn(); } finally { currentEmail = prev; } }

const shim = (email) => `<script>
function runner(s, f) { return new Proxy({}, { get(_, k) {
  if (k === 'withSuccessHandler') return (h) => runner(h, f);
  if (k === 'withFailureHandler') return (h) => runner(s, h);
  return (...args) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: k, args, as: ${JSON.stringify(email)} }) }).then((r) => r.json())
    .then((d) => d.thrown ? f && f(new Error(d.thrown)) : s && s(d.result));
} }); }
window.google = { script: { get run() { return runner(); } } };
</script>`;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/rpc') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const { fn, args, as: email } = JSON.parse(body);
      let out;
      try {
        if (fn.endsWith('_') || typeof ctx[fn] !== 'function') throw new Error('Script function not found: ' + fn);
        out = { result: JSON.parse(JSON.stringify(as(email, () => ctx[fn](...args)) ?? null)) };
      } catch (e) { out = { thrown: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  const email = url.searchParams.get('as') || '';
  const page = url.searchParams.get('page') === 'admin' ? 'Admin' : 'Student';
  let boot;
  if (page === 'Admin') boot = { email, url: 'https://script.google.com/a/macros/rtu.edu.ph/s/TEST/exec', sheetUrl: ss.getUrl(), pagesUrl: 'https://mrvitalez.github.io/Online-Exam/' };
  else {
    boot = { email, url: '', admin: as(email, () => ctx.isAdmin_(email)), logo: '' };
    try { boot.home = as(email, () => JSON.parse(JSON.stringify(ctx.api_home()))); } catch (e) { boot.error = e.message; }
  }
  const html = read('Styles.html') + read(page + '.html').replace('<?!= boot ?>', JSON.stringify(boot).replace(/</g, '\\u003c'))
    .replace('<body', shim(email) + '<body')
    .replace(/<script defer src="https:\/\/cdn\.jsdelivr\.net[^"]+"><\/script>/, ''); // no internet needed for tests
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta charset="utf-8"></head>' + html + '</html>');
});

module.exports = { triggers, server, ctx, ss, store, cache, books, makeBook, as, ADMIN, setClock: (ms) => { clock = ms; } };
