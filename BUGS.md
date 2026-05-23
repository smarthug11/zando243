# Bugs à corriger

## BUG-001 - Vérification email impossible avant paiement

**Statut :** ✅ Résolu (23/05/2026, via migration Better Auth)
**Priorité :** Haute
**Zone :** Checkout / Authentification / Compte client

### Résolution

La migration vers Better Auth a réglé ce bug nativement : le hook `sendVerificationEmail` dans `src/auth-be/index.mjs` est appelé automatiquement à chaque `signUpEmail` (option `sendOnSignUp: true`), via le SMTP configuré dans `.env`. Le user reçoit un lien `/api/auth/verify-email?token=...` qui marque son compte vérifié et déclenche le hook `afterHook` côté `users` (mise à jour de `emailVerifiedAt`).

Aucune action UI supplémentaire n'a été nécessaire — Better Auth gère le flow de bout en bout.

---

### Contexte historique du bug (avant migration)

### Problème

Le checkout bloque les clients dont l'email n'est pas vérifié avec l'erreur :

> Veuillez vérifier votre adresse email avant de passer commande.

Ce blocage concerne les trois moyens de paiement disponibles au checkout :

- Cash on delivery
- Card / PayPal
- Mobile Money

Le contrôle métier existe bien dans `src/services/orderService.js`, mais l'utilisateur n'a pas de parcours clair pour vérifier son email.

### Impact utilisateur

Un client peut créer un compte, se connecter, ajouter des produits au panier, puis se retrouver bloqué au moment du paiement sans action disponible pour résoudre le problème depuis l'interface.

### Constat technique

- La route backend de vérification existe : `GET /auth/verify-email/:token`.
- Le service `verifyEmailToken()` met bien `emailVerifiedAt` à jour.
- La page compte affiche seulement si l'email est vérifié ou non.
- Aucun bouton visible ne permet de renvoyer un email de vérification.
- L'admin clients permet de bloquer/débloquer un compte, mais pas de marquer l'email comme vérifié.
- L'email de vérification semble annoncé à l'inscription, mais aucun envoi effectif du lien de vérification n'a été confirmé.

### Comportement attendu

Un client dont l'email n'est pas vérifié doit pouvoir terminer le parcours de vérification sans intervention technique manuelle.

Options possibles :

- envoyer réellement un email de vérification à l'inscription ;
- ajouter un bouton "Renvoyer l'email de vérification" dans le compte client ;
- afficher une action claire quand le checkout est refusé pour email non vérifié ;
- éventuellement ajouter une action admin pour marquer un email comme vérifié en support client.

### Reproduction

1. Créer ou utiliser un compte client avec `email_verified_at = null`.
2. Se connecter.
3. Ajouter un produit au panier.
4. Cliquer sur un moyen de paiement, par exemple Mobile Money.
5. Observer l'erreur 403 : `EMAIL_NOT_VERIFIED`.

### Notes

En local, le contournement temporaire consiste à mettre manuellement `email_verified_at` à une date en base, mais ce n'est pas acceptable comme parcours produit.
