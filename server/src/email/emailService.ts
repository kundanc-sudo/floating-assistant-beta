export interface EmailService {
  sendPasswordReset(input: { email: string; displayName: string; resetUrl: string }): Promise<void>
  sendEmailVerification(input: { email: string; displayName: string; verificationUrl: string }): Promise<void>
}

export class ConsoleEmailService implements EmailService {
  constructor(private readonly enabled: boolean) {}

  async sendPasswordReset(input: { email: string; resetUrl: string }) {
    if (this.enabled) console.info(`[EMAIL:DEV] password reset recipient=${input.email} token=omitted`)
  }

  async sendEmailVerification(input: { email: string; verificationUrl: string }) {
    if (this.enabled) console.info(`[EMAIL:DEV] verification recipient=${input.email} token=omitted`)
  }
}

export class WebhookEmailService implements EmailService {
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly from: string,
  ) {}

  sendPasswordReset(input: { email: string; displayName: string; resetUrl: string }) {
    return this.send({
      to: input.email,
      subject: 'Reset your Floating Assistant password',
      text: `Hello ${input.displayName},\n\nReset your password using this one-time link:\n${input.resetUrl}\n\nIf you did not request this, ignore this email.`,
    })
  }

  sendEmailVerification(input: { email: string; displayName: string; verificationUrl: string }) {
    return this.send({
      to: input.email,
      subject: 'Verify your Floating Assistant email',
      text: `Hello ${input.displayName},\n\nVerify your email using this one-time link:\n${input.verificationUrl}`,
    })
  }

  private async send(message: { to: string; subject: string; text: string }) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, ...message }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Email provider failed with HTTP ${response.status}.`)
  }
}

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export class ResendEmailService implements EmailService {
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number

  constructor(
    private readonly key: string,
    private readonly from: string,
    options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  sendPasswordReset(input: { email: string; displayName: string; resetUrl: string }) {
    return this.send({
      to: input.email,
      subject: 'Reset your Floating Assistant password',
      text: `Hello ${input.displayName},\n\nReset your password using this one-time link:\n${input.resetUrl}\n\nIf you did not request this, ignore this email.`,
    })
  }

  sendEmailVerification(input: { email: string; displayName: string; verificationUrl: string }) {
    return this.send({
      to: input.email,
      subject: 'Verify your Floating Assistant email',
      text: `Hello ${input.displayName},\n\nVerify your email using this one-time link:\n${input.verificationUrl}`,
    })
  }

  private async send(message: { to: string; subject: string; text: string }) {
    const signal = AbortSignal.timeout(this.timeoutMs)
    let response: Response
    try {
      response = await this.fetcher(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal,
      })
    } catch {
      if (signal.aborted) throw new Error('Email provider request timed out.')
      throw new Error('Email provider request failed.')
    }
    if (!response.ok) throw new Error(`Email provider rejected request with HTTP ${response.status}.`)
  }
}

export class TestEmailService implements EmailService {
  passwordResetUrl = ''
  verificationUrl = ''
  async sendPasswordReset(input: { resetUrl: string }) { this.passwordResetUrl = input.resetUrl }
  async sendEmailVerification(input: { verificationUrl: string }) { this.verificationUrl = input.verificationUrl }
}
