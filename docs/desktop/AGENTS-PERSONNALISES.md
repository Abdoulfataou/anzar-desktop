# Agents personnalisés

L'agent principal d'ANZAR peut confier une partie du travail à des sous-agents spécialisés.
En plus des rôles fournis (`dev`, `revue`, `redaction`, `motion-designer`), chacun peut créer
les siens : depuis la page **Agents** de l'app, ou avec un fichier Markdown.

## Où les mettre

| Emplacement | Portée | Priorité |
|---|---|---|
| `.anzar/agents/<nom>.md` puis `.claude/agents/<nom>.md` du projet | le projet (voyage avec git) | 1 |
| page Agents de l'app (dossier de données ANZAR) | tous tes projets | 2 |
| `~/.claude/agents/<nom>.md` | tous tes projets (partagé avec Claude Code) | 3 |
| rôles fournis avec ANZAR | partout | 4 |

À nom égal, le plus prioritaire gagne : un agent `dev` dans le projet remplace le rôle intégré.
`explorer` et `lead` sont réservés.

## Format

```markdown
---
name: expert-flutter
description: Expert Flutter — écrans, état (Riverpod), navigation et tests de widgets
tools: read_file list_dir glob search_files get_diagnostics edit_file write_file apply_patch bash
model: fast
skills: app-mobile-expo
max_steps: 30
deny: network
keywords: flutter dart widget riverpod
---
Tu es un expert Flutter…
```

- `description` (obligatoire) : l'agent principal la lit pour choisir ce spécialiste.
- `tools` (facultatif) : limite les outils. Absent, l'agent a tous ceux du mode choisi.
  Les noms de Claude Code sont traduits (`Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`…) ;
  ceux sans équivalent (`WebFetch`…) sont ignorés et signalés dans la page Agents.
- `model` : `fast` (défaut), `thinking`, `pro`, `max` ; `haiku`/`sonnet` → `fast`, `opus` → `pro`, `inherit` → défaut.
- `skills` : skills appliquées d'office (du projet, personnelles ou intégrées). Les autres restent disponibles avec `load_skill`.
- `deny` : capacités retirées — `fs.write`, `shell.exec`, `network`.
- `max_steps` (1 à 60), `keywords`, `budget_fcfa`, `output_max_chars`, `reasoning` : facultatifs.

Les consignes s'ajoutent aux règles communes des sous-agents (tâche unique, aucune question,
périmètre, rapport final). Un agent personnalisé n'a jamais plus de droits que le mode choisi
par l'utilisateur.
