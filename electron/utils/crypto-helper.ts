import crypto from 'crypto';
import fs from 'fs';

const ENCRYPTED_MAGIC = 'CLAWX_ENCRYPTED_v1:';
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a JSON object to a string with magic header, IV, auth tag, and ciphertext
 */
export function encryptJson(data: any, keyHex: string): string {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Invalid config key length');
  }
  
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const jsonStr = JSON.stringify(data, null, 2);
  
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${ENCRYPTED_MAGIC}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string (checking for magic header) back to a JSON object
 */
export function decryptJson<T = any>(encryptedStr: string, keyHex: string): T {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Invalid config key length');
  }

  if (!encryptedStr.startsWith(ENCRYPTED_MAGIC)) {
    // If it's not encrypted, assume it's plain text (fallback)
    return JSON.parse(encryptedStr);
  }

  const parts = encryptedStr.substring(ENCRYPTED_MAGIC.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted config format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
}

/**
 * Read and decrypt a JSON file
 */
export async function readEncryptedJson<T = any>(filePath: string, keyHex: string): Promise<T> {
  const content = await fs.promises.readFile(filePath, 'utf8');
  return decryptJson<T>(content, keyHex);
}

/**
 * Encrypt and write a JSON file
 */
export async function writeEncryptedJson(filePath: string, data: any, keyHex: string): Promise<void> {
  const encryptedContent = encryptJson(data, keyHex);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, encryptedContent, 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

/**
 * Determine whether to encrypt config files at rest.
 * Currently disabled to mitigate .clobbered file issues in OpenClaw config observe.
 * TODO: when ready, change this to: return app.isPackaged && Boolean(keyHex)
 */
export function shouldEncryptConfigFilesAtRest(keyHex?: string | null): boolean {
  // temporarily force plaintext for both dev and packaged modes
  return false;
}
