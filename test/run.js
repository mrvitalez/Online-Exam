// Browser test of the student flow against the local harness.
const { chromium } = require('playwright');
const { server, ctx, ss } = require('./harness');
const out = process.argv[2] || __dirname;

const hide = (p, hidden) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);

(async () => {
  await new Promise((r) => server.listen(4100, r));
  const b = await chromium.launch();
  const ctxB = await b.newContext({ viewport: { width: 900, height: 900 } });
  const errors = [];
  const open = async (email) => { const p = await ctxB.newPage(); p.on('pageerror', (e) => errors.push(e.message)); await p.goto('http://localhost:4100/?as=' + encodeURIComponent(email)); await p.waitForTimeout(300); return p; };
  const msg = async (p) => (await p.textContent('#wBody')).replace(/\s+/g, ' ').trim();

  console.log('gmail:      ', await msg(await open('someone@gmail.com')));
  console.log('look-alike: ', await msg(await open('someone@fakertu.edu.ph')));
  console.log('not listed: ', await msg(await open('stranger@rtu.edu.ph')));
  console.log('closed sec: ', await msg(await open('student.three@rtu.edu.ph')));
  ss.getSheetByName('Students').getRange(3, 4).setValue(true); ctx.onEdit({}); // block student.two
  console.log('blocked:    ', await msg(await open('student.two@rtu.edu.ph')));

  // student one: answer, leave, paste, then get auto-submitted
  const p = await open('Student.One@rtu.edu.ph'.toLowerCase());
  await p.screenshot({ path: out + '/welcome.png' });
  await p.click('#startBtn'); await p.waitForTimeout(400);
  await p.click('text=Mercury');
  await p.fill('.q input[type=text]', 'h2o');
  await hide(p, true); await p.waitForTimeout(300); await hide(p, false); await p.waitForTimeout(400);
  console.log('warning 1:  ', await p.textContent('#ovText'));
  await p.screenshot({ path: out + '/warning.png' });
  await p.click('#ovBtn');
  await p.evaluate(() => document.dispatchEvent(new Event('paste', { cancelable: true })));
  await hide(p, true); await p.waitForTimeout(300); await hide(p, false); await p.waitForTimeout(400);
  console.log('warning 2:  ', await p.textContent('#ovText'));
  await p.click('#ovBtn');
  await hide(p, true); await p.waitForTimeout(400);
  console.log('3rd leave:  ', (await p.textContent('#done')).replace(/\s+/g, ' ').trim());
  console.log('reopen:     ', await msg(await open('student.one@rtu.edu.ph')));

  // student four: normal submit with score shown
  const q = await open('student.four@rtu.edu.ph');
  await q.click('#startBtn'); await q.waitForTimeout(400);
  await q.click('text=Mercury'); await q.click('text=Oxygen'); await q.fill('.q input[type=text]', ' H2O ');
  await q.click('#submitBtn'); await q.click('#ovBtn'); await q.waitForTimeout(400);
  console.log('student 4:  ', (await q.textContent('#done')).replace(/\s+/g, ' ').trim());
  await q.screenshot({ path: out + '/done.png' });

  ctx.syncResults(true);
  console.log('\nRESULTS sheet:'); ss.getSheetByName('Results').data.slice(0, 6).forEach((r) => console.log(' ', r.map((v) => (v instanceof Date ? 'date' : v)).join(' | ')));
  console.log('\nLOG sheet:'); ss.getSheetByName('Log').data.slice(1).forEach((r) => console.log(' ', r.slice(1).join(' | ')));
  console.log('\npage errors:', errors);
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
