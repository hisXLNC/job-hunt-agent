const { chromium } = require('playwright');
(async () => {
  const scale = +(process.argv[2] || 1);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + __dirname + '/index.html'); await p.waitForTimeout(400);
  const ids = await p.$$eval('.screen', a => a.map(x => x.id));
  // anything spilling out of its screen
  const spill = await p.$$eval('.screen', a => a.map(s => { const r = s.getBoundingClientRect(); let worst = 0, what = ''; for (const e of s.querySelectorAll('.card,.btn,.body')) { const q = e.getBoundingClientRect(); const d = Math.max(q.bottom - r.bottom, q.right - r.right); if (d > worst) { worst = d; what = (e.textContent || '').trim().slice(0, 40); } } return s.id + ':' + Math.round(worst) + (worst > 0 ? ' ' + what : ''); }));
  let i = 0; for (const id of ids) { i++; await (await p.$('#' + id)).screenshot({ path: `${__dirname}/${scale > 1 ? 'out' : 'chk'}-${i}-${id}.png` }); }
  console.log(ids.join(' '), '\n', spill.join('\n '), '\n', errs);
  await b.close();
})();
