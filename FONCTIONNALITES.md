# FONCTIONNALITES.md - Etat fonctionnel et technique de Zando243

Derniere mise a jour : 26/04/2026 (refactorisation Phase 2 : adminOrderService + adminProductService, securite auth renforcee, CSP activee)

Ce document resume ce que fait l'application Zando243, les routes principales, les fichiers responsables, les services metier utilises, les protections en place et l'etat de la refactorisation progressive.

Il complete `README.md`, `update.md`, `SAST_REPORT.md` et `SAST_REPORT_V2.md`.

---

## 1. Vue d'ensemble

Zando243 est une application e-commerce SSR construite avec Express, EJS, Sequelize et PostgreSQL en production.

L'application permet :

- a un visiteur de parcourir les produits, rechercher, consulter les categories, ajouter au panier et creer un compte ;
- a un client connecte de gerer son panier, ses favoris, son profil, ses adresses, ses commandes, ses retours, ses avis et ses tickets support ;
- a un administrateur de gerer le catalogue, les categories, les commandes, les coupons, les avis, les clients, les retours, la logistique, les logs et les statistiques ;
- aux moteurs de recherche de lire `sitemap.xml` et `robots.txt`.

Stack principale :

- Node.js + Express
- EJS cote serveur
- Sequelize
- PostgreSQL en production
- SQLite pour les tests
- JWT access/refresh en cookies `httpOnly`
- `helmet` avec CSP active, `csrf-csrf`, `express-rate-limit`, `express-validator`
- logs structures avec `pino`
- tests avec `node --test`

---

## 2. Etat securite

Deux audits SAST manuels ont ete realises (29/03/2026 et 25/04/2026). Les rapports sont dans `SAST_REPORT.md` et `SAST_REPORT_V2.md`.

### Secrets et authentification

- Les secrets JWT, cookies et session sont obligatoires en production.
- Les JWT sont verifies avec l'algorithme `HS256` force explicitement.
- Les access tokens et refresh tokens sont distingues par `payload.type`.
- Les tokens de verification email et reset password ne sont plus affiches dans les messages flash.
- Le reset password utilise un message neutre pour eviter l'enumeration d'emails.
- Les cookies auth utilisent `sameSite: "lax"` (compatible retour PayPal cross-site).

Fichiers concernes :

- `src/config/env.js`
- `src/config/jwt.js`
- `src/controllers/authController.js`
- `src/services/authService.js`

### Politique de mot de passe

- Minimum 12 caracteres (pas de contraintes majuscule/chiffre/symbole).
- Blocklist de mots de passe evidents : `123456789012`, `zando2431234`, `qwerty123456`, etc.
- Verifiee a l'inscription et au reset password.
- Affiche un message d'erreur specifique si le mot de passe est trop court ou dans la blocklist.

Fichiers concernes :

- `src/utils/passwordPolicy.js`
- `src/services/authService.js`
- `src/controllers/authController.js`
- `src/views/pages/auth/register.ejs` (hint UI : "12 caracteres minimum")

### Verrouillage de compte (brute-force)

- Apres 10 tentatives de connexion echouees consecutives, le compte est verrouille 15 minutes.
- Pendant le verrouillage, meme le bon mot de passe est refuse (code HTTP 423).
- Un login reussi hors verrouillage remet `failedLoginAttempts` a 0 et efface `lockedUntil`.
- Champs en base : `failedLoginAttempts` (INTEGER) et `lockedUntil` (DATE).
- Migration : `src/migrations/202604250001-add-user-lockout-fields.js`.

Note : le schema initial `202602240001-init-schema.js` inclut deja ces colonnes ; la migration 202604250001 n'est utile que pour les bases existantes avant cette date.

Fichiers concernes :

- `src/services/authService.js` (logique `loginUser`)
- `src/models/index.js` (champs `failedLoginAttempts`, `lockedUntil`)

### Rotation du refresh token

- Chaque appel a `POST /auth/refresh` incremente `refreshTokenVersion` en base.
- L'ancien refresh token est immediatement invalide apres rotation.
- Un reset password incremente aussi `refreshTokenVersion`, invalidant toutes les sessions actives.

Fichiers concernes :

- `src/services/authService.js` (`refreshSession`, `resetPassword`)
- `src/config/jwt.js`

### Session admin idle timeout

- Les routes admin appliquent `requireFreshAdminSession` en plus de `requireAuth` et `requireRole("ADMIN")`.
- Si un admin n'a pas interagi depuis plus de 30 minutes, ses cookies sont effaces et une erreur 401 est renvoyee.
- L'horodatage `req.session.adminLastSeenAt` est mis a jour a chaque requete admin.

Fichiers concernes :

