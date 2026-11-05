window.T = {
  setV(el, v) { const p = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value'); p.set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
  btn(t) { return [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t)); },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
};
'ok'
