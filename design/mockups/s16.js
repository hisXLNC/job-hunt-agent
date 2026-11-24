// ---------- TODAY, compact: one sortable list of everything to do ----------
const star = v => (v ? `<span style="color:#B7791F;font-weight:650;white-space:nowrap" title="Employees rate it ${v} out of 5">★ ${v}</span>` : '');
const TCOLS = '70px minmax(0,1fr) 58px 104px 112px 72px 54px 74px 196px 112px';
// kind, colour, picture, title, employer, rating, place, where, type, pay, fit, tailored, posted, applicants, worth knowing [text, colour], button
const T = [
  ['Send', 'hot', 'TR', 'Senior Product Manager, Tax Workflows', 'Thomson Reuters', '3.9', 'Toronto', 'Hybrid', 'Full-time', '$142k–$165k', 88, 94, '18 min', '4', [['Applied here twice', 'info'], ['5 min form', '']], 'Open and fill'],
  ['Send', 'hot', 'K', 'Manager, Tax Technology', 'KPMG Canada', '3.8', 'Toronto', 'Hybrid', 'Full-time', '$120k–$140k', 84, 91, '2 h', '27', [['Closes Fri', 'warn']], 'Open and fill'],
  ['Send', 'hot', 'S', 'Senior Program Manager, Finance Transformation', 'Scotiabank', '3.7', 'Toronto', 'On site', 'Full-time', 'Not named', 79, 86, '5 h', '60+', [['Applied here once', 'info']], 'Open and fill'],
  ['Send', 'hot', 'B', 'Business Transformation Lead', 'Bank of Montreal', '3.9', 'Toronto', 'Hybrid', 'Contract, 12 mo', '$85–$95 an hour', 80, 88, '6 days', '60+', [['Posted 3 times', 'warn']], 'Open and fill'],
  ['Prepare', 'blue', 'W', 'Group Product Manager, Tax Filing', 'Wealthsimple', '4.1', 'Toronto', 'Remote', 'Full-time', '$165k–$190k', 81, 0, '41 min', '9', [['A step up', '']], 'Prepare'],
  ['Prepare', 'blue', 'D', 'Senior Manager, Indirect Tax Technology', 'Deloitte', '3.9', 'Mississauga', 'Hybrid', 'Full-time', '$130k–$155k', 77, 0, '1 day', '38', [['Applied here once', 'info'], ['Asks for CPA', 'warn']], 'Prepare'],
  ['Prepare', 'blue', 'M', 'Product Owner, Revenue Systems', 'Manulife', '3.8', 'Toronto', 'Hybrid', 'Full-time', '$110k–$128k', 68, 0, '2 days', '51', [['Under your pay floor', 'crit']], 'Prepare'],
  ['Prepare', 'blue', 'R', 'Tax Analyst', 'Royal Bank of Canada', '4.0', 'Toronto', 'On site', 'Part-time', '$38 an hour', 54, 0, '3 days', '12', [['Part-time', 'warn'], ['A step down', 'crit']], 'Prepare'],
  ['Reply', 'info', 'I', 'Program Manager, Payments', 'Interac', '4.2', 'Toronto', 'Hybrid', 'Full-time', '$125k–$145k', 86, 92, '12 days', '—', [['They wrote 40 min ago', 'info']], 'Read the reply'],
  ['Interview', 'info', 'I', 'Program Manager, Payments', 'Interac', '4.2', 'Tue 10:00, video', 'Hybrid', 'Full-time', '$125k–$145k', 86, 92, '12 days', '—', [['Prep pack ready', 'good']], 'Open prep'],
  ['Follow up', 'warn', 'R', 'Senior Program Manager, Change', 'Royal Bank of Canada', '4.0', 'Toronto', 'Hybrid', 'Full-time', '$135k–$150k', 83, 89, '9 days', '—', [['Applied 9 days ago', '']], 'Read the draft'],
  ['Follow up', 'warn', 'M', 'Director, Finance Systems', 'Manulife', '3.8', 'Toronto', 'Hybrid', 'Full-time', 'Not named', 76, 84, '11 days', '—', [['Applied 11 days ago', '']], 'Read the draft'],
  ['Write to', 'good', 'TR', 'Priya Nair, recruiter', 'Thomson Reuters', '3.9', 'Toronto', '', '', '', 0, 0, '', '', [['Wrote to you 9 Nov', 'info']], 'Write a note'],
  ['Question', 'crit', '', 'Can you legally work in Canada? Every form asks.', '', '', '', '', '', '', 0, 0, '', '', [['Left blank on forms until you say', '']], 'Answer'],
];
S.push(shell('today', 'Today', 'Tuesday 24 November', `<div class="body" style="grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto 1fr auto;gap:8px;padding:10px 18px 22px">
<div class="card row" style="padding:7px 14px;gap:22px">${[['4', 'ready to send', 'var(--hot)'], ['4', 'to prepare', 'var(--accent)'], ['1', 'reply', ''], ['1', 'interview Tue', ''], ['2', 'follow-ups due', ''], ['1', 'person to write to', '']].map(x => `<div class="row" style="gap:5px"><b style="font-size:16px;color:${x[2] || 'var(--ink)'}">${x[0]}</b><span class="s m">${x[1]}</span></div>`).join('')}<span class="grow"></span><span class="s m">This week: 6 applied, 4 within a day of posting · 1 in conversation</span></div>

<div class="row" style="gap:6px">${[['Everything 14', 1], ['Send 4'], ['Prepare 4'], ['Replies 1'], ['Interviews 1'], ['Follow up 2'], ['People 1'], ['Questions 1']].map(x => `<span style="height:26px;display:inline-flex;align-items:center;padding:0 10px;border-radius:7px;font-size:12px;font-weight:600;white-space:nowrap;${x[1] ? 'background:var(--accent);color:#fff' : 'background:#fff;border:1px solid var(--line)'}">${x[0]}</span>`).join('')}<span class="grow"></span>${['Where', 'Type', 'Pay', 'Rating', 'Fit', 'Posted'].map(x => `<span style="height:26px;display:inline-flex;align-items:center;padding:0 9px;border-radius:7px;font-size:12px;white-space:nowrap;background:#fff;border:1px solid var(--line)">${x} <span class="m" style="margin-left:4px">▾</span></span>`).join('')}</div>

<div class="card" style="padding:0;overflow:hidden;align-self:start">
 ${head(TCOLS, ['To do', 'Role · Employer · Rating', 'Where', 'Type', 'Pay', 'Fit ▾', 'Posted', 'Applicants', 'Worth knowing', ''])}
 ${T.map(r => `<div style="display:grid;grid-template-columns:${TCOLS};gap:8px;padding:0 14px;border-bottom:1px solid var(--line2);align-items:center;height:43px;white-space:nowrap" class="s">
  <span>${tag(r[0], TAG[r[1]])}</span>
  <span class="row" style="gap:9px;min-width:0">${r[2] ? pic(r[2], 28) : '<span style="width:28px;flex:none"></span>'}<span style="min-width:0;line-height:1.3"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${r[3]}</b>${r[4] ? `<span class="xs" style="color:var(--ink2)">${r[4]} ${star(r[5])} <span class="m">· ${r[6]}</span></span>` : ''}</span></span>
  <span>${r[7]}</span><span>${r[8]}</span><span>${r[9]}</span>
  <span>${r[10] ? fitPair(r[10], r[11]) : ''}</span><span>${r[12]}</span><span>${r[13]}</span>
  <span class="row" style="gap:4px;overflow:hidden">${r[14].map(t => tag(t[0], TAG[t[1]])).join('')}</span>
  <span class="row" style="gap:5px;justify-content:flex-end">${sbtn(r[15], 1)}<span class="m" style="padding:0 2px;font-weight:700">⋯</span></span></div>`).join('')}
 <div class="row xs m" style="padding:5px 14px">1 to 14 of 14 · 20 on a page<span class="grow"></span>A row opens the role · the employer's name opens the employer · ⋯ has: Read what's sent · Not for me · I applied · Never show this employer</div></div>

<div class="card row s" style="padding:6px 14px;gap:10px"><b>While you were away</b><span class="m">Found 6 new roles, set 41 aside · prepared 2 applications · added 8 employers that hire people like you · drafted 2 follow-ups</span><span class="grow"></span>${sbtn('See all')}</div>
</div>`, WORKING));
