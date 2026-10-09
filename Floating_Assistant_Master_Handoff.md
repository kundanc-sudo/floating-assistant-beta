# Floating Assistant Project --- Master Handoff & Continuation Context

**Purpose:** Upload this file in a new ChatGPT conversation and say:\
**"Read this project handoff completely and continue helping me from the
current state. Do not make me re-explain the project."**

**Project location:** `D:\project`\
**Platform:** Windows 10\
**Primary stack:** Electron + React + TypeScript + Vite\
**Last context update:** September 30, 2026

------------------------------------------------------------------------

# 1. HOW CHATGPT SHOULD USE THIS FILE

This file is the continuity document for my Floating Assistant project.

When I provide this file in a new conversation:

1.  Read the entire file before proposing architectural changes.
2.  Treat the features marked **WORKING / IMPLEMENTED** as existing
    functionality that must not be broken.
3.  When I report a bug, prefer the smallest targeted fix instead of
    redesigning unrelated working functionality.
4.  When I ask for implementation help, I usually want a detailed
    **Codex prompt** that Codex can apply directly to `D:\project`.
5.  Codex prompts should normally include:
    -   exact goal
    -   architecture/behavior requirements
    -   files/services to inspect
    -   things that must not be broken
    -   edge cases
    -   tests
    -   `npm.cmd run build`
    -   manual verification steps
    -   final report requirements
6.  Do not invent code that is already present without first asking
    Codex to inspect the existing implementation.
7.  Preserve existing secure Electron architecture:
    -   context isolation
    -   narrow preload APIs
    -   main-process ownership of privileged operations
    -   no unrestricted `ipcRenderer` exposure
8.  Preserve privacy boundaries for the response-sharing viewer.
9.  Do not turn research/UI features into third-party monitoring,
    proctoring, screen-share, or detection bypass functionality.
10. For screen capture, normal user-triggered rectangle capture and
    normal Electron window UX are intended; do not add covert monitoring
    or external software manipulation.

------------------------------------------------------------------------

# 2. CORE APPLICATION

The application is a floating Windows desktop AI assistant built with:

-   Electron
-   React
-   TypeScript
-   Vite

Main project:

`D:\project`

The main window is:

-   frameless
-   transparent/translucent
-   always-on-top
-   draggable
-   resizable
-   compact
-   hidden from taskbar where appropriate
-   adjustable opacity
-   collapsible to a small floating bubble

The application is designed to remain running while audio,
transcription, AI generation, screenshots, files, and sharing operate.

------------------------------------------------------------------------

# 3. IMPORTANT GLOBAL SHORTCUTS

Existing shortcuts include:

-   `Ctrl+Alt+Left` → move assistant left 50 px
-   `Ctrl+Alt+Right` → move assistant right 50 px
-   `Ctrl+Alt+Up` → move assistant up 50 px
-   `Ctrl+Alt+Down` → move assistant down 50 px
-   `Ctrl+Alt+B` → hide/show assistant
-   `Ctrl+Alt+S` → start rectangle screenshot capture

Preserve these unless explicitly asked to change them.

------------------------------------------------------------------------

# 4. MAIN UI

The Floating Assistant currently contains functionality such as:

-   Start / Stop Live Assistant
-   MIC
-   SYSTEM
-   MIC + SYSTEM
-   Live Transcript
-   typed instruction/prompt composer
-   file attachments
-   screenshot attachments
-   Generate Answer
-   Capture Question / Select Region
-   AI RESPONSE
-   Chat History / workspace history
-   Reset Context
-   Clear
-   Privacy mode
-   opacity controls
-   collapse/bubble control
-   top-right X to fully quit

The AI RESPONSE panel should flex-fill available vertical space.

Markdown rendering works.

Code blocks work.

Auto-scroll behavior:

-   if user is near bottom → follow streaming response
-   if user scrolls upward → do not force them down
-   when they return near bottom → auto-scroll can resume

Avoid nested vertical scrollbars.

------------------------------------------------------------------------

# 5. NORMAL CURSOR REQUIREMENT

The user specifically wants the normal Windows arrow cursor throughout
the regular application.

For the assistant and rectangle selection UI, the current target is:

`cursor: default`

Do not use:

-   pointer hand
-   text I-beam where avoidable
-   crosshair
-   plus/cell cursor

The rectangle selection must still work using pointer down/move/up even
though the cursor visually remains the normal arrow.

------------------------------------------------------------------------

# 6. AUDIO CAPTURE --- IMPLEMENTED

## Microphone

Existing `AudioCaptureService` uses approximately:

