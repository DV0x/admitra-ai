# AdMitra Frontend — Complete Implementation Guide

**Date:** 2026-02-15
**Status:** Implemented (Steps 1-10 complete, Step 11 pending verification)
**Source:** Built in-house for AdMitra

---

## Architecture Overview

- **Project:** `/Users/chakra/Documents/Agents/admitra-ai/frontend/`
- **Stack:** React 19 + Vite 7 + Tailwind v4 + Framer Motion
- **Backend:** Express on port 3003, WebSocket at `ws://localhost:3003/ws`
- **Action templates:** `generate_ad`, `generate_video_ad` (2 total)

White-themed "Premium Studio" UI for AdMitra (an Indian small business ad creative agency).

---

## Design System: "Premium White Studio"

### Colors (CSS Variables)
```
--color-background:       #FFFFFF      (pure white)
--color-surface:          #FAFAF8      (warm off-white)
--color-surface-elevated: #F5F3F0      (slightly darker warm)
--color-border:           #E5E7EB      (whisper-thin gray)

--color-text-primary:     #111827      (near-black)
--color-text-secondary:   #6B7280      (mid gray)
--color-text-muted:       #9CA3AF      (light gray)

--color-accent:           #D97706      (warm saffron — Indian-inspired)
--color-accent-hover:     #B45309      (darker saffron on hover)
--color-accent-muted:     rgba(217, 119, 6, 0.1)

--color-success:          #059669      (emerald green)
--color-error:            #DC2626      (red)
--color-warning:          #D97706      (same as accent)
```

### Typography
```
--font-display:  'Instrument Serif', Georgia, serif     (brand name + headings)
--font-body:     'Inter', system-ui, sans-serif         (body text, clean/premium)
--font-mono:     'Geist Mono', monospace                (code blocks, tool output)
```

### Key Visual Rules
- **User messages:** Saffron background `bg-accent`, white text, rounded pill
- **Assistant messages:** White card `bg-white`, subtle warm shadow, thin border
- **ActionCard:** White card, soft shadow, saffron "Generate" CTA button
- **No film-frame effect**
- **No dark theme** (all `prose-invert` replaced with `prose`)
- **Thinking dots & streaming cursor:** Saffron colored
- **Rangoli pattern:** Subtle SVG background on empty state

---

## Implementation Steps (11 Steps)

### Step 1: Scaffold ✅
- `package.json` — name: "admitra-frontend"
- `vite.config.ts` — proxy to port 3003
- `index.html` — AdMitra title, Instrument Serif + Inter fonts, white theme-color
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `src/main.tsx`
- Ran `npm install` — 271 packages, 0 vulnerabilities

### Step 2: Core Logic ✅
- `src/lib/types.ts` — All types, removed PosePreset/BackgroundPreset/PresetSelection, added `costUsd` to GenerateResponse for P1 alignment
- `src/lib/api.ts` — Generic HTTP helpers (health, sessions, upload, cancel)

### Step 3: Theme ✅
- `src/index.css` — Full white studio theme rewrite with CSS variables, rangoli pattern, thinking dots, streaming cursor, skeleton loading

### Step 4: Layout ✅
- `src/components/layout/AppShell.tsx` — "AdMitra" branding, white header, "Powered by Claude Agent SDK" footer

### Step 5: UI Primitives ✅
- `src/components/ui/Button.tsx` — Primary/secondary/ghost variants
- `src/components/ui/IconButton.tsx` — Round icon button
- `src/components/ui/Spinner.tsx` — Saffron-colored spinner

### Step 6: Chat Components ✅
- `src/components/chat/TextMessage.tsx` — User=saffron bubbles, assistant=white cards with shadow
- `src/components/chat/ThinkingMessage.tsx` — Collapsible with tool badges
- `src/components/chat/ToolCallBlock.tsx` — Tool icon mapping, duration badges
- `src/components/chat/ToolUseBlock.tsx` — Expandable tool use display
- `src/components/chat/ProgressMessage.tsx` — Animated progress bar on white card

### Step 7: Media Components ✅
- `src/components/chat/ImageMessage.tsx` — Clean rounded (no film-frame), lightbox
- `src/components/chat/ImageGrid.tsx` — Language badges from filename, "X Ads" caption
- `src/components/chat/VideoMessage.tsx` — "Video Ad" label, admitra-video download
- `src/components/chat/VideoGrid.tsx` — "X Video Ads" caption, simple clip numbers

