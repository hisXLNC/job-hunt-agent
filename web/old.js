// The card for bringing things over from the old Job Hunt. It is shown on the
// welcome screen and under You → The app.
import { html, api, post, toast } from './app.js';

const n = (k, one, many) => (k ? `${k} ${k === 1 ? one : many || one + 's'}` : '');
const list = parts => parts.filter(Boolean).join(', ');

function holds(o) {
  return list([n(o.applied, 'job you applied to', 'jobs you applied to'), n(o.prepared, 'prepared and not yet sent', 'prepared and not yet sent'), n(o.open, 'recent find'), n(o.not_interested, 'you said no to', 'you said no to'),
    n(o.cvs?.length, 'CV'), n(o.people, 'person who wrote to you', 'people who wrote to you')]);
}
function came(r) {
  return list([n(r.roles, 'role'), r.applied ? `${r.applied} applied to` : '', r.prepared ? `${r.prepared} prepared` : '', r.not_interested ? `${r.not_interested} you said no to` : '',
    n(r.cvs, 'CV'), n(r.people, 'person', 'people'), n(r.talks, 'interview'), n(r.facts, 'fact about you', 'facts about you'), n(r.employers, 'employer to watch', 'employers to watch'), n(r.sites, 'job site to search', 'job sites to search'), n(r.muted, 'employer never to show', 'employers never to show')]);
}

// old is the answer of GET /api/import/old. first is true on the welcome screen.
export function oldCard(old, first) {
  const o = old?.old || {}, last = o.last;
  if (o.busy) return html`<div class="card row"><span class="spin"></span><div><h4>Bringing things over from the old Job Hunt</h4><p class="s m">Reading each CV takes about a minute. The page updates by itself.</p></div></div>`;
  const other = html`<details><summary class="s">${o.found ? 'It is somewhere else' : 'Choose where it is'}</summary>
    <div class="col" style="gap:8px;margin-top:8px"><div class="row"><label class="btn sm">Choose a backup (.zip)<input type="file" accept=".zip,.db" hidden data-on="change" data-act="oldfile"></label><span class="xs m">The old app made one under Settings → Back up.</span></div>
    <form data-act="oldpath" data-busy="Bringing it over…" class="row"><input type="text" name="path" placeholder="Or the old data folder, like D:\Job Hunt\data" aria-label="The old data folder" class="grow"><button class="btn sm">Bring over</button></form></div></details>`;
  return html`<div class="card col" style="gap:10px" id="oldcard">
    <div><h3>${first ? 'Used the old Job Hunt?' : 'The old Job Hunt'}</h3>
      <p class="s m" style="margin-top:3px">${o.found ? html`It is on this computer${o.name ? html`, set up for <b>${o.name}</b>` : ''}. It holds ${holds(o) || 'no jobs yet'}.`
        : 'Bring over the jobs you applied to or prepared, your CVs, the people who wrote to you and what you told it to look for.'}
        Nothing in the old app is changed, and roles you said no to stay gone.${o.claude === 'key' ? ' Your Claude API key comes over too.' : ''}</p></div>
    ${last ? html`<div class="s"><b>Brought over:</b> ${came(last) || 'nothing new'}.${last.claude ? ` Claude is connected through ${last.claude}.` : ''}${(last.notes || []).map(x => html`<div class="xs m" style="margin-top:3px">${x}</div>`)}</div>` : ''}
    ${old?.problem ? html`<p class="s" style="color:var(--crit)">${old.problem}</p>` : ''}
    ${o.found ? html`<div class="row"><button class="btn ${last ? '' : 'p'}" data-act="oldhere" data-busy="Bringing it over…">${last ? 'Bring over again' : 'Bring it all over'}</button>${last ? html`<span class="xs m">Nothing is added twice.</span>` : ''}</div>` : ''}
    ${other}</div>`;
}

function done(r) {
  toast(`Brought over ${came(r) || 'nothing new'}`);
}
function wait() {
  const c = document.getElementById('oldcard');
  if (c) c.innerHTML = '<div class="row"><span class="spin"></span><span class="s">Bringing things over. Reading each CV takes about a minute.</span></div>';
}
export const oldActions = {
  async oldhere() { wait(); done(await post('import/old', {})); },
  async oldpath({ f }) { if (!f.path) throw new Error('Type the folder first.'); wait(); done(await post('import/old', { path: f.path })); },
  async oldfile({ el }) {
    const file = el.files[0];
    if (!file) return false;
    wait();
    done(await api('import/old?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file }));
  },
};
