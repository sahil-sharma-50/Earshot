import { DEMO_MILESTONES } from './milestones.js';
import type { ActResult, AgentOutcome, ElementIdentity, MilestoneId, RunMode } from './types.js';

/**
 * Run mode policy: everything that differs between the store journey (demo, drill) and the
 * any-url beta. Control and web both ask it; neither branches on the mode itself.
 */

export interface Checkpoint { id: MilestoneId; label: string }
/** What a journey recorded, as attribution needs it (control's AgentResult fits this shape). */
export interface JourneyStep { index: number; result: ActResult; milestonesAfter: MilestoneId[] }
export interface Journey { outcome: AgentOutcome; milestones: MilestoneId[]; steps: JourneyStep[] }
/** The checkpoint the blind agent missed, and the sighted step whose element got past it. */
export interface Divergence { checkpoint: MilestoneId; sightedStepIndex: number }
/** An agent's progress so far: cumulative milestones, steps taken, and its outcome once it ended. */
export interface Progress { milestones: readonly MilestoneId[]; steps: number; outcome?: AgentOutcome }

export interface RunModePolicy {
  /** The checkpoints viewers see, in journey order. */
  readonly checkpoints: readonly Checkpoint[];
  /** A checkpoint's name in this mode's words. */
  label(id: MilestoneId): string;
  /** How many of `checkpoints` an agent has reached. */
  reached(p: Progress): number;
  /** Acting on this element ends the journey at the approval gate. */
  gatesOn(el: ElementIdentity): boolean;
  /** This agent outcome completes the goal. */
  succeeded(outcome: AgentOutcome): boolean;
  /** Confirmed findings may go on to Fix & verify. */
  readonly fixable: boolean;
  /** Where the blind journey first fell short of the sighted one, or null when it did not. */
  divergence(sighted: Journey, blind: Journey): Divergence | null;
}

const STORE_LABEL: Record<MilestoneId, string> = {
  on_product_page: 'Product page',
  grind_selected: 'Grind chosen',
  in_cart: 'In cart',
  on_checkout: 'Checkout',
  details_entered: 'Details entered',
  on_review: 'Review',
  awaiting_final_approval: 'Place order',
};

/** Store journey: checkpoints come from the store's real state. */
const store: RunModePolicy = {
  checkpoints: DEMO_MILESTONES.map((id) => ({ id, label: STORE_LABEL[id] })),
  label: (id) => STORE_LABEL[id],
  reached: (p) => p.milestones.length,
  gatesOn: (el) => el.isFinal,
  succeeded: (o) => o === 'gate',
  fixable: true,
  divergence(sighted, blind) {
    const checkpoint = DEMO_MILESTONES.find((m) => sighted.milestones.includes(m) && !blind.milestones.includes(m));
    if (!checkpoint) return null;
    const pos = sighted.steps.findIndex((s) => s.milestonesAfter.includes(checkpoint));
    if (pos < 0) return null;
    // the element that passed the checkpoint: this step's, or the nearest earlier element action.
    // The final purchase button never explains an earlier checkpoint (its probe merely observed it late).
    for (let i = pos; i >= 0; i--) {
      const el = sighted.steps[i]!.result.element;
      if (!el) continue;
      if (el.isFinal && checkpoint !== 'awaiting_final_approval') continue;
      return { checkpoint, sightedStepIndex: sighted.steps[i]!.index };
    }
    return null;
  },
};

/**
 * Any URL: no store state to read, so there are two checkpoints. Start is reached on the first
 * step; Submit is reached at the gate, which a form submit also triggers.
 */
const ANY_URL_LABEL: Partial<Record<MilestoneId, string>> = { on_product_page: 'Start', awaiting_final_approval: 'Submit' };
const anyUrl: RunModePolicy = {
  checkpoints: [{ id: 'on_product_page', label: 'Start' }, { id: 'awaiting_final_approval', label: 'Submit' }],
  label: (id) => ANY_URL_LABEL[id] ?? STORE_LABEL[id],
  reached: (p) => (p.milestones.includes('awaiting_final_approval') || p.outcome === 'gate' ? 2 : p.steps > 0 ? 1 : 0),
  gatesOn: (el) => el.isFinal || el.isFormSubmit,
  succeeded: (o) => o === 'gate' || o === 'done',
  fixable: false,
  divergence(sighted, blind) {
    if (anyUrl.succeeded(blind.outcome)) return null;
    // the first element the sighted agent operated that the blind agent never reached; it blocks Submit
    const blindPaths = new Set(blind.steps.map((s) => s.result.element?.cssPath).filter(Boolean));
    const step = sighted.steps.find((s) => s.result.ok && s.result.element && !blindPaths.has(s.result.element.cssPath));
    return step ? { checkpoint: 'awaiting_final_approval', sightedStepIndex: step.index } : null;
  },
};

/** The policy for a run mode. Before the mode is known (no `run.created` yet) it is the store journey. */
export function modePolicy(mode: RunMode | undefined): RunModePolicy {
  return mode === 'any-url' ? anyUrl : store;
}