- `src/middlewares/auth.js` (`requireFreshAdminSession`)
- `src/routes/adminRoutes.js`

### Rate limiting, proxy et CORS

- `trust proxy` est limite a `1`.
- Le rate limit login est limite a 5 tentatives par 15 minutes.
- Le rate limit inscription est limite a 5 tentatives par heure (`registerRateLimit`).
- Le rate limit reset password est limite a 10 tentatives par heure.
- Les erreurs de rate limit renvoient une structure explicite.
- CORS restreint a une liste blanche (`ALLOWED_ORIGINS` ou `appUrl`), plus aucune origine arbitraire acceptee.

Fichiers concernes :

- `app.js`
- `src/middlewares/rateLimit.js`
- `src/routes/authRoutes.js`

### Content Security Policy (CSP)

CSP maintenant activee avec directives explicites :

- `scriptSrc` : `self`, `unsafe-inline`, `cdn.tailwindcss.com`, `cdn.jsdelivr.net`
- `styleSrc` : `self`, `unsafe-inline`, `fonts.googleapis.com`
- `fontSrc` : `self`, `fonts.gstatic.com`
- `imgSrc` : `self`, `data:`, `https:`
- `objectSrc` : `none`
- `frameAncestors` : `none`
- `upgradeInsecureRequests` : active en production uniquement

Note : `unsafe-inline` reste necessaire car les templates EJS contiennent du JS inline. A assainir progressivement si un nonce est introduit.

Fichiers concernes :

- `app.js`

### Sessions

- Duree session `express-session` : 4 heures.
- Nom cookie : `zando243.sid`.

### CSRF

- Passage de `csurf` vers `csrf-csrf` (double submit cookie pattern).
- Le secret CSRF est derive du `cookieSecret`.
- Exemptions : `/auth/refresh` et `/payments/paypal/webhook`.
- Actif en production et quand `CSRF_ENABLED=true` en developpement.

Fichiers concernes :

- `src/middlewares/csrf.js`

### Factures PDF (IDOR corrige)

- La route statique `/invoices` (acces public) a ete supprimee.
- Les factures sont servies exclusivement via `GET /orders/:id/invoice`, route protegee par `requireAuth` avec verification d'appartenance.

Fichiers concernes :

- `app.js`
- `src/routes/orderRoutes.js`
- `src/controllers/orderController.js`

### Mass assignment (corrige)

- Les adresses client utilisent une whitelist explicite de champs.
- Le profil client valide l'URL avatar avec `parseHttpsUrl()`.
- Les produits admin (`createProductFromAdmin`, `updateProductFromAdmin`) utilisent `pickProductFields()`.
- Les URLs d'images produit sont validees avec `parseHttpsUrl()`.

Fichiers concernes :

- `src/services/accountService.js`
- `src/services/adminProductService.js`

### PayPal (corrections securite)

- La validation des webhooks verifie que `cert_url` appartient aux domaines officiels PayPal avant tout appel reseau.
- La capture SDK verifie la coherence entre `paypalOrderId` et `order.paymentReference`.

Fichiers concernes :

- `src/services/paypalService.js`
- `src/controllers/paymentController.js`

### Injection LIKE (corrige)

- Les filtres `actorEmail` et `q` des logs admin echappent `%` et `_` via `escapeLike()`.
- Meme protection dans `adminOrderService` (filtre client) et `adminProductService` (filtre produit).

Fichiers concernes :

- `src/services/auditLogService.js`
- `src/services/adminOrderService.js`
- `src/services/adminProductService.js`
- `src/utils/escapeLike.js`

### Sanitization entrees

- `sanitizeBody` et `sanitizeQuery` dans `src/middlewares/validators.js` strippent les caracteres `<` et `>` de toutes les valeurs string recursivement.

### Logs et erreurs

- Les donnees sensibles sont redactees avant log.
- Les cookies et headers sensibles sont masques en production.
- Les details internes d'erreur ne sont pas exposes au client en production.

Fichiers concernes :

- `src/middlewares/errorHandler.js`
- `src/utils/logger.js`

### Bug connu : requestReturn

Le code actuel dans `src/services/orderService.js` (`requestReturn`) contient une condition inversee :

```js
if (order.status === "Delivered") {
  throw new AppError("Retour refusé: commande déjà livrée", 400, "RETURN_NOT_ALLOWED_DELIVERED");
}
```

Cela bloque les retours pour les commandes livrees, alors que la logique attendue est de les autoriser uniquement pour les commandes au statut `Delivered`. Ce bug a probablement ete reintroduit pendant la refactorisation. A corriger : remplacer `=== "Delivered"` par `!== "Delivered"`.

---

## 3. Routes publiques

