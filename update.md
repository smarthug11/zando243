# Journal des mises à jour — Zando243

Ce fichier sert de contexte rapide sur les changements apportés au projet : ce qui a été ajoute, retire, ou modifie, et pourquoi ces changements ont ete faits.

---

## 30/03/2026 — Corrections sécurité (SAST) + Audit logs

### Contexte
Audit SAST manuel réalisé le 29/03/2026. 22 failles identifiées (3 critiques, 7 élevées, 6 moyennes, 6 faibles).
Cette session traite les critiques et les élevées liées au compte Admin, à l'authentification JWT, et aux fuites de données dans les logs.

---

### 1. `src/config/env.js` — Secrets obligatoires en production

**Problème :** Les secrets JWT, cookie et session avaient des valeurs de repli en dur dans le code (`"dev_access_secret"`, etc.). Si les variables d'environnement Railway n'étaient pas définies, ces valeurs connues publiquement étaient utilisées en prod — permettant de forger des JWT Admin valides.

**Ce qui a changé :**
- Ajout d'une fonction `requireSecret(name, devFallback)` qui lit la variable d'environnement.
- En production (`NODE_ENV=production`) : si la variable est absente, le serveur **lance une exception au démarrage** et refuse de tourner.
- En développement : utilise le fallback avec le suffixe `_UNSAFE` pour que ce soit visuellement évident dans les logs.
- La variable `isProd` est maintenant déclarée une seule fois en haut du fichier et réutilisée partout (y compris pour le dialecte DB qui avant recalculait `NODE_ENV` à la main).

---

### 2. `src/config/jwt.js` — Vérification JWT renforcée

**Problème :** `jwt.verify()` n'avait aucune contrainte d'algorithme. Un attaquant pouvait envoyer un token avec `"alg": "none"` (signature vide) et potentiellement bypasser la vérification selon la version de `jsonwebtoken`. De plus, rien n'empêchait d'utiliser un refresh token à la place d'un access token.

**Ce qui a changé :**
- `verifyAccessToken` et `verifyRefreshToken` passent maintenant `{ algorithms: ["HS256"] }` à `jwt.verify()` — l'algorithme est fixe, tout autre algorithme est rejeté.
- Après vérification, le champ `payload.type` est contrôlé : `"access"` pour les access tokens, `"refresh"` pour les refresh tokens. Un token du mauvais type lève une erreur même s'il est valide cryptographiquement.

---

### 3. `src/controllers/authController.js` — Tokens retirés des messages flash

**Problème :** Deux endpoints retournaient des tokens secrets directement dans la page HTML :
- Inscription : le token de vérification email apparaissait dans le flash → n'importe qui pouvait vérifier son compte sans accéder à sa boîte email.
- Reset password : le token de reset apparaissait dans le flash → un attaquant connaissant l'email Admin pouvait changer son mot de passe sans accéder à sa boîte email.
- En plus, le message de reset était différent selon que l'email existait ou non → permettait d'énumérer les comptes inscrits.

**Ce qui a changé :**
- Flash inscription : message neutre `"Compte créé. Un email de vérification vous a été envoyé."` — le token n'apparaît plus nulle part dans la réponse HTTP.
- Flash reset : message neutre identique quelle que soit l'existence de l'email `"Si ce compte existe, un email de réinitialisation a été envoyé."` — ferme aussi l'énumération d'utilisateurs.

---

### 4. `app.js` — Trust proxy corrigé

**Problème :** `app.set("trust proxy", true)` faisait confiance à n'importe quel header `X-Forwarded-For`, y compris ceux forgés par le client. Un attaquant changeait ce header à chaque requête de login pour réinitialiser son compteur de rate limiting → brute force illimité sur le compte Admin.

**Ce qui a changé :**
- `trust proxy: true` → `trust proxy: 1` : Express ne fait confiance qu'au premier proxy devant lui (le reverse proxy Railway), pas à ce que le client déclare lui-même.

---

### 5. `src/middlewares/rateLimit.js` — Rate limit login réduit

**Problème :** 15 tentatives par 15 minutes = 1 440 mots de passe testables par jour. Suffisant pour une attaque par dictionnaire sur un compte à mot de passe faible.

**Ce qui a changé :**
- `max: 15` → `max: 5` sur le `loginRateLimit`.
- Ajout d'un message d'erreur structuré `{ code: "TOO_MANY_ATTEMPTS", message: "..." }` renvoyé au client quand la limite est atteinte.

---

### 6. `src/middlewares/errorHandler.js` — Redaction + masquage erreurs prod

**Problème 1 :** Le `req.body` entier était loggé dans pino à chaque erreur HTTP. Si une erreur survenait pendant le login ou le reset password, le mot de passe en clair apparaissait dans les logs Railway.

**Problème 2 :** L'objet `err` complet (avec stack trace, chemins de fichiers, noms de modules) était passé au template EJS et aux réponses JSON — révélant la structure interne du code à quiconque provoquait une erreur.

**Ce qui a changé :**
- Ajout de la fonction `redactBody()` et d'une liste `SENSITIVE_FIELDS` : `password`, `passwordHash`, `token`, `secret`, `refreshToken`, `_csrf`, `authorization`, `emailVerificationToken`, `resetPasswordToken` → remplacés par `[REDACTED]` avant le log.
- L'objet `err` passé au logger ne contient plus que `{ message, code }` (plus de stack).
- En production, le template HTML et les réponses JSON reçoivent `{ message: "Une erreur interne s'est produite.", code }` au lieu de l'objet erreur complet.
- En développement, comportement inchangé — le détail complet reste visible.

---

### 7. `src/utils/logger.js` — Logs différenciés dev / prod

**Problème :** `pino-http` sans configuration loggait les headers HTTP complets de chaque requête, incluant le header `Cookie` contenant `accessToken`, `refreshToken` et `zando243.sid` en clair dans les logs Railway → session hijacking possible pour quiconque accède aux logs.

**Ce qui a changé :**
Même principe que la base de données (SQLite en dev, PostgreSQL en prod) appliqué aux logs :

- **Dev** : comportement inchangé — `pino-pretty` coloré, niveau `info`, tous les détails HTTP visibles, utile pour le debug.
- **Prod** :
  - Niveau `warn` par défaut (plus aucun log HTTP de routine, seulement warnings et erreurs).
  - Serializer minimal sur les requêtes : seuls `method`, `url`, `statusCode`, `responseTime` sont loggés.
  - `redact` sur `req.headers.cookie`, `req.headers.authorization`, `req.headers["set-cookie"]` → remplacés par `[REDACTED]` comme filet de sécurité.
- Le niveau peut être surchargé via la variable d'environnement `LOG_LEVEL` si besoin.

---

### 8. `src/services/emailService.js` — Email client retiré des logs

**Problème :** Les deux logs d'envoi de facture (SMTP non configuré et envoi réussi) incluaient `to: order.User?.email` → chaque commande passée générait un log avec l'adresse email du client en clair dans Railway.

**Ce qui a changé :**
- Champ `to` supprimé des deux appels `logger.info`. Le `orderNumber` seul suffit pour retrouver la commande et le client en base si besoin.

---

### 9. Documentation ajoutee

En plus des correctifs code, deux fichiers de documentation ont ete ajoutes pour garder une trace exploitable du travail realise :

- `SAST_REPORT.md`
  Conserve le rapport d'audit securite, avec la liste des failles trouvees, leur gravite, les fichiers concernes et les corrections recommandees.
- `FONCTIONNALITES.md`
  Documente les fonctionnalites metier de l'application, les routes, controllers, services et vues impliques, afin de faciliter la reprise du projet.

---

## Synthese rapide

### Ajoute
- Un controle strict des secrets en production.
- Une verification JWT plus stricte.
- Une redaction des donnees sensibles dans les logs.
- Une distinction claire entre logs de developpement et logs de production.
- Une documentation projet sur la securite (`SAST_REPORT.md`) et les fonctionnalites (`FONCTIONNALITES.md`).

### Retire
- Les tokens de verification et de reset affiches dans les messages flash.
- Les emails clients presents dans certains logs applicatifs.
- Les details complets d'erreur exposes au client en production.

### Modifie
- Le `trust proxy` Express pour limiter la confiance au proxy attendu.
- Le rate limit de connexion pour reduire le risque de brute force.
- Les messages utilisateur lies a l'inscription, au reset mot de passe et aux erreurs internes.

---

## 24/04/2026 — Phase 1 refactorisation progressive (tickets + profil/adresses)

### Contexte
Debut d'une refactorisation progressive orientee maintenabilite.
Objectif : rendre le code plus facile a comprendre et a modifier sans changer le comportement utilisateur, en suivant un workflow SDLC simple :

- comprendre le comportement existant ;
- ajouter des tests ;
- valider les tests ;
- refactoriser sans changer le rendu ni les routes ;
- relancer les tests ;
- documenter les changements.

---

### 1. Module `tickets support`

**Fichiers concernes :**
- `src/controllers/ticketController.js`
- `src/services/ticketService.js` (ajoute)
- `tests/tickets.test.js` (ajoute)

**Ce qui a change :**
- Extraction des acces Sequelize et de la logique metier tickets dans `src/services/ticketService.js`.
- `ticketController` est devenu une couche mince :
  - lecture de `req`
  - appel au service
  - `render` / `redirect`
- Ajout de tests de comportement pour verrouiller :
  - affichage des tickets de l'utilisateur connecte ;
  - creation d'un ticket ;
  - ajout d'un message sur son propre ticket ;
  - blocage d'acces a un ticket d'un autre utilisateur ;
  - blocage d'un visiteur non connecte selon le comportement actuel.

**Comportement confirme inchange :**
- routes identiques ;
- vues identiques ;
- messages et redirections inchanges.

---

