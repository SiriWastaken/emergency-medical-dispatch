import { callTakingSchema, type CallTaking } from '@/domain/call-taking/schema'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import definition from './call-taking/definition.json'

/**
 * The call-taking definition generated from call-taking-workflow.xlsx (`pnpm workflow:build`).
 * It is checked again here, so a hand-edited or stale file can never run unvalidated.
 */
function load(): { data: CallTaking; issues: string[] } {
  const parsed = callTakingSchema.safeParse(definition)
  if (!parsed.success) return { data: definition as unknown as CallTaking, issues: parsed.error.issues.map((i) => `call-taking definition: ${i.path.join('.')} ${i.message}`) }
  const issues = parsed.data.workflows.flatMap((w) => {
    const v = validateWorkflow(w)
    return v.ok ? [] : v.issues.map((i) => `workflow "${w.id}": ${i.message}`)
  })
  return { data: parsed.data, issues }
}

export const { data: CALL_TAKING, issues: CALL_TAKING_ISSUES } = load()
