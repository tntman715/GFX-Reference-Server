import { api } from '../api.js';
import { emptyState, handleApiError, openBoardPicker, openOverlay, paletteBar, requireLogin, ResultsGrid } from '../components.js';
import { avatarSrc, clear, copyText, fmtBytes, fmtDate, h, spinner, toast } from '../dom.js';
import { categoryLabel, t } from '../i18n.js';
import { store } from '../store.js';
import { canEditRef, openEditForm, proposalCard } from './edits.js';
import { openReportForm } from './reports.js';

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
    similarGrid?.destroy();
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

    // ── 대기 중인 수정 제안 (올린 사람/관리자는 받아들이기·거절, 제안한 사람은 취소) ──
    // ── 제작과정(스피드아트) 영상: 누구나 붙일 수 있고, 붙인 사람이 점수를 받음 ──
    const videosEl = h('div.detail-videos');
    const renderVideos = (items, points) => {
      clear(videosEl);
      videosEl.append(h('div.field-label', 'Speedart', h('span.faint', t('video.lead', { n: points }))));
      const list = h('div.video-list');
      for (const v of items) {
        const thumb = h(
          'button.video-thumb',
          {
            type: 'button',
            title: v.title ?? 'YouTube',
            onclick: () =>
              thumb.replaceWith(
                h('iframe.video-frame', {
                  src: `https://www.youtube-nocookie.com/embed/${v.youtubeId}?autoplay=1`,
                  title: v.title ?? 'YouTube',
                  allow: 'autoplay; encrypted-media; picture-in-picture; clipboard-write',
                  allowfullscreen: true,
                }),
              ),
          },
          h('img', { src: v.thumbUrl, alt: '', loading: 'lazy' }),
          h('span.video-play', { 'aria-hidden': 'true' }, '▶'),
        );
        list.append(
          h(
            'div.video-item',
            thumb,
            h(
              'div.video-meta',
              v.title ? h('a.video-title', { href: `https://youtu.be/${v.youtubeId}`, target: '_blank', rel: 'noopener noreferrer' }, v.title) : null,
              h(
                'span.faint',
                t('video.addedBy'),
                ' ',
                h('a.user-link', { href: `#/user/${v.addedBy.id}` }, h('img', { src: avatarSrc(v.addedBy.avatarUrl), alt: '' }), v.addedBy.name ?? '?'),
                ` · ${fmtDate(v.createdAt)}`,
              ),
              v.canRemove
                ? h(
                    'button.btn.sm.ghost',
                    {
                      onclick: async () => {
                        if (!window.confirm(t('video.removeConfirm'))) return;
                        try {
                          const res = await api.post(`/api/refs/${ref.id}/videos/${v.id}/delete`);
                          toast(t('video.removed'), 'ok');
                          render(res.item);
                        } catch (err) {
                          handleApiError(err);
                        }
                      },
                    },
                    t('video.remove'),
                  )
                : null,
            ),
          ),
        );
      }
      if (items.length) videosEl.append(list);
      if (items.length < 3 && !items.some((v) => v.addedBy.id === store.me?.id)) {
        const input = h('input.form-input', { type: 'url', placeholder: t('video.placeholder'), 'aria-label': t('video.placeholder') });
        const btn = h('button.btn.sm', { type: 'submit' }, t('video.add', { n: points }));
        videosEl.append(
          h(
            'form.video-add',
            {
              onsubmit: async (e) => {
                e.preventDefault();
                if (!requireLogin(t('video.login'))) return;
                if (!input.value.trim()) return input.focus();
                btn.disabled = true;
                try {
                  const res = await api.post(`/api/refs/${ref.id}/videos`, { url: input.value.trim() });
                  toast(t('video.added', { n: points }), 'ok');
                  render(res.item);
                } catch (err) {
                  handleApiError(err);
                  btn.disabled = false;
                }
              },
            },
            input,
            btn,
          ),
        );
      } else if (!items.length) {
        videosEl.append(h('span.faint', t('video.none')));
      }
    };
    api
      .get(`/api/refs/${ref.id}/videos`)
      .then((res) => renderVideos(res.items, res.points))
      .catch(() => clear(videosEl));

    const proposalsEl = h('div.detail-proposals');
    const loadProposals = async () => {
      if (!store.me) return clear(proposalsEl);
      try {
        const res = await api.get(`/api/refs/${ref.id}/proposals`);
        clear(proposalsEl);
        if (!res.proposals.length) return;
        proposalsEl.append(h('div.field-label', 'Suggested edits'));
        for (const p of res.proposals) {
          const mine = p.proposer.id === store.me?.id;
          if (mine && !res.canEdit) proposalsEl.append(h('p.hint', t('edit.mine')));
          proposalsEl.append(
            proposalCard(p, {
              mode: res.canEdit ? 'review' : 'mine',
              showRef: false,
              onDone: (what, item) => {
                if (what === 'accepted' && item) render(item);
                else loadProposals();
              },
            }),
          );
        }
      } catch {
        /* 제안 목록은 못 불러와도 상세 화면은 그대로 */
      }
    };
    loadProposals();

    // 항목 이름(Category, Map …)은 두 언어 모두 영어
    const similarEl = h('div');
    const kv = h('dl.kv');
    const row = (k, v) => kv.append(h('dt', k), h('dd', v));
    row('Category', categoryLabel(cat));
    if (ref.mapName) row('Map', ref.mapName);
    const creators = ref.creators?.length ? ref.creators : [ref.creator];
    row(
      creators.length > 1 ? 'Creators' : 'Creator',
      h(
        'span.creator-list',
        creators.map((c) =>
          h('a.user-link', { href: `#/?creator=${encodeURIComponent(c.name)}`, title: t('detail.moreByCreator') }, c.name),
        ),
      ),
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
          videosEl,
          h('div', h('div.field-label', 'Reactions'), reactions),
          proposalsEl,
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
            h(
              'div.row',
              h('button.btn.sm', { onclick: () => openBoardPicker(ref) }, t('board.save')),
              h(
                'button.btn.sm',
                {
                  onclick: () =>
                    openEditForm(ref, {
                      onDone: (res) => {
                        if (res.mode === 'applied') render(res.item);
                        else loadProposals();
                      },
                    }),
                },
                canEditRef(ref) ? t('edit.edit') : t('edit.propose'),
              ),
            ),
            h(
              'div.row',
              h('button.btn.sm.ghost', { onclick: () => openReportForm('ref', ref.id, `#${ref.id} ${ref.title}`) }, t('report.button')),
              canEditRef(ref)
                ? h(
                    'button.btn.sm.danger',
                    {
                      onclick: async () => {
                        if (!window.confirm(t('detail.deleteConfirm', { id: ref.id, title: ref.title }))) return;
                        try {
                          await api.post(`/api/refs/${ref.id}/delete`);
                          toast(t('detail.deleted', { id: ref.id }), 'ok');
                          store.refreshMeta().catch(() => undefined);
                          go('#/');
                        } catch (err) {
                          handleApiError(err);
                        }
                      },
                    },
                    t('detail.delete'),
                  )
                : null,
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
