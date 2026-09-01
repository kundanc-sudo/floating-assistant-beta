# Windows Overlay Assistant

A Windows-only floating desktop assistant built with Electron, React, TypeScript, and Vite. It can capture live microphone or system-audio transcripts, hold a selected screen region as pending context, and stream an AI answer after the user explicitly selects **Generate Answer**.

## Features

- Transparent, frameless, resizable, always-on-top overlay
- Adjustable opacity and Windows content protection
- Microphone, system audio, or combined audio capture
- Realtime English transcription with server-side voice activity detection
- Selectable multi-monitor screen-region capture
- Pending screenshot workflow with Retake and Remove controls
- Screenshot-only, text-only, conversation-only, and combined requests
- Fast conversation and technical-answer path
- Dedicated high-reasoning coding and vision path
- Streaming Markdown answers with stale-response protection
- In-memory session and coding-workspace context
- Typed instructions override the default screenshot response format

## Requirements

- Windows 10 or Windows 11
- Node.js 20 or newer
- npm
- An OpenAI API key with access to the configured models

## Setup

Open CMD or PowerShell in the project directory:

```powershell
cd D:\project
npm.cmd install
Copy-Item .env.example .env
```

Open `.env` and set your API key:

```dotenv
OPENAI_API_KEY=your_api_key_here
```

Do not commit `.env` or share a project archive containing it.

## Model configuration

The answer models and reasoning levels can be changed without editing source code:

```dotenv
OPENAI_FAST_ANSWER_MODEL=gpt-5.6-luna
OPENAI_CODING_MODEL=gpt-5.6-sol
OPENAI_FAST_REASONING_EFFORT=low
OPENAI_CODING_REASONING_EFFORT=high
```

- `OPENAI_FAST_ANSWER_MODEL` handles ordinary conversation and technical text requests.
- `OPENAI_CODING_MODEL` handles coding screenshots where correctness is prioritized.
- The corresponding reasoning settings control the reasoning effort for each path.
- Realtime audio transcription remains separate from deliberate answer generation.

Model availability depends on the OpenAI project associated with the API key. See the official [OpenAI model catalog](https://developers.openai.com/api/docs/models) and [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create).

## Run in development

```powershell
cd D:\project
npm.cmd run dev
```

Alternatively, double-click `run.bat` in the project folder. The script checks Node.js, installs missing project dependencies, verifies that `.env` exists, and then starts the application.

## Production build

```powershell
npm.cmd run build
```

Build output is written to:

- `dist/` for the React renderer
- `dist-electron/` for the Electron main and preload processes

## Using the assistant

### Live conversation

1. Select **MIC**, **SYSTEM**, or **MIC + SYSTEM**.
2. Select **Start Live Assistant**.
3. Speak or play the system audio that should be transcribed.
4. Select **Generate Answer** when the current conversation is ready.

### Screenshot question

1. Select **Capture Question** or press `Ctrl+Alt+S`.
2. Drag over the required screen region.
3. Confirm that **Screen capture • Ready** appears.
4. Optionally type an instruction such as `Give only optimal Java code`.
5. Select **Generate Answer**.

Capturing does not automatically contact the answer model. A new capture replaces the pending capture, and **Remove** discards it without clearing the typed prompt, workspace, or previous answer.

When no typed instruction is supplied for a coding screenshot, the assistant uses the detailed default coding format. When an instruction is supplied, it controls the visible response. For example, `only optimal code` should produce code without unrequested explanation sections.

## Global shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+S` | Start or retake a region capture |
| `Ctrl+Alt+B` | Hide or show the overlay |
| `Ctrl+Alt+Arrow keys` | Move the overlay |

## Architecture

```text
Audio capture
    -> OpenAI Realtime connection
    -> realtime transcription
    -> live conversation buffer

Generate Answer
    -> Electron main-process routing
    -> fast conversation/technical path OR coding/vision path
    -> OpenAI Responses API streaming
    -> narrow preload events
    -> React answer panel

Region selection
    -> DPI-aware Electron screen capture
    -> validated in-memory PNG
    -> pending screenshot context
    -> consumed only by Generate Answer
```

Important source files:

- `electron/main.ts` — window lifecycle, IPC, request routing, and context assembly
- `electron/preload.ts` — narrow, context-isolated renderer bridge
- `electron/services/realtimeAssistantService.ts` — realtime audio and transcription
- `electron/services/answerService.ts` — deliberate streamed answer generation
- `electron/services/screenCaptureService.ts` — DPI-aware region capture and image validation
- `electron/services/sessionMemoryService.ts` — bounded live-session context
- `electron/services/workspaceMemoryService.ts` — coding problem and solution continuity
- `src/App.tsx` — overlay state and interaction flow

## Security and privacy

- The API key is loaded only by the Electron main process.
- The renderer does not receive the API key.
- `contextIsolation` remains enabled.
- Only narrow IPC methods are exposed through the preload script.
- Screenshots remain in memory and are released after submission; raw screenshot bytes are not stored as workspace history.
- Privacy Mode uses Electron's Windows content-protection support.
- AI requests still send selected audio-derived text, typed instructions, or screenshots to OpenAI when the user generates an answer.

## Troubleshooting

### PowerShell blocks `npm.ps1`

Use `npm.cmd` instead of `npm`:

```powershell
npm.cmd run dev
```

### API authentication error

Confirm that `D:\project\.env` exists and contains a valid `OPENAI_API_KEY`.

### Screenshot appears blank or incomplete

- Capture a larger visible region.
- Keep the complete problem statement, constraints, and starter signature inside the selection.
- If using multiple monitors with different scaling, ensure the target display is active and visible during capture.

### System audio does not start

Confirm that Windows allows desktop audio capture and that the selected display has an active audio source. Microphone permissions are managed separately by Windows.

## Development notes

- Do not change the working 24 kHz PCM16 audio pipeline when modifying answer generation.
- Do not enable automatic answers after screenshot capture.
- Preserve request IDs and ignore stale response deltas.
- Development builds log answer routing and request-to-first-token timing without logging prompt contents.
- Never execute arbitrary code extracted from screenshots automatically.
