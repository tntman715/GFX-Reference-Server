import { api } from '../api.js';
import { emptyState, handleApiError, openLogin } from '../components.js';
import { avatarSrc, clear, fmtRelative, h, spinner } from '../dom.js';
import { store } from '../store.js';

/**
 * 관리자 전용 화면
 *  - #/stats : 방문 통계 (하루 합계 숫자만) + 활동 통계
 *  - #/audit : 감사 로그 (관리자가 관리자 권한으로 한 일)
 */

/** 관리자가 아니면 안내만 보여 주고, 관리자로 로그인하면 다시 그림 */
function adminGate(body) {
  if (store.me?.isAdmin) return null;
  body.append(
    store.me
      ? emptyState('서버 관리자만 볼 수 있어요.')
      : emptyState('관리자 로그인이 필요해요.', h('button.btn.primary', { onclick: () => openLogin() }, '로그인')),
  );
  const off = store.on((s) => {
    if (s.me?.isAdmin) {
      off();
      window.location.reload();
    }
  });
  return { destroy: off };
}

const nf = new Intl.NumberFormat('ko-KR');
const num = (n) => nf.format(n ?? 0);

const PAGE_LABELS = {
  explore: 'Explore (지메)',
  nongd: 'Non-GD',
  feed: 'Feed',
  popular: 'Popular',
  colors: 'Colors',
  ranking: 'Ranking',
  assets: 'Assets',
  plugins: 'Plugins',
  texturepacks: 'Texture packs',
  showcase: 'Showcase',
  detail: '레퍼런스 크게 보기',
  resource: '자료 상세',
  profile: '프로필',
  upload: '업로드',
  boards: '보드',
  tags: '태그',
  edits: '수정 제안',
  import: '가져오기',
  reports: '신고',
  privacy: '개인정보 안내',
  other: '기타',
};
const DEVICE_LABELS = { mobile: '휴대폰', tablet: '태블릿', desktop: 'PC' };
const LANG_LABELS = { ko: '한국어', en: 'English', other: '기타' };
const REF_LABELS = {
  direct: '바로 접속 · 북마크',
  discord: 'Discord',
  google: 'Google',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  reddit: 'Reddit',
  'korean-portal': '네이버 · 다음 · 카카오',
  'search-other': '다른 검색엔진',
  other: '기타 사이트',
};

function statTiles(items) {
  return h(
    'div.stats',
    items.map(([label, value]) => h('div.stat', h('div.v', num(value)), h('div.k', label))),
  );
}

function bars(rows, labels) {
  if (!rows.length) return h('p.hint', '아직 기록이 없어요.');
  const max = Math.max(...rows.map((r) => r.count), 1);
  return h(
    'div.bars',
    rows.map((r) =>
      h(
        'div.bar',
        h('span', labels[r.key] ?? r.key),
        h('div.track', h('div.fill', { style: { width: `${(r.count / max) * 100}%` } })),
        h('b', num(r.count)),
      ),
    ),
  );
}