### 2. Module `profil / adresses`

**Fichiers concernes :**
- `src/controllers/accountController.js`
- `src/services/accountService.js` (ajoute)
- `tests/account.test.js` (ajoute)

**Ce qui a change :**
- Extraction de la logique profil/adresses vers `src/services/accountService.js`.
- `accountController` est devenu une couche mince :
  - lecture de `req`
  - appel au service
  - `render` / `redirect`
  - gestion des flashes et des 404
- Ajout de tests pour verrouiller :
  - affichage de la page profil ;
  - affichage des informations utilisateur, adresses et notifications recentes ;
  - mise a jour du profil ;
  - creation d'adresse ;
  - mise a jour d'adresse ;
  - suppression d'adresse ;
  - blocage ou limitation sur les adresses d'un autre utilisateur selon le comportement actuel ;
  - blocage d'un visiteur non connecte.

**Comportement confirme inchange :**
- routes identiques ;
- vue `src/views/pages/account/profile.ejs` inchangee ;
- memes messages flash ;
- memes redirections ;
- meme comportement 404 sur une adresse non trouvable ;
- meme suppression silencieuse si un utilisateur tente de supprimer l'adresse d'un autre utilisateur (aucune suppression reelle, mais redirection et flash inchanges).

---

### 3. Tests et validation

**Tests ajoutes :**
- `tests/tickets.test.js`
- `tests/account.test.js`

**Commandes executees :**
- `node --test tests/tickets.test.js`
- `node --test tests/account.test.js`
- `npm test`

**Resultat :**
- Tous les tests passent apres refactorisation.
- Les tests existants (`smoke`) passent toujours.

---

### Synthese rapide de cette phase

### Ajoute
- Un service dedie pour les tickets : `src/services/ticketService.js`
- Un service dedie pour le profil/adresses : `src/services/accountService.js`
- Des tests de comportement pour les modules `tickets` et `account`

### Retire
- Les acces Sequelize directs dans `ticketController`
- Les acces Sequelize directs dans `accountController`

### Modifie
- Les controllers `tickets` et `account` pour respecter plus clairement :
  `route -> controller -> service -> models -> vue`

---

## 24/04/2026 — Phase 1 refactorisation progressive (admin logistique)

### Contexte
Continuation de la Phase 1 sur un module admin limite : la page logistique.
Objectif : verrouiller le comportement existant par tests, puis isoler la requete Sequelize dans un service dedie sans changer les routes, la vue ou la logique de commande.

---

### 1. Module `admin logistique`

**Fichiers concernes :**
- `src/controllers/adminController.js`
- `src/services/adminLogisticsService.js` (ajoute)
- `tests/admin-logistics.test.js` (ajoute)

**Comportement existant observe :**
- Route existante : `GET /admin/logistics`
- Protection existante : middleware admin global `requireAuth` puis `requireRole("ADMIN")`
- Vue rendue : `src/views/pages/admin/logistics.ejs`
- Donnees transmises : les 100 dernieres commandes, triees par `createdAt DESC`
- Aucun filtre existant sur cette page
- Aucune relation Sequelize incluse dans le comportement actuel
- Champs utilises par la vue : date, numero de commande, statut, tracking, reference de consolidation, frais douane

**Ce qui a change :**
- Ajout de `src/services/adminLogisticsService.js`
- Extraction de la requete :
  - avant : `models.Order.findAll(...)` directement dans `adminController.logisticsPage`
  - apres : `adminLogisticsService.listLogisticsOrders()`
- `adminController.logisticsPage` est maintenant une couche mince :
  - appel au service
  - `render("pages/admin/logistics", ...)`

**Comportement confirme inchange :**
- route identique ;
- vue EJS inchangee ;
- titre de page identique : `Module Logistique` ;
- tri identique : `createdAt DESC` ;
- limite identique : `100` ;
- aucune relation supplementaire ajoutee ;
- aucun changement sur checkout, paiement, PayPal, stock, facture, email, fidelite, changement de statut commande ou exports PDF/etiquettes.

---

### 2. Tests ajoutes

**Fichier ajoute :**
- `tests/admin-logistics.test.js`

**Cas couverts :**
- un admin connecte peut afficher la page logistique ;
- la page recoit toutes les commandes selon le comportement actuel, sans filtre par statut ;
- les donnees transmises correspondent aux champs reellement utilises par la vue ;
- les relations non utilisees par la vue ne sont pas chargees ;
- le tri par date descendante est respecte ;
- la limite de 100 commandes est respectee ;
- un non-admin est bloque avec le comportement actuel ;
- un visiteur non connecte est bloque avec le comportement actuel.

**Commandes executees :**
- `node --test tests/admin-logistics.test.js`
- `npm test`

**Resultat :**
- Le test cible logistique passe.
- La suite complete passe.
- Les warnings existants lies a l'ecriture d'audit log dans certaines bases SQLite de test restent presents sur les cas d'acces refuse, mais ne changent pas le resultat des tests.

---

### Synthese rapide de cette phase

### Ajoute
- Un service dedie pour la page logistique admin : `src/services/adminLogisticsService.js`
- Des tests de comportement pour `GET /admin/logistics`

### Retire
- L'acces Sequelize direct aux commandes dans `adminController.logisticsPage`

### Modifie
- `adminController.logisticsPage` suit maintenant le modele :
  `route -> controller -> service -> models -> vue`

---

## 24/04/2026 — Phase 1 refactorisation progressive (admin retours/remboursements)

### Contexte
Continuation de la Phase 1 sur la page admin retours/remboursements.
Objectif : verrouiller le comportement existant par tests, puis isoler la requete Sequelize dans un service dedie sans changer les routes, la vue ou les flux de commande/retour client.

---

### 1. Module `admin refunds / retours-remboursements`

**Fichiers concernes :**
- `src/controllers/adminController.js`
- `src/services/adminRefundService.js` (ajoute)
- `tests/admin-refunds.test.js` (ajoute)

**Comportement existant observe :**
- Route existante : `GET /admin/refunds`
- Protection existante : middleware admin global `requireAuth` puis `requireRole("ADMIN")`
- Vue rendue : `src/views/pages/admin/refunds.ejs`
- Donnees transmises : toutes les demandes de retour existantes
- Relation chargee : uniquement la commande associee (`Order`)
- Aucun filtre existant sur cette page
- Aucun tri explicite existant
- Aucune limite explicite existante
- Aucune action admin de traitement/remboursement existante sur cette route

**Ce qui a change :**
- Ajout de `src/services/adminRefundService.js`
- Extraction de la requete :
  - avant : `models.ReturnRequest.findAll({ include: [{ model: models.Order }] })` directement dans `adminController.refundsPage`
  - apres : `adminRefundService.listReturnRequests()`
- `adminController.refundsPage` est maintenant une couche mince :
  - appel au service
  - `render("pages/admin/refunds", ...)`

**Comportement confirme inchange :**
- route identique ;
- vue EJS inchangee ;
- titre de page identique : `Admin Retours/Remboursements` ;
- relation `Order` toujours incluse ;
- aucune relation supplementaire ajoutee ;
- aucun filtre, tri ou limite ajoute ;
- aucun changement sur checkout, paiement, PayPal, stock, facture, email, fidelite, creation de commande, statut commande ou demande client de retour.

---

### 2. Tests ajoutes

**Fichier ajoute :**
- `tests/admin-refunds.test.js`

**Cas couverts :**
- un admin connecte peut afficher la page retours/remboursements ;
- la page recoit toutes les demandes de retour selon le comportement actuel ;
- les query params eventuels sont ignores, car aucun filtre n'existe actuellement ;
- la relation commande necessaire a la vue est incluse ;
- les relations non utilisees par la vue ne sont pas chargees ;
- aucune limite supplementaire n'est appliquee ;
- un non-admin est bloque avec le comportement actuel ;
- un visiteur non connecte est bloque avec le comportement actuel.

**Commandes executees :**
- `node --test tests/admin-refunds.test.js`
- `npm test`

**Resultat :**
- Le test cible refunds passe.
- La suite complete passe.
- Les warnings existants lies a l'ecriture d'audit log dans certaines bases SQLite de test restent presents sur les cas d'acces refuse, mais ne changent pas le resultat des tests.

---

### Synthese rapide de cette phase

### Ajoute
- Un service dedie pour la page retours/remboursements admin : `src/services/adminRefundService.js`
- Des tests de comportement pour `GET /admin/refunds`

### Retire
- L'acces Sequelize direct aux demandes de retour dans `adminController.refundsPage`

### Modifie
- `adminController.refundsPage` suit maintenant le modele :
  `route -> controller -> service -> models -> vue`

---

## 24/04/2026 — Phase 1 refactorisation progressive (admin dashboard)

### Contexte
Continuation de la Phase 1 sur le dashboard admin.
Objectif : securiser le dashboard par des tests de comportement, sans changer les routes, la vue, les donnees envoyees, ni les calculs metier existants.

---

### 1. Module `admin dashboard`

**Fichiers concernes :**
- `src/controllers/adminController.js` (analyse, pas de modification necessaire)
- `src/services/adminService.js` (analyse, pas de modification necessaire)
- `tests/admin-dashboard.test.js` (ajoute)

**Comportement existant observe :**
- Route existante : `GET /admin`
- Protection existante : middleware admin global `requireAuth` puis `requireRole("ADMIN")`
- Vue rendue : `src/views/pages/admin/dashboard.ejs`
- Controller actuel : `adminController.dashboard`
- Service actuel : `getDashboardStats(req.query)` dans `src/services/adminService.js`
- Donnees envoyees a la vue :
  - `revenueTotal`
  - `weightDeliveryRevenue`
  - `orderCount`
  - `avgCart`
  - `usersCount`
  - `usersCountTotal`
  - `topProducts`
  - `topCategories`
  - `recentOrders`
  - `progression`
  - `filters`
