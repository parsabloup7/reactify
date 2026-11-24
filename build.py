"""
Reactify build script
=====================
reactions.csv  --->  docs/data.js   (everything the static web-app needs)

* Every molecule is redrawn from SMILES with RDKit using ONE drawing style
  (same bond length, line width, font and atom colours) -> unified schemes.
  Carbon/bond colour is written as `currentColor`, so schemes follow the
  light / dark theme of the page automatically.
* Identical molecules are drawn once and shared between reactions.
* For every reaction a ranked list of "confusable" reactions is precomputed
  (used by the quiz to pick challenging distractors). Similarity combines:
    - reaction class tags            (what kind of reaction)
    - reagent / condition overlap    (looks alike on paper)
    - name family                    (Claisen vs Claisen, Hofmann vs Hofmann ...)
    - structural similarity          (Morgan FP of reactants / products)
    - transformation similarity      (bits formed + broken: "what changes")

Usage:   python build.py
Edit reactions.csv (add a row), run the script, push the docs/ folder. Done.

CSV columns
-----------
id, name, reactants, products, above, below, tags, note
  reactants/products : SMILES separated by ';'   (prefix "2*" for a coefficient)
  above/below        : arrow text, steps separated by '|'
  tags               : ';'-separated reaction-class keywords
"""
from __future__ import annotations

import csv
import html
import json
import re
from pathlib import Path

from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import rdDepictor, rdFingerprintGenerator
from rdkit.Chem.Draw import rdMolDraw2D

RDLogger.DisableLog("rdApp.*")
rdDepictor.SetPreferCoordGen(True)

ROOT = Path(__file__).parent
CSV_PATH = ROOT / "reactions.csv"
OUT_PATH = ROOT / "docs" / "data.js"

N_NEIGHBOURS = 15

# --------------------------------------------------------------------------
# 1.  Unified molecule drawing
# --------------------------------------------------------------------------
# Heteroatom colours chosen to read well on both light and dark backgrounds.
PALETTE = {
    1: (0, 0, 0), 6: (0, 0, 0),                         # -> currentColor
    7: (0.23, 0.44, 0.96),                              # N  blue
    8: (0.90, 0.22, 0.27),                              # O  red
    9: (0.10, 0.62, 0.42), 17: (0.10, 0.62, 0.42),      # F, Cl green
    35: (0.72, 0.36, 0.10),                             # Br brown
    53: (0.58, 0.25, 0.86),                             # I  purple
    15: (0.93, 0.48, 0.10),                             # P  orange
    16: (0.80, 0.62, 0.05),                             # S  amber
    5: (0.05, 0.58, 0.53), 14: (0.05, 0.58, 0.53),      # B, Si teal
    3: (0.05, 0.58, 0.53), 11: (0.05, 0.58, 0.53),      # Li, Na
    12: (0.05, 0.58, 0.53), 19: (0.05, 0.58, 0.53),     # Mg, K
    29: (0.05, 0.58, 0.53), 30: (0.05, 0.58, 0.53),     # Cu, Zn
    47: (0.05, 0.58, 0.53), 50: (0.05, 0.58, 0.53),     # Ag, Sn
}


def draw_svg(mol: Chem.Mol) -> str:
    d = rdMolDraw2D.MolDraw2DSVG(-1, -1)          # canvas sized to the molecule
    o = d.drawOptions()
    o.fixedBondLength = 34                        # same scale for every molecule
    o.minFontSize = 15
    o.maxFontSize = 15                            # identical label size everywhere
    o.bondLineWidth = 2
    o.scaleBondWidth = False
    o.clearBackground = False
    o.padding = 0.06
    o.multipleBondOffset = 0.18
    o.addStereoAnnotation = False
    if mol.GetNumHeavyAtoms() <= 3:               # HCHO, MeI, MeNH2 ... read better as labels
        o.explicitMethyl = True
    o.updateAtomPalette(PALETTE)
    rdMolDraw2D.PrepareAndDrawMolecule(d, mol)
    d.FinishDrawing()
    svg = d.GetDrawingText()
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = svg.replace("#000000", "currentColor")
    svg = re.sub(r"(\d+\.\d)\d+", r"\1", svg)     # 1 decimal is plenty
    svg = re.sub(r"\s*\n\s*", " ", svg).strip()
    return svg


