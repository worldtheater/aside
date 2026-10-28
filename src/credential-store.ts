import { ModelError } from "./providers.js";

export const PROTECTED_CONFIGURATION = "protectedConfiguration";
export interface EncryptedConfiguration {
  version: 1;
  iv: string;
  ciphertext: string;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const aad = encoder.encode("aside.local-credentials.v1");
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("aside-credentials", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onerror = () => {
      database = undefined;
      reject(new ModelError("credentialsUnavailable"));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
  }));
}
async function readDeviceKey(): Promise<CryptoKey | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys");
    const request = tx.objectStore("keys").get("device");
    tx.oncomplete = () => resolve(request.result as CryptoKey | undefined);
    tx.onabort = () => reject(new ModelError("credentialsUnavailable"));
  });
}
async function ensureDeviceKey(): Promise<CryptoKey> {
  const existing = await readDeviceKey();
  if (existing) return existing;
  const candidate = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    // Recheck inside the write transaction so concurrent extension contexts
    // cannot overwrite a key that another context has already started using.
    const tx = db.transaction("keys", "readwrite");
    const store = tx.objectStore("keys");
    const request = store.get("device");
    let key: CryptoKey;
    request.onsuccess = () => {
      key = request.result ?? candidate;
      if (!request.result) store.add(key, "device");
    };
    tx.oncomplete = () => resolve(key);
    tx.onabort = () => reject(new ModelError("credentialsUnavailable"));
  });
}
const encode = (value: Uint8Array) =>
  btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export async function encryptCredentials(
  text: string,
): Promise<EncryptedConfiguration> {
  try {
    const key = await ensureDeviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      key,
      encoder.encode(text),
    );
    return {
      version: 1,
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
    };
  } catch {
    throw new ModelError("credentialsUnavailable");
  }
}
export async function decryptCredentials(
  stored: EncryptedConfiguration,
): Promise<string> {
  try {
    if (stored.version !== 1) throw new Error();
    const key = await readDeviceKey();
    // A missing key must never silently replace or discard existing credentials.
    if (!key) throw new Error();
    return decoder.decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(stored.iv), additionalData: aad },
        key,
        decode(stored.ciphertext),
      ),
    );
  } catch {
    throw new ModelError("credentialsUnavailable");
  }
}
