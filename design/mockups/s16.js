// ---------- TODAY, compact: one sortable list of everything to do ----------
const TCOLS = '70px minmax(0,2.2fr) minmax(0,1.4fr) 56px 98px 104px 72px 52px 74px 88px 122px';
const T = [
  ['Send', 'hot', 'TR', 'Senior Product Manager, Tax Workflows', 'Thomson Reuters', 'Toronto', 'Hybrid', 'Full-time', '$142k–$165k', 88, 94, '18 min', '4', 'Twice', ['Open and fill', 1], ['Read']],
  ['Send', 'hot', 'K', 'Manager, Tax Technology', 'KPMG Canada', 'Toronto', 'Hybrid', 'Full-time', '$120k–$140k', 84, 91, '2 h', '27', '', ['Open and fill', 1], ['Read']],
  ['Send', 'hot', 'S', 'Senior Program Manager, Finance Transformation', 'Scotiabank', 'Toronto', 'On site', 'Full-time', 'Not named', 79, 86, '5 h', '60+', 'Once', ['Open and fill', 1], ['Read']],
  ['Send', 'hot', 'B', 'Business Transformation Lead', 'Bank of Montreal', 'Toronto', 'Hybrid', 'Contract, 12 mo', '$85–$95 an hour', 80, 88, '6 days', '60+', '', ['Open and fill', 1], ['Read']],
  ['Prepare', 'blue', 'W', 'Group Product Manager, Tax Filing', 'Wealthsimple', 'Toronto', 'Remote', 'Full-time', '$165k–$190k', 81, 0, '41 min', '9', '', ['Prepare', 1], ['Look']],
  ['Prepare', 'blue', 'D', 'Senior Manager, Indirect Tax Technology', 'Deloitte', 'Mississauga', 'Hybrid', 'Full-time', '$130k–$155k', 77, 0, '1 day', '38', 'Once', ['Prepare', 1], ['Look']],
  ['Prepare', 'blue', 'M', 'Product Owner, Revenue Systems', 'Manulife', 'Toronto', 'Hybrid', 'Full-time', '$110k–$128k', 68, 0, '2 days', '51', '', ['Prepare', 1], ['Look']],
  ['Prepare', 'blue', 'R', 'Tax Analyst, Part-time', 'Royal Bank of Canada', 'Toronto', 'On site', 'Part-time', '$38 an hour', 54, 0, '3 days', '12', '', ['Prepare', 1], ['Look']],
  ['Reply', 'info', 'I', 'Program Manager, Payments', 'Interac', 'Toronto', 'Hybrid', 'Full-time', '$125k–$145k', 86, 92, '12 days', '—', '', ['Read the reply', 1], ['Draft answer']],
  ['Interview', 'info', 'I', 'Program Manager, Payments', 'Interac', 'Tue 10:00', 'Video', 'Full-time', '$125k–$145k', 86, 92, '12 days', '—', '', ['Open prep', 1], ['Calendar']],
  ['Follow up', 'warn', 'R', 'Senior Program Manager, Change', 'Royal Bank of Canada', 'Toronto', 'Hybrid', 'Full-time', '$135k–$150k', 83, 89, '9 days', '—', 'Once', ['Read the draft', 1], ['Later']],
  ['Follow up', 'warn', 'M', 'Director, Finance Systems', 'Manulife', 'Toronto', 'Hybrid', 'Full-time', 'Not named', 76, 84, '11 days', '—', '', ['Read the draft', 1], ['Later']],
  ['Write to', 'good', 'TR', 'Priya Nair, recruiter', 'Thomson Reuters', 'Toronto', '', '', '', 0, 0, '9 Nov', '', '', ['Write a note', 1], ['Profile']],
  ['Write to', 'good', 'D', 'Daniel Okafor, made the same move', 'Deloitte', 'Toronto', '', '', '', 0, 0, '', '', '', ['Write a note', 1], ['Profile']],
  ['Question', 'crit', '', 'Can you legally work in Canada? Every form asks.', '', '', '', '', '', 0, 0, '', '', '', ['Answer']],
];
S.push(shell('today', 'Today', 'Tuesday 24 November', `<div class="body" style="grid-template-rows:auto auto 1fr auto;gap:8px;padding:10px 18px 22px">
<div class="card row" style="padding:7px 14px;gap:22px">${[['4', 'ready to send', 'var(--hot)'], ['4', 'to prepare', 'var(--accent)'], ['1', 'reply', ''], ['1', 'interview Tue', ''], ['2', 'follow-ups due', ''], ['2', 'people to write to', '']].map(x => `<div class="row" style="gap:5px"><b style="font-size:16px;color:${x[2] || 'var(--ink)'}">${x[0]}</b><span class="s m">${x[1]}</span></div>`).join('')}<span class="grow"></span><span class="s m">This week: 6 applied, 4 within a day of posting · 1 in conversation</span></div>

<div class="row" style="gap:6px">${[['Everything 15', 1], ['Send 4'], ['Prepare 4'], ['Replies 1'], ['Interviews 1'], ['Follow up 2'], ['People 2'], ['Questions 1']].map(x => `<span style="height:26px;display:inline-flex;align-items:center;padding:0 10px;border-radius:7px;font-size:12px;font-weight:600;white-space:nowrap;${x[1] ? 'background:var(--accent);color:#fff' : 'background:#fff;border:1px solid var(--line)'}">${x[0]}</span>`).join('')}<span class="grow"></span>${['Where: any', 'Type: any', 'Pay: any', 'Fit: any', 'Posted: any'].map(x => `<span style="height:26px;display:inline-flex;align-items:center;padding:0 9px;border-radius:7px;font-size:12px;white-space:nowrap;background:#fff;border:1px solid var(--line)">${x} <span class="m" style="margin-left:4px">▾</span></span>`).join('')}</div>

<div class="card" style="padding:0;overflow:hidden;align-self:start">
 ${head(TCOLS, ['To do', 'Role', 'Employer', 'Where', 'Type', 'Pay', 'Fit ▾', 'Posted', 'Applicants', 'Applied here', ''])}
 ${T.map((r, i) => `<div style="display:grid;grid-template-columns:${TCOLS};gap:8px;padding:4px 14px;border-bottom:1px solid var(--line2);align-items:center;height:34px;white-space:nowrap" class="s">
  <span>${tag(r[0], TAG[r[1]])}</span>
  <b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r[3]}</b>
  <span class="row" style="gap:7px;min-width:0">${r[2] ? pic(r[2], 22) : ''}<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r[4]}${r[5] && r[4] ? ` <span class="xs m">· ${r[5]}</span>` : ''}</span></span>
  <span>${r[6]}</span><span>${r[7]}</span><span>${r[8]}</span>
  <span>${r[9] ? fitPair(r[9], r[10]) : ''}</span><span>${r[11]}</span><span>${r[12]}</span><span>${r[13] ? tag(r[13], TAG.info) : ''}</span>
  <span class="row" style="gap:5px;justify-content:flex-end">${sbtn(r[14][0], 1)}<span class="m" style="padding:0 2px;font-weight:700">⋯</span></span></div>`).join('')}
 <div class="row xs m" style="padding:5px 14px">1 to 15 of 15 · 20 on a page<span class="grow"></span>A row opens the role · ⋯ has: Read what's sent · Not for me · I applied · Never show this employer</div></div>

<div class="card row s" style="padding:6px 14px;gap:10px"><b>While you were away</b><span class="m">Found 6 new roles, set 41 aside · prepared 2 applications · added 8 employers that hire people like you · drafted 2 follow-ups</span><span class="grow"></span>${sbtn('See all')}</div>
</div>`, WORKING));
