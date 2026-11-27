/**
 * Démarrage d'ANZAR sur une machine neuve, sans session enregistrée.
 *
 * Ce parcours couvre déjà les points qui ont cassé par le passé : l'hydratation des
 * réglages, la politique de commandes lue côté Rust, et la lecture de la session dans le
 * coffre du système (Gestionnaire d'identification sous Windows), qui ne doit jamais
 * bloquer l'écran de chargement.
 */
describe('ANZAR — démarrage sans session', () => {
  it('affiche l’accueil en moins de 30 s', async () => {
    const titre = await $('h1=Que veux-tu construire ?');
    await titre.waitForDisplayed({ timeout: 30_000 });
  });

  it('porte le titre « ANZAR »', async () => {
    await expect(browser).toHaveTitle('ANZAR');
  });

  it('active « Envoyer » dès qu’une idée est saisie', async () => {
    const envoyer = await $('button[title="Envoyer"]');
    await expect(envoyer).toBeDisabled();
    await $('textarea').setValue('Une application de liste de courses');
    await expect(envoyer).toBeEnabled();
  });

  it('« Se connecter » ouvre le formulaire e-mail', async () => {
    await $('button=Se connecter').click();
    const email = await $('input[type="email"]');
    await email.waitForDisplayed({ timeout: 15_000 });
    await expect(email).toBeFocused();
  });
});
