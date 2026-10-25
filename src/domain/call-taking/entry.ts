import type { IntakeStep } from '@/domain/incident-types'
import type { FieldValue } from '@/types/incident'
import { satisfies, type Rule, type RuleContext } from './rules'

const rulesFor = (rules: readonly Rule[], step: IntakeStep) => step.validation.flatMap((id) => rules.filter((r) => r.id === id))

/**
 * What stops a case-entry answer from being accepted. A non-answer the call-taker chose on purpose
 * (unknown, not asked, not applicable) is always accepted. Returns the rule's message, or null.
 * `showRequired` controls whether an empty required answer is reported yet.
 */
export function entryProblem(rules: readonly Rule[], step: IntakeStep, field: FieldValue, ctx: RuleContext, showRequired = true): string | null {
  if (field.state === 'unknown' || field.state === 'not_asked' || field.state === 'not_applicable') return null
  const own = rulesFor(rules, step)
  if (!field.value.trim()) {
    if (!step.required || !showRequired) return null
    return own.find((r) => r.condition === 'required')?.message ?? 'An answer is required. If it cannot be given, mark it Unknown.'
  }
  return own.find((r) => r.condition !== 'required' && !satisfies(r.condition, field.value, ctx))?.message ?? null
}
