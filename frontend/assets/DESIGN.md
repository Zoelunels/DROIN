# DROIN Design System

> **Your money, in its place.**

DROIN is a personal money-management app built around the metaphor of a **small digital drawer**: a simple, private place where you put things, organize them, and know where they are.

## Brand personality

- Cute, but not childish
- Minimal, but not sterile
- Warm, but not overly soft
- Friendly, with occasional dry humor
- Tactile / object-inspired
- Calm rather than "fintech corporate"

### The rule

**90% calm + 10% silly.**

Keep the interface clean. Let the mascot, microcopy, and tiny visual details carry most of the personality.

---

## Logo

### Primary mark

The primary identity combines:
1. A rounded drawer mascot
2. A friendly face
3. Two small orange spark marks
4. The DROIN wordmark

The face is intentionally subtle. It should feel like a tiny companion, not a cartoon character.

### Wordmark

Use the DROIN wordmark as the primary textual brand.

Do not add:
- dollar signs
- generic coin illustrations
- bank/building symbols
- gradients by default
- unnecessary decorative outlines

### Clear space

Keep at least **0.5× the mascot height** of empty space around the logo.

### Minimum size

- Full logo: ~120 px wide minimum on digital interfaces
- Icon/mascot: ~24 px minimum for UI; use simplified icon at very small sizes

---

## Color

| Token | Hex | Use |
|---|---|---|
| Primary Orange | `#E8A04A` | CTA, highlights, mascot accent |
| Cream | `#F7F4ED` | Main background |
| Charcoal | `#242321` | Text and logo |
| Secondary Gray | `#858078` | Secondary text |
| Soft Peach | `#FAD7B7` | Soft accent surfaces |
| Income Green | `#6F8F72` | Positive/income |
| Expense Terracotta | `#C96A4A` | Expense/warning |

### Color philosophy

Avoid the typical fintech green/blue visual language as the default brand palette.

Green is reserved for **semantic income/positive states**, not the primary brand.

Red/terracotta should be used for **expense/error states**, not as a dominant brand color.

---

## Typography

Recommended:

- **Primary UI:** Manrope
- Alternatives: Inter, Geist Sans, Nunito Sans

### Hierarchy

- Display / balance: Bold or ExtraBold
- Heading: Bold
- Body: Regular / Medium
- Metadata: Medium
- Microcopy: Medium

Do not use too many weights.

---

## UI shape language

- Border radius: 12–20 px for cards
- Buttons: 12–16 px
- Inputs: 12–14 px
- Icon containers: rounded
- Avoid excessive pill-shaped UI

The drawer mascot has rounded geometry; the product UI should echo that geometry without becoming bubbly.

---

## Microcopy

DROIN should occasionally sound like a tiny drawer that notices what is happening.

### Examples

Instead of:
`Add transaction`

Use:
`Put something in`

Instead of:
`No transactions`

Use:
`Nothing happened here. Suspicious.`

Instead of:
`Expense added`

Use:
`Into the drawer it goes.`

Instead of:
`Remaining balance`

Use:
`Still got some.`

Use this sparingly. Important financial information should remain clear and professional.

---

## Iconography

Use simple line or filled geometric icons.

Good:
- drawer
- folder
- receipt
- calendar
- chart
- arrow
- tiny sparkle

Avoid:
- dollar-sign-heavy icon sets
- realistic coins
- bank buildings
- overly detailed illustrations

---

## Do / Don't

### Do
- Keep whitespace generous
- Use warm neutrals
- Let orange be an accent
- Use the mascot sparingly
- Keep financial numbers extremely readable
- Use humor as a small surprise

### Don't
- Make every screen cute
- Put the mascot everywhere
- Use green as the brand color
- Overuse orange
- Turn the app into a game
- Sacrifice information hierarchy for personality

---

## Suggested tagline

### Primary
**Your money, in its place.**

### Alternatives
- Keep track. Keep control.
- A little drawer for your money.
- Know what you keep.
- Put it in the drawer.

---

## Asset naming

- `droin-logo-horizontal.png` — full horizontal logo
- `droin_wordmark.png` — wordmark
- `droin_drawer_mascot.png` — mascot
- `droin-app-icon-1024.png` — app icon
- `colors.json` — color tokens

