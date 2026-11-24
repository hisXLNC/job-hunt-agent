// Stand-ins for how the hiring systems' own widgets behave, for the test pages
// in this folder. None of this ships with the side panel.
window.sends = 0;   // how often a form was sent
window.pressed = []; // buttons that must never be pressed by Job Hunt

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

// A box as React keeps one: what it holds only counts once the page has heard an
// "input" event; anything else is put back when the box loses focus.
function controlled(input) {
  let v = input.value;
  input.addEventListener('input', () => { v = input.value; });
  input.addEventListener('focusout', () => { if (input.value !== v) input.value = v; });
  input.heard = () => v;
  return input;
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-c]').forEach(controlled);
  // Count every form that is sent, and never leave the page.
  document.addEventListener('submit', e => { window.sends++; e.preventDefault(); });
  document.querySelectorAll('[data-never]').forEach(b => b.addEventListener('click', () => window.pressed.push(b.textContent.trim())));
});

let openList = null;
function closeList() { if (openList) { openList.remove(); openList = null; } }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeList(); });
document.addEventListener('mousedown', e => { if (openList && !openList.contains(e.target) && !e.target.closest('[aria-haspopup],[data-opens]')) closeList(); });

// A dropdown made of a button and a list that is only on the page while open
// (Workday's "Select One", Zoho's lists).
function listbox(button, options, opts) {
  opts = opts || {};
  button.addEventListener('click', () => {
    if (openList && openList.owner === button) { closeList(); return; }
    closeList();
    const list = el(opts.tag || 'ul', { role: 'listbox' }, options.map(o => el(opts.item || 'li', { role: 'option' }, o)));
    list.owner = button;
    list.style.cssText = 'position:absolute;background:#fff;border:1px solid #999;max-height:120px;overflow:auto;margin:0;padding:0;list-style:none';
    list.addEventListener('click', e => {
      const o = e.target.closest('[role=option]');
      if (!o) return;
      (opts.label ? button.querySelector(opts.label) : button).textContent = o.textContent;
      button.dataset.value = o.textContent;
      closeList();
      if (opts.onpick) opts.onpick(o.textContent);
    });
    document.body.append(list);
    openList = list;
  });
}

// Workday's box that takes items from its own list: type, press Enter, choose.
function wdPrompt(input, options, multi) {
  const holder = input.closest('[data-automation-id=multiselectInputContainer]');
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    closeList();
    const q = input.value.trim().toLowerCase();
    const hits = options.filter(o => o.toLowerCase().includes(q));
    const list = el('div', { 'data-automation-id': 'activeListContainer', role: 'listbox' },
      hits.length ? hits.map(o => el('div', { 'data-automation-id': 'promptOption', 'data-automation-label': o, role: 'option' }, o)) : el('div', { 'data-automation-id': 'promptOption', role: 'option' }, 'No Items.'));
    list.owner = input;
    list.addEventListener('click', ev => {
      const o = ev.target.closest('[data-automation-label]');
      if (!o) return;
      if (!multi) holder.querySelectorAll('[data-automation-id=selectedItem]').forEach(x => x.remove());
      holder.insertBefore(el('div', { 'data-automation-id': 'selectedItem' }, o.getAttribute('data-automation-label')), input);
      input.value = '';
      closeList();
    });
    document.body.append(list);
    openList = list;
  });
}
const chosenIn = id => [...document.querySelectorAll(`[data-automation-id="formField-${id}"] [data-automation-id=selectedItem]`)].map(x => x.textContent);

// react-select, as Greenhouse draws every list: an input inside a control; the
// menu opens on mousedown, filters as you type, and closes when a choice is made.
// `late`: the choices come from a server a moment after typing (a place, a school).
function reactSelect(id, label, options, late) {
  const input = el('input', { class: 'select__input', id, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-labelledby': id + '-label', type: 'text' });
  const value = el('div', { class: 'select__value-container' }, el('div', { class: 'select__placeholder' }, 'Select...'), el('div', { class: 'select__input-container' }, input));
  const control = el('div', { class: 'select__control' }, value, el('div', { class: 'select__indicators' }, el('button', { type: 'button', 'aria-label': 'Toggle flyout', tabindex: '-1' }, '▾')));
  const box = el('div', { class: 'select__container' }, el('label', { id: id + '-label', for: id, class: 'select__label' }, label),
    el('div', { class: 'select-shell' }, control, el('input', { 'aria-hidden': 'true', tabindex: '-1', class: 'requiredInput', required: true })));
  let menu = null, timer = 0;
  const close = () => { if (menu) { menu.remove(); menu = null; } input.setAttribute('aria-expanded', 'false'); };
  const draw = () => {
    close();
    const q = input.value.trim().toLowerCase();
    if (late && !q) return;
    const hits = options.filter(o => o.toLowerCase().includes(q));
    menu = el('div', { class: 'select__menu' }, el('div', { class: 'select__menu-list', role: 'listbox' }, hits.length ? hits.map(o => el('div', { class: 'select__option', role: 'option' }, o)) : el('div', { class: 'select__menu-notice' }, 'No options')));
    menu.addEventListener('click', e => {
      const o = e.target.closest('.select__option');
      if (!o) return;
      value.querySelectorAll('.select__placeholder,.select__single-value').forEach(x => x.remove());
      value.prepend(el('div', { class: 'select__single-value' }, o.textContent));
      box.dataset.value = o.textContent;
      input.value = '';
      close();
    });
    box.querySelector('.select-shell').append(menu);
    input.setAttribute('aria-expanded', 'true');
  };
  control.addEventListener('mousedown', () => { if (menu) close(); else draw(); });
  input.addEventListener('input', () => { clearTimeout(timer); if (late) { close(); timer = setTimeout(draw, 300); } else draw(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return box;
}
