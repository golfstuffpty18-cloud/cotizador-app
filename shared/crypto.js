// Cifrado simétrico para credenciales por empresa (company_secrets) — un
// salto real sobre guardarlas en texto plano en .env/variables de entorno,
// aunque no es nivel KMS (una sola llave, sin rotación). Razonable para
// "pocas empresas de confianza"; se puede reforzar más adelante sin cambiar
// el resto del código, solo estas dos funciones.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error('Falta SECRET_ENCRYPTION_KEY en el entorno');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres)');
  }
  return key;
}

function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptSecret(ciphertextB64) {
  if (ciphertextB64 == null || ciphertextB64 === '') return null;
  const data = Buffer.from(ciphertextB64, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
