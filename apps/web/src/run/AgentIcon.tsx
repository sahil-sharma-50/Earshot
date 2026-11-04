import { Ear, Eye, Wrench } from 'lucide-react';
import type { AgentId } from '@earshot/shared';

export const toneOf = (id: AgentId) => (id === 'sighted' ? 'sighted' : id === 'blind' ? 'blind' : 'rerun');

export function AgentIcon({ id, size = 18 }: { id: AgentId; size?: number }) {
  const Icon = id === 'sighted' ? Eye : id === 'blind' ? Ear : Wrench;
  return <Icon size={size} aria-hidden className={`agent-icon tone-${toneOf(id)}`} />;
}
