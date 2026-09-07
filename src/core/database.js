// 一站式数模工坊 — 数据库核心（better-sqlite3 + AES-256-GCM 加密，仅 settings/app_state 两表）
const path = require('path');
const fs = require('fs');
const dbCrypto = require('./crypto');

let db = null;

function init(rootDir) {
  let dataDir;
  try {
    const { app } = require('electron');
    dataDir = path.join(app.getPath('userData'), 'data');
  } catch(e) {
    dataDir = path.join(rootDir, '.gongfang-data');
  }
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const Database = require('better-sqlite3');
  const dbPath = path.join(dataDir, 'gongfang.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── 建表 ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

  `);
  // ★ 已删除账号隔离迁移与用量回填：相关表已下线
  Object.assign(db, {
    getSetting, setSetting, getAllSettings,
  });

  return { db, dataDir };
}

// ── 通用 helpers ──

// ★ 明文存储白名单：赛题信息 / 写作设置等非敏感字段。
//   这些值从界面到模板关键词全程明文传递（模板里 \group{} \tihao{} \schoolname{} 等直接注入，
//   不走提示词）。若加密存储，读取路径漏解密时会把密文直接写进模板/CLAUDE.md，编译出来就是
//   一串 hex 乱码（见 P1 封面乱码修复）。敏感凭据（apiKey/inviteCode 等）仍保持加密。
const PLAINTEXT_SETTING_KEYS = new Set([
  'teamCode', 'group', 'problemNumber', 'school', 'members', 'advisor',
  'enableTeamCode', 'enableGroup', 'enableProblemNum', 'enableSchool',
  'enableMembers', 'enableAdvisor', 'enableStyle', 'stylePrompt', 'writingLang',
]);

function _parse(v) {
  if (typeof v !== 'string') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if ((v.startsWith('{') || v.startsWith('[')) && (v.endsWith('}') || v.endsWith(']'))) {
    try { return JSON.parse(v); } catch(e) { /* 普通字符串 */ }
  }
  return v;
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  // decrypt() 对明文（无冒号/非三段密文）原样返回，对历史密文自动解密，两者兼容
  return row ? _parse(dbCrypto.decrypt(row.value)) : fallback;
}

function setSetting(key, value) {
  var serialized = (typeof value === 'string') ? value : JSON.stringify(value);
  // 白名单字段明文存储（明文传递的赛题信息），其余仍 AES-GCM 加密
  const stored = PLAINTEXT_SETTING_KEYS.has(key) ? serialized : dbCrypto.encrypt(serialized);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = _parse(dbCrypto.decrypt(r.value));
  return out;
}

function close() {
  if (db) { db.close(); db = null; }
}

module.exports = {
  init, close,
  getSetting, setSetting, getAllSettings,
};
