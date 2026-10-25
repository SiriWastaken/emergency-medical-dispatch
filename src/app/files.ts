import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

/** Asks where to save, then writes. Resolves to the chosen path, or null if the user cancelled. */
export async function saveTextFile(defaultName: string, text: string): Promise<string | null> {
  const path = await save({ defaultPath: defaultName })
  if (!path) return null
  await writeTextFile(path, text)
  return path
}
