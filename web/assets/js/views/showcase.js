import { api, ApiError } from '../api.js';
import { emptyState, handleApiError, requireLogin, ResultsGrid } from '../components.js';
import { avatarSrc, clear, debounce, fmtDate, h, spinner, toast } from '../dom.js';
import { t } from '../i18n.js';
import { store } from '../store.js';
import { refreshMe } from './edits.js';
import { openReportForm } from './reports.js';

/**
 * 쇼케이스 (#/showcase): 유튜브 영상만 모아 보는 탭.
 * 제목 · 제작자는 유튜브 정보 그대로, 올린 사람이 영상마다 점수를 받아요.
 * 재생목록 주소를 넣으면 관리자 승인 뒤에 한꺼번에 들어와요.
 */

const PLAY_ICON =
  '<svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.6)"/><path d="M10 8.5v7l5.5-3.5z" fill="#fff"/></svg>';

const points = () => store.meta?.showcase?.points ?? 3;

function showcaseCard(s) {
  return h(
    'a.sc-card',
    { href: `#/showcase/${s.id}`, title: s.title },
    h('div.sc-thumb', h('img', { src: s.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }), h('span.sc-play', { html: PLAY_ICON })),
    h(
      'div.sc-body',
      h('div.sc-title', s.title),
      h('div.sc-meta', s.channelName ?? ''),
      h('div.sc-by', h('img', { src: avatarSrc(s.addedBy.avatarUrl), alt: '' }), t('sc.addedBy', { name: s.addedBy.name ?? '?' })),
    ),
  );
}

const STATUS_CLASS = { pending: 'warn', approved: 'warn', rejected: 'bad', done: 'ok', failed: 'bad' };

function requestRow(r, actions) {
  return h(
    'div.sc-req',
    h(
      'div.sc-req-main',
      h('a', { href: `https://www.youtube.com/playlist?list=${encodeURIComponent(r.playlistId)}`, target: '_blank', rel: 'noopener noreferrer' }, r.title ?? r.playlistId),
      h(
        'span.faint',
        ` · ${r.channelName ?? ''} · ${t('sc.videos', { n: r.itemCount ?? '?' })}`,
        r.status === 'done' || r.status === 'failed' ? ` · ${t('sc.importedN', { n: r.imported })}` : '',
      ),
    ),
    h('span.sc-req-who', h('img', { src: avatarSrc(r.requestedBy.avatarUrl), alt: '' }), r.requestedBy.name ?? '?'),
    h(`span.sc-status.${STATUS_CLASS[r.status] ?? ''}`, t(`sc.status.${r.status}`)),
    actions ?? null,
  );
}

