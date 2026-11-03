import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { avatarSrc, clear, h, spinner } from '../dom.js';
import { store } from '../store.js';

export function mountProfile(root, params, { id }) {
  const body = h('div', spinner());
  root.append(body);
  const grids = [];

  api
    .get(`/api/users/${id}`)
    .then((p) => {
      clear(body);
      const name = p.user.displayName || p.user.username;
      document.title = `${name} · GFX References`;
      const s = p.score;
      const counts = p.categories;
      const max = Math.max(1, ...Object.values(counts));
      body.append(
        h(
          'div.profile-head',
          h('img.avatar.lg', { src: avatarSrc(p.user.avatarUrl), alt: '' }),
          h(
            'div',
            { style: { flex: '1', minWidth: '200px' } },
            h('h1', name),
            h('div.muted', `@${p.user.username}`),
          ),
          s ? h('div', { style: { textAlign: 'right' } }, h('div', { style: { fontSize: '30px', fontWeight: 850 } }, `${s.score.toLocaleString()}점`), h('div.muted', `전체 ${s.rank}위`)) : null,
        ),
        h(
          'div.stats',
          stat('업로드', s?.uploads ?? 0),
          stat('받은 반응', s?.reactionsReceived ?? 0),
          stat('보너스', s?.adjustments ?? 0),
          stat('순위', s ? `${s.rank}위` : '—'),
        ),
        h('div.section-title', h('h2', '분류별 업로드')),
        h(
          'div.bars',
          (store.meta?.categories ?? []).map((c) =>
            h(
              'div.bar',
              h('span', `${c.emoji} ${c.label}`),
              h('div.track', h('div.fill', { style: { width: `${((counts[c.key] ?? 0) / max) * 100}%` } })),
              h('b', String(counts[c.key] ?? 0)),
            ),
          ),
        ),
      );

      const section = (title, items, more) => {
        body.append(h('div.section-title', h('h2', title), more ?? null));
        const g = new ResultsGrid({
          minColWidth: 230,
          load: async () => ({ items, hasMore: false, total: items.length }),
          empty: () => emptyState('🖼️', '아직 없어요.'),
        });
        grids.push(g);
        body.append(g.el);
      };
      if (p.top.length) section('🔥 인기 레퍼런스', p.top);
      section(
        '🆕 최근 올린 레퍼런스',
        p.recent,
        p.recent.length
          ? h('a.btn.sm', { href: `#/?uploader=${p.user.id}&uploaderName=${encodeURIComponent(name)}` }, '전체 보기 →')
          : null,
      );
    })
    .catch((err) => clear(body).append(emptyState('😢', err.message)));

  return { destroy: () => grids.forEach((g) => g.destroy()) };
}

function stat(k, v) {
  return h('div.stat', h('div.v', typeof v === 'number' ? v.toLocaleString() : v), h('div.k', k));
}
