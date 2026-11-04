import { api } from '../api.js';
import { emptyState, handleApiError, openOverlay, paletteBar, requireLogin, ResultsGrid } from '../components.js';
import { clear, copyText, fmtBytes, fmtDate, h, spinner, toast } from '../dom.js';
import { categoryLabel, t } from '../i18n.js';
import { store } from '../store.js';

/** 레퍼런스 상세 (오버레이) */
export function openDetail(id, { onClose, navigate }) {
  let similarGrid = null;
  const body = h('div', spinner());
  const overlay = openOverlay(body, {
    onClose: () => {
      similarGrid?.destroy();
      onClose?.();
    },
  });

  // 먼저 이동한 뒤 닫아야 onClose 의 history.back() 과 겹치지 않음
  const go = (hash) => {
    navigate(hash);
    overlay.close();
  };

  api
    .get(`/api/refs/${id}`)
    .then(({ item }) => render(item))
    .catch((err) => {
      clear(body).append(h('div', { style: { padding: '40px' } }, emptyState(err.message)));
    });

  function render(ref) {
    const meta = store.meta;
    const cat = store.category(ref.category) ?? { key: ref.category, label: ref.categoryLabel };
    const archiveOk = meta?.archive?.available;
    document.title = `#${ref.id} ${ref.title} · GFX References`;

    // ── 반응 ──
    const reactions = h('div.reactions');
    let mine = new Set(ref.myReactions ?? []);
    const renderReactions = (counts, popEmoji) => {
      clear(reactions);
      for (const e of meta?.reactions ?? []) {
        const btn = h(
          'button.react-btn',
          {
            class: [mine.has(e) ? 'on' : '', popEmoji === e ? 'pop' : ''].join(' '),
            title: mine.has(e) ? t('detail.unreact') : t('detail.react'),
            onclick: async () => {
              if (!requireLogin(t('detail.loginToReact'))) return;
              btn.disabled = true;
              try {
                const res = await api.post(`/api/refs/${ref.id}/reactions`, { emoji: e });
                mine = new Set(res.myReactions);
                renderReactions(res.reactions, res.active ? e : null);
              } catch (err) {
                handleApiError(err);
                btn.disabled = false;
              }
            },
          },
          h('span', e),
          h('span.n', String(counts[e] ?? 0)),
        );
        reactions.append(btn);
      }
    };
    renderReactions(ref.reactions);

    // ── 다운로드 ──
    const dlBtn = h(
      'button.btn.primary',
      {
        disabled: !archiveOk,
        onclick: async () => {
          if (!requireLogin(t('detail.loginToDownload'))) return;
          dlBtn.disabled = true;
          const label = dlBtn.textContent;
          dlBtn.textContent = t('detail.downloading');
          try {
            const name = await api.download(ref.id);
            toast(t('detail.downloaded', { name }), 'ok');
          } catch (err) {
            handleApiError(err);
          } finally {
            dlBtn.disabled = false;
            dlBtn.textContent = label;
          }
        },
      },
      t('detail.download'),
    );
    const dmBtn = h(
      'button.btn',
      {
        disabled: !meta?.bot?.online,
        onclick: async () => {
          if (!requireLogin(t('detail.loginToDm'))) return;
          dmBtn.disabled = true;
          try {
            await api.post(`/api/refs/${ref.id}/dm`);
            toast(t('detail.dmSent'), 'ok');
          } catch (err) {
            handleApiError(err);
          } finally {
            dmBtn.disabled = false;
          }
        },
      },
      t('detail.dm'),
    );

    // 항목 이름(Category, Map …)은 두 언어 모두 영어
    const similarEl = h('div');
    const kv = h('dl.kv');
    const row = (k, v) => kv.append(h('dt', k), h('dd', v));
    row('Category', categoryLabel(cat));
    if (ref.mapName) row('Map', ref.mapName);
    row(
      'Creator',
      h('a.user-link', { href: `#/?creator=${encodeURIComponent(ref.creator.name)}`, title: t('detail.moreByCreator') }, ref.creator.name),
    );
    row(
      'Uploader',
      h(
        'a.user-link',
        { href: `#/user/${ref.uploader.id}` },
        ref.uploader.avatarUrl ? h('img', { src: ref.uploader.avatarUrl, alt: '' }) : null,
        ref.uploader.name ?? t('detail.unknown'),
      ),
    );
    row('Uploaded', fmtDate(ref.createdAt));
    row('Original', `${ref.width}×${ref.height} · ${fmtBytes(ref.originalSize)}`);

    clear(body).append(
      h(
        'div.detail',
        h(
          'div.detail-media',
          h('img', { src: ref.preview.url, alt: ref.title, width: ref.preview.width, height: ref.preview.height }),
          paletteBar(ref.palette, 8),
        ),
        h(
          'div.detail-info',
          h('h2', h('span.id', `#${ref.id}`), ref.title),
          kv,
          h(
            'div',
            h('div.field-label', 'Tags'),
            ref.tags.length
              ? h(
                  'div.tag-list',
                  ref.tags.map((tag) => h('button.chip', { onclick: () => go(`#/?tags=${encodeURIComponent(tag)}`) }, `#${tag}`)),
                )
              : h('span.faint', t('detail.noTags')),
          ),
          h(
            'div',
            h('div.field-label', 'Palette', h('span.faint', t('detail.paletteHint'))),
            h(
              'div.palette',
              ref.palette.map((p) =>
                h(
                  'button',
                  {
                    title: `${p.hex} · ${Math.round(p.share * 100)}%`,
                    onclick: () => go(`#/colors?hex=${encodeURIComponent(p.hex)}`),
                    oncontextmenu: async (e) => {
                      e.preventDefault();
                      if (await copyText(p.hex)) toast(t('detail.hexCopied', { hex: p.hex }), 'ok');
                    },
                  },
                  h('span.sw', { style: { background: p.hex } }),
                  p.hex,
                ),
              ),
            ),
          ),
          h('div', h('div.field-label', 'Reactions'), reactions),
          h(
            'div.actions',
            dlBtn,
            dmBtn,
            h(
              'div.row',
              h(
                'button.btn.sm',
                {
                  onclick: async () => {
                    if (await copyText(ref.siteUrl)) toast(t('detail.linkCopied'), 'ok');
                  },
                },
                t('detail.copyLink'),
              ),
              h('button.btn.sm', { onclick: () => similarEl.scrollIntoView({ behavior: 'smooth' }) }, t('detail.similar')),
            ),
            h('p.hint', archiveOk ? t('detail.archiveOk') : t('detail.archiveOff')),
          ),
        ),
      ),
      h('div.detail-similar', h('div.section-title', h('h2', 'Similar colors')), similarEl),
    );

    similarGrid = new ResultsGrid({
      minColWidth: 200,
      load: (page) => api.get('/api/refs', { similar: ref.id, page, limit: 12 }),
      empty: () => emptyState(t('detail.similarEmpty')),
    });
    similarEl.append(similarGrid.el);
  }

  return overlay;
}
