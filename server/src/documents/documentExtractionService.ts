import path from 'node:path'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export const DEFAULT_DOCUMENT_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxExtractedChars: 500_000,
  maxPdfPages: 250,
  maxDocxEntries: 2_000,
  maxDocxExpandedBytes: 25 * 1024 * 1024,
  processingTimeoutMs: 15_000,
} as const

export interface DocumentLimits {
  maxFileBytes: number
  maxExtractedChars: number
  maxPdfPages: number
  maxDocxEntries?: number
  maxDocxExpandedBytes?: number
  processingTimeoutMs?: number
}

export interface ExtractedDocument {
  filename: string
  kind: 'pdf' | 'docx' | 'txt'
  text: string
  characters: number
  warning?: string
}

export class DocumentExtractionError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(message: string, code: string, statusCode = 400, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentExtractionError'
    this.code = code
    this.statusCode = statusCode
  }
}

export async function extractDocument(
  contents: Buffer,
  untrustedFilename: string,
  configured: DocumentLimits = DEFAULT_DOCUMENT_LIMITS,
): Promise<ExtractedDocument> {
  const limits = { ...DEFAULT_DOCUMENT_LIMITS, ...configured }
  if (!Buffer.isBuffer(contents) || contents.length === 0) {
    throw invalid('The selected document is empty.', 'DOCUMENT_EMPTY')
  }
  if (contents.length > limits.maxFileBytes) {
    throw new DocumentExtractionError(`Documents must be ${formatBytes(limits.maxFileBytes)} or smaller.`, 'DOCUMENT_TOO_LARGE', 413)
  }

  const filename = safeFilename(untrustedFilename)
  const extension = path.extname(filename).toLowerCase()
  const detected = detectContainer(contents)
  let kind: ExtractedDocument['kind']
  let extractedText: string

  if (extension === '.pdf') {
    if (detected !== 'pdf') throw mismatch()
    kind = 'pdf'
    if (contents.includes(Buffer.from('/Encrypt'))) {
      throw invalid('Encrypted PDF files are not supported.', 'DOCUMENT_ENCRYPTED')
    }
    extractedText = await withTimeout(extractPdf(contents, limits.maxPdfPages), limits.processingTimeoutMs)
  } else if (extension === '.docx') {
    if (detected !== 'zip') throw mismatch()
    kind = 'docx'
    await withTimeout(validateDocx(contents, limits), limits.processingTimeoutMs)
    try {
      const result = await withTimeout(mammoth.extractRawText({ buffer: contents }), limits.processingTimeoutMs)
      extractedText = result.value
    } catch (error) {
      if (error instanceof DocumentExtractionError) throw error
      throw invalid('The DOCX file is corrupt or unreadable.', 'DOCUMENT_UNREADABLE', error)
    }
  } else if (extension === '.txt') {
    if (detected !== 'text') throw mismatch()
    kind = 'txt'
    extractedText = decodeText(contents)
  } else {
    throw invalid('Only PDF, DOCX, and TXT documents are supported.', 'DOCUMENT_UNSUPPORTED')
  }

  const text = normalizeText(extractedText)
  if (!text) throw invalid('The document contains no usable text.', 'DOCUMENT_NO_TEXT')
  if (text.length > limits.maxExtractedChars) {
    throw invalid(`Extracted text must be ${limits.maxExtractedChars.toLocaleString('en-US')} characters or fewer.`, 'DOCUMENT_TEXT_TOO_LARGE')
  }
  return { filename, kind, text, characters: text.length }
}

function detectContainer(contents: Buffer): 'pdf' | 'zip' | 'text' | 'binary' {
  if (contents.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'pdf'
  if (contents.length >= 4 && contents[0] === 0x50 && contents[1] === 0x4b && [0x03, 0x05, 0x07].includes(contents[2]) && [0x04, 0x06, 0x08].includes(contents[3])) return 'zip'
  if (contents.includes(0)) return 'binary'
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(contents)
    const controls = [...value].filter((character) => {
      const code = character.charCodeAt(0)
      return code < 32 && !['\n', '\r', '\t', '\f'].includes(character)
    }).length
    return controls / Math.max(value.length, 1) <= 0.01 ? 'text' : 'binary'
  } catch {
    return 'binary'
  }
}

function decodeText(contents: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contents).replace(/^\uFEFF/, '')
  } catch (error) {
    throw invalid('The TXT file must contain valid UTF-8 text.', 'DOCUMENT_UNREADABLE', error)
  }
}

