# Bugs — Zando243

Registre des bugs du projet. Les bugs **fonctionnels / sémantiques / de flux** issus de l'audit de juin 2026 sont listés en premier ; l'historique des bugs résolus suit.

Statuts : `✅ corrigé` · `🔒 réservé (test manuel utilisateur)` · `⏳ documenté (à tester puis corriger)`

---

## Bugs fonctionnels (audit du flux — juin 2026)

Audit du flux UI ↔ backend ↔ actions métier.

| # | Gravité | Statut | Zone | Résumé |
|---|---------|--------|------|--------|
| 1 | 🔴 | ✅ corrigé | `cartController` | checkout invité → redirection 404 |
| 2 | 🔴 | ✅ corrigé | `orderService.updateOrderStatus` | points fidélité crédités plusieurs fois |
| 3 | 🔴 | 🔒 réservé | `orderService.updateOrderStatus` | stock regonflé à chaque annulation |
| 4 | 🟠 | ⏳ | `orderService.createOrderFromCart` | PayPal abandonné = stock/coupon perdus |
| 5 | 🟠 | ⏳ | `orderService.updateOrderStatus` | pas de machine à états (transitions invalides) |
| 6 | 🟠 | ⏳ | `promoService.validateCoupon` | coupon invalide = page d'erreur, checkout perdu |
| 7 | 🟡 | ⏳ | `favoriteController` | « ajouter » est un toggle + redirect `referer` |
| 8 | 🟡 | ⏳ | `cartService.addItem` | stock produit simple non vérifié à l'ajout |
| 9 | 🟠 | ⏳ | `couponController` | coupon PERCENT > 100 % = commande gratuite |
| 10 | 🟠 | ⏳ | `adminCategoryService.deleteCategory` | supprimer une catégorie utilisée → 500/orphelins |
| 11 | 🟠 | ⏳ | `productController.productValidators` | produit sans SKU/catégorie → 500 |
| 12 | 🟡 | ⏳ | `cartService.computeCartTotals` | total panier ignore les 5 $ livraison porte |
| 13 | 🟡 | ⏳ | `adminProductService` | collision de slug produit → 500 |
| 14 | 🟠 | ⏳ | `updateOrderStatus` / refunds | statut « Refunded » ne rembourse rien |
| 15 | 🟡 | ⏳ | `adminReviewService.moderateReview` | action de modération non validée |

### 🔴 Critiques

#### BUG-1 — Checkout invité → page 404 — ✅ corrigé
- **Fichier** : `src/controllers/cartController.js` (`checkout` + `createCheckoutAddress`)
- **Bug** : `res.redirect("/auth/login")` — route inexistante (la vraie est `/auth2/login`).
- **Repro** : non connecté → panier → « Payer » → 404.
- **Correction appliquée** : redirection vers `/auth2/login` (2 occurrences). Tests `checkout.test.js` / `cart.test.js` réalignés.

#### BUG-2 — Points de fidélité crédités plusieurs fois — ✅ corrigé
- **Fichier** : `src/services/orderService.js` → `updateOrderStatus`
- **Bug** : garde `prevStatus !== "Delivered"` insuffisant. `Delivered → Shipped → Delivered` recrédite les points et recrée la notification.
- **Correction appliquée** : effets de livraison (points + notif) appliqués uniquement à la **1ʳᵉ** livraison, via comptage des entrées `OrderStatusHistory` de statut `Delivered` (`count === 1`), idempotent, sans migration. Compatible `tests/loyalty.test.js`.

#### BUG-3 — Stock regonflé à chaque annulation — 🔒 RÉSERVÉ (test manuel)
- **Fichier** : `src/services/orderService.js` → `updateOrderStatus`, bloc `if (status === "Cancelled")`
- **Bug** : aucun garde sur `prevStatus`. `Cancelled → Processing → Cancelled` (ou re-soumission de « Cancelled ») **incrémente le stock à chaque fois**.
- **Correction proposée (NON appliquée)** : ne restocker que sur la **transition** effective vers Cancelled, une seule fois (idéalement via la machine à états du BUG-5).
- ⚠️ **À NE PAS corriger pour l'instant — reproduction/test par l'utilisateur d'abord.**

