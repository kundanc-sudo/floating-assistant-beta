# Project Requirements

## Operating system

- Windows 10 or Windows 11
- 64-bit Windows recommended
- Multi-monitor and mixed-DPI displays are supported

## Runtime and package manager

- Node.js 20 or newer
- npm, included with Node.js

Verify the installed versions:

```powershell
node --version
npm.cmd --version
```

JavaScript dependencies and their versions are managed by `package.json` and `package-lock.json`. Install them with:

```powershell
cd D:\project
npm.cmd install
```

## OpenAI access

- A valid OpenAI API key
- API access to the models configured in `.env`
- Network access to OpenAI's HTTPS and Realtime API endpoints

Create `.env` from `.env.example` and configure:

```dotenv
OPENAI_API_KEY=your_api_key_here
OPENAI_FAST_ANSWER_MODEL=gpt-5.6-luna
OPENAI_CODING_MODEL=gpt-5.6-sol
OPENAI_FAST_REASONING_EFFORT=low
OPENAI_CODING_REASONING_EFFORT=high
```

Never commit or distribute the real `.env` file.

## Windows permissions

Depending on the enabled features, Windows may request permission for:

- Microphone access
- Screen capture
- System or loopback audio capture

The application must be allowed to capture the selected source through Windows privacy settings.

## Development requirements

No global Electron, Vite, React, or TypeScript installation is required. The project installs these locally through npm.

Main technologies:

- Electron
- React
- TypeScript
- Vite
- Node.js
- `ws` for the Realtime WebSocket connection

## Build requirements

Run the complete TypeScript and production build check with:

```powershell
cd D:\project
npm.cmd run build
```

Run the development application with:

```powershell
cd D:\project
npm.cmd run dev
```

## Hardware recommendations

- Working microphone for microphone transcription
- Active Windows audio output for system-audio transcription
- Display resolution sufficient to capture readable question text
- Stable internet connection for transcription and answer streaming

## Security requirements

- Keep `contextIsolation` enabled.
- Keep the API key in the Electron main process.
- Do not expose unrestricted Electron or Node.js APIs to the renderer.
- Do not save captured screenshots unless a future feature explicitly requires and protects them.
- Do not execute code extracted from screenshots automatically.
