// Gongfang v2.6 — 对话框组件
window.Gongfang = window.Gongfang || {};

Gongfang._showToast = function(msg) {
  var old = document.querySelector('.gongfang-toast');
  if (old) old.remove();
  var t = document.createElement('div');
  t.className = 'gongfang-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 1800);
};

Gongfang._showAlert = function(options) {
  var opts = Object.assign({
    title: '提示', desc: '', type: 'info',
    btnText: '知道了', secondaryBtnText: null, secondaryBtnCallback: null
  }, options);

  var iconSvgs = {
    warn: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
    info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
  };

  var secondaryHtml = opts.secondaryBtnText
    ? '<button class="modal-btn modal-btn-secondary" id="modalSecondary">' + Gongfang.escHtml(opts.secondaryBtnText) + '</button>'
    : '';

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-box">' +
    '<div class="modal-icon ' + opts.type + '">' + (iconSvgs[opts.type] || 'ℹ️') + '</div>' +
    '<div class="modal-title">' + Gongfang.escHtml(opts.title) + '</div>' +
    '<div class="modal-desc">' + Gongfang.escHtml(opts.desc) + '</div>' +
    '<div class="modal-btns">' + secondaryHtml +
      '<button class="modal-btn modal-btn-primary" id="modalOk">' + Gongfang.escHtml(opts.btnText) + '</button>' +
    '</div></div>';

  document.body.appendChild(overlay);
  function close() { overlay.style.opacity = '0'; setTimeout(function() { overlay.remove(); }, 200); }
  document.getElementById('modalOk').onclick = close;
  var secondary = document.getElementById('modalSecondary');
  if (secondary && opts.secondaryBtnCallback) secondary.onclick = function() { close(); opts.secondaryBtnCallback(); };
  overlay.onclick = function(e) { if (e.target === overlay) close(); };
};

Gongfang._showConfirm = function(options) {
  return new Promise(function(resolve) {
    var opts = Object.assign({
      title: '确认操作', desc: '确定要执行此操作吗？', type: 'warn',
      confirmText: '确定', cancelText: '取消', confirmClass: 'modal-btn-confirm'
    }, options);

    var iconSvgs = {
      warn: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      danger: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
      info: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-box' + (opts.size === 'lg' ? ' modal-box-lg' : '') + '">' +
      '<div class="modal-icon ' + opts.type + '">' + (iconSvgs[opts.type] || '⚠️') + '</div>' +
      '<div class="modal-title">' + Gongfang.escHtml(opts.title) + '</div>' +
      // ★ descHtml：支持带样式/换行的富文本描述（不转义）；desc 为纯文本转义
      '<div class="modal-desc">' + (opts.descHtml ? opts.descHtml : Gongfang.escHtml(opts.desc)) + '</div>' +
      '<div class="modal-btns">' +
        '<button class="modal-btn modal-btn-cancel" id="modalCancel">' + Gongfang.escHtml(opts.cancelText) + '</button>' +
        '<button class="modal-btn ' + opts.confirmClass + '" id="modalConfirm">' + Gongfang.escHtml(opts.confirmText) + '</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
    function close(result) { overlay.style.opacity = '0'; setTimeout(function() { overlay.remove(); }, 200); resolve(result); }
    document.getElementById('modalCancel').onclick = function() { close(false); };
    document.getElementById('modalConfirm').onclick = function() { close(true); };
    overlay.onclick = function(e) { if (e.target === overlay) close(false); };
  });
};

// ★ 输入弹窗：Electron 渲染进程不支持 window.prompt，用应用内模态代替（Enter 确认 / Esc 取消）
Gongfang._showPrompt = function(options) {
  return new Promise(function(resolve) {
    var opts = Object.assign({
      title: '输入', desc: '', value: '', placeholder: '',
      confirmText: '确定', cancelText: '取消', confirmClass: 'modal-btn-confirm',
      validate: null
    }, options);

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-box">' +
      '<div class="modal-title">' + Gongfang.escHtml(opts.title) + '</div>' +
      (opts.desc ? '<div class="modal-desc">' + Gongfang.escHtml(opts.desc) + '</div>' : '') +
      '<div class="modal-input-wrap"><input class="modal-input" id="modalPromptInput" type="text" value="' + Gongfang.escAttr(opts.value) + '" placeholder="' + Gongfang.escAttr(opts.placeholder) + '" spellcheck="false"></div>' +
      '<div class="modal-btns">' +
        '<button class="modal-btn modal-btn-cancel" id="modalPromptCancel">' + Gongfang.escHtml(opts.cancelText) + '</button>' +
        '<button class="modal-btn ' + opts.confirmClass + '" id="modalPromptOk">' + Gongfang.escHtml(opts.confirmText) + '</button>' +
      '</div></div>';

    document.body.appendChild(overlay);
    var inp = document.getElementById('modalPromptInput');
    function close(result) { overlay.style.opacity = '0'; setTimeout(function() { overlay.remove(); }, 200); resolve(result); }
    document.getElementById('modalPromptCancel').onclick = function() { close(null); };
    document.getElementById('modalPromptOk').onclick = function() {
      var v = inp.value;
      if (opts.validate && !opts.validate(v)) { inp.focus(); return; }
      close(v);
    };
    overlay.onclick = function(e) { if (e.target === overlay) close(null); };
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('modalPromptOk').click();
      else if (e.key === 'Escape') close(null);
    });
    setTimeout(function() { inp.focus(); inp.select(); }, 60);
  });
};

