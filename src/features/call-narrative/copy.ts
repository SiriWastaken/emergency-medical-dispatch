import { saveTextFile } from '@/app/files'
import { currentNarrative } from './current'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

const toast = (m: string) => useApp.getState().showToast(m)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function copyNarrative(): Promise<void> {
  const text = currentNarrative()
  if (text === null) return toast('No incident open')
  try {
    await navigator.clipboard.writeText(text)
    toast('Narrative copied to clipboard')
  } catch (e) {
    toast(`Copy failed: ${msg(e)}`)
  }
}

export async function saveNarrativeFile(): Promise<void> {
  const incident = useCase.getState().incident
  const text = currentNarrative()
  if (!incident || text === null) return toast('No incident open')
  try {
    const path = await saveTextFile(`${incident.id}-narrative.txt`, text + '\n')
    if (path) toast('Narrative saved')
  } catch (e) {
    toast(`Save failed: ${msg(e)}`)
  }
}