- Filtres existants : `startDate`, `endDate`
- Les commandes recentes sont filtrees par periode, triees par date descendante via la requete initiale, puis limitees a 8 apres filtrage.
- Les series de progression suivent la periode demandee.

**Refactorisation :**
- Aucune refactorisation code n'a ete faite.
- Justification : `adminController.dashboard` est deja mince et delegue correctement a `adminService`.
- `adminService` contient deja la logique dashboard centrale ; les tests ajoutés verrouillent son comportement observable sans changer ses resultats.

**Comportement confirme inchange :**
- route identique ;
- vue EJS inchangee ;
- titre de page identique : `Admin Dashboard` ;
- noms des donnees envoyees a la vue inchanges ;
- calculs actuels inchanges ;
- aucun changement sur checkout, paiement, PayPal, stock, facture, email, fidelite, commandes, produits, utilisateurs ou statut commande.

---

### 2. Tests ajoutes

**Fichier ajoute :**
- `tests/admin-dashboard.test.js`

**Cas couverts :**
- un admin connecte peut afficher le dashboard ;
- la vue recoit les statistiques attendues selon le comportement actuel ;
- les revenus, commandes, panier moyen, frais poids et clients sont calcules selon le comportement actuel ;
- la vue recoit les top produits, top categories et donnees de progression existants ;
- les commandes recentes respectent le filtre, le tri actuel et le calcul des frais poids ;
- le dashboard fonctionne avec une base sans commandes, produits ni clients ;
- un non-admin est bloque avec le comportement actuel ;
- un visiteur non connecte est bloque avec le comportement actuel.

**Commandes executees :**
- `node --test tests/admin-dashboard.test.js`
- `npm test`

**Resultat :**
- Le test cible dashboard passe.
- La suite complete passe.
- Les warnings existants lies a l'ecriture d'audit log dans certaines bases SQLite de test restent presents sur les cas d'acces refuse, mais ne changent pas le resultat des tests.

---

### Synthese rapide de cette phase

### Ajoute
- Des tests de comportement pour `GET /admin`

### Retire
- Rien

### Modifie
- Aucun code applicatif dashboard.
- Documentation de suivi dans `update.md`.

---

## 25/04/2026 — SAST V2 : audit approfondi + correctifs sécurité + corrections bugs fonctionnels

### Contexte

Deuxième audit SAST manuel, plus profond que celui du 29/03/2026. L'objectif était de couvrir les vecteurs non traités la première fois : IDOR sur les factures, mass assignment, race condition coupons, forgery webhook PayPal, CORS trop permissif, injection LIKE, et durée de session trop longue. Un rapport complet a été produit (`SAST_REPORT_V2.md`) ainsi qu'un PDF résumé (`storage/SAST_REPORT_V2.pdf`). Les correctifs ont ensuite été appliqués. Un audit fonctionnel complet de l'application a suivi, révélant 8 bugs indépendants, tous corrigés dans la foulée.

---

### Correctifs sécurité (SAST V2)

#### 1. `app.js` — CORS whitelist stricte

**Problème :** `cors({ origin: true, credentials: true })` autorisait n'importe quelle origine avec cookies — permettant à un site malveillant de faire des requêtes authentifiées depuis le navigateur de la victime.

**Ce qui a changé :**
- L'origine est maintenant vérifiée contre une liste blanche lue depuis `process.env.ALLOWED_ORIGINS` (ou `env.appUrl` en fallback).
- Toute origine absente de cette liste reçoit une erreur CORS.

---

#### 2. `app.js` — Durée de session réduite

**Problème :** La session `express-session` durait 7 jours. En cas de vol de cookie de session (XSS résiduel ou log), la fenêtre d'exploitation était très large.

**Ce qui a changé :**
- `maxAge` réduit de 7 jours à 4 heures.

---

#### 3. `app.js` + `src/routes/orderRoutes.js` + `src/controllers/orderController.js` — IDOR factures corrigé

**Problème :** `/invoices` était servi comme dossier statique sans aucune authentification. N'importe qui connaissant le numéro de commande pouvait télécharger la facture PDF de n'importe quel client.

**Ce qui a changé :**
- La route statique `/invoices` a été supprimée.
- Une nouvelle route authentifiée `GET /orders/:id/invoice` a été ajoutée. Elle vérifie que la commande appartient bien à l'utilisateur connecté avant de servir le fichier.

---

#### 4. `src/services/paypalService.js` — Validation domaine cert_url webhook

**Problème :** La vérification des webhooks PayPal transmettait le champ `cert_url` fourni par le corps de la requête directement à l'API PayPal, sans valider que ce domaine appartenait réellement à PayPal. Un attaquant pouvait pointer vers son propre serveur de certificats.

**Ce qui a changé :**
- Ajout d'une fonction `isValidPaypalCertUrl()` qui vérifie que le protocole est `https` et que le hostname appartient à `api.paypal.com`, `api-m.paypal.com` ou `www.paypalobjects.com`.
- Tout `cert_url` hors de ces domaines lève une erreur avant tout appel réseau.

---

#### 5. `src/controllers/paymentController.js` — Vérification cohérence orderId PayPal

**Problème :** Un client pouvait passer `paypalOrderId` d'une commande d'un autre client pour capturer un paiement sur la mauvaise commande (payment bypass).

**Ce qui a changé :**
- Lors de la capture SDK, si la commande a déjà un `paymentReference`, il doit correspondre au `paypalOrderId` reçu. Toute incohérence retourne `PAYPAL_ORDER_MISMATCH`.

---

#### 6. `src/services/accountService.js` — Mass assignment profil et adresses

**Problème :** `updateUserProfile` et les fonctions d'adresse utilisaient `...payload` ou `...req.body` directement dans les `create`/`update` Sequelize, permettant à un client de modifier des champs internes (`role`, `loyaltyPoints`, etc.).

**Ce qui a changé :**
- `updateUserProfile` : `avatarUrl` est validée avec `parseHttpsUrl()` (rejette les URLs non-https).
- `createUserAddress` et `updateUserAddress` : remplacement du spread par une whitelist explicite (`label`, `number`, `street`, `neighborhood`, `municipality`, `city`, `country`, `isDefault`).

---

#### 7. `src/controllers/adminController.js` — Mass assignment produits

**Problème :** `createProduct` et `updateProduct` utilisaient `...req.body`, permettant à un admin de modifier des champs non exposés dans le formulaire (`popularityScore`, `slug`…).

**Ce qui a changé :**
- Ajout de `pickProductFields()` : whitelist explicite des champs autorisés.
- Les URLs d'images sont validées avec `parseHttpsUrl()`.

---

#### 8. `src/services/auditLogService.js` — Injection LIKE dans les filtres logs

**Problème :** Les filtres `actorEmail` et `q` de la page logs admin utilisaient les valeurs brutes dans des clauses `LIKE`, permettant d'injecter `%` et `_` pour des recherches non prévues.