Routes montees depuis `src/routes/index.js` :

- `/` -> `src/routes/publicRoutes.js`
- `/auth` -> `src/routes/authRoutes.js`
- `/cart` -> `src/routes/cartRoutes.js`
- `/favorites` -> `src/routes/favoriteRoutes.js`
- `/account` -> `src/routes/accountRoutes.js`
- `/orders` -> `src/routes/orderRoutes.js`
- `/tickets` -> `src/routes/ticketRoutes.js`
- `/payments` -> `src/routes/paymentRoutes.js`
- `/admin` -> `src/routes/adminRoutes.js`

Chemins statiques :

- `/public` -> `src/public/`
- `/.well-known` -> `src/public/.well-known/`

---

## 4. Fonctionnalites client et publiques

### 4.1 Accueil

Ce que ca fait :

- affiche les produits populaires ;
- affiche les categories ;
- affiche les produits recemment vus quand une identite panier/session existe.

Fichiers :

- Route : `GET /`
- Routeur : `src/routes/publicRoutes.js`
- Controller : `src/controllers/publicController.js` -> `home()`
- Services : `src/services/catalogService.js`, `src/services/cartService.js`
- Vue : `src/views/pages/home.ejs`

Acces : tout le monde.

---

### 4.2 Catalogue produits

Ce que ca fait :

- liste les produits actifs ;
- pagination (12 par page) ;
- recherche par mot cle (insensible a la casse en PostgreSQL via `iLike`) ;
- filtres prix, note, stock ;
- tri par popularite, nouveaute ou prix.

Fichiers :

- Route : `GET /products`
- Controller : `publicController.products()`
- Service : `catalogService.listProducts()`
- Vue : `src/views/pages/products/list.ejs`

Acces : tout le monde.

---

### 4.3 Detail produit

Ce que ca fait :

- affiche le produit, images, variantes, categorie, avis visibles ;
- suit les produits recemment consultes ;
- affiche des produits similaires de la meme categorie.

Fichiers :

- Route : `GET /products/:slug`
- Controller : `publicController.productDetail()`
- Services : `catalogService.getProductBySlug()`, `catalogService.trackRecentlyViewed()`
- Vue : `src/views/pages/products/detail.ejs`

Acces : tout le monde.

---

### 4.4 Recherche

Ce que ca fait :

- recherche dans les produits avec le meme moteur que le catalogue ;
- garde les filtres et la pagination.

Fichiers :

- Route : `GET /search`
- Controller : `publicController.search()`
- Service : `catalogService.listProducts()`
- Vue : `src/views/pages/products/list.ejs`

Acces : tout le monde.

---

### 4.5 Categories

Ce que ca fait :

- affiche les produits d'une categorie via son slug ;
- renvoie une 404 si la categorie n'existe pas.

Fichiers :

- Route : `GET /categories/:slug`
- Controller : `publicController.categoryPage()`
- Services : `catalogService.getCategoryBySlug()`, `catalogService.listProducts()`
- Vue : `src/views/pages/products/list.ejs`

Acces : tout le monde.

---

### 4.6 SEO sitemap / robots

Ce que ca fait :

- `GET /sitemap.xml` renvoie un XML avec `/`, `/products`, les categories et les produits actifs ;
- `GET /robots.txt` renvoie `User-agent: *`, `Allow: /`, `Sitemap: /sitemap.xml`.

Fichiers :

- Routes : `GET /sitemap.xml`, `GET /robots.txt`
- Controller : `publicController.sitemap()`, `publicController.robots()`
- Service : `src/services/seoService.js`
- Source produits/categories : `src/services/catalogService.js`

Acces : tout le monde.

Tests :

- `tests/seo.test.js`

---

## 5. Authentification

### 5.1 Inscription

Ce que ca fait :

- cree un compte client avec role `CUSTOMER` ;
- valide la politique de mot de passe (12 car. min, blocklist) ;
- hash le mot de passe avec bcrypt (10 rounds) ;
- prepare le flux de verification email (token hash en base, token non affiche) ;
- applique un rate limit dedie (`registerRateLimit` : 5/heure) ;
- cree un audit log `AUTH / USER_REGISTER` ;
- fusionne le panier invite dans le panier connecte.

Fichiers :

- Routes : `GET /auth/register`, `POST /auth/register`
- Controller : `src/controllers/authController.js`
- Service : `src/services/authService.js`
- Util : `src/utils/passwordPolicy.js`
- Vue : `src/views/pages/auth/register.ejs`

Acces : visiteurs non connectes.

---

### 5.2 Connexion / refresh / logout

Ce que ca fait :

