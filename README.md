# Zando243 - Marketplace SSR (Express/EJS/PostgreSQL/Sequelize)

Projet e-commerce modulaire (MVC + services) inspiré d'Amazon / AliExpress, avec SSR EJS, PostgreSQL, Sequelize, sécurité de base, panier invité + connecté, favoris, commandes, retours, support et dashboard admin.

## Stack

- Node.js + Express
- EJS (SSR)
- PostgreSQL
- Sequelize + migrations + seeders
- **Better Auth** (sessions cookies httpOnly, scrypt) — système d'auth principal et unique depuis 23/05/2026
- `helmet`, `csrf-csrf`, `express-rate-limit`, `express-validator`, `sanitize-html`
- Logs structurés `pino` + `requestId`

## Installation

1. Installer PostgreSQL et créer une base (ex: `zando243_db`)
2. Copier `.env.example` vers `.env` et adapter les variables
3. Installer les dépendances:

```bash
npm i
```

4. Lancer migrations + seed:

```bash
npm run migrate
npm run seed
```

5. Démarrer:

```bash
npm run dev
```

Accès:
- App: `http://localhost:3000`
- Page de connexion: `/auth2/login` (les URL legacy `/auth/login` redirigent en 308 vers `/auth2/login`)
- Admin seed: `admin1@zando243.local` / `Password123!`
- User seed: `user1@zando243.local` / `Password123!`

Les comptes seed sont créés via l'API Better Auth (sign-up programmatique). Aucun hash bcrypt manuel.

## Scripts

- `npm run dev` : dev avec nodemon
- `npm start` : start production
- `npm run migrate` : migrations Sequelize
- `npm run seed` : seeders Sequelize
- `npm test` : tests smoke (helpers)

## Variables d'environnement (principales)

Voir `.env.example`:
- `PORT`, `APP_URL`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `BETTER_AUTH_ENABLED` (true par défaut), `BETTER_AUTH_SECRET` (≥32 chars), `BETTER_AUTH_URL`
- `COOKIE_SECRET`, `SESSION_SECRET`
- `CSRF_ENABLED`
- `SMTP_*` pour l'envoi des emails de vérification / reset password (gérés par Better Auth)
- `LOYALTY_POINTS_PER_DOLLAR`, `LOYALTY_MIN_ORDER_FOR_POINTS`

Les variables `JWT_*` restent dans `.env.example` par compatibilité mais ne sont plus lues (cleanup à venir).

## Structure

```txt
src/
  config/
  controllers/
  middlewares/
  migrations/
  models/
  routes/
  seeders/
  services/
  utils/
  views/
  public/
app.js
server.js
```

## Fonctionnalités couvertes

- Auth: register/login/logout via Better Auth, reset password, verify email (envoi SMTP automatique)
- Compte: profil, adresses multiples + défaut, notifications
- Catalogue: catégories hiérarchiques, recherche/filtres/pagination, SEO SSR de base (title/meta, sitemap, robots)
- Panier: invité (session) + connecté (DB), fusion à la connexion, save-for-later
- Favoris: ajout/retrait/liste/move-to-cart
- Commandes: checkout simulé, coupons, snapshots, historique de statut, tracking, retours (bloqués après livraison), factures PDF automatiques
- Avis: lecture côté produit + modération admin
- Support client: tickets + messages
- Tracking: recently viewed
- Admin: dashboard stats, catalogue, catégories, commandes, coupons, avis, retours, clients, vue logistique

## Notes de sécurité

- `helmet` avec CSP explicite, rate limiting global + login/reset/register
- CSRF sur formulaires SSR (`csrf-csrf`, double-submit cookie)
- Validation `express-validator` + sanitisation HTML stricte (`sanitize-html`)
- Cookies `httpOnly`, prefix `__Host-` en prod sur les cookies BA
- Politique de mot de passe (12 chars min, blocklist, ≤72 octets UTF-8) appliquée côté Better Auth via hook
- Verrouillage `FOR UPDATE` sur stock dans la transaction checkout (TOCTOU éliminé)
- Soft delete (paranoid) sur `User` et `Product`
- Trois audits sécurité documentés dans `security-audits/` (SAST, SAST V2, OWASP ASVS L1)

## Maquettes UI

Le rendu SSR reprend la direction visuelle observée dans `maquettesui/` (palette bleue, cartes, navbar sticky, layouts e-commerce/admin).
