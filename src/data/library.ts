import { checkLibrary } from '@/domain/library'
import catalogue from './workflows/catalogue.json'
import index from './workflows/index.json'

// Bundled at build time: no network or filesystem access is needed to load the library.
const modules = import.meta.glob('./workflows/{ems,pd,fd}/*.json', { eager: true, import: 'default' })

export const LIBRARY = checkLibrary({
  workflows: Object.entries(modules).map(([path, data]) => ({ path: path.replace('./workflows/', ''), data })),
  catalogue,
  index,
})
