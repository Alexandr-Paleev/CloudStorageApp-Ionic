# 🛠️ Scripts

## Icon Generation

### `generate-icons.js`

Generates PWA icons from SVG source.

**Usage:**

```bash
npm run generate:icons
```

**What it does:**
- Reads `public/icon.svg`
- Generates `public/icon-192x192.png`
- Generates `public/icon-512x512.png`

**Requirements:**
- `sharp` package (already in devDependencies)

**When to use:**
- After updating `public/icon.svg`
- When you need to regenerate icons

**Icon Guidelines:**
- ✅ No rounded corners (system applies them)
- ✅ No white borders
- ✅ Gradient/solid color to edges
- ✅ Safe area: keep important elements in center
- ✅ Test on light and dark backgrounds

**Icon Sizes:**
- `192x192` - minimum size for PWA
- `512x512` - high-resolution displays

---

**Created with ❤️ for Cloud Storage App**
