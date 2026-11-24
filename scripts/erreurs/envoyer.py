#!/usr/bin/env python3
"""Dépose les diagnostics écrits par l'agent dans l'admin ANZAR.

    python3 scripts/erreurs/envoyer.py

Le problème passe en « analysé » dans l'admin (page Erreurs). Rien n'est publié ailleurs :
le dépôt GitHub étant public, aucune fiche n'est créée (les rapports d'utilisateurs n'ont
pas à y apparaître).
"""
from commun import A_ANALYSER, ANALYSES, ENVOYES, appel, dossiers

dossiers()
envoyes = 0
for fichier in sorted(ANALYSES.glob("*.md")):
    try:
        gid = int(fichier.stem)
    except ValueError:
        continue
    texte = fichier.read_text(encoding="utf-8").strip()
    if not texte:
        continue
    appel("POST", f"/api/agent/errors/{gid}", {"analysis": texte[:20000]})
    fichier.replace(ENVOYES / fichier.name)
    source = A_ANALYSER / fichier.name
    if source.exists():
        source.replace(ENVOYES / f"{gid}.rapport.md")
    envoyes += 1
    print(f"✓ Problème {gid} : diagnostic déposé dans l'admin")
print(f"{envoyes} diagnostic(s) envoyé(s)." if envoyes else "Aucun diagnostic à envoyer.")
