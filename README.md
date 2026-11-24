# Reactify: Named Reactions Quiz (v2)

A static web app (HTML + JS, no server) for identifying organic named reactions from their schemes.
It opens from a link on any phone or computer and can be "installed" from the browser
(*Share → Add to Home Screen* on iOS, *⋮ → Install app* on Android). Nothing needs to be downloaded.

```
reactify/
├── reactions.csv      ← the dataset (source of truth, edit this)
├── build.py           ← renders all schemes + computes look-alike distractors → docs/data.js
└── docs/              ← the website (this folder is what gets hosted)
    ├── index.html, styles.css, app.js
    ├── data.js        ← generated, don't edit by hand
    ├── sw.js, manifest.webmanifest, icons/   (offline + installable PWA)
```

## What changed vs. the Hugging Face / Gradio version
| | v1 (HF Space, Gradio) | v2 |
|---|---|---|
| Schemes | 45 hand-collected images, mixed styles | 136 reactions redrawn from SMILES with RDKit in **one style**, theme-aware (light/dark) |
| Wrong choices | `random.sample` from all names | ranked "confusability" (reaction class, reagents, name family, structures, bonds formed/broken), with Easy / Medium / Hard / Adaptive |
| Hosting | Gradio Space (sleeps, limited UI) | any static host; instant, free, full UI control, works offline |
| Progress | username/password JSON files (lost when the Space restarts) | saved on the device: streaks, accuracy, per-reaction mastery, spaced repetition, "review mistakes" |
| Learning | right/wrong only | explanation of the correct reaction **and** of the one you picked; browse/search mode |

## Add or edit a reaction
1. Add a row to `reactions.csv`:
   ```
   id,name,reactants,products,above,below,tags,note
   200,Swern Oxidation,CCCCCCCCO,CCCCCCCC=O,"1) (COCl)2, DMSO | 2) Et3N","CH2Cl2, −78 °C",oxidation;sulfur,"Short explanation…"
   ```
   * `reactants` / `products`: SMILES separated by `;` (use `2*SMILES` for a coefficient).
     Easiest way to get SMILES: draw in ChemDraw/PubChem Sketcher → *Copy as SMILES*.
   * `above` / `below`: text over/under the arrow; separate steps with `|`. Formulas like `H2SO4` and `H3O+`
     are auto-formatted (subscripts and charges).
   * `tags`: reaction-class keywords (see existing rows); they drive topic filters and distractor quality.
2. Rebuild: `python build.py` (needs `rdkit`: `pip install rdkit`).
3. Re-upload / push the `docs/` folder.

## Run locally
```
cd docs
python -m http.server 8000      # then open http://localhost:8000
```
(Opening `docs/index.html` directly also works, apart from offline mode.)

## Publish (pick one, all free)
**GitHub Pages (recommended):**
1. Create a public repo on github.com (e.g. `reactify`).
2. Upload the contents of this `reactify/` folder (web UI: *Add file → Upload files*, or `git push`).
3. Repo *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs`* → Save.
4. About a minute later the app is live at `https://<your-username>.github.io/reactify/`.
   Updates: push again, and users get the new version on their next visit.

**Netlify Drop (no account setup, no git):** go to https://app.netlify.com/drop and drag the `docs/` folder in.

**Cloudflare Pages:** connect the repo and set the output directory to `docs`, with no build command.

**Hugging Face (keep the old link):** change the Space's README header to `sdk: static` and upload the
contents of `docs/` to the Space root. The same app then runs there without Gradio.
