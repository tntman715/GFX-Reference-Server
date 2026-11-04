import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { avatarSrc, clear, h, spinner } from '../dom.js';
import { categoryLabel, t } from '../i18n.js';
import { store } from '../store.js';
import { profileBoards } from './boards.js';

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
          h('div.profile-name', h('span.handle', `@${p.user.username}`), h('h1', name)),
          s
            ? h(
                'div.profile-score',
                h('div.big', t('ranking.points', { n: s.score.toLocaleString() })),
                h('div.muted', t('profile.rank', { r: s.rank })),
              )
            : null,
        ),
        h(
          'div.stats',
          stat('Uploads', s?.uploads ?? 0),
          stat('Reactions', s?.reactionsReceived ?? 0),
          stat('Edits', s?.acceptedEdits ?? 0),
          stat('Bonus', s?.adjustments ?? 0),
          stat('Rank', s ? t('profile.rankShort', { r: s.rank }) : '-'),
        ),
        h('div.section-title', h('h2', 'By category')),
        h(
          'div.bars',
          (store.meta?.categories ?? []).map((c) =>
            h(
              'div.bar',
              h('span', categoryLabel(c)),
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
          empty: () => emptyState(t('profile.empty')),
        });
        grids.push(g);
        body.append(g.el);
      };
      body.append(profileBoards(p.user.id));
      if (p.top.length) section('Most loved', p.top);
      section(
        'Latest',
        p.recent,
        p.recent.length ? h('a.btn.sm', { href: `#/?uploader=${p.user.id}&uploaderName=${encodeURIComponent(name)}` }, 'View all →') : null,
      );
    })
    .catch((err) => clear(body).append(emptyState(err.message)));

  return { destroy: () => grids.forEach((g) => g.destroy()) };
}

function stat(k, v) {
  return h('div.stat', h('div.v', typeof v === 'number' ? v.toLocaleString() : v), h('div.k', k));
}
