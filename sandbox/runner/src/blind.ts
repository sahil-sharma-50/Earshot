import type { CDPSession } from 'playwright';
import { ACTIONABLE_ROLES, type AxNodeView } from '@earshot/shared';

export const MAX_NODES = 250;

interface RawAxNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export interface BlindRef { backendNodeId: number; actionable: boolean; role: string; name: string }

const DROP_ROLES = new Set(['InlineTextBox', 'LineBreak', 'RootWebArea', 'WebArea']);
const KEEP_UNNAMED = new Set(['img', 'image', 'button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'searchbox', 'listbox', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem']);

function statesOf(n: RawAxNode): string[] {
  const states: string[] = [];
  for (const p of n.properties ?? []) {
    const v = p.value?.value;
    switch (p.name) {
      case 'focused': if (v) states.push('focused'); break;
      case 'disabled': if (v) states.push('disabled'); break;
      case 'checked': if (v === 'true' || v === true) states.push('checked'); else if (v === 'mixed') states.push('mixed'); else states.push('not checked'); break;
      case 'pressed': if (v === 'true' || v === true) states.push('pressed'); break;
      case 'selected': if (v) states.push('selected'); break;
      case 'expanded': states.push(v ? 'expanded' : 'collapsed'); break;
      case 'required': if (v) states.push('required'); break;
      case 'invalid': if (v && v !== 'false') states.push('invalid'); break;
      case 'level': states.push(`level ${v}`); break;
    }
  }
  return states;
}

/** Full AX tree → flattened, document-ordered, screen-reader-relevant nodes with refs. */
export async function observeAx(cdp: CDPSession, rootBackendId?: number): Promise<{ nodes: AxNodeView[]; refs: Map<string, BlindRef> }> {
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree', {})) as unknown as { nodes: RawAxNode[] };
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const out: AxNodeView[] = [];
  const refs = new Map<string, BlindRef>();
  let inScope = rootBackendId === undefined;

  const walk = (n: RawAxNode | undefined, parentName: string) => {
    if (!n || out.length >= MAX_NODES) return;
    const wasInScope = inScope;
    if (!inScope && n.backendDOMNodeId === rootBackendId) inScope = true;
    const role = String(n.role?.value ?? '');
    const name = String(n.name?.value ?? '').trim();
    let keep = inScope && !n.ignored && !DROP_ROLES.has(role);
    if (keep && (role === 'generic' || role === 'none' || role === 'presentation') && !name) keep = false;
    if (keep && !name && !KEEP_UNNAMED.has(role) && !ACTIONABLE_ROLES.includes(role)) keep = false;
    // StaticText that only repeats its parent's accessible name is noise (e.g. a button's label).
    if (keep && role === 'StaticText' && name === parentName) keep = false;
    if (keep && role === 'MenuListPopup') keep = false;
    let nextParentName = parentName;
    if (keep) {
      const states = statesOf(n);
      const actionable = ACTIONABLE_ROLES.includes(role) && !states.includes('disabled') && n.backendDOMNodeId !== undefined;
      const ref = `a${out.length + 1}`;
      const view: AxNodeView = { ref, role, name, states, actionable };
      const v = n.value?.value;
      if (v !== undefined && v !== null && String(v) !== '') view.value = String(v);
      out.push(view);
      if (n.backendDOMNodeId !== undefined) refs.set(ref, { backendNodeId: n.backendDOMNodeId, actionable, role, name });
      nextParentName = name || parentName;
    } else if (!n.ignored && name) {
      nextParentName = name;
    }
    for (const c of n.childIds ?? []) walk(byId.get(c), nextParentName);
    if (!wasInScope && n.backendDOMNodeId === rootBackendId) inScope = false;
  };
  walk(root, '');
  return { nodes: out, refs };
}
