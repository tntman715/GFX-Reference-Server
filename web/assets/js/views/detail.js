import { api } from '../api.js';
import { emptyState, handleApiError, openOverlay, paletteBar, requireLogin, ResultsGrid } from '../components.js';
import { clear, copyText, fmtBytes, fmtDate, h, spinner, toast } from '../dom.js';
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
      clear(body).append(h('div', { style: { padding: '40px' } }, emptyState('😢', err.message)));
    });

  function render(ref) {
    const meta = store.meta;
    const cat = store.category(ref.category);
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
            title: mine.has(e) ? '반응 취소' : '반응 남기기',
            onclick: async () => {
              if (!requireLogin('반응을 남기려면 디스코드로 로그인해 주세요.')) return;
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
          if (!requireLogin('원본은 디스코드 로그인 후 받을 수 있어요.')) return;
          dlBtn.disabled = true;
          const label = dlBtn.textContent;
          dlBtn.textContent = '디스코드에서 가져오는 중…';
          try {
            const name = await api.download(ref.id);
            toast(`⬇️ ${name}`, 'ok');
          } catch (err) {
            handleApiError(err);
          } finally {
            dlBtn.disabled = false;
            dlBtn.textContent = label;
          }
        },
      },
      '⬇️ 원본 다운로드',
    );
    const dmBtn = h(
      'button.btn',
      {
        disabled: !meta?.bot?.online,
        onclick: async () => {
          if (!requireLogin('디스코드 DM으로 받으려면 로그인해 주세요.')) return;
          dmBtn.disabled = true;
          try {
            await api.post(`/api/refs/${ref.id}/dm`);
            toast('📨 디스코드 DM으로 원본을 보냈어요!', 'ok');
          } catch (err) {
            handleApiError(err);
          } finally {
            dmBtn.disabled = false;
          }
        },
      },
      '📨 디스코드 DM으로 받기',
    );

    const similarEl = h('div');
    const kv = h('dl.kv');
    const row = (k, v) => kv.append(h('dt', k), h('dd', v));
    row('분류', `${cat?.emoji ?? ''} ${ref.categoryLabel}`);
    if (ref.mapName) row('맵', ref.mapName);
    row(
      '제작자',
      h('a.user-link', { href: `#/?creator=${encodeURIComponent(ref.creator.name)}`, title: '이 제작자의 레퍼런스 보기' }, ref.creator.name),
    );
    row(
      '올린 사람',
      h(
        'a.user-link',
        { href: `#/user/${ref.uploader.id}` },
        ref.uploader.avatarUrl ? h('img', { src: ref.uploader.avatarUrl, alt: '' }) : null,
        ref.uploader.name ?? '알 수 없음',
      ),
    );
    row('올린 날', fmtDate(ref.createdAt));
    row('원본', `${ref.width}×${ref.height} · ${fmtBytes(ref.originalSize)}`);

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
          h('h2', h('span.id', `#${ref.id} `), ref.title),
          kv,
          h(
            'div',
            h('div.hint', { style: { marginBottom: '8px' } }, '태그'),
            ref.tags.length
              ? h(
                  'div.tag-list',
                  ref.tags.map((t) => h('button.chip', { onclick: () => go(`#/?tags=${encodeURIComponent(t)}`) }, `#${t}`)),
                )
              : h('span.faint', '태그 없음'),
          ),
          h(
            'div',
            h('div.hint', { style: { marginBottom: '8px' } }, '팔레트 · 누르면 이 색으로 검색 (길게 누르면 복사)'),
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
                      if (await copyText(p.hex)) toast(`${p.hex} 복사했어요`, 'ok');
                    },
                  },
                  h('span.sw', { style: { background: p.hex } }),
                  p.hex,
                ),
              ),
            ),
          ),
          h('div', h('div.hint', { style: { marginBottom: '8px' } }, '반응'), reactions),
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
                    if (await copyText(ref.siteUrl)) toast('링크를 복사했어요', 'ok');
                  },
                },
                '🔗 링크 복사',
              ),
              h('button.btn.sm', { onclick: () => similarEl.scrollIntoView({ behavior: 'smooth' }) }, '🎨 비슷한 색감'),
            ),
            h(
              'p.hint',
              archiveOk
                ? '원본은 GFX References 디스코드 아카이브에서 바로 가져와요.'
                : '디스코드 봇이 오프라인이라 지금은 원본을 받을 수 없어요.',
            ),
          ),
        ),
      ),
      h('div.detail-similar', h('div.section-title', h('h2', '🎨 비슷한 색감의 레퍼런스')), similarEl),
    );

    similarGrid = new ResultsGrid({
      minColWidth: 200,
      load: (page) => api.get('/api/refs', { similar: ref.id, page, limit: 12 }),
      empty: () => emptyState('🎨', '색감이 비슷한 레퍼런스가 아직 없어요.'),
    });
    similarEl.append(similarGrid.el);
  }

  return overlay;
}
