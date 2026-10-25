import { tauriDb, type Db } from '@/persistence/db'

let current: Db = tauriDb
export const getDb = () => current
/** Tests swap in an in-memory database before booting the app. */
export const setDb = (db: Db) => {
  current = db
}
