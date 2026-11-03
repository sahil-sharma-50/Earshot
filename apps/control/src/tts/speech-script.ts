import type { AxNodeView } from '@earshot/shared';

const ROLE_WORDS: Record<string, string> = {
  button: 'button',
  link: 'link',
  img: 'image',
  image: 'image',
  textbox: 'edit text',
  searchbox: 'search edit text',
  combobox: 'combo box',
  listbox: 'list box',
  radio: 'radio button',
  checkbox: 'check box',
  switch: 'switch',
  tab: 'tab',
  menuitem: 'menu item',
  slider: 'slider',
  spinbutton: 'spin button',
  note: 'note',
  navigation: 'navigation',
  main: 'main',
  banner: 'banner',
  contentinfo: 'content info',
  form: 'form',
  list: 'list',
  listitem: 'list item',
};

const TEXT_ROLES = new Set(['StaticText', 'paragraph', 'text', 'LabelText', 'generic']);
const MAX = 1200;

/** A linear, screen-reader-style readout: "<name>, <role>[, <states>]." — unnamed items read as "<role>." */
export function speechScript(nodes: AxNodeView[]): string {
  const parts: string[] = [];
  let prevName = '';
  for (const n of nodes) {
    const name = n.name.replace(/\s+/g, ' ').trim();
    if (TEXT_ROLES.has(n.role)) {
      if (!name || name === prevName) continue;
      parts.push(`${name}.`);
      prevName = name;
      continue;
    }
    let states = [...n.states];
    let role = ROLE_WORDS[n.role] ?? n.role.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    if (n.role === 'heading') {
      const level = states.find((s) => s.startsWith('level '));
      role = level ? `heading ${level}` : 'heading';
      states = states.filter((s) => s !== level);
    }
    const tail = states.length ? `, ${states.join(', ')}` : '';
    parts.push(name ? `${name}, ${role}${tail}.` : `${role}${tail}.`);
    prevName = name;
  }
  const s = parts.join(' ');
  return s.length > MAX ? s.slice(0, MAX - 1).trimEnd() + '…' : s;
}
