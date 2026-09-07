// 一站式数模工坊 — 持久化运行日志
// 写入 userData/logs/gongfang-YYYY-MM-DD.log，按天分文件；启动时删除超过 1 天的旧日志。
// 记录主进程关键事件（启动/任务/路由/代理转发/agent/错误）+ 渲染层 console，方便事后排查。
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let logDir = '';
let logFile = '';
let inited = false;

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function getLogDir() {
  if (logDir) return logDir;
  try { logDir = path.join(app.getPath('userData'), 'logs'); }
  catch { logDir = path.join(process.env.APPDATA || '.', 'gongfang-logs'); }
  return logDir;
}

function ensureLogFile() {
  const day = todayStr();
  if (inited && logFile && logFile.indexOf(day) >= 0) return;
  try { fs.mkdirSync(getLogDir(), { recursive: true }); } catch {}
  logFile = path.join(getLogDir(), 'gongfang-' + day + '.log');
  inited = true;
}

// ★ 轮转：删除超过 1 天的日志文件（应用启动时调用）
function rotate() {
  try {
    ensureLogFile();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    if (!fs.existsSync(getLogDir())) return;
    fs.readdirSync(getLogDir()).forEach(function (f) {
      if (!/^gongfang-.*\.log$/.test(f)) return;
      const fp = path.join(getLogDir(), f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch {}
    });
  } catch {}
}

function write(level, msg) {
  try {
    ensureLogFile();
    const line = '[' + new Date().toISOString() + '][' + level + '] ' + msg;
    try { console.log(line); } catch {}
    try { fs.appendFileSync(logFile, line + '\n', 'utf-8'); } catch {}
  } catch {}
}

function log(msg) { write('INFO', msg); }
function warn(msg) { write('WARN', msg); }
function error(msg, err) {
  const detail = err && (err.stack || err.message) ? '\n  ' + (err.stack || err.message) : '';
  write('ERROR', msg + detail);
}

module.exports = { init: rotate, rotate, log, warn, error, write, getLogDir, getLogFile: () => logFile };
