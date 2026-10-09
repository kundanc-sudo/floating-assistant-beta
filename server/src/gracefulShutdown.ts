export interface GracefulShutdownOptions {
  deadlineMs: number
  stopBackgroundWork(): void
  closeSockets(): void
  closeServer(): Promise<void>
  closeDatabase(): Promise<void>
  log(message: string): void
  onDeadline(): void
}

export function createGracefulShutdown(options: GracefulShutdownOptions) {
  let pending: Promise<void> | null = null
  return (signal: string) => {
    if (pending) return pending
    pending = shutdown(signal)
    return pending
  }

  async function shutdown(signal: string) {
    options.log(`[SERVER] graceful shutdown started signal=${signal}`)
    options.stopBackgroundWork()
    options.closeSockets()
    const deadline = setTimeout(options.onDeadline, options.deadlineMs)
    deadline.unref()
    try {
      const failures: unknown[] = []
      await options.closeServer().catch((error) => failures.push(error))
      await options.closeDatabase().catch((error) => failures.push(error))
      if (failures.length > 0) throw new AggregateError(failures, 'Graceful shutdown failed.')
      options.log('[SERVER] graceful shutdown complete')
    } finally {
      clearTimeout(deadline)
    }
  }
}
