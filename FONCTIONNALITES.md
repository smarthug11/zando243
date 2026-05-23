# FONCTIONNALITES.md - Etat fonctionnel et technique de Zando243

Derniere mise a jour : 24/05/2026 (Phase 2C-7 a 2C-10 completes : tests deleteProductImage, variantes, orderDetailPage, updateOrder, PDF ; fix filtre date GET /admin/orders ; fix finalPrice non recalcule sur updateProduct — suite : 38 tests admin-orders, 95 tests admin-products, 0 fail)

Ce document resume ce que fait l'application Zando243, les routes principales, les fichiers responsables, les services metier utilises, les protections en place et l'etat de la refactorisation progressive.

Il complete `README.md`, `update.md` et les rapports dans `security-audits/`.

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
- PostgreSQL pour les tests (base `zando243_test`)
- **Better Auth** comme systeme d'authentification unique (sessions cookies `better-auth.session_token`, scrypt natif)
- `helmet` avec CSP active, `csrf-csrf`, `express-rate-limit`, `express-validator`, `sanitize-html`
- logs structures avec `pino`
- tests avec `node --test` (suite : 336 tests, 0 fail)

---

## 2. Etat securite

Trois audits de securite ont ete realises (SAST 29/03/2026, SAST V2 25/04/2026, OWASP ASVS L1 26/04/2026). Les rapports sont dans `security-audits/`.

### Secrets et authentification

- Les secrets `BETTER_AUTH_SECRET`, `COOKIE_SECRET` et `SESSION_SECRET` sont obligatoires en production.
- En production, chaque secret doit faire au moins 32 caracteres et ne pas contenir de placeholder (`change_me`, `unsafe`, `secret`) — verifie au demarrage via `validateProductionSecret`.
- L'authentification est gérée par **Better Auth** (lib maintenue). Les sessions sont stockées en base (`auth_session`) avec un token signé envoyé via le cookie `better-auth.session_token` (`httpOnly`, `sameSite: lax`, `secure` en prod).
- Les passwords sont hashés par Better Auth (scrypt natif, paramètres par défaut).
- Le reset password utilise un message neutre pour eviter l'enumeration d'emails.
- L'email de vérification est envoyé automatiquement à l'inscription via le hook `sendVerificationEmail` configuré dans `src/auth-be/index.mjs`.
- Un policy hook BA applique la politique de mot de passe maison (12 chars min, blocklist, ≤72 octets) sur `sign-up` et `reset-password`.

Fichiers concernes :

- `src/config/env.js`
- `src/auth-be/index.mjs` (config Better Auth, hooks email)
- `src/auth-be/hooks.mjs` (before/after hooks : policy + mirror + audit log)
- `src/controllers/auth2Controller.js`
- `src/middlewares/auth.js` (`loadCurrentUser` lit BA only)

### Politique de mot de passe

- Minimum 12 caracteres (pas de contraintes majuscule/chiffre/symbole).
- Maximum 72 octets UTF-8 pour eviter la troncature silencieuse de bcrypt.
- Blocklist de mots de passe evidents : `123456789012`, `zando2431234`, `qwerty123456`, etc.
- Verifiee a l'inscription et au reset password.
- Affiche un message d'erreur specifique si le mot de passe est trop court, trop long ou dans la blocklist.

Fichiers concernes :

- `src/utils/passwordPolicy.js` (validation maison)
- `src/auth-be/hooks.mjs` (`enforcePasswordPolicy` via beforeHook BA)
- `src/views/pages/auth2/register.ejs` (hint UI : "12 caracteres minimum")

### Verrouillage de compte (brute-force)

Better Auth gère le rate limiting des tentatives de connexion via `express-rate-limit` (5 tentatives par fenêtre de 15 min sur `POST /auth2/login`). Les anciennes colonnes `failedLoginAttempts` / `lockedUntil` sur `users` ne sont plus utilisées (legacy JWT) — elles restent en base en attente de cleanup SQL.

Fichiers concernes :

- `src/middlewares/rateLimit.js` (`loginRateLimit`)
- `src/routes/auth2Routes.js`

### Gestion de session

