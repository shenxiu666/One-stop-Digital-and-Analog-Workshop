// 一站式数模工坊 — 入口：事件绑定 + 启动

// ★ 性能诊断：渲染进程长任务监控
(function initPerfMonitor() {
  try {
    if ('PerformanceObserver' in window) {
      var po = new PerformanceObserver(function (list) {
        for (var i = 0; i < list.getEntries().length; i++) {
          var e = list.getEntries()[i];
          if (e.duration > 200) {
            console.log('[perf][renderer] 长任务 ' + e.duration.toFixed(0) + 'ms');
          }
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) {}
})();

// ★ 面板 HTML 拆分到 ui/ 目录，启动时 fetch 注入到 #panelArea（仅工坊三面板）
Gongfang._loadPanelsHTML = async function() {
  var panelArea = document.getElementById('panelArea');
  if (!panelArea) { console.error('[loader] #panelArea 不存在'); return; }
  var files = ['ui/write.html', 'ui/ext.html', 'ui/settings.html'];
  var html = '';
  for (var i = 0; i < files.length; i++) {
    try {
      var res = await fetch(files[i]);
      if (res.ok) html += await res.text();
      else console.error('[loader] 加载失败:', files[i], res.status);
    } catch (e) { console.error('[loader] 加载异常:', files[i], e); }
  }
  panelArea.innerHTML = html;
};

// ★ 面板可见性初始化（注入后调用）：默认显示工坊
Gongfang._initPanelsVisibility = function() {
  ['writePanel', 'extPanel', 'settingsPanel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var write = document.getElementById('writePanel');
  if (write) write.style.display = 'flex';
  Gongfang.STATE.activePanel = 'write';
};

Gongfang._getPanel = function(name) {
  var map = { write: 'writePanel', ext: 'extPanel', settings: 'settingsPanel' };
  return document.getElementById(map[name]) || null;
};

document.addEventListener('DOMContentLoaded', async function() {
  // ★ 启动动画
  (function runSplash() {
    var splash = document.getElementById("splashScreen");
    var brand = document.getElementById("splashBrand");
    var tag = document.getElementById("splashTag");
    if (!splash || !brand || !tag) return;

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        brand.style.transition = "transform .5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity .35s ease-out";
        brand.style.opacity = "1";
        brand.style.transform = "scale(1)";
      });
    });

    setTimeout(function() {
      brand.style.transition = "transform .4s cubic-bezier(0.22, 0.61, 0.36, 1)";
      brand.style.transform = "scale(1) translateY(-10px)";
      tag.style.transition = "opacity .35s ease-out, transform .4s cubic-bezier(0.22, 0.61, 0.36, 1)";
      tag.style.opacity = "1";
      tag.style.transform = "translateY(8px)";
    }, 500);

    setTimeout(function() {
      splash.style.transition = "opacity .25s ease-out";
      splash.style.opacity = "0";
      splash.style.pointerEvents = "none";
    }, 1200);

    setTimeout(function() {
      splash.style.display = "none";
    }, 1500);
  })();

  // ★ 注入面板 HTML，完成后初始化面板可见性
  await Gongfang._loadPanelsHTML();
  Gongfang._initPanelsVisibility();
  // ★ 默认即工坊：主动初始化写面板（宿主）+ 刷新工作目录缓存
  try { if (Gongfang._writeInit) Gongfang._writeInit(); } catch (e) { console.error('[init] _writeInit 失败:', e); }
  try { if (Gongfang._wsRefreshCache) Gongfang._wsRefreshCache(); } catch (e) {}
  if (typeof Gongfang._restorePluginBtns === 'function') Gongfang._restorePluginBtns();
  if (typeof Gongfang._loadExtensions === 'function' && (!Gongfang._extensions || !Gongfang._extensions.length)) {
    Gongfang._loadExtensions();
  }

  // ★ 版本号注入设置页
  (function injectVersion() {
    try {
      var ver = (window.electronAPI && window.electronAPI.getAppVersion) ? window.electronAPI.getAppVersion() : '';
      if (ver) {
        var els = document.querySelectorAll('.set-nav-app-ver');
        for (var i = 0; i < els.length; i++) els[i].textContent = 'v' + ver;
      }
    } catch (e) {}
  })();

  // ★ 加载设置（含环境配置回显）
  try { if (Gongfang.loadSettings) Gongfang.loadSettings(); } catch (e) {}

  // 全局入口（给 HTML inline onclick）
  window._openPanel = Gongfang.togglePanel;
});
