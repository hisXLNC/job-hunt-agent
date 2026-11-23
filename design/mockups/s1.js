// ---------- TODAY ----------
const act = (n, kind, cls, title, meta, extra, right) => `<div class="card row" style="gap:16px;padding:20px 20px;align-items:stretch">
  <div style="width:30px;height:30px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700;flex:none;margin-top:2px">${n}</div>
  <div class="grow col" style="gap:6px"><div class="row" style="gap:8px"><span class="chip ${cls}">${kind}</span>${meta}</div><h3 style="font-size:16.5px">${title}</h3>${extra}</div>${right}</div>`;
S.push(shell('today','Today','Sunday 22 November',`<div class="body" style="grid-template-columns:1fr 338px">
<div class="col" style="gap:14px;justify-content:space-between">
  <div class="card" style="padding:22px 22px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center">
    <div><div class="eb">Your search, week 6</div><h2 style="margin-top:6px">Three things today move you closest to an interview.</h2><p class="m" style="margin-top:6px">Ranked by how much each is likely to help. Everything else can wait, and Job Hunt keeps working on it.</p></div>
    <div class="row" style="gap:0">${[['46','Applied',''],['7','Replies','15%'],['3','Interviews',''],['0','Offers','']].map((x,i)=>`<div style="text-align:center;padding:0 16px;${i?'border-left:1px solid var(--line2)':''}"><div style="font:700 26px 'Inter Display';letter-spacing:-.02em">${x[0]}</div><div class="xs m">${x[1]}${x[2]?` · <b style="color:var(--good)">${x[2]}</b>`:''}</div></div>`).join('')}</div>
  </div>
  ${act(1,'Apply now','hot','Senior Product Manager, Tax Workflows <span class="m" style="font-weight:500">· Thomson Reuters</span>',
    '<span class="s m">Posted <b style="color:var(--hot)">18 min ago</b> · <b style="color:var(--hot)">4 applicants</b> · Toronto, hybrid</span>',
    `<p class="s" style="color:var(--ink2)">Your <b>Tax CV</b> and a cover letter are ready. The form has 14 questions; Job Hunt knows 12 of the answers. About 4 minutes.</p>`,
    `<div class="row" style="gap:16px">${rings(88,94)}<div class="col" style="gap:6px"><div class="btn p">Open and fill the form</div><div class="btn sm">Read what's sent</div></div></div>`)}
  ${act(2,'Reply','blue','A recruiter at Interac wants a call <span class="m" style="font-weight:500">· Program Manager, Payments</span>',
    '<span class="s m">Her email came 2 h ago · a person wrote to you: nothing else today is as warm</span>',
    `<p class="s" style="color:var(--ink2);border-left:3px solid var(--line);padding-left:10px">“Are you free Tuesday or Wednesday for 30 minutes?” Draft ready: offers <b>Tue 10:00</b> or <b>Wed 14:30</b>, both free in your calendar.</p>`,
    `<div class="col" style="gap:6px;justify-content:center"><div class="btn p">Read and send</div><div class="btn sm">Other times</div></div>`)}
  ${act(3,'Follow up','warn','No word from RBC in 8 days <span class="m" style="font-weight:500">· Senior Program Manager, Change</span>',
    '<span class="s m">Applied 14 Nov · posting still open · the recruiter is known</span>',
    `<p class="s" style="color:var(--ink2)">A four-line note that points to the one thing on your CV closest to the role. To the recruiter's <b>likely address</b> (RBC writes them first.last@).</p>`,
    `<div class="col" style="gap:6px;justify-content:center"><div class="btn p">Read and send</div><div class="btn sm">Not this one</div></div>`)}
  <div class="card row" style="padding:12px 18px;gap:18px"><span class="eb">After these</span><span class="s"><b>6</b> more roles are ready to apply</span><span class="s m">·</span><span class="s"><b>3</b> follow-ups fall due this week</span><span class="s m">·</span><span class="s"><b>1</b> thank-you note</span><span class="grow"></span><span class="btn ghost sm">Show them all</span></div>
</div>
<div class="col" style="gap:14px">
  <div class="card"><div class="row"><h4>Job Hunt needs two answers</h4><span class="chip warn" style="margin-left:auto">2</span></div>
    <p class="s" style="margin-top:10px"><b>Terraform</b> is in 9 postings you fit. Where did you use it?</p><div style="height:34px;border:1px solid var(--line);border-radius:8px;margin-top:6px;padding:7px 10px" class="s m">At the Ministry, for…</div>
    <p class="s" style="margin-top:12px">Is <b>$120k</b> still your floor for contract roles?</p><div class="row" style="margin-top:6px;gap:6px"><span class="btn sm">Yes</span><span class="btn sm">Lower for 6+ months</span><span class="btn sm">Skip</span></div></div>
  <div class="card"><h4>Coming up</h4>
    <div class="row" style="margin-top:10px;align-items:flex-start"><div style="width:44px;text-align:center;background:var(--accent-soft);border-radius:8px;padding:5px 0;color:var(--accent)"><div class="xs" style="font-weight:700">TUE</div><div style="font-weight:700;font-size:16px;line-height:1">24</div></div><div class="grow"><b class="s">Interview, Interac · 10:00</b><div class="xs m">Prep pack ready: 9 likely questions, your 5 stories, who you'll meet.</div></div></div>
    <div class="row" style="margin-top:10px;align-items:flex-start"><div style="width:44px;text-align:center;background:var(--warn-soft);border-radius:8px;padding:5px 0;color:var(--warn)"><div class="xs" style="font-weight:700">FRI</div><div style="font-weight:700;font-size:16px;line-height:1">27</div></div><div class="grow"><b class="s">BMO posting closes</b><div class="xs m">Business Transformation Lead. Ready, not sent.</div></div></div></div>
  <div class="card" style="flex:1"><h4>Since you last looked</h4><div class="col s" style="margin-top:10px;gap:9px">
    ${[['14:13','Tailored <b>Thomson Reuters</b> 4 min after it was posted'],['13:40','Found the recruiter for <b>RBC</b> and her likely address'],['12:05','Scored 31 new postings; 3 cleared your bar'],['09:20','Set aside 2 roles reposted by the same employer'],['06:40','Morning search: 418 postings read']].map(x=>`<div class="row" style="align-items:flex-start;gap:10px"><span class="xs m" style="width:36px;flex:none;padding-top:1px">${x[0]}</span><span>${x[1]}</span></div>`).join('')}</div></div>
</div></div>`));
