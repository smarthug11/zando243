const WEAK_PASSWORDS = new Set([
  "123456789012",
  "000000000000",
  "111111111111",
  "password123",
  "password1234",
  "password12345",
  "zando243",
  "zando243123",
  "zando2431234",
  "admin123456789",
  "qwerty123456"
]);

// Politique locale synchrone : longueur minimale, limite bcrypt, liste noire courte.
function validatePasswordPolicy(password) {
  const value = String(password || "");
  const normalized = value.toLowerCase().trim();

  if (value.length < 12) {
    return "Le mot de passe doit contenir au moins 12 caractères.";
  }

  if (Buffer.byteLength(value, "utf8") > 72) {
    return "Le mot de passe ne doit pas dépasser 72 octets UTF-8 afin d'éviter la troncature bcrypt.";
  }

  if (WEAK_PASSWORDS.has(normalized)) {
    return "Ce mot de passe est trop facile à deviner. Choisissez une phrase ou un mot de passe plus personnel.";
  }

  return null;
}

module.exports = { validatePasswordPolicy };
