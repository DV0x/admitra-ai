# AdMitra Presets

All language, festival, business type, and format presets.

---

## Language Presets

### hindi
- Script: Devanagari
- Sample greeting: "दीपावळी की शुभकामनाएं!"
- Sample CTA: "अभी खरीदें!"
- Tone: Formal or casual Hinglish

### telugu
- Script: Telugu
- Sample greeting: "సంక్రాంతి శుభాకాంక్షలు!"
- Sample CTA: "ఇప్పుడే షాప్ చేయండి!"
- Tone: Formal or conversational

### tamil
- Script: Tamil
- Sample greeting: "பொங்கல் வாழ்த்துக்கள்!"
- Sample CTA: "இப்போதே வாங்குங்கள்!"
- Tone: Formal

### kannada
- Script: Kannada
- Sample greeting: "ದೀಪಾವಳಿ ಶುಭಾಶಯಗಳು!"
- Sample CTA: "ಈಗಲೇ ಶಾಪ್ ಮಾಡಿ!"
- Tone: Formal

### malayalam
- Script: Malayalam
- Sample greeting: "ഓണാശംസകൾ!"
- Sample CTA: "ഇപ്പോൾ ഷോപ്പ് ചെയ്യൂ!"
- Tone: Formal

### bengali
- Script: Bengali
- Sample greeting: "দীপাবলির শুভেচ্ছা!"
- Sample CTA: "এখনই কিনুন!"
- Tone: Formal

### marathi
- Script: Devanagari
- Sample greeting: "दीपावलीच्या हार्दिक शुभेच्छा!"
- Sample CTA: "आत्ताच खरेदी करा!"
- Tone: Formal

### gujarati
- Script: Gujarati
- Sample greeting: "દિવાળીની શુભેચ્છાઓ!"
- Sample CTA: "હમણાં ખરીદો!"
- Tone: Formal

### english
- Script: Latin
- Sample greeting: "Happy Diwali!"
- Sample CTA: "Shop Now!"
- Tone: Professional or casual

---

## Festival Presets

### diwali
- Colors: Gold, deep red, orange, warm amber
- Motifs: Diyas (oil lamps), rangoli patterns, fireworks, lanterns
- Visual style: Warm golden lighting, rich and festive
- Common phrase structure: "[Festival greeting]! [Offer] [CTA]"

### sankranti
- Colors: Yellow, orange, green, sky blue
- Motifs: Colorful kites, sugarcane, harvest elements
- Visual style: Bright, outdoor feel, harvest celebration
- Primary language: Telugu

### pongal
- Colors: Yellow, green, orange, earth tones
- Motifs: Pongal pot, sugarcane, kolam designs, sun
- Visual style: Traditional, harvest celebration
- Primary language: Tamil

### holi
- Colors: Rainbow - bright pink, blue, green, yellow, orange
- Motifs: Color powder splashes, water guns, gulaal
- Visual style: Vibrant, explosive color, joyful energy

### eid
- Colors: Green, gold, white, royal blue
- Motifs: Crescent moon, star lanterns, mosque silhouette
- Visual style: Elegant, refined, celebratory

### onam
- Colors: Gold, white, yellow, green
- Motifs: Pookalam (flower carpet), Vallam Kali (snake boat), banana leaf
- Visual style: Traditional Kerala, golden
- Primary language: Malayalam

### navratri
- Colors: Red, yellow, green, saffron (rotating daily)
- Motifs: Garba dancers, dandiya sticks, goddess Durga
- Visual style: Energetic, devotional, colorful

### christmas
- Colors: Red, green, gold, white
- Motifs: Stars, bells, Christmas tree, gifts, snow
- Visual style: Warm, cheerful, western-Indian fusion

### new-year
- Colors: Gold, silver, blue, purple
- Motifs: Fireworks, champagne, confetti, clock
- Visual style: Glamorous, celebratory

### generic-sale
- Colors: Red, yellow, bright orange (urgency colors)
- Motifs: Shopping bags, discount tags, price slash, "SALE" badge
- Visual style: Bold, attention-grabbing, retail energy

---

## Business Type Presets

### clothing
- Product keywords: saree, kurta, lehenga, western wear, t-shirts
- Photo style: Model wearing the outfit, fabric close-ups
- Background: Lifestyle or studio

### jewelry
- Product keywords: gold necklace, bangles, earrings, diamond, silver
- Photo style: Close-up on jewelry, warm lighting, reflective surfaces
- Background: Velvet, dark with spotlight

### food
- Product keywords: sweets, snacks, restaurant, tiffin, biryani
- Photo style: Overhead flat-lay, steam, rich colors
- Background: Rustic table, banana leaf, thali

### electronics
- Product keywords: mobile, laptop, TV, headphones, camera
- Photo style: Product hero shot, minimal, tech-forward
- Background: Gradient, clean minimal surface

### beauty
- Product keywords: skincare, makeup, haircare, ayurvedic
- Photo style: Product with ingredients, soft lighting
- Background: Pastel, clean, botanical elements

### general
- Product keywords: (user-defined)
- Photo style: Product-focused, clean
- Background: White or solid color

---

## Ad Format Presets

### instagram-post
- Aspect ratio: 1:1
- Resolution: 2K
- Text size: Large, bold
- Layout: Centered, single focus

### instagram-story
- Aspect ratio: 9:16
- Resolution: 2K
- Text size: Large, stacked vertically
- Layout: Vertical, swipe-up CTA area at bottom

### whatsapp-status
- Aspect ratio: 9:16
- Resolution: 1K (smaller file size)
- Text size: Large, bold
- Layout: Simple, high contrast (viewed on small screens)

### print-flyer
- Aspect ratio: 3:4
- Resolution: 4K
- Text size: Medium, more content space
- Layout: Traditional ad layout, header + body + footer

---

## Usage in Prompts

When building image generation prompts, combine presets:

### Example: Telugu + Diwali + Jewelry + Instagram Post

Festival: diwali -> gold/red colors, diyas, rangoli
Business: jewelry -> close-up, warm lighting, reflective
Format: instagram-post -> 1:1, bold text
Language: telugu -> native script text

Resulting prompt:
```
A professional Diwali sale advertisement poster for a jewelry store. Bold Telugu text at the top reading "[Telugu headline]" (English translation). Beautiful gold necklace set displayed prominently with warm golden lighting. Festive background with glowing diyas, rangoli patterns, and deep red and gold colors. At the bottom, a bright banner with offer text in Telugu. Professional advertisement design, clean layout, 1:1 square format, high quality.
```
