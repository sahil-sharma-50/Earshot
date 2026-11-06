// The home page: the run launcher (demo, prompt-injection test, any URL), its tabs, and the one scroll motion.
import '@fontsource-variable/inter';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource-variable/jetbrains-mono';
import './home.css';
import { createRun } from './api.js';

type Mode = 'demo' | 'drill' | 'any-url';

/* ---------------------------------------------------------------- launcher tabs */

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
function select(tab: HTMLButtonElement, focus = false): void {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')!)!.hidden = !on;
  }
  showError(null);
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length]!, true); }
  });
});

/* ---------------------------------------------------------------- starting a run */

const errorLine = document.querySelector<HTMLElement>('[data-start-error]');
function showError(msg: string | null): void {
  if (!errorLine) return;
  errorLine.textContent = msg ?? '';
  errorLine.hidden = !msg;
}

// a wrong or missing access code is shown on the field itself, not in the general error line
const codeInput = document.querySelector<HTMLInputElement>('#any-code');
const codeError = document.querySelector<HTMLElement>('[data-code-error]');
function showCodeError(msg: string | null): void {
  if (!codeInput || !codeError) return;
  codeError.textContent = msg ?? '';
  codeError.hidden = !msg;
  if (msg) codeInput.setAttribute('aria-invalid', 'true'); else codeInput.removeAttribute('aria-invalid');
}
codeInput?.addEventListener('input', () => showCodeError(null));

let busy = false;
async function start(trigger: HTMLButtonElement, body: { mode: Mode; url?: string; goal?: string; accessCode?: string }): Promise<void> {
  if (busy) return;
  busy = true;
  showError(null);
  showCodeError(null);
  trigger.setAttribute('aria-busy', 'true');
  try {
    const runId = await createRun(body);
    location.assign(`/run/${runId}`);
  } catch (e) {
    busy = false;
    trigger.removeAttribute('aria-busy');
    const err = e as Error & { field?: string };
    if (err.field === 'accessCode' && codeInput) {
      showCodeError(err.message);
      codeInput.focus();
      codeInput.select();
    } else {
      showError(err.message);
    }
  }
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-start]')) {
  btn.addEventListener('click', () => void start(btn, { mode: btn.dataset.start as Mode }));
}

const form = document.querySelector<HTMLFormElement>('form[data-any-url]');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(form);
  void start(form.querySelector<HTMLButtonElement>('button[type="submit"]')!, {
    mode: 'any-url', url: String(f.get('url') ?? ''), goal: String(f.get('goal') ?? ''), accessCode: String(f.get('code') ?? ''),
  });
});

// back from a run page with the browser's back button: the page may come from the bfcache mid-click
addEventListener('pageshow', () => {
  busy = false;
  for (const b of document.querySelectorAll('[aria-busy="true"]')) b.removeAttribute('aria-busy');
});

/* ---------------------------------------------------------------- scroll */

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// in-page links glide (CSS scroll-behavior); the launcher takes focus when "Try the demo" lands on it
for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href="#start"]')) {
  a.addEventListener('click', () => setTimeout(() => document.getElementById('start')?.focus({ preventScroll: true }), calm ? 0 : 450));
}

// sections play their entrance once as they arrive; without script or with reduced motion they simply stand
if (!calm && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('motion');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -15% 0px' });
  for (const el of document.querySelectorAll('.reveal, [data-play]')) io.observe(el);
}

// the nav keeps an underline under the section you're reading
const navLinks = new Map<string, HTMLAnchorElement>();
for (const a of document.querySelectorAll<HTMLAnchorElement>('.top__nav a[href^="#"]')) navLinks.set(a.hash.slice(1), a);
if ('IntersectionObserver' in window) {
  const spy = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const link = navLinks.get(en.target.id);
      if (!link) continue;
      if (en.isIntersecting) {
        for (const l of navLinks.values()) l.removeAttribute('aria-current');
        link.setAttribute('aria-current', 'location');
      } else if (link.hasAttribute('aria-current')) {
        link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of navLinks.keys()) { const s = document.getElementById(id); if (s) spy.observe(s); }
}