**Ce qui a changé :**
- Ajout de `escapeLike()` qui échappe `\`, `%` et `_` avant toute clause `LIKE`.

---

### Corrections bugs fonctionnels (audit complet)

#### Bug 1 — `src/services/orderService.js` : logique retour client inversée

**Problème :** La fonction `requestReturn` lançait une erreur quand le statut était `"Delivered"` — exactement l'inverse du comportement attendu (un retour n'est possible que sur une commande livrée).

**Correction :** La condition a été inversée : l'erreur est maintenant levée quand le statut est différent de `"Delivered"`.

---

#### Bug 2 — `src/services/orderService.js` : unicité du numéro de commande non garantie

**Problème :** `generateOrderNumber()` était synchrone et sans vérification en base. En cas de collision (deux commandes simultanées avec le même nombre aléatoire), Sequelize levait une erreur de contrainte unique.

**Correction :** Remplacement par `generateUniqueOrderNumber(transaction)`, fonction asynchrone avec boucle de retry (jusqu'à 10 tentatives), sur le même modèle que `generateUniqueTrackingNumber`.

---

#### Bug 3 — `src/services/promoService.js` + `src/services/orderService.js` : race condition coupons

**Problème :** `validateCoupon` était appelé avant la transaction. Deux requêtes simultanées pouvaient toutes les deux passer la vérification `usageCount < usageLimit` avant qu'aucune ne l'incrémente, permettant de dépasser la limite.

**Correction :**
- `validateCoupon` accepte désormais un paramètre `transaction`. Quand il est fourni, la lecture du coupon se fait avec `lock: transaction.LOCK.UPDATE` (verrou de ligne).
- Dans `createOrderFromCart`, l'appel à `validateCoupon` a été déplacé à l'intérieur du bloc `sequelize.transaction`, garantissant l'atomicité.

---

#### Bug 4 — `src/services/cartService.js` : `shippingFee` toujours zéro (code mort)

**Problème :** `const shippingFee = items.length ? 0 : 0;` — les deux branches retournaient `0`, le ternaire n'avait aucun effet.

**Correction :** Simplifié en `const shippingFee = 0;`.

---

#### Bug 5 — `src/services/adminService.js` : `findAll` sans limite (risque mémoire)

**Problème :** Le dashboard admin chargeait toutes les commandes et tous les clients sans aucune limite, ce qui pouvait saturer la mémoire sur un gros volume.

**Correction :** Ajout de `limit: 10000` sur les deux requêtes `findAll`.

---

#### Bug 6 — `src/services/adminService.js` : `topProducts` et `topCategories` sans noms

**Problème :** Les requêtes `topProducts` et `topCategories` ne chargeaient pas les modèles associés (`Product`, `Category`), donc la vue ne pouvait pas afficher les noms de produit ni de catégorie.

**Correction :** Après les requêtes groupées, enrichissement via deux lookups séparés (`productMap`, `categoryMap`) qui injectent `product` et `category` dans chaque résultat.

---

#### Bug 7 — `src/services/adminLogisticsService.js` : données User et items manquantes

**Problème :** La requête ne chargeait aucune relation. Les informations client et les articles de commande étaient absentes des données transmises à la vue.

**Correction :** Ajout de `include: [{ model: models.User }, { model: models.OrderItem, as: "items" }]`.

---

#### Bug 8 — `src/services/adminRefundService.js` : User absent des retours

**Problème :** `listReturnRequests` incluait la commande mais pas le client associé, rendant impossible l'affichage du nom ou de l'email du demandeur.

**Correction :** Ajout d'un `include` imbriqué `User` à l'intérieur de `Order`.

---

#### Fix cosmétique — `src/controllers/adminController.js` : paramètre `_req` utilisé

**Problème :** Quatre handlers déclaraient leur paramètre `_req` (convention "non utilisé") mais l'utilisaient effectivement via `_req.query`.

**Correction :** Renommés en `req` pour les handlers `dashboard`, `stats`, `productsPage` et `ordersPage`.

---

### Documentation produite

- `SAST_REPORT_V2.md` : rapport SAST complet V2 avec 3 nouvelles failles critiques et 9 persistantes.
- `storage/SAST_REPORT_V2.pdf` : résumé PDF 4 pages, code couleur par sévérité.

---

#### Fix post-déploiement — `app.js` : erreur 500 sur CORS

**Problème :** Le callback CORS appelait `cb(new Error("CORS: origine non autorisée"))` quand l'origine n'était pas dans la liste blanche. Express interprétait cette erreur comme une erreur serveur et retournait un 500 — visible au login et à l'inscription car le navigateur envoie un header `Origin` sur les POST de formulaire.

**Correction :** Remplacement par `cb(null, false)`. La requête continue normalement (le middleware CORS ne bloque pas la requête côté serveur, seul le navigateur peut bloquer une réponse cross-origin si les headers CORS sont absents), sans déclencher le gestionnaire d'erreur Express.

---

### Synthese rapide

### Ajoute
- Route authentifiée `GET /orders/:id/invoice` pour le téléchargement sécurisé des factures.
- Validation domaine `cert_url` sur les webhooks PayPal.
- Whitelists explicites pour les champs produits et adresses.
- Numéro de commande unique garanti par boucle de retry.
- Race condition coupons éliminée par verrou de ligne dans la transaction.
- Enrichissement `topProducts` / `topCategories` avec noms produit/catégorie.
- Includes `User` et `items` dans la logistique et les retours admin.
- Rapport `SAST_REPORT_V2.md` et PDF associé.

### Retire
- Route statique `/invoices` non authentifiée (IDOR).
- CORS `origin: true` (toute origine acceptée).
- `validateCoupon` appelé hors transaction (race condition).
- `generateOrderNumber` synchrone sans vérification unicité.

### Modifie
- Session réduite de 7 jours à 4 heures.
- CORS restreint à la liste blanche `ALLOWED_ORIGINS`.
- Logique retour corrigée (autorisé uniquement si `Delivered`).
- Dashboard limité à 10 000 enregistrements max.
- Paramètre `_req` renommé `req` là où il est réellement utilisé.

---

## 25/04/2026 — Phase 1 refactorisation progressive (SEO sitemap / robots)

### Contexte
Continuation de la Phase 1 sur les endpoints SEO publics.
Objectif : verrouiller le comportement observable de `sitemap.xml` et `robots.txt`, puis isoler la generation XML/TXT dans un service dedie sans changer les routes ni le contenu produit.

---

### 1. Module `SEO sitemap / robots`

**Fichiers concernes :**
- `src/controllers/publicController.js`
- `src/services/seoService.js` (ajoute)
- `tests/seo.test.js` (ajoute)

**Comportement existant observe :**
- Route existante : `GET /sitemap.xml`
- Route existante : `GET /robots.txt`
- `sitemap.xml` repond en `application/xml`
- `robots.txt` repond en `text/plain`
- Le sitemap contient :
  - `/`
  - `/products`
  - toutes les categories retournees par `catalogService.listCategories()`
  - les produits retournes par `catalogService.listProducts({ limit: 200, page: 1 })`
- Les produits du sitemap suivent donc la logique catalogue actuelle : produits `ACTIVE` uniquement.
- `robots.txt` contient le texte fixe actuel :
  - `User-agent: *`
  - `Allow: /`
  - `Sitemap: /sitemap.xml`

**Ce qui a change :**
- Ajout de `src/services/seoService.js`
- Extraction de la generation :
  - `generateSitemapXml(appUrl)`
  - `generateRobotsTxt()`
- `publicController.sitemap` est maintenant une couche mince :
  - appel au service
  - `res.type("application/xml")`
  - `send`
- `publicController.robots` est maintenant une couche mince :
  - appel au service
  - `res.type("text/plain")`
  - `send`

**Comportement confirme inchange :**
- routes identiques ;
- content-types identiques ;
- XML sitemap identique ;
- texte robots identique ;
- logique produits/categories identique ;
- aucun changement sur checkout, commandes, paiement, PayPal, stock, facture, email, fidelite ou admin.

---

### 2. Tests ajoutes

**Fichier ajoute :**
- `tests/seo.test.js`

**Cas couverts :**
- `GET /sitemap.xml` repond avec statut 200 selon le comportement actuel ;
- `GET /sitemap.xml` definit le type `application/xml` ;
- le sitemap contient les URLs publiques de base ;
- le sitemap inclut les categories ;
- le sitemap inclut les produits actifs selon la logique catalogue actuelle ;
- le sitemap exclut un produit non actif selon la logique actuelle ;
- le sitemap sans produit/categorie garde uniquement `/` et `/products` ;
- `GET /robots.txt` repond avec statut 200 selon le comportement actuel ;
- `GET /robots.txt` definit le type `text/plain` ;
- `robots.txt` contient les directives actuelles, dont `Sitemap: /sitemap.xml`.

**Commandes executees :**
- `node --test tests/seo.test.js`
- `npm test`

**Resultat :**
- Le test cible SEO passe.
- La suite complete passe.
- Les warnings existants lies a l'ecriture d'audit log dans certaines bases SQLite de test restent presents sur les cas d'acces refuse admin, mais ne changent pas le resultat des tests.

---

### Synthese rapide de cette phase

### Ajoute
- Un service dedie pour la generation SEO : `src/services/seoService.js`
- Des tests de comportement pour `GET /sitemap.xml` et `GET /robots.txt`

### Retire
- La generation directe XML/TXT depuis `publicController`

### Modifie
- `publicController.sitemap` et `publicController.robots` suivent maintenant le modele :
  `route -> controller -> service -> models/catalogue -> reponse XML/TXT`

---

## Phase 2A - Decoupage physique du controleur admin

### Objectif

Decouper `src/controllers/adminController.js` en sous-controllers admin pour les blocs deja couverts par tests, sans changer les routes, les vues, les services metier ni le comportement.

### Fichiers crees

- `src/controllers/admin/dashboardController.js`
- `src/controllers/admin/categoryController.js`
- `src/controllers/admin/couponController.js`
- `src/controllers/admin/reviewController.js`
- `src/controllers/admin/userController.js`
- `src/controllers/admin/logController.js`
- `src/controllers/admin/logisticsController.js`
- `src/controllers/admin/refundController.js`

### Fichiers modifies

- `src/controllers/adminController.js`
- `update.md`

### Fonctions deplacees

- `dashboard`
- `stats`
- `categoriesPage`
- `createCategory`
- `updateCategory`
- `deleteCategory`
- `couponsPage`
- `createCoupon`
- `reviewsPage`
- `moderateReview`
- `usersPage`
- `toggleUserBlock`
- `logsPage`
- `logisticsPage`
- `refundsPage`

### Fonctions laissees dans `adminController.js`

- `productValidators`
- `categoryValidators`
- `couponValidators`
- `productsPage`
- `createProduct`
- `updateProduct`
- `deleteProduct`
- `addProductImage`
- `updateProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- `ordersPage`
- `orderDetailPage`
- `orderRawPdf`
- `orderShippingLabelPdf`
- `updateOrder`

### Comportement confirme inchange

- `src/routes/adminRoutes.js` est reste inchange.
- Les noms des handlers exportes par `adminController` sont conserves.
- Les vues EJS sont restees inchangees.
- Les services existants sont restes inchanges.
- Aucun changement fonctionnel sur products, orders, checkout, paiement, PayPal, stock, factures, emails ou fidelite.

### Commandes executees

- `node --test tests/admin-dashboard.test.js`
- `node --test tests/admin-categories.test.js`
- `node --test tests/admin-coupons.test.js`
- `node --test tests/admin-reviews.test.js`
- `node --test tests/admin-users.test.js`
- `node --test tests/admin-logs.test.js`
- `node --test tests/admin-logistics.test.js`
- `node --test tests/admin-refunds.test.js`
- `npm test`

### Resultat

- Tous les tests admin cibles passent.
- La suite complete passe : 13 fichiers de test, 13 passes, 0 fail.
- Les warnings existants d'audit log sur tables absentes dans certaines bases SQLite de test restent presents, sans echec de test et sans lien avec le decoupage Phase 2A.

### Risques restants

- `adminController.js` contient encore les blocs products et orders, volontairement exclus de cette phase.
- Les validators categories/coupons restent exportes depuis `adminController.js` pour conserver exactement l'interface attendue par `adminRoutes.js`.

### Prochaine etape conseillee

Phase 2B : traiter un bloc restant a la fois, probablement admin products, avec le meme cadre :
routes inchangees -> tests existants/ajoutes -> extraction physique controleur/service si necessaire -> tests complets.

