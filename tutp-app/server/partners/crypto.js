// Encryption at rest for partner data (TUT-49): name, phone, PAN, UPI.
// AES-256-GCM, a fresh random IV per value, format "v1.<iv>.<tag>.<ciphertext>"
// (base64url). The key comes from PARTNER_DATA_KEY (Secret Manager secret
// partner-data-key); two sub-keys are derived from it with HKDF, one to
// encrypt and one to hash phones for lookup. With no key there is NO plaintext
// fallback: createVault returns null and the partner routes answer 503.
import crypto from 'crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

export function createVault(secret) {
  if (typeof secret !== 'string' || secret.length < 32) return null;
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('tutp-partners'), Buffer.from(info), 32));
  const encKey = derive('enc-v1');
  const hashKey = derive('phone-hash-v1');
  return {
    encrypt(plain) {
      if (plain === null || plain === undefined) return null;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
    },
    decrypt(value) {
      if (value === null || value === undefined) return null;
      const [v, iv, tag, ct] = String(value).split('.');
      if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad ciphertext');
      const d = crypto.createDecipheriv('aes-256-gcm', encKey, unb64(iv));
      d.setAuthTag(unb64(tag));
      return Buffer.concat([d.update(unb64(ct)), d.final()]).toString('utf8');
    },
    // Hash of the 10-digit phone (same normalisation as the rest of the app: last 10 digits).
    phoneHash(phone) {
      const ten = String(phone || '').replace(/\D/g, '').slice(-10);
      return ten.length === 10 ? crypto.createHmac('sha256', hashKey).update(ten).digest('hex') : null;
    },
    // Invite tokens are random; only this hash is stored.
    tokenHash(token) { return crypto.createHmac('sha256', hashKey).update('token:' + String(token)).digest('hex'); },
  };
}
