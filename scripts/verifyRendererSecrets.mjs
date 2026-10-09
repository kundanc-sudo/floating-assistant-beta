import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv'

config({ path: path.resolve('.env'), quiet: true })
const artifactFiles = (await Promise.all(['dist', 'dist-electron'].map((directory) => walk(path.resolve(directory))))).flat()
const source = await sourceFiles(path.resolve('.'))
const files = [...artifactFiles, ...source]
const artifactContents = (await Promise.all(artifactFiles.map((file) => readFile(file, 'utf8')))).join('\n')
const contents = `${artifactContents}\n${(await Promise.all(source.map((file) => readFile(file, 'utf8')))).join('\n')}`
for (const forbidden of ['OPENAI_API_KEY', 'AI_PROVIDER_KEY']) {
  if (artifactContents.includes(forbidden)) throw new Error(`Packaged output contains forbidden provider marker: ${forbidden}`)
}
const configuredSecret = process.env.AI_PROVIDER_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
if (configuredSecret && configuredSecret.length >= 8 && contents.includes(configuredSecret)) {
  throw new Error('Build or repository source contains the configured provider secret.')
}
if (/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/.test(contents)) {
  throw new Error('Build or repository source contains a value shaped like a provider key.')
}
console.info(`Repository and build secret scan passed (${files.length} files).`)

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map((entry) => {
    const location = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(location) : [location]
  }))
  return nested.flat()
}

async function sourceFiles(directory) {
  const allowed = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.sql', '.example'])
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'dist-electron'])
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.env')) return []
    const location = path.join(directory, entry.name)
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : sourceFiles(location)
    return allowed.has(path.extname(entry.name)) ? [location] : []
  }))
  return nested.flat()
}
