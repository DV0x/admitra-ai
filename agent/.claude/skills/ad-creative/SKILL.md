---
name: ad-creative
description: Provides prompt templates and presets for multilingual Indian advertising creatives. Contains language presets, festival themes, business types, and ad format templates. Use FIRST before proposing actions.
---

# Ad Creative Skill

Provides **prompt templates** and **presets** for generating multilingual Indian ad creatives.

**After getting presets from this skill** -> Use `action-proposer` skill to propose generation.

## Quick Reference

Match user's input to presets:

| User Says | Festival | Language(s) |
|-----------|----------|-------------|
| "Diwali sale" | diwali | Ask user |
| "Sankranti offer" | sankranti | Telugu (primary) |
| "Pongal discount" | pongal | Tamil (primary) |
| "Onam mega sale" | onam | Malayalam (primary) |
| "festival sale" | Ask user or use generic | Ask user |
| "Telugu ad" | Ask user | Telugu |
| "all languages" | Keep current | All 9 |

**Full preset details:** `.claude/skills/ad-creative/presets/options.md`
**Festival calendar:** `.claude/skills/ad-creative/presets/festival-calendar.md`
**Creative directions:** `.claude/skills/ad-creative/presets/creative-directions.md`

## Available Prompt Templates

| Template | Location | Use For |
|----------|----------|---------|
| AD_PROMPT | `.claude/skills/ad-creative/prompts/ad.md` | Single language ad poster |
| VIDEO_AD_PROMPT | `.claude/skills/ad-creative/prompts/video-ad.md` | Motion prompt for video ads |

## Prompt Construction

### Step 1: Draft the ad copy in the target language

Write the copy yourself (Claude is fluent in Indian languages). Include:
- **Headline** - Festival/occasion greeting or bold offer
- **Offer text** - Discount, deal details
- **Business name** - In native script if possible
- **CTA** - Call to action in the native language

### Step 2: Build the image generation prompt

Structure:
```
[Ad type and layout description]
[Native script text with placement - "Bold {LANGUAGE} text at the top reading '{HEADLINE}'"]
[English translation in parentheses]
[Product/subject description - from reference images or user description]
[Cultural visual elements - festival motifs, colors]
[Offer text placement - "At the bottom, text reading '{OFFER_TEXT}' in a banner"]
[Design framing - "Professional advertisement poster, clean layout, high quality"]
[Aspect ratio for target platform]
```

### Step 3: Propose via action-proposer

Use the `generate_ad` or `generate_video_ad` template.

## Rules

- Always draft copy in target language and show to user BEFORE generating
- Include both native script AND English translation in prompts
- Specify text placement explicitly ("at the top", "in a banner at the bottom")
- Match visual style to festival and business type
- Use presets from options.md for consistency
- NEVER reference generate_campaign - propose sequential generate_ad actions for multiple languages
