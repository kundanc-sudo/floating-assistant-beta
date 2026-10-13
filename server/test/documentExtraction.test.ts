import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { DocumentExtractionError, extractDocument } from '../src/documents/documentExtractionService.js'

const limits = { maxFileBytes: 5 * 1024 * 1024, maxExtractedChars: 500_000, maxPdfPages: 250 }

test('extracts readable UTF-8 text and normalizes line endings', async () => {
  const result = await extractDocument(Buffer.from('\uFEFFCandidate\r\nTypeScript engineer\r'), 'resume.txt', limits)
  assert.equal(result.kind, 'txt')
  assert.equal(result.text, 'Candidate\nTypeScript engineer')
})

test('extracts readable text from PDF and DOCX documents', async () => {
  const pdf = await extractDocument(await createSimplePdf('PDF ATTACHMENT TEST\nEmployee ID: 12345\nDatabase: MySQL'), 'resume.pdf', limits)
  assert.match(pdf.text, /PDF ATTACHMENT TEST/)
  assert.match(pdf.text, /Employee ID/)

  const docx = await extractDocument(await createSimpleDocx('DOCX JOB TEST\nNode.js role'), 'role.docx', limits)
  assert.match(docx.text, /DOCX JOB TEST/)
  assert.match(docx.text, /Node\.js role/)
})

test('rejects unsupported files and extension/signature mismatches', async () => {
  await rejectsCode(() => extractDocument(Buffer.from('plain text'), 'resume.rtf', limits), 'DOCUMENT_UNSUPPORTED')
  await rejectsCode(() => extractDocument(Buffer.from('not a pdf'), 'resume.pdf', limits), 'DOCUMENT_SIGNATURE_MISMATCH')
  await rejectsCode(() => extractDocument(Buffer.from('%PDF-1.4\ndisguised'), 'resume.txt', limits), 'DOCUMENT_SIGNATURE_MISMATCH')
  await rejectsCode(() => extractDocument(Buffer.from([0, 1, 2, 3]), 'resume.txt', limits), 'DOCUMENT_SIGNATURE_MISMATCH')
})

test('rejects empty, corrupt, encrypted, and no-text documents', async () => {
  await rejectsCode(() => extractDocument(Buffer.alloc(0), 'empty.txt', limits), 'DOCUMENT_EMPTY')
  await rejectsCode(() => extractDocument(Buffer.from('%PDF-1.4\ninvalid'), 'broken.pdf', limits), 'DOCUMENT_UNREADABLE')
  await rejectsCode(() => extractDocument(Buffer.from('%PDF-1.4\n/Encrypt\n'), 'secret.pdf', limits), 'DOCUMENT_ENCRYPTED')
  await rejectsCode(() => extractDocument(Buffer.from('   \r\n\t'), 'empty.txt', limits), 'DOCUMENT_NO_TEXT')
  await rejectsCode(() => extractDocument(Buffer.from([0xff, 0xfe, 0xfd]), 'invalid.txt', limits), 'DOCUMENT_SIGNATURE_MISMATCH')
})

test('enforces raw-file and extracted-text limits', async () => {
  await rejectsCode(() => extractDocument(Buffer.from('123456'), 'resume.txt', { ...limits, maxFileBytes: 5 }), 'DOCUMENT_TOO_LARGE')
  await rejectsCode(() => extractDocument(Buffer.from('six chars'), 'resume.txt', { ...limits, maxExtractedChars: 5 }), 'DOCUMENT_TEXT_TOO_LARGE')
})

test('rejects malformed DOCX archives and active embedded content', async () => {
  await rejectsCode(() => extractDocument(Buffer.from('PK\x03\x04not-a-zip', 'binary'), 'broken.docx', limits), 'DOCUMENT_UNREADABLE')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types />')
  zip.file('word/document.xml', '<document />')
  zip.file('word/vbaProject.bin', 'macro')
  const activeDocx = await zip.generateAsync({ type: 'nodebuffer' })
  await rejectsCode(() => extractDocument(activeDocx, 'macro.docx', limits), 'DOCUMENT_ACTIVE_CONTENT')
})

async function rejectsCode(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof DocumentExtractionError && error.code === code)
}

async function createSimpleDocx(text: string) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const paragraphs = text.split('\n').map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function createSimplePdf(text: string) {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([612, 792])
  text.split('\n').forEach((line, index) => page.drawText(line, { x: 72, y: 720 - (index * 16), size: 12, font }))
  return Buffer.from(await document.save({ useObjectStreams: false }))
}
