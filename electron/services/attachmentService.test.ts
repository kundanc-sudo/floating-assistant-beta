import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'
import {
  MAX_ATTACHMENTS,
  MAX_TOTAL_EXTRACTED_TEXT,
  attachmentFingerprint,
  classifyExtension,
  matchesOrderedIds,
  processAttachmentFile,
  supportedExtensions,
  withinExtractedTextLimit,
} from './attachmentService'
import { buildResponseContent } from './answerService'
import { SharePublisherService } from './sharePublisherService'

test('supported extensions are classified by content type', () => {
  const extensions = supportedExtensions()
  for (const extension of ['pdf', 'doc', 'docx', 'txt', 'java', 'hpp', 'sh', 'ps1', 'png', 'webp']) {
    assert.ok(extensions.includes(extension), `${extension} should be supported by the picker`)
  }
  assert.equal(classifyExtension('.pdf')?.kind, 'pdf')
  assert.equal(classifyExtension('.docx')?.kind, 'word')
  assert.equal(classifyExtension('.java')?.kind, 'code')
  assert.equal(classifyExtension('.jpg')?.kind, 'image')
  assert.equal(classifyExtension('.exe'), undefined)
})

test('fingerprints filter duplicates while ordered snapshots detect mutations', () => {
  const first = { id: 'a', name: 'Example.java', size: 42, modifiedAt: 10 }
  const duplicate = { id: 'b', name: 'example.java', size: 42, modifiedAt: 10 }
  assert.equal(attachmentFingerprint(first), attachmentFingerprint(duplicate))
  assert.equal(matchesOrderedIds([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]), true)
  assert.equal(matchesOrderedIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]), false)
})

test('attachment limits are explicit and reject oversized combined text', () => {
  assert.equal(MAX_ATTACHMENTS, 10)
  assert.equal(withinExtractedTextLimit(0, MAX_TOTAL_EXTRACTED_TEXT), true)
  assert.equal(withinExtractedTextLimit(1, MAX_TOTAL_EXTRACTED_TEXT), false)
})

test('text, PDF, and DOCX extraction return readable text and legacy DOC is rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'overlay-attachments-'))
  try {
    const textPath = path.join(directory, 'sample.java')
    await writeFile(textPath, 'class Sample { int value = 7; }', 'utf8')
    const text = await processAttachmentFile(textPath, 'text-id')
    assert.equal(text.kind, 'code')
    assert.match(text.extractedText ?? '', /class Sample/)

    const pdfPath = path.join(directory, 'sample.pdf')
    await writeFile(pdfPath, createSimplePdf('PDF ATTACHMENT TEST\nEmployee ID: 12345\nDatabase: MySQL'))
    const pdf = await processAttachmentFile(pdfPath, 'pdf-id')
    assert.equal(pdf.kind, 'pdf')
    assert.match(pdf.extractedText ?? '', /PDF ATTACHMENT TEST/)
    assert.match(pdf.extractedText ?? '', /Database: MySQL/)

    const docxPath = path.join(directory, 'sample.docx')
    await writeFile(docxPath, await createSimpleDocx('DOCX ATTACHMENT TEST\nUse Java 17'))
    const docx = await processAttachmentFile(docxPath, 'docx-id')
    assert.equal(docx.kind, 'word')
    assert.match(docx.extractedText ?? '', /DOCX ATTACHMENT TEST/)
    assert.match(docx.extractedText ?? '', /Use Java 17/)

    const docPath = path.join(directory, 'legacy.doc')
    await writeFile(docPath, Buffer.from('binary legacy content'))
    await assert.rejects(
      processAttachmentFile(docPath, 'doc-id'),
      /Legacy \.doc files are not currently supported/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('one response content array preserves all image labels and images in order', () => {
  const content = buildResponseContent('Use every image.', [
    { label: 'SCREENSHOT 1', imageDataUrl: 'data:image/png;base64,one' },
    { label: 'SCREENSHOT 2', imageDataUrl: 'data:image/png;base64,two' },
    { label: 'ATTACHMENT 1 IMAGE: diagram.png', imageDataUrl: 'data:image/png;base64,three' },
  ])
  assert.deepEqual(content.map((part) => part.type), [
    'input_text', 'input_text', 'input_image', 'input_text', 'input_image', 'input_text', 'input_image',
  ])
  assert.equal(content.filter((part) => part.type === 'input_image').length, 3)
})

test('sharing publisher serializes response output only', async () => {
  const originalFetch = globalThis.fetch
  const published: unknown[] = []
  globalThis.fetch = (async (input, init) => {
    const url = String(input)
    if (url.endsWith('/api/share/session')) {
      return Response.json({
        sessionId: 'session', viewerToken: 'viewer', hostSecret: 'host',
        viewerUrl: 'http://localhost/viewer', expiresAt: Date.now() + 60_000,
      })
    }
    if (url.endsWith('/publish')) published.push(JSON.parse(String(init?.body)))
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  try {
    const publisher = new SharePublisherService('http://localhost', () => undefined, false)
    await publisher.start()
    publisher.publishDelta({
      requestId: 'request', requestText: 'PRIVATE PROMPT', source: 'microphone',
      requestType: 'image', delta: 'public answer', reset: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(JSON.stringify(published).includes('PRIVATE PROMPT'), false)
    assert.equal(JSON.stringify(published).includes('public answer'), true)
    await publisher.stop()
  } finally {
    globalThis.fetch = originalFetch
  }
})

async function createSimpleDocx(text: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  const paragraphs = text.split('\n').map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
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
