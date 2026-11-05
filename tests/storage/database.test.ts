import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundaries = vi.hoisted(() => ({
  getStoredKey: vi.fn(),
  storeKey: vi.fn(),
  randomBytes: vi.fn(),
  databaseFile: vi.fn(),
  openDatabase: vi.fn()
}))

vi.mock('expo-secure-store', () => ({ getItemAsync: boundaries.getStoredKey, setItemAsync: boundaries.storeKey }))
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: boundaries.randomBytes }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: boundaries.databaseFile }))
vi.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: '/database', openDatabaseAsync: boundaries.openDatabase }))

describe('encrypted database initialization', () => {
  beforeEach(() => {
    vi.resetModules()
    boundaries.getStoredKey.mockReset().mockResolvedValue(null)
    boundaries.storeKey.mockReset().mockResolvedValue(undefined)
    boundaries.randomBytes.mockReset().mockResolvedValue(new Uint8Array(32).fill(7))
    boundaries.databaseFile.mockReset().mockResolvedValue({ exists: false })
    boundaries.openDatabase.mockReset().mockImplementation(async () => ({
      execAsync: vi.fn().mockResolvedValue(undefined),
      getFirstAsync: vi.fn().mockImplementation(async (sql: string) => sql.includes('cipher_version') ? { cipher_version: '4.6.1' } : { user_version: 9 }),
      closeAsync: vi.fn().mockResolvedValue(undefined)
    }))
  })

  it('fresh concurrent startup stores one encryption key', async () => {
    const { openEncryptedDatabase } = await import('../../src/storage/database')
    const databases = await Promise.all(Array.from({ length: 12 }, () => openEncryptedDatabase()))
    await Promise.all(databases.map(database => database.closeAsync()))
    expect(boundaries.randomBytes).toHaveBeenCalledTimes(1)
    expect(boundaries.storeKey).toHaveBeenCalledTimes(1)
  })
})
