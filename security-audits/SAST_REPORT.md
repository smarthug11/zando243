# SAST_REPORT.md — Audit de Sécurité Zando243

**Date :** 2026-03-29
**Périmètre :** `src/middlewares`, `src/controllers`, `src/routes`, `src/config`, `src/services`, `app.js`
**Méthode :** Analyse statique manuelle (SAST) — lecture ligne par ligne
**Total failles :** 22 (3 CRITIQUE · 7 ÉLEVÉ · 6 MOYEN · 6 FAIBLE)

---

## Résumé exécutif

| Niveau   | Nombre | Action recommandée              |
|----------|--------|---------------------------------|
| CRITIQUE | 3      | Corriger avant tout déploiement |
| ÉLEVÉ    | 7      | Corriger dans les 48h           |
| MOYEN    | 6      | Corriger dans la semaine        |
| FAIBLE   | 6      | Corriger au prochain sprint     |

---

---

# CRITIQUE

---

## C-1 — Tokens de sécurité exposés en clair dans la réponse HTML

**Fichier :** `src/controllers/authController.js`
**Lignes :** 40, 94

```javascript
// Ligne 40 — après inscription
setFlash(req, "success", `Compte créé. Token vérification (démo): ${emailVerificationToken}`);

// Ligne 94 — après demande de reset password
setFlash(req, "success", result ? `Token reset (démo): ${result.token}` : "Si le compte existe, un email a été envoyé.");
```

**Ce qu'un attaquant peut faire :**

1. **Contournement de la vérification email :** Lors de l'inscription, le token de vérification apparaît directement dans le message flash affiché dans le HTML. L'attaquant n'a pas besoin d'accéder à la boîte email pour vérifier son compte.
2. **Prise de contrôle de compte via reset :** Un attaquant qui connaît l'email d'une victime peut déclencher un reset, lire le token dans la réponse HTTP, et réinitialiser le mot de passe sans jamais accéder à la boîte email de la victime.
3. **Interception par des tiers :** Ces tokens apparaissent dans les logs de proxy, CDN, et dans l'historique navigateur.

**Correction :**

```javascript
// Ligne 40 — Supprimer le token du flash, envoyer uniquement par email
setFlash(req, "success", "Compte créé. Un email de vérification vous a été envoyé.");
// (appeler emailService.sendVerificationEmail(user, emailVerificationToken) ici)

// Ligne 94 — Message neutre uniquement
setFlash(req, "success", "Si ce compte existe, un email de réinitialisation a été envoyé.");
```

**Gravité :** CRITIQUE — exploitation triviale, aucun outil requis, impact : prise de contrôle de compte.

---

## C-2 — Secrets JWT et session avec valeurs de repli faibles

**Fichier :** `src/config/env.js`
**Lignes :** 25–26, 30–31

```javascript
jwt: {
  accessSecret:  process.env.JWT_ACCESS_SECRET  || "dev_access_secret",   // ligne 25
  refreshSecret: process.env.JWT_REFRESH_SECRET || "dev_refresh_secret",  // ligne 26
},
cookieSecret:  process.env.COOKIE_SECRET  || "cookie_secret",   // ligne 30
sessionSecret: process.env.SESSION_SECRET || "session_secret",  // ligne 31
```

**Ce qu'un attaquant peut faire :**

Si les variables d'environnement ne sont pas définies (oubli de configuration, conteneur mal configuré), les secrets tombent sur des valeurs triviales et connues publiquement dans le dépôt. L'attaquant peut alors :
- Forger des JWT valides avec n'importe quel `userId` et `role: "ADMIN"`.
- Signer des cookies de session arbitraires.
- Prendre le contrôle de n'importe quel compte, y compris l'administrateur.

**Correction :**

```javascript
// src/config/env.js
function requireSecret(name, fallback) {
  const value = process.env[name] || fallback;
  if (!fallback && !process.env[name] && process.env.NODE_ENV === "production") {
    throw new Error(`Variable d'environnement manquante en production : ${name}`);
  }
  return value;
}

