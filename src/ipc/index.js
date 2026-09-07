// 一站式数模工坊 — IPC 路由统一注册（无任务/模板）
const fileHandlers = require('./file');
const settingsHandlers = require('./settings');
const systemHandlers = require('./system');
const writeHandlers = require('./write');
const codeHandlers = require('./code');
const collabHandlers = require('./collab');
const extensionHandlers = require('./extension');
const workshopHandlers = require('./workshop');

function registerAll(ctx) {
  fileHandlers.register(ctx);
  settingsHandlers.register(ctx);
  systemHandlers.register(ctx);
  writeHandlers.register(ctx);
  codeHandlers.register(ctx);
  collabHandlers.register(ctx);
  extensionHandlers.register(ctx);
  workshopHandlers.register(ctx);
}

module.exports = { registerAll };
