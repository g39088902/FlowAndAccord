/*
 * Flow & Accord · POI 产速本地偏好
 *
 * 必须在 rustworld.js 前加载：这里在任何 world_create 调用前读取 localStorage，
 * 以相同的世界种子和同一组倍率重开时，得到可复现的生态演化。
 */
(function (global) {
  'use strict';

  var STORE_KEY = 'flowaccord.poi-regen-rates.v1';
  var DEFAULTS = Object.freeze({ water: 1.0, berry: 1.0, wood: 1.0, stone: 1.0, gold: 1.0 });
  var KEYS = Object.keys(DEFAULTS);

  function normalize(raw) {
    var result = {};
    raw = raw && typeof raw === 'object' ? raw : {};
    KEYS.forEach(function (key) {
      var value = Number(raw[key]);
      // 与生态面板滑块一致：0~5 倍；非法/旧格式数据一律回退默认值。
      result[key] = Number.isFinite(value) && value >= 0 && value <= 5 ? value : DEFAULTS[key];
    });
    return result;
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && saved.schema === 1) return normalize(saved.multipliers);
    } catch (_) { /* localStorage 不可用或内容损坏时使用默认值 */ }
    return normalize();
  }

  var multipliers = load();
  global.FlowAccordPoiRates = {
    get: function () { return Object.assign({}, multipliers); },
    save: function (next) {
      multipliers = normalize(next);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ schema: 1, multipliers: multipliers }));
      } catch (_) { /* 隐私模式/配额异常不影响当前世界 */ }
      return this.get();
    },
    reset: function () { return this.save(DEFAULTS); },
  };
})(window);
