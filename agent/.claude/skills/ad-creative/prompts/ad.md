# AD_PROMPT Template

Generates a single-language advertising creative.

## Template

Replace placeholders with selections from `../presets/options.md`:

```
A professional {FESTIVAL_NAME} sale advertisement poster for a {BUSINESS_TYPE} business.

Bold {LANGUAGE_NAME} text at the top reading "{HEADLINE_NATIVE}" ({HEADLINE_ENGLISH}).

{PRODUCT_DESCRIPTION}

{FESTIVAL_VISUAL_ELEMENTS}

At the bottom, a prominent banner with text reading "{OFFER_NATIVE}" ({OFFER_ENGLISH}).

{BUSINESS_NAME_LINE}

Professional advertisement design, clean layout, {FORMAT_DESCRIPTION}, high quality print ad.
```

## Placeholders

| Placeholder | Source | Example |
|-------------|--------|---------|
| {FESTIVAL_NAME} | presets/options.md -> Festival | "Diwali" |
| {BUSINESS_TYPE} | presets/options.md -> Business | "jewelry" |
| {LANGUAGE_NAME} | presets/options.md -> Language | "Telugu" |
| {HEADLINE_NATIVE} | Claude-generated | "[native script headline]" |
| {HEADLINE_ENGLISH} | Translation | "Diwali Special Offer!" |
| {PRODUCT_DESCRIPTION} | From user input / reference images | "Beautiful gold necklace set with warm lighting" |
| {FESTIVAL_VISUAL_ELEMENTS} | presets/options.md -> Festival motifs/colors | "Festive background with diyas, rangoli, gold and red" |
| {OFFER_NATIVE} | Claude-generated | "[native script offer text]" |
| {OFFER_ENGLISH} | Translation | "30% discount" |
| {BUSINESS_NAME_LINE} | Optional | "Small text: Lakshmi Jewellers, Hyderabad" |
| {FORMAT_DESCRIPTION} | presets/options.md -> Format | "1:1 square format" |

## Example: Telugu Diwali Jewelry Ad

```
A professional Diwali sale advertisement poster for a jewelry business.

Bold Telugu text at the top reading "[Telugu headline]" (Diwali Special Offer).

Beautiful gold necklace set displayed prominently with warm golden lighting and reflective surfaces.

Festive background with glowing diyas, intricate rangoli patterns, and warm golden amber lighting with deep red and gold color palette.

At the bottom, a prominent banner with offer text in Telugu (30% off on gold jewelry).

Small elegant text: Lakshmi Jewellers, Hyderabad.

Professional advertisement design, clean layout, 1:1 square format, high quality print ad.
```

## Execution

After filling template, propose via action-proposer:

```bash
npx tsx .claude/skills/action-proposer/propose-action.ts \
  --templateId generate_ad \
  --label "Telugu Diwali Ad - Jewelry Offer" \
  --params '{"prompt": "<FILLED_AD_PROMPT>", "language": "Telugu", "aspectRatio": "1:1", "resolution": "2K", "useReferenceImages": true}'
```
