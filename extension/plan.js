// Deciding what goes in each field of a form. Nothing here touches a page or
// Job Hunt: it takes the fields as filler.js read them, what Job Hunt knows
// about the person and the role, and says what to type, what to ask Job Hunt
// and what is left for the person. The side panel and the test bench both use it.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "Jan 2020 – Present", "03/2019 - 06/2021", "2018 to 2021": { from, to, current } as YYYY-MM or YYYY.
function parseDates(s) {
  const out = { from: '', to: '', current: /present|current|now|today|ongoing/i.test(s || '') };
  const re = /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+|(\d{1,2})\s*[/.]\s*)?((?:19|20)\d{2})(?:-(\d{2})(?!\d))?/gi;
  const found = [];
  for (let m; (m = re.exec(s || '')) && found.length < 2;) {
    const mo = m[1] ? MONTH_NAMES.findIndex(x => x.toLowerCase().startsWith(m[1].toLowerCase())) + 1 : m[2] ? +m[2] : m[4] ? +m[4] : 0;
    found.push(mo >= 1 && mo <= 12 ? `${m[3]}-${String(mo).padStart(2, '0')}` : m[3]);
  }
  out.from = found[0] || '';
  out.to = out.current ? '' : found[1] || '';
  return out;
}
// A date for a field that asks for only its month or only its year.
function datePiece(f, ym) {
  if (!ym) return null;
  const t = `${f.label} ${f.name}`.toLowerCase(), y = ym.slice(0, 4), m = +ym.slice(5, 7);
  if (/month/.test(t) && !/year/.test(t.replace(/month/, ''))) return m ? { value: MONTH_NAMES[m - 1], alts: [MONTH_NAMES[m - 1].slice(0, 3), String(m).padStart(2, '0'), String(m)] } : null;
  if (/year/.test(t)) return { value: y };
  return { value: ym };
}

const DEGREES = [[/\b(ph\.?d|doctor|dphil)/i, ['Doctorate', 'PhD', 'Doctor', 'Doctoral']], [/\b(m\.?b\.?a)\b/i, ['MBA', 'Master', "Master's", 'Masters']], [/\b(m\.?sc|m\.?a|m\.?eng|m\.?s|master)/i, ['Master', "Master's", 'Masters']],
  [/\b(b\.?sc|b\.?a|b\.?eng|b\.?s|b\.?comm?|bachelor|undergraduate)/i, ['Bachelor', "Bachelor's", 'Bachelors']], [/\bassociate/i, ['Associate', "Associate's"]], [/\bdiploma/i, ['Diploma']], [/\bhigh school|secondary/i, ['High School', 'Secondary']]];