-   `navigator.mediaDevices.getUserMedia`
-   echo cancellation
-   noise suppression
-   auto gain control
-   `AudioContext`
-   `ScriptProcessorNode(4096, 1, 1)`
-   Float32 → PCM16
-   resampling
-   target sample rate: 24 kHz
-   chunks around 400 ms

This service captures audio only.

Do not confuse capture with transcription.

## System audio

Existing `SystemAudioCaptureService` uses approximately:

`navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })`

The video track is stopped and system audio is retained.

It similarly produces PCM16 24 kHz chunks.

IMPORTANT:

Screenshot capture must NOT reuse or stop the SystemAudioCaptureService
stream.

Each service owns its own resources.

------------------------------------------------------------------------

# 7. REALTIME / TRANSCRIPTION ARCHITECTURE

Existing `RealtimeAssistantService` uses OpenAI Realtime.

Important known implementation:

`wss://api.openai.com/v1/realtime?model=gpt-realtime`

Audio is sent using:

`input_audio_buffer.append`

Input format:

-   PCM
-   24 kHz

Transcription model:

`gpt-4o-mini-transcribe`

Language:

`en`

Server VAD was configured approximately with:

-   threshold `0.5`
-   prefix padding `300 ms`
-   silence duration `700 ms`
-   `create_response: false`
-   `interrupt_response: false`

Relevant transcription events include:

-   `conversation.item.input_audio_transcription.delta`
-   `conversation.item.input_audio_transcription.completed`

The application intentionally separates:

AUDIO CAPTURE\
→ TRANSCRIPTION\
→ CONVERSATION BUFFER\
→ MANUAL GENERATE ANSWER

Do not switch this to old `whisper-1` without a strong reason.

------------------------------------------------------------------------

# 8. TRANSCRIPT VALIDATION

The project has English transcript validation/filtering.

Known concepts/functions include:

-   `validateEnglishTranscript`
-   `isTranscriptionArtifact`
-   `hasSubstantialUnexpectedScript`

It rejects:

-   empty/no-letter output
-   substantial unexpected scripts
-   known internal prompt echoes/artifacts

Some known internal prompt signature filtering exists.

This is post-transcription filtering, not the speech engine.

------------------------------------------------------------------------

# 9. MANUAL GENERATE ANSWER MODEL

The intended behavior is:

1.  Start Live Assistant once.
2.  Audio/transcription continues continuously.
3.  Conversation accumulates.
4.  User presses **Generate Answer**.
5.  The application snapshots the current relevant context.
6.  AI generation starts.
7.  The current conversation buffer rotates so new conversation can
    continue.
8.  AI response remains visible while new audio is still captured.
9.  User can press Generate Answer again later.

New speech during AI generation must continue being captured.

Only Stop Live Assistant should intentionally terminate live audio
resources.

------------------------------------------------------------------------

# 10. SESSION / MEETING MEMORY

The project uses bounded in-memory session context.

Conceptual structure:

-   `currentConversation`
-   `recentConversation`
-   `sessionSummary`

AI context is approximately:

session summary\
+ recent conversation\
+ current request snapshot

Important behavior:

-   rolling summary should be bounded
-   summary updates should not block capture
-   summarization should be race-safe
-   only summarized segment IDs should be removed
-   session memory is RAM-only
-   Reset Context clears meeting/session context without necessarily
    stopping capture

Suggested/known service concept:

`electron/services/sessionMemoryService.ts`

------------------------------------------------------------------------

# 11. PROBLEM WORKSPACE MEMORY

There is also a separate coding/problem workspace.

This is different from meeting/session memory.

Purpose:

-   maintain current coding problem across screenshots
-   typed follow-ups
-   errors
-   modifications
-   code revisions

Conceptual state includes:

-   workspace messages
-   problem title/summary
-   language
-   requirements
-   constraints
-   current approach
-   complexity
-   canonical current code
-   solution version
-   rolling workspace summary

Important:

Canonical code should only be replaced when code actually changes.

Explanation-only responses should not overwrite canonical code.

Workspace should survive:

-   Generate Answer
-   screenshots
-   typed messages
-   stopping/restarting Live Assistant

It can remain RAM-only for the Electron process.

Suggested service:

`electron/services/workspaceMemoryService.ts`

------------------------------------------------------------------------

# 12. TYPED PROMPT PRIORITY

This behavior was explicitly fixed and should remain.

Current typed prompt is the HIGHEST-PRIORITY response contract.

Priority approximately:

