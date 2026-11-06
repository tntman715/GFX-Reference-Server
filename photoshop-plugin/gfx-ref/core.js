/* GFX References — core
 *
 * 서버와 이야기하는 부분만 있습니다. 화면(DOM)도 포토샵도 쓰지 않아서
 * UXP 플러그인 · CEP 확장 · 일반 브라우저 · Node 어디서나 그대로 쓸 수 있어요.
 *
 *   const client = GFXRef.core.createClient({ storage: GFXRef.core.storage.local('gfx.') });
 *   await client.connect();                       // 서버 정보(분류 · 태그 · 색) 받기
 *   const page = await client.search({ q: 'glow', scope: 'gd' });
 *   const file = await client.downloadOriginal(page.items[0].id);   // 디스코드 연동 필요
 *
 * 불러오는 방법: <script src="gfx-ref/core.js"> 로 넣으면 GFXRef.core,
 *               require('./gfx-ref/core.js') 로 부르면 그 값이 돌아옵니다.
 */
(function (factory) {
  var api = factory();
  var root = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this;
  if (root) (root.GFXRef = root.GFXRef || {}).core = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(function () {
  'use strict';

  var VERSION = '2.0.0';
  var DEFAULT_SERVER = 'https://gfxref.duckdns.org';

  // ── 저장소 (연동 정보 보관) ─────────────────────────────
  // 다른 플러그인에 넣을 때는 { get, set, remove } 세 함수만 있는 객체를 넘기면 됩니다.

  function localStorage_(prefix) {
    prefix = prefix == null ? 'gfx.' : prefix;
    return {
      get: function (k) {
        try {
          return window.localStorage.getItem(prefix + k);
        } catch (e) {
          return null;
        }
      },
      set: function (k, v) {
        try {
          window.localStorage.setItem(prefix + k, v);
        } catch (e) {
          /* 저장 못 해도 이번 실행 동안은 동작 */
        }
      },
      remove: function (k) {
        try {
          window.localStorage.removeItem(prefix + k);
        } catch (e) {
          /* */
        }
      },
    };
  }

  function memoryStorage() {
    var m = {};
    return {
      get: function (k) {
        return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
      },
      set: function (k, v) {
        m[k] = String(v);
      },
      remove: function (k) {
        delete m[k];
      },
    };
  }

  // ── 오류 ────────────────────────────────────────────────

  function ApiError(message, status, code) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.status = status || 0;
    e.code = code || null;
    return e;
  }

  function qs(params) {
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) v = v.join(',');
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function cleanServer(url) {
    return String(url || '')
      .trim()
      .replace(/\/+$/, '');
  }

  function safeJson(s) {
    try {
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 검색 조건 → 서버 주소의 ?뒤 부분
   * filters: { q, scope: 'gd'|'nongd', category, color, tags: 'a,b' 또는 ['a','b'],
   *            sort: 'newest'|'popular'|'random'|'oldest', period, seed, creator }
   */
  function filterParams(f) {
    f = f || {};
    var sort = f.sort && f.sort !== 'newest' ? f.sort : '';
    return {
      q: f.q ? String(f.q).trim() : '',
      scope: f.category ? '' : f.scope,
      category: f.category,
      color: f.color,
      tags: f.tags,
      creator: f.creator,
      sort: sort,
      period: sort === 'popular' ? f.period || 'all' : '',
      seed: sort === 'random' ? f.seed : '',
    };
  }

  /**
   * options:
   *   server      서버 주소 (비우면 저장된 값 → 기본 주소)
   *   storage     { get, set, remove } — 기본은 메모리 (껐다 켜면 사라짐)
   *   fetch       fetch 함수 (기본: 전역 fetch)
   *   clientName  연동 코드를 받을 때 서버에 알리는 이름 ('plugin' 이면 토큰을 직접 받음)
   */
  function createClient(options) {
    options = options || {};
    var storage = options.storage || memoryStorage();
    var doFetch =
      options.fetch ||
      (typeof fetch === 'function'
        ? function (u, o) {
            return fetch(u, o);
          }
        : null);
    if (!doFetch) throw new Error('fetch 를 사용할 수 없는 환경이에요. options.fetch 를 넘겨 주세요.');

    var state = {
      server: cleanServer(options.server || storage.get('server') || DEFAULT_SERVER),
      token: storage.get('token') || '',
      user: safeJson(storage.get('user')),
      meta: null,
    };
    var listeners = {};

    function emit(name, data) {
      (listeners[name] || []).slice().forEach(function (fn) {
        try {
          fn(data);
        } catch (e) {
          /* 듣는 쪽 오류는 무시 */
        }
      });
    }

    function setAuth(token, user) {
      state.token = token || '';
      state.user = token ? user || null : null;
      if (state.token) {
        storage.set('token', state.token);
        storage.set('user', JSON.stringify(state.user));
      } else {
        storage.remove('token');
        storage.remove('user');
      }
      emit('auth', state.user);
    }

    async function request(path, opts) {
      opts = opts || {};
      var headers = {};
      if (state.token) headers.Authorization = 'Bearer ' + state.token;
      if (opts.body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
      var res;
      try {
        res = await doFetch(state.server + path, {
          method: opts.method || 'GET',
          headers: headers,
          // form: FormData 를 그대로 보냄 (파일 올리기)
          body: opts.form ? opts.form : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
      } catch (e) {
        throw ApiError('서버에 연결할 수 없어요. 인터넷 연결이나 서버 주소를 확인해 주세요.', 0, 'network');
      }
      if (res.status === 401 && state.token) setAuth('', null); // 연동이 끝났거나 취소됨
      if (opts.raw && res.ok) return res;
      var data = null;
      try {
        data = await res.json();
      } catch (e) {
        /* 본문 없음 */
      }
      if (!res.ok) {
        var err = ApiError((data && data.error) || '요청 실패 (' + res.status + ')', res.status, data && data.code);
        if (data && data.matches) err.matches = data.matches; // 비슷한 레퍼런스가 이미 있을 때
        throw err;
      }
      return data;
    }

    var client = {
      version: VERSION,
      defaultServer: DEFAULT_SERVER,

      get server() {
        return state.server;
      },
      get user() {
        return state.user;
      },
      get meta() {
        return state.meta;
      },
      isLinked: function () {
        return !!state.token;
      },

      /** 이벤트: 'auth' (연동 / 해제, 값: user 또는 null), 'server' (주소 바뀜). 그만 들으려면 돌려받은 함수 호출 */
      on: function (name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
        return function () {
          listeners[name] = (listeners[name] || []).filter(function (f) {
            return f !== fn;
          });
        };
      },

      /** 서버에 연결해서 분류 · 태그 · 색 목록을 받음. url 을 주면 그 주소로 바꾸고 저장 */
      connect: async function (url) {
        var next = url ? cleanServer(url) : state.server;
        if (!/^https?:\/\//.test(next)) throw ApiError('http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.', 0, 'bad_url');
        var prev = state.server;
        state.server = next;
        try {
          state.meta = await request('/api/meta');
        } catch (e) {
          state.server = prev;
          throw e;
        }
        if (next !== prev) {
          storage.set('server', next);
          setAuth('', null); // 다른 서버의 연동 정보는 쓸 수 없음
          emit('server', next);
        } else if (url) {
          storage.set('server', next);
        }
        return state.meta;
      },

      /** 검색. 돌려주는 값: { items, total, page, pageSize, hasMore } */
      search: function (filters, page, limit) {
        var p = filterParams(filters);
        p.page = page || 1;
        p.limit = limit || 20;
        return request('/api/refs' + qs(p));
      },

      random: async function (filters) {
        var p = filterParams(filters);
        return (await request('/api/refs/random' + qs({ scope: p.scope, category: p.category, color: p.color, tags: p.tags }))).item;
      },

      get: async function (id) {
        return (await request('/api/refs/' + Number(id))).item;
      },

      /** 포토샵 패널은 WebP 를 못 보여 줘서 JPEG 썸네일 (w: 64~720) */
      thumbUrl: function (refOrId, w) {
        var id = typeof refOrId === 'object' ? refOrId.id : refOrId;
        return state.server + '/api/refs/' + id + '/thumb?w=' + (w || 320);
      },

      /** 원본 파일 (디스코드 연동 필요). 돌려주는 값: { data: ArrayBuffer, mime, filename } */
      downloadOriginal: async function (id) {
        if (!state.token) throw ApiError('원본을 받으려면 디스코드 연동이 필요해요.', 401, 'link_required');
        var res = await request('/api/refs/' + Number(id) + '/original', { raw: true });
        var mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
        var disp = res.headers.get('content-disposition') || '';
        var m = /filename\*=UTF-8''([^;]+)/i.exec(disp) || /filename="?([^";]+)"?/i.exec(disp);
        var filename = m ? decodeURIComponent(m[1]) : 'gfx-ref-' + id;
        return { data: await res.arrayBuffer(), mime: mime, filename: filename };
      },

      /**
       * 레퍼런스 올리기 (디스코드 연동 필요). 돌려주는 값: 등록된 레퍼런스
       *   input: { file: Blob, filename, category, title, mapName, creators: 'A, B',
       *            tags: ['glow'] 또는 'glow,3d', sourceUrl, allowDuplicate }
       * 비슷한 사진이 이미 있으면 code 'duplicate' 오류이고 err.matches 에 [{ id, title, thumbUrl }] 이 들어 있어요.
       */
      upload: async function (input) {
        if (!state.token) throw ApiError('올리려면 디스코드 연동이 필요해요.', 401, 'link_required');
        if (typeof FormData !== 'function') throw ApiError('이 환경에서는 파일을 올릴 수 없어요.', 0, 'unsupported');
        var form = new FormData();
        form.append('file', input.file, input.filename || 'image.png');
        form.append('category', input.category || '');
        var put = function (k, v) {
          if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
        };
        put('title', input.title);
        put('mapName', input.mapName);
        put('creators', input.creators);
        put('tags', Array.isArray(input.tags) ? input.tags.join(',') : input.tags);
        put('sourceUrl', input.sourceUrl);
        if (input.allowDuplicate) form.append('allowDuplicate', '1');
        return (await request('/api/refs', { method: 'POST', form: form, body: null })).item;
      },

      /**
       * 에셋 · 플러그인 · 텍스쳐팩 올리기 (디스코드 연동 필요). 돌려주는 값: 등록된 항목
       *   input: { kind: 'asset'|'plugin'|'texturepack', file: Blob, filename, title, description,
       *            creators: 'A, B', tags: ['png'] 또는 'png,3d', linkUrl }
       * 파일이 사진이면 그 사진이 미리보기가 돼요.
       */
      uploadResource: async function (input) {
        if (!state.token) throw ApiError('올리려면 디스코드 연동이 필요해요.', 401, 'link_required');
        if (typeof FormData !== 'function') throw ApiError('이 환경에서는 파일을 올릴 수 없어요.', 0, 'unsupported');
        var form = new FormData();
        form.append('kind', input.kind || 'asset');
        if (input.file) form.append('file', input.file, input.filename || 'file');
        var put = function (k, v) {
          if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
        };
        put('title', input.title);
        put('description', input.description);
        put('creators', input.creators);
        put('tags', Array.isArray(input.tags) ? input.tags.join(',') : input.tags);
        put('linkUrl', input.linkUrl);
        return (await request('/api/resources', { method: 'POST', form: form, body: null })).item;
      },

      /** 에셋 등 종류별 태그 목록: [{ name, description, count }] */
      resourceTags: async function (kind) {
        return (await request('/api/resources/tags' + qs({ kind: kind || 'asset' }))).tags;
      },

      /** 반응 켜고 끄기. 돌려주는 값: { reactions, myReactions } */
      react: function (id, emoji) {
        return request('/api/refs/' + Number(id) + '/reactions', { method: 'POST', body: { emoji: emoji } });
      },

      /**
       * 디스코드 연동 (코드 방식).
       *   const link = client.link({ onCode: (c) => 화면에 c.userCode 와 c.command 표시 });
       *   const user = await link.done;   // 디스코드에서 /연동 을 입력하면 끝남
       *   link.cancel();                  // 그만두기
       */
      link: function (opts) {
        opts = opts || {};
        var timer = null;
        var cancelled = false;
        var rejectFn = null;
        var done = new Promise(function (resolve, reject) {
          rejectFn = reject;
          request('/api/auth/device', { method: 'POST', body: { client: options.clientName || 'plugin' } })
            .then(function (code) {
              if (cancelled) return;
              if (opts.onCode) opts.onCode({ userCode: code.userCode, command: code.command, expiresAt: code.expiresAt });
              var until = Date.now() + 10 * 60 * 1000;
              var tick = function () {
                if (cancelled) return;
                if (Date.now() > until) return reject(ApiError('코드가 만료되었어요. 다시 시도해 주세요.', 0, 'expired'));
                request('/api/auth/device/poll', { method: 'POST', body: { deviceCode: code.deviceCode } })
                  .then(function (r) {
                    if (cancelled) return;
                    if (r.status === 'approved' && r.token) {
                      setAuth(r.token, r.user);
                      resolve(r.user);
                    } else if (r.status !== 'pending') {
                      reject(ApiError('코드가 만료되었어요. 다시 시도해 주세요.', 0, 'expired'));
                    } else {
                      timer = setTimeout(tick, (code.interval || 3) * 1000);
                    }
                  })
                  .catch(function () {
                    if (!cancelled) timer = setTimeout(tick, 5000); // 잠깐 끊겨도 계속 기다림
                  });
              };
              timer = setTimeout(tick, (code.interval || 3) * 1000);
            })
            .catch(reject);
        });
        return {
          done: done,
          cancel: function () {
            cancelled = true;
            clearTimeout(timer);
            if (rejectFn) rejectFn(ApiError('취소했어요.', 0, 'cancelled'));
          },
        };
      },

      /** 연동 해제 (서버의 토큰도 지움) */
      logout: async function () {
        if (state.token) await request('/api/auth/logout', { method: 'POST', body: {} }).catch(function () {});
        setAuth('', null);
      },

      /** 저장된 연동이 아직 유효한지 확인하고 최신 정보로 바꿈 */
      refreshUser: async function () {
        if (!state.token) return null;
        var r = await request('/api/auth/me');
        if (!r.user) {
          setAuth('', null);
          return null;
        }
        setAuth(state.token, r.user);
        return r.user;
      },

      /** 그 밖의 API 를 직접 부를 때 */
      request: request,
    };
    return client;
  }

  return {
    VERSION: VERSION,
    DEFAULT_SERVER: DEFAULT_SERVER,
    createClient: createClient,
    ApiError: ApiError,
    filterParams: filterParams,
    storage: { local: localStorage_, memory: memoryStorage },
  };
});