jwt: {
  accessSecret:  requireSecret("JWT_ACCESS_SECRET",  "dev_access_secret_UNSAFE"),
  refreshSecret: requireSecret("JWT_REFRESH_SECRET", "dev_refresh_secret_UNSAFE"),
},
cookieSecret:  requireSecret("COOKIE_SECRET",  "cookie_secret_UNSAFE"),
sessionSecret: requireSecret("SESSION_SECRET", "session_secret_UNSAFE"),
```

En production, générer les secrets avec : `openssl rand -base64 64`

**Gravité :** CRITIQUE — bypass complet de l'authentification si les env vars sont absentes.

---

## C-3 — Algorithme JWT non contraint (risque algorithm confusion)

**Fichier :** `src/config/jwt.js`
**Lignes :** 21–22, 25–26

```javascript
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);  // ligne 21-22 — pas d'option algorithms
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret); // ligne 25-26 — même problème
}
```

**Ce qu'un attaquant peut faire :**

Sans l'option `{ algorithms: ["HS256"] }`, la bibliothèque `jsonwebtoken` accepte l'algorithme déclaré dans le header du token. L'attaque **algorithm confusion (alg:none)** consiste à forger un token avec `"alg": "none"` et une signature vide. Selon la version de `jsonwebtoken`, cela peut permettre de bypasser la vérification.

**Correction :**

```javascript
function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, { algorithms: ["HS256"] });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret, { algorithms: ["HS256"] });
}
```

**Gravité :** CRITIQUE — selon la version de jsonwebtoken installée, bypass total possible.

---

---

# ÉLEVÉ

---

## E-1 — Mass assignment dans updateAddress : champs non filtrés

**Fichier :** `src/controllers/accountController.js`
**Ligne :** 49

```javascript
Object.assign(address, { ...req.body, isDefault: Boolean(req.body.isDefault) });
await address.save();
```

**Ce qu'un attaquant peut faire :**

`req.body` est étalé directement sur l'objet `address` avant `save()`. Un client authentifié peut POST des champs non prévus comme `userId` pour changer l'ownership de l'adresse, ou tout autre champ du modèle Address.

**Correction :**

```javascript
// Whitelist explicite des champs modifiables
const allowed = ["label", "number", "street", "neighborhood", "municipality", "city", "country"];
const updates = {};
for (const key of allowed) {
  if (key in req.body) updates[key] = req.body[key];
}
updates.isDefault = Boolean(req.body.isDefault);
Object.assign(address, updates);
await address.save();
```

---

## E-2 — Mass assignment dans createAddress : spread de req.body direct

**Fichier :** `src/controllers/accountController.js`
**Ligne :** 39

```javascript
await models.Address.create({ ...req.body, userId: req.user.id, isDefault: Boolean(req.body.isDefault) });
```

**Ce qu'un attaquant peut faire :**

Identique à E-1 mais pour la création. L'attaquant peut injecter des champs arbitraires du modèle Address, dont `id` (UUID forcé) ou des champs futurs du modèle.

**Correction :**

```javascript
await models.Address.create({
  label:        req.body.label,
  number:       req.body.number || null,
  street:       req.body.street,
  neighborhood: req.body.neighborhood || null,
  municipality: req.body.municipality || null,
  city:         req.body.city,
  country:      req.body.country,
  userId:       req.user.id,
  isDefault:    Boolean(req.body.isDefault)
});
```

---

## E-3 — Mass assignment dans createProduct et updateProduct (Admin)

**Fichier :** `src/controllers/adminController.js`
**Lignes :** 169, 188

```javascript
// Ligne 169 — création
const product = await models.Product.create({
  ...req.body,  // spread complet de req.body
  slug: toSlug(req.body.name),
  keywords: (req.body.keywords || "").split(",").map((s) => s.trim()).filter(Boolean)
});

// Ligne 188 — mise à jour
Object.assign(product, {
  ...req.body,  // spread complet de req.body
  slug: toSlug(req.body.name || product.name),
  keywords: ...
});
```

**Ce qu'un attaquant peut faire :**

Un administrateur compromis ou une CSRF réussie peut injecter des champs non prévus : `avgRating`, `popularityScore`, `countReviews`, `finalPrice`, ou même `id`. Cela peut fausser le classement produits ou écraser des données calculées.

**Correction :**

Définir une whitelist explicite des champs acceptés dans `productValidators` et passer seulement ces champs à `create()` / `update()`.

---

## E-4 — avatarUrl acceptée sans validation (XSS / Open Redirect potentiel)

**Fichier :** `src/controllers/accountController.js`
**Ligne :** 27

```javascript
avatarUrl: req.body.avatarUrl || null
```

**Ce qu'un attaquant peut faire :**

Aucune validation du format ou du schéma de l'URL :
- Injection d'une URL `javascript:alert(1)` → XSS si le template utilise `<img src="<%= user.avatarUrl %>">` sans encodage.
- Injection d'une URL `data:text/html,...` → XSS.
- Tracking externe : URL vers un serveur contrôlé par l'attaquant.

**Correction :**

```javascript
// Valider que c'est une URL https:// uniquement
const rawAvatar = req.body.avatarUrl || "";
let avatarUrl = null;
if (rawAvatar) {
  try {
    const parsed = new URL(rawAvatar);
    if (parsed.protocol === "https:") avatarUrl = rawAvatar;
  } catch (_) { /* invalide, on ignore */ }
}
```

---

## E-5 — URL d'image produit sans validation (admin)

**Fichier :** `src/controllers/adminController.js`
**Lignes :** 92–93, 113

```javascript
// Ligne 92-93 — addProductImage
await models.ProductImage.create({
  url: req.body.url,  // aucune validation du schéma
  ...
});

