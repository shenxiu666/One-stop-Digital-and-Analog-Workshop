// Gongfang — 数据库字段加密模块
// 开源版：仅保留 DB 字段加密（机器码派生 AES-256-GCM）
// 已移除：模板加密（template-crypto 部分，死代码）
const crypto = require('crypto');
const os = require('os');

let gongfangCore = null;
try { gongfangCore = require('../../native/wrapper'); } catch {}

let _key = null, _machineCode = '';

function getMachineCode() {
  if (_machineCode) return _machineCode;
  const hostname = os.hostname();
  const cpuModel = (os.cpus()[0] || {}).model || '';
  const platform = os.platform() + '_' + os.arch();
  const totalMem = os.totalmem();
  if (gongfangCore && gongfangCore.isNativeLoaded()) {
    _machineCode = gongfangCore.generateMachineCode(hostname, cpuModel, platform, totalMem);
  } else {
    const seed = [hostname, cpuModel, platform, totalMem.toString(), 'gongfang-db-v1'].join('|');
    _key = crypto.createHash('sha256').update(seed).digest();
    _machineCode = crypto.createHash('sha256')
      .update([hostname, cpuModel, platform, String(totalMem)].join('|'))
      .digest('hex').substring(0, 16).toUpperCase();
  }
  return _machineCode;
}

function getMachineCodeForDb() { return getMachineCode(); }

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  try {
    const mc = getMachineCodeForDb();
    if (gongfangCore && gongfangCore.isNativeLoaded()) return gongfangCore.dbFieldEncrypt(plaintext, mc);
    const key = crypto.createHash('sha256').update(mc + '|gongfang-db-v1').digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + encrypted;
  } catch (e) { return plaintext; }
}

function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext.indexOf(':') < 0) return ciphertext;
  try {
    const mc = getMachineCodeForDb();
    if (gongfangCore && gongfangCore.isNativeLoaded()) return gongfangCore.dbFieldDecrypt(ciphertext, mc);
    const key = crypto.createHash('sha256').update(mc + '|gongfang-db-v1').digest();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) { return ciphertext; }
}

module.exports = {
  encrypt,
  decrypt,
  getMachineCode,
  getMachineCodeForDb,
};