# --------------------------------------------------------------------------
# 2.  Text formatting for reagents / notes  (H2SO4 -> H<sub>2</sub>SO<sub>4</sub>)
# --------------------------------------------------------------------------
_PROTECT = {"SN2": "S<sub>N</sub>2", "SN1": "S<sub>N</sub>1", "E2": "E2", "E1": "E1"}


def chem_html(text: str) -> str:
    if not text:
        return ""
    s = html.escape(text, quote=False)
    keep = {}
    for i, (k, v) in enumerate(_PROTECT.items()):
        tok = f"\x00{i}\x00"
        s = re.sub(rf"\b{k}\b", tok, s)
        keep[tok] = v
    s = re.sub(r"10\^(\d+)", r"10<sup>\1</sup>", s)
    s = re.sub(r"(?<=[A-Za-z\)\]])(\d+)", r"<sub>\1</sub>", s)   # subscripts
    s = re.sub(r"(?<=[A-Za-z]|>)\+(?=[\s,;)]|$)", "<sup>+</sup>", s)  # cations
    s = re.sub(r"(?<=[A-Za-z])−(?=[\s,;)]|$)", "<sup>−</sup>", s)     # anions
    for tok, v in keep.items():
        s = s.replace(tok, v)
    return s


def steps(text: str) -> list[str]:
    return [chem_html(t.strip()) for t in (text or "").split("|") if t.strip()]


# --------------------------------------------------------------------------
# 3.  Parse reactions
# --------------------------------------------------------------------------
def parse_side(field: str):
    items = []
    for tok in field.split(";"):
        tok = tok.strip()
        if not tok:
            continue
        coef = 1
        m = re.match(r"^(\d+)\*(.+)$", tok)
        if m:
            coef, tok = int(m.group(1)), m.group(2)
        mol = Chem.MolFromSmiles(tok)
        if mol is None:
            raise ValueError(f"Invalid SMILES: {tok}")
        items.append((coef, mol))
    return items


def main():
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    mol_svgs: dict[str, str] = {}      # canonical smiles -> svg
    mol_index: dict[str, int] = {}

    def mol_ref(mol):
        can = Chem.MolToSmiles(mol)
        if can not in mol_index:
            mol_index[can] = len(mol_index)
            mol_svgs[can] = draw_svg(mol)
        return mol_index[can]

    fpgen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)

    reactions, feats = [], []
    seen_names = set()
    for r in rows:
        name = r["name"].strip()
        if name.lower() in seen_names:
            print(f"  ! duplicate name skipped: {name}")
            continue
        seen_names.add(name.lower())
        reac, prod = parse_side(r["reactants"]), parse_side(r["products"])
        tags = [t.strip() for t in r["tags"].split(";") if t.strip()]
        reactions.append({
            "id": r["id"].strip(),
            "name": name,
            "r": [[mol_ref(m), c] for c, m in reac],
            "p": [[mol_ref(m), c] for c, m in prod],
            "above": steps(r["above"]),
            "below": steps(r["below"]),
            "tags": tags,
            "note": chem_html(r["note"]),
        })

        # ---- features for similarity ----
        rmol = Chem.MolFromSmiles(".".join(Chem.MolToSmiles(m) for _, m in reac))
        pmol = Chem.MolFromSmiles(".".join(Chem.MolToSmiles(m) for _, m in prod))
        rfp, pfp = fpgen.GetFingerprint(rmol), fpgen.GetFingerprint(pmol)
        rbits, pbits = set(rfp.GetOnBits()), set(pfp.GetOnBits())
        change = {("+", b) for b in pbits - rbits} | {("-", b) for b in rbits - pbits}
        feats.append({
            "tags": set(tags),
            "reag": reagent_tokens(r["above"] + " " + r["below"]),
            "name": name_tokens(name),
            "rfp": rfp, "pfp": pfp, "change": change,
        })

    # ---- similarity / confusability ranking ----
    n = len(reactions)
    for i in range(n):
        scores = []
        for j in range(n):
            if i == j:
                continue
            scores.append((similarity(feats[i], feats[j]), j))
        scores.sort(reverse=True)
        reactions[i]["sim"] = [[j, round(s, 3)] for s, j in scores[:N_NEIGHBOURS]]

    data = {
        "version": 2,
        "molecules": [None] * len(mol_index),
        "reactions": reactions,
    }
    for can, idx in mol_index.items():
        data["molecules"][idx] = mol_svgs[can]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text("window.REACTIFY_DATA=" + payload + ";\n", encoding="utf-8")
    print(f"Built {n} reactions, {len(mol_index)} unique molecules "
          f"-> {OUT_PATH.relative_to(ROOT)} ({OUT_PATH.stat().st_size/1024:.0f} kB)")

    # Show a few distractor sets as a sanity check
    by_name = {rx["name"]: rx for rx in reactions}
    for probe in ["Clemmensen Reduction", "Swern Oxidation", "Shapiro Reaction",
                  "Suzuki Coupling", "Claisen Condensation", "Ugi Reaction"]:
        if probe in by_name:
            sims = by_name[probe]["sim"][:5]
            print(f"  {probe:30s} -> " + ", ".join(reactions[j]["name"] for j, _ in sims))