// Ligne 113 — updateProductImage
await image.update({ url: req.body.url || image.url, ... });
```

**Ce qu'un attaquant peut faire :**

Si l'interface admin est compromise (XSS, session volée, CSRF), un attaquant peut injecter des URLs `javascript:` ou `data:` dans les images produit, affectant tous les visiteurs qui voient ce produit.

**Correction :** Même approche que E-4, forcer `https://` uniquement.

---

## E-6 — Logs système incluent le body des requêtes (mots de passe en clair)

**Fichier :** `src/middlewares/errorHandler.js`
**Ligne :** 7

```javascript
logger.error(
  { err, requestId: req.requestId, path: req.originalUrl, body: req.body },
  "Erreur HTTP"
);
```

**Ce qu'un attaquant peut faire :**

Si une erreur survient pendant le login (`POST /auth/login`) ou le reset password (`POST /auth/reset-password`), le champ `password` du `req.body` est enregistré **en clair** dans les logs. Tout accès aux logs (fichier, Pino, service de log centralisé) expose les mots de passe utilisateurs.

**Correction :**

```javascript
// Sanitizer les champs sensibles avant de logger
const safeBody = { ...req.body };
for (const field of ["password", "passwordHash", "token", "secret", "creditCard"]) {
  if (safeBody[field]) safeBody[field] = "[REDACTED]";
}
logger.error(
  { err: { message: err.message, code: err.code }, requestId: req.requestId, path: req.originalUrl, body: safeBody },
  "Erreur HTTP"
);
```

---

## E-7 — Objet erreur complet exposé au template EJS en production

**Fichier :** `src/middlewares/errorHandler.js`
**Ligne :** 30

```javascript
return res.status(status).render("pages/errors/error", {
  title: "Erreur",
  error: err,   // objet Error complet : message, stack, code, et tous les champs ajoutés
  status
});
```

**Ce qu'un attaquant peut faire :**

En production, les stack traces exposées révèlent :
- Les chemins absolus du système de fichiers serveur.
- Les noms des modules et versions.
- La structure interne du code (noms de fonctions, fichiers).

Ces informations accélèrent considérablement la reconnaissance d'un attaquant.

**Correction :**

```javascript
const userFacingError = env.isProd
  ? { message: "Une erreur interne s'est produite.", code: err.code || "INTERNAL_ERROR" }
  : err;

return res.status(status).render("pages/errors/error", {
  title: "Erreur",
  error: userFacingError,
  status
});
```

---

---

# MOYEN

---

## M-1 — Rate limiting login trop permissif (brute force possible)

**Fichier :** `src/middlewares/rateLimit.js`
**Lignes :** 3–8

```javascript
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 15,                    // 15 tentatives = 1 par minute
  standardHeaders: true,
  legacyHeaders: false
});
```

**Ce qu'un attaquant peut faire :**

15 tentatives par 15 minutes équivaut à tester 1 440 mots de passe par jour — suffisant pour une attaque par dictionnaire sur des comptes à mots de passe faibles.

**Correction :**

```javascript
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,                  // 5 tentatives max
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Trop de tentatives. Réessayez dans 15 minutes." } }
});
```

---

## M-2 — `trust proxy: true` sans whitelist IP (IP spoofing → contourne rate limit)

**Fichier :** `app.js`
**Ligne :** 21

```javascript
app.set("trust proxy", true);
```

**Ce qu'un attaquant peut faire :**

Avec `trust proxy: true`, Express utilise le header `X-Forwarded-For` pour déterminer l'IP client — sans vérifier que ce header vient d'un vrai proxy de confiance. Un attaquant peut forger ce header :

