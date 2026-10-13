import { useState } from 'react'

const presets = [
  { name: 'Concise', text: 'Answer directly in a concise format. Prioritize the most relevant points and avoid unnecessary background.' },
  { name: 'Conversational', text: 'Answer naturally and conversationally, as if speaking in a real interview. Keep the response clear and confident.' },
  { name: 'Technical', text: 'Give technically precise answers with concrete implementation details, tradeoffs, and examples when useful.' },
  { name: 'Detailed', text: 'Provide a structured, detailed answer with reasoning, examples, and important caveats while staying focused on the question.' },
]

export function InstructionPresets({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [pending, setPending] = useState<(typeof presets)[number] | null>(null)

  const choose = (preset: (typeof presets)[number]) => {
    if (value.trim() && value !== preset.text) setPending(preset)
    else onChange(preset.text)
  }

  return <div className="instruction-presets">
    <span>Optional presets</span>
    <div className="preset-buttons" aria-label="Instruction presets">
      {presets.map((preset) => <button key={preset.name} type="button" onClick={() => choose(preset)} disabled={disabled}>{preset.name}</button>)}
    </div>
    {pending && <div className="preset-confirmation" role="alert">
      <p>Replace your current instructions with the {pending.name.toLowerCase()} preset?</p>
      <div><button type="button" onClick={() => setPending(null)}>Keep mine</button><button type="button" onClick={() => { onChange(pending.text); setPending(null) }}>Replace instructions</button></div>
    </div>}
  </div>
}
