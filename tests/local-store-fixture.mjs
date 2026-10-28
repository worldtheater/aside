// Test fixtures use the logical store shape; production storage remains encrypted.
// Bypass edit timestamps/tombstones when seeding or restoring an isolated profile.
import {
  PROTECTED_CONFIGURATION,
  encryptCredentials,
  decryptCredentials,
} from "../credential-store.js";
export const localStore = {
  async get(keys) {
    const raw = await chrome.storage.local.get(null);
    const encrypted = raw[PROTECTED_CONFIGURATION];
    const data = {
      ...raw,
      ...(encrypted
        ? JSON.parse(await decryptCredentials(encrypted))
        : { credentials: {} }),
    };
    if (keys == null) return data;
    return Object.fromEntries(
      (typeof keys === "string" ? [keys] : keys).map((key) => [key, data[key]]),
    );
  },
  async set(values) {
    const { credentials, configurationRecords, ...plain } = values;
    if ("credentials" in values || "configurationRecords" in values) {
      const current = await this.get(["credentials", "configurationRecords"]);
      plain[PROTECTED_CONFIGURATION] = await encryptCredentials(
        JSON.stringify({
          credentials:
            "credentials" in values ? credentials : current.credentials,
          configurationRecords:
            "configurationRecords" in values
              ? configurationRecords
              : current.configurationRecords,
        }),
      );
    }
    await chrome.storage.local.set(plain);
  },
};