1.  current typed prompt
2.  current screenshots
3.  current attachments
4.  current conversation
5.  workspace/problem context
6.  older context
7.  default answer format

Examples:

"code only"\
→ code only

"give only optimal code"\
→ optimal code only

"only time and space complexity"\
→ complexity only

"explain optimal approach without code"\
→ explanation only

Do not force the default coding template when the user explicitly
requests another output format.

------------------------------------------------------------------------

# 13. DEFAULT CODING RESPONSE

When no explicit typed response-format instruction exists and a
screenshot is a coding problem, the assistant may use structured
sections such as:

-   MY THOUGHTS
-   PROBLEM UNDERSTANDING
-   APPROACHES
-   BRUTE FORCE
-   BETTER APPROACH, only when meaningful
-   OPTIMAL / RECOMMENDED APPROACH
-   SOLUTION
-   CODE WALKTHROUGH
-   COMPLEXITY
-   EDGE CASES, when relevant

Do not invent fake intermediate approaches.

Correctness is more important than producing many sections.

For debugging:

-   PROBLEM
-   ROOT CAUSE
-   FIX
-   CORRECTED CODE
-   WHY IT WORKS

For errors:

-   ERROR
-   LIKELY CAUSE
-   WHAT TO CHANGE
-   CORRECTED CODE

------------------------------------------------------------------------

# 14. SCREENSHOT / RECTANGLE CAPTURE --- CURRENT DESIGN

The project supports user-triggered rectangle screenshot capture
through:

-   Capture Question / Select Region button
-   `Ctrl+Alt+S`

Current intended flow:

live desktop\
→ user triggers capture\
→ temporary selection input UI\
→ normal arrow cursor\
→ drag rectangle\
→ save coordinates\
→ remove selection UI\
→ independent one-shot desktop image acquisition\
→ crop selected region\
→ append screenshot to `pendingScreenshots[]`

IMPORTANT:

The desktop should remain LIVE.

Do NOT use:

capture full desktop\
→ freeze screenshot fullscreen\
→ select from frozen image

The user explicitly wanted live-desktop rectangle selection.

------------------------------------------------------------------------

# 15. SCREENSHOT UI FIXES ALREADY WORKED ON

Several regressions occurred and were progressively fixed.

## A. Screen sharing interruption

Earlier screenshot logic appeared to interfere with screen sharing.

Requirement established:

Screenshot capture must NEVER stop/restart unrelated media streams.

Strict ownership:

-   microphone service owns microphone stream
-   system audio service owns system audio stream
-   screenshot service owns only screenshot-specific resources

Screenshot cleanup must not call `stop()` on a stream it did not create.

## B. Black screen during rectangle selection

When Entire Screen was shared in Google Meet, selection initially caused
the remote shared screen to become black.

The issue was associated with the temporary fullscreen selection
UI/window behavior.

The capture architecture was adjusted so the desktop/share could
continue normally.

Do not regress this.

## C. Large native border

A large outer border appeared during capture.

Codex reported native Windows framing as the cause.

Changes reportedly included:

-   `thickFrame: false`
-   `roundedCorners: false`

in `electron/main.ts` around the selection window implementation.

## D. Crosshair cursor

The selection cursor used to be a crosshair/+.

It was changed to normal arrow with styling similar to:

``` css
html, body, * {
  cursor: default !important;
}
```

Keep this.

## E. Giant cyan/blue selection surfaces

At one point four separate border BrowserWindows rendered as giant
cyan/blue blocks.

The recommended architecture became:

ONE transparent selection/input BrowserWindow\
+ HTML/CSS selection rectangle

rather than four native BrowserWindows for:

-   top
-   bottom
-   left
-   right

The rectangle should be:

-   thin, approximately 1 px
-   transparent interior
-   no glow
-   no shadow
-   no full-screen tint

Do not reintroduce giant border windows.

## F. Brightness / dimming

Selection mode previously changed overall desktop brightness.

One known diagnostic log showed approximately:

`[Selection] opacity = 0.01`

Whole-window opacity and transparent-window composition were
investigated.

Current remaining visual difference was eventually identified mainly as
Windows/Chrome **active vs inactive window focus styling**, especially
in Chrome's tab/title area.

------------------------------------------------------------------------

# 16. CURRENT FOCUS / WINDOW APPEARANCE ISSUE

This is the most recent issue discussed before creating this handoff.

Observed behavior:

-   When Chrome is active, its top/tab/title area has one shade.
-   When the Floating Assistant receives foreground focus, Chrome
    becomes inactive and its tab/title area changes slightly.
