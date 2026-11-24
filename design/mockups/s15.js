// ---------- Shared by the compact screens ----------
// Fit numbers are coloured by how good they are, never all one colour.
const fitCol = v => (v >= 85 ? '#0B7A3B' : v >= 75 ? '#2F4FC4' : v >= 65 ? '#8F5B00' : '#B42D2D');
const fitPair = (a, b) => `<span style="display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:13px"><span style="color:${fitCol(a)}">${a}</span><span class="xs m" style="font-weight:400">→</span><span style="color:${b ? fitCol(b) : 'var(--muted)'}">${b || '–'}</span></span>`;
// The picture is the employer's own, taken from their website. These stand-ins are drawn for the design.
const MARKS = {
  TR: s => `${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<circle cx="${20 + 13 * Math.cos(i * Math.PI / 4)}" cy="${20 + 13 * Math.sin(i * Math.PI / 4)}" r="${i % 2 ? 2.2 : 3.4}" fill="#D64000"/>`).join('')}<circle cx="20" cy="20" r="4.5" fill="#D64000"/>`,
  W: () => `<path d="M6 12l7 18 7-13 7 13 7-18" fill="none" stroke="#111" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`,
  K: () => `<rect x="5" y="9" width="30" height="22" fill="#00338D"/><path d="M12 14v12M12 20l7-6M12 20l7 6M24 14v12M28 14v12" stroke="#fff" stroke-width="2.4"/>`,
  I: () => `<rect x="4" y="6" width="32" height="28" rx="5" fill="#F5A800"/><path d="M14 13v14M20 27V17l8 10V13" stroke="#1b1b1b" stroke-width="3" fill="none"/>`,
  R: () => `<rect x="5" y="5" width="30" height="30" rx="4" fill="#005DAA"/><path d="M12 30l8-20 8 20" stroke="#FFD200" stroke-width="4" fill="none"/>`,
  B: () => `<circle cx="20" cy="20" r="15" fill="#0079C1"/><path d="M11 26l5-11 4 8 4-8 5 11" stroke="#fff" stroke-width="3" fill="none"/>`,
  S: () => `<circle cx="20" cy="20" r="15" fill="#EC111A"/><path d="M26 14c-8-4-12 3-6 6s3 9-6 6" stroke="#fff" stroke-width="3" fill="none"/>`,
  D: () => `<circle cx="14" cy="20" r="10" fill="#111"/><circle cx="31" cy="27" r="4" fill="#86BC25"/>`,
  M: () => `<rect x="5" y="5" width="30" height="30" fill="#00A758"/><path d="M11 29V12M17 29V12M23 29V12M29 29V12" stroke="#fff" stroke-width="3"/>`,
};
const pic = (k, size) => `<span style="width:${size}px;height:${size}px;border-radius:${Math.round(size / 4.5)}px;background:#fff;border:1px solid var(--line);display:inline-grid;place-items:center;flex:none"><svg width="${size * .72}" height="${size * .72}" viewBox="0 0 40 40">${MARKS[k]()}</svg></span>`;
const tag = (t, c) => `<span style="font-size:11px;font-weight:600;border-radius:5px;padding:1px 6px;white-space:nowrap;${c || 'background:var(--s2);color:var(--ink2);border:1px solid var(--line2)'}">${t}</span>`;
const TAG = { hot: 'background:var(--hot-soft);color:var(--hot)', good: 'background:var(--good-soft);color:var(--good)', blue: 'background:var(--accent-soft);color:var(--accent)', info: 'background:var(--info-soft);color:var(--info)', warn: 'background:var(--warn-soft);color:var(--warn)', crit: 'background:var(--crit-soft);color:var(--crit)' };
const sbtn = (t, p) => `<span style="display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap;${p ? 'background:var(--accent);color:#fff' : 'border:1px solid var(--line);background:#fff'}">${t}</span>`;
const head = (cols, names) => `<div style="display:grid;grid-template-columns:${cols};gap:8px;white-space:nowrap;padding:6px 14px;background:var(--s2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)" class="eb">${names.map(n => `<span>${n}</span>`).join('')}</div>`;

// ---------- EMPLOYER (one company's page) ----------
const ECOLS = 'minmax(0,1fr) 150px 70px 110px 120px 76px 60px 78px 150px';
// What Job Hunt is doing now, always with a bar and a way to stop it.
const WORKING = `<span style="font-weight:600">Searching</span> 14 of 61 sources<span class="bar" style="width:90px;height:6px"><i style="width:23%"></i></span><span style="font-weight:600;color:var(--crit)">Stop</span>`;
const EOPEN = [['Senior Product Manager, Tax Workflows', 'Tax &amp; Accounting', 'Hybrid', 'Full-time', '$142k–$165k', 88, 94, '18 min', '4', 'Ready to send', 'good'],
  ['Product Manager, Indirect Tax (ONESOURCE)', 'Corporates', 'Hybrid', 'Full-time', '$128k–$150k', 82, 90, '3 days', '31', 'Applied 21 Nov', ''],
  ['Program Manager, Finance Transformation', 'Finance', 'On site', 'Contract, 12 mo', '$70–$85 an hour', 74, 83, '6 days', '60+', 'Worth a look', 'blue'],
  ['Senior Analyst, Tax Data', 'Tax &amp; Accounting', 'Hybrid', 'Full-time', '$98k–$115k', 79, 86, '3 Nov', '—', 'They said no 18 Nov', 'crit'],
  ['Product Owner, Tax Content', 'Tax &amp; Accounting', 'Remote', 'Full-time', 'Not named', 71, 0, '14 Oct', '—', 'Taken down', '']];
S.push(shell('roles', 'Thomson Reuters', 'Employer', `<div class="body" style="grid-template-columns:1.45fr 1fr;grid-template-rows:auto auto 1fr;gap:10px;padding:12px 18px 22px">
<div class="card row" style="grid-column:1/3;gap:12px;padding:9px 14px">${pic('TR', 44)}
 <div class="grow" style="min-width:0"><div class="row" style="gap:8px"><h3 style="font-size:17px;white-space:nowrap">Thomson Reuters</h3>${tag('Watching', TAG.good)}<span style="color:#B7791F;font-weight:700;font-size:14px;white-space:nowrap">★ 3.9</span><span class="xs m" style="white-space:nowrap">4,210 employee reviews</span></div>
  <div class="xs m" style="margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Information services · Toronto · about 26,000 people · thomsonreuters.com · pays $98k to $165k</div></div>
 <div class="row" style="gap:14px;margin-right:6px;white-space:nowrap">${[['3', 'open for you'], ['2', 'applications'], ['1', 'interview'], ['3', 'people']].map(x => `<div class="row" style="gap:5px"><b style="font-size:16px">${x[0]}</b><span class="xs m">${x[1]}</span></div>`).join('')}</div>
 ${sbtn('Their careers page ↗')}${sbtn('Stop watching')}${sbtn('<span style="color:var(--crit)">Never show</span>')}</div>

