# scan-ecco

Source for **scan.etherealconnectionsco.com** — ECCO's AI Compliance Gap Scanner.
40+ verticals. 5-question assessment. 60-second exposure read across the five
ECCO integrity layers.

## Doctrine

Every external claim on this page resolves to live content. The build pipeline
enforces this — `node check-links.mjs index.html` runs on every deploy, and the
build fails on any 4xx/5xx response. The previous good version stays live until
the next green build.

> Every claim verifiable. Every link live. Build pipeline enforced.

## Stack

- **Source:** single-file `index.html` (vanilla HTML/CSS/JS, no framework)
- **Build gate:** `check-links.mjs` (Node 20+, zero dependencies, native fetch)
- **Host:** Netlify, Git-driven CI from this repo
- **Config:** `netlify.toml`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Scanner source — 41 verticals, ~125 reference URLs |
| `check-links.mjs` | Build-time link integrity gate |
| `netlify.toml` | Netlify build configuration |
| `seal.jpg` | ECCO seal asset |

---

**Ethereal Connections Co.** · Denver, CO · Founded 2025
[etherealconnectionsco.com](https://etherealconnectionsco.com) · *Infrastructure over influence.*
