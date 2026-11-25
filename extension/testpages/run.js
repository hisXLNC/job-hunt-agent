// The test bench for the form filler. The real hiring sites can't be reached
// from a test, so each page in this folder imitates one system's markup and the
// way its widgets behave. This loads each page in a browser, puts the side
// panel's own filler.js and plan.js into it, fills the form as the panel would
// (with made-up answers standing in for Job Hunt's), and checks every field.
//
//   node extension/testpages/run.js [page]     (needs Playwright; SHOW=1 lists what was asked
//                                               and left, LOG=1 the filler's own log)
//
// None of this folder ships with the side panel.
const path = require('path');
const { chromium } = require('playwright');

const EXT = path.join(__dirname, '..');
const ME = {
  name: 'Sam Rivera', email: 'sam.rivera@example.com', phone: '+1 555 0142', location: 'Toronto, ON', home: 'Toronto', city: 'Toronto', country: 'Canada',
  links: ['https://www.linkedin.com/in/sam-rivera-example', 'https://github.com/samrivera-example', 'https://samrivera.example.com'], pay_floor: 90000, pay_unit: 'a year',
  work: [{ title: 'Senior Analyst', org: 'Northwind Example Ltd', dates: 'Mar 2021 – Present', location: 'Toronto, ON', text: 'Led reporting for the finance team.\n• Cut month-end close by two days' },
    { title: 'Analyst', org: 'Contoso Example Inc', dates: 'Jun 2018 – Feb 2021', location: 'Ottawa, ON', text: 'Built dashboards.' }],
  education: [{ title: 'Bachelor of Science in Computer Science', org: 'Example University', dates: '2014 – 2018', location: 'Toronto' }],
  skills: ['SQL', 'Python', 'Data Analysis', 'Juggling'],
};
const ROLE = { id: 7, title: 'Operations Analyst', company: 'Example Corp', pay: '$95,000 – $105,000 a year', source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/1234567', letter: 'Dear team,\nI would like to apply.\nSam Rivera', has_cv: true, has_letter: true };
// Job Hunt's answers, by words in the question. `sure` as Job Hunt would say it.
const ANSWERS = [
  ['legally authorized', 'Yes', true], ['authorized to work', 'Yes', true], ['right to work', 'Yes', true], ['sponsorship', 'No', true], ['previously worked', 'No', true],
  ['spoken french', 'Conversational', true], ['why are you interested', 'Because the work matches what I have done for five years.', false], ['why do you want', 'Because the work matches what I have done.', false],
  ['what interests you', 'The team and the problem.', false], ['years of experience do you have with sql', '5+', true], ['which offices', 'Toronto; Montreal', true], ['tools have you used', 'Excel; Tableau', true],
  ['prefer to work', 'Hybrid', true], ['notice period', '2 weeks', true], ['willing to travel', 'Yes', true], ['willing to relocate', 'No', true], ['how many years', '7', true], ['which shift', 'Evenings', true],
  ['own a car', 'Yes', true], ['preferred language', 'French', true], ['message to the hiring', 'Hello, I am glad to apply.', false], ['degree', "Bachelor's Degree", true], ['discipline', 'Computer Science', true], ['field of study', 'Computer Science', true],
];

// Runs inside the page: the same steps the panel takes, with the answers above for Job Hunt's.
async function fillInPage([me, role, answers]) {
  const F = window.__jobhuntFiller, asked = [];
  const io = {
    scan: o => F.scan(o), addEntry: a => F.addEntry(a), fill: items => F.fill(items),
    ask: async list => list.map(q => { asked.push(q); const hit = answers.find(a => q.q.toLowerCase().includes(a[0])); return hit ? { answer: hit[1], sure: hit[2] } : { answer: '', sure: false }; }),
  };
  const got = await fillForm(io, me, role);
  F.watch();
  const total = got ? got.total : { filled: 0, check: [], left: [] };
  return { site: got && got.last.site, step: got && got.last.step, filled: total.filled, check: total.check.map(x => x.label), left: total.left.map(x => `${x.label}: ${x.why}`), asked, log: F.log().rows };
}

const heard = id => `document.getElementById(${JSON.stringify(id)}).heard()`;
const val = id => `document.getElementById(${JSON.stringify(id)}).value`;
const txt = id => `document.getElementById(${JSON.stringify(id)}).textContent.trim()`;
const FILE = { name: 'Sam Rivera - CV.docx', b64: Buffer.from('test file').toString('base64'), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', want: 'cv' };

// Each page: what the form must hold afterwards (`want`: expression → value), what must be
// left for the person (`left`: words of a label), and what must be marked to check.
const PAGES = [
  { file: 'workday.html', site: 'workday', want: {
    [heard('input-4')]: 'Sam', [heard('input-5')]: 'Rivera', [heard('input-7')]: 'Toronto', [heard('input-10')]: '+1 555 0142', [heard('input-11')]: '', [heard('input-6')]: '',
    'chosenIn("sourcePrompt").join()': 'Job Board > LinkedIn', [txt('input-3')]: 'Canada', [txt('input-9')]: 'Mobile', [txt('input-12')]: 'Yes', [txt('input-13')]: 'No', [txt('input-14')]: '3 - Conversational',
    'document.getElementById("pw-2").checked': true, [heard('input-15')]: '100,000', 'window.pressed.length': 0, 'document.querySelectorAll("[role=listbox]").length': 0,
  }, left: ['Address Line 1', 'Postal Code'], check: ['salary expectations', 'How Did You Hear'] },
  { file: 'workday-experience.html', site: 'workday', want: {
    'document.querySelectorAll("#jobs h4").length': 2, 'document.querySelectorAll("#schools h4").length': 1,
    [heard('workExperience-1--jobTitle')]: 'Senior Analyst', [heard('workExperience-1--companyName')]: 'Northwind Example Ltd', [heard('workExperience-1--location')]: 'Toronto, ON',
    'document.getElementById("workExperience-1--currentlyWorkHere").checked': true, 'document.getElementById("workExperience-2--currentlyWorkHere").checked': false,
    '[...document.querySelectorAll("[data-automation-id=\'formField-workExperience-1--startDate\'] input")].map(x => x.heard()).join("/")': '03/2021',
    '[...document.querySelectorAll("[data-automation-id=\'formField-workExperience-1--endDate\'] input")].map(x => x.heard()).join("/")': '/',
    [heard('workExperience-2--jobTitle')]: 'Analyst', [heard('workExperience-2--companyName')]: 'Contoso Example Inc',
    '[...document.querySelectorAll("[data-automation-id=\'formField-workExperience-2--startDate\'] input")].map(x => x.heard()).join("/")': '06/2018',
    '[...document.querySelectorAll("[data-automation-id=\'formField-workExperience-2--endDate\'] input")].map(x => x.heard()).join("/")': '02/2021',
    [val('workExperience-2--roleDescription')]: 'Built dashboards.',
    'chosenIn("education-1--schoolName").join()': 'Example University', [txt('education-1--degree')]: "Bachelor's Degree", 'chosenIn("education-1--fieldOfStudy").join()': 'Computer Science',
    '[...document.querySelectorAll("[data-automation-id=\'formField-education-1--firstYearAttended\'] input")].map(x => x.heard()).join()': '2014',
    '[...document.querySelectorAll("[data-automation-id=\'formField-education-1--lastYearAttended\'] input")].map(x => x.heard()).join()': '2018',
    'chosenIn("skills").join()': 'SQL,Python (Programming Language),Data Analysis', 'window.pressed.length': 0,
  }, check: ['Skills'], attach: { ok: true } },
  { file: 'workday-voluntary.html', site: 'workday', want: { [txt('v-1')]: 'Select One', [txt('v-2')]: 'Select One', 'document.getElementById("v-4").checked': false, 'window.opened': 0, 'window.pressed.length': 0 }, left: ['Gender', 'Race/Ethnicity', 'Veteran Status', 'terms and conditions'], filled: 0 },
  { file: 'greenhouse.html', site: 'greenhouse', want: {
    [heard('first_name')]: 'Sam', [heard('last_name')]: 'Rivera', [heard('email')]: 'sam.rivera@example.com', [heard('phone')]: '+1 555 0142',
    'document.getElementById("candidate-location").closest(".select__container").dataset.value': 'Toronto, Ontario, Canada',
    'document.getElementById("school--0").closest(".select__container").dataset.value': 'Example University', 'document.getElementById("degree--0").closest(".select__container").dataset.value': "Bachelor's Degree",
    'document.getElementById("discipline--0").closest(".select__container").dataset.value': 'Computer Science', [heard('start-year--0')]: '2014', [heard('end-year--0')]: '2018',
    'document.querySelectorAll("#schools fieldset").length': 1,
    [heard('question_101')]: 'https://www.linkedin.com/in/sam-rivera-example', [val('question_102')]: 'Because the work matches what I have done for five years.',
    'document.getElementById("question_103").closest(".select__container").dataset.value': 'Yes', 'document.getElementById("question_104").closest(".select__container").dataset.value': 'LinkedIn',
    '[...document.querySelectorAll("[name=\'question_105[]\']")].map(x => x.checked).join()': 'true,true,false',
    'String(document.getElementById("gender").closest(".select__container").dataset.value)': 'undefined', 'window.sends': 0, 'window.pressed.length': 0,
  }, left: ['Gender'], check: ['Why are you interested', 'Location (City)'], attach: { ok: true, at: 'resume' } },
  { file: 'lever.html', site: 'lever', want: {
    'document.querySelector("[name=name]").heard()': 'Sam Rivera', 'document.querySelector("[name=email]").heard()': 'sam.rivera@example.com', 'document.querySelector("[name=phone]").heard()': '+1 555 0142',
    'document.querySelector("[name=location]").heard()': 'Toronto, ON', 'document.querySelector("[name=org]").heard()': 'Northwind Example Ltd',
    'document.querySelector("[name=\'urls[LinkedIn]\']").heard()': 'https://www.linkedin.com/in/sam-rivera-example', 'document.querySelector("[name=\'urls[GitHub]\']").heard()': 'https://github.com/samrivera-example',
    'document.querySelector("[name=\'urls[Portfolio]\']").heard()': 'https://samrivera.example.com',
    'document.querySelector("[name=\'cards[a1][field0]\']:checked").value': 'Yes', 'document.querySelector("[name=\'cards[a1][field1]\']").value': 'Because the work matches what I have done.',
    'document.querySelector("[name=\'cards[a1][field2]\']").value': '5+', '[...document.querySelectorAll("[name=\'cards[a1][field3]\']")].map(x => x.checked).join()': 'true,true,false',
    'document.querySelector("[name=\'eeo[gender]\']").value': '', 'window.sends': 0, 'window.pressed.length': 0,
  }, left: ['Gender'], check: ['Why do you want to work here'], attach: { ok: true } },
  { file: 'ashby.html', site: 'ashby', want: {
    [heard('_systemfield_name')]: 'Sam Rivera', [heard('_systemfield_email')]: 'sam.rivera@example.com', [heard('q-linkedin')]: 'https://www.linkedin.com/in/sam-rivera-example',
    '[...document.querySelectorAll("._yesno_a1")].map(x => x.dataset.value).join()': 'Yes,No', 'document.getElementById("r2").checked': true, [val('q4')]: 'The team and the problem.', 'window.pressed.length': 0,
  }, check: ['What interests you'], attach: { ok: true } },
  { file: 'workable.html', site: 'workable', want: {
    [heard('firstname')]: 'Sam', [heard('lastname')]: 'Rivera', [heard('email')]: 'sam.rivera@example.com', [heard('phone')]: '+1 555 0142', [heard('address')]: '',
    [val('cover_letter')]: ROLE.letter, 'document.querySelector("[name=QA_301]:checked").value': 'true', [val('QA_302')]: '2 weeks', [heard('QA_303')]: '100000', 'window.sends': 0, 'window.pressed.length': 0,
  }, left: ['Address'], check: ['What salary do you expect'], attach: { ok: false, why: 'has' } },
  { file: 'smartrecruiters.html', site: 'smartrecruiters', want: {
    'document.getElementById("first-name-input").shadowRoot.querySelector("input").heard()': 'Sam', 'document.getElementById("last-name-input").shadowRoot.querySelector("input").heard()': 'Rivera',
    'document.getElementById("email-input").shadowRoot.querySelector("input").heard()': 'sam.rivera@example.com', 'document.getElementById("confirm-email-input").shadowRoot.querySelector("input").heard()': 'sam.rivera@example.com',
    'document.getElementById("city-input").dataset.value': 'Toronto, ON, Canada', 'document.getElementById("linkedin-input").shadowRoot.querySelector("input").heard()': 'https://www.linkedin.com/in/sam-rivera-example',
    'document.getElementById("q-auth").shadowRoot.querySelector("input:checked").value': 'Yes', 'document.getElementById("message").shadowRoot.querySelector("textarea").value': 'Hello, I am glad to apply.', 'window.pressed.length': 0,
  }, check: ['Message to the Hiring Team'], attach: { ok: true } },
  { file: 'successfactors.html', site: 'successfactors', want: {
    [heard('sf_fn')]: 'Sam', [heard('sf_ln')]: 'Rivera', [heard('sf_em')]: 'sam.rivera@example.com', [heard('sf_ph')]: '+1 555 0142', [val('sf_co')]: 'Canada', [val('sf_q1')]: 'Yes', [heard('sf_q3')]: '', 'window.pressed.length': 0,
  }, left: ['date of birth'] },
  { file: 'icims.html', site: 'icims', want: Object.fromEntries(Object.entries({
    'D.getElementById("PersonProfileFields.FirstName").heard()': 'Sam', 'D.getElementById("PersonProfileFields.LastName").heard()': 'Rivera', 'D.getElementById("PersonProfileFields.Email").heard()': 'sam.rivera@example.com',
    'D.getElementById("rcf3048").value': '2', 'D.querySelector(".dropdown-text").textContent': 'No', 'D.getElementById("rcf3050").value': '2', 'D.getElementById("rcf3051").value': '', 'D.defaultView.pressed.length': 0, 'D.defaultView.sends': 0,
  }).map(([k, v]) => [`(D => ${k})(document.getElementById("icims_content_iframe").contentDocument)`, v])), left: ['Disability status'], check: ['How did you hear'] },
  { file: 'zoho.html', site: 'zoho', want: {
    [heard('101_input')]: 'Sam', [heard('102_input')]: 'Rivera', [heard('103_input')]: 'sam.rivera@example.com', [heard('104_input')]: '+1 555 0142', 'document.querySelector("#rec-form_105 .lyteDropdownLabel").textContent': 'Canada',
    'document.querySelectorAll("#jobs .entry").length': 2, [heard('201_input')]: 'Senior Analyst', [heard('202_input')]: 'Northwind Example Ltd', [heard('211_input')]: 'Analyst', [heard('212_input')]: 'Contoso Example Inc',
    '[...document.querySelectorAll("#jobs .entry")].map(e => [...e.querySelectorAll(".lyteDropdownLabel")].map(x => x.textContent).join(" ")).join(" | ")': 'Mar 2021 Month Year | Jun 2018 Feb 2021',
    '[...document.querySelectorAll("[name=currently]")].map(x => x.checked).join()': 'true,false', 'window.sends': 0, 'window.pressed.length': 0,
  }, attach: { ok: true } },
  { file: 'generic.html', site: '', want: {
    [heard('g-name')]: 'Sam Rivera', [heard('g-email')]: 'sam.rivera@example.com', [heard('g-tel')]: '555 0100', [val('g-pass')]: '', [val('g-start')]: '', [heard('g-pay')]: '100000', [heard('g-years')]: '7',
    [heard('g-notice')]: '2 weeks', [val('g-shift')]: '', [heard('g-sin')]: '', [val('g-letter')]: ROLE.letter, 'document.getElementById("more").open': true, [heard('g-site')]: 'https://samrivera.example.com',
    'document.querySelector("[role=group] [aria-pressed=true]").textContent': 'Yes', 'document.querySelector("[role=radio][aria-checked=true]").textContent': 'French',
    'document.getElementById("g-agree").checked': false, 'document.querySelector("[name=q]").value': '', 'document.querySelector("[name=newsletter]").value': '', 'window.sends': 0,
  }, left: ['Social Insurance Number', 'Earliest start date', 'I agree to the privacy policy', 'Which shift do you prefer'], check: ['Expected salary'], attach: { ok: true }, after: async (page, fail) => { await notYet(page, fail); await sendIt(page, fail); await sendFromPanel(page, fail); } },
];

// The person corrects one answer, fills one Job Hunt left, and presses Submit: the page must
// be seen to send, the two answers offered (and nothing private), and the thank-you noticed.
async function sendIt(page, fail) {
  await page.fill('#g-years', '9');
  await page.selectOption('#g-shift', 'n');
  await page.fill('#g-sin', '000 000 000');
  await page.fill('#g-pass', 'not-a-real-password');
  await page.check('#g-agree');
  await page.fill('#g-start', '2027-01-04');
  await page.click('#send');
  await page.waitForFunction(() => window.__jobhuntFiller.sent.some(m => m.kind === 'submitted'), null, { timeout: 8000 }).catch(() => {});
  const sent = await page.evaluate(() => window.__jobhuntFiller.sent);
  const p = sent.find(m => m.kind === 'pressed');
  if (!p) return fail('pressing Submit was not noticed');
  const learn = JSON.stringify(p.learn);
  if (learn !== JSON.stringify([{ label: 'How many years of experience do you have?', answer: '9' }, { label: 'Which shift do you prefer?', answer: 'Nights' }])) fail('answers offered to remember: ' + learn);
  if (!sent.some(m => m.kind === 'submitted')) fail('the thank-you page was not noticed');
  if (await page.evaluate(() => window.sends) !== 1) fail('the person\'s own Submit did not go through once');
  if (!(await page.evaluate(() => window.__jobhuntFiller.check(null, 0))).done) fail('check() does not see the thank-you page');
}

// The side panel's "Submit application" while required fields are empty: it says
// which, and the form is not sent.
async function notYet(page, fail) {
  const r = await page.evaluate(() => window.__jobhuntFiller.review());
  if (r.button !== 'Submit application') fail('review() found the button as ' + JSON.stringify(r.button));
  for (const l of ['Earliest start date', 'I agree to the privacy policy']) if (!r.missing.some(m => m.includes(l))) fail(`review() does not list the empty "${l}": ` + JSON.stringify(r.missing));
  const no = await page.evaluate(() => window.__jobhuntFiller.send());
  if (no.ok || no.why !== 'missing') fail('send() went ahead with required fields empty: ' + JSON.stringify(no));
  if (await page.evaluate(() => window.sends) !== 0 || (await page.evaluate(() => window.__jobhuntFiller.sent)).some(m => m.kind === 'pressed')) fail('something was sent while required fields were empty');
}

// The same form, filled by the person, sent by their press of "Submit application": once.
async function sendFromPanel(page, fail) {
  await page.goto('file://' + path.join(__dirname, 'generic.html'));
  await page.addScriptTag({ path: path.join(EXT, 'filler.js') });
  const empty = await page.evaluate(() => window.__jobhuntFiller.review());
  for (const m of empty.missing) {
    const id = await page.evaluate(label => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim().startsWith(label.replace(/\s*\*$/, ''))); return l ? l.htmlFor : ''; }, m);
    const kind = id ? await page.evaluate(i => document.getElementById(i).type || document.getElementById(i).tagName, id) : '';
    if (kind === 'checkbox') await page.check('#' + id);
    else if (kind === 'date') await page.fill('#' + id, '2027-01-04');
    else if (kind === 'email') await page.fill('#' + id, 'sam.rivera@example.com');
    else if (/^select/i.test(kind)) await page.selectOption('#' + id, { index: 1 });
    else if (id) await page.fill('#' + id, 'Sam Rivera');
  }
  const r = await page.evaluate(() => window.__jobhuntFiller.review());
  if (r.missing.length) return fail('review() still lists: ' + JSON.stringify(r.missing));
  const yes = await page.evaluate(() => window.__jobhuntFiller.send());
  if (!yes.ok) fail('send() did not press Submit: ' + JSON.stringify(yes));
  if (await page.evaluate(() => window.sends) !== 1) fail('send() did not send the form exactly once');
  if (!(await page.evaluate(() => window.__jobhuntFiller.sent)).some(m => m.kind === 'pressed')) fail('the send was not told to the panel');
}

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  let bad = 0;
  for (const t of PAGES.filter(p => !only || p.file.includes(only))) {
    const page = await browser.newPage();
    const errors = [], fails = [];
    const fail = m => fails.push(m);
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + path.join(__dirname, t.file));
    await page.addScriptTag({ path: path.join(EXT, 'filler.js') });
    await page.addScriptTag({ path: path.join(EXT, 'plan.js') });
    let r;
    try { r = await page.evaluate(fillInPage, [ME, ROLE, ANSWERS]); } catch (e) { fails.push('the fill threw: ' + e.message); r = { left: [], check: [], log: [], filled: 0 }; }
    if (r.site !== undefined && r.site !== t.site) fail(`system read as "${r.site}", want "${t.site}"`);
    if (t.attach) {
      const a = await page.evaluate(f => window.__jobhuntFiller.attach(f), FILE);
      if (a.ok !== t.attach.ok || (t.attach.why && a.why !== t.attach.why)) fail(`attach: ${JSON.stringify(a)}, want ${JSON.stringify(t.attach)}`);
      if (t.attach.at && (await page.evaluate(id => document.getElementById(id).files.length, t.attach.at)) !== 1) fail('the CV did not go into #' + t.attach.at);
      if (t.attach.at && (await page.evaluate(() => document.getElementById('cover_letter').files.length)) !== 0) fail('the CV went into the letter upload');
    }
    for (const [expr, want] of Object.entries(t.want)) {
      let got;
      try { got = await page.evaluate(expr); } catch (e) { got = 'error: ' + e.message.split('\n')[0]; }
      if (got !== want) fail(`${expr}\n      is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
    for (const l of t.left || []) if (!r.left.some(x => x.toLowerCase().includes(l.toLowerCase()))) fail(`"${l}" is not among: left for you`);
    for (const c of t.check || []) if (!r.check.some(x => x.toLowerCase().includes(c.toLowerCase()))) fail(`"${c}" is not among: needs a check`);
    if (t.filled !== undefined && r.filled !== t.filled) fail(`filled ${r.filled}, want ${t.filled}`);
    if (JSON.stringify(r.log).includes('sam.rivera') || JSON.stringify(r.log).includes('Northwind')) fail('the log holds what was typed');
    if (t.after) await t.after(page, fail);
    for (const e of errors) fail('page error: ' + e);
    console.log(`${fails.length ? 'FAIL' : 'ok  '} ${t.file.padEnd(26)} filled ${String(r.filled).padStart(2)}, to check ${r.check.length}, left ${r.left.length}`);
    for (const f of fails) console.log('     - ' + f);
    if (process.env.SHOW) { for (const x of r.check) console.log('     check: ' + x); for (const x of r.left) console.log('     left:  ' + x); for (const q of r.asked) console.log('     asked: ' + q.q + (q.options.length ? ' [' + q.options.join(' | ') + ']' : '')); }
    if (process.env.LOG) for (const x of r.log) console.log('     log:   ' + JSON.stringify(x));
    bad += fails.length ? 1 : 0;
    await page.close();
  }
  await browser.close();
  console.log(bad ? `\n${bad} page(s) failed` : '\nall pages pass');
  process.exit(bad ? 1 : 0);
})();
