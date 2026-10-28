const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aside-credentials-"));
const secret = "legacy-api-key-fixture";
let context;
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.headers.authorization);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [{ id: "fixture-model", object: "model" }] }));
});
async function start() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: root });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/index.html#connections`);
  await page.locator("h1").waitFor();
  return page;
}
async function raw(page) {
  return page.evaluate(() => chrome.storage.local.get(null));
}
async function readable(page) {
  return page.evaluate(async () => (await import("./store.js")).readStore());
}
(async () => {
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    let page = await start();
    console.log("Credential fixture browser ready");
    // Concurrent contexts must settle on one persistent device key.
    const other = await context.newPage();
    await other.goto(page.url());
    const encrypted = await Promise.all(
      [page, other].map((p) =>
        p.evaluate(async () => {
          const { encryptCredentials } = await import("./credential-store.js");
          return encryptCredentials("concurrent-key-fixture");
        }),
      ),
    );
    for (const value of encrypted) {
      assert.equal(
        await page.evaluate(async (value) => {
          const { decryptCredentials } = await import("./credential-store.js");
          return decryptCredentials(value);
        }, value),
        "concurrent-key-fixture",
      );
    }
    await other.close();
    const seeded = await page.evaluate(
      async ({ secret, url }) => {
        const { readStore } = await import("./store.js");
        const { initializeSyncRecords } = await import("./sync-records.js");
        const data = await readStore();
        data.settings.connections = [
          {
            id: "legacy",
            name: "Legacy",
            url,
            model: "fixture-model",
            models: [{ id: "fixture-model", name: "fixture-model" }],
            protocol: "chat",
            maxTokens: 1024,
            connected: true,
          },
        ];
        data.settings.defaultConnection = "legacy";
        data.credentials = { legacy: secret };
        data.collection = [{ id: "kept", text: "Keep the local collection" }];
        initializeSyncRecords(data);
        await chrome.storage.local.set(data);
        return data;
      },
      { secret, url },
    );
    assert(
      JSON.stringify(await raw(page)).includes(secret),
      "Simulates the shipped plaintext storage",
    );
    await context.close();
    page = await start();
    console.log("Credential fixture browser restarted");
    let stored = await raw(page);
    assert(!JSON.stringify(stored).includes(secret));
    assert(!("credentials" in stored));
    assert(!("configurationRecords" in stored));
    assert.equal(stored.protectedConfiguration.version, 1);
    assert.deepEqual(
      await readable(page),
      seeded,
      "Upgrade preserves credentials, sync metadata and settings",
    );
    const keyInfo = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("aside-credentials", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const key = await new Promise((resolve) => {
        const request = db
          .transaction("keys")
          .objectStore("keys")
          .get("device");
        request.onsuccess = () => resolve(request.result);
      });
      let exported = false;
      try {
        await crypto.subtle.exportKey("raw", key);
        exported = true;
      } catch {}
      db.close();
      return {
        extractable: key.extractable,
        exported,
        algorithm: key.algorithm,
      };
    });
    assert.equal(keyInfo.extractable, false);
    assert.equal(keyInfo.exported, false);
    assert.deepEqual(keyInfo.algorithm, { name: "AES-GCM", length: 256 });
    // Repeated reads and unrelated/no-op edits do not churn ciphertext or sync events.
    await page.evaluate(async () => {
      const { readStore, mutate } = await import("./store.js");
      await readStore();
      await readStore();
      await mutate(() => {});
      await mutate((data) => {
        data.settings.preferences.theme = "dark";
      });
    });
    assert.deepEqual(
      (await raw(page)).protectedConfiguration,
      stored.protectedConfiguration,
    );
    assert(
      !JSON.stringify(
        await page.evaluate(() =>
          chrome.runtime.sendMessage({ type: "snapshot" }),
        ),
      ).includes(secret),
    );
    // A model-list request after a real browser restart still uses the migrated key.
    const manager = await context.newPage();
    await manager.goto("chrome://extensions");
    await manager.evaluate(() =>
      chrome.developerPrivate.updateProfileConfiguration({
        inDeveloperMode: true,
      }),
    );
    await manager.evaluate(
      ({ id, origin }) => chrome.developerPrivate.addHostPermission(id, origin),
      {
        id: new URL(page.url()).hostname,
        origin: new URL(url).origin + "/*",
      },
    );
    await manager.close();
    const models = await page.evaluate(async (url) => {
      await chrome.permissions.request({
        origins: [new URL(url).origin + "/*"],
      });
      return chrome.runtime.sendMessage({
        type: "connection.test",
        connection: { id: "legacy", url, protocol: "chat" },
      });
    }, url);
    assert(models.ok, JSON.stringify(models));
    assert.equal(requests.at(-1), `Bearer ${secret}`);
    const edited = await page.evaluate(async () => {
      const { readStore } = await import("./store.js");
      const connection = (await readStore()).settings.connections[0];
      return chrome.runtime.sendMessage({
        type: "connection.save",
        connection,
        key: "rotated-api-key-fixture",
      });
    });
    assert(edited.ok, JSON.stringify(edited));
    const rotated = await readable(page);
    assert.equal(rotated.credentials.legacy, "rotated-api-key-fixture");
    assert.equal(
      rotated.configurationRecords.data.connections.legacy.value.key,
      "rotated-api-key-fixture",
    );
    stored = await raw(page);
    assert(!JSON.stringify(stored).includes("rotated-api-key-fixture"));
    await context.close();
    page = await start();
    console.log("Credential fixture browser restarted");
    assert.equal(
      (await readable(page)).credentials.legacy,
      "rotated-api-key-fixture",
      "Key persists across another browser restart",
    );
    assert.deepEqual(
      (await raw(page)).protectedConfiguration,
      stored.protectedConfiguration,
    );
    // Authenticated corruption and a lost device key must fail without replacing data.
    const good = stored.protectedConfiguration;
    const damaged = {
      ...good,
      ciphertext:
        (good.ciphertext[0] === "A" ? "B" : "A") + good.ciphertext.slice(1),
    };
    await page.evaluate(
      (value) => chrome.storage.local.set({ protectedConfiguration: value }),
      damaged,
    );
    const failure = await page.evaluate(async () => {
      const { readStore, mutate } = await import("./store.js");
      const results = [];
      for (const operation of [
        () => readStore(),
        () =>
          mutate((data) => {
            data.credentials.legacy = "must-not-save";
          }),
      ]) {
        try {
          await operation();
          results.push("unexpected success");
        } catch (error) {
          results.push(error.code);
        }
      }
      return results;
    });
    assert.deepEqual(failure, [
      "credentialsUnavailable",
      "credentialsUnavailable",
    ]);
    assert.deepEqual((await raw(page)).protectedConfiguration, damaged);
    await page.evaluate(
      (value) => chrome.storage.local.set({ protectedConfiguration: value }),
      good,
    );
    const removed = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "connection.remove", id: "legacy" }),
    );
    assert(removed.ok);
    const deleted = await readable(page);
    assert.equal(deleted.credentials.legacy, undefined);
    assert.equal(
      deleted.configurationRecords.data.connections.legacy.value,
      null,
    );
    assert(
      !JSON.stringify(await raw(page)).includes("rotated-api-key-fixture"),
    );
    const beforeLostKey = await raw(page);
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open("aside-credentials", 1);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").delete("device");
        tx.oncomplete = resolve;
        tx.onabort = reject;
      });
      db.close();
    });
    assert.equal(
      await page.evaluate(async () => {
        try {
          await (await import("./store.js")).readStore();
          return "unexpected success";
        } catch (error) {
          return error.code;
        }
      }),
      "credentialsUnavailable",
    );
    assert.deepEqual(await raw(page), beforeLostKey);
    console.log(
      "PASS: plaintext upgrade, protected sync replicas, non-exportable/concurrent device key, browser restart, model authentication, key rotation/deletion, stable no-op ciphertext, public snapshot redaction, corruption and missing-key preservation.",
    );
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