-   Clicking Chrome again restores Chrome's active appearance.

This is normal active/inactive application styling on Windows/Chrome,
not necessarily actual screen brightness.

Current goal:

Remove UNNECESSARY programmatic focus stealing by the Floating
Assistant.

Inspect:

-   `mainWindow.show()`
-   `mainWindow.showInactive()`
-   `mainWindow.focus()`
-   `mainWindow.restore()`
-   `mainWindow.moveTop()`
-   `mainWindow.setAlwaysOnTop()`
-   `mainWindow.setFocusable()`
-   `app.focus()`

Desired principle:

**Always-on-top is not the same as foreground focus.**

The assistant can remain visually above Chrome without calling `focus()`
unnecessarily.

For presentation-only operations such as:

-   showing after Ctrl+Alt+B
-   restore after screenshot
-   restore after ESC
-   bubble expansion
-   normal show

prefer non-focus-stealing behavior where compatible, such as
`showInactive()`.

However:

If the user clicks into a text field and needs to type, the assistant
legitimately needs keyboard focus. Windows normally has one foreground
window, so Chrome may then render inactive styling. Do not fake Chrome's
active state or manipulate Chrome.

Do not attempt to make two independent windows simultaneously own real
foreground keyboard focus.

------------------------------------------------------------------------

# 17. MAIN WINDOW LIFECYCLE / ALWAYS-ON-TOP

A regression was also observed where the Floating Assistant sometimes
appeared below Chrome or VS Code after moving/hiding/capture operations.

Important diagnostic:

Log `mainWindow.id` before and after:

-   capture
-   ESC
-   hide/show
-   bubble collapse/expand

Prefer keeping ONE persistent main assistant BrowserWindow.

Do not unnecessarily destroy/recreate it.

Window runtime state should preserve:

-   privacy state
-   always-on-top state
-   presentation mode
-   opacity
-   bounds

A centralized reapply function may be appropriate if the implementation
needs it.

Moving the assistant should not minimize Chrome or VS Code.

Do not manipulate unrelated application windows.

------------------------------------------------------------------------

# 18. PRIVACY MODE

The application has a Privacy ON/OFF mode.

A regression occurred where UI said Privacy ON but behavior appeared
different after window/capture changes.

Important rule:

Do not invent a completely new privacy system when debugging.

Trace the existing behavior:

React\
→ preload\
→ IPC\
→ Electron main\
→ actual current `mainWindow`

Ensure UI state corresponds to main-process window state.

If mainWindow is recreated, previously applied window state can be lost;
this is another reason to prefer one persistent BrowserWindow.

Do not extend privacy work into bypassing third-party monitoring or
screen-sharing systems.

------------------------------------------------------------------------

# 19. REALTIME WEBSOCKET SHUTDOWN BUG

A screenshot showed an Electron main-process error:

`Error: WebSocket was closed before the connection was established`

Stack included approximately:

-   `WebSocket.close`
-   `RealtimeAssistantService.stop`
-   `stopRealtimeAssistants`

This indicates a lifecycle race where `stop()` may call `.close()` while
the socket is still `CONNECTING`.

Required behavior:

`RealtimeAssistantService.stop()` should be idempotent.

Explicitly handle:

-   CONNECTING
-   OPEN
-   CLOSING
-   CLOSED

If stop occurs during CONNECTING:

-   mark intentional stop/cancel
-   prevent later handlers from reviving/reconnecting
-   clean up safely
-   no uncaught Electron error dialog

If OPEN:

-   close normally

If already CLOSING/CLOSED:

-   do not unnecessarily close again

Intentional stop must suppress reconnect.

Do not globally hide uncaught exceptions; fix the root cause.

Also ensure screenshot cleanup does NOT accidentally call
`RealtimeAssistantService.stop()`.

------------------------------------------------------------------------

# 20. MULTIPLE SCREENSHOTS

The project supports or is intended to support multiple screenshots.

State concept:

`pendingScreenshots: PendingScreenshot[]`

Behavior:

-   each new capture appends
-   does not replace previous screenshot
-   preserve order
-   preview cards/thumbnails
-   individual remove
-   click screenshot to enlarge preview
-   ESC closes preview

Generate Answer should snapshot all current screenshots and send them
coherently in one request where supported.

Do not send each screenshot as a separate unrelated AI request.

------------------------------------------------------------------------

# 21. FILE ATTACHMENTS

The project has file upload beside the prompt composer.

Intended support includes:

## Documents

-   `.pdf`
-   `.docx`
-   `.doc` only if reliably supported; otherwise friendly unsupported
    message
