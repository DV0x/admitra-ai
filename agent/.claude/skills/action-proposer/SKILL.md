---
name: action-proposer
description: Propose actions for user approval instead of executing scripts directly. The user sees an ActionCard UI with editable parameters and controls execution.
---

# Action Proposer Skill

Propose ad generation actions for user review and approval. **NEVER execute generation scripts directly** - always use this skill to propose actions.

## How It Works

1. You call this skill with action details
2. The frontend displays an **ActionCard** with editable parameters
3. User reviews, modifies parameters if desired, and clicks "Generate"
4. Server executes the action and returns results
5. User clicks "Continue" to proceed
6. You receive feedback about results and any parameter changes

## Command

Pipe the params JSON via stdin (avoids shell escaping issues with Unicode/Indic text):

```bash
echo '<json_params>' | npx tsx .claude/skills/action-proposer/propose-action.ts \
  --templateId <template_id> \
  --label "<description>"
```

## Available Templates

| templateId | Stage | Description |
|------------|-------|-------------|
| `generate_ad` | ad | Create an ad image in a specific language |
| `generate_video_ad` | video | Animate a static ad into a short video |

## Template Parameters

### generate_ad
```json
{
  "prompt": "A professional Diwali sale advertisement poster...",
  "language": "Telugu",
  "aspectRatio": "1:1",
  "resolution": "2K",
  "useReferenceImages": true,
  "shopName": "Lakshmi Jewellers",
  "festival": "Diwali"
}
```
- `prompt` (required): Full image generation prompt with native script text
- `language`: Target language (Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, English)
- `aspectRatio`: 1:1 (Square), 9:16 (Story), 3:4 (Portrait), 16:9 (Landscape)
- `resolution`: 1K (Fast), 2K (Balanced), 4K (High Quality)
- `useReferenceImages`: Include uploaded product photos
- `shopName`: Business name (advanced, baked into prompt by Claude)
- `festival`: Festival context (advanced, baked into prompt by Claude)

### generate_video_ad
```json
{
  "motionPrompt": "Camera slowly zooms into the product...",
  "language": "Telugu",
  "duration": "5",
  "negativePrompt": "blur, distort, low quality, text changing"
}
```
- `motionPrompt` (required): Describe camera movement and animation
- `language`: Language of the source ad
- `duration`: 5 or 10 seconds
- `negativePrompt`: What to avoid (advanced)

## Examples

### Propose Ad Image
```bash
echo '{"prompt": "A professional Diwali sale advertisement poster for a jewelry business. Bold Telugu text at the top reading దీపావళి స్పెషల్ ఆఫర్ (Diwali Special Offer). Beautiful gold necklace set with warm golden lighting. Festive diyas and rangoli in gold and red. Offer banner at the bottom in Telugu. Professional ad design, 1:1 square format.", "language": "Telugu", "aspectRatio": "1:1", "resolution": "2K", "useReferenceImages": true}' | \
  npx tsx .claude/skills/action-proposer/propose-action.ts \
    --templateId generate_ad \
    --label "Telugu Diwali Ad - Jewelry Offer"
```

### Propose Video Ad
```bash
echo '{"motionPrompt": "Camera slowly zooms into the gold necklace, warm festive glow intensifies, diyas flicker subtly. The text remains sharp and readable. Professional advertisement video.", "language": "Telugu", "duration": "5"}' | \
  npx tsx .claude/skills/action-proposer/propose-action.ts \
    --templateId generate_video_ad \
    --label "Animate Telugu Diwali Ad"
```

## CRITICAL Rules

1. **ALWAYS explain your creative reasoning BEFORE proposing an action**
   - Describe what you're creating and why
   - Show the ad copy in native script to the user first
   - Mention preset choices and alternatives considered

2. **NEVER run generation scripts directly**
   - Don't call `generate-image.ts` or `generate-video.ts` directly
   - Always propose via this skill

3. **ONE action at a time**
   - Propose one action, wait for completion and continuation
   - Don't propose the next action until user continues
   - For multiple languages, propose sequential generate_ad actions

4. **User controls execution**
   - You propose, user decides to execute or modify
   - Respect parameter changes in your next response

## Response Format

The skill emits JSON that the server intercepts:
```json
{
  "type": "action_proposal",
  "instanceId": "action_<uuid>",
  "templateId": "generate_ad",
  "label": "Telugu Diwali Ad - Jewelry Offer",
  "params": { ... }
}
```

After user executes and continues, you receive feedback like:
```
[Action Completed: Generate Ad]
Result: SUCCESS
Artifact: /path/to/sessions/session_xxx/outputs/ads/ad-telugu-1739577600000.png
Duration: 12.3s

User Parameter Changes:
- aspectRatio: "1:1" -> "9:16"

User wants to continue. Comment on result and suggest next step.
```