# --------------------------------------------------------------------------
# 4.  Similarity helpers
# --------------------------------------------------------------------------
_STOP = {"", "δ", "rt", "cat.", "cat", "then", "or", "excess", "°c", "atm", "l",
         "aq", "conc.", "h2o", "1", "2", "3", "−n2"}

_GENERIC = {"reaction", "synthesis", "rearrangement", "oxidation", "reduction",
            "coupling", "condensation", "olefination", "elimination", "esterification",
            "cycloaddition", "hydrogenation", "dihydroxylation", "epoxidation",
            "homologation", "amination", "methylation", "deoxygenation",
            "decarboxylation", "bromination", "chloromethylation", "annulation",
            "addition", "alkylation", "cyclization", "asymmetric", "acylation",
            "anionic", "oxy-cope", "ring-closing", "metathesis", "azide", "alkyne",
            "huisgen", "indole", "pyridine", "thiazole", "pyrrole", "quinoline",
            "ether", "ester", "acid", "enamine", "aldol", "diazotization", "ozonolysis"}


def reagent_tokens(text: str) -> set[str]:
    toks = re.split(r"[\s,|;/]+", text.lower())
    out = set()
    for t in toks:
        t = t.strip("()[]")
        t = re.sub(r"^\d+\)$", "", t)
        if t in _STOP or re.fullmatch(r"[−\-]?\d+", t):
            continue
        out.add(t)
    return out


def name_tokens(name: str) -> dict:
    words = re.split(r"[\s–]+", name.lower())
    people = {w for w in words if w not in _GENERIC and len(w) > 2}
    return {"people": people, "kind": words[-1]}


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def similarity(a: dict, b: dict) -> float:
    tag = jaccard(a["tags"], b["tags"])
    reag = jaccard(a["reag"], b["reag"])
    if a["name"]["people"] & b["name"]["people"]:
        name = 1.0
    elif a["name"]["kind"] == b["name"]["kind"] and a["name"]["kind"] != "reaction":
        name = 0.5
    else:
        name = 0.0
    struct = 0.5 * (DataStructs.TanimotoSimilarity(a["rfp"], b["rfp"]) +
                    DataStructs.TanimotoSimilarity(a["pfp"], b["pfp"]))
    change = jaccard(a["change"], b["change"])
    return 0.30 * tag + 0.20 * reag + 0.15 * name + 0.15 * struct + 0.20 * change


if __name__ == "__main__":
    main()