-   `.txt`
-   `.md`
-   `.rtf`

## Data/config

-   `.csv`
-   `.json`
-   `.xml`
-   `.yaml`
-   `.yml`

## Code

-   `.java`
-   `.js`
-   `.ts`
-   `.tsx`
-   `.jsx`
-   `.py`
-   `.cpp`
-   `.c`
-   `.h`
-   `.hpp`
-   `.cs`
-   `.sql`
-   `.html`
-   `.css`
-   `.properties`
-   `.log`
-   `.sh`
-   `.ps1`

## Images

-   `.png`
-   `.jpg`
-   `.jpeg`
-   `.webp`

Multiple file selection should append rather than replace.

Files should have compact attachment cards with remove controls.

PDF/DOCX require type-aware extraction.

Do not read arbitrary binary documents with `fs.readFile(..., 'utf8')`.

Images should use vision rather than OCR by default.

------------------------------------------------------------------------

# 22. PDF WORKER BUG HISTORY

A previous PDF upload error was:

`Setting up fake worker failed: Cannot find module 'D:\project\dist-electron\pdf.worker.mjs' imported from D:\project\dist-electron\main.js`

Cause category:

PDF.js / `pdfjs-dist` worker was not correctly available in built
Electron output.

Important requirement:

Do not manually copy a worker as an ad-hoc local workaround.

Either:

-   use a Node/Electron-safe PDF extraction path that does not require
    the worker, or
-   correctly bundle/copy the worker as part of build configuration

Must work from built `dist-electron`, not only source TypeScript.

------------------------------------------------------------------------

# 23. AI ANSWER MODEL / ACCURACY

A concern was raised that coding screenshot answers were slower and
sometimes less accurate than normal ChatGPT.

Known architecture at the time:

-   realtime transcription → `gpt-4o-mini-transcribe`
-   answer generation / vision had been using realtime model paths
    including `gpt-realtime`

Recommended architecture:

-   keep realtime audio/transcription for live speech
-   use an appropriate fast path for ordinary conversational answers
-   use a stronger vision/reasoning path for coding screenshots where
    correctness matters

Coding screenshot internal reasoning should verify:

-   full problem statement
-   constraints
-   examples
-   function signature
-   hidden edge cases
-   duplicates
-   overflow
-   min/max
-   complexity
-   required return type

Typed request such as "only optimal code" constrains visible output, not
internal correctness checking.

Also preserve performance timing diagnostics where useful:

-   Generate click
-   screenshot prepared
-   request dispatch
-   first delta
-   complete

------------------------------------------------------------------------

# 24. BUBBLE / COLLAPSE MODE

The main assistant can collapse into a small floating circle/bubble.

Preferred architecture:

Use the SAME main BrowserWindow, not a second independent assistant
window.

On collapse:

-   save expanded bounds
-   resize to approximately 48--52 px
-   render compact bubble

On expand:

-   restore saved bounds
-   clamp to current display work area

Bubble should be draggable.

Need click-vs-drag distinction:

-   pointer down → remember position
-   movement \> about 4--6 px → drag
-   pointer up after drag → remain collapsed
-   pointer up without meaningful movement → expand

Collapse must be presentation-only.

It must NOT stop:

-   audio
-   transcription
-   AI generation
-   session memory
-   workspace
-   sharing
-   pending files
-   pending screenshots

------------------------------------------------------------------------

# 25. CLOSE X

The top-right X should completely terminate the Electron application.

Use secure narrow IPC:

renderer\
→ preload\
→ Electron main\
→ `app.quit()`

Do not use renderer `process.exit()`.

------------------------------------------------------------------------

# 26. RESPONSE SHARING --- IMPLEMENTED

A read-only sharing system was implemented.

Architecture:

Host Electron\
→ `SharePublisherService`\
→ sharing server\
→ WebSocket\
→ viewer

The sharing server does NOT generate AI responses.

Known files created:

-   `D:\project\electron\services\sharePublisherService.ts`
-   `D:\project\server\src\server.ts`
-   `D:\project\server\src\share\shareSessionManager.ts`
-   `D:\project\server\src\share\rateLimiter.ts`
-   `D:\project\server\src\viewerPage.ts`
-   `D:\project\server\package.json`
-   `D:\project\server\tsconfig.json`
-   `D:\project\server\test\protocol.test.mjs`

Known modified files included:

-   `electron/main.ts`
-   `electron/preload.ts`
-   `src/App.tsx`
-   `src/vite-env.d.ts`
-   `src/styles/app.css`
-   root `package.json`
-   `.env.example`
-   `.gitignore`
-   `README.md`