function extractPdf(contents: Buffer, maxPages: number) {
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser(null, true)
    parser.once('pdfParser_dataError', (reported) => {
      const cause = reported instanceof Error ? reported : reported.parserError
      const message = cause?.message ?? ''
      const encrypted = /password|encrypt/i.test(message)
      reject(invalid(encrypted ? 'Encrypted PDF files are not supported.' : 'The PDF file is corrupt or unreadable.', encrypted ? 'DOCUMENT_ENCRYPTED' : 'DOCUMENT_UNREADABLE', cause))
    })
    parser.once('pdfParser_dataReady', (data) => {
      if (!Array.isArray(data.Pages) || data.Pages.length > maxPages) {
        reject(invalid(`PDF files may contain at most ${maxPages} pages.`, 'DOCUMENT_PAGE_LIMIT'))
        return
      }
      try { resolve(parser.getRawTextContent()) } catch (error) { reject(invalid('The PDF file is corrupt or unreadable.', 'DOCUMENT_UNREADABLE', error)) }
    })
    try { parser.parseBuffer(contents, 0) } catch (error) { reject(invalid('The PDF file is corrupt or unreadable.', 'DOCUMENT_UNREADABLE', error)) }
  })
}

function validateDocx(contents: Buffer, limits: Required<DocumentLimits>) {
  return new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(contents, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
      if (openError || !zip) return reject(invalid('The DOCX file is corrupt or unreadable.', 'DOCUMENT_UNREADABLE', openError))
      inspectDocxZip(zip, limits, resolve, reject)
    })
  })
}

function inspectDocxZip(zip: ZipFile, limits: Required<DocumentLimits>, resolve: () => void, reject: (error: Error) => void) {
  let entries = 0
  let expandedBytes = 0
  let hasContentTypes = false
  let hasDocument = false
  let settled = false
  const fail = (error: Error) => { if (!settled) { settled = true; zip.close(); reject(error) } }
  zip.once('error', () => fail(invalid('The DOCX file is corrupt or unreadable.', 'DOCUMENT_UNREADABLE')))
  zip.on('entry', (entry: Entry) => {
    entries += 1
    expandedBytes += entry.uncompressedSize
    const normalized = entry.fileName.replace(/\\/g, '/').toLowerCase()
    if (entry.isEncrypted()) return fail(invalid('Encrypted DOCX files are not supported.', 'DOCUMENT_ENCRYPTED'))
    if (entries > limits.maxDocxEntries || expandedBytes > limits.maxDocxExpandedBytes || entry.uncompressedSize > limits.maxDocxExpandedBytes) {
      return fail(invalid('The DOCX file expands beyond the safe processing limit.', 'DOCUMENT_EXPANSION_LIMIT'))
    }
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > 250) {
      return fail(invalid('The DOCX file has an unsafe compression ratio.', 'DOCUMENT_EXPANSION_LIMIT'))
    }
    if (normalized === '[content_types].xml') hasContentTypes = true
    if (normalized === 'word/document.xml') hasDocument = true
    if (/vbaProject\.bin$/i.test(entry.fileName) || normalized.includes('/activex/') || normalized.startsWith('word/embeddings/')) {
      return fail(invalid('Documents containing macros or embedded executable content are not supported.', 'DOCUMENT_ACTIVE_CONTENT'))
    }
    zip.readEntry()
  })
  zip.once('end', () => {
    if (settled) return
    settled = true
    if (!hasContentTypes || !hasDocument) return reject(invalid('The file is not a valid DOCX document.', 'DOCUMENT_SIGNATURE_MISMATCH'))
    resolve()
  })
  zip.readEntry()
}

function safeFilename(value: string) {
  const base = path.basename(value.replace(/\0/g, '')).trim().slice(0, 255)
  if (!base || base === '.' || base === '..') throw invalid('A valid document filename is required.', 'DOCUMENT_NAME_REQUIRED')
  return base
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000\u000B\u000C]/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

function mismatch() {
  return invalid('The document contents do not match its file type.', 'DOCUMENT_SIGNATURE_MISMATCH')
}

function invalid(message: string, code: string, cause?: unknown) {
  return new DocumentExtractionError(message, code, 400, cause === undefined ? undefined : { cause })
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(invalid('Document processing took too long.', 'DOCUMENT_PROCESSING_TIMEOUT')), timeoutMs)
    timer.unref()
    operation.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

function formatBytes(bytes: number) {
  return `${Math.floor(bytes / (1024 * 1024))} MB`
}
