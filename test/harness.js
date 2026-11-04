// Local test harness: runs Code.gs against in-memory fakes of the Google services
// and serves Index.html with a fake google.script.run, so the real code can be
// exercised in a browser. Not needed for the real deployment.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

const chainProxy = (base = {}) => {
  const p = new Proxy(base, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : () => p) });
  return p;
};

function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  cell(r, c) { return (this.data[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); const row = this.data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getName() { return this.name; }
  getLastRow() { for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '' && v != null)) return r; return 0; }
  getLastColumn() { return Math.max(0, ...this.data.map((row) => { for (let c = row.length; c > 0; c--) if (row[c - 1] !== '') return c; return 0; })); }
  getRange(a, b, nr = 1, nc = 1) {
    if (typeof a === 'string') {
      const [s, e] = a.split(':'); const m1 = s.match(/([A-Z]+)(\d*)/), m2 = (e || s).match(/([A-Z]+)(\d*)/);
      const r1 = Number(m1[2] || 1), r2 = Number(m2[2] || 1000);
      return this.range(r1, colNum(m1[1]), r2 - r1 + 1, colNum(m2[1]) - colNum(m1[1]) + 1);
    }
    return this.range(a, b, nr, nc);
  }
  range(r, c, nr, nc) {
    const sh = this;
    const self = chainProxy({
      getRow: () => r, getLastRow: () => r + nr - 1,
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.cell(r + i, c + j))),
      getValue: () => sh.cell(r, c),
      setValues: (vals) => { if (vals.length !== nr || vals[0].length !== nc) throw new Error(`setValues size mismatch on ${sh.name}`); vals.forEach((row, i) => row.forEach((v, j) => sh.set(r + i, c + j, v))); return self; },
      setValue: (v) => { sh.set(r, c, v); return self; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.set(r + i, c + j, ''); return self; },
      insertCheckboxes: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.cell(r + i, c + j) === '') sh.set(r + i, c + j, false); return self; },
    });
    return self;
  }
  activate() {} setFrozenRows() {} setColumnWidth() {}
  copyTo(ss) { const s = ss.insertSheet(this.name + ' copy'); s.data = JSON.parse(JSON.stringify(this.data)); return s; }
  setName(n) { this.name = n; return this; }
}
const sheets = [];
const ss = {
  getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
  insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
  getSheets: () => sheets, deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  getSpreadsheetTimeZone: () => 'Asia/Manila', toast: () => {},
};
const store = new Map();
const cache = new Map();
let currentEmail = '';
const ctx = vm.createContext({
  console, JSON, Date, Math, Object, String, Number, Array,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss, getActive: () => ss, flush() {},
    newDataValidationRule: () => chainProxy(),
    getUi: () => chainProxy({ alert: () => 'OK', ButtonSet: {}, Button: { OK: 'OK' } }),
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too big'); store.set(k, String(v)); },
    setProperties: (o) => Object.entries(o).forEach(([k, v]) => { if (String(v).length > 9000) throw new Error('property too big'); store.set(k, String(v)); }),
    getProperties: () => Object.fromEntries(store), deleteProperty: (k) => store.delete(k),
  }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => currentEmail }) },
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d) => d.toISOString().slice(0, 16) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => chainProxy(), getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/rtu.edu.ph/s/TEST/exec' }) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
ctx.setup();

// test roster: add a blocked-able student and an extra one in Section A
const stu = ss.getSheetByName('Students');
stu.getRange(5, 1, 1, 4).setValues([['student.four@rtu.edu.ph', 'Sample Student Four', 'Section A', false]]);
const settings = ss.getSheetByName('Settings');
settings.getRange(9, 2).setValue(true); // show score
ctx.onEdit({});

const shim = `<script>
const AS = new URLSearchParams(location.search).get('as');
function runner(s, f) { return new Proxy({}, { get(_, k) {
  if (k === 'withSuccessHandler') return (h) => runner(h, f);
  if (k === 'withFailureHandler') return (h) => runner(s, h);
  return (...args) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: k, args, as: AS }) }).then((r) => r.json())
    .then((d) => d.thrown ? f && f(new Error(d.thrown)) : s && s(d.result));
} }); }
window.google = { script: { get run() { return runner(); } } };
</script>`;
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8').replace('<head>', '<head>' + shim);

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/rpc')) {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const { fn, args, as } = JSON.parse(body);
      currentEmail = as || '';
      let out;
      try { out = { result: JSON.parse(JSON.stringify(ctx[fn](...args) ?? null)) }; } catch (e) { out = { thrown: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
});
module.exports = { server, ctx, ss, store, cache };