```
POST /auth/login
X-Forwarded-For: 1.2.3.4  ← adresse changée à chaque requête
```

Cela réinitialise le compteur de rate limiting à chaque requête, rendant la protection brute-force complètement inefficace.

**Correction :**

```javascript
// Si derrière un proxy connu (ex: nginx sur localhost)
app.set("trust proxy", "loopback");  // ou l'IP du proxy

// Si sur Railway / Heroku / Render
app.set("trust proxy", 1);  // trust seulement le premier proxy
```

---

## M-3 — Énumération d'utilisateurs via le reset de mot de passe

**Fichier :** `src/controllers/authController.js`
**Ligne :** 94

```javascript
setFlash(req, "success", result ? `Token reset (démo): ${result.token}` : "Si le compte existe, un email a été envoyé.");
```

**Ce qu'un attaquant peut faire :**

Le message affiché est différent selon que l'email existe ou non (`result` est `null` si l'email est inconnu, voir `authService.js` ligne 86). Un attaquant peut automatiser des requêtes de reset et observer la réponse pour dresser une liste de tous les emails inscrits sur la plateforme.

**Correction :**

Afficher **toujours** le même message, quelle que soit l'existence de l'email :

```javascript
setFlash(req, "success", "Si ce compte existe, un email de réinitialisation a été envoyé.");
```

Et dans `authService.js`, s'assurer que le temps de réponse est constant (ajout d'un délai artificiel si l'email n'existe pas) pour éviter les timing attacks.

---

## M-4 — Injection de caractères spéciaux LIKE dans les filtres admin

**Fichier :** `src/services/auditLogService.js`
**Lignes :** 60–65

```javascript
if (filters.actorEmail) where.actorEmail = { [Op.like]: `%${filters.actorEmail}%` };
if (filters.q) {
  where[Op.or] = [
    { message: { [Op.like]: `%${filters.q}%` } },
    { action:  { [Op.like]: `%${filters.q}%` } }
  ];
}
```

**Ce qu'un attaquant peut faire :**

Les caractères `%` et `_` ont une signification spéciale dans les clauses SQL `LIKE`. Un admin malveillant (ou une session admin volée) peut injecter `%` dans les filtres pour forcer un scan complet de table, causant une dégradation de performance (DoS applicatif) ou une extraction de données non intentionnelle.

**Correction :**

```javascript
function escapeLike(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

if (filters.actorEmail) {
  where.actorEmail = { [Op.like]: `%${escapeLike(filters.actorEmail)}%` };
}
```

---

## M-5 — Validation sans longueur maximale (DoS bcrypt via mot de passe géant)

**Fichier :** `src/controllers/authController.js`
**Lignes :** 10–13

```javascript
body("firstName").isLength({ min: 2 }),   // pas de max
body("lastName").isLength({ min: 2 }),    // pas de max
body("email").isEmail(),                   // pas de longueur max
body("password").isLength({ min: 8 }),    // pas de max ← dangereux
```

**Ce qu'un attaquant peut faire :**

`bcrypt` est O(n) sur la longueur du mot de passe. Un attaquant peut envoyer un mot de passe de 10 MB, forçant le CPU à calculer bcrypt pendant plusieurs secondes, causant un **DoS applicatif** par requêtes concurrentes sur `/auth/register` ou `/auth/reset-password`.

**Correction :**

```javascript
body("firstName").isLength({ min: 2, max: 100 }),
body("lastName").isLength({ min: 2, max: 100 }),
body("email").isEmail().isLength({ max: 254 }),
body("password").isLength({ min: 8, max: 128 }),
```

Idem pour `profileValidators` dans `accountController.js` ligne 9.

---

## M-6 — Sanitization insuffisante : seuls `<` et `>` sont filtrés

**Fichier :** `src/middlewares/validators.js`
**Ligne :** 6

```javascript
function sanitizeValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(/[<>]/g, "").trim();  // filtre < et > seulement
}
```

**Ce qu'un attaquant peut faire :**

Cette sanitization ne protège pas contre :
- Les encodages HTML : `&#60;script&#62;` → rendu comme `<script>` par le navigateur.
- Les attributs d'events injectés sans chevrons : si une valeur se retrouve dans un attribut HTML (`value="{{input}}"`), l'attaquant peut fermer l'attribut avec `"` et injecter `onmouseover=alert(1)`.
- Les templates EJS avec `<%-` (non-échappé) si utilisés dans les vues.

