# VIDEO_AD_PROMPT Template

Motion prompt for animating a static ad into a short video.

## Template

```
{MOTION_DESCRIPTION}. The text remains sharp and readable. Professional advertisement video.
```

## Motion Presets

### product-focus
```
Camera slowly zooms into the product, subtle sparkle effects on jewelry/metallic elements, warm lighting intensifies
```

### festive-energy
```
Subtle animation of festive elements - diyas flickering, rangoli colors gently pulsing, warm glow effect spreading across the frame
```

### text-reveal
```
Camera slowly pans from left to right, revealing the full ad layout, text elements stay crisp and readable
```

### slow-pan
```
Gentle slow zoom in on the entire ad, creating depth and focus, maintaining text readability throughout
```

## Usage

After generating a static ad, propose generate_video_ad with one of these motion presets:

```bash
npx tsx .claude/skills/action-proposer/propose-action.ts \
  --templateId generate_video_ad \
  --label "Animate Telugu Diwali Ad" \
  --params '{"motionPrompt": "Camera slowly zooms into the product, subtle sparkle effects on jewelry elements, warm lighting intensifies. The text remains sharp and readable. Professional advertisement video.", "language": "Telugu", "duration": "5"}'
```

## Tips

- Always include "The text remains sharp and readable" to prevent text distortion
- Use "Professional advertisement video" at the end for quality framing
- Keep motion subtle - dramatic camera moves can distort text and layout
- 5 seconds is usually sufficient for social media ads
- 10 seconds works for more elaborate motion or story-driven ads
