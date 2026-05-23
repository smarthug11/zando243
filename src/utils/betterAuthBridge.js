let _modulePromise = null;

async function getBetterAuthModule() {
  if (!_modulePromise) _modulePromise = import("../auth-be/index.mjs");
  return _modulePromise;
}

async function getAuth() {
  const mod = await getBetterAuthModule();
  return mod.getAuth();
}

async function getNodeHelpers() {
  const mod = await getBetterAuthModule();
  return { toNodeHandler: mod.toNodeHandler, fromNodeHeaders: mod.fromNodeHeaders };
}

module.exports = { getBetterAuthModule, getAuth, getNodeHelpers };