---

## Phase 2B - Admin ordersPage uniquement

### Objectif

Securiser et refactoriser uniquement `GET /admin/orders`, sans toucher au detail commande, au changement de statut, aux exports PDF, aux etiquettes d'expedition, au paiement, au stock, au checkout ou a `orderService`.

### Comportement actuel observe

- Route exacte : `GET /admin/orders`
- Handler exporte conserve : `ordersPage`
- Vue rendue : `pages/admin/orders`
- Titre envoye : `Admin Commandes`
- Query params lus :
  - `q`
  - `status`
  - `startDate`
  - `endDate`
- Recherche actuelle :
  - `User.firstName LIKE %q%`
  - `User.lastName LIKE %q%`
  - `User.email LIKE %q%`
  - pas de recherche par `orderNumber`
- Filtre statut actuel :
  - egalite exacte sur `Order.status`
- Filtres dates actuels :
  - les valeurs sont conservees dans `filters`
  - le filtrage date n'est pas applique actuellement, a cause du controle `Object.keys(range)` sur des cles Sequelize `Op.*` symboliques
  - ce comportement imparfait a ete verrouille sans correction dans cette phase
- Tri actuel :
  - `createdAt DESC`
- Limite actuelle :
  - 100 commandes
- Relations incluses :
  - `User`
  - `OrderItem` avec alias `items`
- Donnees envoyees a la vue :
  - `title`
  - `orders`
  - `filters: { q, status, startDate, endDate }`

### Tests ajoutes

**Fichier ajoute :**
- `tests/admin-orders.test.js`

**Cas couverts :**
- un admin connecte peut afficher la liste des commandes ;
- la vue recoit les commandes existantes ;
- le tri `createdAt DESC` est respecte ;
- `User` et `items` sont inclus car utilises par la vue ;
- recherche par email client ;
- absence de recherche par `orderNumber` selon le comportement actuel ;
- filtre statut ;
- filtres dates conserves mais non appliques selon le comportement actuel ;
- limite de 100 commandes ;
- non-admin bloque en 403 ;
- visiteur non connecte bloque en 401.

### Fichiers crees

- `src/services/adminOrderService.js`
- `src/controllers/admin/orderController.js`
- `tests/admin-orders.test.js`

### Fichiers modifies

- `src/controllers/adminController.js`
- `update.md`

### Logique deplacee

- Construction des filtres `q`, `status`, `startDate`, `endDate`
- Construction du `where` commandes
- Construction de l'include `User`
- Requete `Order.findAll`
- Tri `createdAt DESC`
- Limite `100`

La logique est maintenant dans `adminOrderService.listOrders(query)`.

### Controleur apres refactor

`ordersPage` est maintenant dans `src/controllers/admin/orderController.js` et reste mince :

- lecture de `req.query`
- appel a `adminOrderService.listOrders(req.query)`
- render de `pages/admin/orders`

`adminController.js` reste l'agregateur central et reexporte toujours `ordersPage`.

### Fonctions non touchees

- `orderDetailPage`
- `updateOrder`
- `orderRawPdf`
- `orderShippingLabelPdf`
- `orderService`
- checkout
- paiement
- PayPal
- stock
- factures
- emails
- fidelite

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-orders.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-orders.test.js`
- `npm test`

### Resultat

- Test cible admin orders : passe.
- Suite complete : passe, 14 fichiers de test, 14 passes, 0 fail.
- Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents, sans lien avec cette phase.

### Risques restants

- Le filtre date de `GET /admin/orders` est actuellement non effectif. Il est documente et verrouille comme comportement existant, mais il devra etre corrige uniquement dans une tache produit/securisation separee si decision explicite.
- `adminController.js` contient encore admin products et les handlers detail/statut/export commandes, volontairement exclus de cette phase.

### Prochaine etape conseillee

Phase 2C : traiter soit `admin products` avec tests dedies avant extraction, soit `orderDetailPage` seul si l'objectif est de continuer sur les commandes sans toucher au statut/PDF/etiquette.

---

## Phase 2C-1 - Admin productsPage uniquement

### Objectif

Securiser et refactoriser uniquement `GET /admin/products`, sans toucher a la creation, modification, suppression, images, variantes, stock, commandes, paiement ou checkout.

### Comportement actuel observe

- Route exacte : `GET /admin/products`
- Handler exporte conserve : `productsPage`
- Vue rendue : `pages/admin/products`
- Titre envoye : `Admin Produits`
- Query params lus :
  - `q`
  - `categoryId`
  - `stockLte`
- Recherche actuelle :
  - `Product.name LIKE %q%`
  - `Product.sku LIKE %q%`
  - `Product.brand LIKE %q%`
  - pas de recherche par `slug`
  - pas de recherche par `description`
- Filtre categorie actuel :
  - egalite exacte sur `Product.categoryId`
- Filtre stock actuel :
  - `Product.stock <= stockLte` si `stockLte` est numerique
- Parametre `status` :
  - ignore actuellement par la liste admin produits
- Tri actuel :
  - `createdAt DESC`
- Limite actuelle :
  - 200 produits
- Relations incluses :
  - `Category`
  - `ProductImage` avec alias `images`
  - `ProductVariant` avec alias `variants`
- Categories envoyees a la vue :
  - toutes les categories, triees par `name ASC`
- Donnees envoyees a la vue :
  - `title`
  - `products`
  - `categories`
  - `filters: { q, categoryId, stockLte }`

### Tests ajoutes

**Fichier ajoute :**
- `tests/admin-products.test.js`

**Cas couverts :**
- un admin connecte peut afficher la liste admin des produits ;
- la vue recoit les produits existants ;
- la vue recoit les categories triees par nom ;
- le tri `createdAt DESC` est respecte ;
- `Category`, `images` et `variants` sont inclus car utilises par la vue ;
- recherche par nom, SKU ou marque ;
- absence de recherche par slug ou description selon le comportement actuel ;
- filtre categorie ;
- filtre `stockLte` ;
- parametre `status` ignore selon le comportement actuel ;
- limite de 200 produits ;
- non-admin bloque en 403 ;
- visiteur non connecte bloque en 401.

### Fichiers crees

- `src/services/adminProductService.js`
- `src/controllers/admin/productController.js`
- `tests/admin-products.test.js`

### Fichiers modifies

- `src/controllers/adminController.js`
- `update.md`

### Logique deplacee

- Construction des filtres `q`, `categoryId`, `stockLte`
- Construction du `where` produits
- Requete `Product.findAll`
- Includes `Category`, `images`, `variants`
- Tri `createdAt DESC`
- Limite `200`
- Requete `Category.findAll({ order: [["name", "ASC"]] })`

La logique est maintenant dans `adminProductService.listProducts(query)`.

### Controleur apres refactor

`productsPage` est maintenant dans `src/controllers/admin/productController.js` et reste mince :

- lecture de `req.query`
- appel a `adminProductService.listProducts(req.query)`
- render de `pages/admin/products`

`adminController.js` reste l'agregateur central et reexporte toujours `productsPage`.

### Fonctions non touchees

- `createProduct`
- `updateProduct`
- `deleteProduct`
- `addProductImage`
- `updateProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- stock metier
- commandes
- checkout
- paiement
- PayPal
- factures
- emails
- fidelite

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe, 15 fichiers de test, 15 passes, 0 fail.
- Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents, sans lien avec cette phase.

### Risques restants

- `adminController.js` contient encore les handlers produits de mutation : create/update/delete/images/variantes, volontairement exclus de cette phase.
- Le formulaire affiche une option `DRAFT`, tandis que `pickProductFields` whitelist actuellement `ACTIVE`, `INACTIVE`, `ARCHIVED`. Ce point existait deja et n'a pas ete modifie.
- La liste produits ne filtre pas par statut et ne recherche pas par slug/description ; ce comportement existant est verrouille sans correction.

### Prochaine etape conseillee

Phase 2C-2 : traiter un seul sous-bloc produit de mutation, par exemple `createProduct`, avec tests dedies avant extraction. Ne pas melanger create/update/delete/images/variantes dans une meme etape.

---

## Phase 2C-2 - Admin createProduct uniquement

### Objectif

Securiser et refactoriser uniquement `POST /admin/products`, sans toucher a `productsPage`, `updateProduct`, `deleteProduct`, images existantes, variantes, stock, commandes, paiement ou checkout.

### Comportement actuel observe

- Route exacte : `POST /admin/products`
- Handler exporte conserve : `createProduct`
- Route avec validateurs existants :
  - `...ctrl.productValidators`
  - `ctrl.createProduct`
- Champs utilises actuellement depuis `req.body` via whitelist :
  - `name`
  - `description`
  - `brand`
  - `sku`
  - `categoryId`
  - `priceWithoutDelivery`
  - `purchasePrice`
  - `weightKg`
  - `stock`
  - `status`
  - `salePrice`
  - `discountPercent`
  - `keywords`
  - `imageUrl`
- Slug :
  - genere avec `toSlug(req.body.name)`
- Keywords :
  - split sur virgule
  - trim
  - valeurs vides filtrees
- Image de creation :
  - si `imageUrl` est une URL `https://`, creation d'une `ProductImage` principale `isMain: true`, `position: 0`
  - si `imageUrl` est vide ou invalide, pas d'image creee
- Redirection :
  - `res.redirect("/admin/products")`
- Audit :
  - `ADMIN_PRODUCT_CREATE`
  - categorie `PRODUCT`
  - meta `{ productId, sku }`

### Tests ajoutes

**Fichier modifie :**
- `tests/admin-products.test.js`

