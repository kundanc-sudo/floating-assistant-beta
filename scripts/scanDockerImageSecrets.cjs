const fs = require('node:fs')
const path = require('node:path')

const secrets = [
  process.env.CHECK_DATABASE_SECRET,
  process.env.CHECK_PROVIDER_SECRET,
  process.env.CHECK_EMAIL_SECRET,
].filter(Boolean)
const matches = []

function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) scan(filePath)
    else {
      const contents = fs.readFileSync(filePath)
      for (let index = 0; index < secrets.length; index += 1) {
        if (contents.includes(Buffer.from(secrets[index]))) matches.push(`${filePath}:${index}`)
      }
    }
  }
}

scan('/app')
if (matches.length > 0) {
  console.error('Image contains a checked secret value.')
  process.exit(1)
}
console.info('Image exact-value secret scan passed.')