### Step 8: Action Components ✅
- `src/components/chat/ActionCard.tsx` — White cards, saffron CTA, form fields, artifact rendering
- `src/components/chat/ContinueButton.tsx` — Saffron pill button

### Step 9: Voice Input (NEW) ✅
- `src/components/chat/VoiceInput.tsx` — Web Speech API, 9 Indian languages (Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, English)

### Step 10: Integration Components ✅
- `src/components/chat/ChatInput.tsx` — VoiceInput integration, image upload, auto-resize textarea
- `src/components/chat/ChatView.tsx` — Welcome screen with suggestion chips, message grouping, activity indicator, rangoli pattern
- `src/App.tsx` — Wires useWebSocket to ChatView + ChatInput, no presets
- `src/hooks/useWebSocket.ts` — Main WebSocket hook with P0/P1/P2 adjustments

### Step 11: Verify ⏳
```bash
# Terminal 1 — Backend
cd /Users/chakra/Documents/Agents/admitra-ai && npm run dev

# Terminal 2 — Frontend
cd /Users/chakra/Documents/Agents/admitra-ai/frontend && npm run dev
```
Open http://localhost:5173 and verify:
1. White theme loads with "AdMitra" branding
2. WebSocket connects (console: `[WS] Connected`)
3. Suggestion chips visible in empty state
4. Type a message → streaming works
5. Upload an image → upload works
6. Voice mic button → browser permission prompt
7. Full flow: "Create a Diwali ad for my jewelry shop in Telugu" → agent → ActionCard → Execute → image

---

## P0/P1/P2 SDK Adjustments Applied

These changes align the frontend with server-side SDK changes already in `admitra-ai`:

| Change | File | Detail |
|--------|------|--------|
| `costUsd` field | `useWebSocket.ts` | Added to WSServerMessage interface |
| `title` field | `useWebSocket.ts` | Added to WSServerMessage interface |
| `tool_complete` handler | `useWebSocket.ts` | Clears activity indicator on tool completion |
| `notification` handler | `useWebSocket.ts` | Sets activity from notification title/message |
| `costUsd` extraction | `useWebSocket.ts` | Logs session cost in `complete` handler |
| `costUsd` in types | `types.ts` | Added `costUsd?: number` to GenerateResponse |

---

## Complete File Tree

```
admitra-ai/frontend/
  package.json                              # name: admitra-frontend
  vite.config.ts                            # proxy to port 3003
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  index.html                                # AdMitra title, fonts, white theme-color
  src/
    main.tsx
    index.css                               # White studio theme (full rewrite)
    App.tsx                                 # No presets, passes onSend
    lib/
      types.ts                              # Core types with costUsd
      api.ts                                # Generic HTTP helpers
    hooks/
      useWebSocket.ts                       # Port 3003, no presets, P0/P1/P2 handlers
    components/
      layout/
        AppShell.tsx                         # "AdMitra" branding
      chat/
        ChatView.tsx                        # Welcome + suggestion chips + rangoli
        ChatInput.tsx                       # VoiceInput + image upload
        TextMessage.tsx                     # White assistant bubbles, prose
        ThinkingMessage.tsx                 # Collapsible thinking
        ActionCard.tsx                      # White cards, saffron CTA
        ImageMessage.tsx                    # Clean rounded (no film-frame)
        ImageGrid.tsx                       # Language badges
        VideoMessage.tsx                    # "Video Ad" labels
        VideoGrid.tsx                       # Simple clip numbers
        ProgressMessage.tsx                 # White card progress bar
        ContinueButton.tsx                  # Saffron pill
        ToolCallBlock.tsx                   # Tool icons
        ToolUseBlock.tsx                    # Expandable tool display
        VoiceInput.tsx                      # NEW — Web Speech API
      ui/
        Button.tsx
        IconButton.tsx
        Spinner.tsx
```

**Total files:** 24

---

## Design Highlights

| Feature | Detail |
|---------|--------|
| **Port** | 3003 |
| **Branding** | "AdMitra" |
| **Theme** | White (#FFFFFF) with saffron accent (#D97706) |
| **Fonts** | Instrument Serif (display) + Inter (body) |
| **Visual** | Clean rounded images, rangoli pattern |
| **Labels** | "Ads", "Video Ads" |
| **ImageGrid** | Language badges extracted from filename |
| **VideoGrid** | Simple clip numbers |
| **Welcome** | AdMitra tagline + suggestion chips |
| **Voice** | VoiceInput component (Web Speech API, 9 Indian languages) |
| **Placeholder** | "Describe your ad campaign..." |