**Correction :**

Cette fonction ne doit pas être la seule ligne de défense contre le XSS. La bonne pratique est de :
1. **Ne pas filtrer à l'entrée** mais **encoder à la sortie** (dans les templates EJS, toujours utiliser `<%= %>` et jamais `<%- %>` pour les données utilisateur).
2. Activer CSP (voir F-1).
3. Si un filtre à l'entrée est voulu, utiliser une libraire dédiée (`xss`, `sanitize-html`).

---

---

# FAIBLE

---

## F-1 — Content Security Policy désactivée

**Fichier :** `app.js`
**Ligne :** 32

```javascript
app.use(helmet({
  contentSecurityPolicy: false  // CSP complètement désactivée
}));
```

**Impact :** Sans CSP, les XSS résiduels (si un template EJS utilise `<%-` par erreur, ou si une dépendance est compromise) peuvent exécuter du JavaScript arbitraire dans le navigateur des utilisateurs.

**Correction :** Activer CSP avec une politique stricte adaptée à l'application EJS.

---

## F-2 — CORS accepte toutes les origines avec credentials

**Fichier :** `app.js`
**Ligne :** 37

```javascript
app.use(cors({ origin: true, credentials: true }));
```

**Impact :** `origin: true` reflète l'`Origin` de chaque requête, combiné à `credentials: true`, cela signifie que n'importe quel site web peut faire des requêtes authentifiées (avec les cookies de session) vers cette API. Cela affaiblit la protection CSRF.

**Correction :**

```javascript
const allowedOrigins = [env.appUrl, "http://localhost:3000"].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origine non autorisée"));
  },
  credentials: true
}));
```

---

## F-3 — Cookies auth avec `sameSite: "lax"` au lieu de `"strict"`

**Fichier :** `src/services/authService.js`
**Lignes :** 12–13

```javascript
function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",        // lax au lieu de strict
    secure: req.app.get("env") === "production"
  };
}
```

**Impact :** `sameSite: "lax"` autorise les cookies dans les navigations GET inter-sites (clics sur des liens). Pour une application e-commerce, `"strict"` est plus sûr — les cookies ne sont envoyés que dans les requêtes originant du même site.

**Correction :** Utiliser `sameSite: "strict"` pour les cookies `accessToken` et `refreshToken`.

---

## F-4 — Cookies de session avec durée de 7 jours

**Fichier :** `app.js`
**Ligne :** 49

```javascript
cookie: {
  httpOnly: true,
  sameSite: "lax",
  secure: env.isProd,
  maxAge: 1000 * 60 * 60 * 24 * 7   // 7 jours
}
```

**Impact :** Une session volée reste valide 7 jours. Réduire à 2–4 heures limite la fenêtre d'exploitation d'un cookie volé.

---

## F-5 — Absence de validation du format UUID sur les paramètres de route

**Fichiers :** `src/routes/*.js` (toutes les routes avec `:id`)

```javascript
// Exemples : /orders/:id, /admin/orders/:id, /favorites/:productId
// Aucune validation que :id est un UUID valide avant la requête DB
```

**Impact :** Des valeurs inattendues comme des chaînes très longues ou des caractères spéciaux sont passées directement à Sequelize. Bien que Sequelize paramétrise les requêtes, l'absence de validation précoce est une dette de sécurité.

**Correction :** Ajouter un middleware de validation UUID sur les routes sensibles :

```javascript
const { param } = require("express-validator");
const uuidValidator = param("id").isUUID(4).withMessage("ID invalide");
router.get("/orders/:id", requireAuth, uuidValidator, handleValidation, ctrl.orderDetail);
```

---

## F-6 — Informations de débogage dans le message flash de réinitialisation

**Fichier :** `src/controllers/authController.js`
**Ligne :** 94