<div class="card" style="padding:0;overflow:hidden;grid-column:1/3">
  <div class="row" style="padding:8px 14px;gap:6px"><h4 class="grow">Postings</h4>${tag('All 15', TAG.blue)}${tag('Open 3')}${tag('Applied 2')}${tag('Earlier 10')}<span class="xs m" style="margin-left:6px">Where: any ▾ · Type: any ▾</span></div>
  ${head(ECOLS, ['Role', 'Part of the company', 'Where', 'Type', 'Pay', 'Fit ▾', 'Posted', 'Applicants', 'Where it stands'])}
  ${EOPEN.map(r => `<div style="display:grid;grid-template-columns:${ECOLS};gap:8px;padding:5px 14px;border-bottom:1px solid var(--line2);align-items:center;white-space:nowrap" class="s"><b style="overflow:hidden;text-overflow:ellipsis">${r[0]}</b><span>${r[1]}</span><span>${r[2]}</span><span>${r[3]}</span><span>${r[4]}</span>${fitPair(r[5], r[6])}<span>${r[7]}</span><span>${r[8]}</span><span>${tag(r[9], TAG[r[10]])}</span></div>`).join('')}
  <div class="row xs m" style="padding:5px 14px">1 to 5 of 15<span class="grow"></span>‹ 1 2 3 ›</div></div>