// ★ 下拉选择弹窗（返回选中 value；取消/关闭返回 null）。options = [{value,label}]
//   用「可滚动选项列表」替代原生 <select>，避免下拉弹出到窗口外部；超过高度在内部上下滚动。
Gongfang._showSelectMenu = function(options) {
  return new Promise(function(resolve) {
    var opts = Object.assign({ title: '选择', desc: '', options: [], confirmText: '确定', cancelText: '取消' }, options);
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var optsHtml = (opts.options || []).map(function(o) {
      return '<button type="button" class="modal-option" data-v="' + Gongfang.escAttr(o.value) + '">' + Gongfang.escHtml(o.label) + '</button>';
    }).join('');
    overlay.innerHTML = '<div class="modal-box modal-box--chosen">' +
      '<div class="modal-title">' + Gongfang.escHtml(opts.title) + '</div>' +
      (opts.desc ? '<div class="modal-desc">' + Gongfang.escHtml(opts.desc) + '</div>' : '') +
      '<div class="modal-option-list">' + optsHtml + '</div>' +
      '<div class="modal-btns">' +
        '<button class="modal-btn modal-btn-cancel" id="modalSelCancel">' + Gongfang.escHtml(opts.cancelText) + '</button>' +
        '<button class="modal-btn modal-btn-confirm" id="modalSelOk">' + Gongfang.escHtml(opts.confirmText) + '</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    var chosen = (opts.options && opts.options.length) ? String(opts.options[0].value) : '';
    function highlight() {
      overlay.querySelectorAll('.modal-option').forEach(function(b) {
        b.classList.toggle('active', String(b.getAttribute('data-v')) === chosen);
      });
    }
    overlay.querySelectorAll('.modal-option').forEach(function(b) {
      b.onclick = function() { chosen = String(b.getAttribute('data-v')); highlight(); };
    });
    function close(v) { overlay.style.opacity = '0'; setTimeout(function() { overlay.remove(); }, 200); resolve(v); }
    document.getElementById('modalSelCancel').onclick = function() { close(null); };
    document.getElementById('modalSelOk').onclick = function() { close(chosen); };
    overlay.onclick = function(e) { if (e.target === overlay) close(null); };
    highlight();
    setTimeout(function() { var f = overlay.querySelector('.modal-option'); if (f) f.focus(); }, 60);
  });
};
