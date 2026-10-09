import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne, sql, sum } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'
import { databaseConnectionString } from './databaseConnection.js'
import type { ProductStore } from './store.js'

export function createPostgresStore(databaseUrl: string, options: { max?: number; connectionTimeoutMillis?: number; idleTimeoutMillis?: number; sslMode?: 'url' | 'require' } = {}) {
  const pool = new Pool({
    connectionString: databaseConnectionString(databaseUrl, options.sslMode ?? 'url'),
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
  })
  const db = drizzle(pool, { schema })
  const store: ProductStore = {
    async createUser(input) {
      const [row] = await db.insert(schema.users).values(input).returning()
      return row
    },
    async findUserByEmail(email) {
      const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
      return row ?? null
    },
    async findUserById(id) {
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1)
      return row ?? null
    },
    async updateUser(id, displayName) {
      const [row] = await db.update(schema.users).set({ displayName, updatedAt: new Date() }).where(eq(schema.users.id, id)).returning()
      return row ?? null
    },
    async deleteUser(id) {
      const rows = await db.delete(schema.users).where(eq(schema.users.id, id)).returning({ id: schema.users.id })
      return rows.length > 0
    },
    async createSession(input) {
      const [row] = await db.insert(schema.authSessions).values(input).returning()
      return row
    },
    async findUserBySession(tokenHash, now) {
      const [row] = await db.select({ user: schema.users, session: schema.authSessions })
        .from(schema.authSessions)
        .innerJoin(schema.users, eq(schema.authSessions.userId, schema.users.id))
        .where(and(eq(schema.authSessions.tokenHash, tokenHash), gt(schema.authSessions.expiresAt, now)))
        .limit(1)
      return row ?? null
    },
    async touchSession(id, at) {
      await db.update(schema.authSessions).set({ lastUsedAt: at }).where(eq(schema.authSessions.id, id))
    },
    async deleteSession(tokenHash) {
      await db.delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, tokenHash))
    },
    async listSessions(userId) {
      return db.select({
        id: schema.authSessions.id,
        userId: schema.authSessions.userId,
        deviceLabel: schema.authSessions.deviceLabel,
        lastUsedAt: schema.authSessions.lastUsedAt,
        expiresAt: schema.authSessions.expiresAt,
        createdAt: schema.authSessions.createdAt,
      }).from(schema.authSessions).where(eq(schema.authSessions.userId, userId)).orderBy(desc(schema.authSessions.lastUsedAt))
    },
    async deleteOtherSessions(userId, currentSessionId) {
      const rows = await db.delete(schema.authSessions).where(and(eq(schema.authSessions.userId, userId), ne(schema.authSessions.id, currentSessionId))).returning({ id: schema.authSessions.id })
      return rows.length
    },
    async trimSessions(userId, keep) {
      const stale = await db.select({ id: schema.authSessions.id }).from(schema.authSessions).where(eq(schema.authSessions.userId, userId)).orderBy(desc(schema.authSessions.lastUsedAt)).offset(keep)
      if (stale.length > 0) await db.delete(schema.authSessions).where(inArray(schema.authSessions.id, stale.map((row) => row.id)))
    },
    async createAuthToken(input) {
      await db.insert(schema.authTokens).values(input)
    },
    async consumeAuthToken(tokenHash, type, now) {
      return db.transaction(async (tx) => {
        const [token] = await tx.update(schema.authTokens)
          .set({ usedAt: now })
          .where(and(eq(schema.authTokens.tokenHash, tokenHash), eq(schema.authTokens.type, type), isNull(schema.authTokens.usedAt), gt(schema.authTokens.expiresAt, now)))
          .returning({ userId: schema.authTokens.userId })
        if (!token) return null
        const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, token.userId)).limit(1)
        return user ?? null
      })
    },
    async invalidateAuthTokens(userId, type) {
      await db.update(schema.authTokens).set({ usedAt: new Date() }).where(and(eq(schema.authTokens.userId, userId), eq(schema.authTokens.type, type), isNull(schema.authTokens.usedAt)))
    },
    async updatePasswordAndRevokeSessions(userId, passwordHash) {
      await db.transaction(async (tx) => {
        await tx.update(schema.users).set({ passwordHash, updatedAt: new Date() }).where(eq(schema.users.id, userId))
        await tx.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId))
      })
    },
    async markEmailVerified(userId, at) {
      const [row] = await db.update(schema.users).set({ emailVerifiedAt: at, updatedAt: at }).where(eq(schema.users.id, userId)).returning()
      return row ?? null
    },
    async findBetaInvite(codeHash, email, now) {
      const [row] = await db.select({ id: schema.betaInvites.id, email: schema.betaInvites.email, expiresAt: schema.betaInvites.expiresAt })
        .from(schema.betaInvites)
        .where(and(eq(schema.betaInvites.codeHash, codeHash), isNull(schema.betaInvites.usedAt), gt(schema.betaInvites.expiresAt, now), sql`(${schema.betaInvites.email} is null or ${schema.betaInvites.email} = ${email})`))
        .limit(1)
      return row ?? null
    },
    async consumeBetaInvite(id, userId, at) {
      const rows = await db.update(schema.betaInvites).set({ usedByUserId: userId, usedAt: at }).where(and(eq(schema.betaInvites.id, id), isNull(schema.betaInvites.usedAt), gt(schema.betaInvites.expiresAt, at))).returning({ id: schema.betaInvites.id })
      return rows.length > 0
    },
    async listProfiles(userId) {
      return db.select().from(schema.candidateProfiles).where(eq(schema.candidateProfiles.userId, userId)).orderBy(desc(schema.candidateProfiles.updatedAt))
    },
    async createProfile(userId, input) {
      const [row] = await db.insert(schema.candidateProfiles).values({ userId, ...input }).returning()
      return row
    },
    async getProfile(userId, id) {
      const [row] = await db.select().from(schema.candidateProfiles).where(and(eq(schema.candidateProfiles.id, id), eq(schema.candidateProfiles.userId, userId))).limit(1)
      return row ?? null
    },
    async updateProfile(userId, id, input) {
      const [row] = await db.update(schema.candidateProfiles).set({ ...input, updatedAt: new Date() }).where(and(eq(schema.candidateProfiles.id, id), eq(schema.candidateProfiles.userId, userId))).returning()
      return row ?? null
    },
    async deleteProfile(userId, id) {
      const rows = await db.delete(schema.candidateProfiles).where(and(eq(schema.candidateProfiles.id, id), eq(schema.candidateProfiles.userId, userId))).returning({ id: schema.candidateProfiles.id })
      return rows.length > 0
    },
    async listInterviews(userId) {
      const rows = await db.select({ interview: schema.interviewSessions, historyTurns: count(schema.interviewTurns.id) })
        .from(schema.interviewSessions)
        .leftJoin(schema.interviewTurns, eq(schema.interviewTurns.sessionId, schema.interviewSessions.id))
        .where(eq(schema.interviewSessions.userId, userId))
        .groupBy(schema.interviewSessions.id)
        .orderBy(desc(schema.interviewSessions.updatedAt))
      return rows.map((row) => ({ ...row.interview, historyTurns: row.historyTurns }))
    },
    async createInterview(userId, input) {
      const [row] = await db.insert(schema.interviewSessions).values({ userId, ...input }).returning()
      return row
    },
    async getInterview(userId, id) {
      const [row] = await db.select().from(schema.interviewSessions).where(and(eq(schema.interviewSessions.id, id), eq(schema.interviewSessions.userId, userId))).limit(1)
      return row ?? null
    },
    async updateInterview(userId, id, input) {
      const [row] = await db.update(schema.interviewSessions).set({ ...input, updatedAt: new Date() }).where(and(eq(schema.interviewSessions.id, id), eq(schema.interviewSessions.userId, userId))).returning()
      return row ?? null
    },
    async completeInterview(userId, id) {
      const now = new Date()
      const [row] = await db.update(schema.interviewSessions).set({ status: 'completed', completedAt: now, updatedAt: now }).where(and(eq(schema.interviewSessions.id, id), eq(schema.interviewSessions.userId, userId))).returning()
      return row ?? null
    },
    async deleteInterview(userId, id) {
      const rows = await db.delete(schema.interviewSessions).where(and(eq(schema.interviewSessions.id, id), eq(schema.interviewSessions.userId, userId))).returning({ id: schema.interviewSessions.id })
      return rows.length > 0
    },
    async listTurns(userId, sessionId) {
      const interview = await this.getInterview(userId, sessionId)
      if (!interview) return null
      return db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.sessionId, sessionId)).orderBy(asc(schema.interviewTurns.sequence))
    },
    async createTurn(userId, sessionId, input) {
      const interview = await this.getInterview(userId, sessionId)
      if (!interview) return null
      const [existing] = await db.select().from(schema.interviewTurns).where(and(eq(schema.interviewTurns.sessionId, sessionId), eq(schema.interviewTurns.requestId, input.requestId))).limit(1)
      if (existing) return existing
      const [row] = await db.insert(schema.interviewTurns).values({ sessionId, ...input }).returning()
      return row
    },
    async createUsage(input) {
      await db.insert(schema.usageEvents).values(input)
    },
    async listUsage(userId) {
      return db.select().from(schema.usageEvents).where(eq(schema.usageEvents.userId, userId)).orderBy(desc(schema.usageEvents.createdAt))
    },
    async getUsageSince(userId, since) {
      const [row] = await db.select({
        requests: count(schema.usageEvents.id),
        inputTokens: sum(schema.usageEvents.inputTokens),
        outputTokens: sum(schema.usageEvents.outputTokens),
      }).from(schema.usageEvents).where(and(eq(schema.usageEvents.userId, userId), gte(schema.usageEvents.createdAt, since), eq(schema.usageEvents.type, 'answer')))
      return {
        requests: Number(row?.requests ?? 0),
        inputTokens: Number(row?.inputTokens ?? 0),
        outputTokens: Number(row?.outputTokens ?? 0),
      }
    },
    async exportUserData(userId) {
      const profiles = await db.select({ id: schema.candidateProfiles.id, name: schema.candidateProfiles.name, createdAt: schema.candidateProfiles.createdAt, updatedAt: schema.candidateProfiles.updatedAt }).from(schema.candidateProfiles).where(eq(schema.candidateProfiles.userId, userId)).orderBy(asc(schema.candidateProfiles.createdAt))
      const interviews = await db.select().from(schema.interviewSessions).where(eq(schema.interviewSessions.userId, userId)).orderBy(asc(schema.interviewSessions.createdAt))
      const result = []
      for (const interview of interviews) {
        const turns = await db.select().from(schema.interviewTurns).where(eq(schema.interviewTurns.sessionId, interview.id)).orderBy(asc(schema.interviewTurns.sequence))
        const { resumeText: _resume, jobDescriptionText: _jd, instructions: _instructions, userId: _userId, ...metadata } = interview
        result.push({ ...metadata, turns })
      }
      return { profiles, interviews: result }
    },
    async checkHealth() {
      await pool.query('select 1')
    },
  }
  return {
    store,
    close: () => pool.end(),
    async verifySchema() {
      const expectedTables = [
        'users',
        'auth_sessions',
        'auth_tokens',
        'beta_invites',
        'candidate_profiles',
        'interview_sessions',
        'interview_turns',
        'usage_events',
      ]
      const result = await pool.query<{ table_name: string }>(
        `select table_name
         from information_schema.tables
         where table_schema = 'public' and table_name = any($1::text[])`,
        [expectedTables],
      )
      const existing = new Set(result.rows.map((row) => row.table_name))
      const missing = expectedTables.filter((table) => !existing.has(table))
      if (missing.length > 0) {
        throw new Error(
          `Database schema is not initialized; missing tables: ${missing.join(', ')}. Run npm.cmd run db:migrate.`,
        )
      }
    },
  }
}
