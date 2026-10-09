import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'

export type AttachmentKind = 'text' | 'code' | 'pdf' | 'word' | 'image'

export interface PendingAttachmentRecord {
  id: string
  name: string
  extension: string
  mimeType: string
  size: number
  modifiedAt: number
  kind: AttachmentKind
  extractedText?: string
  imageBuffer?: Buffer
}

export const MAX_ATTACHMENTS = 10
export const MAX_TEXT_FILE_SIZE = 5 * 1024 * 1024
export const MAX_DOCUMENT_FILE_SIZE = 15 * 1024 * 1024
export const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_EXTRACTED_TEXT = 300_000

export class AttachmentProcessingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AttachmentProcessingError'
  }
}

const FILE_TYPES: Readonly<Record<string, { mimeType: string; kind: AttachmentKind }>> = {
  '.pdf': { mimeType: 'application/pdf', kind: 'pdf' },
  '.doc': { mimeType: 'application/msword', kind: 'word' },
  '.docx': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'word' },
  '.txt': { mimeType: 'text/plain', kind: 'text' },
  '.md': { mimeType: 'text/markdown', kind: 'text' },
  '.rtf': { mimeType: 'application/rtf', kind: 'text' },
  '.csv': { mimeType: 'text/csv', kind: 'text' },
  '.json': { mimeType: 'application/json', kind: 'text' },
  '.xml': { mimeType: 'application/xml', kind: 'text' },
  '.yaml': { mimeType: 'application/yaml', kind: 'text' },
  '.yml': { mimeType: 'application/yaml', kind: 'text' },
  '.java': { mimeType: 'text/x-java-source', kind: 'code' },
  '.js': { mimeType: 'text/javascript', kind: 'code' },
  '.ts': { mimeType: 'text/typescript', kind: 'code' },
  '.tsx': { mimeType: 'text/tsx', kind: 'code' },
  '.jsx': { mimeType: 'text/jsx', kind: 'code' },
  '.py': { mimeType: 'text/x-python', kind: 'code' },
  '.cpp': { mimeType: 'text/x-c++src', kind: 'code' },
  '.c': { mimeType: 'text/x-csrc', kind: 'code' },
  '.h': { mimeType: 'text/x-chdr', kind: 'code' },
  '.hpp': { mimeType: 'text/x-c++hdr', kind: 'code' },
  '.cs': { mimeType: 'text/x-csharp', kind: 'code' },
  '.sql': { mimeType: 'application/sql', kind: 'code' },
  '.html': { mimeType: 'text/html', kind: 'code' },
  '.css': { mimeType: 'text/css', kind: 'code' },
  '.properties': { mimeType: 'text/x-java-properties', kind: 'code' },
  '.log': { mimeType: 'text/plain', kind: 'text' },
  '.sh': { mimeType: 'text/x-shellscript', kind: 'code' },
  '.ps1': { mimeType: 'text/x-powershell', kind: 'code' },
  '.png': { mimeType: 'image/png', kind: 'image' },
  '.jpg': { mimeType: 'image/jpeg', kind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image' },
  '.webp': { mimeType: 'image/webp', kind: 'image' },
}

export function supportedExtensions() {
  return Object.keys(FILE_TYPES).map((extension) => extension.slice(1))
}

export function classifyExtension(extension: string) {
  return FILE_TYPES[extension.toLowerCase()]
}

export function attachmentFingerprint(
  attachment: Pick<PendingAttachmentRecord, 'name' | 'size' | 'modifiedAt'>,
) {
  return `${attachment.name.toLowerCase()}\u0000${attachment.size}\u0000${attachment.modifiedAt}`
}

export function matchesOrderedIds(
  snapshot: Array<{ id: string }>,
  pending: Array<{ id: string }>,
) {
  return snapshot.length === pending.length && snapshot.every(
    (item, index) => item.id === pending[index]?.id,
  )
}

