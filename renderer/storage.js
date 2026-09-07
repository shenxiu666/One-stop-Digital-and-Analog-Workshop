// 一站式数模工坊 — 设置存取（localStorage + DB 同步，仅主题/环境配置）
window.Gongfang = window.Gongfang || {};

Gongfang.loadSettings = function() {
  try {
    var raw = localStorage.getItem('app-settings');
    if (raw) {
      var data = JSON.parse(raw);
      Gongfang.STATE.settings = Object.assign({}, Gongfang.STATE.settings, data);
    }
  } catch {}
  setTimeout(async function() {
    try {
      if (window.electronAPI && window.electronAPI.dbGetSettings) {
        var result = await window.electronAPI.dbGetSettings();
        if (result && result.success && result.settings) {
          var db = result.settings;
          for (var k in db) {
            if (db[k] === 'true') db[k] = true;
            else if (db[k] === 'false') db[k] = false;
          }
          delete db._runStatus;
          Gongfang.STATE.settings = Object.assign({}, Gongfang.STATE.settings, db);
          localStorage.setItem('app-settings', JSON.stringify(Gongfang.STATE.settings));
          Gongfang.renderSettings();
        }
      }
    } catch {}
  }, 500);
};

Gongfang.saveSettings = function() {
  var full = Object.assign({}, Gongfang.STATE.settings);
  try { localStorage.setItem('app-settings', JSON.stringify(full)); } catch {}
  try {
    if (window.electronAPI && window.electronAPI.dbSaveSettings) {
      window.electronAPI.dbSaveSettings(full);
    }
  } catch {}
};

Gongfang.renderSettings = function() {
  var s = Gongfang.STATE.settings;
  // ★ 应用已保存的主题（启动/打开设置时）
  if (typeof Gongfang._applyTheme === 'function') Gongfang._applyTheme((s && s.theme) || 'default');
};
