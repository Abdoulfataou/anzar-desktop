"""
Client d'exemple pour tester le backend ANZAR.
Démontre comment utiliser les endpoints.
"""

import asyncio
import httpx
import json
from typing import AsyncGenerator

BASE_URL = "http://127.0.0.1:8000"


class ANZARClient:
    """Client simplifié pour le backend ANZAR."""

    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url

    async def health_check(self) -> dict:
        """Vérifier la santé du serveur."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/health")
            return response.json()

    async def chat(
        self,
        message: str,
        stream: bool = True,
        max_tokens: int = 1000
    ) -> AsyncGenerator[str, None]:
        """
        Chat avec streaming SSE.

        Args:
            message: Message utilisateur
            stream: Utiliser le streaming
            max_tokens: Tokens maximums

        Yields:
            Chunks de réponse
        """
        messages = [{"role": "user", "content": message}]

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "messages": messages,
                    "max_tokens": max_tokens
                }
            ) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:]
                        try:
                            data = json.loads(data_str)

                            if data.get("done"):
                                break

                            if "content" in data:
                                yield data["content"]

                            if "error" in data:
                                yield f"\n❌ Error: {data['error']}"
                                break
                        except json.JSONDecodeError:
                            continue

    async def plan_project(
        self,
        description: str,
        project_name: str = "my_project",
        tech_stack: list = None,
        requirements: list = None
    ) -> dict:
        """
        Générer un plan de projet.

        Args:
            description: Description du projet
            project_name: Nom du projet
            tech_stack: Stack technologique préférée
            requirements: Exigences spéciales

        Returns:
            Résultat du plan
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/projects/plan",
                json={
                    "description": description,
                    "project_name": project_name,
                    "tech_stack": tech_stack or [],
                    "requirements": requirements or []
                }
            )

            return response.json()

    async def execute_project(self, project_id: str) -> dict:
        """
        Exécuter la génération complète d'un projet.

        Args:
            project_id: ID du projet à exécuter

        Returns:
            Résultat de l'exécution
        """
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/api/projects/{project_id}/execute"
            )

            return response.json()

    async def get_project_status(self, project_id: str) -> dict:
        """Récupérer le statut d'un projet."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/projects/{project_id}/status"
            )

            return response.json()

    async def list_projects(self) -> dict:
        """Lister tous les projets."""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/api/projects")
            return response.json()


async def example_chat():
    """Exemple 1: Chat simple avec streaming."""
    print("\n" + "=" * 60)
    print("EXEMPLE 1: Chat simple avec streaming")
    print("=" * 60 + "\n")

    client = ANZARClient()

    print("Question: Comment concevoir une API REST efficace?")
    print("\nRéponse:\n")

    async for chunk in client.chat(
        "Comment concevoir une API REST efficace?",
        max_tokens=500
    ):
        print(chunk, end="", flush=True)

    print("\n")


async def example_project():
    """Exemple 2: Générer et exécuter un projet."""
    print("\n" + "=" * 60)
    print("EXEMPLE 2: Génération complète de projet")
    print("=" * 60 + "\n")

    client = ANZARClient()

    # 1. Générer le plan
    print("1️⃣ Génération du plan...")
    plan_result = await client.plan_project(
        description="Une application web de gestion de tâches avec authentification",
        project_name="task_manager",
        tech_stack=["Python", "FastAPI", "React", "SQLite"],
        requirements=["authentification", "API REST", "interface responsive"]
    )

    if plan_result.get("status") == "success":
        print("✓ Plan généré!")
        print(f"  Projet: {plan_result.get('project_id')}")
        print(f"  Architecture: {plan_result['architecture'].get('architecture', {})}")
    else:
        print(f"✗ Erreur: {plan_result.get('error')}")
        return

    # 2. Exécuter le projet
    print("\n2️⃣ Exécution du projet (cela peut prendre un moment)...")
    try:
        exec_result = await client.execute_project("task_manager")

        if exec_result.get("status") == "success":
            print("✓ Projet généré avec succès!")
            execution = exec_result.get("execution", {})
            print(f"  Fichiers créés: {execution.get('file_count')}")
            print(f"  Chemin: {execution.get('project_path')}")
        else:
            print(f"✗ Erreur: {exec_result.get('error')}")

    except Exception as e:
        print(f"✗ Erreur d'exécution: {e}")

    # 3. Vérifier le statut
    print("\n3️⃣ Vérification du statut...")
    status = await client.get_project_status("task_manager")
    print(f"  Statut: {status.get('status')}")
    print(f"  Créé à: {status.get('created_at')}")


async def example_health():
    """Exemple 0: Vérifier la santé du serveur."""
    print("\n" + "=" * 60)
    print("EXEMPLE 0: Vérification de la santé")
    print("=" * 60 + "\n")

    client = ANZARClient()

    try:
        health = await client.health_check()

        print("✓ Serveur accessible!")
        print(f"  Status: {health.get('status')}")

        services = health.get("services", {})
        if "deepseek" in services:
            ds = services["deepseek"]
            print(f"  DeepSeek: {ds.get('status')}")

        if "cache" in services:
            cache = services["cache"]
            print(f"  Cache: {cache.get('items', 0)} items")

    except Exception as e:
        print(f"✗ Erreur: {e}")
        print("  Le serveur n'est pas disponible sur http://127.0.0.1:8000")
        print("  Lancez le serveur avec: python run.py")


async def main():
    """Menu principal."""
    print("""
╔════════════════════════════════════════════════════════════════╗
║           ANZAR Backend - Client d'exemple                     ║
╚════════════════════════════════════════════════════════════════╝

Exemples disponibles:
  0. Vérification de la santé
  1. Chat simple avec streaming
  2. Génération complète de projet
  3. Tous les exemples

Assurez-vous que le serveur est lancé:
  python run.py
""")

    choice = input("Choisissez un exemple (0-3): ").strip()

    try:
        if choice == "0" or choice == "3":
            await example_health()

        if choice == "1" or choice == "3":
            await example_chat()

        if choice == "2" or choice == "3":
            await example_project()

    except KeyboardInterrupt:
        print("\n\nInterruption utilisateur.")
    except Exception as e:
        print(f"\n❌ Erreur: {e}")


if __name__ == "__main__":
    asyncio.run(main())
