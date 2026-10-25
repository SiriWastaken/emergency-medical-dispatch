/**
 * Validation rules from the workbook's Validation sheet. Conditions are small and explicit:
 *   required | regex:<pattern> | one-of:<a,b,c> | integer:<min>-<max> | max-length:<n> | in-catalogue
 */
export interface Rule {
  id: string
  step: string
  condition: string
  message: string
}

export interface RuleContext {
  /** Valid chief-complaint labels, for `in-catalogue`. */
  catalogue?: ReadonlySet<string>
}

const SYNTAX = /^(required|in-catalogue|regex:.+|one-of:.+|integer:\d+-\d+|max-length:\d+)$/

/** Null when the condition is well formed, otherwise why not. */
export function conditionProblem(condition: string): string | null {
  if (!SYNTAX.test(condition)) return `Unknown condition "${condition}". Use required, regex:…, one-of:…, integer:min-max, max-length:n or in-catalogue.`
  if (condition.startsWith('regex:')) {
    try {
      new RegExp(condition.slice(6))
    } catch {
      return `Invalid regular expression in "${condition}"`
    }
  }
  return null
}

/** True when the value satisfies the condition. An empty value only fails `required`. */
export function satisfies(condition: string, value: string, ctx: RuleContext = {}): boolean {
  const v = value.trim()
  if (condition === 'required') return v !== ''
  if (v === '') return true
  if (condition === 'in-catalogue') return ctx.catalogue?.has(v) ?? false
  if (condition.startsWith('regex:')) return new RegExp(condition.slice(6)).test(v)
  if (condition.startsWith('one-of:')) return condition.slice(7).split(',').map((x) => x.trim()).includes(v)
  if (condition.startsWith('max-length:')) return v.length <= Number(condition.slice(11))
  const m = /^integer:(\d+)-(\d+)$/.exec(condition)
  return !!m && /^\d{1,4}$/.test(v) && +v >= +m[1]! && +v <= +m[2]!
}

/** The first failing rule's message for this step, or null. */
export function checkStep(rules: readonly Rule[], step: string, value: string, ctx?: RuleContext): string | null {
  for (const r of rules) if (r.step === step && !satisfies(r.condition, value, ctx)) return r.message
  return null
}