/** 날짜별 막대 (한 가지 숫자만). 막대에 마우스를 올리면 날짜와 숫자가 보임 */
function columns(daily, key, label) {
  const max = Math.max(...daily.map((d) => d[key]), 1);
  const tip = h('div.adm-tip', { hidden: true });
  const show = (d, el) => {
    tip.textContent = `${d.day} · ${label} ${num(d[key])}`;
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, 60), box.width - 60)}px`;
  };
  const plot = h(
    'div.adm-cols',
    { role: 'img', 'aria-label': `${label}: 날짜별 막대그래프 (아래 "표로 보기"에 숫자가 있어요)` },
    daily.map((d) => {
      const col = h(
        'div.adm-col',
        {
          onmouseenter: () => show(d, col),
          onmouseleave: () => (tip.hidden = true),
          onclick: () => show(d, col),
        },
        h('div.adm-col-fill', { style: { height: d[key] ? `${Math.max((d[key] / max) * 100, 3)}%` : '0' } }),
      );
      return col;
    }),
  );
  const chart = h(
    'div.adm-chart',
    h('div.adm-chart-head', h('strong', label), h('span.faint', `최고 ${num(max)}`)),
    h('div.adm-plot', plot, tip),
    h('div.adm-axis', h('span', daily[0]?.day.slice(5) ?? ''), h('span', daily[daily.length - 1]?.day.slice(5) ?? '')),
  );
  return chart;
}

function tableView(daily, cols) {
  return h(
    'details.adm-table',
    h('summary', '표로 보기'),
    h(
      'div.adm-table-wrap',
      h(
        'table',
        h('thead', h('tr', h('th', '날짜'), cols.map(([, label]) => h('th', label)))),
        h(
          'tbody',
          [...daily].reverse().map((d) => h('tr', h('td', d.day), cols.map(([k]) => h('td', num(d[k]))))),
        ),
      ),
    ),
  );
}

export function mountStats(root) {
  document.title = 'Stats · GFX References';
  const tabs = h('div.segmented');
  const body = h('div');
  root.append(
    h(
      'div.page-head',
      h('div', h('h1', 'Stats'), h('p', '관리자만 볼 수 있는 사이트 통계예요.')),
      tabs,
    ),
    h(
      'div.adm-privacy',
      h('strong', '🔒 익명 합계만 보여요'),
      h(
        'p',
        '방문 통계는 하루에 몇 명이 왔는지, 어떤 페이지가 몇 번 열렸는지 같은 합계 숫자만 저장해요. ' +
          'IP 주소 · 쿠키 · 계정 정보는 저장하지 않아서 관리자도 누가 언제 무엇을 봤는지 알 수 없어요. ',
        h('a', { href: '#/privacy' }, '자세히 보기'),
      ),
    ),
    body,
  );
  const gate = adminGate(body);
  if (gate) return gate;

  let days = 30;
  const renderTabs = () => {
    clear(tabs);
    for (const d of [7, 30, 90, 365]) {
      tabs.append(
        h(
          'button',
          {
            class: days === d ? 'on' : '',
            onclick: () => {
              days = d;
              renderTabs();
              load();
            },
          },
          d === 365 ? '1년' : `${d}일`,
        ),
      );
    }
  };

  async function load() {
    clear(body).append(spinner());
    let s;
    try {
      s = await api.get('/api/admin/stats', { days });
    } catch (err) {
      clear(body).append(emptyState(err.message));
      handleApiError(err);
      return;
    }
    const a = s.activity;
    clear(body).append(
      h('p.hint', `${s.from} ~ ${s.to} (한국 시간 기준)`),
      h('h2.adm-h', '방문'),
      statTiles([
        ['방문자 (하루 단위 합계)', s.totals.visitors],
        ['페이지 열람', s.totals.views],
        ['로그인한 방문자 (하루 단위 합계)', s.totals.members],
      ]),
      h('div.adm-grid', columns(s.daily, 'visitors', '방문자'), columns(s.daily, 'views', '페이지 열람')),
      tableView(s.daily, [
        ['visitors', '방문자'],
        ['views', '페이지 열람'],
        ['members', '로그인한 방문자'],
      ]),
      h(
        'div.adm-grid',
        h('section', h('h3', '많이 본 페이지'), bars(s.pages, PAGE_LABELS)),
        h('section', h('h3', '어디서 들어왔나'), bars(s.referrers, REF_LABELS)),
        h('section', h('h3', '기기'), bars(s.devices, DEVICE_LABELS)),
        h('section', h('h3', '언어'), bars(s.langs, LANG_LABELS)),
      ),
      h('h2.adm-h', '활동'),
      statTiles([
        ['새 레퍼런스', a.totals.uploads],
        ['반응', a.totals.reactions],
        ['새로 참여한 사람', a.totals.newUsers],
        ['올린 사람 수', a.totals.contributors],
        ['자료 (Assets 등)', a.totals.resources],
        ['쇼케이스 영상', a.totals.showcases],
        ['받아들인 수정 제안', a.totals.editsAccepted],
        ['신고', a.totals.reports],
      ]),
      h('div.adm-grid', columns(a.daily, 'uploads', '새 레퍼런스'), columns(a.daily, 'reactions', '반응')),
      tableView(a.daily, [
        ['uploads', '새 레퍼런스'],
        ['reactions', '반응'],
        ['newUsers', '새로 참여'],
        ['resources', '자료'],
        ['showcases', '쇼케이스'],
      ]),
      h(
        'div.adm-grid',
        h(
          'section',
          h('h3', '이 기간에 많이 쓰인 태그'),
          bars(
            a.topTags.map((t) => ({ key: t.name, count: t.count })),
            {},
          ),
        ),
        h(
          'section',
          h('h3', '전체'),
          statTiles([
            ['레퍼런스', s.overall.refs],
            ['참여한 사람', s.overall.users],
            ['자료', s.overall.resources],
            ['쇼케이스', s.overall.showcases],
          ]),
        ),
      ),
      h('p.hint', '방문 숫자는 1분마다 모아서 저장해요. 같은 사람이 하루에 여러 번 와도 방문자는 한 번만 세요 (서버를 다시 켠 날은 조금 더 많이 셀 수 있어요).'),
    );
  }

  renderTabs();
  load();
  return {};
}

// ── 감사 로그 ──────────────────────────────────────────

const ACTION_GROUPS = [
  ['', '전체'],
  ['tag', '태그'],
  ['resource-tag', '자료 태그'],
  ['ref', '레퍼런스 수정 · 삭제'],
  ['edit', '수정 제안 처리'],
  ['score', '점수 조정'],
  ['report', '신고 처리'],
  ['showcase-request', '재생목록 승인'],
  ['showcase', '쇼케이스 삭제'],
  ['video', '제작과정 영상 삭제'],
  ['resource', '자료 삭제'],
  ['names', '이름 통일'],
  ['import', '가져오기'],
  ['youtube-key', '유튜브 API 키'],
  ['highlight', '주간 인기 게시'],
];

function targetLink(e) {
  const id = e.targetId;
  if (!id) return null;
  if (e.targetType === 'ref' && !e.action.endsWith('delete')) return h('a', { href: `#/ref/${id}` }, `#${id}`);
  if (e.targetType === 'resource' && !e.action.endsWith('delete')) return h('a', { href: `#/res/${id}` }, `자료 #${id}`);
  if (e.targetType === 'showcase' && !e.action.endsWith('delete')) return h('a', { href: `#/showcase/${id}` }, `쇼케이스 #${id}`);
  if (e.targetType === 'user') return h('a', { href: `#/user/${id}` }, '대상 프로필');
  return null;
}