------------------------------------------------------------------------

# 27. SHARING SECURITY

Implemented/reported behavior:

-   cryptographically secure viewer tokens
-   only SHA-256 viewer-token hashes stored server-side
-   separate 256-bit host secret
-   host secret stays in Electron main-process memory
-   viewer token cannot publish or stop session
-   default token expiration around 60 minutes
-   Stop Sharing invalidates session/token
-   basic join/session creation rate limits
-   privileged endpoints reject unapproved browser origins
-   API key stays in Electron main
-   sharing failure must not block AI generation

Viewer receives only:

-   session status
-   current response snapshot
-   `response_start`
-   `response_delta`
-   `response_complete`
-   session-ended

Viewer must NEVER receive:

-   transcript
-   audio
-   screenshots
-   typed prompt
-   file contents
-   file names
-   workspace
-   session memory
-   internal prompts
-   host secret
-   OpenAI API key
-   filesystem data

------------------------------------------------------------------------

# 28. SHARING STREAMING SEMANTICS

Accepted AI deltas are published only after existing
request-ID/stale-response checks.

Expected behavior:

Old response remains visible.

When host generates a new response:

-   do not immediately blank old response
-   on first valid new delta → `response_start`
-   replace old response
-   stream new deltas

Late viewer:

-   receives current response snapshot immediately
-   then receives future streams

------------------------------------------------------------------------

# 29. SHARING TESTS / BUILDS PREVIOUSLY REPORTED

Reported tests included:

-   session creation
-   secure token format
-   invalid-token rejection
-   valid viewer join
-   viewer-token publish rejection
-   progressive streaming
-   late-join restoration
-   second-answer replacement
-   stop/token invalidation
-   expiration
-   disallowed-origin rejection
-   viewer payload privacy

Reported commands that passed at that stage:

``` text
npm.cmd run build
npm.cmd run build:share-server
npm.cmd --prefix server test
```

Local run:

Terminal 1:

``` text
cd D:\project
npm.cmd run share-server
```

Terminal 2:

``` text
cd D:\project
npm.cmd run dev
```

Browser viewer:

`http://localhost:3001/view`

------------------------------------------------------------------------

# 30. RENDER DEPLOYMENT PLAN

The sharing server was being prepared for Render deployment.

Only:

-   `server/`
-   browser `/view`

need to be deployed.

Electron host remains on Windows.

Production considerations:

-   bind to `0.0.0.0`
-   use `process.env.PORT`
-   Render commonly provides `PORT`
-   HTTP + WebSocket use same public service/port
-   production WebSocket uses `wss://`
-   health endpoint such as `/health`
-   heartbeat/ping-pong
-   graceful SIGTERM
-   environment variables, not committed secrets

Possible environment values:

`NODE_ENV=production`

`VIEWER_BASE_URL=https://<render-domain>`

`SHARE_SESSION_TTL_MINUTES=60`

Electron:

`SHARE_SERVER_URL=https://<render-domain>`

In-memory sessions disappear on restart/deploy; acceptable for V1.

Keep one instance while sessions are RAM-only.

------------------------------------------------------------------------

# 31. FLOATING VIEWER --- NEXT/RECENT FEATURE DIRECTION

The user wants the remote viewer to eventually have a normal floating
desktop experience similar to the host, while remaining read-only.

Desired architecture:

Host Floating Assistant\
→ sharing server\
→ remote Floating Viewer Electron app

The remote viewer should be a separate lightweight Electron app.

It can support:

-   viewer token entry
-   Connect / Disconnect
-   current AI response
-   streaming response
-   Markdown
-   code blocks
-   copy response/code
-   frameless floating window
-   always-on-top
-   draggable
-   resizable
-   opacity controls
-   collapse-to-bubble
-   expand
-   normal arrow cursor
-   X quits viewer

It must NOT support:

-   Generate Answer
-   Capture Question
-   microphone
-   system audio
-   transcript
-   screenshots
-   host prompt
-   files
-   workspace
-   session memory
-   OpenAI calls
-   host control
-   publishing
-   stopping host sharing

Browser `/view` should remain available too.

The viewer should reuse the existing viewer token and WebSocket protocol
rather than creating a new auth system.

------------------------------------------------------------------------

# 32. AUTH / ADMIN --- FUTURE, NOT CURRENT PRIORITY

A larger future architecture was discussed:

-   email/password
-   roles ADMIN / USER
-   PostgreSQL
-   access/refresh tokens
-   backend RBAC
-   admin panel
-   authorized live sessions
-   admin could provide instructions to authorized sessions

