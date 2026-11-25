// What each button does, shown when the pointer rests on it. A button that
// carries its own title keeps it; these fill in the rest, by the words on the
// button first and by what it does second.
const BY_WORDS = {
  'mute': 'Never show roles from this employer again. Roles already found here are set aside. You can undo it under Radar → Muted.',
  'watch': 'Check this employer\'s own careers page all day, so you see new roles there first.',
  'not for me': 'Close this role as not interested. Job Hunt never brings it back, and learns from it.',
  'i applied': 'Mark this role as applied to. Job Hunt then watches for a reply and drafts a follow-up when it is due.',
  'prepare cv and letter': 'Claude tailors your CV to this posting and writes the letter. Takes about a minute; nothing is sent.',
  'write them again': 'Claude writes the tailored CV and the letter afresh. The current ones are replaced.',
  'read it now': 'Claude reads this posting against your CV now and gives it a fit score.',
  'search now': 'Look at every source now instead of waiting for the next scheduled search.',
  'suggest more': 'Claude suggests more employers that hire people like you. You choose which to watch.',
  'they said no': 'Close this role as rejected. It stays in your history.',
  'i withdrew': 'Close this role because you pulled out. It stays in your history.',
  'bring back': 'Reopen this role and put it back where it was.',
  'they answered': 'Mark that this person replied, so no follow-up is drafted.',
  'i sent it': 'Mark this note as sent. Job Hunt sends nothing by itself; only your press on Send does.',
  'let it go': 'Stop following up on this note.',
  'write a note': 'Claude drafts a short note to this person for you to read, change and send yourself.',
  'write a follow-up': 'Claude drafts a polite follow-up for you to send yourself.',
  'write a thank-you': 'Claude drafts a thank-you note for after the conversation.',
  'prepare me': 'Claude builds a prep pack for this conversation: likely questions, your stories, what to ask.',
  'prepare again': 'Claude rebuilds the prep pack from what is known now.',
  'save a copy now': 'Save a backup of all your data in the data folder now. One is also saved every day.',
  'stop job hunt': 'Shut the program down. Searching stops until you start it again.',
  'remove': 'Take this off the list. It asks first where something would be lost.',
  'remove from job hunt': 'Delete this from Job Hunt for good.',
  'forget': 'Remove this fact. Claude stops using it in what it writes.',
  'copy': 'Copy the text so you can paste it where you need it.',
  'copy note': 'Copy the note so you can paste it into LinkedIn or an e-mail.',
  'open in my mail': 'Open a new message in your mail program with this text. You press Send.',
  'test it': 'Send Claude one short question to check the connection works.',
  'send a test': 'Send one test notification to your phone.',
  'approve': 'Let the side panel in your browser talk to Job Hunt. Only approve if the codes match.',
  'disconnect': 'Stop the side panel from talking to Job Hunt until you approve it again.',
  'correct this': 'Tell Job Hunt what is wrong with this description and it rewrites it.',
  'done with this one': 'Mark this as done and take it off today\'s list.',
  'needs me again': 'Put this back on your list.',
  'add a role yourself': 'Paste a posting or its address and Job Hunt reads it like one it found.',
  'make a topic for me': 'Claude suggests something worth posting about, from your own experience.',
  'write my arrival pack': 'Claude writes what to change for the Toronto market: CV wording, people to meet, first steps.',
  'write again': 'Claude writes this again from what is known now.',
  'try again': 'Load this page again.',
  'add': 'Start watching this site on every full search.',
  'skip': 'Leave this question for now. It may be asked again later.',
};
const BY_ACT = {
  placeon: 'Switch this place on or off. Off means Job Hunt does not look there.',
  pause: 'Pause or resume all searching. Nothing new is found while paused.',
  toggle: 'Switch this on or off.',
  addcv: 'Add a CV file. Claude reads it once so it can tailor it later.',
  oldhere: 'Copy your roles, CVs, people and settings from the old Job Hunt on this computer. The old app is not changed.',
};

function tip(el) {
  if (!el || el.title || el.getAttribute('aria-describedby')) return;
  if (el.tagName !== 'BUTTON' && !(el.tagName === 'A' && el.classList.contains('btn'))) return;
  const words = (el.textContent || '').trim().toLowerCase();
  const t = BY_WORDS[words] || BY_ACT[el.dataset.act || ''];
  if (t) el.title = t;
}
document.addEventListener('mouseover', ev => tip(ev.target.closest?.('button,[data-act],a.btn')));
document.addEventListener('focusin', ev => tip(ev.target.closest?.('button,[data-act],a.btn')));
