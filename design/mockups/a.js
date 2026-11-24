const IC = {
  today:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  radar:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/></svg>',
  roles:'<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>',
  people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M16 4.800a3.500 3.500 0 010 6.400M18.500 14.800c1.700.8 2.700 2.500 3 5.200"/></svg>',
  prep:'<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  prog:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  you:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.200 4-6 8-6s7 1.800 8 6"/></svg>',
};
const NAV = [['today','Today','3'],['radar','Radar','2','hot'],['roles','Roles','212'],['people','People','4'],['prep','Interviews','1'],['prog','Progress',''],['you','You','2']];
function ring(v, label, color){ const c=2*Math.PI*22, col=color||(v>=85?'#0B7A3B':v>=70?'#2F4FC4':'#8F5B00');
  return `<div class="ring"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="none" stroke="#E8EBF2" stroke-width="5"/><circle cx="27" cy="27" r="22" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c*v/100} ${c}" transform="rotate(-90 27 27)"/></svg><b>${v}</b><span>${label}</span></div>`; }
const rings = (a,b) => `<div class="rings">${ring(a,'Fit now')}${ring(b,'Tailored')}</div>`;
const lg = (t,c) => `<div class="lg" style="background:${c}">${t}</div>`;
function shell(id, title, sub, inner, work){
  return `<section class="screen" id="${id}" style="position:relative"><aside class="side"><div class="logo"><svg width="28" height="28" viewBox="0 0 64 64" style="flex:none"><defs><linearGradient id="lg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A5BD9"/><stop offset="1" stop-color="#22389A"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="14" fill="url(#lg${id})"/><path d="M25 19.500v-2.500a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2.500" fill="none" stroke="#fff" stroke-width="3.400" stroke-linecap="round"/><rect x="12" y="19.500" width="40" height="28" rx="5" fill="#fff"/><path d="M12 31h40" stroke="#22389A" stroke-width="2.400"/><rect x="28.500" y="28" width="7" height="6" rx="1.500" fill="#22389A"/><circle cx="48" cy="46" r="10" fill="#E9B949" stroke="#22389A" stroke-width="2.400"/><path d="m43.600 46.200 3 3 5.600-6" fill="none" stroke="#22389A" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/></svg>Job Hunt</div>${NAV.map(n=>`<div class="nav ${n[0]===id?'on':''}">${IC[n[0]]}${n[1]}${n[2]?`<b class="${n[3]||''}">${n[2]}</b>`:''}</div>`).join('')}
  <div class="sp"></div><div class="pilot"><h6><span class="dot"></span>Working now</h6><div style="display:flex;gap:6px;color:#fff;font-weight:600"><span style="flex:1">Searching</span><span style="font-weight:400;color:#C9D0E6">23%</span><span style="color:#FF9C9C">Stop</span></div><div style="color:#8F98B3">14 of 61 sources</div><div class="bar" style="margin-top:5px"><i style="width:23%"></i></div><div style="margin-top:7px;color:#8F98B3">Watching 61 sources · 38 Claude calls today</div><div style="margin-top:7px;padding-top:7px;border-top:1px solid #2A3555;color:#8F98B3">Job Hunt 26.11.22</div></div></aside>
  <div class="main"><div class="top"><h1>${title}</h1><span class="sub">${sub||''}</span><div class="find"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/></svg>Find a role, company or person<kbd>Ctrl K</kbd></div></div>${inner}</div><div class="sample">Sample data, for the design only</div></section>`;
}
const S = [];
