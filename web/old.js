// The card for bringing things over from the old Job Hunt. It is shown on the
// welcome screen and under Settings → The app.
import { html, api, post, toast } from './app.js';

const n = (k, one, many) => (k ? `${k} ${k === 1 ? one : many || one + 's'}` : '');
const list = parts => parts.filter(Boolean).join(', ');

function holds(o) {
  return list([n(o.applied, 'job you applied to', 'jobs you applied to'), n(o.prepared, 'prepared and not yet sent', 'prepared and not yet sent'), n(o.open, 'recent find'), n(o.not_interested, 'you said no to', 'you said no to'),
    n(o.cvs?.length, 'CV'), n(o.people, 'person who wrote to you', 'people who wrote to you')]);
}
function came(r) {
  return list([n(r.roles, 'role'), r.applied ? `${r.applied} applied to` : '', r.prepared ? `${r.prepared} prepared` : '', r.not_interested ? `${r.not_interested} you said no to` : '',
    n(r.cvs, 'CV'), n(r.people, 'person', 'people'), n(r.talks, 'interview'), n(r.facts, 'fact about you', 'facts about you'), n(r.employers, 'employer to watch', 'employers to watch'), n(r.sites, 'job site to search', 'job sites to search'), n(r.muted, 'employer never to show', 'employers never to show'), r.searches?.length ? `the keys for ${r.searches.join(', ')}` : '']);
}

// old is the answer of GET /api/import/old. first is true on the welcome screen.
export function oldCard(old, first) {
  const o = old?.old || {}, last = o.last;
  if (o.busy) {
    // Opened while things are being brought over (another window started it): follow along.
    setTimeout(() => watch(true));
    return html`<div class="card" id="oldcard">${progress(o.progress)}</div>`;
  }
  const other = html`<details><summary class="s">${o.found ? 'It is somewhere else' : 'Choose where it is'}</summary>
    <div class="col" style="gap:8px;margin-top:8px"><div class="row"><label class="btn sm">Choose a backup (.zip)<input type="file" accept=".zip,.db" hidden data-on="change" data-act="oldfile"></label><span class="xs m">The old app made one under You → Back up.</span></div>
    <form data-act="oldpath" data-busy="Bringing it over…" class="row"><input type="text" name="path" placeholder="Or the old data folder, like D:\Job Hunt\data" aria-label="The old data folder" class="grow"><button class="btn sm">Bring over</button></form></div></details>`;
  return html`<div class="card col" style="gap:10px" id="oldcard">
    <div><h3>${first ? 'Used Job Hunt Old?' : 'Job Hunt Old'}</h3>
      <p class="s m" style="margin-top:3px">${o.found ? html`It is on this computer${o.name ? html`, set up for <b>${o.name}</b>` : ''}. It holds ${holds(o) || 'no jobs yet'}.`
        : 'Bring over the jobs you applied to or prepared, your CVs, the people who wrote to you and what you told it to look for.'}
        Nothing in Job Hunt Old is changed, and roles you said no to stay gone.${o.claude === 'key' ? ' Your Claude API key comes over too.' : ''}</p></div>
    ${last ? html`<div class="s"><b>Brought over:</b> ${came(last) || 'nothing new'}.${last.claude ? ` Claude is connected through ${last.claude}.` : ''}${(last.notes || []).map(x => html`<div class="xs m" style="margin-top:3px">${x}</div>`)}</div>` : ''}
    ${old?.problem ? html`<p class="s" style="color:var(--crit)">${old.problem}</p>` : ''}
    ${o.found ? html`<div class="row"><button class="btn ${last ? '' : 'p'}" data-act="oldhere" data-busy="Bringing it over…">${last ? 'Bring over again' : 'Bring it all over'}</button>${last ? html`<span class="xs m">Nothing is added twice.</span>` : ''}</div>` : ''}
    ${other}</div>`;
}

function done(r) {
  toast(`Brought over ${came(r) || 'nothing new'}`);
}
// What is being done now and how far along it is, as a bar.
function progress(p) {
  const pc = Math.max(2, Math.min(100, p?.percent || 0));
  return html`<div class="col" style="gap:8px"><div class="row"><span class="spin"></span><h4 class="grow">Bringing things over from Job Hunt Old</h4><b class="s" id="oldpc">${pc}%</b></div>
    <div class="bar" role="progressbar" aria-label="Bringing things over" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}" id="oldbar"><i style="width:${pc}%;transition:width .9s linear"></i></div>
    <p class="s m" id="oldtext">${p?.text || 'Starting'}. Reading each CV takes about a minute.</p></div>`;
}
// While things are brought over, the card shows the bar and keeps it moving.
let watching = 0;
function watch(reloadAfter) {
  clearInterval(watching);
  watching = setInterval(async () => {
    const bar = document.getElementById('oldbar');
    if (!bar) { if (reloadAfter) clearInterval(watching); return; }
    let o;
    try { o = (await api('import/old')).old; } catch { return; }
    if (!o?.busy) {
      if (reloadAfter) { clearInterval(watching); window.dispatchEvent(new HashChangeEvent('hashchange')); }
      return;
    }
    if (!o.progress) return;
    const pc = Math.max(2, Math.min(100, o.progress.percent || 0));
    bar.setAttribute('aria-valuenow', pc);
    bar.firstElementChild.style.width = pc + '%';
    document.getElementById('oldpc').textContent = pc + '%';
    if (o.progress.text) document.getElementById('oldtext').textContent = o.progress.text + '. Reading each CV takes about a minute.';
  }, 1000);
}
function wait() {
  const c = document.getElementById('oldcard');
  if (c) c.innerHTML = progress(null).s;
  watch(false);
}
async function during(work) {
  wait();
  try { return await work(); } finally { clearInterval(watching); }
}
export const oldActions = {
  async oldhere() { done(await during(() => post('import/old', {}))); },
  async oldpath({ f }) { if (!f.path) throw new Error('Type the folder first.'); done(await during(() => post('import/old', { path: f.path }))); },
  async oldfile({ el }) {
    const file = el.files[0];
    if (!file) return false;
    done(await during(() => api('import/old?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file })));
  },
};
