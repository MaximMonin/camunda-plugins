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

const certificateData = (certificate) => {
  const data = new crypto.X509Certificate(certificate);
  let obj = {
    ca: data.ca,
    subject: subjectObj (data.subject),
    subjectAltName: data.subjectAltName,
    issuer: subjectObj (data.issuer),
    infoAccess: data.infoAccess,
    validFrom: new Date(data.validFrom),
    validTo: new Date(data.validTo),
    fingerprint: data.fingerprint,
    fingerprint256: data.fingerprint256,
    fingerprint512: data.fingerprint512,
    keyUsage: data.keyUsage,
    serialNumber: data.serialNumber
  };
  return obj;
};

const subjectObj = (subject) => {
  let data = subject.split('\n');
  let obj = {};
  for (let i = 0; i<data.length; i++) {
    let key = data[i].split('=')[0];
    let value = '';
    if (data[i].split('=').length > 1) {
      value = data[i].split('=')[1];
    }
    obj[key] = value;
  }
  return obj;
}

module.exports = {
    encrypt,
    decrypt,
    certificateData
};