- Les sessions Better Auth sont stockées dans `auth_session` avec un `expiresAt` (7 jours par défaut).
- La rotation/refresh est gérée automatiquement par Better Auth côté serveur (pas d'endpoint exposé côté client).
- Le sign-out (`POST /auth2/logout`) appelle l'API Better Auth pour supprimer la ligne en base + purge le cookie navigateur via `clearBaCookies`.
- Reset password : Better Auth invalide toutes les sessions actives du user automatiquement.

Fichiers concernes :

- `src/controllers/auth2Controller.js` (`login`, `logout`, `clearBaCookies`)
- `src/auth-be/index.mjs` (config session BA)

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
- `src/routes/auth2Routes.js` (rate limits login, register, reset password depuis la migration Better Auth)

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
- Exemption unique : `/payments/paypal/webhook` (PayPal ne peut pas envoyer de token CSRF).
- `/auth/refresh` n'est plus exempte et est maintenant protege par CSRF.
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

### Sanitisation entrees

- `sanitizeBody` et `sanitizeQuery` dans `src/middlewares/validators.js` utilisent `sanitize-html` avec `allowedTags: []` et `allowedAttributes: {}`.
- Tout HTML est completement supprime des valeurs string de maniere recursive (balises, attributs, URIs `javascript:`, handlers `onerror`, etc.).

### Content-Type validation

- Un middleware `validateContentType` est applique avant les parsers Express.
- Les requetes `POST`, `PATCH`, `PUT`, `DELETE` doivent fournir un Content-Type parmi : `application/x-www-form-urlencoded`, `application/json`, `multipart/form-data`.
- Tout autre Content-Type reçoit un `415 UNSUPPORTED_CONTENT_TYPE`.
- Exception : `/payments/paypal/webhook`.

Fichier concerne :

- `app.js`

### Entropie des identifiants generes

- Les numeros de commande, de tracking et leurs fallbacks utilisent `crypto.randomInt()` (CSPRNG) au lieu de `Math.random()`.

Fichier concerne :

- `src/services/orderService.js`

### Logs et erreurs

- Les donnees sensibles sont redactees avant log.
- Les cookies et headers sensibles sont masques en production.
- Les details internes d'erreur ne sont pas exposes au client en production.

Fichiers concernes :

- `src/middlewares/errorHandler.js`
- `src/utils/logger.js`

---

## 3. Routes publiques

Routes montees depuis `src/routes/index.js` :

- `/` -> `src/routes/publicRoutes.js`
- `/auth` -> redirects 308 permanents vers `/auth2/*` (compatibilite bookmarks/liens externes ; `authRoutes.js` supprime le 23/05/2026)
- `/auth2` -> `src/routes/auth2Routes.js` (Better Auth — systeme d'auth actif)
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

## 5. Authentification (Better Auth)

Toute l'auth est gérée par **Better Auth**. Le système JWT historique (`/auth/*`) a été supprimé le 23/05/2026. Les anciennes routes `/auth/*` redirigent en 308 vers `/auth2/*` (compatibilité bookmarks/liens externes uniquement).

### 5.1 Inscription

Ce que ca fait :

- envoie un sign-up Better Auth via l'API interne (`auth.handler` proxy depuis `auth2Controller.register`) ;
- BA crée la ligne dans `auth_user` + `auth_account` (password scrypt) + session ;
- le hook `afterHook` mirrore le user dans la table `users` (mêmes id/email/firstName/lastName, role `CUSTOMER`, passwordHash `null`) ;
- envoie l'email de vérification automatiquement (hook `sendVerificationEmail` → SMTP) ;
- politique de mot de passe maison appliquée via `beforeHook` (12 chars min, blocklist, ≤72 octets) ;
- audit log `AUTH / USER_REGISTER` écrit ;
- fusion du panier invité dans le panier connecté ;
- rate limit dédié `registerRateLimit` (5/heure).

Fichiers :

- Routes : `GET /auth2/register`, `POST /auth2/register`
- Controller : `src/controllers/auth2Controller.js`
- Service BA : `src/auth-be/index.mjs` (config + hooks email)
- Hooks BA : `src/auth-be/hooks.mjs` (policy + mirror + audit)
- Util : `src/utils/passwordPolicy.js`
- Vue : `src/views/pages/auth2/register.ejs`

Acces : visiteurs non connectes.

Tests :

- `tests/auth2-http.test.js` (succès, password court refusé, email duplicate refusé)
- `tests/better-auth-service.test.js` (sign-up API, policy, mirror, anti role injection)
- `tests/better-auth-mirror.test.js` (mirror users + audit log)
- `tests/better-auth-ssr.test.js` (parcours SSR complet)

---

### 5.2 Connexion / logout

Ce que ca fait :

- `POST /auth2/login` : appelle `auth.api.signInEmail` → BA pose le cookie `better-auth.session_token` (durée 7 jours par défaut) ;
- audit log `AUTH / USER_LOGIN` écrit via `afterHook` BA ;
- fusion du panier invité au login ;
- redirige vers `/admin` si role `ADMIN`, vers `/` sinon ;
- `POST /auth2/logout` : appelle `auth.handler('/api/auth/sign-out')` → BA détruit la ligne en `auth_session` ; le helper `clearBaCookies` purge le cookie côté navigateur en fallback ;
- audit log `AUTH / USER_LOGOUT` écrit via `beforeHook` BA ;
- rate limit dédié `loginRateLimit` (5/15min).

Fichiers :

- Routes : `GET /auth2/login`, `POST /auth2/login`, `POST /auth2/logout`
- Controller : `src/controllers/auth2Controller.js` (`login`, `logout`, `clearBaCookies`)
- Service BA : `src/auth-be/index.mjs`
- Vue : `src/views/pages/auth2/login.ejs`

Acces : login pour visiteurs, logout pour utilisateurs connectés.

Tests :

- `tests/auth2-http.test.js` (succès login, bad password, email inconnu, logout détruit session, accès post-logout impossible)
- `tests/better-auth-session.test.js` (session loading par cookie)
- `tests/better-auth-mirror.test.js` (audit log USER_LOGIN / USER_LOGOUT)

---

### 5.3 Verification email

Ce que ca fait :

- BA envoie l'email automatiquement à l'inscription (`sendOnSignUp: true` dans `src/auth-be/index.mjs`) ;
- le lien dans l'email pointe sur `/api/auth/verify-email?token=...` ;
- le `afterHook` met à jour `emailVerifiedAt` dans la table `users` ;
- `autoSignInAfterVerification: true` : le user est automatiquement connecté après vérification.

Note : un email non vérifié bloque le checkout (voir section 6.3).

Fichiers :

- Route : `GET/POST /api/auth/verify-email` (handler BA natif)
- Hook mirror : `src/auth-be/hooks.mjs` (afterHook sur `/verify-email`)

Acces : visiteurs avec token valide.

---

### 5.4 Mot de passe oublie / reset

Ce que ca fait :

- `POST /auth2/forgot-password` : appelle `auth.handler('/api/auth/request-password-reset')` ;
- BA crée une ligne `auth_verification` avec un token et envoie l'email via `sendResetPasswordEmail` ;
- réponse opaque pour éviter l'énumération d'emails (même flash que l'email existe ou non) ;
- `POST /auth2/reset-password` : appelle `auth.handler('/api/auth/reset-password')` avec le token ;
- BA vérifie le token, met à jour le hash scrypt dans `auth_account.password`, invalide les sessions actives ;
- la politique de mot de passe maison s'applique via `beforeHook` (12 chars min, blocklist, ≤72 octets) ;
- rate limit dédié `resetPasswordRateLimit` (10/heure).

Fichiers :

- Routes : `GET/POST /auth2/forgot-password`, `GET/POST /auth2/reset-password`
- Controller : `src/controllers/auth2Controller.js` (`requestPasswordReset`, `resetPassword`)
- Hook policy : `src/auth-be/hooks.mjs` (`beforeHook` sur `/reset-password`)
- Vues : `forgot-password.ejs`, `reset-password.ejs` (dans `src/views/pages/auth2/`)

Acces : visiteurs non connectes.

Tests :

- `tests/auth2-http.test.js` (anti-énumération opaque)
- `tests/better-auth-service.test.js` (`requestPasswordReset` + `resetPassword` changent effectivement le hash)

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
- dans une seule transaction : les `CartItem` sont relus en base, les `Product` sont relus et verrouilles (`FOR UPDATE` sur PostgreSQL), le statut `ACTIVE` et le stock suffisant sont verifies depuis les donnees relues (eliminant le TOCTOU stock), numero de commande unique genere, commande et items crees, stock decremente, popularite incrementee ;
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
- `tests/better-auth-checkout-admin.test.js` (checkout email verifie/non verifie avec Better Auth, acces admin RBAC)

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

Ce que ca fait :

- permet au client de demander un retour sur une commande ;
- autorise la demande uniquement si la commande est au statut `Delivered` ;
- bloque la demande pour tout autre statut.

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
- demande de retour client (autorisee uniquement si statut `Delivered`) ;
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

30 fichiers de test (`_setup-test-db.js` est un helper partagé, pas un fichier de test) :

- `tests/account.test.js`
- `tests/admin-categories.test.js`
- `tests/admin-coupons.test.js`
- `tests/admin-dashboard.test.js`
- `tests/admin-logistics.test.js`
- `tests/admin-logs.test.js`
- `tests/admin-nav-ui.test.js` (navigation admin : lien actif/inactif selon `currentPath`)
- `tests/admin-orders.test.js`
- `tests/admin-products.test.js`
- `tests/admin-refunds.test.js`
- `tests/admin-reviews.test.js`
- `tests/admin-users.test.js`
- `tests/auth2-http.test.js` (HTTP /auth2/* : register, login, logout, forgot-password, session, RBAC, cart merge)
- `tests/better-auth-checkout-admin.test.js` (checkout email verifie/non verifie avec BA, acces admin RBAC)
- `tests/better-auth-mirror.test.js` (mirror auth_user -> users, audit log USER_LOGIN/LOGOUT)
- `tests/better-auth-mount.test.js` (montage Better Auth sur /api/auth/*)
- `tests/better-auth-service.test.js` (signUpEmail, policy, mirror, anti role injection, signInEmail, reset)
- `tests/better-auth-session.test.js` (chargement session via cookie BA dans loadCurrentUser)
- `tests/better-auth-ssr.test.js` (parcours SSR complet : register, login, profile, logout)
- `tests/cart.test.js`
- `tests/checkout.test.js`
- `tests/csrf.test.js` (CSRF : flux GET+POST navigateur non bloque sur /auth2/login et /cart/items)
- `tests/favorites.test.js`
- `tests/loyalty.test.js`
- `tests/orders.test.js`
- `tests/payments.test.js`
- `tests/product-detail-ui.test.js` (script inline detail produit : initialisation miniatures, fallback)
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
- demander un retour (sur commande au statut `Delivered` uniquement) ;
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
12. Apres livraison, le client peut laisser un avis ou demander un retour.
13. La facture est accessible via `GET /orders/:id/invoice` (authentifie, appartenance verifiee).

---

## 14. Prochaines actions prioritaires

1. **Nettoyage warnings `audit_logs`** dans les tests admin d'acces refuse (table absente dans certaines bases SQLite de test).

2. **`sameSite: "strict"`** non applicable actuellement a cause du retour PayPal cross-site. A reevaluer si le flux PayPal evolue vers un iframe ou capture cote serveur uniquement.

3. **CSP nonce** : supprimer `unsafe-inline` des scripts en introduisant un nonce genere par requete.

4. ~~**Refactorisation Phase 2C (suite)**~~ : **FAIT** — tests `deleteProductImage`, `addProductVariant`, `updateProductVariant`, `deleteProductVariant`, `orderDetailPage`, `updateOrder`, `orderRawPdf`, `orderShippingLabelPdf` ecrits et passes.

5. ~~**Correction du filtre date `GET /admin/orders`**~~ : **CORRIGE** — `Object.keys(range)` remplace par `Object.getOwnPropertySymbols(range)` dans `adminOrderService.js:26`, 4 tests de regression ajoutes.

6. ~~**`finalPrice` non recalcule sur `updateProduct`**~~ : **CORRIGE** — recalcul explicite ajoute dans `updateProductFromAdmin` apres `Object.assign`, 2 tests de regression ajoutes.

7. **Renommage `/auth2/*` -> `/auth/*`** : les URLs `/auth2/login`, `/auth2/register`, etc. sont les URLs actives mais pas celles annoncees aux utilisateurs. A faire quand les redirects 308 ne sont plus utilises par personne (requiert d'attendre que les anciens bookmarks/liens expirent).

8. **Nettoyage colonnes legacy `users`** : les colonnes `password_hash`, `refresh_token_version`, `failed_login_attempts`, `locked_until`, `email_verification_token_hash`, `reset_password_token_hash`, `reset_password_expires_at` sont orphelines depuis la migration Better Auth. A supprimer via migration SQL apres backup et validation prod.

9. **Variables `JWT_*` dans `.env.example`** : laissees en place apres la migration Better Auth, inoffensives mais a nettoyer dans une PR separee.
