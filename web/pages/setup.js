import { html, api, post, put, toast, app } from '../app.js';
import { oldCard, oldActions } from '../old.js';

const lines = s => (s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
const head = (n, title, done, sub) => html`<div class="row"><div class="num" style="${done ? 'background:var(--good-solid);color:#fff' : ''}">${done ? '✓' : n}</div><div class="grow"><h3>${title}</h3>${sub ? html`<p class="s m">${sub}</p>` : ''}</div></div>`;

export default {
  title: 'Welcome',
  sub: () => '',
  topics: ['profile', 'connections', 'you'],
  load: async () => ({ c: await api('connections'), y: await api('you'), o: await api('import/old').catch(() => null) }),
  view({ c, y, o }) {
    const cl = c.claude, p = y.profile, has1 = !!cl.engine, has2 = !!p.city, has3 = y.cvs.length > 0;
    const t = p.titles || {};
    return html`<div class="setup">
      <div><div class="eb">Job Hunt</div><h1 style="font-size:28px;margin-top:6px">Four things, then it works by itself.</h1>
        <p class="m" style="margin-top:6px">It finds roles the hour they are posted, writes your CV and letter for each, and finds the people worth writing to. You read, decide and send. Everything stays on this computer.</p></div>

      ${o?.old?.found || o?.old?.last || o?.old?.busy ? oldCard(o, true) : ''}

      <form data-act="llm" class="card col" style="gap:10px">${head(1, 'Connect Claude', has1, 'Claude does the reading and the writing.')}
        <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="claude-code" ${cl.engine === 'claude-code' || (!cl.engine && c.cli_found) ? 'checked' : ''} ${c.cli_found ? '' : 'disabled'}> <span><b>Use my Claude subscription</b><br><span class="m">${c.cli_found ? 'Claude Code is on this computer. Nothing more to pay.' : 'Needs Claude Code installed and signed in on this computer (claude.com/claude-code). Not found.'}</span></span></label>
        <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="api" ${cl.engine === 'api' || (!cl.engine && !c.cli_found) ? 'checked' : ''}> <span class="grow"><b>Use an API key</b><br><span class="m">From console.anthropic.com. You pay for what is used; a few dollars on a busy day.</span>
          <input type="password" name="key" style="margin-top:6px;max-width:420px" placeholder="${cl.has_key ? 'Saved. Paste to replace.' : 'sk-ant-…'}" autocomplete="off" aria-label="API key"></span></label>
        <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="demo" ${cl.engine === 'demo' ? 'checked' : ''}> <span><b>Just look around</b><br><span class="m">Sample answers instead of Claude. The writing is crude; switch later under You.</span></span></label>
        <div class="row"><button class="btn ${has1 ? '' : 'p'}" data-busy="Checking…">${has1 ? 'Change' : 'Connect'}</button>${has1 ? html`<span class="chip good">Connected</span>` : ''}</div></form>

      <form data-act="where" class="card col" style="gap:10px;${has1 ? '' : 'opacity:.5'}">${head(2, 'Where do you want to work?', has2)}
        <div class="grid3"><label class="field">City<input type="text" name="city" value="${p.city}" placeholder="Toronto" required></label><label class="field">Country<input type="text" name="country" value="${p.country}" placeholder="Canada"></label>
          <label class="field">You arrive on <span class="h">Empty if you live there.</span><input type="date" name="arrive_on" value="${p.arrive_on}"></label></div>
        <label class="row s" style="font-weight:500"><input type="checkbox" name="remote" ${!p.workplaces?.length || p.workplaces.includes('remote') ? 'checked' : ''}> Remote roles in that country are fine too</label>
        <div class="row"><button class="btn ${has2 ? '' : 'p'}" ${has1 ? '' : 'disabled'}>${has2 ? 'Change' : 'Save'}</button></div></form>

      <div class="card col" style="gap:10px;${has2 ? '' : 'opacity:.5'}">${head(3, 'Your CV', has3, 'Word or PDF. Job Hunt reads it once and works out what you do and what to look for.')}
        ${y.cvs.map(v => html`<div class="row s"><b>${v.name}</b><span class="m">${v.filename}</span></div>`)}
        <div class="row" id="cvrow"><label class="btn ${has3 ? '' : 'p'}" ${has2 ? '' : 'aria-disabled="true" style="pointer-events:none"'}>${has3 ? 'Add another' : 'Choose the file'}<input type="file" accept=".docx,.pdf,.txt,.md" hidden data-on="change" data-act="cv"></label></div></div>

      ${has3 ? html`<form data-act="finish" data-busy="Starting…" class="card col" style="gap:10px">${head(4, 'Is this what to look for?', false, 'Read from your CV. Change anything; one title per line. All three groups are searched equally.')}
        ${p.headline ? html`<p class="s"><b>${p.name}</b> · ${p.headline}</p>` : ''}
        <div class="grid3"><label class="field">At your level<textarea name="level" rows="5">${(t.level || []).join('\n')}</textarea></label><label class="field">A step up<textarea name="step_up" rows="5">${(t.step_up || []).join('\n')}</textarea></label><label class="field">Sideways<textarea name="sideways" rows="5">${(t.sideways || []).join('\n')}</textarea></label></div>
        <label class="field">Words that mark your field <span class="h">A title with one of these is always read.</span><input type="text" name="domain" value="${(p.domain || []).join(', ')}"></label>
        <label class="field">Never show <span class="h">Titles or employers, comma-separated. Optional.</span><input type="text" name="avoid" value="${(p.avoid || []).join(', ')}"></label>
        <p class="xs m">Job Hunt writes; you send. It never submits an application or messages anyone.</p>
        <div class="row"><button class="btn p">Start looking</button></div></form>` : ''}

      ${o && !(o.old?.found || o.old?.last || o.old?.busy) ? oldCard(o, true) : ''}
    </div>`;
  },
  actions: {
    ...oldActions,
    async llm({ f }) {
      if (!f.engine) throw new Error('Choose one of the three.');
      await put('llm', { engine: f.engine, key: f.key || '' });
      if (f.engine !== 'demo') { const r = await post('llm/test'); toast(r.message); }
    },
    async where({ f, data }) {
      const p = data.y.profile, wp = f.remote ? [] : ['hybrid', 'onsite'];
      await put('profile', { ...p, city: f.city, country: f.country, arrive_on: f.arrive_on, workplaces: wp });
    },
    async cv({ el }) {
      const file = el.files[0];
      if (!file) return false;
      document.getElementById('cvrow').innerHTML = '<span class="spin"></span><span class="s">Reading your CV. This takes about a minute.</span>';
      await api('cvs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file });
    },
    async finish({ f, data }) {
      const p = data.y.profile;
      await put('profile', { ...p, titles: { level: lines(f.level), step_up: lines(f.step_up), sideways: lines(f.sideways) }, domain: lines(f.domain), avoid: lines(f.avoid) });
      await post('setup/finish');
      app.state = null;
      location.hash = '#/today';
      return false;
    },
  },
};