<div class="col" style="gap:10px;min-height:0">
 <div class="card" style="padding:0;overflow:hidden"><div class="row" style="padding:8px 14px"><h4 class="grow">Your history here</h4><span class="xs m">2 applications · 1 interview · first contact 3 Nov</span></div>
  ${[['21 Nov', 'Applied', '', 'Product Manager, Indirect Tax (ONESOURCE)', 'CV "Tax technology", tailored · letter sent · follow up 28 Nov'],
    ['18 Nov', 'They said no', 'crit', 'Senior Analyst, Tax Data', '"Moved ahead with an internal candidate"'],
    ['12 Nov', 'Interview', 'info', 'Senior Analyst, Tax Data', 'First call with Priya Nair, 30 min · your notes are saved'],
    ['9 Nov', 'Message', 'blue', 'Priya Nair wrote to you', '"Thanks for applying, are you free Thursday…"']].map(x => `<div style="display:grid;grid-template-columns:50px 96px 1fr 1.25fr;gap:10px;padding:5px 14px;border-top:1px solid var(--line2);align-items:center" class="s"><span class="xs m">${x[0]}</span><span>${tag(x[1], TAG[x[2]])}</span><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x[3]}</b><span class="xs m" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${x[4]}</span></div>`).join('')}</div>

 <div class="card" style="padding:0;overflow:hidden"><div class="row" style="padding:8px 14px"><h4 class="grow">People here</h4>${sbtn('Find more people here')}</div>
  ${[['Priya Nair', 'Recruiter', 'Recruiter', 'Wrote to you 9 Nov', 'Write a note'], ['Daniel Okafor', 'Director, Tax Product', 'Made the same move', 'Big Four to product, 2021', 'Write a note'], ['Sofia Lindqvist', 'Senior PM, ONESOURCE', 'Shares your roots', 'Relocated to Toronto in 2023', 'Note drafted']].map(p => `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 136px minmax(0,1.5fr) 96px;gap:8px;padding:5px 14px;border-top:1px solid var(--line2);align-items:center;white-space:nowrap;overflow:hidden" class="s"><b>${p[0]}</b><span>${p[1]}</span><span>${tag(p[2])}</span><span class="xs m">${p[3]}</span><span style="justify-self:end">${sbtn(p[4])}</span></div>`).join('')}</div>
 <div class="card col" style="gap:5px;padding:10px 14px"><h4>Your notes</h4><div class="s m" style="border:1px solid var(--line);border-radius:7px;padding:6px 9px;background:var(--s2);min-height:48px">Priya said the ONESOURCE team is growing in the new year…</div></div>
</div>

<div class="col" style="gap:10px;min-height:0">
 <div class="card col" style="gap:5px;padding:10px 14px"><div class="row"><h4 class="grow">About</h4><span class="xs m">from their site and postings · 22 Nov</span></div>
  <p class="s" style="color:var(--ink2)">Sells software and information to tax, legal, accounting and news professionals. The Toronto office builds much of the tax product line.</p>
  <div class="s"><b>Tax &amp; Accounting Professionals</b> <span class="m">Tax preparation and audit software for accounting firms.</span></div>
  <div class="s"><b>Corporates (ONESOURCE)</b> <span class="m">Indirect tax software for large companies.</span></div></div>

 <div class="card col" style="gap:6px;padding:10px 14px"><div class="row"><h4 class="grow">What working there is like</h4>${sbtn('Look again')}</div>
  <div class="row" style="gap:6px">${tag('Glassdoor 3.9 of 5 ↗')}${tag('Indeed 3.8 of 5 ↗')}${tag('Blind ↗')}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" class="s">
   <div><b style="color:var(--good)">People like</b><div style="color:var(--ink2)">Hybrid, two days in the office<br>Steady work, good benefits<br>Kind, experienced colleagues</div></div>
   <div><b style="color:var(--warn)">People warn about</b><div style="color:var(--ink2)">Slow decisions, many layers<br>Reorganisations most years<br>Pay rises below market</div></div></div>
  <div class="xs m">Claude's summary of public employee reviews, read 22 Nov.</div></div>

 <div class="card col" style="gap:4px;padding:10px 14px"><h4>Lately</h4>
  ${[['19 Nov', '4 new product roles this week']].map(x => `<div class="row s" style="align-items:flex-start;gap:8px"><span class="xs m" style="width:40px;padding-top:1px">${x[0]}</span><span class="grow">${x[1]}</span></div>`).join('')}</div>

</div></div>`, WORKING));
