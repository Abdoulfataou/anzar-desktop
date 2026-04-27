"""
Agent Codeur - Genere le code source base sur l'architecture.
Genere par batch pour supporter des projets de 15-25+ fichiers.
"""

import logging
import re
from typing import Dict, Any, List

from .base import BaseAgent

logger = logging.getLogger(__name__)


class CoderAgent(BaseAgent):
    """Agent qui genere le code source pour chaque fichier."""

    def __init__(self, deepseek_client=None):
        super().__init__(
            name="coder",
            role="Developpeur Senior",
            description="Genere du code source complet, moderne et bien designe",
            deepseek_client=deepseek_client
        )

        self.system_prompt = """Tu es un developpeur full-stack senior expert en UI/UX.

Ton role: Ecrire du code COMPLET, FONCTIONNEL et BEAU pour chaque fichier demande.

REGLES CRITIQUES:
- Code 100% complet — JAMAIS de "// TODO", "// a completer", ou de placeholder vide
- Design MODERNE et PROFESSIONNEL — utilise des gradients, ombres, animations CSS, transitions
- RESPONSIVE obligatoire — mobile-first, flexbox/grid, media queries
- Couleurs harmonieuses — utilise les couleurs du design system fourni
- Contenu REALISTE — pas de "Lorem ipsum", ecris du vrai texte adapte au projet
- Images: utilise des placeholder via https://placehold.co/600x400/hex/hex ou des SVG inline
- Icones: utilise des SVG inline simples ou des emoji pour les icones
- Typographie: Google Fonts (Inter, Poppins, Playfair Display selon le style)
- Animations: fadeIn, slideUp, hover effects, transitions douces

Pour HTML:
- Structure semantique (header, nav, main, section, footer)
- Meta tags SEO complets
- Open Graph tags
- Favicon link

Pour CSS:
- Variables CSS pour les couleurs et tailles
- Responsive breakpoints (mobile, tablet, desktop)
- Animations @keyframes
- Hover/focus states sur tous les elements interactifs
- Box shadows, border radius, gradients

Pour JavaScript:
- Code modulaire avec fonctions claires
- Gestion d'evenements propre
- Validation de formulaires
- Animations et transitions
- LocalStorage pour la persistance si pertinent

Format de sortie: chaque fichier comme:
```language
// Chemin: filepath
// Code complet ici
```"""

    async def execute(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Genere le code source pour les fichiers du projet.
        Utilise la generation par batch pour les gros projets.
        """
        architecture = request.get("architecture", {})
        plan = request.get("plan", {})
        project_name = request.get("project_name", "project")

        logger.info(f"[{self.name}] Generation code: {project_name}")

        files_to_generate = architecture.get("structure", {}).get("files", [])
        total_files = len(files_to_generate)

        if total_files == 0:
            logger.warning(f"[{self.name}] Aucun fichier a generer")
            return {
                "status": "error",
                "error": "Aucun fichier dans l'architecture",
                "files": {},
                "tokens_used": self.tokens_used
            }

        # Generate in batches of 5 files
        all_files: Dict[str, str] = {}
        batch_size = 5
        batches = [files_to_generate[i:i + batch_size] for i in range(0, total_files, batch_size)]

        # Get design info from plan
        design_info = plan.get("architecture", {}).get("design", {})
        design_context = ""
        if design_info:
            colors = design_info.get("colors", {})
            design_context = f"""
Design System:
- Style: {design_info.get('style', 'moderne et professionnel')}
- Couleur primaire: {colors.get('primary', '#3B82F6')}
- Couleur secondaire: {colors.get('secondary', '#8B5CF6')}
- Couleur accent: {colors.get('accent', '#F59E0B')}
- Typographie: {design_info.get('fonts', 'Inter, system-ui, sans-serif')}
"""

        for batch_idx, batch in enumerate(batches):
            files_str = "\n".join([
                f"- {f.get('path')}: {f.get('description')} ({f.get('type', 'unknown')})"
                for f in batch
            ])

            # Context from already generated files
            existing_context = ""
            if all_files:
                existing_files_list = ", ".join(all_files.keys())
                existing_context = f"\nFichiers deja generes: {existing_files_list}\nAssure la coherence avec ces fichiers existants."

            user_message = f"""Genere le code source COMPLET pour ces fichiers du projet '{project_name}' (batch {batch_idx + 1}/{len(batches)}):

{files_str}
{design_context}
Architecture globale: {str(architecture)[:2000]}

Description du projet: {str(plan.get('description', ''))[:1000]}
{existing_context}

IMPORTANT:
- Chaque fichier doit etre COMPLET et FONCTIONNEL
- Le design doit etre MODERNE et PROFESSIONNEL
- Utilise du contenu REALISTE (pas de Lorem ipsum)
- Les liens entre pages doivent etre coherents

Format chaque fichier comme:
```language
// Chemin: filepath
// Code complet ici
```"""

            messages = [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_message}
            ]

            try:
                response = await self.call_deepseek(
                    messages=messages,
                    temperature=0.5,
                    max_tokens=8000
                )

                batch_files = self._extract_code_blocks(response)
                all_files.update(batch_files)
                logger.info(f"[{self.name}] Batch {batch_idx + 1}: {len(batch_files)} fichiers generes")

            except Exception as e:
                logger.error(f"[{self.name}] Erreur batch {batch_idx + 1}: {e}")
                # Continue with next batch instead of failing completely
                continue

        if not all_files:
            return {
                "status": "error",
                "error": "Aucun fichier genere",
                "files": {},
                "tokens_used": self.tokens_used
            }

        return {
            "status": "success",
            "files": all_files,
            "count": len(all_files),
            "tokens_used": self.tokens_used
        }

    def _extract_code_blocks(self, response: str) -> Dict[str, str]:
        """Extrait les blocs de code de la reponse."""
        files: Dict[str, str] = {}

        # Pattern 1: ```lang\n// Chemin: filepath\ncode```
        pattern1 = r'''```(\w+)\n//\s*Chemin:\s*([^\n]+)\n(.*?)```'''
        matches = re.findall(pattern1, response, re.DOTALL)
        for language, filepath, code in matches:
            files[filepath.strip()] = code.strip()

        # Pattern 2: ```lang\n<!-- Chemin: filepath -->\ncode```
        pattern2 = r'''```(\w+)\n<!--\s*Chemin:\s*([^\n]+?)\s*-->\n(.*?)```'''
        matches2 = re.findall(pattern2, response, re.DOTALL)
        for language, filepath, code in matches2:
            if filepath.strip() not in files:
                files[filepath.strip()] = code.strip()

        # Pattern 3: ```lang\n# Chemin: filepath\ncode```
        pattern3 = r'''```(\w+)\n#\s*Chemin:\s*([^\n]+)\n(.*?)```'''
        matches3 = re.findall(pattern3, response, re.DOTALL)
        for language, filepath, code in matches3:
            if filepath.strip() not in files:
                files[filepath.strip()] = code.strip()

        if not files:
            # Fallback: store the entire response
            files["generated_code.txt"] = response

        return files
