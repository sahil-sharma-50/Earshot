export type AgentKind = 'sighted' | 'blind';
export type AgentId = 'sighted' | 'blind' | `rerun-${number}` | 'inspector';
export type RunMode = 'demo' | 'drill' | 'any-url';
export type MilestoneId = 'on_product_page' | 'grind_selected' | 'in_cart' | 'on_checkout'
  | 'details_entered' | 'on_review' | 'awaiting_final_approval';

export interface ElementIdentity { cssPath: string; backendNodeId: number; snippet: string /* outerHTML <= 300 chars */; isFinal: boolean; isFormSubmit: boolean }
export interface AxNodeView { ref: string; role: string; name: string; states: string[]; value?: string; actionable: boolean }
export interface BlindObservation { kind: 'blind'; url: string; title: string; nodes: AxNodeView[] }
export interface Mark { id: number; label: string; tag: string }
export interface SightedObservation { kind: 'sighted'; url: string; title: string; screenshotPng: string /* base64 */; marks: Mark[] }
export type Observation = BlindObservation | SightedObservation;

export type PressKey = 'Tab' | 'Shift+Tab' | 'Enter' | 'Space' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Escape';
export const PRESS_KEYS: readonly PressKey[] = ['Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'];
export type Action =
  | { type: 'click'; target: string }            // blind: ref "a12", sighted: mark "7"
  | { type: 'type'; target: string; text: string }
  | { type: 'select'; target: string; option: string }
  | { type: 'press'; key: PressKey }
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'navigate'; url: string }
  | { type: 'done'; reason: string }
  | { type: 'stuck'; reason: string };

export interface ActResult { ok: boolean; error?: 'not-actionable' | 'unknown-target' | 'timeout' | 'navigation-blocked' | string; element?: ElementIdentity }

export interface StoreState { page: 'home' | 'product' | 'cart' | 'checkout' | 'review' | 'confirmation'; grind: string | null; cart: { sku: string; size: string; grind: string }[]; checkoutValid: boolean; orderPlaced: boolean }
export interface Probe { url: string; domHash: string; store: StoreState | null }

export type FailureCategory = 'not-exposed' | 'no-name' | 'wrong-role' | 'not-keyboard-operable' | 'unlabeled-field';
export interface ElementReport { identity: ElementIdentity; inAxTree: boolean; axRole: string | null; axName: string; focusable: boolean; tabReachable: boolean; keyActivates: boolean | null; hasProgrammaticLabel: boolean | null; axeViolations: { id: string; impact: string; tags: string[] }[] }
export interface Finding { id: string; runId: string; milestone: MilestoneId | string; element: ElementIdentity; categories: FailureCategory[]; axeRules: string[]; wcag: string[]; confirmed: boolean; evidence: { sightedStep: number; blindLastStep: number; blindExcerpt: AxNodeView[] }; status: 'open' | 'fixing' | 'verified' | 'unverified' }

export type PatchAttribute = 'role' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'tabindex' | 'aria-checked' | 'aria-pressed';
export const PATCH_ATTRIBUTES: readonly PatchAttribute[] = ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'tabindex', 'aria-checked', 'aria-pressed'];
export interface Patch { findingId: string; selector: string; attributes: Partial<Record<PatchAttribute, string>>; keyboardShim: boolean }

export interface SandboxLimits { memoryBytes: number; nanoCpus: number; pidsLimit: number; runtime: string; timeoutMs: number }

export const ACTIONABLE_ROLES: readonly string[] = ['button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'slider', 'spinbutton', 'treeitem'];

export type AgentOutcome = 'gate' | 'done' | 'stuck' | 'timeout' | 'max-steps' | 'no-progress' | 'error' | 'stopped';
export type RunPhase = 'queued' | 'running' | 'awaiting-fix' | 'fixing' | 'finished';

export type RunEvent =
  | { t: 'run.created'; runId: string; mode: RunMode; goal: string; target: string }
  | { t: 'run.queued'; runId: string; position: number }
  | { t: 'sandbox.created'; runId: string; agent: AgentId; containerId: string; limits: SandboxLimits }
  | { t: 'sandbox.destroyed'; runId: string; agent: AgentId; containerId: string; reason: 'finished' | 'timeout' | 'error' | 'stopped' }
  | { t: 'step'; runId: string; agent: AgentId; index: number; url: string; reasoning: string; action: Action; result: ActResult; shotId?: string; axExcerpt?: AxNodeView[]; milestones: MilestoneId[] }
  | { t: 'agent.finished'; runId: string; agent: AgentId; outcome: AgentOutcome; milestones: MilestoneId[] }
  | { t: 'containment.blocked'; runId: string; agent: AgentId; method: string; host: string; path: string; reason: string }
  | { t: 'injection.flagged'; runId: string; agent: AgentId; text: string }
  | { t: 'approval.requested'; runId: string; agent: AgentId; approvalId: string; element: ElementIdentity }
  | { t: 'approval.resolved'; runId: string; approvalId: string; decision: 'approved' | 'denied' | 'timeout' }
  | { t: 'finding'; finding: Finding }
  | { t: 'fix.result'; runId: string; findingId: string; attempt: number; patch: Patch; diff: string; verified: boolean }
  | { t: 'run.phase'; runId: string; phase: RunPhase; fixDeadlineAt?: number }
  | { t: 'run.paused'; runId: string; resumeAt: number }
  | { t: 'run.resumed'; runId: string; by: 'user' | 'auto' }
  | { t: 'run.finished'; runId: string; verified: boolean; error?: string };