- connecte l'utilisateur apres verification identifiants, statut actif et verrouillage ;
- incremente `failedLoginAttempts` en cas d'echec ; verrouille 15 min apres 10 echecs ;
- remet `failedLoginAttempts` a 0 apres un succes ;
- cree access token (15 min) et refresh token (7 jours) en cookies `httpOnly` ;
- `POST /auth/refresh` : verifie le refresh token, incremente `refreshTokenVersion` (l'ancien token est revoque) ;
- `POST /auth/logout` : incremente `refreshTokenVersion` et efface les cookies ;
- fusionne le panier invite au login ;
- redirige vers `/admin` si role `ADMIN`, vers `/` sinon.

Fichiers :

- Routes : `GET /auth/login`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- Controller : `authController`
- Services : `authService`, `src/config/jwt.js`
- Vue : `src/views/pages/auth/login.ejs`

Acces : login/logout pour visiteurs, refresh selon cookies.

Tests :

- `tests/auth-service.test.js` (verrouillage, rotation refresh token, politique mot de passe)

---

### 5.3 Verification email

Ce que ca fait :

- `GET /auth/verify-email/:token` verifie le token (compare le hash SHA-256) ;
- marque `emailVerifiedAt` et efface le hash en base ;
- redirige vers `/account/profile`.

Note : un email non verifie bloque le checkout (voir section 6.3).

Fichiers :

- Route : `GET /auth/verify-email/:token`
- Controller : `authController.verifyEmail()`
- Service : `authService.verifyEmailToken()`

Acces : visiteurs avec token valide.

---

### 5.4 Mot de passe oublie / reset

Ce que ca fait :

- demande de reset avec message neutre (pas d'enumeration email) ;
- token hash SHA-256 stocke en base, expire apres 1 heure ;
- reset verifie la politique de mot de passe ;
- incremente `refreshTokenVersion` apres reset (invalide toutes les sessions) ;
- rate limit dedie (`resetPasswordRateLimit` : 10/heure).

Fichiers :

- Routes : `GET /auth/forgot-password`, `POST /auth/forgot-password`, `GET /auth/reset-password/:token`, `POST /auth/reset-password/:token`
- Controller : `authController`
- Service : `authService`
- Util : `src/utils/passwordPolicy.js`
- Vues : `forgot-password.ejs`, `reset-password.ejs`

Acces : visiteurs non connectes.

---

## 6. Panier et checkout

### 6.1 Panier

Ce que ca fait :

- panier invite via session (`guestCartKey`) ;
- panier client connecte en base (table `carts`) ;
- ajout, modification quantite, suppression ;
- sauvegarde pour plus tard (`savedForLater`) ;
- fusion au moment de la connexion (`mergeGuestCartIntoUser`).

Fichiers :

- Routes : `GET /cart/`, `POST /cart/items`, `PATCH /cart/items/:id`, `POST /cart/items/:id`, `DELETE /cart/items/:id`, `POST /cart/items/:id/delete`, `POST /cart/items/:id/save-for-later`
- Controller : `src/controllers/cartController.js`
- Service : `src/services/cartService.js`
- Vue : `src/views/pages/cart.ejs`

Acces : tout le monde pour le panier, checkout client connecte.

Tests :

- `tests/cart.test.js`

---

### 6.2 Adresse de checkout

Ce que ca fait :

- permet de creer une adresse pendant le checkout ;
- requiert connexion.

Fichiers :

- Route : `POST /cart/checkout/address`
- Controller : `cartController.createCheckoutAddress()`
- Service : `cartService.createCheckoutAddress()`

Acces : client connecte.

---

### 6.3 Checkout

Ce que ca fait :

- bloque si email non verifie (`emailVerifiedAt` requis) ;
- supporte deux modes de livraison :
  - retrait bureau (`doorDelivery=false`) : frais livraison = 0, tracking format `ITS-R-YYYYMMDD-XXXXXX` ;
  - livraison domicile (`doorDelivery=true`) : frais livraison = 5, tracking format `ITS-D-YYYYMMDD-XXXXXX` ;
- applique un coupon si valide (verrouillage ligne en transaction) ;
- accepte les methodes CASH_ON_DELIVERY, CARD, MOBILE_MONEY, PAYPAL ;
- dans une seule transaction : numero de commande unique genere, commande et items crees, stock decremente, popularite incrementee ;
- historique de statut initialise a `Processing` ;
- notification `ORDER_CREATED` creee ;
- facture PDF generee ;
- email facture envoye si SMTP disponible (echec email non bloquant) ;
- audit log `ORDER / ORDER_CREATED` ;
- panier vide apres commande.

Fichiers :

- Route : `POST /cart/checkout`
- Controller : `cartController.checkout()`
- Services : `orderService.createOrderFromCart()`, `promoService`, `invoiceService`, `emailService`
- Vue : `src/views/pages/cart.ejs`

Acces : clients connectes avec email verifie.

Tests :

- `tests/checkout.test.js`

---

## 7. Paiements

### 7.1 PayPal

Ce que ca fait :

- demarre un paiement PayPal ;
- gere le retour PayPal ;
- supporte les endpoints SDK create/capture ;
- supporte les webhooks PayPal (validation domaine PayPal officiel) ;
- marque la commande comme payee quand la capture est valide.

Fichiers :

- Routes :
  - `GET /payments/paypal/start`
  - `GET /payments/paypal/return`
  - `POST /payments/paypal/sdk/create-order`
  - `POST /payments/paypal/sdk/capture-order`
  - `POST /payments/paypal/webhook`
- Controller : `src/controllers/paymentController.js`
- Services : `src/services/paypalService.js`, `src/services/orderService.js`

Acces : clients connectes sauf webhook.

Tests :

- `tests/payments.test.js`

---

## 8. Compte client

### 8.1 Profil et adresses

Ce que ca fait :

- affiche les informations du client, adresses et notifications recentes ;
- met a jour le profil (URL avatar validee avec `parseHttpsUrl`) ;
- cree, modifie et supprime les adresses avec whitelist explicite de champs ;
- gere l'adresse par defaut.

Fichiers :

- Routes :
  - `GET /account/profile`
  - `POST /account/profile`
  - `POST /account/addresses`
  - `POST /account/addresses/:id`
  - `POST /account/addresses/:id/delete`
- Controller : `src/controllers/accountController.js`
- Service : `src/services/accountService.js`
- Vue : `src/views/pages/account/profile.ejs`

Acces : clients connectes.

Tests :

- `tests/account.test.js`

---

### 8.2 Favoris

Ce que ca fait :

- liste les favoris ;
- ajoute un produit aux favoris ;
- retire un favori ;
- deplace un favori vers le panier.

Fichiers :

- Routes :
  - `GET /favorites/`
  - `POST /favorites/:productId`
  - `DELETE /favorites/:productId`
  - `POST /favorites/:productId/delete`
  - `POST /favorites/:productId/move-to-cart`
- Controller : `src/controllers/favoriteController.js`
- Service : `src/services/favoriteService.js`
- Vue : `src/views/pages/favorites.ejs`

Acces : clients connectes.

Tests :

- `tests/favorites.test.js`

---

### 8.3 Commandes client

Ce que ca fait :

- liste les commandes du client ;
- affiche le detail d'une commande avec items, historique statut, tracking et demande de retour si presente ;
- permet de telecharger la facture PDF via route authentifiee avec verification d'appartenance.

Fichiers :

- Routes : `GET /orders/`, `GET /orders/:id`, `GET /orders/:id/invoice`
- Controller : `src/controllers/orderController.js`
- Service : `src/services/orderService.js`
- Vues : `src/views/pages/orders/list.ejs`, `src/views/pages/orders/detail.ejs`

Acces : clients connectes.

Tests :

- `tests/orders.test.js`

---

### 8.4 Demande de retour client

Ce que ca fait attendu :

- permet au client de demander un retour sur une commande ;
- autorise la demande uniquement si la commande est au statut `Delivered` ;
- bloque la demande pour tout autre statut.

Etat actuel :

BUG ACTIF. La condition dans `src/services/orderService.js` (`requestReturn`) est inversee : elle leve une erreur si `order.status === "Delivered"`, bloquant ainsi les retours des commandes livrees. Correction requise : remplacer `=== "Delivered"` par `!== "Delivered"`.

Fichiers :

- Route : `POST /orders/:id/return-request`
- Controller : `orderController.returnRequest()`
- Service : `orderService.requestReturn()`
- Vue : `src/views/pages/orders/detail.ejs`

Acces : clients connectes.

---

### 8.5 Avis produits

Ce que ca fait :

- permet de laisser une note et un commentaire ;
- met a jour un avis existant si necessaire ;
- attribue le badge achat verifie si une commande livree contient le produit ;
- recalcule la note moyenne du produit.

Fichiers :

- Route : `POST /products/:slug/reviews`
- Controller : `publicController.submitReview()`
- Service : `src/services/reviewService.js`
- Vue : `src/views/pages/products/detail.ejs`

Acces : clients connectes.

---

### 8.6 Support client

Ce que ca fait :

- liste les tickets du client ;
- cree un ticket ;
- ajoute un message sur un ticket ;
- bloque l'acces aux tickets d'un autre utilisateur.

Fichiers :

- Routes : `GET /tickets/`, `POST /tickets/`, `POST /tickets/:id/messages`
- Controller : `src/controllers/ticketController.js`
- Service : `src/services/ticketService.js`
- Vue : `src/views/pages/tickets/list.ejs`

Acces : clients connectes.

Tests :

- `tests/tickets.test.js`

---

## 9. Administration

Toutes les routes admin passent par :

1. `requireAuth`
2. `requireRole("ADMIN")`
3. `requireFreshAdminSession` (deconnexion auto apres 30 min d'inactivite)

Routeur : `src/routes/adminRoutes.js`

---

### 9.1 Dashboard admin

Ce que ca fait :

- affiche revenus totaux, frais poids, nombre de commandes, panier moyen, nouveaux clients, total clients ;
- top produits avec nom produit, top categories avec nom categorie ;
- commandes recentes ;
- series de progression pour graphique ;
- filtres `startDate` et `endDate`.

Fichiers :

- Route : `GET /admin`
- Controller : `src/controllers/adminController.js` -> `dashboard()`
- Service : `src/services/adminService.js` -> `getDashboardStats()`
- Vue : `src/views/pages/admin/dashboard.ejs`

Tests :

- `tests/admin-dashboard.test.js`

---

### 9.2 API stats admin

Ce que ca fait :

- renvoie les statistiques dashboard en JSON.

Fichiers :

- Route : `GET /admin/stats`
- Controller : `adminController.stats()`
- Service : `adminService.getDashboardStats()`

Acces : admin uniquement.

---

### 9.3 Produits admin

Ce que ca fait :

- liste les produits admin avec filtres (nom/SKU/marque, categorie, stock <= seuil) ;
- cree un produit avec whitelist de champs (`pickProductFields`) et validation URL image HTTPS ;
- modifie un produit ;
- supprime un produit (soft delete via `paranoid`) ;
- gere les images (ajout, modification, suppression, promotion isMain automatique) ;
- gere les variantes (ajout, modification, suppression).

Fichiers :

- Routes : voir `src/routes/adminRoutes.js` (section products)
- Controller : `adminController`
- Service : `src/services/adminProductService.js` (extrait lors de la Phase 2)
- Vue : `src/views/pages/admin/products.ejs`

Acces : admin uniquement.

Tests :

- `tests/admin-products.test.js`

---

### 9.4 Categories admin

Ce que ca fait :

- liste les categories ;
- cree, modifie et supprime une categorie.

Fichiers :

- Routes : `GET /admin/categories`, `POST /admin/categories`, `POST /admin/categories/:id`, `POST /admin/categories/:id/delete`
- Controller : `adminController`
- Service : `src/services/adminCategoryService.js`
- Vue : `src/views/pages/admin/categories.ejs`

Tests :

- `tests/admin-categories.test.js`

---

### 9.5 Commandes admin

Ce que ca fait :

- liste toutes les commandes avec filtres (recherche client par nom/email via `escapeLike`, statut, dates) ;
- affiche le detail commande ;
- change le statut (restitue le stock si annulation) ;
- exporte PDF brut commande ;
- exporte etiquette d'expedition.

Fichiers :

- Routes : voir `src/routes/adminRoutes.js` (section orders)
- Controller : `adminController`
- Service : `src/services/adminOrderService.js` (extrait lors de la Phase 2)
- Vues : `src/views/pages/admin/orders.ejs`, `src/views/pages/admin/order-detail.ejs`

Acces : admin uniquement.

Tests :

- `tests/admin-orders.test.js`

---

### 9.6 Coupons admin

Ce que ca fait :

- liste les coupons ;
- cree un coupon (normalise le code en majuscules) ;
- conserve les champs type, valeur, minimum panier, plafond, dates, limites d'utilisation et statut actif.

Fichiers :

- Routes : `GET /admin/coupons`, `POST /admin/coupons`
- Controller : `adminController`
- Service : `src/services/adminCouponService.js`
- Vue : `src/views/pages/admin/coupons.ejs`

Tests :

- `tests/admin-coupons.test.js`

---

### 9.7 Avis admin

Ce que ca fait :

- liste les avis avec produit et utilisateur ;
- masque, reaffiche ou supprime un avis ;
- recalcule la note moyenne du produit.

Fichiers :

- Routes : `GET /admin/reviews`, `POST /admin/reviews/:id/moderation`
- Controller : `adminController`
- Service : `src/services/adminReviewService.js`
- Vue : `src/views/pages/admin/reviews.ejs`

Tests :

- `tests/admin-reviews.test.js`

---

### 9.8 Clients admin

Ce que ca fait :

- liste les utilisateurs client ;
- bloque ou debloque un client.

Fichiers :

- Routes : `GET /admin/users`, `POST /admin/users/:id/block-toggle`
- Controller : `adminController`
- Service : `src/services/adminUserService.js`
- Vue : `src/views/pages/admin/users.ejs`

Tests :

- `tests/admin-users.test.js`

---

### 9.9 Retours / remboursements admin

Ce que ca fait :

- liste toutes les demandes de retour avec commande et client associes ;
- ne contient pas encore d'action admin de traitement remboursement.

Fichiers :

- Route : `GET /admin/refunds`
- Controller : `adminController.refundsPage()`
- Service : `src/services/adminRefundService.js`
- Vue : `src/views/pages/admin/refunds.ejs`

Tests :

- `tests/admin-refunds.test.js`

---

### 9.10 Module logistique admin

Ce que ca fait :

- affiche les 100 dernieres commandes triees par `createdAt DESC` ;
- affiche date, numero, statut, tracking, consolidation, douane, client et articles.

Fichiers :

- Route : `GET /admin/logistics`
- Controller : `adminController.logisticsPage()`
- Service : `src/services/adminLogisticsService.js`
- Vue : `src/views/pages/admin/logistics.ejs`

Tests :

- `tests/admin-logistics.test.js`

---

### 9.11 Logs d'audit admin

Ce que ca fait :

- liste les logs d'audit ;
- filtres categorie, niveau, recherche, email acteur, dates ;
- pagination (10-200 entrees) et tri par date DESC ;
- expose categories (`SYSTEM`, `AUTH`, `ORDER`, `USER`, `PRODUCT`, `ADMIN`, `SUPPORT`, `PAYMENT`) et niveaux (`INFO`, `WARN`, `ERROR`) a la vue.

Fichiers :

- Route : `GET /admin/logs`
- Controller : `adminController.logsPage()`
- Service : `src/services/auditLogService.js`
- Vue : `src/views/pages/admin/logs.ejs`

Tests :

- `tests/admin-logs.test.js`

---

## 10. Services transversaux

### 10.1 `orderService`

Responsable de :

- creation de commande depuis panier (avec verification email verifie) ;
- generation numero commande unique (boucle retry, fallback timestamp) ;
- generation tracking unique (format `ITS-D-` / `ITS-R-` selon mode livraison) ;
- validation coupon dans la transaction (verrou de ligne, race condition eliminee) ;
- creation items, decrement stock, increment popularite ;
- historique de statut, notification, audit log ;
- marquage paiement (`markOrderAsPaid`) ;
- liste/detail commandes client ;
- demande de retour client (BUG ACTIF - voir section 8.4) ;
- changement de statut admin avec restitution stock si annulation et attribution fidelite si livraison.

### 10.2 `adminOrderService`

Responsable de (extrait lors de la Phase 2) :

- `listOrders` : filtres client (nom/email), statut, dates, limite 100 ;
- `getOrderDetail` : detail avec user, items, historique ;
- `getOrderForPdf` : detail pour export PDF ;
- `getOrderForShippingLabel` : detail pour etiquette expedition.

### 10.3 `adminProductService`

Responsable de (extrait lors de la Phase 2) :

- `listProducts` : filtres nom/SKU/marque, categorie, stock ; limite 200 ;
- `createProductFromAdmin` / `updateProductFromAdmin` : via `pickProductFields` et `parseHttpsUrl` ;
- `deleteProductFromAdmin` : soft delete ;
- `addProductImageFromAdmin` / `updateProductImageFromAdmin` / `deleteProductImageFromAdmin` : avec promotion `isMain` automatique ;
- `addProductVariantFromAdmin` / `updateProductVariantFromAdmin` / `deleteProductVariantFromAdmin`.

### 10.4 `orderDocumentService`

Responsable de export PDF commande et etiquette expedition.

### 10.5 `loyaltyService`

Responsable de calcul et attribution des points fidelite lors du passage a `Delivered`.

Tests :

- `tests/loyalty.test.js`

### 10.6 `auditLogService`

Responsable de creation et listage des logs d'audit avec categories et niveaux.

Risque restant connu :

- certains tests admin d'acces refuse genèrent un warning SQLite `no such table: audit_logs` quand l'ecriture d'audit log est tentee dans une base de test incomplète. Les tests passent.

---

## 11. Etat de la refactorisation

### Phase 1 (terminee)

Modules couverts : tickets support, profil/adresses, favoris, admin categories, admin coupons, admin avis, admin clients, admin logs, admin logistique, admin refunds, admin dashboard, SEO.

### Phase 2 (terminee)

Modules couverts : produits admin, commandes admin.

Services ajoutes :

- `src/services/adminProductService.js`
- `src/services/adminOrderService.js`

Tests ajoutes :

- `tests/admin-products.test.js`
- `tests/admin-orders.test.js`

### Services ajoutes en Phase 1

- `src/services/accountService.js`
- `src/services/ticketService.js`
- `src/services/adminCategoryService.js`
- `src/services/adminCouponService.js`
- `src/services/adminReviewService.js`
- `src/services/adminUserService.js`
- `src/services/adminLogisticsService.js`
- `src/services/adminRefundService.js`
- `src/services/seoService.js`

### Suite de tests actuelle

21 fichiers de test :

- `tests/account.test.js`
- `tests/admin-categories.test.js`
- `tests/admin-coupons.test.js`
- `tests/admin-dashboard.test.js`
- `tests/admin-logistics.test.js`
- `tests/admin-logs.test.js`
- `tests/admin-orders.test.js`
- `tests/admin-products.test.js`
- `tests/admin-refunds.test.js`
- `tests/admin-reviews.test.js`
- `tests/admin-users.test.js`
- `tests/auth-service.test.js`
- `tests/cart.test.js`
- `tests/checkout.test.js`
- `tests/favorites.test.js`
- `tests/loyalty.test.js`
- `tests/orders.test.js`
- `tests/payments.test.js`
- `tests/seo.test.js`
- `tests/smoke.test.js`
- `tests/tickets.test.js`

---

## 12. Roles utilisateurs

### Visiteur

Peut :

- consulter accueil, catalogue, categories, recherche, detail produit ;
- consulter `sitemap.xml`, `robots.txt`, `/.well-known/` ;
- utiliser le panier invite ;
- s'inscrire ;
- se connecter ;
- demander un reset password.

Ne peut pas :

- passer commande sans connexion ;
- passer commande sans email verifie ;
- acceder aux favoris, profil, commandes, tickets ;
- poster un avis ;
- acceder a l'admin.

### Client connecte

Peut :

- faire tout ce qu'un visiteur peut faire ;
- gerer son panier persistant ;
- passer commande si email verifie ;
- payer selon les moyens disponibles ;
- consulter ses commandes et telecharger ses factures ;
- demander un retour (sur commande livree - BUG ACTIF inverse) ;
- gerer profil et adresses ;
- gerer favoris ;
- poster des avis ;
- ouvrir et suivre des tickets ;
- recevoir notifications ;
- cumuler des points fidelite quand les commandes sont livrees.

Ne peut pas :

- acceder a l'admin ;
- voir les commandes, tickets ou adresses d'un autre client.

### Admin

Peut :

- acceder au dashboard avec stats ;
- consulter stats JSON ;
- gerer produits, images, variantes ;
- gerer categories ;
- consulter et filtrer commandes ;
- changer les statuts de commande ;
- exporter PDF commande et etiquette expedition ;
- creer coupons ;
- moderer avis ;
- bloquer/debloquer clients ;
- consulter retours/remboursements ;
- consulter logistique ;
- consulter logs d'audit.

Session deconnectee automatiquement apres 30 min d'inactivite.

---

## 13. Flux commande resume

1. Le client ajoute des produits au panier (invite ou connecte).
2. Le panier calcule les totaux sans frais de livraison.
3. Le client connecte avec email verifie lance le checkout.
4. Choix du mode de livraison : retrait bureau (gratuit, tracking `ITS-R-...`) ou domicile (+5, tracking `ITS-D-...`).
5. Dans une transaction unique : coupon verrouille et valide, stock verifie, numero unique genere, commande et items crees, stock decremente.
6. La popularite produit est incrementee.
7. Une facture PDF est generee et un email peut etre envoye.
8. Si PayPal est choisi, le paiement passe par `paypalService`.
9. L'admin peut suivre et changer le statut depuis `/admin/orders`.
10. Si annulation, le stock est restitue.
11. A la livraison (`Delivered`), les points fidelite sont attribues.
12. Apres livraison, le client peut laisser un avis ou demander un retour (BUG ACTIF dans requestReturn).
13. La facture est accessible via `GET /orders/:id/invoice` (authentifie, appartenance verifiee).

---

## 14. Prochaines actions prioritaires

1. **Corriger le bug `requestReturn`** : dans `src/services/orderService.js`, remplacer `if (order.status === "Delivered")` par `if (order.status !== "Delivered")`.

2. **Nettoyage warnings `audit_logs`** dans les tests admin d'acces refuse.

3. **`sameSite: "strict"`** non applicable actuellement a cause du retour PayPal cross-site. A reevaluer si le flux PayPal evolue vers un iframe ou capture cote serveur uniquement.

4. **CSP nonce** : supprimer `unsafe-inline` des scripts en introduisant un nonce genere par requete.

5. **Tests plus complets sur checkout/orderService** : couvrir les edge cases coupon, doorDelivery et restitution stock.