**Cas ajoutes :**
- un admin peut creer un produit avec les champs requis ;
- `categoryId` est persiste ;
- le slug est genere selon le comportement actuel ;
- les keywords sont transformes selon le comportement actuel ;
- `imageUrl` HTTPS cree une image principale ;
- la creation ecrit un audit log produit ;
- les champs non autorises ne sont pas injectes :
  - `id`
  - `avgRating`
  - `countReviews`
  - `popularityScore`
  - `finalPrice`
- non-admin bloque en 403 sur creation ;
- visiteur non connecte bloque en 401 sur creation.

### Fichiers modifies

- `src/services/adminProductService.js`
- `src/controllers/admin/productController.js`
- `src/controllers/adminController.js`
- `tests/admin-products.test.js`
- `update.md`

### Correction anti mass assignment

Aucune nouvelle correction fonctionnelle n'a ete necessaire : le code actuel utilisait deja une whitelist pour `createProduct`.

La whitelist a ete conservee pendant le deplacement vers `adminProductService.createProductFromAdmin(payload)`.

Les tests confirment que `id`, `avgRating`, `countReviews`, `popularityScore` et `finalPrice` ne sont pas injectables depuis `req.body`.

### Logique deplacee

De `adminController.js` vers `adminProductService.createProductFromAdmin(payload)` :

- whitelist des champs produit autorises ;
- creation `Product.create(...)` ;
- generation du slug ;
- transformation des keywords ;
- validation simple `https://` de `imageUrl` ;
- creation de l'image principale si applicable.

### Controleur apres refactor

`createProduct` est maintenant dans `src/controllers/admin/productController.js` :

- lecture de `req.body` ;
- appel a `adminProductService.createProductFromAdmin(req.body)` ;
- audit log `ADMIN_PRODUCT_CREATE` ;
- redirect `/admin/products`.

`adminController.js` reste l'agregateur central et reexporte toujours `createProduct`.

### Fonctions non touchees

- `productsPage`
- `updateProduct`
- `deleteProduct`
- `addProductImage`
- `updateProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- stock metier
- commandes
- checkout
- paiement
- PayPal
- factures
- emails
- fidelite

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe, 15 fichiers de test, 15 passes, 0 fail.
- Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents sur les tests de blocage, sans lien avec cette phase.

### Risques restants

- `updateProduct` conserve encore sa logique dans `adminController.js`.
- `deleteProduct`, images et variantes restent dans `adminController.js`, volontairement exclus de cette phase.
- Le statut `DRAFT` affiche par la vue reste non whiteliste par la logique produit actuelle ; ce comportement existait deja et n'a pas ete modifie.

### Prochaine etape conseillee

Phase 2C-3 : traiter `updateProduct` seul, avec tests dedies avant extraction, notamment autour de la whitelist, du slug, des keywords, de l'audit et du redirect.

---

## Phase 2C-3 - Admin produits : updateProduct

### Perimetre

- Module cible : modification admin d'un produit.
- Route concernee : `POST /admin/products/:id`.
- Handler conserve : `updateProduct`.
- Routes non modifiees.
- Vues EJS non modifiees.
- Aucun changement sur :
  - `productsPage`
  - `createProduct`
  - `deleteProduct`
  - images produit
  - variantes produit
  - stock metier
  - commandes
  - checkout
  - paiement
  - PayPal
  - factures
  - emails
  - fidelite

### Comportement observe et verrouille

- Le handler cherche le produit avec `Product.findByPk(req.params.id)`.
- Si le produit n'existe pas :
  - statut `404`
  - rendu `pages/errors/404`
  - titre `Produit introuvable`
- Si le produit existe :
  - mise a jour des champs produit autorises ;
  - slug regenere avec `toSlug(req.body.name || product.name)` ;
  - keywords transformes par split virgule, trim, valeurs vides filtrees ;
  - redirect vers `/admin/products` ;
  - audit log `ADMIN_PRODUCT_UPDATE` en categorie `PRODUCT`.

### Champs autorises conserves

La whitelist existante a ete conservee via `pickProductFields` :

- `name`
- `description`
- `brand`
- `sku`
- `categoryId`
- `priceWithoutDelivery`
- `purchasePrice`
- `weightKg`
- `stock`
- `status`
- `salePrice`
- `discountPercent`

Les champs sensibles/calcules ne sont pas injectables depuis `req.body` :

- `id`
- `avgRating`
- `countReviews`
- `popularityScore`
- `finalPrice`
- `createdAt`
- `updatedAt`

### Tests ajoutes

**Fichier modifie :**
- `tests/admin-products.test.js`

**Cas ajoutes :**
- un admin peut modifier un produit existant avec les champs autorises ;
- le slug est regenere quand le nom change ;
- si le nom reste identique, le slug reste genere depuis ce nom ;
- les keywords sont transformes selon le comportement actuel ;
- `categoryId` est persiste ;
- les champs produit autorises sont persistants ;
- un produit inexistant rend le comportement 404 actuel ;
- la modification ecrit un audit log produit ;
- les champs non autorises ne sont pas injectes ;
- non-admin bloque en `403` sur modification ;
- visiteur non connecte bloque en `401` sur modification.

### Point de comportement important

Les tests ont confirme un comportement actuel a conserver pour cette phase :

- `finalPrice` ne se recalcule pas automatiquement lors de `updateProduct`, meme si `priceWithoutDelivery` ou `weightKg` changent.

Ce point a ete verrouille tel quel pour eviter un changement fonctionnel non decide dans cette phase.

### Fichiers modifies

- `src/services/adminProductService.js`
- `src/controllers/admin/productController.js`
- `src/controllers/adminController.js`
- `tests/admin-products.test.js`
- `update.md`

### Refactorisation effectuee

La logique de modification produit a ete deplacee de `adminController.js` vers :

- `adminProductService.updateProductFromAdmin(productId, payload)`

La fonction service gere maintenant :

- recherche du produit ;
- retour `null` si introuvable ;
- whitelist des champs modifiables ;
- regeneration du slug ;
- transformation des keywords ;
- sauvegarde du produit.

Le controller `updateProduct` est maintenant dans `src/controllers/admin/productController.js` et reste mince :

- lecture de `req.params.id` ;
- lecture de `req.body` ;
- appel a `adminProductService.updateProductFromAdmin(...)` ;
- rendu 404 si introuvable ;
- audit log `ADMIN_PRODUCT_UPDATE` ;
- redirect `/admin/products`.

`adminController.js` reste l'agregateur central et reexporte toujours `updateProduct` via `productController`.

### Correction anti mass assignment

Aucune nouvelle correction fonctionnelle n'a ete necessaire : la whitelist produit etait deja presente au moment de cette phase.

Elle a ete conservee et couverte par des tests supplementaires sur `updateProduct`.

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe.
- `npm test` : 15 fichiers de test, 15 passes, 0 fail.

Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents sur les tests de blocage, sans lien avec cette phase.

### Risques restants

- Le non-recalcul actuel de `finalPrice` sur modification produit reste un risque metier possible, mais il n'a pas ete corrige pour respecter le perimetre sans changement de comportement.
- `deleteProduct`, images et variantes restent dans `adminController.js`, volontairement exclus de cette phase.
- Le statut `DRAFT` affiche par la vue reste non whiteliste par la logique produit actuelle ; comportement deja existant.

### Prochaine etape conseillee

Phase 2C-4 : traiter `deleteProduct` seul, avec tests dedies avant extraction, sans toucher aux images, variantes, stock, commandes ou flux paiement.

---

## Phase 2C-4 - Admin produits : deleteProduct

### Perimetre

- Module cible : suppression admin d'un produit.
- Route concernee : `POST /admin/products/:id/delete`.
- Handler conserve : `deleteProduct`.
- Routes non modifiees.
- Vues EJS non modifiees.
- Aucun changement sur :
  - `productsPage`
  - `createProduct`
  - `updateProduct`
  - images produit
  - variantes produit
  - stock metier
  - commandes
  - checkout
  - paiement
  - PayPal
  - factures
  - emails
  - fidelite

### Comportement observe et verrouille

- La route exacte est `POST /admin/products/:id/delete`.
- Le handler exact reste `deleteProduct`.
- Si le produit existe :
  - recherche avec `Product.findByPk(req.params.id)` ;
  - suppression via `Product.destroy({ where: { id: req.params.id } })` ;
  - redirect vers `/admin/products` ;
  - audit log `ADMIN_PRODUCT_DELETE`.
- Le modele `Product` est `paranoid: true` :
  - le produit n'est plus visible via `Product.findByPk(id)` ;
  - il reste visible avec `paranoid: false` et un `deletedAt`.
- Si le produit n'existe pas :
  - pas de 404 ;
  - `Product.destroy(...)` est appele quand meme ;
  - audit log `ADMIN_PRODUCT_DELETE` avec le message base sur l'id ;
  - redirect vers `/admin/products`.
- Aucun flash n'est utilise actuellement.

### Relations et impacts observes

- `deleteProduct` ne charge pas les relations.
- `deleteProduct` ne supprime pas explicitement :
  - `ProductImage`
  - `ProductVariant`
  - `OrderItem`
- Aucun changement n'a ete fait sur la strategie Sequelize des relations.
- Les produits deja references par d'autres tables restent un risque metier a traiter separement, car cette phase verrouille le comportement actuel sans le modifier.

### Tests ajoutes

**Fichier modifie :**
- `tests/admin-products.test.js`

**Cas ajoutes :**
- un admin peut supprimer un produit existant ;
- le produit n'est plus present dans les requetes normales apres suppression ;
- le comportement paranoid actuel est verrouille avec `paranoid: false` ;
- le redirect `/admin/products` est conserve ;
- supprimer un produit inexistant redirige et audite selon le comportement actuel ;
- la suppression ecrit un audit log produit ;
- non-admin bloque en `403` sur suppression ;
- visiteur non connecte bloque en `401` sur suppression.

### Fichiers modifies

- `src/services/adminProductService.js`
- `src/controllers/admin/productController.js`
- `src/controllers/adminController.js`
- `tests/admin-products.test.js`
- `update.md`

### Refactorisation effectuee

La logique de suppression produit a ete deplacee de `adminController.js` vers :

- `adminProductService.deleteProductFromAdmin(productId)`

La fonction service gere maintenant :

- recherche du produit ;
- suppression via `Product.destroy({ where: { id: productId } })` ;
- retour du produit trouve, ou `null` si introuvable.

Le controller `deleteProduct` est maintenant dans `src/controllers/admin/productController.js` et reste mince :

- lecture de `req.params.id` ;
- appel a `adminProductService.deleteProductFromAdmin(...)` ;
- audit log `ADMIN_PRODUCT_DELETE` ;
- redirect `/admin/products`.

`adminController.js` reste l'agregateur central et reexporte toujours `deleteProduct` via `productController`.

### Fonctions non touchees

- `productsPage`
- `createProduct`
- `updateProduct`
- `addProductImage`
- `updateProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- commandes
- paiement
- checkout
- factures
- emails

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe.
- `npm test` : 15 fichiers de test, 15 passes, 0 fail.

Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents sur les tests de blocage, sans lien avec cette phase.

