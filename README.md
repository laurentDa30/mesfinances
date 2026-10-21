# Mes finances — Comptes du foyer

Application de budget installable sur téléphone (PWA) : solde prévu en fin de mois, plusieurs comptes bancaires, épargne, alertes de découvert, projection retraite.

- **Front** : `index.html` (une seule page, sans build), `sw.js` (hors ligne), `manifest.webmanifest`.
- **API** : fonctions Vercel dans `api/` — `auth` (inscription, connexion, clé de secours, mot de passe, suppression), `me`, `state`, `sync`.
- **Base** : Neon Postgres, tables `users`, `vault` (documents chiffrés) et `rate_limits`, créées automatiquement.
- **Accès** : comptes utilisateurs (e-mail + mot de passe), données chiffrées de bout en bout, cookie de session signé, HttpOnly, valable 6 mois.
- **Hors ligne** : l'app garde une copie sur l'appareil et une file de modifications envoyée dès le retour du réseau.

## Mise en place sur Vercel

1. **Importer le dépôt** : vercel.com → *Add New → Project* → `mesfinances` → *Framework Preset : Other*, aucune commande de build.
2. **Base Neon** : créer un projet Neon (région Frankfurt) et ajouter sa chaîne de connexion dans `DATABASE_URL`. Les tables `users`, `vault` et `rate_limits` se créent automatiquement.
3. **Variables d'environnement** :

   | Nom | Rôle |
   |---|---|
   | `DATABASE_URL` | connexion à la base Neon |
   | `SESSION_SECRET` | 32 caractères aléatoires minimum (signature des sessions) |
   | `APP_PASSWORD` | uniquement pour récupérer les données de l'ancienne version ; à supprimer ensuite |

4. **Redéployer** après tout changement de variable.

## Comptes et chiffrement

- Inscription ouverte : e-mail + mot de passe (10 caractères minimum), limitation des tentatives, champ piège anti-robots.
- **Chiffrement de bout en bout** : le mot de passe ne quitte jamais l'appareil. Il sert à dériver (PBKDF2-SHA256, 600 000 itérations) une clé qui protège la clé de données AES-256-GCM. Le serveur ne reçoit qu'une empreinte dérivée, qu'il re-hache (scrypt), et ne stocke que des documents `{ v, iv, ct }` illisibles.
- **Clé de secours** remise à l'inscription : seule façon de choisir un nouveau mot de passe sans perdre les données.
- Sur l'appareil, la clé de données est gardée non exportable (IndexedDB) et le cache hors ligne est chiffré.
- Changer de mot de passe déconnecte les autres appareils. La suppression du compte efface toutes ses données.
- Page `confidentialite.html` : brouillon à compléter (identité, contact) et à faire relire.

## Passage depuis l'ancienne version (mot de passe unique)

1. Ouvrir l'app → **Créer un compte** → noter la clé de secours.
2. Sur l'écran vide : **Récupérer l'ancienne version** → saisir l'ancien `APP_PASSWORD`. Les données sont importées, chiffrées, puis l'ancienne table `docs` (non chiffrée) est supprimée.
3. Supprimer la variable `APP_PASSWORD` dans Vercel.

## Mettre à jour

Modifier le code, **changer `VERSION` dans `sw.js`**, pousser sur `main` : Vercel redéploie, l'app se met à jour à la prochaine ouverture en ligne.

## Sécurité

- Ne jamais committer de sauvegarde (fichier JSON de données) ni de `.env` : le `.gitignore` les exclut.
- Changer `SESSION_SECRET` déconnecte tous les appareils.
- Les routes `/api/state` et `/api/sync` refusent toute requête sans session (401).
