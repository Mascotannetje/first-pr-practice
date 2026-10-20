// Opslag van claims. In deze demo in localStorage van de browser;
// vervang dit door API-calls naar een backend voor productiegebruik.
import { generateClaimNumber, normalizeClaimNumber, normalizeEmail } from './claims.js';

const STORAGE_KEY = 'offseason.claims.v1';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

function defaultStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

export function createStore(storage = defaultStorage()) {
  function readAll() {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeAll(claims) {
    storage.setItem(STORAGE_KEY, JSON.stringify(claims));
  }

  return {
    list() {
      return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    add(claim) {
      const claims = readAll();
      const taken = new Set(claims.map((c) => c.number));
      let { number } = claim;
      while (taken.has(number)) number = generateClaimNumber();
      const stored = { ...claim, number };
      writeAll([...claims, stored]);
      return stored;
    },

    get(number) {
      const wanted = normalizeClaimNumber(number);
      return readAll().find((claim) => claim.number === wanted) ?? null;
    },

    // Klanten zien alleen een claim als claimnummer én e-mailadres kloppen.
    findForCustomer(number, email) {
      const claim = this.get(number);
      return claim && claim.order.email === normalizeEmail(email) ? claim : null;
    },

    save(claim) {
      writeAll(readAll().map((c) => (c.number === claim.number ? claim : c)));
      return claim;
    },
  };
}
