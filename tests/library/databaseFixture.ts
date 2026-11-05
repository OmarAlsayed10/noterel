import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

function memoryDatabase(filename: string) {
  const sqlite = new DatabaseSync(filename)
  return {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, ...parameters: SQLInputValue[]) => sqlite.prepare(sql).run(...parameters),
    getFirstAsync: async (sql: string, ...parameters: SQLInputValue[]) => sql.includes('cipher_version') ? { cipher_version: 'test-boundary' } : sqlite.prepare(sql).get(...parameters) ?? null,
    getAllAsync: async (sql: string, ...parameters: SQLInputValue[]) => sqlite.prepare(sql).all(...parameters),
    withTransactionAsync: async (run: () => Promise<void>) => {
      sqlite.exec('BEGIN')
      try { await run(); sqlite.exec('COMMIT') } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
    closeAsync: async () => sqlite.close()
  }
}

export const sqliteBoundary = (filename = ':memory:') => ({ openDatabaseAsync: async () => memoryDatabase(filename) })