### Risques restants

- La suppression produit est une suppression paranoid/soft delete au niveau Sequelize, mais elle ne gere pas explicitement les images, variantes ou references de commandes.
- Le comportement sur produit inexistant reste permissif : audit + redirect, pas de 404.
- Les routes images et variantes restent dans `adminController.js`, volontairement hors perimetre.
- Le non-recalcul actuel de `finalPrice` sur update reste un risque separe, deja note en Phase 2C-3.

### Prochaine etape conseillee

Phase 2C-5 : traiter uniquement les handlers images produit, en commencant par `addProductImage`, avec tests dedies avant extraction et sans toucher aux variantes ni au stock.

---

## Phase 2C-5 - Admin produits : addProductImage

### Perimetre

- Module cible : ajout admin d'une image produit.
- Route concernee : `POST /admin/products/:id/images`.
- Handler conserve : `addProductImage`.
- Routes non modifiees.
- Vues EJS non modifiees.
- Aucun changement sur :
  - `productsPage`
  - `createProduct`
  - `updateProduct`
  - `deleteProduct`
  - `updateProductImage`
  - `deleteProductImage`
  - variantes produit
  - commandes
  - checkout
  - paiement
  - PayPal
  - factures
  - emails
  - fidelite

### Comportement observe et verrouille

- La route exacte est `POST /admin/products/:id/images`.
- Le handler exact reste `addProductImage`.
- Champs lus dans `req.body` :
  - `url`
  - `variantId`
  - `isMain`
  - `position`
- Si le produit existe :
  - creation d'une `ProductImage` liee a `productId`.
- Si le produit n'existe pas :
  - statut `404`
  - rendu `pages/errors/404`
  - titre `Produit introuvable`
- `isMain` :
  - vaut `true` uniquement si `req.body.isMain === "1"` ;
  - si `true`, les autres images du produit passent a `isMain: false`.
- `variantId` :
  - persiste si fourni et si la variante appartient au produit ;
  - si la variante est introuvable pour ce produit, statut `404` avec titre `Variante introuvable`.
- `position` :
  - persiste avec `Number(req.body.position || 0)`.
- URL :
  - validation HTTPS stricte deja presente ;
  - `javascript:`, `data:` et `http:` sont refuses avec statut `400`.
- Redirection :
  - redirect `/admin/products` apres creation.
- Aucun flash et aucun audit log pour `addProductImage` actuellement.

### Point de comportement important

L'ordre actuel a ete conserve :

- si `isMain === "1"`, les anciennes images principales sont desactivees avant la validation finale de l'URL.

Ce comportement est fragile, mais il n'a pas ete modifie pour respecter le perimetre sans changement fonctionnel.

### Tests ajoutes

**Fichier modifie :**
- `tests/admin-products.test.js`

**Cas ajoutes :**
- un admin peut ajouter une image HTTPS a un produit existant ;
- l'image est liee au bon `productId` ;
- `variantId` est persiste selon le comportement actuel ;
- `isMain` est persiste selon le comportement actuel ;
- une nouvelle image principale desactive les anciennes images principales ;
- `position` est persiste selon le comportement actuel ;
- produit inexistant : comportement 404 verrouille ;
- variante introuvable : comportement 404 verrouille ;
- URL `javascript:` refusee ;
- URL `data:` refusee ;
- URL `http:` refusee ;
- non-admin bloque en `403` sur ajout d'image ;
- visiteur non connecte bloque en `401` sur ajout d'image.

### Fichiers modifies

- `src/services/adminProductService.js`
- `src/controllers/admin/productController.js`
- `src/controllers/adminController.js`
- `tests/admin-products.test.js`
- `update.md`

### Validation URL

Aucune nouvelle correction de comportement n'a ete necessaire : la validation HTTPS etait deja presente dans le code actuel de `addProductImage`.

Elle a ete conservee pendant le deplacement vers le service, et couverte par des tests explicites contre :

- `javascript:`
- `data:`
- `http:`

### Refactorisation effectuee

La logique d'ajout d'image produit a ete deplacee de `adminController.js` vers :

- `adminProductService.addProductImageFromAdmin(productId, payload)`

La fonction service gere maintenant :

- recherche du produit ;
- verification de `variantId` si fourni ;
- bascule `isMain` des anciennes images si necessaire ;
- validation HTTPS de l'URL ;
- creation `ProductImage`.

Le controller `addProductImage` est maintenant dans `src/controllers/admin/productController.js` et reste mince :

- lecture de `req.params.id` ;
- lecture de `req.body` ;
- appel a `adminProductService.addProductImageFromAdmin(...)` ;
- mapping des erreurs connues vers les rendus actuels ;
- redirect `/admin/products`.

`adminController.js` reste l'agregateur central et reexporte toujours `addProductImage` via `productController`.

### Fonctions non touchees

- `productsPage`
- `createProduct`
- `updateProduct`
- `deleteProduct`
- `updateProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- commandes
- paiement
- checkout
- factures
- emails

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`
- `git diff --check`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe.
- `npm test` : 15 fichiers de test, 15 passes, 0 fail.
- `git diff --check` : OK.

Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents sur les tests de blocage, sans lien avec cette phase.

### Risques restants

- `updateProductImage` et `deleteProductImage` restent encore dans `adminController.js`.
- L'ordre actuel `isMain` avant validation URL peut desactiver l'ancienne image principale si l'URL fournie est invalide ; comportement verrouille mais potentiellement a revoir avec decision produit.
- Les handlers variantes restent hors perimetre.

### Prochaine etape conseillee

Phase 2C-6 : traiter uniquement `updateProductImage`, avec tests dedies sur URL HTTPS, `variantId`, `isMain`, `position`, 404 et redirect.

## Phase 2C-6 - Admin updateProductImage

### Perimetre

Phase limitee a la modification d'image produit admin :

- route existante : `POST /admin/products/:id/images/:imageId`
- handler conserve : `updateProductImage`
- vue conservee : `src/views/pages/admin/products.ejs`

Aucune route, vue, variante produit, commande, paiement, checkout, facture, email ou fidelite n'a ete modifie.

### Comportement observe et verrouille

Le comportement actuel de `updateProductImage` est :

- recherche de l'image par `id` et `productId` ;
- pas de recherche separee du produit ;
- produit inexistant, image inexistante ou image appartenant a un autre produit : rendu 404 `Image introuvable` ;
- `variantId` est verifie uniquement s'il est fourni, et doit appartenir au produit de la route ;
- variante introuvable : rendu 404 `Variante introuvable` ;
- `isMain === "1"` desactive les autres images principales du meme produit ;
- si `isMain` est absent, l'image modifiee est enregistree avec `isMain: false`, comme avant ;
- `position` est convertie avec `Number(...)` si fournie ;
- si `url` est absente, l'URL existante est conservee ;
- si `url` est fournie, elle doit etre en HTTPS ;
- succes : redirect `/admin/products` ;
- pas de flash et pas d'audit log specifique sur cette action.

### Tests ajoutes

Les tests `admin-products` couvrent maintenant :

- modification d'une image avec URL HTTPS valide ;
- maintien du `productId` ;
- mise a jour de `variantId` ;
- mise a jour de `isMain` et desactivation des autres images principales ;
- mise a jour de `position` ;
- conservation de l'URL existante si aucune URL n'est fournie ;
- comportement 404 pour produit inexistant, image inexistante, image d'un autre produit ;
- comportement 404 pour `variantId` introuvable ;
- refus des schemas `javascript:`, `data:` et `http:` ;
- blocage non-admin ;
- blocage visiteur non connecte.

### Validation URL

Aucune nouvelle regle SEO ou produit n'a ete ajoutee. La validation HTTPS existante a ete conservee et appliquee depuis le service pour `updateProductImage`.

### Refactorisation effectuee

La logique de modification d'image produit a ete deplacee vers :

- `adminProductService.updateProductImageFromAdmin(productId, imageId, payload)`

Cette fonction gere maintenant :

- recherche de l'image ;
- verification eventuelle de `variantId` ;
- bascule `isMain` ;
- validation HTTPS de l'URL ;
- update `ProductImage`.

Le controller `updateProductImage` est maintenant dans `src/controllers/admin/productController.js` et reste mince :

- lecture de `req.params.id` ;
- lecture de `req.params.imageId` ;
- lecture de `req.body` ;
- appel au service ;
- mapping des erreurs connues vers les rendus actuels ;
- redirect `/admin/products`.

`adminController.js` reste l'agregateur central et reexporte `updateProductImage` via `productController`.

### Fonctions non touchees

