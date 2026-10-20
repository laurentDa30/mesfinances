# Mes finances — Comptes du foyer

Application de budget installable sur téléphone (PWA) : solde prévu en fin de mois, plusieurs comptes bancaires, épargne, alertes de découvert, projection retraite.

- **Front** : `index.html` (une seule page, sans build), `sw.js` (hors ligne), `manifest.webmanifest`.
- **API** : fonctions Vercel dans `api/` — `login`, `logout`, `me`, `state`, `sync`.
- **Base** : Neon Postgres, une table `docs (coll, id, data jsonb)` créée automatiquement au premier appel.
- **Accès** : un mot de passe unique (`APP_PASSWORD`) → cookie de session signé, HttpOnly, valable 6 mois.
- **Hors ligne** : l'app garde une copie sur l'appareil et une file de modifications envoyée dès le retour du réseau.

## Mise en place sur Vercel

1. **Importer le dépôt** : vercel.com → *Add New → Project* → `mesfinances` → *Framework Preset : Other*, aucune commande de build → *Deploy*.
2. **Créer la base** : dans le projet → onglet *Storage* → *Create Database* → **Neon** → l'attacher au projet (tous les environnements). Vercel ajoute `DATABASE_URL` tout seul.
3. **Variables d'environnement** (*Settings → Environment Variables*, environnement *Production*) :

   | Nom | Valeur |
   |---|---|
   | `APP_PASSWORD` | ta phrase de passe (longue) |
   | `SESSION_SECRET` | 32 caractères aléatoires minimum, par ex. `openssl rand -base64 48` |

4. **Redéployer** (*Deployments → ⋯ → Redeploy*) pour que les variables soient prises en compte.
5. **Sur le téléphone** : ouvrir l'URL, se connecter, *Importer une sauvegarde* (fichier JSON exporté depuis l'ancienne version), puis l'ajouter à l'écran d'accueil :
   - iPhone : Safari → Partager → « Sur l'écran d'accueil »
   - Android : Chrome → ⋮ → « Installer l'application »

## Mettre à jour

Modifier le code, **changer `VERSION` dans `sw.js`**, pousser sur `main` : Vercel redéploie, l'app se met à jour à la prochaine ouverture en ligne.

## Sécurité

- Ne jamais committer de sauvegarde (fichier JSON de données) ni de `.env` : le `.gitignore` les exclut.
- Changer `SESSION_SECRET` déconnecte tous les appareils.
- Les routes `/api/state` et `/api/sync` refusent toute requête sans session (401).