*(Également signalé en C-1 pour l'exposition du token — cet aspect concerne le comportement de production)*

```javascript
result ? `Token reset (démo): ${result.token}` : "..."
```

Le commentaire `(démo)` confirme qu'il s'agit de code de développement non retiré. En dehors de l'exposition du token (C-1), ce pattern indique que d'autres codes de démo peuvent exister dans l'application.

**Correction :** Rechercher et supprimer tous les `(démo)` dans la base de code :

```bash
grep -r "démo\|demo\|TODO\|FIXME\|HACK" src/
```

---

---

# Matrice des risques

| ID  | Fichier                              | Ligne(s) | Niveau   | Vecteur principal               |
|-----|--------------------------------------|----------|----------|---------------------------------|
| C-1 | `src/controllers/authController.js`  | 40, 94   | CRITIQUE | Tokens exposés en HTML          |
| C-2 | `src/config/env.js`                  | 25–26, 30–31 | CRITIQUE | Secrets JWT/session faibles     |
| C-3 | `src/config/jwt.js`                  | 21–22, 25–26 | CRITIQUE | Algorithm confusion JWT         |
| E-1 | `src/controllers/accountController.js` | 49     | ÉLEVÉ    | Mass assignment (adresse)       |
| E-2 | `src/controllers/accountController.js` | 39     | ÉLEVÉ    | Mass assignment (création addr) |
| E-3 | `src/controllers/adminController.js` | 169, 188 | ÉLEVÉ    | Mass assignment (produits)      |
| E-4 | `src/controllers/accountController.js` | 27     | ÉLEVÉ    | XSS via avatarUrl               |
| E-5 | `src/controllers/adminController.js` | 92, 113  | ÉLEVÉ    | XSS via image URL               |
| E-6 | `src/middlewares/errorHandler.js`    | 7        | ÉLEVÉ    | Mot de passe en clair dans logs |
| E-7 | `src/middlewares/errorHandler.js`    | 30       | ÉLEVÉ    | Stack trace exposée             |
| M-1 | `src/middlewares/rateLimit.js`       | 3–8      | MOYEN    | Brute force login               |
| M-2 | `app.js`                             | 21       | MOYEN    | IP spoofing → bypass rate limit |
| M-3 | `src/controllers/authController.js`  | 94       | MOYEN    | Énumération d'utilisateurs      |
| M-4 | `src/services/auditLogService.js`    | 60–65    | MOYEN    | Injection LIKE SQL              |
| M-5 | `src/controllers/authController.js`  | 10–13    | MOYEN    | DoS bcrypt via password géant   |
| M-6 | `src/middlewares/validators.js`      | 6        | MOYEN    | Sanitization insuffisante       |
| F-1 | `app.js`                             | 32       | FAIBLE   | CSP désactivée                  |
| F-2 | `app.js`                             | 37       | FAIBLE   | CORS trop permissif             |
| F-3 | `src/services/authService.js`        | 12–13    | FAIBLE   | sameSite lax sur cookies auth   |
| F-4 | `app.js`                             | 49       | FAIBLE   | Session cookie trop longue      |
| F-5 | `src/routes/*.js`                    | —        | FAIBLE   | Params UUID non validés         |
| F-6 | `src/controllers/authController.js`  | 94       | FAIBLE   | Code démo en production         |

---

# Plan de remédiation prioritaire

## Sprint immédiat (avant tout déploiement production)

1. **C-1** — Retirer les tokens des messages flash. Les envoyer uniquement par email.
2. **C-2** — Lever une erreur explicite au démarrage si les secrets ne sont pas définis en production.
3. **C-3** — Ajouter `{ algorithms: ["HS256"] }` dans les deux appels `jwt.verify()`.
4. **E-6** — Redacter les champs sensibles (password, token) avant de logger le body.

## Sprint 48h

5. **E-1/E-2/E-3** — Remplacer tous les `...req.body` par des whitelists explicites.
6. **E-4/E-5** — Valider que les URLs sont `https://` avant stockage.
7. **E-7** — En production, ne passer au template que `{ message, code }` et non l'objet erreur entier.

## Sprint semaine

8. **M-1** — Réduire le rate limit login à 5 essais.
9. **M-2** — Remplacer `trust proxy: true` par `trust proxy: 1` ou l'IP du proxy réel.
10. **M-3** — Uniformiser les messages de reset password.
11. **M-4** — Échapper les caractères LIKE (`%`, `_`) dans les filtres.
12. **M-5** — Ajouter `max: 128` sur le validator password, et `max: 100` sur les noms.
13. **M-6** — Encoder à la sortie dans les templates EJS (toujours `<%= %>`, jamais `<%-` pour les données user).

## Prochain sprint

14. **F-1** — Activer CSP dans helmet.
15. **F-2** — Restreindre les origines CORS à `env.appUrl`.
16. **F-3/F-4** — `sameSite: "strict"`, réduire maxAge session.
17. **F-5** — Ajouter `param("id").isUUID(4)` sur les routes sensibles.

---

*Rapport généré par analyse statique manuelle — Zando243 — 2026-03-29*
