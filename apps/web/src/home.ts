// The Home page's one script of its own: start a run from any "Try the demo" / drill button or the
// any-URL form, then open the run page with a full load (the run view is its own page, run.html).
import { createRun } from './api.js';

type Mode = 'demo' | 'drill' | 'any-url';

let busy = false;

function errorLineFor(el: Element): HTMLElement | null {
  const scope = el.closest('.hero__text, .closing__cta, form') ?? document.querySelector('.hero__text');
  return scope?.querySelector<HTMLElement>('[data-start-error]') ?? null;
}

async function start(trigger: HTMLButtonElement, body: Parameters<typeof createRun>[0]): Promise<void> {
  if (busy) return;
  busy = true;
  const line = errorLineFor(trigger);
  if (line) line.hidden = true;
  trigger.setAttribute('aria-busy', 'true');
  try {
    const runId = await createRun(body);
    location.assign(`/run/${runId}`);
  } catch (e) {
    busy = false;
    trigger.removeAttribute('aria-busy');
    if (line) { line.textContent = (e as Error).message; line.hidden = false; }
  }
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-start]')) {
  btn.addEventListener('click', () => void start(btn, { mode: btn.dataset.start as Mode }));
}

const form = document.querySelector<HTMLFormElement>('form[data-any-url]');
form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  void start(submit, { mode: 'any-url', url: String(f.get('url') ?? ''), goal: String(f.get('goal') ?? ''), accessCode: String(f.get('code') ?? '') });
});

// back from a run page with the browser's back button: the page may come from the bfcache mid-click
addEventListener('pageshow', () => {
  busy = false;
  for (const b of document.querySelectorAll('[aria-busy="true"]')) b.removeAttribute('aria-busy');
});
