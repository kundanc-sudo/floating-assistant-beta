import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalProductService, type ProductStorage } from './productShellService'
import type { InterviewContext } from './interviewContextService'

class MemoryStorage implements ProductStorage {
  value: unknown = undefined
  clearCount = 0

  async load(): Promise<unknown> {
    return this.value === undefined ? undefined : structuredClone(this.value)
  }

  async save(value: unknown): Promise<void> {
    this.value = structuredClone(value)
  }

  async clear(): Promise<void> {
    this.value = undefined
    this.clearCount += 1
  }
}

const context: InterviewContext = {
  resumeText: 'Experienced TypeScript engineer',
  jobDescriptionText: 'Build reliable desktop software',
  instructions: 'Answer in English with concise examples',
}

function fixture() {
  const storage = new MemoryStorage()
  let timestamp = 1_000
  let id = 0
  const service = new LocalProductService(storage, () => ++timestamp, () => `id-${++id}`)
  return { service, storage }
}

async function signedInFixture() {
  const result = fixture()
  await result.service.initialize()
  const user = await result.service.login('person@example.com', 'secret1', 'Person')
  return { ...result, user }
}

test('startup without a saved session returns the login state', async () => {
  const { service } = fixture()
  await service.initialize()
  assert.equal(service.getBootstrap().user, null)
  assert.deepEqual(service.getBootstrap().interviews, [])
})

test('local sign in normalizes email and opens an authenticated session', async () => {
  const { service } = fixture()
  await service.initialize()
  const user = await service.login(' Person@Example.COM ', 'secret1', 'Person')
  assert.equal(user.email, 'person@example.com')
  assert.equal(service.isAuthenticated(), true)
})

test('invalid credentials are rejected without creating a user', async () => {
  const { service } = fixture()
  await service.initialize()
  await assert.rejects(service.login('invalid', '123', ''), /valid email/)
  assert.equal(service.getBootstrap().user, null)
})

test('passwords are never written to product storage', async () => {
  const { service, storage } = fixture()
  await service.initialize()
  await service.login('person@example.com', 'never-store-this', 'Person')
  assert.equal(JSON.stringify(storage.value).includes('never-store-this'), false)
})

test('new interview setup requires a name, resume, and instructions', async () => {
  const { service } = await signedInFixture()
  await assert.rejects(service.createInterview({ name: '' }, context), /name/)
  await assert.rejects(service.createInterview({ name: 'Session' }, { ...context, resumeText: '' }), /Resume/)
  await assert.rejects(service.createInterview({ name: 'Session' }, { ...context, instructions: '' }), /instructions/)
})

test('starting an interview stores its complete prepared context', async () => {
  const { service } = await signedInFixture()
  const session = await service.createInterview({ name: 'Backend', company: 'Acme', role: 'Engineer' }, context)
  assert.deepEqual(session.context, context)
  assert.equal(service.getBootstrap().activeInterviewId, session.id)
})

test('ending an interview stores bounded session history metadata', async () => {
  const { service } = await signedInFixture()
  const session = await service.createInterview({ name: 'Backend' }, context)
  await service.completeActiveInterview([{
    requestId: 'request-1',
    conversation: [{ id: 'turn-1', text: 'Question', source: 'microphone', timestamp: 2 }],
    assistantAnswer: 'Answer',
    timestamp: 3,
  }])
  const saved = service.getInterviewById(session.id)
  assert.equal(saved?.status, 'completed')
  assert.equal(saved?.history.length, 1)
  assert.equal(service.getBootstrap().activeInterviewId, undefined)
})

test('a recent interview can be reopened with its original context', async () => {
  const { service } = await signedInFixture()
  const session = await service.createInterview({ name: 'Backend' }, context)
  await service.completeActiveInterview([])
  const reopened = await service.reopenInterview(session.id)
  assert.equal(reopened.status, 'active')
  assert.deepEqual(reopened.context, context)
})

test('profiles persist reusable resume and instruction context', async () => {
  const { service } = await signedInFixture()
  const profile = await service.createProfile('Backend profile', context)
  assert.equal(service.getBootstrap().profiles[0]?.resumeLoaded, true)
  assert.equal(service.getProfileById(profile.id)?.defaultInstructions, context.instructions)
})

test('profiles can be renamed without overwriting their saved context', async () => {
  const { service } = await signedInFixture()
  const profile = await service.createProfile('Old name', context)
  const updated = await service.updateProfile(profile.id, 'New name')
  assert.equal(updated.name, 'New name')
  assert.equal(updated.resumeText, context.resumeText)
})

test('profiles can be deleted', async () => {
  const { service } = await signedInFixture()
  const profile = await service.createProfile('Delete me', context)
  await service.deleteProfile(profile.id)
  assert.equal(service.getBootstrap().profiles.length, 0)
})

test('default Auto Assist preference is persisted', async () => {
  const { service } = await signedInFixture()
  await service.setSettings({ defaultAutoAssist: true })
  assert.equal(service.getBootstrap().settings.defaultAutoAssist, true)
})

test('account display name can be updated', async () => {
  const { service } = await signedInFixture()
  await service.updateAccount('Updated Person')
  assert.equal(service.getBootstrap().user?.displayName, 'Updated Person')
})

test('logout removes the session but retains local interview data', async () => {
  const { service } = await signedInFixture()
  await service.createInterview({ name: 'Retained' }, context)
  await service.logout()
  assert.equal(service.getBootstrap().user, null)
  await service.login('person@example.com', 'another-valid-secret')
  assert.equal(service.getBootstrap().interviews[0]?.name, 'Retained')
})

test('user repositories isolate interviews and profiles by account', async () => {
  const { service } = await signedInFixture()
  await service.createInterview({ name: 'Person session' }, context)
  await service.createProfile('Person profile', context)
  await service.logout()
  await service.login('second@example.com', 'secret2', 'Second')
  assert.deepEqual(service.getBootstrap().interviews, [])
  assert.deepEqual(service.getBootstrap().profiles, [])
})

test('Clear Local Data erases all local product records', async () => {
  const { service, storage } = await signedInFixture()
  await service.createInterview({ name: 'Erase me' }, context)
  await service.createProfile('Erase me', context)
  await service.clearLocalData()
  assert.equal(storage.clearCount, 1)
  assert.deepEqual(service.getBootstrap(), {
    user: null,
    interviews: [],
    profiles: [],
    settings: { defaultAutoAssist: false },
    activeInterviewId: undefined,
  })
})