// What one field of a job or a school on the form takes from the CV. undefined: not such a
// field. null: leave it without a word. '': not known.
function entryValue(f, me) {
  const e = f.entry;
  if (!e || !e.n || (e.type !== 'work' && e.type !== 'edu')) return undefined;
  const l = f.label.toLowerCase(), t = `${l} ${f.name}`;
  const item = ((e.type === 'work' ? me.work : me.education) || [])[e.n - 1];
  const role = /\b(from|start)/.test(t) ? 'from' : /\b(to|end|until)\b|graduat/.test(t) && !/\bto (add|select|type)\b/.test(t) ? 'to' : '';
  if (!item) return /school|degree|title|company|employer|from|start|to|end|field of study|description/.test(t) ? null : undefined;
  const d = parseDates(item.dates);
  if (f.kind === 'checkbox') return /current/.test(t) && d.current ? { value: 'yes' } : null;
  if (role && f.kind === 'date') { const ym = role === 'from' ? d.from : d.to; return ym ? { value: ym } : null; }
  if (role && /date|month|year|from|to|start|end/.test(t)) return datePiece(f, role === 'from' ? d.from : d.to);
  if (e.type === 'work') {
    if (/description|responsibilit|duties|summary|achievement/.test(t)) return item.text ? { value: item.text.slice(0, f.max || 4000) } : null;
    if (/title|position|role\b/.test(t)) return item.title ? { value: item.title } : '';
    if (/company|employer|organi[sz]ation/.test(t)) return item.org ? { value: item.org } : '';
    if (/location|city/.test(t)) return item.location ? { value: item.location, tone: 'check' } : null;
    return undefined;
  }
  const school = item.org || item.title, degree = item.org ? item.title : '';
  if (/school|university|institution|college/.test(t)) return school ? { value: school } : '';
  if (/field of study|major|discipline|area of study|speciali[sz]ation/.test(t)) { const m = /\b(?:in|of)\s+(?!science\b|arts\b|engineering in\b)([^,(]+)$/i.exec(degree); return m ? { value: m[1].trim(), tone: 'check' } : undefined; }
  if (/degree|qualification|level of education/.test(t)) { if (!degree) return undefined; const hit = DEGREES.find(x => x[0].test(degree)); return { value: degree, alts: hit ? hit[1] : [] }; }
  if (/gpa|grade|score/.test(t)) return null;
  return undefined;
}

// The person's own details. Same answers as entryValue.
function contactValue(f, me) {
  const label = f.label.toLowerCase().trim(), t = `${label} ${f.name} ${f.auto}`;
  const links = me.links || [], parts = (me.name || '').trim().split(/\s+/), job = (me.work || [])[0] || {};
  const v = x => (x ? { value: x } : '');
  if (f.kind === 'text' || f.kind === 'combo') {
    if (f.type === 'email' || (/e-?mail/.test(t) && label.length < 40)) return v(me.email);
    if (/phone|mobile|telephone/.test(t) && /extension|\bext\b|code|type|device/.test(label)) return /extension|\bext\b/.test(label) ? null : undefined;
    if (f.type === 'tel' || (/phone|mobile|telephone/.test(t) && label.length < 40)) return v(me.phone);
    if (/middle.?name|name suffix|maiden/.test(t)) return null;
    if (/first.?name|given.?name|\bfname\b|firstname/.test(t)) return v(parts[0]);
    if (/last.?name|family.?name|surname|\blname\b|lastname/.test(t)) return v(parts.slice(1).join(' '));
    if (/^(full |legal |your |candidate )?name$/.test(label) || f.auto === 'name' || /^(name|_systemfield_name)( |$)/.test(f.name)) return v(me.name);
    const link = x => (x ? { value: x } : f.required ? '' : null); // a link the CV doesn't have is no loss
    if (/linkedin/.test(t)) return link(links.find(l => /linkedin\.com/i.test(l)));
    if (/github/.test(t)) return link(links.find(l => /github\.com/i.test(l)));
    if (/portfolio|website|personal site|other (url|link)/.test(t) && label.length < 40) { const x = links.find(l => !/linkedin\.com|github\.com/i.test(l)); return x ? { value: x } : null; }
    if (/^(current )?(city|town)( \(city\))?$/.test(label) || f.auto === 'address-level2' || /addresssection_city/.test(f.name)) return v((me.location || me.home || '').split(',')[0].trim());
    if (/^(current )?location( \(city\))?$|where are you (currently )?(located|based)/.test(label) || /candidate-location|^location /.test(f.name + ' ')) return me.location || me.home ? { value: me.location || me.home, alts: [(me.location || me.home).split(',')[0].trim()], tone: f.kind === 'combo' ? 'check' : 'ok' } : '';
    if (/current (company|employer)|^(company|employer|organi[sz]ation)( name)?$/.test(label) || /^org( |$)/.test(f.name)) return job.org ? { value: job.org } : null;
    if (/current (job )?title|^(job )?title$/.test(label)) return job.title ? { value: job.title } : null;
    if (/address line 2|apartment|suite/.test(label)) return null;
    if (/^(street )?address|address line|postal|zip code|postcode/.test(label)) return '';
  }
  if (/phone (device )?type|type of phone/.test(label)) return { value: 'Mobile', alts: ['Cell', 'Cellular', 'Mobile Phone', 'Cell Phone'] };
  if (me.country && (/^country( ?\/ ?region| of residence| or region)?$/.test(label) || /country (phone )?code|phone code/.test(label))) {
    const c = me.country, alts = /^(usa?|united states)/i.test(c) ? ['United States of America', 'United States', 'USA', 'US'] : /^(uk|united kingdom|great britain)/i.test(c) ? ['United Kingdom', 'UK', 'Great Britain'] : [];
    return { value: c, alts };
  }
  return undefined;
}

// A figure for "expected salary": inside the role's stated pay where it has one, never under
// the person's own floor. Always for the person to check.
function payValue(f, me, role) {
  if (!/salary|compensation|expected pay|pay expectation|desired pay|expected rate|rate expectation|remuneration/i.test(f.label) || !['text', 'textarea'].includes(f.kind)) return undefined;
  if (/currency|period|frequency|type/i.test(f.label)) return undefined;
  const nums = (String((role && role.pay) || '').match(/\d[\d,]*(?:\.\d+)?\s?[kK]?/g) || []).map(x => { const n = parseFloat(x.replace(/,/g, '')); return /k/i.test(x) ? n * 1000 : n; }).filter(n => n > 0);
  const floor = Number(me.pay_floor) || 0;
  let n = 0;
  if (nums.length) {
    const lo = Math.min(...nums.slice(0, 2)), hi = Math.max(...nums.slice(0, 2));
    n = Math.round((lo + hi) / 2);
    // The floor counts when it is in the same unit as the posting's pay (a year, an hour).
    if (floor && (floor >= 1000) === (hi >= 1000)) n = Math.max(n, floor);
  } else n = floor;
  if (!n) return '';
  return { value: f.numeric ? String(n) : n.toLocaleString('en-US'), tone: 'check', why: 'check the amount' };
}

// A list's own "nothing chosen yet" line is not one of its choices.
const NO_CHOICE = /^(select\b|choose\b|please (select|choose)|--|[-\u2013\u2014]+\s*(none|select|make a selection)|no selection$)/i;
const SOURCE = /how did you (hear|find|learn)|where did you (hear|find|learn|see)|how you heard|source of (application|referral)|referral source/i;
const WHY = {
  yours: 'yours to answer', unknown: "Job Hunt doesn't know it", asked: 'no answer yet: it is now a question in Job Hunt', unsure: 'Job Hunt was not sure: it is now a question in Job Hunt',
  choice: 'the answer is not one of its choices', closed: "its list wouldn't open", ignored: "the page didn't take it", date: 'a date for you', tick: 'yours to tick',
  letter: 'no letter is written for this role', gone: 'the page changed', error: 'something went wrong on this field', number: 'it wants a number', many: 'more questions than Job Hunt answers at once',
};

// A field of one job or school ("Degree") is asked about with its entry's name in front.
const askText = f => (f.entry && f.section && f.label.length < 40 && !/\?\s*$/.test(f.label) ? `${f.section}: ${f.label}` : f.label);

// Sorts a form's fields into: type this now, ask Job Hunt, leave for the person.
// `opts.over`: the person pointed at the field themselves, so a filled one is redone.
function planFill(fields, me, role, opts) {
  opts = opts || {};
  const plan = { items: [], ask: [], left: [], notes: {} };
  const put = (f, x) => { plan.items.push({ i: f.i, value: x.value, alts: x.alts, tone: x.tone || 'ok', over: !!opts.over }); if (x.why) plan.notes[f.i] = x.why; };
  for (const f of fields) {
    if (opts.skip && opts.skip.has(f.i)) continue;
    if ((f.filled && !opts.over) || !f.label || f.kind === 'file') continue;
    if (f.private) { if (f.required || f.kind !== 'checkbox') plan.left.push({ label: f.label, why: f.kind === 'checkbox' ? WHY.tick : WHY.yours }); continue; }
    let x = entryValue(f, me);
    if (x === undefined) x = contactValue(f, me);
    if (x === undefined) x = payValue(f, me, role);
    if (x === undefined && SOURCE.test(f.label)) x = /linkedin/i.test(`${(role && role.source) || ''} ${(role && role.url) || ''}`) ? { value: 'LinkedIn', alts: ['Social Media', 'Job Board', 'Online Job Board', 'Other'], tone: 'check' } : { value: 'Company Website', alts: ['Company Career Site', 'Career Site', 'Careers Page', 'Corporate Website', 'Company Careers Page', 'Other'], tone: 'check' };
    if (x === undefined && /cover letter|motivation letter|letter of motivation/i.test(f.label) && f.kind === 'textarea') x = role && role.letter ? { value: role.letter } : null;
    if (x === undefined && f.kind === 'skills') x = (me.skills || []).length ? { value: me.skills.slice(0, 10).join('; '), tone: 'check' } : null;
    if (x === null) continue;
    if (x === '') { plan.left.push({ label: f.label, why: WHY.unknown }); continue; }
    if (x !== undefined) { put(f, x); continue; }
    if (f.kind === 'checkbox') { if (f.required) plan.left.push({ label: f.label, why: WHY.tick }); continue; }
    if (f.kind === 'date' || f.type === 'date' || f.type === 'month') { if (f.required) plan.left.push({ label: f.label, why: WHY.date }); continue; }
    if (f.label.length < 4 && !opts.over) continue;
    if (plan.ask.length >= 30) { plan.left.push({ label: f.label, why: WHY.many }); continue; }
    const choices = ['select', 'radio', 'checks', 'drop'].includes(f.kind) ? (f.options || []).filter(o => o && !NO_CHOICE.test(o)) : [];
    plan.ask.push({ f, q: askText(f), options: choices.length <= 60 ? choices : [] });
  }
  return plan;
}

// Job Hunt's answers, turned into what to type. A choice is only made when Job Hunt is sure.
function planAnswers(plan, answers) {
  plan.ask.forEach((q, n) => {
    const a = (answers || [])[n] || {}, f = q.f, text = String(a.answer || '').trim();
    if (!text) { plan.left.push({ label: f.label, why: WHY.asked }); return; }
    const choice = ['select', 'radio', 'checks', 'drop', 'prompt', 'checkbox'].includes(f.kind);
    if (choice && !a.sure) { plan.left.push({ label: f.label, why: WHY.unsure }); return; }
    plan.items.push({ i: f.i, value: text, tone: a.sure ? 'ok' : 'check', again: q.options.length > 0 });
    if (!a.sure) plan.notes[f.i] = 'Job Hunt was not sure';
  });
  plan.ask = [];
  return plan;
}

// What happened, in three lists. `again`: fields whose answer was not among their choices,
// with the choices the page showed, to ask Job Hunt once more.
function sumUp(plan, results, fields) {
  const by = new Map(fields.map(f => [f.i, f]));
  const out = { filled: 0, check: [], left: [...plan.left], again: [] };
  for (const r of results || []) {
    const f = by.get(r.i), it = plan.items.find(x => x.i === r.i) || {};
    if (!f) continue;
    if (r.ok) {
      out.filled++;
      if (r.check || it.tone === 'check') out.check.push({ label: f.label, why: r.why || plan.notes[f.i] || (r.check ? 'typed in, not chosen from its list' : 'Job Hunt was not sure') });
    } else if (r.why === 'kept') { /* the person's own answer stays */ }
    else if (r.why === 'choice' && r.options && r.options.length > 1 && !it.again) out.again.push({ f, options: r.options });
    else out.left.push({ label: f.label, why: WHY[r.why] || WHY.ignored });
  }
  return out;
}

// How many entries of each kind to add, so every job and school on the CV has a place.
function planAdds(adders, me) {
  const want = { work: Math.min((me.work || []).length, 6), edu: Math.min((me.education || []).length, 4) };
  return (adders || []).filter(a => want[a.type] > a.entries).map(a => ({ a: a.a, type: a.type, more: want[a.type] - a.entries }));
}

// One pass over some fields: plan, ask Job Hunt, type the answers in. Where an answer was
// not among a list's choices, Job Hunt is asked once more, this time with the choices.
// `io` is how the page and Job Hunt are reached: { scan, addEntry, fill, ask, frame }.
async function fillRound(io, fields, me, role, opts) {
  opts = opts || {};
  const ask = async list => (list.length ? await io.ask(list) : []);
  const type = async items => (items.length ? await io.fill(items, io.frame) : []);
  const plan = planFill(fields, me, role, opts);
  planAnswers(plan, await ask(plan.ask.map(a => ({ q: a.q, options: a.options }))));
  let sum = sumUp(plan, await type(plan.items), fields);
  if (sum.again.length) {
    const again = sum.again.map(a => ({ f: a.f, q: askText(a.f), options: a.options }));
    const got = await ask(again.map(a => ({ q: a.q, options: a.options }))), p2 = { items: [], left: [], notes: {}, ask: [] };
    again.forEach((a, n) => {
      const g = got[n] || {};
      if (g.answer && g.sure) p2.items.push({ i: a.f.i, value: g.answer, tone: 'ok', again: true, over: !!opts.over });
      else p2.left.push({ label: a.f.label, why: WHY.choice });
    });
    const s2 = sumUp(p2, await type(p2.items), fields);
    sum = { filled: sum.filled + s2.filled, check: [...sum.check, ...s2.check], left: [...sum.left, ...s2.left], again: [] };
  }
  return sum;
}

// The whole form: a place for every job and school on the CV, then the answers, and again
// for the questions those answers bring onto the page. Nothing here sends the form.
async function fillForm(io, me, role) {
  const known = [];
  let best = await io.scan({ lists: false, skip: known });
  if (!best || !best.fields.length) return null;
  for (let n = 0; n < 10; n++) {
    const add = planAdds(best.adders, me)[0];
    if (!add) break;
    const had = best.adders.find(a => a.a === add.a).entries;
    const r = await io.addEntry(add.a, best.frame);
    if (!r || !r.ok) break;
    const next = await io.scan({ lists: false, skip: known });
    if (!next) break;
    best = next;
    const now = best.adders.find(a => a.type === add.type);
    if (!now || now.entries <= had) break;
  }
  best = await io.scan({ lists: true, skip: known });
  const total = { filled: 0, check: [], left: [] }, seen = new Set();
  const sig = f => `${f.section}|${f.label}|${f.kind}|${f.entry ? f.entry.n : ''}`;
  for (let round = 0; round < 3; round++) {
    const fresh = best.fields.filter(f => !seen.has(sig(f)));
    if (!fresh.length) break;
    const sum = await fillRound({ ...io, frame: best.frame }, fresh, me, role);
    fresh.forEach(f => { seen.add(sig(f)); known.push(`${f.section}|${f.label}`); });
    total.filled += sum.filled; total.check.push(...sum.check); total.left.push(...sum.left);
    if (!sum.filled || round === 2) break;
    best = await io.scan({ lists: true, skip: known });
  }
  return { total, last: best };
}

if (typeof module !== 'undefined') module.exports = { parseDates, fillForm, fillRound, planFill, planAnswers, sumUp, planAdds, contactValue, entryValue, payValue, WHY };
