interface AttemptWindow {
  count: number
  resetsAt: number
}

export class RateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>()

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string) {
    const now = Date.now()
    const current = this.attempts.get(key)
    if (!current || current.resetsAt <= now) {
      this.attempts.set(key, { count: 1, resetsAt: now + this.windowMs })
      return true
    }
    current.count += 1
    return current.count <= this.maximum
  }

  cleanup() {
    const now = Date.now()
    for (const [key, attempt] of this.attempts) {
      if (attempt.resetsAt <= now) this.attempts.delete(key)
    }
  }
}