export function mountAudit(root) {
  document.title = 'Audit log · GFX References';
  const body = h('div');
  const filter = h(
    'select.form-input.adm-filter',
    { 'aria-label': '종류' },
    ACTION_GROUPS.map(([v, label]) => h('option', { value: v }, label)),
  );
  root.append(
    h(
      'div.page-head',
      h('div', h('h1', 'Audit log'), h('p', '관리자가 관리자 권한으로 한 일이 모두 남아요 (사이트 · 디스코드 봇 둘 다). 기록은 지우거나 고칠 수 없어요.')),
      filter,
    ),
    body,
  );
  const gate = adminGate(body);
  if (gate) {
    filter.style.display = 'none';
    return gate;
  }

  let page = 1;
  const list = h('div.adm-audit');
  const more = h('button.btn', { onclick: () => load(page + 1) }, '더 보기');
  filter.addEventListener('change', () => load(1));

  async function load(p) {
    if (p === 1) clear(body).append(spinner());
    more.disabled = true;
    let res;
    try {
      res = await api.get('/api/admin/audit', { page: p, action: filter.value || undefined });
    } catch (err) {
      clear(body).append(emptyState(err.message));
      handleApiError(err);
      return;
    }
    page = p;
    if (p === 1) {
      clear(list);
      clear(body).append(h('p.hint', `모두 ${num(res.total)}건`), list, more);
      if (!res.items.length) clear(body).append(emptyState('아직 기록이 없어요.'));
    }
    for (const e of res.items) {
      list.append(
        h(
          'div.adm-audit-row',
          h('time.faint', { datetime: e.createdAt, title: new Date(e.createdAt).toLocaleString('ko-KR') }, fmtRelative(e.createdAt)),
          h('a.adm-actor', { href: `#/user/${e.actor.id}` }, h('img', { src: avatarSrc(e.actor.avatarUrl), alt: '' }), e.actor.name ?? e.actor.id),
          h('span.adm-summary', e.summary, ' ', targetLink(e)),
          h('code.adm-action', e.action),
        ),
      );
    }
    more.style.display = res.hasMore ? '' : 'none';
    more.disabled = false;
  }

  load(1);
  return {};
}
