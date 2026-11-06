/* GFX References — Photoshop 연결 부분 (UXP)
 *
 * 포토샵에 무언가를 하는 코드만 모았습니다. 서버나 화면 코드는 없어서
 * 다른 플러그인에서도 이것만 떼어 쓸 수 있어요.
 *
 *   const host = GFXRef.photoshop.createPhotoshopHost();          // 포토샵 밖이면 host.available === false
 *   await host.placeAsLayer(file, { name: '#12 Glow (Riot)' });    // file = { data: ArrayBuffer, mime, filename }
 *   await host.setForegroundColor('#ff2030');
 *
 * 다른 플러그인에 이미 require('photoshop') / require('uxp') 가 있다면 넘겨 줄 수 있어요:
 *   createPhotoshopHost({ photoshop: require('photoshop'), uxp: require('uxp') })
 */
(function (factory) {
  var api = factory();
  var root = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this;
  if (root) (root.GFXRef = root.GFXRef || {}).photoshop = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(function () {
  'use strict';

  var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif', 'image/avif': 'avif' };

  function tryRequire(name) {
    try {
      return typeof require === 'function' ? require(name) : null;
    } catch (e) {
      return null;
    }
  }

  function hexToRgb(hex) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** 파일 이름에 쓸 수 없는 글자를 뺌 */
  function safeName(s) {
    return (
      String(s || 'gfx-ref')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
        .slice(0, 80) || 'gfx-ref'
    );
  }

  /**
   * options:
   *   photoshop, uxp   이미 불러온 모듈 (없으면 require 로 찾음)
   *   commandPrefix    작업 내역(History)에 보일 이름 앞에 붙는 말 (기본 'GFX')
   */
  function createPhotoshopHost(options) {
    options = options || {};
    var ps = options.photoshop || tryRequire('photoshop');
    var uxp = options.uxp || tryRequire('uxp');
    var prefix = options.commandPrefix || 'GFX';
    var available = !!(ps && uxp && ps.core && ps.app);

    function requireHost() {
      if (!available) {
        var e = new Error('포토샵 안에서만 사용할 수 있어요.');
        e.code = 'no_photoshop';
        throw e;
      }
    }

    /** 받은 원본을 플러그인 임시 폴더에 저장 */
    async function writeTemp(file) {
      var lfs = uxp.storage.localFileSystem;
      var folder = await lfs.getTemporaryFolder();
      var base = safeName(String(file.filename || '').replace(/\.[^.]+$/, ''));
      var entry = await folder.createFile(base + '.' + (EXT[file.mime] || 'png'), { overwrite: true });
      await entry.write(file.data, { format: uxp.storage.formats.binary });
      return entry;
    }

    function modal(name, fn) {
      return ps.core.executeAsModal(fn, { commandName: prefix + ' ' + name });
    }

    var host = {
      available: available,

      /** 열린 문서가 있는지 */
      hasDocument: function () {
        return available && ps.app.documents.length > 0;
      },

      /**
       * 현재 문서 가운데에 고급 개체(Smart Object) 레이어로 배치.
       * 열린 문서가 없으면 새 문서로 엶. 돌려주는 값: 'layer' 또는 'document'
       */
      placeAsLayer: async function (file, opts) {
        requireHost();
        opts = opts || {};
        var entry = await writeTemp(file);
        var result = 'layer';
        await modal('레퍼런스 불러오기', async function () {
          if (ps.app.documents.length === 0) {
            await ps.app.open(entry);
            result = 'document';
            return;
          }
          var token = uxp.storage.localFileSystem.createSessionToken(entry);
          await ps.action.batchPlay(
            [
              {
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
                _options: { dialogOptions: 'dontDisplay' },
              },
            ],
            {},
          );
          var doc = ps.app.activeDocument;
          var layer = doc && doc.activeLayers && doc.activeLayers[0];
          if (layer && opts.name) layer.name = opts.name;
        });
        return result;
      },

      /** 새 문서로 열기 */
      openAsDocument: async function (file) {
        requireHost();
        var entry = await writeTemp(file);
        await modal('레퍼런스 열기', async function () {
          await ps.app.open(entry);
        });
        return 'document';
      },

      /** 전경색 바꾸기 ('#rrggbb') */
      setForegroundColor: async function (hex) {
        requireHost();
        var rgb = hexToRgb(hex);
        await modal('전경색 설정', async function () {
          try {
            var c = new ps.app.SolidColor();
            c.rgb.red = rgb.r;
            c.rgb.green = rgb.g;
            c.rgb.blue = rgb.b;
            ps.app.foregroundColor = c;
          } catch (e) {
            // 예전 포토샵: batchPlay 로
            await ps.action.batchPlay(
              [
                {
                  _obj: 'set',
                  _target: [{ _ref: 'color', _property: 'foregroundColor' }],
                  to: { _obj: 'RGBColor', red: rgb.r, grain: rgb.g, blue: rgb.b },
                  source: 'photoshopPicker',
                  _options: { dialogOptions: 'dontDisplay' },
                },
              ],
              {},
            );
          }
        });
      },

      /** 브라우저로 주소 열기 (포토샵 밖에서는 새 창) */
      openUrl: function (url) {
        if (uxp && uxp.shell && uxp.shell.openExternal) return uxp.shell.openExternal(url, 'GFX References 사이트를 엽니다.');
        if (typeof window !== 'undefined' && window.open) window.open(url, '_blank');
      },

      /** 포토샵 화면 언어 ('ko' / 'en' …) — 모르면 null */
      locale: function () {
        try {
          return String((uxp && uxp.host && uxp.host.uiLocale) || '').slice(0, 2) || null;
        } catch (e) {
          return null;
        }
      },
    };
    return host;
  }

  return { createPhotoshopHost: createPhotoshopHost, hexToRgb: hexToRgb };
});