export function withinExtractedTextLimit(currentLength: number, additionalLength: number) {
  return currentLength >= 0 && additionalLength >= 0 &&
    currentLength + additionalLength <= MAX_TOTAL_EXTRACTED_TEXT
}

export async function processAttachmentFile(
  selectedPath: string,
  id: string,
): Promise<PendingAttachmentRecord> {
  const extension = path.extname(selectedPath).toLowerCase()
  const type = classifyExtension(extension)
  if (!type) throw new Error(`Unsupported file type: ${extension || '(none)'}`)
  if (extension === '.doc') {
    throw new Error('Legacy .doc files are not currently supported. Please use .docx.')
  }

  const fileStats = await stat(selectedPath)
  if (!fileStats.isFile()) throw new Error(`${path.basename(selectedPath)} is not a file.`)
  const limit = type.kind === 'image'
    ? MAX_IMAGE_FILE_SIZE
    : type.kind === 'pdf' || type.kind === 'word'
      ? MAX_DOCUMENT_FILE_SIZE
      : MAX_TEXT_FILE_SIZE
  if (fileStats.size > limit) {
    throw new Error(`${path.basename(selectedPath)} is larger than the ${formatMegabytes(limit)} MB limit for this file type.`)
  }
  if (fileStats.size === 0) throw new Error(`${path.basename(selectedPath)} is empty.`)

  const contents = await readFile(selectedPath)
  if (contents.byteLength > limit) {
    throw new Error(`${path.basename(selectedPath)} grew beyond the ${formatMegabytes(limit)} MB limit while it was being read.`)
  }

  const base = {
    id,
    name: path.basename(selectedPath),
    extension,
    mimeType: type.mimeType,
    size: contents.byteLength,
    modifiedAt: fileStats.mtimeMs,
    kind: type.kind,
  }
  if (type.kind === 'image') {
    validateImageSignature(contents, extension)
    return { ...base, imageBuffer: contents }
  }

  let extractedText: string
  if (type.kind === 'pdf') {
    try {
      extractedText = await extractPdfText(contents)
    } catch (error) {
      throw new AttachmentProcessingError(`Could not read ${base.name}.`, { cause: error })
    }
  } else if (extension === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer: contents })
      extractedText = result.value
    } catch (error) {
      throw new AttachmentProcessingError(`Could not read ${base.name}.`, { cause: error })
    }
  } else {
    extractedText = decodeUtf8(contents, base.name)
    if (extension === '.rtf') extractedText = extractRtfText(extractedText)
  }
  extractedText = extractedText.trim()
  if (!extractedText) {
    throw new Error(`${base.name} contains no extractable text.`)
  }
  return { ...base, extractedText }
}

async function extractPdfText(contents: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser(null, true)
    parser.once('pdfParser_dataError', ({ parserError }) => reject(parserError))
    parser.once('pdfParser_dataReady', () => {
      try {
        resolve(parser.getRawTextContent())
      } catch (error) {
        reject(error)
      }
    })
    parser.parseBuffer(contents, 0)
  })
}

function decodeUtf8(contents: Buffer, name: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contents)
  } catch {
    throw new Error(`${name} is not valid UTF-8 text.`)
  }
}

export function extractRtfText(rtf: string) {
  return rtf
    .replace(/\\'[0-9a-fA-F]{2}/g, (value) =>
      String.fromCharCode(Number.parseInt(value.slice(2), 16)))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
}

function validateImageSignature(contents: Buffer, extension: string) {
  const png = contents.length >= 8 && contents.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )
  const jpeg = contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff
  const webp = contents.length >= 12 && contents.toString('ascii', 0, 4) === 'RIFF' && contents.toString('ascii', 8, 12) === 'WEBP'
  if (
    (extension === '.png' && !png) ||
    ((extension === '.jpg' || extension === '.jpeg') && !jpeg) ||
    (extension === '.webp' && !webp)
  ) throw new Error('The selected image does not match its file extension or is damaged.')
}

function formatMegabytes(bytes: number) {
  return Math.round(bytes / (1024 * 1024))
}