However, this was intentionally postponed.

Current priority became simple token-based read-only sharing first.

Do NOT prematurely introduce database/auth/admin unless explicitly
requested.

------------------------------------------------------------------------

# 33. SCREEN CAPTURE / SCREEN-SHARING SAFETY BOUNDARY

The project can implement legitimate:

-   user-triggered screenshot capture
-   rectangle selection
-   normal floating-window UX
-   always-on-top
-   transparency
-   opacity
-   bubble mode
-   authorized screen-sharing testing
-   research into normal screen-capture behavior

Do NOT provide or implement features specifically intended to:

-   evade proctoring
-   bypass monitoring
-   hide processes from monitoring software
-   manipulate Google Meet/Teams/Zoom to conceal activity
-   defeat capture/detection mechanisms
-   make the application "undetectable"

When fixing capture UX, modify OUR Electron application only.

Do not manipulate Meet, Chrome, Teams, Zoom, WebRTC, or unrelated
application processes.

------------------------------------------------------------------------

# 34. SCREEN CAPTURE UX TARGET

The desired normal experience is:

``` text
NORMAL DESKTOP

Press Ctrl+Alt+S

NORMAL LIVE DESKTOP
normal arrow cursor

Drag:

        ┌──────────────────────┐
        │ selected region      │
        └──────────────────────┘

Release

selection UI disappears
→ screenshot acquired
→ crop
→ pendingScreenshots[]
→ assistant restored
```

No:

-   frozen desktop
-   giant cyan block
-   black full screen
-   bright full screen
-   dark overlay
-   giant border
-   crosshair cursor
-   capture toolbar

ESC should cancel and restore prior assistant presentation.

------------------------------------------------------------------------

# 35. MULTI-MONITOR / DPI

Capture and window restoration must preserve:

-   multiple monitors
-   negative monitor coordinates
-   Electron DIP coordinates
-   physical screenshot pixels
-   `display.scaleFactor`
-   Windows 125% / 150% scaling

Do not assume:

1 CSS pixel = 1 screenshot pixel.

Keep coordinate conversion explicit.

------------------------------------------------------------------------

# 36. WINDOW FOCUS PRINCIPLE GOING FORWARD

This is especially important for the next conversation.

The latest issue is:

The user wants Chrome's tab/title area to visually remain the same when
interacting with the Floating Assistant.

Technical reality:

Windows normally has one foreground keyboard-focus window.

When Floating Assistant becomes foreground, Chrome can render
inactive-window styling.

Safe/normal improvement:

Remove unnecessary assistant focus transfers.

Examples where assistant usually should not explicitly call `focus()`:

-   show after shortcut
-   restore after screenshot
-   restore after ESC
-   bubble expansion
-   moving window
-   passive always-on-top display

Potentially use `showInactive()` where appropriate and tested.

However, when user explicitly clicks/types into the assistant text
input, Electron needs keyboard focus, and Chrome may legitimately switch
to inactive styling.

Do NOT:

-   fake Chrome active state
-   manipulate Chrome
-   inject Chrome
-   use OS tricks to pretend both are active

If the user asks to continue this exact issue in a new chat, start by
inspecting/removing unnecessary `mainWindow.focus()` calls and
distinguishing `alwaysOnTop` from foreground focus.

------------------------------------------------------------------------

# 37. IMPORTANT COMMANDS

Main project:

``` text
cd D:\project
npm.cmd run dev
```

Build:

``` text
cd D:\project
npm.cmd run build
```

Sharing server:

``` text
cd D:\project
npm.cmd run share-server
```

Sharing server build:

``` text
npm.cmd run build:share-server
```

Sharing server tests:

``` text
npm.cmd --prefix server test
```

Adjust only if current package scripts have changed.

------------------------------------------------------------------------

# 38. HOW I WANT CODEX PROMPTS WRITTEN

When I ask "give me Codex prompt," produce a detailed prompt that Codex
can act on.

Preferred structure:

``` text
PROJECT:
D:\project

TASK:
...

CURRENT BEHAVIOR:
...

EXPECTED BEHAVIOR:
...

1. INSPECT FIRST
...

2. ROOT CAUSE
...

3. IMPLEMENTATION
...

4. DO NOT BREAK
...

5. TESTS
...

6. BUILD
...

7. FINAL REPORT
...
```

Important phrases to include when relevant:

