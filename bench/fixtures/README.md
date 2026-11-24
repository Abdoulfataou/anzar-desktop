# Fixtures du banc d'essai

Projets de départ pour les tâches T3, T5 et T10 de
[`docs/desktop/banc-essai-agent.md`](../../docs/desktop/banc-essai-agent.md).

## Utilisation

```bash
cp -R bench/fixtures/t3-test-rouge ~/Desktop/banc-anzar/t3
cp -R bench/fixtures/t5-renommage ~/Desktop/banc-dsh/t5
cp -R bench/fixtures/t10-refus   ~/Desktop/banc-anzar/t10
```

Pour T3 et T5, installer les dépendances **dans le dossier du projet** :

```bash
cd ~/Desktop/banc-anzar/t3 && npm install
cd ~/Desktop/banc-anzar/t5 && npm install
```

Chaque dossier contient `verifier.sh` : il rend `0` si le critère objectif de la
tâche est rempli. Lancer les deux agents sur des copies identiques, puis
comparer les mesures décrites dans le banc.

Les fixtures n'ont pas de `node_modules` : c'est volontaire, pour que
l'installation fasse partie de la mesure.
