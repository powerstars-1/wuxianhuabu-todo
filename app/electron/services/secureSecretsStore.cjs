const fs = require("node:fs");
const path = require("node:path");
const { safeStorage } = require("electron");

const SECRET_FILE_NAME = "secrets.json";
const SECRET_FILE_BACKUP_NAME = "secrets.json.bak";
const SECRET_FILE_TMP_NAME = "secrets.json.tmp";
const SECRET_FILE_ROLLBACK_NAME = "secrets.json.rollback";
const SECRET_SCHEMA_VERSION = 1;
const AI_API_KEY_SECRET_ID = "ai.openai-compatible.api-key";

const createEmptyStore = () => ({
  schemaVersion: SECRET_SCHEMA_VERSION,
  entries: {},
});

const safeUnlink = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    // Best-effort cleanup only.
  }
};

class SecureSecretsStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.filePath = path.join(baseDir, SECRET_FILE_NAME);
    this.backupFilePath = path.join(baseDir, SECRET_FILE_BACKUP_NAME);
    this.tmpFilePath = path.join(baseDir, SECRET_FILE_TMP_NAME);
    this.rollbackFilePath = path.join(baseDir, SECRET_FILE_ROLLBACK_NAME);
  }

  ensureStorage() {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  readStore() {
    this.ensureStorage();

    if (!fs.existsSync(this.filePath)) {
      return createEmptyStore();
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object") {
        return createEmptyStore();
      }

      return {
        schemaVersion: SECRET_SCHEMA_VERSION,
        entries:
          parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
      };
    } catch (error) {
      if (fs.existsSync(this.backupFilePath)) {
        try {
          const raw = fs.readFileSync(this.backupFilePath, "utf8");
          const parsed = JSON.parse(raw);

          return {
            schemaVersion: SECRET_SCHEMA_VERSION,
            entries:
              parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
          };
        } catch (backupError) {
          return createEmptyStore();
        }
      }

      return createEmptyStore();
    }
  }

  writeStore(store) {
    this.ensureStorage();

    const serialized = JSON.stringify(
      {
        schemaVersion: SECRET_SCHEMA_VERSION,
        entries: store.entries || {},
      },
      null,
      2,
    );

    JSON.parse(serialized);
    fs.writeFileSync(this.tmpFilePath, serialized, "utf8");

    safeUnlink(this.rollbackFilePath);

    if (fs.existsSync(this.filePath)) {
      fs.renameSync(this.filePath, this.rollbackFilePath);
    }

    try {
      fs.renameSync(this.tmpFilePath, this.filePath);
    } catch (error) {
      if (fs.existsSync(this.rollbackFilePath) && !fs.existsSync(this.filePath)) {
        fs.renameSync(this.rollbackFilePath, this.filePath);
      }
      safeUnlink(this.tmpFilePath);
      throw error;
    }

    try {
      fs.copyFileSync(this.filePath, this.backupFilePath);
    } catch (error) {
      // The main secret file is already committed. Backup refresh is best-effort.
    }

    safeUnlink(this.rollbackFilePath);
    safeUnlink(this.tmpFilePath);
  }

  ensureEncryptionAvailable() {
    if (safeStorage.isEncryptionAvailable()) {
      return;
    }

    throw new Error("SAFE_STORAGE_UNAVAILABLE");
  }

  setAiApiKey(apiKey) {
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";

    if (!normalizedApiKey) {
      this.deleteAiApiKey();
      return false;
    }

    this.ensureEncryptionAvailable();

    const store = this.readStore();
    store.entries[AI_API_KEY_SECRET_ID] = safeStorage
      .encryptString(normalizedApiKey)
      .toString("base64");
    this.writeStore(store);
    return true;
  }

  getAiApiKey() {
    const store = this.readStore();
    const encryptedValue = store.entries[AI_API_KEY_SECRET_ID];

    if (typeof encryptedValue !== "string" || !encryptedValue.trim()) {
      return "";
    }

    this.ensureEncryptionAvailable();

    try {
      return safeStorage.decryptString(Buffer.from(encryptedValue, "base64"));
    } catch (error) {
      return "";
    }
  }

  hasAiApiKey() {
    return Boolean(this.getAiApiKey());
  }

  deleteAiApiKey() {
    const store = this.readStore();

    if (!store.entries[AI_API_KEY_SECRET_ID]) {
      return false;
    }

    delete store.entries[AI_API_KEY_SECRET_ID];
    this.writeStore(store);
    return true;
  }
}

module.exports = {
  SecureSecretsStore,
};