### 🟠 Importants (documentés, à tester puis corriger)

#### BUG-4 — Paiement PayPal abandonné = stock + coupon perdus
`createOrderFromCart` décrémente le stock et consomme le coupon **à la création**, avant paiement. Une commande PENDING/FAILED abandonnée ne rend jamais le stock ni le coupon. → réserver le stock au paiement, ou annulation/expiration auto des commandes non payées.

#### BUG-5 — Pas de machine à états sur le statut commande
Whitelist de valeurs OK, mais aucune transition contrôlée (`Delivered → Processing`, etc.). Cause racine des BUG-2/3/14. → transitions légales ; `Delivered` et `Cancelled` terminaux ; effets idempotents.

#### BUG-6 — Coupon invalide casse le checkout
`validateCoupon` lève une `AppError 400` qui remonte à l'errorHandler → page d'erreur générique au lieu d'un message « coupon invalide ». → valider le coupon avant de lancer la commande, re-render le panier avec flash.

#### BUG-9 — Coupon PERCENT non plafonné à 100 %
`couponController` : `value` validé `min:0` sans `max:100` pour PERCENT → remise > 100 % → commande gratuite. → si `type === "PERCENT"`, exiger `value ≤ 100`.

#### BUG-10 — Supprimer une catégorie utilisée plante
`deleteCategory` sans garde. Produits (`categoryId` NOT NULL + FK) et sous-catégories → erreur FK (500) ou orphelins. → refuser si catégorie utilisée, ou réaffecter d'abord.

#### BUG-11 — Produit sans SKU/catégorie → 500
`productValidators` n'exige pas `sku`/`categoryId`, alors que le modèle les impose → violation DB (500) au lieu d'une validation propre. → ajouter `sku` et `categoryId` aux validators.

#### BUG-14 — « Refunded » / annulation d'une commande payée ne rembourse rien
`updateOrderStatus` ne gère pas `Refunded` ; annuler une commande payée restocke mais ne rend pas l'argent (pas d'appel API refund PayPal). Page refunds = lecture seule. → implémenter le remboursement réel (API PayPal) + reprise stock/points cohérente.

### 🟡 Mineurs (documentés, à tester puis corriger)

#### BUG-7 — « Ajouter aux favoris » est un toggle + redirect `referer`
`POST /favorites/:id` appelle `toggleFavorite` (2 clics = retire) ; redirection sur l'en-tête `referer` (contrôlable).

#### BUG-8 — Stock produit simple non vérifié à l'ajout panier
Seul le stock des variantes est vérifié à l'ajout ; un produit simple en rupture passe (bloqué seulement au checkout).

#### BUG-12 — Total panier ignore les 5 $ de livraison porte
`computeCartTotals` force `shippingFee = 0` ; le total affiché ≠ montant payé si livraison à domicile.

#### BUG-13 — Collision de slug produit → 500
`slug = toSlug(name)` sans suffixe d'unicité → violation `unique` si noms identiques.

#### BUG-15 — Modération d'avis sans whitelist d'action
Une action inconnue ne fait rien mais relance `recomputeProductRating`. → valider `action ∈ {delete, hide, unhide}`.

---

## Historique — bugs résolus

### BUG-001 — Vérification email impossible avant paiement
**Statut :** ✅ Résolu (23/05/2026, via migration Better Auth) · **Priorité :** Haute · **Zone :** Checkout / Authentification / Compte client

**Problème (avant migration) :** le checkout bloquait les clients dont l'email n'était pas vérifié (`EMAIL_NOT_VERIFIED`), sans parcours clair pour vérifier l'email depuis l'interface (pas d'envoi effectif, pas de bouton « renvoyer »).

**Résolution :** la migration vers Better Auth règle ce bug nativement — le hook `sendVerificationEmail` dans `src/auth-be/index.mjs` est appelé automatiquement à chaque `signUpEmail` (`sendOnSignUp: true`) via le SMTP de `.env`. Le lien `/api/auth/verify-email?token=...` marque le compte vérifié et déclenche le `afterHook` qui met à jour `emailVerifiedAt` côté `users`. Aucune action UI supplémentaire nécessaire.
