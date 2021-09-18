'use strict';

const crypto = require('crypto');

const algorithm = 'aes-256-ctr';
const secretKey = Buffer.from(process.env.CRYPTO_KEY, 'hex'); // must be 32 bytes length (openssl rand -hex 32)

const encrypt = (text, iv) => {
  if (iv.length > 16) {
    iv = iv.substring (0, 16);
  }
  if (iv.length < 16) {
    iv = iv + '#'.repeat(16 - iv.length);
  }
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return encrypted.toString('hex');
};

const decrypt = (hash, iv) => {
  if (iv.length > 16) {
    iv = iv.substring (0, 16);
  }
  if (iv.length < 16) {
    iv = iv + '#'.repeat(16 - iv.length);
  }
  const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
  const decrpyted = Buffer.concat([decipher.update(Buffer.from(hash, 'hex')), decipher.final()]);
  return decrpyted.toString();
};

module.exports = {
    encrypt,
    decrypt
};