export function mountShowcase(root, params) {
  document.title = 'Showcase · GFX References';
  const me = store.me;
  let q = params.get('q') ?? '';
  let grid = null;

  // ── 올리기 ──
  const urlInput = h('input.form-input', { type: 'url', placeholder: t('sc.urlPlaceholder'), 'aria-label': t('sc.urlPlaceholder') });
  const addBtn = h('button.btn.primary', { type: 'submit' }, t('sc.add'));
  const addForm = h(
    'form.sc-add',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!requireLogin(t('sc.loginToAdd'))) return;
        const url = urlInput.value.trim();
        if (!url) return urlInput.focus();
        addBtn.disabled = true;
        try {
          const res = await api.post('/api/showcase', { url });
          urlInput.value = '';
          if (res.kind === 'video') {
            toast(t('sc.added', { n: points() }), 'ok');
            reload();
          } else {
            toast(t('sc.requested', { n: res.request.itemCount ?? '?' }), 'ok');
            loadRequests();
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) toast(t('sc.memberOnly'), 'error');
          else handleApiError(err);
        } finally {
          addBtn.disabled = false;
        }
      },
    },
    urlInput,
    addBtn,
  );
  const hint = h('p.hint', store.meta?.showcase?.playlist ? t('sc.playlistHint') : t('sc.playlistOff'));

  const search = h('input.form-input', { type: 'search', value: q, placeholder: t('sc.search'), 'aria-label': t('sc.search') });
  search.addEventListener(
    'input',
    debounce(() => {
      q = search.value.trim();
      history.replaceState(null, '', `#/showcase${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      reload();
    }, 280),
  );

  const requestsEl = h('div');
  const results = h('div');
  root.append(
    h('div.page-head', h('div', h('h1', 'Showcase'), h('p', t('sc.lead', { n: points() })))),
    h('div.sc-top', addForm, hint),
    requestsEl,
    h('div.res-toolbar', search),
    results,
  );

  function reload() {
    grid?.destroy();
    clear(results);
    grid = new ResultsGrid({
      layout: 'grid',
      gridClass: 'sc-grid',
      card: showcaseCard,
      load: (page) => api.get('/api/showcase', { q, page, limit: 24 }),
      empty: () => emptyState(q ? t('sc.noMatch') : t('sc.empty')),
    });
    results.append(grid.el);
  }

  // 관리자: 승인 대기 재생목록 / 멤버: 내가 보낸 요청
  async function loadRequests() {
    clear(requestsEl);
    if (!store.me) return;
    try {
      if (store.me.isAdmin) {
        const { items } = await api.get('/api/admin/showcase-requests');
        if (!items.length) return;
        requestsEl.append(
          h(
            'section.sc-requests',
            { id: 'requests' },
            h('h2', '승인 대기 재생목록'),
            h('p.hint', `승인하면 재생목록의 영상이 요청한 사람 이름으로 한꺼번에 들어오고, 영상마다 +${points()}점이 들어가요.`),
            items.map((r) =>
              requestRow(
                r,
                r.status === 'pending'
                  ? h(
                      'div.row',
                      h('button.btn.sm.primary', { onclick: () => decide(r, 'approve') }, '승인하고 가져오기'),
                      h('button.btn.sm.danger', { onclick: () => decide(r, 'reject') }, '거절'),
                    )
                  : null,
              ),
            ),
          ),
        );
        if (params.get('tab') === 'requests') requestsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const { items } = await api.get('/api/showcase-requests/mine');
        const recent = items.slice(0, 5);
        if (!recent.length) return;
        requestsEl.append(h('section.sc-requests', h('h2', t('sc.myRequests')), recent.map((r) => requestRow(r))));
      }
    } catch {
      /* 요청 목록은 없어도 됨 */
    }
  }

  async function decide(r, action) {
    if (action === 'reject' && !window.confirm(`"${r.title ?? r.playlistId}" 요청을 거절할까요?`)) return;
    try {
      await api.post(`/api/admin/showcase-requests/${r.id}`, { action });
      toast(action === 'approve' ? '승인했어요. 뒤에서 가져오는 중이에요.' : '거절했어요.', 'ok');
      refreshMe();
      loadRequests();
      if (action === 'approve') setTimeout(() => reload(), 3000);
    } catch (err) {
      handleApiError(err);
    }
  }

  reload();
  loadRequests();
  const off = store.on(() => {
    if ((store.me?.id ?? null) !== (me?.id ?? null)) loadRequests();
  });
  return {
    update(next) {
      const nq = next.get('q') ?? '';
      if (nq !== q) {
        q = nq;
        search.value = q;
        reload();
      }
    },
    destroy() {
      grid?.destroy();
      off();
    },
  };
}

/** 영상 하나 (#/showcase/:id) */
export function mountShowcaseItem(root, _params, { id, navigate }) {
  const body = h('div', spinner());
  root.append(h('a.res-back', { href: '#/showcase' }, '← Showcase'), body);

  (async () => {
    let s;
    try {
      s = (await api.get(`/api/showcase/${id}`)).item;
    } catch (err) {
      clear(body).append(emptyState(err.message));
      return;
    }
    document.title = `${s.title} · GFX References`;
    const me = store.me;
    const canDelete = !!me && (me.isAdmin || me.id === s.addedBy.id);
    clear(body).append(
      h(
        'div.sc-detail',
        h(
          'div.sc-player',
          h('iframe', {
            src: `https://www.youtube-nocookie.com/embed/${s.youtubeId}`,
            title: s.title,
            allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowfullscreen: true,
          }),
        ),
        h(
          'div.sc-info',
          h('h1', s.title),
          h(
            'div.sc-info-row',
            s.channelUrl
              ? h('a.sc-channel', { href: s.channelUrl, target: '_blank', rel: 'noopener noreferrer' }, s.channelName ?? '')
              : h('span.sc-channel', s.channelName ?? ''),
            h('span.faint', fmtDate(s.publishedAt ?? s.createdAt)),
          ),
          h(
            'div.sc-info-row',
            h('a.user-link', { href: `#/user/${s.addedBy.id}` }, h('img', { src: avatarSrc(s.addedBy.avatarUrl), alt: '' }), t('sc.addedBy', { name: s.addedBy.name ?? '?' })),
          ),
          h(
            'div.row',
            h('a.btn', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, t('sc.openYoutube')),
            h('button.btn.ghost.sm', { onclick: () => openReportForm('showcase', s.id, s.title) }, t('report.button')),
            canDelete
              ? h(
                  'button.btn.sm.danger',
                  {
                    onclick: async () => {
                      if (!window.confirm(t('sc.deleteConfirm'))) return;
                      try {
                        await api.post(`/api/showcase/${s.id}/delete`);
                        toast(t('sc.deleted'), 'ok');
                        navigate('#/showcase');
                      } catch (err) {
                        handleApiError(err);
                      }
                    },
                  },
                  t('sc.delete'),
                )
              : null,
          ),
        ),
      ),
    );
  })();
  return {};
}
