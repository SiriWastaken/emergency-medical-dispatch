/** A tiny builder that turns question trees written in code into the workbook's Questions / Branches / Validation / Workflows rows. */
export type Row = string[]

export interface Q {
  /** Local id; the workbook id is `<tree prefix>-<id>`. */
  id: string
  text: string
  choices?: string[]
  input?: 'integer' | 'text'
  field?: string
  required?: boolean
  /** integer questions: inclusive range, enforced by a Validation rule. */
  range?: [number, number]
  /** Where each answer goes: `q:<local id>` or `t:<terminal key>`. `(unknown)` etc. route non-answers; `(answered)` a typed answer. */
  to: Record<string, string>
  /** Conditional routes: when `<local id>=<answer>`, this answer goes elsewhere. */
  when?: { answer: string; cond: string; to: string }[]
}

export interface Terminal {
  outcome: string
  instruction?: string
}

export class Tree {
  readonly questions: Q[] = []
  readonly terminals = new Map<string, Terminal>()
  constructor(
    readonly id: string,
    readonly type: 'EMS' | 'PD' | 'FD',
    /** A chief-complaint label, or `*` for any complaint of the type. */
    readonly complaint: string,
    readonly name: string,
    readonly stage = 'Key Questions',
  ) {}
  q(q: Q): this {
    this.questions.push(q)
    return this
  }
  term(key: string, outcome: string, instruction?: string): this {
    this.terminals.set(key, { outcome, ...(instruction && { instruction }) })
    return this
  }
  private full = (local: string) => `${this.id}-${local}`
  private target(t: string, where: string): string {
    if (t.startsWith('q:')) {
      const local = t.slice(2)
      if (!this.questions.some((q) => q.id === local)) throw new Error(`${where}: unknown question "${local}"`)
      return this.full(local)
    }
    const key = t.slice(2)
    if (!t.startsWith('t:') || !this.terminals.has(key)) throw new Error(`${where}: unknown terminal "${t}"`)
    return `TERMINAL:${key}`
  }
  private branch(qid: string, answer: string, t: string, cond = ''): Row {
    const target = this.target(t, `${this.id}/${qid}`)
    const term = target.startsWith('TERMINAL:') ? this.terminals.get(target.slice(9))! : undefined
    const condition = cond.replace(/^([^=]+)=/, (_m, local: string) => `${this.full(local.trim())}=`)
    return [this.full(qid), answer, target, term?.outcome ?? '', term?.instruction ?? '', condition]
  }
  rows() {
    const questions: Row[] = []
    const branches: Row[] = []
    const validation: Row[] = []
    for (const q of this.questions) {
      const typed = q.input
      questions.push([this.full(q.id), this.type, this.complaint, q.text, (q.choices ?? []).join('|'), q.required === false ? 'No' : 'Yes', this.stage, typed ?? 'choice', q.field ?? ''])
      for (const [answer, t] of Object.entries(q.to)) branches.push(this.branch(q.id, answer, t))
      for (const w of q.when ?? []) branches.push(this.branch(q.id, w.answer, w.to, w.cond))
      if (q.input === 'integer' && q.range) {
        validation.push([`V-${this.full(q.id)}`, this.full(q.id), `integer:${q.range[0]}-${q.range[1]}`, `Enter a whole number from ${q.range[0]} to ${q.range[1]}.`])
      }
    }
    const workflow: Row = [this.id, this.type, this.complaint, this.name, 'COMPLETE - ROLEPLAY', this.full(this.questions[0]!.id), 'Roleplay training content written for this project', 'Realistic but not a real dispatch protocol.']
    return { questions, branches, validation, workflow }
  }
}

export const CHOICES = {
  yn: ['Yes', 'No'],
}
