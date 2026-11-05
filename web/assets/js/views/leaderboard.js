import { api } from '../api.js';
import { emptyState } from '../components.js';
import { avatarSrc, clear, h, spinner } from '../dom.js';
import { getLang, t } from '../i18n.js';
import { store } from '../store.js';

const pad = (n) => String(n).padStart(2, '0');

/** 티어 뱃지 (💎 다이아몬드 …) */
function tierBadge(key, tiers) {
  const tier = tiers.find((x) => x.key === key);
  if (!tier) return null;
  return h('span.tier-badge', { style: { '--tier': tier.color }, title: getLang() === 'en' ? tier.ruleEn : tier.rule }, tier.emoji, ' ', getLang() === 'en' ? tier.labelEn : tier.label);
}

/** 티어 기준 안내 */
function tierLegend(tiers) {
  return h(
    'div.tier-legend',
    h('span.faint', t('ranking.tiers')),
    tiers.map((x) => h('span.tier-badge', { style: { '--tier': x.color } }, x.emoji, ' ', getLang() === 'en' ? x.labelEn : x.label, h('em', ` ${getLang() === 'en' ? x.ruleEn : x.rule}`))),
  );
}

/** "⭐ +2 · 🔥 +1.5 · 👍 +1" */
function reactionRules(scoring) {
  const points = scoring.reactionPoints ?? {};
  return (store.meta?.reactions ?? Object.keys(points))
    .map((e) => `${e} +${points[e] ?? scoring.pointsPerReaction}`)
    .join(' · ');
}

export function mountLeaderboard(root, params, { navigate }) {
  let page = Math.max(1, Number(params.get('page')) || 1);
  const body = h('div', spinner());
  const rules = h('p', '');
  root.append(h('div.page-head', h('div', h('h1', 'Ranking'), rules)), body);

  async function load() {
    clear(body).append(spinner());
    try {
      const data = await api.get('/api/leaderboard', { page, limit: 20 });
      rules.textContent = `${t('ranking.rules', { u: data.scoring.pointsPerUpload, r: reactionRules(data.scoring) })} · ${t('ranking.edits', { e: data.scoring.pointsPerEdit })} · ${t('ranking.more', { v: data.scoring.pointsPerVideo, a: data.scoring.pointsPerResource.asset, p: data.scoring.pointsPerResource.plugin, x: data.scoring.pointsPerResource.texturepack })}`;
      clear(body);
      const tiers = data.tiers ?? [];
      if (tiers.length) body.append(tierLegend(tiers));
      if (!data.rows.length) {
        body.append(emptyState(t('ranking.empty')));
        return;
      }
      let rows = data.rows;
      if (page === 1) {
        const top = rows.slice(0, 3);
        rows = rows.slice(3);
        const order = [top[1], top[0], top[2]].filter(Boolean);
        body.append(
          h(
            'div.podium',
            order.map((r) =>
              h(
                'a.p',
                { class: r.rank === 1 ? 'first' : '', href: `#/user/${r.userId}` },
                h('div.place', pad(r.rank)),
                h('img.avatar.lg', { src: avatarSrc(r.avatarUrl), alt: '' }),
                h('div.name', r.displayName || r.username),
                h('div.score', t('ranking.points', { n: r.score.toLocaleString() })),
                tierBadge(r.tier, tiers),
                h('div.hint', t('ranking.detail', { u: r.uploads, r: r.reactionsReceived })),
              ),
            ),
          ),
        );
        // 4 ~ 10위는 카드로 크게
        const next = rows.slice(0, 7);
        rows = rows.slice(7);
        if (next.length) {
          body.append(
            h('div.section-title', h('h2', 'Top 10')),
            h(
              'div.top10',
              next.map((r) =>
                h(
                  'a.top10-card',
                  { href: `#/user/${r.userId}` },
                  h('span.top10-rank', pad(r.rank)),
                  h('img.avatar', { src: avatarSrc(r.avatarUrl), alt: '' }),
                  h('span.top10-name', r.displayName || r.username),
                  tierBadge(r.tier, tiers),
                  h('b.top10-score', t('ranking.points', { n: r.score.toLocaleString() })),
                ),
              ),
            ),
          );
        }
      }
      if (rows.length) {
        body.append(
          h(
            'table.table',
            h(
              'thead',
              h(
                'tr',
                h('th', 'Rank'),
                h('th', 'Name'),
                h('th', 'Tier'),
                h('th.num', 'Score'),
                h('th.num.hide-sm', 'Uploads'),
                h('th.num.hide-sm', 'Reactions'),
                h('th.num.hide-sm', 'Bonus'),
              ),
            ),
            h(
              'tbody',
              rows.map((r) =>
                h(
                  'tr',
                  { onclick: () => navigate(`#/user/${r.userId}`) },
                  h('td.rank-cell', pad(r.rank)),
                  h('td', h('div.who-cell', h('img.avatar', { src: avatarSrc(r.avatarUrl), alt: '' }), r.displayName || r.username)),
                  h('td', tierBadge(r.tier, tiers)),
                  h('td.num', h('b', r.score.toLocaleString())),
                  h('td.num.hide-sm', String(r.uploads)),
                  h('td.num.hide-sm', String(r.reactionsReceived)),
                  h('td.num.hide-sm', r.adjustments > 0 ? `+${r.adjustments}` : String(r.adjustments ?? 0)),
                ),
              ),
            ),
          ),
        );
      }
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (pages > 1) {
        body.append(
          h(
            'div.pager',
            h('button.btn.sm', { disabled: page <= 1, onclick: () => go(page - 1) }, t('ranking.prev')),
            h('span.muted', `${page} / ${pages}`),
            h('button.btn.sm', { disabled: page >= pages, onclick: () => go(page + 1) }, t('ranking.next')),
          ),
        );
      }
    } catch (err) {
      clear(body).append(emptyState(err.message));
    }
  }

  function go(p) {
    page = p;
    history.replaceState(null, '', `#/leaderboard${page > 1 ? `?page=${page}` : ''}`);
    load();
  }

  load();
  return {
    update(params) {
      const p = Math.max(1, Number(params.get('page')) || 1);
      if (p !== page) {
        page = p;
        load();
      }
    },
  };
}
