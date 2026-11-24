#!/usr/bin/env python3
"""
Génère la vitrine getanzar.com : une page statique par langue et par page.

  python3 build.py                 → dist/ (à ouvrir avec : python3 -m http.server -d dist)
  python3 build.py --out /srv      → dans un autre dossier (Dockerfile)
  python3 build.py --sync-prix ../../services/api
                                   → met à jour data/prix.json depuis le backend

Textes : i18n/<langue>.json (une source par langue, mêmes clés partout).
Gabarits : templates/*.html, avec un mini moteur :
  {{ a.b }}            texte échappé          {{{ a.b }}}   HTML brut (textes de confiance)
  {% for x in a.b %}   boucle                 {% if a.b %} … {% else %} … {% endif %}
Ajouter une langue : créer i18n/xx.json, l'ajouter à LANGUES. Aucune dépendance.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

ICI = Path(__file__).resolve().parent
SITE = "https://getanzar.com"
LANGUES = ["fr", "en"]          # la première est la langue par défaut
PAGES = ["home", "download", "pricing", "terms", "privacy"]


# ───────────────────────── Mini moteur de gabarits ─────────────────────────

BLOC = re.compile(r"{%\s*(for|if)\s+(.+?)\s*%}|{%\s*(endfor|endif|else)\s*%}")


def chercher(ctx: dict, chemin: str):
    val = ctx
    for part in chemin.strip().split("."):
        if isinstance(val, dict) and part in val:
            val = val[part]
        elif isinstance(val, list) and part.isdigit() and int(part) < len(val):
            val = val[int(part)]
        else:
            raise KeyError(f"Clé introuvable : {chemin}")
    return val


def _blocs(src: str):
    """Découpe en arbre : ("txt", s) | ("for", var, chemin, enfants) | ("if", chemin, oui, non)."""
    pile = [[]]
    ouverts = []
    pos = 0
    for m in BLOC.finditer(src):
        pile[-1].append(("txt", src[pos:m.start()]))
        pos = m.end()
        if m.group(1) == "for":
            var, _, chemin = m.group(2).partition(" in ")
            noeud = ["for", var.strip(), chemin.strip(), []]
            pile[-1].append(noeud)
            ouverts.append(noeud)
            pile.append(noeud[3])
        elif m.group(1) == "if":
            noeud = ["if", m.group(2).strip(), [], []]
            pile[-1].append(noeud)
            ouverts.append(noeud)
            pile.append(noeud[2])
        elif m.group(3) == "else":
            pile.pop()
            pile.append(ouverts[-1][3])
        else:
            pile.pop()
            ouverts.pop()
    pile[-1].append(("txt", src[pos:]))
    if ouverts:
        raise ValueError("Bloc {% for/if %} non fermé")
    return pile[0]


def _vars(txt: str, ctx: dict) -> str:
    txt = re.sub(r"{{{\s*(.+?)\s*}}}", lambda m: str(chercher(ctx, m.group(1))), txt)
    return re.sub(r"{{\s*(.+?)\s*}}", lambda m: html.escape(str(chercher(ctx, m.group(1))), quote=True), txt)


def _rendre(arbre, ctx: dict) -> str:
    out = []
    for n in arbre:
        if n[0] == "txt":
            out.append(_vars(n[1], ctx))
        elif n[0] == "for":
            for i, item in enumerate(chercher(ctx, n[2])):
                out.append(_rendre(n[3], {**ctx, n[1]: item, "loop": {"index": i + 1, "first": i == 0}}))
        else:
            try:
                ok = bool(chercher(ctx, n[1]))
            except KeyError:
                ok = False
            out.append(_rendre(n[2] if ok else n[3], ctx))
    return "".join(out)


def rendre(src: str, ctx: dict) -> str:
    return _rendre(_blocs(src), ctx)


# ───────────────────────── Génération ─────────────────────────

def charger_textes() -> dict:
    textes = {}
    for lang in LANGUES:
        textes[lang] = json.loads((ICI / "i18n" / f"{lang}.json").read_text(encoding="utf-8"))
    ref = cles(textes[LANGUES[0]])
    for lang in LANGUES[1:]:
        manque = ref ^ cles(textes[lang])
        if manque:
            raise SystemExit(f"i18n/{lang}.json : clés différentes de {LANGUES[0]}.json : {sorted(manque)[:10]}")
    return textes


def cles(d, prefixe="") -> set:
    out = set()
    if isinstance(d, dict):
        for k, v in d.items():
            out |= cles(v, f"{prefixe}{k}.")
    elif not isinstance(d, list):
        out.add(prefixe.rstrip("."))
    return out


def json_script(obj) -> str:
    """JSON sûr à placer entre <script> et </script>."""
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            .replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def url(textes: dict, lang: str, page: str) -> str:
    return f"/{lang}/" + textes[lang]["pages"][page]["slug"]


def empreinte(dossier: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(dossier.rglob("*")):
        if f.is_file():
            h.update(f.name.encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:10]


def construire(sortie: Path) -> None:
    textes = charger_textes()
    prix = json.loads((ICI / "data" / "prix.json").read_text(encoding="utf-8"))
    base = (ICI / "templates" / "base.html").read_text(encoding="utf-8")
    version = empreinte(ICI / "static")

    if sortie.exists():
        shutil.rmtree(sortie)
    shutil.copytree(ICI / "static", sortie / "assets")
    (sortie / "assets" / "prix.json").write_text(json.dumps(prix, ensure_ascii=False, separators=(",", ":")),
                                                encoding="utf-8")

    plan = []
    for lang in LANGUES:
        t = textes[lang]
        for page in PAGES:
            corps = (ICI / "templates" / f"{page}.html").read_text(encoding="utf-8")
            alternates = [{"lang": l, "href": SITE + url(textes, l, page)} for l in LANGUES]
            autres = [{"lang": l, "code": l.upper(), "nom": textes[l]["meta"]["name"],
                       "href": url(textes, l, page), "actuelle": l == lang} for l in LANGUES]
            ctx = {
                "t": t, "lang": lang, "page": page, "v": version, "site": SITE,
                "p": t["pages"][page],
                "canonical": SITE + url(textes, lang, page),
                "alternates": alternates,
                "x_default": SITE + (url(textes, LANGUES[0], page) if page != "home" else "/"),
                "langues": autres,
                "u": {p: url(textes, lang, p) for p in PAGES},
                "og_image": f"{SITE}/assets/og-{lang}.png",
                "annee": date.today().year,
                # Textes lus par les scripts (dans <script type="application/json">, permis par la CSP)
                "json": {k: json_script({**t[k], "intl": t["meta"]["intl"], "lang": lang})
                         for k in ("download", "pricing")},
            }
            ctx["contenu"] = rendre(corps, ctx)
            dest = sortie / lang / t["pages"][page]["slug"] / "index.html"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(rendre(base, ctx), encoding="utf-8")
            plan.append((page, lang))

    # Page 404 bilingue (servie par Caddy pour toute adresse inconnue)
    t404 = {l: textes[l]["notfound"] for l in LANGUES}
    p404 = (ICI / "templates" / "404.html").read_text(encoding="utf-8")
    (sortie / "404.html").write_text(rendre(p404, {"t": t404, "u": {l: f"/{l}/" for l in LANGUES}, "v": version}),
                                     encoding="utf-8")

    # sitemap.xml : chaque page avec ses équivalents dans les autres langues
    lignes = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for page, lang in plan:
        lignes.append(f"  <url><loc>{SITE}{url(textes, lang, page)}</loc>")
        for l in LANGUES:
            lignes.append(f'    <xhtml:link rel="alternate" hreflang="{l}" href="{SITE}{url(textes, l, page)}"/>')
        defaut = "/" if page == "home" else url(textes, LANGUES[0], page)
        lignes.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}{defaut}"/>')
        lignes.append("  </url>")
    lignes.append("</urlset>")
    (sortie / "sitemap.xml").write_text("\n".join(lignes) + "\n", encoding="utf-8")
    (sortie / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    print(f"✓ {len(plan)} pages ({', '.join(LANGUES)}) → {sortie}")


# ───────────────────────── Prix de repli ─────────────────────────

def synchroniser_prix(api: Path) -> None:
    """Copie les grilles de départ du backend : le site les affiche si l'API ne répond pas."""
    ref = api / "services" / "currency" / "reference"
    iso = json.loads((ref / "iso4217.json").read_text(encoding="utf-8"))["currencies"]
    actives = {c["code"]: c for c in iso if c.get("active")}
    packs = json.loads((ref / "default_packs.json").read_text(encoding="utf-8"))
    pays = json.loads((ref / "country_currency.json").read_text(encoding="utf-8"))["countries"]
    m0001 = (api / "db" / "migrations" / "m0001_multidevise.py").read_text(encoding="utf-8")
    base = [int(p) for p, _ in re.findall(r"\((\d+),\s*\"([^\"]+)\"\)", m0001.split("BASE_PACKS", 1)[1].split("\n", 1)[0])]
    cfg = (api / "config.py").read_text(encoding="utf-8")
    paliers = sorted([int(a), int(b)] for a, b in re.findall(r"(\d+):(\d+)", re.search(
        r'recharge_bonus_tiers: str = "([^"]+)"', cfg).group(1)))

    def bonus(montant: int) -> int:
        return max([b for seuil, b in paliers if montant >= seuil] or [0])

    grilles = {"XOF": [[p, round(p * (1 + bonus(p) / 100))] for p in base]}
    grilles.update({c: v for c, v in packs["packs"].items() if c in actives})
    out = {
        "_doc": "Généré par build.py --sync-prix depuis services/api. Prix en unités mineures ISO, crédits bonus compris.",
        "labels": packs["labels"],
        "decimals": {c: actives[c]["decimals"] for c in grilles},
        "grilles": grilles,
        "pays": {p: c for p, c in pays.items() if len(p) == 2 and c in grilles},
        "repli": "USD",
        "paliers": paliers,
        "libre": {"min": 500, "max": 1_000_000},
    }
    (ICI / "data" / "prix.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✓ data/prix.json : {len(grilles)} devises")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ICI / "dist"))
    ap.add_argument("--sync-prix", metavar="DOSSIER_API")
    a = ap.parse_args()
    if a.sync_prix:
        synchroniser_prix(Path(a.sync_prix).resolve())
        sys.exit(0)
    construire(Path(a.out).resolve())
