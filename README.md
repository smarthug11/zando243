# Zando243 - Marketplace SSR (Express/EJS/PostgreSQL/Sequelize)

Projet e-commerce modulaire (MVC + services) inspiré d'Amazon / AliExpress, avec SSR EJS, PostgreSQL, Sequelize, sécurité de base, panier invité + connecté, favoris, commandes, retours, support et dashboard admin.

## Stack

- Node.js + Express
- EJS (SSR)
- PostgreSQL
- Sequelize + migrations + seeders
- Auth JWT (access + refresh) via cookies httpOnly
- `bcrypt`, `helmet`, `csurf`, `express-rate-limit`, `express-validator`
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
- Admin seed: `admin1@zando243.local` / `Password123!`
- User seed: `user1@zando243.local` / `Password123!`

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
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- `COOKIE_SECRET`, `SESSION_SECRET`
- `CSRF_ENABLED`
- `LOYALTY_POINTS_PER_DOLLAR`, `LOYALTY_MIN_ORDER_FOR_POINTS`

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

- Auth: register/login/logout/refresh, reset password, verify email (flux démo avec token affiché en flash)
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

- `helmet`, rate limiting global + login/reset
- CSRF sur formulaires SSR (`csurf`)
- Validation `express-validator`
- Sanitization simple (body/query)
- Cookies `httpOnly`
- Soft delete (paranoid) sur `User` et `Product`

## Maquettes UI

Le rendu SSR reprend la direction visuelle observée dans `maquettesui/` (palette bleue, cartes, navbar sticky, layouts e-commerce/admin).
