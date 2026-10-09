import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'

const directory = await mkdtemp(path.join(os.tmpdir(), 'overlay-built-pdf-'))
try {
  const pdfPath = path.join(directory, 'built-smoke.pdf')
  await writeFile(
    pdfPath,
    createSimplePdf('PDF ATTACHMENT TEST\nEmployee ID: 12345\nDatabase: MySQL'),
  )
  const result = await runBuiltElectron(pdfPath)
  assert.equal(result.code, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /PDF ATTACHMENT TEST/)
  assert.match(result.stdout, /Database: MySQL/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /pdf\.worker\.mjs|Cannot find module/)
  console.info('Built Electron PDF extraction smoke test passed.')
} finally {
  await rm(directory, { recursive: true, force: true })
}

function runBuiltElectron(pdfPath: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      OVERLAY_PDF_SMOKE_PATH: pdfPath,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(electron as unknown as string, ['dist-electron/main.js'], {
      cwd: path.resolve('.'),
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code) => resolve({ code, stdout, stderr }))
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Built Electron PDF smoke test timed out.\n${stdout}\n${stderr}`))
    }, 20_000)
    child.once('exit', () => clearTimeout(timeout))
  })
}

function createSimplePdf(text: string) {
  const lines = text.split('\n').map((line) => line.replace(/[()\\]/g, '\\$&'))
  const stream = `BT /F1 12 Tf 72 720 Td ${lines.map((line, index) => `${index > 0 ? '0 -16 Td ' : ''}(${line}) Tj`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'ascii')
}
