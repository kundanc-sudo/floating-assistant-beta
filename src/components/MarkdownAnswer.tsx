import type { ReactNode } from 'react'

interface MarkdownAnswerProps { content: string }
type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list' | 'ordered-list'; items: string[] }
  | { type: 'code'; language: string; text: string }

export function MarkdownAnswer({ content }: MarkdownAnswerProps) {
  return <div className="markdown-answer">{parseMarkdown(content).map(renderBlock)}</div>
}

function renderBlock(block: Block, key: number): ReactNode {
  if (block.type === 'heading') {
    const Heading = `h${Math.min(6, block.level)}` as keyof React.JSX.IntrinsicElements
    return <Heading key={key}>{renderInline(block.text)}</Heading>
  }
  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const items = block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)
    return block.type === 'unordered-list' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>
  }
  if (block.type === 'code') {
    return <pre className="markdown-code" key={key}>{block.language && <span className="code-language">{block.language}</span>}<code>{block.text}</code></pre>
  }
  if (block.type === 'paragraph') return <p key={key}>{renderInline(block.text)}</p>
  return null
}

function renderInline(text: string) {
  return text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith('`') && part.endsWith('`')
      ? <code className="inline-code" key={index}>{part.slice(1, -1)}</code>
      : part,
  )
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []
  let listType: 'unordered-list' | 'ordered-list' | null = null
  let codeLines: string[] | null = null
  let codeLanguage = ''
  const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') }); paragraph = [] }
  const flushList = () => { if (listType && listItems.length) blocks.push({ type: listType, items: listItems }); listType = null; listItems = [] }

  for (const line of lines) {
    const fence = line.match(/^```\s*([^\s]*)/)
    if (fence) {
      flushParagraph(); flushList()
      if (codeLines) { blocks.push({ type: 'code', language: codeLanguage, text: codeLines.join('\n') }); codeLines = null; codeLanguage = '' }
      else { codeLines = []; codeLanguage = fence[1] ?? '' }
      continue
    }
    if (codeLines) { codeLines.push(line); continue }
    const heading = line.match(/^(#{1,6})\s+(.+)/)
    const uppercaseHeading = /^[A-Z][A-Z /-]{2,60}$/.test(line.trim())
    const unordered = line.match(/^\s*[-*+]\s+(.+)/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)/)
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }) }
    else if (uppercaseHeading) { flushParagraph(); flushList(); blocks.push({ type: 'heading', level: 2, text: line.trim() }) }
    else if (unordered || ordered) { flushParagraph(); const nextType = unordered ? 'unordered-list' : 'ordered-list'; if (listType && listType !== nextType) flushList(); listType = nextType; listItems.push((unordered ?? ordered)?.[1] ?? '') }
    else if (!line.trim()) { flushParagraph(); flushList() }
    else { flushList(); paragraph.push(line.trim()) }
  }
  flushParagraph(); flushList()
  if (codeLines) blocks.push({ type: 'code', language: codeLanguage, text: codeLines.join('\n') })
  return blocks
}
