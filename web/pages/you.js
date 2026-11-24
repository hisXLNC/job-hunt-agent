import { html, api, post, put, del, ago, when, toast, copy } from '../app.js';
import { oldCard, oldActions } from '../old.js';

const TABS = [['', 'About you'], ['arriving', 'Arriving'], ['connections', 'Connections'], ['panel', 'Browser side panel'], ['app', 'The app and debugging']];
const lines = s => (s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
const WORK = { '': 'Not said yet', citizen: 'Yes, as a citizen', resident: 'Yes, as a permanent resident', permit: 'Yes, on a work permit', none: 'Not yet' };

function about(d) {
  const p = d.profile;
  d.cvs ||= []; d.facts ||= []; d.answers ||= []; p.titles ||= {};
  return html`<div class="cols wide"><div class="col" style="gap:14px">
    <form data-act="saveprofile" class="card col" style="gap:12px"><h3>You</h3>
      <div class="grid2"><label class="field">Name<input type="text" name="name" value="${p.name}"></label><label class="field">How you describe yourself<input type="text" name="headline" value="${p.headline}"></label></div>
      <label class="field">The one thing few other applicants have <span class="h">Job Hunt leads with this.</span><input type="text" name="rare" value="${p.rare}"></label>
      <div class="grid3"><label class="field">City you want to work in<input type="text" name="city" value="${p.city}"></label><label class="field">Country<input type="text" name="country" value="${p.country}"></label><label class="field">Where you live now<input type="text" name="home" value="${p.home}"></label></div>
      <label class="field">Nearby places that also count <span class="h">${d.area?.length ? html`${p.city} already includes ${d.area.join(', ')}. Add any others here, comma-separated.` : 'Other towns you would work in. Comma-separated.'}</span><input type="text" name="places" value="${(p.places || []).join(', ')}" placeholder="${d.area?.length ? 'Hamilton, Guelph' : ''}"></label>
      <div class="grid3"><label class="field">You arrive on <span class="h">Leave empty if you are there.</span><input type="date" name="arrive_on" value="${p.arrive_on}"></label>
        <label class="field">Allowed to work there on arrival<select name="work_status">${Object.entries(WORK).map(([k, v]) => html`<option value="${k}" ${p.work_status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field">Lowest yearly salary<input type="number" name="pay_floor" value="${p.pay_floor || ''}" placeholder="No floor"></label></div>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="start_early" ${p.start_early ? 'checked' : ''}> Open to starting remotely before you arrive</label>
      <div class="hr"></div><h3>What to look for</h3><p class="s m">One title per line. All three groups are searched equally often.</p>
      <div class="grid3"><label class="field">At your level<textarea name="level" rows="4">${(p.titles.level || []).join('\n')}</textarea></label><label class="field">A step up<textarea name="step_up" rows="4">${(p.titles.step_up || []).join('\n')}</textarea></label><label class="field">Sideways<textarea name="sideways" rows="4">${(p.titles.sideways || []).join('\n')}</textarea></label></div>
      <div class="grid2"><label class="field">Words that mark your field <span class="h">A title with one of these is always read. Comma-separated.</span><input type="text" name="domain" value="${(p.domain || []).join(', ')}"></label>
        <label class="field">Never show <span class="h">Titles or employers. Comma-separated.</span><input type="text" name="avoid" value="${(p.avoid || []).join(', ')}"></label></div>
      <div class="row wrap" style="gap:16px"><span class="s" style="font-weight:600">Ways of working:</span>${['remote', 'hybrid', 'onsite'].map(w => html`<label class="row s" style="gap:5px"><input type="checkbox" name="wp_${w}" ${!p.workplaces?.length || p.workplaces.includes(w) ? 'checked' : ''}> ${w === 'onsite' ? 'On site' : w[0].toUpperCase() + w.slice(1)}</label>`)}</div>
      <label class="field" style="max-width:420px">When a strong role appears<select name="may_prepare"><option value="do" ${p.may_prepare !== 'ask' ? 'selected' : ''}>Write the CV and letter straight away</option><option value="ask" ${p.may_prepare === 'ask' ? 'selected' : ''}>Ask me before writing anything</option></select></label>
      <p class="xs m">Job Hunt never submits an application or sends a message. That is always you.</p>
      <div class="row"><button class="btn p">Save</button></div></form>
  </div>
  <div class="col" style="gap:14px">
    <div class="card"><h4>Your CVs</h4><div class="col" style="margin-top:10px;gap:10px">${d.cvs.map(c => html`<div class="row"><div class="grow"><b class="s">${c.name}</b><div class="xs m">${c.filename} · added ${ago(c.created_at)}</div></div><a class="btn sm" href="/api/cvs/${c.id}/file">Download</a>${d.cvs.length > 1 ? html`<button class="btn sm ghost danger" data-act="delcv" data-id="${c.id}" data-confirm="Remove this CV?">Remove</button>` : ''}</div>`)}</div>
      <label class="btn sm" style="margin-top:10px">Add another CV<input type="file" accept=".docx,.pdf,.txt,.md" hidden data-on="change" data-act="addcv"></label><p class="xs m" style="margin-top:6px">Word or PDF. Reading it takes about a minute.</p></div>
    <div class="card"><h4>What Job Hunt knows about you</h4><p class="xs m" style="margin-top:3px">Facts beyond your CV. Used wherever they help, never invented.</p>
      <div class="col s" style="margin-top:8px;gap:6px">${d.facts.map(f => html`<div class="row top-al"><span class="grow">${f.text}</span><button class="btn sm ghost" data-act="delfact" data-id="${f.id}" aria-label="Forget this">Forget</button></div>`)}</div>
      <form data-act="addfact" class="row" style="margin-top:8px;gap:6px"><input type="text" name="text" placeholder="I am a CPA in good standing" aria-label="A fact about you"><button class="btn sm">Add</button></form></div>
    <div class="card"><h4>Answers saved for forms</h4><p class="xs m" style="margin-top:3px">Asked once, reused on every application.</p>
      <div class="col s" style="margin-top:8px;gap:8px">${d.answers.map(a => html`<div class="row top-al"><div class="grow"><b>${a.question}</b><div class="ink2">${a.answer}</div></div><button class="btn sm ghost" data-act="delanswer" data-id="${a.id}">Remove</button></div>`)}${!d.answers.length ? html`<span class="m">None yet.</span>` : ''}</div></div>
  </div></div>`;
}

function arriving(d) {
  if (!d.has) return html`<div class="card empty"><h3>${d.building ? 'Writing your arrival pack' : 'Arriving in ' + (d.profile.city || 'a new country')}</h3>
    <p style="max-width:560px;margin:0 auto">Employers discount what they don't recognise: foreign employers, titles, currencies, rules. This pack closes that gap honestly: your CV in the local form, your experience restated in their terms, and ready answers to the questions newcomers get.</p>
    <p style="margin-top:14px">${d.building ? html`<span class="spin" style="display:inline-block"></span>` : html`<button class="btn p" data-act="build">Write my arrival pack</button>`}</p></div>`;
  const doc = d.doc, on = doc.changes.filter(c => !c.off).length;
  return html`<div class="cols wide"><div class="col" style="gap:14px">
    <div class="card col" style="gap:12px"><div class="row"><div class="grow"><div class="eb">Your CV in ${d.profile.country || 'local'} form</div><h3 style="margin-top:4px">${on} of ${doc.changes.length} changes on. The facts stay the same.</h3></div>
      ${doc.applied ? html`<span class="chip good">Copy made</span>` : ''}<button class="btn ${doc.applied ? '' : 'p'}" data-act="apply">${doc.applied ? 'Make a fresh copy' : 'Make a copy of my CV with these'}</button></div>
      ${doc.changes.map((c, i) => html`<div class="row top-al" style="gap:12px;${c.off ? 'opacity:.55' : ''}"><button class="switch ${c.off ? '' : 'on'}" role="switch" aria-checked="${c.off ? 'false' : 'true'}" aria-label="Use this change" data-act="toggle" data-i="${i}" data-off="${c.off ? '' : '1'}"></button>
        <div class="grow s">${c.before ? html`<div><span class="del">${c.before}</span></div>` : ''}<div><span class="ins">${c.after}</span></div><div class="xs m">${c.why}</div></div></div>`)}
      <p class="xs m">Your original CV is kept. The copy is used for roles in ${d.profile.country || 'the new country'} from then on.</p></div>
    <div class="card" style="padding:0"><div style="padding:14px 16px 8px"><div class="eb">Your experience, in their terms</div></div><table class="tbl"><thead><tr><th>On your CV</th><th>What a recruiter there recognises</th></tr></thead><tbody>
      ${(doc.terms || []).map(t => html`<tr><td class="s" style="width:40%"><b>${t.yours}</b></td><td class="s"><b style="color:var(--accent)">${t.theirs}</b><div class="xs m">${t.why}</div></td></tr>`)}</tbody></table></div>
  </div>
  <div class="col" style="gap:14px"><div class="card"><div class="row"><h4 class="grow">Questions newcomers get</h4><button class="btn sm ghost" data-act="build" data-confirm="Write the whole pack again? Your switches are reset.">Write again</button></div><p class="xs m" style="margin-top:3px">Ready answers. Fill the [gaps] only you know.</p>
    <div class="col" style="margin-top:10px;gap:12px">${(doc.screening || []).map(q => html`<div class="s"><b>${q.q}</b><div class="ink2 quote" style="margin-top:3px">${q.a}</div></div>`)}</div></div></div></div>`;
}

function connections(d) {
  const cl = d.claude, ph = d.phone, m = d.mail, ext = d.ext;
  const usage = Object.entries(d.usage || {}).sort((a, b) => b[1].calls - a[1].calls);
  return html`<div class="grid2" style="align-items:start">
    <div class="col" style="gap:14px">
    <form data-act="savellm" class="card col" style="gap:10px"><div class="row"><h3 class="grow">Claude</h3><span class="chip ${cl.engine && cl.ok ? 'good' : 'warn'}">${cl.engine ? (cl.ok ? 'Connected' : 'Resting') : 'Not connected'}</span></div>
      <p class="s m">Claude does the reading and writing. ${cl.note && !cl.ok ? html`<b style="color:var(--warn)">${cl.note}</b>` : ''}</p>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="claude-code" ${cl.engine === 'claude-code' ? 'checked' : ''} ${d.cli_found ? '' : 'disabled'}> <span><b>Your Claude subscription</b> through Claude Code<br><span class="m">${d.cli_found ? 'Found on this computer. Uses the plan you already pay for.' : 'Claude Code isn\'t installed on this computer. Install it from claude.com/claude-code and sign in.'}</span></span></label>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="api" ${cl.engine === 'api' ? 'checked' : ''}> <span><b>An API key</b><br><span class="m">Pay for what you use. A day of searching costs a few dollars.</span></span></label>
      <div class="grid2" style="padding-left:24px"><label class="field">API key<input type="password" name="key" placeholder="${cl.has_key ? 'Saved. Paste to replace.' : 'sk-ant-…'}" autocomplete="off"></label><label class="field">Stop at this much a day (USD)<input type="number" name="daily_limit" value="${cl.limit || ''}" placeholder="No limit" step="0.5" min="0"></label></div>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="demo" ${cl.engine === 'demo' ? 'checked' : ''}> <span><b>Sample answers</b><br><span class="m">No Claude. For looking around; the writing is crude.</span></span></label>
      <label class="field" style="max-width:340px">Model<select name="model">${d.models.map(x => html`<option value="${x.ID}" ${cl.model === x.ID ? 'selected' : ''}>${x.Name}: ${x.Note}</option>`)}</select></label>
      <div class="row"><button class="btn p">Save</button><button type="button" class="btn" data-act="testllm" data-busy="Asking Claude…">Test it</button><span class="grow"></span><span class="xs m">${cl.calls} calls today${cl.engine === 'api' ? html` · $${cl.today.toFixed(2)} today · $${cl.week.toFixed(2)} this week` : ''}</span></div>
      ${usage.length ? html`<details><summary class="s">What Claude was used for this week</summary><table class="tbl" style="margin-top:6px"><tbody>${usage.map(([k, u]) => html`<tr><td class="s">${k.replace(/_/g, ' ')}</td><td class="s">${u.calls} calls</td><td class="s">${u.cost ? '$' + u.cost.toFixed(2) : ''}</td><td class="s m">${u.errors ? u.errors + ' failed' : ''}</td></tr>`)}</tbody></table></details>` : ''}</form>
    <div class="card row"><span class="s grow">The browser side panel has its own page.</span><a class="btn sm" href="#/you/panel">Browser side panel</a></div>
    </div>
    <div class="col" style="gap:14px">
    <form data-act="savephone" class="card col" style="gap:10px"><div class="row"><h3 class="grow">Phone notices</h3><span class="chip ${ph.on ? 'good' : ''}">${ph.on ? 'On' : 'Off'}</span></div>
      <p class="s m">A buzz when a strong role is still fresh, so you can apply inside the first hour. Uses the free ntfy app: install it, subscribe to the topic below, done. The notice carries the job title and employer and passes through ntfy's server.</p>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${ph.on ? 'checked' : ''}> Send notices to my phone</label>
      <div class="grid2"><label class="field">Topic <span class="h">Works like a password. Make it long.</span><input type="text" name="topic" value="${ph.topic}" placeholder="jobhunt-…"></label><label class="field">Server<input type="url" name="server" value="${ph.server}"></label></div>
      <div class="grid3"><label class="field">Only for fit at or above<input type="number" name="min_fit" value="${ph.min_fit}" min="50" max="100"></label><label class="field">Quiet from (hour)<input type="number" name="quiet_from" value="${ph.quiet_from}" min="0" max="23"></label><label class="field">Until (hour)<input type="number" name="quiet_to" value="${ph.quiet_to}" min="0" max="23"></label></div>
      <div class="row"><button class="btn p">Save</button><button type="button" class="btn" data-act="newtopic">Make a topic for me</button><button type="button" class="btn" data-act="testphone">Send a test</button></div></form>
    <form data-act="savemail" data-busy="Checking…" class="card col" style="gap:10px"><div class="row"><h3 class="grow">Your inbox</h3><span class="chip ${m.on ? (m.note ? 'crit' : 'good') : ''}">${m.on ? (m.note ? 'Problem' : 'Connected') : 'Off'}</span></div>
      <p class="s m">So replies are noticed the moment they arrive. Job Hunt opens the inbox read-only and reads only mail from employers you applied to, hiring systems, and people you wrote to. It cannot send, move or delete anything. Mail it does read is passed to Claude to be understood.</p>
      ${m.note ? html`<p class="s" style="color:var(--crit)">${m.note}</p>` : ''}
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${m.on ? 'checked' : ''}> Watch my inbox for replies</label>
      <div class="grid2"><label class="field">Address<input type="email" name="user" value="${m.user}" autocomplete="off"></label><label class="field">App password <span class="h">Not your normal password.</span><input type="password" name="pass" placeholder="${d.mail_has_pass ? 'Saved. Paste to replace.' : '16 letters'}" autocomplete="off"></label></div>
      <label class="field" style="max-width:260px">Mail server<input type="text" name="host" value="${m.host}"></label>
      <p class="xs m">Gmail: Google Account → Security → 2-Step Verification → App passwords. The password is kept only in Job Hunt's data file on this computer.</p>
      <div class="row"><button class="btn p">Save and check</button>${m.last_at ? html`<span class="xs m">Last read ${ago(m.last_at)}</span>` : ''}</div></form>
    </div></div>`;
}

function panel(d) {
  const ext = d.ext;
  const addr = (name, a) => html`<span class="row" style="gap:6px"><code class="s" style="background:var(--s2);padding:3px 7px;border-radius:6px">${a}</code><button type="button" class="btn sm" data-act="copytext" data-text="${a}" title="Copies the address. Paste it into the address bar of ${name}; a page cannot open it for you.">Copy</button></span>`;
  return html`<div class="grid2" style="align-items:start"><div class="card col" style="gap:10px"><div class="row"><h3 class="grow">Browser side panel</h3><span class="chip ${ext.paired_at ? 'good' : ''}">${ext.paired_at ? 'Connected' : 'Not connected'}</span></div>
      <p class="s m">Sits beside a posting or an application form in Chrome or Edge: shows your fit, attaches your documents and fills in answers. You read the form and press Submit yourself; the side panel never does.</p>
      ${d.ext_pending ? html`<div class="card" style="border-color:var(--accent);background:var(--accent-soft)"><p class="s"><b>A side panel is asking to connect.</b> It shows the code <b style="font-size:16px;letter-spacing:.08em">${d.ext_pending}</b>. Approve only if the Job Hunt side panel in your browser shows the same code.</p><div class="row" style="margin-top:8px"><button class="btn p sm" data-act="pair">Approve</button></div></div>` : ''}
      ${ext.paired_at ? html`<div class="row"><span class="xs m grow">Connected ${ago(ext.paired_at)} · code ${ext.code}</span><button class="btn sm" data-act="unpair">Disconnect</button></div>` : ''}</div>
    <div class="card col" style="gap:12px"><h3>${ext.paired_at ? 'Putting it in another browser' : 'Getting it'}</h3>
      <div class="s"><b>1. Have the folder.</b> ${d.ext_dir ? html`It came with Job Hunt and is already on this computer:<div class="row" style="gap:6px;margin-top:5px;flex-wrap:wrap"><code class="s" style="background:var(--s2);padding:3px 7px;border-radius:6px;word-break:break-all">${d.ext_dir}</code><button type="button" class="btn sm" data-act="copytext" data-text="${d.ext_dir}">Copy</button><button type="button" class="btn sm" data-act="openfolder" data-what="extension">Open the folder</button></div><div class="xs m" style="margin-top:5px">Or <a href="/extension.zip" download>download it as a zip</a> for another computer.</div>` : html`<div class="row" style="margin-top:5px"><a class="btn p" href="/extension.zip" download>Download the side panel</a></div><div class="xs m" style="margin-top:5px">Unpack the zip somewhere it can stay, such as Documents. The browser reads it from there every time.</div>`}</div>
      <div class="s"><b>2. Open your browser's extensions page.</b><div class="row" style="gap:14px;margin-top:5px;flex-wrap:wrap">${addr('Chrome', 'chrome://extensions')}${addr('Edge', 'edge://extensions')}</div></div>
      <div class="s"><b>3. Switch on "Developer mode"</b>, press <b>Load unpacked</b> and pick the folder from step 1.</div>
      <div class="s"><b>4. Open the side panel</b> by pressing the Job Hunt icon in the browser's toolbar (pin it from the puzzle-piece menu). It shows a code.</div>
      <div class="s"><b>5. Come back to this page</b> and press Approve when the same code appears here.</div>
      <p class="xs m">After a Job Hunt update, press the round-arrow "Reload" on the extensions page so the side panel is the new version too.</p></div></div>`;
}

function theApp(d) {
  return html`<div class="grid2" style="align-items:start"><div class="col" style="gap:14px">
    <div class="card col" style="gap:8px"><h3>Job Hunt ${d.version}</h3>${d.update ? html`<p class="s" style="background:var(--accent-soft);padding:8px 10px;border-radius:8px"><b>Version ${d.update.version} is ready.</b> <a href="${d.update.url}">Download the installer</a> and run it: Job Hunt restarts on the new version and your data stays.</p>` : ''}<p class="s m">Everything is kept in one folder on this computer:</p><code class="s" style="background:var(--s2);padding:6px 9px;border-radius:7px;word-break:break-all">${d.dir}</code>
      <p class="s m">A copy is saved there every day and the last seven are kept. Job Hunt keeps searching while its window is closed; start it again from the Start menu to bring the window back.</p>
      <div class="row"><button class="btn" data-act="backup">Save a copy now</button><span class="grow"></span><button class="btn danger" data-act="quit" data-confirm="Stop Job Hunt? Searching stops until you start it again.">Stop Job Hunt</button></div></div>
    ${d.old ? oldCard(d.old, false) : ''}
    ${d.problems?.length ? html`<div class="card"><h4>Recent problems</h4><div class="col s" style="margin-top:10px;gap:8px">${d.problems.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${ago(a.at)}</span><span>${a.text}</span></div>`)}</div></div>` : ''}
    ${d.debug ? html`<div class="card col" style="gap:8px"><div class="row"><h4 class="grow">Debugging</h4><button class="btn sm p" data-act="copydebug" title="Copies the report below so you can paste it when reporting a problem. It leaves out your name, e-mail addresses and keys.">Copy debug details</button><a class="btn sm" href="/api/debug/report" download title="Saves a longer report (the newest 4,000 lines) as a text file.">Save as a file</a><button class="btn sm" data-act="openfolder" data-what="data" title="Opens the folder that holds your data and debug.log.">Open the folder</button></div>
      <p class="xs m">Job Hunt writes down everything it does: each search and page it fetches, each call to Claude, each background job, each error in the program or in a page. Your name, e-mail addresses and keys are left out. The file is debug.log in your data folder.</p>
      <pre class="xs" style="margin:0;background:var(--s2);border-radius:8px;padding:9px 10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;line-height:1.45">${d.debug.report.split('\n').slice(-45).join('\n')}</pre>
      <p class="xs m">The newest 45 lines. Copy or save for the rest.</p></div>` : ''}
  </div><div class="col" style="gap:14px">
    <div class="card"><h4>Claude, lately</h4><p class="xs m" style="margin-top:3px">${d.today.calls} calls in the last day, ${d.week.calls} this week${d.week.cost ? html` · $${d.week.cost.toFixed(2)}` : ''}${d.week.errors ? html` · ${d.week.errors} failed` : ''}</p>
      <table class="tbl" style="margin-top:8px"><tbody>${(d.calls || []).map(c => html`<tr><td class="xs m" style="white-space:nowrap">${when(c.at)}</td><td class="s">${c.task.replace(/_/g, ' ')}</td><td class="xs m">${(c.ms / 1000).toFixed(1)} s</td><td class="xs" style="color:var(--crit)">${c.error ? c.error.slice(0, 80) : ''}</td></tr>`)}</tbody></table></div>
    ${d.changes?.length ? html`<div class="card"><h4>Changes Job Hunt made to your settings</h4><div class="col s" style="margin-top:10px;gap:8px">${d.changes.map(c => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${ago(c.at)}</span><span class="grow">${c.what} <span class="m">· ${c.why}</span></span></div>`)}</div></div>` : ''}
  </div></div>`;
}

export default {
  title: 'Settings',
  sub: (d, route) => ({ '': 'What Job Hunt knows and looks for', arriving: 'Closing the gap for a newcomer', connections: 'Claude, your phone, your inbox', panel: 'Get it, put it in your browser, connect it', app: 'Version, your data, and what Job Hunt has been doing' })[route.parts[1] || ''],
  topics: ['you', 'profile', 'connections'],
  load(route) {
    switch (route.parts[1] || '') {
      case 'arriving': return api('arriving');
      case 'connections': case 'panel': return api('connections');
      case 'app': return Promise.all([api('app'), api('import/old').catch(() => null), api('debug').catch(() => null)]).then(([a, o, g]) => ({ ...a, old: o, debug: g }));
    }
    return api('you');
  },
  view(d, route) {
    const tab = route.parts[1] || '';
    return html`<div class="body"><div class="tabs">${TABS.map(([k, v]) => html`<a class="${k === tab ? 'on' : ''}" href="#/you${k ? '/' + k : ''}">${v}</a>`)}</div>
      ${tab === 'arriving' ? arriving(d) : tab === 'connections' ? connections(d) : tab === 'panel' ? panel(d) : tab === 'app' ? theApp(d) : about(d)}</div>`;
  },
  actions: {
    ...oldActions,
    async saveprofile({ f }) {
      const wp = ['remote', 'hybrid', 'onsite'].filter(w => f['wp_' + w]);
      await put('profile', { name: f.name, headline: f.headline, rare: f.rare, city: f.city, places: lines(f.places), country: f.country, home: f.home, arrive_on: f.arrive_on, work_status: f.work_status, pay_floor: +f.pay_floor || 0,
        start_early: !!f.start_early, titles: { level: lines(f.level), step_up: lines(f.step_up), sideways: lines(f.sideways) }, domain: lines(f.domain), avoid: lines(f.avoid), workplaces: wp.length === 3 ? [] : wp, may_prepare: f.may_prepare });
      toast('Saved. The next search uses this.');
    },
    async addcv({ el }) { const file = el.files[0]; if (!file) return false; toast('Reading your CV. About a minute.'); await api('cvs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file }); toast('CV added'); },
    delcv: ({ d }) => del(`cvs/${d.id}`),
    addfact: ({ f, el }) => post('facts', { text: f.text }).then(() => el.reset()),
    delfact: ({ d }) => del(`facts/${d.id}`),
    delanswer: ({ d }) => del(`answers/${d.id}`),
    build: () => post('arriving').then(() => toast('Writing your arrival pack. About a minute.')),
    toggle: ({ d }) => post('arriving/change', { index: +d.i, off: !!d.off }),
    apply: () => post('arriving/apply').then(() => toast('A copy of your CV in local form was added under Settings')),
    async savellm({ f }) {
      if (!f.engine) throw new Error('Choose how to reach Claude.');
      await put('llm', { engine: f.engine, key: f.key || '', model: f.model, daily_limit: +f.daily_limit || 0 });
      toast('Saved');
    },
    async testllm() { const r = await post('llm/test'); toast(r.message); return false; },
    savephone: ({ f }) => put('phone', { on: !!f.on, topic: f.topic, server: f.server, min_fit: +f.min_fit || 75, quiet_from: +f.quiet_from || 0, quiet_to: +f.quiet_to || 0 }).then(() => toast('Saved')),
    newtopic({ el }) { const a = new Uint8Array(12); crypto.getRandomValues(a); el.closest('form').querySelector('[name=topic]').value = 'jobhunt-' + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); return false; },
    async testphone() { await post('phone/test'); toast('Sent. It should arrive on your phone in a few seconds.'); return false; },
    savemail: ({ f }) => put('mailset', { on: !!f.on, user: f.user, pass: f.pass || '', host: f.host }).then(() => toast(f.on ? 'Connected. Job Hunt is reading recent replies.' : 'Saved')),
    copytext: ({ d }) => copy(d.text).then(() => false),
    copydebug: () => api('debug').then(g => copy(g.report)).then(() => false),
    openfolder: ({ d }) => post('open-folder', { what: d.what }).then(() => false),
    pair: () => post('ext/pair').then(() => toast('The side panel is connected')),
    unpair: () => post('ext/unpair'),
    async backup() { const r = await post('backup'); toast('Saved to ' + r.path); return false; },
    async quit() { await post('quit'); document.body.innerHTML = '<div class="setup"><div class="card empty"><h3>Job Hunt has stopped</h3><p>Start it again from the Start menu.</p></div></div>'; return false; },
  },
};
