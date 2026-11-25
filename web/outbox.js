// A message the person wrote with Job Hunt, on its way out: saved as a draft
// in their own mail, or sent with one press. Each button shows only when its
// switch on the inbox card is on. Nothing here runs by itself.
import { html, post, toast, copy, app } from './app.js';

const can = () => app.state?.mail_can || {};
export const canOut = () => !!(can().drafts || can().send);

// Who it goes to, shown before anything can be sent.
export const toField = to => (canOut() ? html`<label class="field">To<input type="text" name="to" value="${to || ''}" placeholder="name@company.com" autocomplete="off" aria-label="Who it goes to"></label>` : '');

export const outButtons = (kind, id) => html`${can().drafts ? html`<button type="button" class="btn sm" data-act="gdraft" data-kind="${kind}" data-id="${id}" data-busy="Saving…" title="Puts it in the Drafts of your own mail, in the thread of their message. Nothing is sent.">Save as a Gmail draft</button>` : ''}${can().send ? html`<button type="button" class="btn sm p" data-act="sendmail" data-kind="${kind}" data-id="${id}" data-busy="Sending…" title="Sends this one message from your own address. You are asked once more first.">Send</button>` : ''}`;

// A whole message to change and send: for text Job Hunt wrote that had no form of its own.
export const outForm = (kind, id, m, mailto) => html`<form data-act="outhold" class="col" style="gap:6px">${toField(m.to)}<label class="field">Subject<input type="text" name="subject" value="${m.subject || ''}"></label><textarea name="body" rows="8" aria-label="The message">${m.body || ''}</textarea>
  <div class="row wrap" style="gap:6px"><button type="button" class="btn sm" data-act="outcopy">Copy</button><button type="button" class="btn sm" data-act="outmail" data-to="${mailto || ''}" title="Opens a new message in your mail program. You press Send.">Open in my mail</button>${outButtons(kind, id)}</div></form>`;

function read(el) {
  const form = el.closest('form');
  return { to: form.querySelector('[name=to]')?.value.trim() || '', subject: form.querySelector('[name=subject]')?.value.trim() || '', body: form.querySelector('textarea')?.value || '' };
}

export const outActions = {
  outhold: () => false,
  outcopy: ({ el }) => { const m = read(el); copy((m.subject ? m.subject + '\n\n' : '') + m.body); return false; },
  outmail: ({ el, d }) => { const m = read(el); location.href = `mailto:${encodeURIComponent(m.to || d.to || '')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`; return false; },
  async gdraft({ el, d }) {
    const m = read(el);
    await post('mail/draft', { kind: d.kind, id: +d.id, ...m });
    toast('Saved in your Gmail drafts. Nothing was sent.');
  },
  async sendmail({ el, d }) {
    const m = read(el);
    if (!m.to) throw new Error('Say who it goes to.');
    if (!m.body.trim()) throw new Error('The message is empty.');
    if (!confirm(`Send “${m.subject || '(no subject)'}” to ${m.to} now, from your own address?`)) return false;
    await post('mail/send', { kind: d.kind, id: +d.id, ...m });
    toast(`Sent to ${m.to}`);
  },
};
