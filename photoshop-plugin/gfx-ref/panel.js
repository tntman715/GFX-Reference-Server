/* GFX References — 패널 화면
 *
 * 주어진 칸(root) 안에만 화면을 그립니다. 전역 id 나 document 전체에 거는 이벤트가 없고
 * 모든 CSS 클래스가 gfxr- 로 시작해서, 다른 플러그인 화면 안에 넣어도 서로 부딪히지 않아요.
 *
 *   const panel = GFXRef.panel.mountPanel(document.getElementById('gfx-tab'), {
 *     client,            // GFXRef.core.createClient(...)
 *     host,              // GFXRef.photoshop.createPhotoshopHost()  (없으면 포토샵 기능만 꺼짐)
 *     lang: 'ko',        // 'ko' | 'en' (기본: 포토샵 언어)
 *     onEvent: (name, data) => {},   // 'placed' | 'opened' | 'color' | 'linked' | 'error'
 *   });
 *   panel.openRef(123);  // 특정 레퍼런스 바로 열기
 *   panel.destroy();     // 탭을 닫을 때
 *
 * 필요한 CSS: gfx-ref/panel.css
 */
(function (factory) {
  var api = factory();
  var root = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this;
  if (root) (root.GFXRef = root.GFXRef || {}).panel = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(function () {
  'use strict';

  // ── 글자 (번역 · 바꾸기 쉽게 한곳에) ───────────────────
  var STRINGS = {
    ko: {
      'setup.title': 'GFX References 연결',
      'setup.lead': 'GFX References 사이트 주소를 입력하세요.',
      'setup.save': '연결',
      'setup.default': '기본 주소로',
      'account.link': '🔗 디스코드 연동',
      'account.unlink': '연동 해제',
      'account.settings': '서버 설정',
      'search.placeholder': '제목 · 맵 · 제작자 · 태그 · #번호',
      'filter.allScopes': '지메 + 비지메',
      'filter.allCategories': '전체 분류',
      'filter.allColors': '모든 색',
      'filter.allTags': '모든 태그',
      'sort.newest': '최신순',
      'sort.popular': '인기순',
      'sort.random': '무작위',
      'sort.oldest': '오래된순',
      'search.loading': '검색 중…',
      'search.count': '{n}개의 레퍼런스',
      'search.empty': '조건에 맞는 레퍼런스가 없어요.',
      'search.random': '🎲 랜덤',
      'search.more': '더 보기',
      'detail.back': '← 목록',
      'detail.map': '맵',
      'detail.creator': '제작자',
      'detail.original': '원본',
      'detail.paletteHint': '팔레트 · 누르면 전경색으로 설정',
      'detail.place': '＋ 새 레이어로 불러오기',
      'detail.openDoc': '새 문서로 열기',
      'detail.site': '사이트에서 보기',
      'detail.mine': '내 반응',
      'detail.fetching': '디스코드에서 원본을 가져오는 중…',
      'detail.importing': '포토샵으로 불러오는 중…',
      'detail.placed': '새 레이어로 불러왔어요: {name}',
      'detail.opened': '새 문서로 열었어요.',
      'detail.color': '전경색: {hex}',
      'detail.noPs': '포토샵 안에서만 사용할 수 있어요.',
      'link.title': '디스코드 연동',
      'link.lead': '원본을 불러오려면 GFX References 디스코드 계정과 연동해야 해요.',
      'link.start': '연동 코드 받기',
      'link.waitingCode': '코드를 받는 중…',
      'link.enter': '디스코드 아무 채널에서 아래 명령어를 입력하세요:',
      'link.waiting': '승인을 기다리는 중… (10분 안에 입력해 주세요)',
      'link.retry': '다시 시도',
      'link.later': '나중에',
      'link.done': '연동 완료! {name}',
      'cat.gm_thumbnail': '지메 썸네일',
      'cat.gm_artwork': '지메 기타 작업물',
      'cat.non_gm': '비지메',
    },
    en: {
      'setup.title': 'Connect to GFX References',
      'setup.lead': 'Enter the GFX References site address.',
      'setup.save': 'Connect',
      'setup.default': 'Use default',
      'account.link': '🔗 Link Discord',
      'account.unlink': 'Unlink',
      'account.settings': 'Server settings',
      'search.placeholder': 'Title · map · creator · tag · #id',
      'filter.allScopes': 'GD + Non-GD',
      'filter.allCategories': 'All categories',
      'filter.allColors': 'All colors',
      'filter.allTags': 'All tags',
      'sort.newest': 'Newest',
      'sort.popular': 'Popular',
      'sort.random': 'Random',
      'sort.oldest': 'Oldest',
      'search.loading': 'Searching…',
      'search.count': '{n} references',
      'search.empty': 'Nothing matches these filters.',
      'search.random': '🎲 Random',
      'search.more': 'Load more',
      'detail.back': '← Back',
      'detail.map': 'Map',
      'detail.creator': 'By',
      'detail.original': 'Original',
      'detail.paletteHint': 'Palette · click to set the foreground color',
      'detail.place': '＋ Place as a new layer',
      'detail.openDoc': 'Open as a new document',
      'detail.site': 'View on site',
      'detail.mine': 'mine',
      'detail.fetching': 'Fetching the original from Discord…',
      'detail.importing': 'Bringing it into Photoshop…',
      'detail.placed': 'Placed as a new layer: {name}',
      'detail.opened': 'Opened as a new document.',
      'detail.color': 'Foreground: {hex}',
      'detail.noPs': 'This only works inside Photoshop.',
      'link.title': 'Link Discord',
      'link.lead': 'Link your GFX References Discord account to bring in originals.',
      'link.start': 'Get a link code',
      'link.waitingCode': 'Getting a code…',
      'link.enter': 'Type this command in any channel on the Discord server:',
      'link.waiting': 'Waiting for approval… (within 10 minutes)',
      'link.retry': 'Try again',
      'link.later': 'Later',
      'link.done': 'Linked! {name}',
      'cat.gm_thumbnail': 'GD thumbnail',
      'cat.gm_artwork': 'GD artwork',
      'cat.non_gm': 'Non-GD',
    },
  };

  // ── 작은 도구 ───────────────────────────────────────────

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /** 여러 개를 차례로 붙임 (UXP 는 Element.append 를 지원하지 않을 수 있어서) */
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function on(node, type, fn) {
    node.addEventListener(type, fn);
    return node;
  }

  function option(value, label) {
    var o = el('option', null, label);
    o.value = value;
    return o;
  }

  function fmtBytes(n) {
    if (!n) return '';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }

  function creatorName(ref) {
    if (ref.creators && ref.creators.length) return ref.creators.map((c) => c.name).join(', ');
    return (ref.creator && ref.creator.name) || '';
  }

  /** 포토샵 레이어 이름: #번호 제목 (제작자) */
  function layerName(ref) {
    return '#' + ref.id + ' ' + ref.title + (creatorName(ref) ? ' (' + creatorName(ref) + ')' : '');
  }

  // ── 패널 ────────────────────────────────────────────────

  function mountPanel(root, opts) {
    opts = opts || {};
    var client = opts.client;
    if (!client) throw new Error('mountPanel: client 가 필요해요 (GFXRef.core.createClient).');
    var host = opts.host || { available: false };
    var lang = opts.lang || (host.locale && host.locale()) || 'ko';
    if (!STRINGS[lang]) lang = 'en';
    var strings = Object.assign({}, STRINGS[lang], (opts.strings && opts.strings[lang]) || {});
    var pageSize = opts.pageSize || 20;
    var emit = function (name, data) {
      if (opts.onEvent) {
        try {
          opts.onEvent(name, data);
        } catch (e) {
          /* */
        }
      }
    };
    function t(key, vars) {
      var s = strings[key] || key;
      if (vars) Object.keys(vars).forEach((k) => (s = s.split('{' + k + '}').join(String(vars[k]))));
      return s;
    }

    var state = { page: 0, hasMore: false, seq: 0, seed: '', current: null, link: null, after: null, timers: [] };
    var wrap = el('div', 'gfxr');
    root.appendChild(wrap);

    // 토스트
    var toastBox = el('div', 'gfxr-toast gfxr-hidden');
    var toastTimer = null;
    function toast(msg) {
      toastBox.textContent = msg;
      toastBox.classList.remove('gfxr-hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastBox.classList.add('gfxr-hidden'), 3200);
    }

    // ── 화면 1: 서버 설정 ──
    var setup = el('section', 'gfxr-view');
    var serverInput = el('input', 'gfxr-input');
    serverInput.type = 'text';
    serverInput.placeholder = 'https://gfxref.duckdns.org';
    var setupError = el('p', 'gfxr-error gfxr-hidden');
    var saveBtn = on(el('button', 'gfxr-btn gfxr-primary', t('setup.save')), 'click', () => connect(serverInput.value));
    var defaultBtn = on(el('button', 'gfxr-btn gfxr-link', t('setup.default')), 'click', () => {
      serverInput.value = client.defaultServer || 'https://gfxref.duckdns.org';
    });
    var setupCard = el('div', 'gfxr-card');
    add(setupCard, el('h2', 'gfxr-h2', t('setup.title')), el('p', 'gfxr-dim', t('setup.lead')), serverInput, row('gfxr-end', defaultBtn, saveBtn), setupError);
    add(setup, setupCard);

    // ── 화면 2: 검색 ──
    var main = el('section', 'gfxr-view');
    var account = el('div', 'gfxr-account');
    var settingsBtn = on(el('button', 'gfxr-btn gfxr-icon', '⚙'), 'click', () => {
      serverInput.value = client.server;
      show(setup);
    });
    settingsBtn.title = t('account.settings');
    var q = el('input', 'gfxr-input');
    q.type = 'text';
    q.placeholder = t('search.placeholder');
    var scopeSel = el('select', 'gfxr-select');
    var catSel = el('select', 'gfxr-select');
    var colorSel = el('select', 'gfxr-select');
    var tagSel = el('select', 'gfxr-select');
    var sortSel = el('select', 'gfxr-select');
    ['newest', 'popular', 'random', 'oldest'].forEach((s) => sortSel.appendChild(option(s, t('sort.' + s))));
    var count = el('span', 'gfxr-dim');
    var randomBtn = on(el('button', 'gfxr-btn gfxr-link', t('search.random')), 'click', randomRef);
    var results = el('div', 'gfxr-results');
    var moreBtn = on(el('button', 'gfxr-btn gfxr-hidden', t('search.more')), 'click', () => search(false));
    add(main, 
      bar(account, settingsBtn),
      q,
      row(null, scopeSel, catSel),
      row(null, colorSel, tagSel),
      sortSel,
      bar(count, randomBtn),
      results,
      row('gfxr-center', moreBtn),
    );

    // ── 화면 3: 상세 ──
    var detail = el('section', 'gfxr-view');
    var detailId = el('span', 'gfxr-dim');
    var backBtn = on(el('button', 'gfxr-btn gfxr-link', t('detail.back')), 'click', () => show(main));
    var detailImg = el('img');
    detailImg.alt = '';
    var imgBox = el('div', 'gfxr-detail-img');
    add(imgBox, detailImg);
    var detailTitle = el('h3', 'gfxr-h3');
    var detailMeta = el('div', 'gfxr-dim gfxr-small');
    var detailTags = el('div', 'gfxr-tags');
    var palette = el('div', 'gfxr-palette');
    var placeBtn = on(el('button', 'gfxr-btn gfxr-primary gfxr-block', t('detail.place')), 'click', () => bringIn(false));
    var openBtn = on(el('button', 'gfxr-btn gfxr-block', t('detail.openDoc')), 'click', () => bringIn(true));
    var reactBtn = on(el('button', 'gfxr-btn gfxr-grow'), 'click', toggleReaction);
    var siteBtn = on(el('button', 'gfxr-btn gfxr-grow', t('detail.site')), 'click', () => {
      if (state.current && host.openUrl) host.openUrl(state.current.siteUrl);
    });
    var status = el('p', 'gfxr-dim gfxr-small');
    var actions = el('div', 'gfxr-actions');
    add(actions, placeBtn, openBtn, row(null, reactBtn, siteBtn));
    add(detail, bar(backBtn, detailId), imgBox, detailTitle, detailMeta, detailTags, el('p', 'gfxr-dim gfxr-small gfxr-label', t('detail.paletteHint')), palette, actions, status);

    // ── 화면 4: 디스코드 연동 ──
    var linkView = el('section', 'gfxr-view');
    var linkBody = el('div');
    var laterBtn = on(el('button', 'gfxr-btn gfxr-link', t('link.later')), 'click', () => {
      if (state.link) state.link.cancel();
      state.link = null;
      show(state.after && state.current ? detail : main);
      state.after = null;
    });
    var linkCard = el('div', 'gfxr-card');
    add(linkCard, el('h2', 'gfxr-h2', t('link.title')), el('p', 'gfxr-dim', t('link.lead')), linkBody, row('gfxr-end', laterBtn));
    add(linkView, linkCard);

    var views = [setup, main, detail, linkView];
    views.forEach((v) => wrap.appendChild(v));
    wrap.appendChild(toastBox);

    function row(extra, a, b) {
      var r = el('div', 'gfxr-row' + (extra ? ' ' + extra : ''));
      for (var i = 1; i < arguments.length; i++) r.appendChild(arguments[i]);
      return r;
    }
    function bar(left, right) {
      var b = el('div', 'gfxr-bar');
      add(b, left, right);
      return b;
    }
    function show(view) {
      views.forEach((v) => v.classList.toggle('gfxr-hidden', v !== view));
    }

    // ── 서버 연결 ──
    async function connect(url) {
      setupError.classList.add('gfxr-hidden');
      saveBtn.disabled = true;
      try {
        await client.connect(url || undefined);
        fillFilters();
        renderAccount();
        show(main);
        search(true);
        if (client.isLinked()) client.refreshUser().catch(() => undefined);
      } catch (e) {
        serverInput.value = url || client.server;
        setupError.textContent = e.message;
        setupError.classList.remove('gfxr-hidden');
        show(setup);
      } finally {
        saveBtn.disabled = false;
      }
    }

    function catLabel(c) {
      return strings['cat.' + c.key] || c.label;
    }

    function fillFilters() {
      var m = client.meta;
      clear(scopeSel).appendChild(option('', t('filter.allScopes')));
      (m.tagGroups || []).forEach((g) => scopeSel.appendChild(option(g.key, lang === 'ko' ? g.label : g.labelEn || g.label)));
      clear(colorSel).appendChild(option('', t('filter.allColors')));
      m.colors.forEach((c) => colorSel.appendChild(option(c.key, lang === 'ko' ? c.label : c.key.charAt(0).toUpperCase() + c.key.slice(1))));
      fillByScope();
    }

    /** 지메 / 비지메를 고르면 그 분류와 태그만 보여 줌 */
    function fillByScope() {
      var m = client.meta;
      var scope = scopeSel.value;
      var cat = catSel.value;
      var shownCats = [];
      clear(catSel).appendChild(option('', t('filter.allCategories')));
      m.categories
        .filter((c) => !scope || c.tagGroup === scope)
        .forEach((c) => {
          shownCats.push(c.key);
          catSel.appendChild(option(c.key, catLabel(c)));
        });
      catSel.value = shownCats.indexOf(cat) >= 0 ? cat : '';
      var group = catSel.value ? (m.categories.filter((c) => c.key === catSel.value)[0] || {}).tagGroup : scope;
      var tag = tagSel.value;
      // 지메와 비지메에 같은 이름이 있으면 하나로 묶고 개수는 더함
      var seen = {};
      var names = [];
      m.tags
        .filter((tg) => !group || !tg.group || tg.group === group)
        .forEach((tg) => {
          if (!(tg.name in seen)) names.push(tg.name);
          seen[tg.name] = (seen[tg.name] || 0) + (tg.count || 0);
        });
      clear(tagSel).appendChild(option('', t('filter.allTags')));
      names.forEach((n) => tagSel.appendChild(option(n, '#' + n + ' (' + seen[n] + ')')));
      tagSel.value = tag && tag in seen ? tag : '';
    }

    // ── 계정 ──
    function renderAccount() {
      clear(account);
      var user = client.user;
      if (client.isLinked() && user) {
        if (user.avatarUrl) {
          var img = el('img');
          img.src = user.avatarUrl;
          account.appendChild(img);
        }
        account.appendChild(el('span', 'gfxr-name', user.displayName || user.username));
        account.appendChild(on(el('button', 'gfxr-btn gfxr-link', t('account.unlink')), 'click', () => client.logout()));
      } else {
        account.appendChild(on(el('button', 'gfxr-btn gfxr-link', t('account.link')), 'click', () => openLink(null)));
      }
    }
    var offAuth = client.on('auth', renderAccount);

    function openLink(after) {
      state.after = after;
      clear(linkBody).appendChild(on(el('button', 'gfxr-btn gfxr-primary gfxr-block', t('link.start')), 'click', startLink));
      show(linkView);
    }

    function startLink() {
      clear(linkBody).appendChild(el('p', 'gfxr-dim', t('link.waitingCode')));
      if (state.link) state.link.cancel();
      var link = client.link({
        onCode: (code) => {
          add(clear(linkBody), 
            el('p', null, t('link.enter')),
            el('div', 'gfxr-code', code.userCode),
            el('p', 'gfxr-small', code.command),
            el('p', 'gfxr-dim gfxr-small', t('link.waiting')),
          );
        },
      });
      state.link = link;
      link.done.then(
        (user) => {
          if (state.link !== link) return;
          state.link = null;
          toast(t('link.done', { name: (user && (user.displayName || user.username)) || '' }));
          emit('linked', user);
          var next = state.after;
          state.after = null;
          if (next) next();
          else show(main);
        },
        (e) => {
          if (state.link !== link || e.code === 'cancelled') return;
          state.link = null;
          add(clear(linkBody), el('p', 'gfxr-error', e.message), on(el('button', 'gfxr-btn gfxr-block', t('link.retry')), 'click', startLink));
        },
      );
    }

    // ── 검색 ──
    function filters() {
      return {
        q: q.value,
        scope: scopeSel.value,
        category: catSel.value,
        color: colorSel.value,
        tags: tagSel.value,
        sort: sortSel.value,
        seed: state.seed,
      };
    }

    async function search(reset) {
      var seq = ++state.seq;
      if (reset) {
        state.seed = Math.random().toString(36).slice(2, 10);
        state.page = 0;
        clear(results);
        count.textContent = t('search.loading');
      }
      moreBtn.disabled = true;
      try {
        var data = await client.search(filters(), state.page + 1, pageSize);
        if (seq !== state.seq) return;
        state.page += 1;
        state.hasMore = data.hasMore;
        count.textContent = t('search.count', { n: data.total });
        data.items.forEach((ref) => results.appendChild(thumb(ref)));
        if (!data.items.length && state.page === 1) results.appendChild(el('p', 'gfxr-dim', t('search.empty')));
        moreBtn.classList.toggle('gfxr-hidden', !state.hasMore);
      } catch (e) {
        if (seq === state.seq) count.textContent = e.message;
      } finally {
        moreBtn.disabled = false;
      }
    }

    function thumb(ref) {
      var box = el('div', 'gfxr-thumb');
      var img = el('img');
      img.src = client.thumbUrl(ref, 320);
      img.alt = ref.title;
      add(box, img, el('div', 'gfxr-thumb-title', '#' + ref.id + ' ' + ref.title), el('div', 'gfxr-thumb-sub', (ref.mapName && ref.mapName !== ref.title ? ref.mapName + ' · ' : '') + creatorName(ref)));
      return on(box, 'click', () => openDetail(ref));
    }

    async function randomRef() {
      try {
        openDetail(await client.random(filters()));
      } catch (e) {
        toast(e.message);
      }
    }

    // ── 상세 ──
    function openDetail(ref) {
      state.current = ref;
      detailId.textContent = '#' + ref.id + ' · ' + (strings['cat.' + ref.category] || ref.categoryLabel);
      detailImg.src = client.thumbUrl(ref, 640);
      detailTitle.textContent = ref.title;
      var meta = [];
      if (ref.mapName) meta.push(t('detail.map') + ': ' + ref.mapName);
      if (creatorName(ref)) meta.push(t('detail.creator') + ': ' + creatorName(ref));
      meta.push(t('detail.original') + ' ' + ref.width + '×' + ref.height + (ref.originalSize ? ' · ' + fmtBytes(ref.originalSize) : ''));
      detailMeta.textContent = meta.join(' · ');
      clear(detailTags);
      (ref.tags || []).forEach((tg) => detailTags.appendChild(el('span', null, '#' + tg)));
      clear(palette);
      (ref.palette || []).forEach((p) => {
        var sw = el('div');
        sw.style.backgroundColor = p.hex;
        sw.title = p.hex;
        palette.appendChild(on(sw, 'click', () => setColor(p.hex)));
      });
      placeBtn.disabled = openBtn.disabled = false;
      status.textContent = '';
      updateReact();
      show(detail);
    }

    function reactionEmoji() {
      return (client.meta && client.meta.reactions && client.meta.reactions[0]) || '⭐';
    }

    function updateReact() {
      var ref = state.current;
      var e = reactionEmoji();
      var mine = ref.myReactions && ref.myReactions.indexOf(e) >= 0;
      reactBtn.textContent = e + ' ' + ((ref.reactions && ref.reactions[e]) || 0) + (mine ? ' (' + t('detail.mine') + ')' : '');
    }

    async function toggleReaction() {
      var ref = state.current;
      if (!ref) return;
      if (!client.isLinked()) return openLink(() => openDetail(ref));
      try {
        var res = await client.react(ref.id, reactionEmoji());
        ref.reactions = res.reactions;
        ref.myReactions = res.myReactions;
        updateReact();
      } catch (e) {
        toast(e.message);
      }
    }

    async function bringIn(asDocument) {
      var ref = state.current;
      if (!ref) return;
      if (!host.available) return toast(t('detail.noPs'));
      if (!client.isLinked()) return openLink(() => openDetail(ref));
      placeBtn.disabled = openBtn.disabled = true;
      status.textContent = t('detail.fetching');
      try {
        var file = await client.downloadOriginal(ref.id);
        status.textContent = t('detail.importing');
        var name = layerName(ref);
        var how = asDocument ? await host.openAsDocument(file) : await host.placeAsLayer(file, { name: name });
        status.textContent = '';
        toast(how === 'document' ? t('detail.opened') : t('detail.placed', { name: name }));
        emit(how === 'document' ? 'opened' : 'placed', { ref: ref, layerName: name });
      } catch (e) {
        status.textContent = '';
        emit('error', e);
        if (e.status === 401) openLink(() => openDetail(ref));
        else toast(e.message || String(e));
      } finally {
        placeBtn.disabled = openBtn.disabled = false;
      }
    }

    async function setColor(hex) {
      if (!host.available) return toast(hex);
      try {
        await host.setForegroundColor(hex);
        toast(t('detail.color', { hex: hex }));
        emit('color', hex);
      } catch (e) {
        toast(e.message || String(e));
      }
    }

    // ── 입력 ──
    var searchTimer = null;
    on(q, 'input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => search(true), 400);
    });
    on(q, 'keydown', (e) => {
      if (e.key === 'Enter') search(true);
    });
    on(scopeSel, 'change', () => {
      fillByScope();
      search(true);
    });
    on(catSel, 'change', () => {
      fillByScope();
      search(true);
    });
    [colorSel, tagSel, sortSel].forEach((s) => on(s, 'change', () => search(true)));

    // ── 시작 ──
    renderAccount();
    show(main);
    count.textContent = t('search.loading');
    connect();

    return {
      element: wrap,
      /** 번호로 레퍼런스 바로 열기 */
      openRef: async function (id) {
        try {
          openDetail(await client.get(id));
        } catch (e) {
          toast(e.message);
        }
      },
      /** 검색 다시 하기 (조건을 주면 그 조건으로) */
      search: function (f) {
        if (f) {
          if (f.q !== undefined) q.value = f.q;
          if (f.scope !== undefined) scopeSel.value = f.scope;
          fillByScope();
          if (f.category !== undefined) catSel.value = f.category;
          if (f.color !== undefined) colorSel.value = f.color;
          if (f.tags !== undefined) tagSel.value = f.tags;
          if (f.sort !== undefined) sortSel.value = f.sort;
        }
        show(main);
        return search(true);
      },
      toast: toast,
      /** 화면을 지우고 타이머 · 이벤트를 정리 */
      destroy: function () {
        if (state.link) state.link.cancel();
        clearTimeout(searchTimer);
        clearTimeout(toastTimer);
        offAuth();
        state.seq++;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      },
    };
  }

  return { mountPanel: mountPanel, STRINGS: STRINGS, layerName: layerName };
});