-   "DO NOT redesign unrelated working functionality."
-   "Make the smallest correct change."
-   "Inspect the current implementation before changing code."
-   "Do not report success if build/tests fail."
-   "Run `npm.cmd run build`."
-   "Tell me the exact root cause."
-   "List exact files/functions changed."
-   "Preserve existing functionality."

------------------------------------------------------------------------

# 39. GENERAL DEVELOPMENT PHILOSOPHY FOR THIS PROJECT

Prefer:

-   targeted fixes
-   explicit resource ownership
-   persistent main BrowserWindow
-   state preservation
-   narrow IPC
-   immutable request snapshots
-   request IDs for streaming
-   race-safe async operations
-   bounded memory
-   graceful cleanup
-   type-aware file handling
-   one coherent AI request for current user context
-   clear dev logging without secrets

Avoid:

-   giant refactors for small bugs
-   stopping/restarting unrelated services
-   global cleanup functions that own everything
-   duplicate BrowserWindows when HTML/CSS can do the job
-   arbitrary setTimeout fixes
-   raw API keys in renderer
-   hard-coded `D:\project` runtime paths
-   leaking private host context to viewer
-   silent truncation of important files/context

------------------------------------------------------------------------

# 40. RESOURCE OWNERSHIP RULE

Keep service ownership strict.

Microphone service: → microphone resources only

System audio service: → system-audio resources only

Screen capture service: → screenshot-specific resources only

Selection UI: → selection-window/UI resources only

Realtime service: → realtime socket/state only

Main window restoration: → presentation state only

Share publisher: → response-sharing connection only

App quit: → coordinated application-wide cleanup

This rule prevents many of the regressions already encountered.

------------------------------------------------------------------------

# 41. REQUEST SNAPSHOT RULE

When Generate Answer is pressed, snapshot relevant input atomically.

Possible snapshot:

-   typed prompt
-   pending screenshots
-   pending files
-   current conversation
-   relevant workspace state
-   session context

Do not allow later UI mutations to silently alter an already-dispatched
request.

Clear/consume pending inputs only after successful dispatch according to
current application semantics.

------------------------------------------------------------------------

# 42. VIEWER PRIVACY RULE --- NEVER BREAK THIS

Even if host attaches:

-   PDF
-   Word document
-   source code
-   screenshot
-   typed private instruction

the remote viewer receives only the resulting AI response.

Do not send filenames either unless explicitly redesigned later.

The server must enforce this structurally; do not merely hide data with
CSS.

------------------------------------------------------------------------

# 43. MOST RECENT NEXT STEP

If no newer information is supplied when this handoff is uploaded, the
most recent technical topic to continue is:

**Floating Assistant focus behavior vs Chrome/VS Code active/inactive
title-bar appearance.**

Next debugging step:

1.  Search `electron/main.ts` and related code for:

    -   `mainWindow.focus()`
    -   `show()`
    -   `showInactive()`
    -   `restore()`
    -   `moveTop()`
    -   `setAlwaysOnTop()`
    -   `setFocusable()`
    -   `app.focus()`

2.  Add temporary dev logging around focus transitions.

3.  Remove unnecessary explicit `focus()` calls.

4.  Use non-focus-stealing show/restore behavior where normal Electron
    APIs allow it.

5.  Preserve keyboard focus when user genuinely needs to type in the
    assistant.

6.  Keep always-on-top separate from foreground focus.

7.  Do not manipulate Chrome itself.

8.  Regression-test:

    -   capture
    -   ESC
    -   bubble
    -   Ctrl+Alt+B
    -   movement
    -   text input
    -   always-on-top
    -   privacy
    -   MIC/SYSTEM
    -   Realtime
    -   sharing

9.  Run: `npm.cmd run build`

------------------------------------------------------------------------

# 44. WHAT TO SAY IN A NEW CHAT

After uploading this file, I can simply say:

**"Read this handoff completely. Continue my D:`\project `{=tex}Floating
Assistant from the latest state. The current issue is \[describe
issue\]. Give me the Codex prompt and do not break the features already
marked working."**

Or:

**"Read this file and continue from section 43."**

That should be enough context to continue without re-explaining the
entire project.

------------------------------------------------------------------------

# 45. FINAL NOTE TO FUTURE CHATGPT

Do not assume every historical bug is still present.

This file records both architecture and bug history.

When the user reports the current state:

-   their newest observation overrides an older bug description
-   preserve fixes that they say are working
-   inspect before changing architecture
-   focus on the newest regression
-   keep the project buildable and testable

The user is iterating rapidly with Codex, so always ask Codex to inspect
the actual current repository state rather than assuming an older
implementation detail is still exact.
