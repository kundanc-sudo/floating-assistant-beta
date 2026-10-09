import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { ProductStorage } from './productShellService'

export class EncryptedProductStorage implements ProductStorage {
  constructor(
    private readonly directory: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  async load(): Promise<unknown> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure OS credential storage is unavailable.')
    }
    try {
      const encrypted = await readFile(this.filePath)
      const plaintext = safeStorage.decryptString(encrypted)
      return JSON.parse(plaintext) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('[PRODUCT] encrypted local data could not be loaded; starting clean')
      }
      return null
    }
  }

  async save(value: unknown): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure OS credential storage is unavailable.')
    }
    await mkdir(this.directory, { recursive: true })
    const encrypted = safeStorage.encryptString(JSON.stringify(value))
    await writeFile(this.filePath, encrypted, { mode: 0o600 })
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
  }

  private get filePath(): string {
    return path.join(this.directory, 'product-data.bin')
  }
}