- `productsPage`
- `createProduct`
- `updateProduct`
- `deleteProduct`
- `addProductImage`
- `deleteProductImage`
- `addProductVariant`
- `updateProductVariant`
- `deleteProductVariant`
- commandes
- paiement
- checkout
- factures
- emails

### Commandes executees

Avant refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`

Apres refactorisation :
- `node --test tests/admin-products.test.js`
- `npm test`
- `git diff --check`

### Resultat

- Test cible admin products : passe.
- Suite complete : passe.
- `npm test` : 15 fichiers de test, 15 passes, 0 fail.
- `git diff --check` : OK.

Les warnings existants lies aux audit logs dans certaines bases SQLite de test restent presents sur les tests de blocage, sans echec.

### Risques restants

- `deleteProductImage` reste encore dans `adminController.js`.
- L'ordre actuel `isMain` avant validation URL est conserve : si une requete invalide arrive avec `isMain: "1"`, les autres images peuvent etre demotees avant le refus URL. Ce risque est documente mais non corrige dans cette phase pour ne pas changer le comportement.
- Les handlers variantes restent hors perimetre.

### Prochaine etape conseillee

Phase 2C-7 : traiter uniquement `deleteProductImage`, avec tests sur suppression, image principale restante, 404 implicites/redirects et blocage non-admin/visiteur.

---

## 25/04/2026 — Correctifs OWASP immediats + dependances npm

### Contexte

Suite a la lecture de `OWASP_AUDIT.md`, seuls les correctifs immediats valides apres verification du code source ont ete appliques. Les changements ont ete faits par petits lots et verifies avec `npm test` apres chaque etape importante.

---

### 1. `app.js` — Limites explicites sur les parsers HTTP

**Probleme :** Les parsurs Express utilisaient les limites par defaut, sans politique explicite dans le code.

**Ce qui a change :**
- `express.urlencoded({ extended: true })` devient `express.urlencoded({ extended: true, limit: "16kb" })`.
- `express.json()` devient `express.json({ limit: "64kb" })`.

**Pourquoi :**
- Reduire l'exposition CPU/memoire sur les endpoints POST.
- Rendre les limites applicatives visibles et maintenables.

---

### 2. `src/middlewares/rateLimit.js` + `src/routes/authRoutes.js` — Rate limit inscription

**Probleme :** `POST /auth/register` n'avait pas de rate limit dedie.

**Ce qui a change :**
- Ajout de `registerRateLimit` :
  - fenetre : 1 heure ;
  - maximum : 5 tentatives ;
  - reponse structuree `TOO_MANY_REGISTER`.
- Application de ce middleware sur :
  - `POST /auth/register`

**Pourquoi :**
- Limiter l'automatisation de creation de comptes.
- Reduire la pression d'enumeration email sur l'inscription.

---

### 3. `src/services/authService.js` — Flag `secure` des cookies auth

**Probleme :** Les cookies `accessToken` et `refreshToken` utilisaient `req.app.get("env") === "production"` pour determiner `secure`, alors que le reste de l'app s'appuie sur `env.isProd`.

**Ce qui a change :**
- Import de `env` depuis `src/config/env.js`.
- `secure: req.app.get("env") === "production"` devient `secure: env.isProd`.

**Pourquoi :**
- Aligner les cookies auth avec la configuration canonique de l'application.
- Eviter une divergence si l'environnement Express et `env.isProd` ne sont pas synchronises.

---

### 4. `app.js` — Content Security Policy reactivee

**Analyse faite avant modification :**
Toutes les vues EJS de `src/views/` ont ete parcourues pour identifier les ressources externes et usages inline :

- scripts externes :
  - `https://cdn.tailwindcss.com`
  - `https://cdn.jsdelivr.net/npm/chart.js`
- styles / fonts externes :
  - `https://fonts.googleapis.com`
  - `https://fonts.gstatic.com`
- images externes :
  - placeholders `https://via.placeholder.com/...`
  - URLs produit en HTTPS
- scripts inline :
  - navbar mobile
  - panier
  - detail produit
  - admin produits
  - admin logs
  - admin dashboard
- styles inline :
  - `head.ejs`
  - admin dashboard
- handlers inline :
  - confirmations de suppression admin produits
  - navigation ligne commande admin dashboard
- aucun script PayPal SDK charge par les vues EJS au moment du correctif.

**Ce qui a change :**
- `helmet({ contentSecurityPolicy: false })` a ete remplace par une CSP explicite :
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net`
  - `script-src-attr 'unsafe-inline'`
  - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
  - `style-src-attr 'unsafe-inline'`
  - `font-src 'self' https://fonts.gstatic.com`
  - `img-src 'self' data: https:`
  - `connect-src 'self'`
  - `object-src 'none'`
  - `frame-ancestors 'none'`
  - `upgrade-insecure-requests` seulement en production.

**Pourquoi :**
- Reactiver une protection navigateur importante sans casser les vues actuelles.
- La CSP reste volontairement compatible avec les scripts/styles inline existants ; un durcissement supplementaire necessitera de deplacer ces scripts vers des fichiers statiques.

---

### 5. `package-lock.json` — `npm audit fix` sans major bump

**Commande executee :**
- `npm audit fix`

**Ce qui a change :**
- Mise a jour non cassante de dependances dans `package-lock.json`, notamment :
  - `sequelize` `6.37.7` -> `6.37.8`
  - `path-to-regexp` `0.1.12` -> `0.1.13`
  - `picomatch` `2.3.1` -> `2.3.2`
  - `minimatch`, `brace-expansion`, `editorconfig`, `lodash` via mises a jour transitive/lockfile.

**Pourquoi :**
- Corriger les vulnerabilites resolvables sans changement majeur.
- Conserver les upgrades cassants pour des etapes separees.

---

### 6. `package.json` + `package-lock.json` — Nodemailer v8

**Analyse faite avant modification :**
`src/services/emailService.js` a ete lu avant l'upgrade. Le service utilise :

- `require("nodemailer")`
- `nodemailer.createTransport({ host, port, secure, auth })`
- `transport.sendMail({ from, to, subject, html, attachments })`

Le changelog Nodemailer v8 indique notamment :

- v7 : breaking change lie aux transports SES, non utilise ici ;
- v8 : renommage du code erreur `NoAuth` en `ENOAUTH`.

`emailService.js` n'utilise pas SES et ne branche pas sa logique sur les codes d'erreur Nodemailer. Aucune adaptation code n'a donc ete necessaire.

**Ce qui a change :**
- `nodemailer` dans `package.json` :
  - `^6.9.16` -> `^8.0.6`
- `package-lock.json` installe maintenant :
  - `nodemailer@8.0.6`

**Pourquoi :**
- Corriger les vulnerabilites Nodemailer signalees par `npm audit`, notamment autour du parsing d'adresse et des injections SMTP.

---

### 7. `src/middlewares/csrf.js` + dependances — migration `csurf` vers `csrf-csrf`

**Analyse faite avant modification :**
- `src/middlewares/csrf.js` a ete lu pour comprendre le middleware CSRF existant.
- `app.js` a ete lu pour verifier l'ordre d'installation des middlewares.
- Les usages de `csurf`, `csrfProtection` et `csrfToken` ont ete recherches dans `app.js`, `src`, `tests`, `package.json` et `package-lock.json`.

**Ce qui a change :**
- `src/middlewares/csrf.js` :
  - remplacement de `csurf` par `csrf-csrf` avec `doubleCsrf`;
  - conservation de l'activation `env.isProd || env.csrfEnabled`, donc CSRF force en production et desactivable en test/dev via env;
  - conservation de la protection sur toutes les routes non `GET`, `HEAD`, `OPTIONS`;
  - conservation des exemptions `/auth/refresh` et `/payments/paypal/webhook`;
  - lecture du token depuis `req.body._csrf` ou le header `x-csrf-token`;
  - exposition de `res.locals.csrfToken` via `req.csrfToken()` pour les vues EJS.
- `package.json` :
  - suppression de `csurf`;
  - ajout de `csrf-csrf`.
- `package-lock.json` :
  - suppression de `csurf` et de ses dependances transitives;
  - ajout de `csrf-csrf@4.0.3`.

**Pourquoi :**
- Remplacer `csurf`, package archive et non maintenu, par une alternative maintenue.
- Garder le comportement applicatif existant pour ne pas casser les formulaires et les routes protegees.

---

### Validation

**Commandes executees :**
- `npm test` apres les correctifs parser/rate limit/cookies.
- `npm test` apres activation CSP.
- `npm test` apres `npm audit fix`.
- `npm test` apres upgrade Nodemailer v8.
- `npm test` apres migration `csurf` vers `csrf-csrf`.
- `npm audit`.

**Resultats :**
- Suite complete apres chaque etape : passe.
- Dernier resultat `npm test` : 21 tests, 21 passes, 0 fail.
- Dernier `npm audit` : 10 vulnerabilites restantes, toutes liees a des corrections necessitant des changements majeurs ou separes (`sqlite3@6`, `tar` via `sqlite3`, resolution `uuid`/Sequelize).

Les logs d'erreur visibles pendant les tests correspondent aux cas negatifs attendus (blocage visiteur/non-admin, audit log SQLite absent dans certaines bases de test) et ne changent pas le resultat.

---

### Synthese rapide

### Ajoute
- Limites explicites sur les parsers HTTP.
- Rate limit dedie pour l'inscription.
- Content Security Policy activee et adaptee aux vues actuelles.

### Modifie
- Cookies auth alignes sur `env.isProd`.
- Dependances corrigees via `npm audit fix`.
- Nodemailer mis a jour vers v8.
- CSRF migre de `csurf` vers `csrf-csrf`.

### Non modifie
- `src/services/emailService.js` : lu et compare au changelog Nodemailer v8, mais aucun changement code requis.
