import { api, ApiError } from '../api.js';
import { emptyState, handleApiError, openOverlay, requireLogin, ResultsGrid } from '../components.js';
import { avatarSrc, clear, debounce, fmtBytes, fmtDate, h, spinner, toast } from '../dom.js';
import { getLang, t } from '../i18n.js';
import { store } from '../store.js';
import { openReportForm } from './reports.js';

/** 에셋 · 플러그인 · 텍스쳐팩 탭 (종류마다 같은 화면, 태그만 따로) */
export const KIND_ROUTES = { asset: '/assets', plugin: '/plugins', texturepack: '/texturepacks' };
const TITLES = { asset: 'Assets', plugin: 'Plugins', texturepack: 'Texture packs' };

const kindInfo = (kind) => store.meta?.resourceKinds?.find((k) => k.key === kind) ?? { key: kind, label: kind, labelEn: kind, points: 10 };
const kindName = (kind) => (getLang() === 'en' ? kindInfo(kind).labelEn : kindInfo(kind).label);

const PLAY_ICON =
  '<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.6)"/><path d="M10 8.5v7l5.5-3.5z" fill="#fff"/></svg>';

/**
 * 투명 배경 이미지(PNG 하프톤 등)는 어두운 배경에서 안 보이므로,
 * 다 읽은 뒤 투명한 곳이 있으면 체크무늬 배경을 깔아 줌.
 */
function alphaImg(props) {
  const img = h('img', props);
  const check = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 250) {
          img.classList.add('has-alpha');
          return;
        }
      }
    } catch {
      /* 다른 사이트 이미지(유튜브 썸네일 등)는 검사하지 않음 */
    }
  };
  if (img.complete && img.naturalWidth) check();
  else img.addEventListener('load', check, { once: true });
  return img;
}

function fileExt(r) {
  const name = r.file?.name ?? '';
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toUpperCase() : r.linkUrl ? 'LINK' : 'FILE';
}

/** 목록 카드 */
function resourceCard(r) {
  const thumb = r.preview
    ? alphaImg({ src: r.preview.url, alt: '', loading: 'lazy', decoding: 'async' })
    : h('span.res-ext', fileExt(r));
  const hasVideo = r.media.some((m) => m.type === 'youtube');
  return h(
    'a.res-card',
    { href: `#/res/${r.id}`, title: r.title },
    h('div.res-thumb', thumb, hasVideo ? h('span.res-play', { html: PLAY_ICON }) : null, h('span.res-badge', fileExt(r))),
    h(
      'div.res-body',
      h('div.res-title', r.title),
      h('div.res-meta', r.creators.length ? r.creators.map((c) => c.name).join(', ') : (r.uploader.name ?? ''), h('span.faint', ` · ⬇ ${r.downloads}`)),
      r.tags.length ? h('div.res-tags', r.tags.slice(0, 4).map((tg) => h('span', `#${tg}`))) : null,
    ),
  );
}

/** 탭 화면 (#/assets, #/plugins, #/texturepacks) */
export function mountResources(root, params, { kind, navigate }) {
  document.title = `${TITLES[kind]} · GFX References`;
  const state = { q: params.get('q') ?? '', tags: (params.get('tags') ?? '').split(',').filter(Boolean), sort: params.get('sort') === 'downloads' ? 'downloads' : 'newest' };
  let grid = null;
  const search = h('input.form-input', { type: 'search', value: state.q, placeholder: t('res.search'), 'aria-label': t('res.search') });
  const sortSeg = h('div.segmented');
  const tagRow = h('div.tag-list.res-filter');
  const results = h('div');
  const uploadBtn = h('button.btn.primary', { onclick: () => openResourceUpload(kind, { navigate }) }, t('res.upload', { kind: kindName(kind) }));
  root.append(
    h('div.page-head', h('div', h('h1', TITLES[kind]), h('p', t(`res.lead.${kind}`, { n: kindInfo(kind).points }))), uploadBtn),
    h('div.res-toolbar', search, sortSeg),
    tagRow,
    results,
  );

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.tags.length) p.set('tags', state.tags.join(','));
    if (state.sort !== 'newest') p.set('sort', state.sort);
    const qs = p.toString();
    history.replaceState(null, '', `#${KIND_ROUTES[kind]}${qs ? `?${qs}` : ''}`);
  };

  const reload = () => {
    grid?.destroy();
    clear(results);
    grid = new ResultsGrid({
      layout: 'grid',
      gridClass: 'res-grid',
      card: resourceCard,
      load: (page) => api.get('/api/resources', { kind, q: state.q, tags: state.tags, sort: state.sort, page, limit: 24 }),
      empty: () => emptyState(state.q || state.tags.length ? t('res.noMatch') : t('res.empty', { kind: kindName(kind) })),
    });
    results.append(grid.el);
  };

  const renderSort = () => {
    clear(sortSeg);
    for (const [key, label] of [
      ['newest', t('res.sort.newest')],
      ['downloads', t('res.sort.downloads')],
    ]) {
      sortSeg.append(
        h(
          'button',
          {
            class: state.sort === key ? 'on' : '',
            onclick: () => {
              state.sort = key;
              renderSort();
              syncUrl();
              reload();
            },
          },
          label,
        ),
      );
    }
  };

  const renderTags = async () => {
    try {
      const { tags } = await api.get('/api/resources/tags', { kind });
      clear(tagRow);
      for (const tg of tags) {
        const on = state.tags.includes(tg.name);
        tagRow.append(
          h(
            'button.chip',
            {
              class: on ? 'on' : '',
              title: tg.description ?? '',
              onclick: () => {
                state.tags = on ? state.tags.filter((x) => x !== tg.name) : [...state.tags, tg.name];
                renderTags();
                syncUrl();
                reload();
              },
            },
            `#${tg.name}`,
            h('span.count', String(tg.count)),
          ),
        );
      }
    } catch {
      /* 태그 없이도 목록은 보여줌 */
    }
  };

  search.addEventListener(
    'input',
    debounce(() => {
      state.q = search.value.trim();
      syncUrl();
      reload();
    }, 300),
  );
  renderSort();
  renderTags();
  reload();
  return { destroy: () => grid?.destroy() };
}

/** 상세 화면 (#/res/:id) */
export function mountResource(root, _params, { id, navigate }) {
  const body = h('div', spinner());
  root.append(body);

  api
    .get(`/api/resources/${id}`)
    .then(({ item }) => render(item))
    .catch((err) => clear(body).append(emptyState(err.message)));

  function render(r) {
    document.title = `${r.title} · GFX References`;
    const me = store.me;
    const canEdit = !!me && (me.isAdmin || me.id === r.uploader.id);

    // ── 사진 · 영상 보기 ──
    const viewer = h('div.res-viewer');
    const strip = h('div.res-strip');
    const show = (m) => {
      clear(viewer).append(
        m.type === 'image'
          ? alphaImg({ src: m.url, alt: r.title, width: m.width, height: m.height })
          : h('iframe', {
              src: `https://www.youtube-nocookie.com/embed/${m.id}`,
              title: 'YouTube',
              allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
              allowfullscreen: true,
              loading: 'lazy',
            }),
      );
      for (const b of strip.children) b.classList.toggle('on', b.dataset.key === (m.url ?? m.id));
    };
    for (const m of r.media) {
      strip.append(
        h(
          'button.res-strip-item',
          { type: 'button', dataset: { key: m.url ?? m.id }, onclick: () => show(m) },
          m.type === 'image' ? alphaImg({ src: m.url, alt: '' }) : h('img', { src: m.thumbUrl, alt: '' }),
          m.type === 'youtube' ? h('span.res-play.sm', { html: PLAY_ICON }) : null,
        ),
      );
    }
    if (r.media.length) show(r.media[0]);
    else viewer.append(h('div.res-viewer-empty', h('span.res-ext', fileExt(r)), h('span.faint', t('res.noPreview'))));

    // ── 받기 ──
    const actions = h('div.res-actions');
    if (r.file) {
      const dl = h(
        'button.btn.primary',
        {
          onclick: async () => {
            if (!requireLogin(t('res.loginToDownload'))) return;
            dl.disabled = true;
            try {
              const name = await api.downloadFile(`/api/resources/${r.id}/file`, r.file.name);
              toast(t('detail.downloaded', { name }), 'ok');
            } catch (err) {
              handleApiError(err);
            } finally {
              dl.disabled = false;
            }
          },
        },
        t('res.download'),
        h('span.faint', ` ${r.file.name} · ${fmtBytes(r.file.size)}`),
      );
      actions.append(dl);
    }
    if (r.linkUrl) actions.append(h('a.btn', { href: r.linkUrl, target: '_blank', rel: 'noopener noreferrer' }, t('res.openLink')));
    actions.append(
      h(
        'div.row',
        h('button.btn.sm.ghost', { onclick: () => openReportForm('resource', r.id, `${kindName(r.kind)} #${r.id} ${r.title}`) }, t('report.button')),
        canEdit
          ? h(
              'button.btn.sm.danger',
              {
                onclick: async () => {
                  if (!window.confirm(t('res.deleteConfirm', { title: r.title }))) return;
                  try {
                    await api.post(`/api/resources/${r.id}/delete`);
                    toast(t('res.deleted'), 'ok');
                    navigate(`#${KIND_ROUTES[r.kind]}`);
                  } catch (err) {
                    handleApiError(err);
                  }
                },
              },
              t('detail.delete'),
            )
          : null,
      ),
    );

    const kv = h('dl.kv');
    const row = (k, v) => kv.append(h('dt', k), h('dd', v));
    row('Type', h('a.user-link', { href: `#${KIND_ROUTES[r.kind]}` }, kindName(r.kind)));
    if (r.creators.length) row(r.creators.length > 1 ? 'Creators' : 'Creator', r.creators.map((c) => c.name).join(', '));
    row(
      'Uploader',
      h('a.user-link', { href: `#/user/${r.uploader.id}` }, h('img', { src: avatarSrc(r.uploader.avatarUrl), alt: '' }), r.uploader.name ?? '?'),
    );
    row('Uploaded', fmtDate(r.createdAt));
    row('Downloads', String(r.downloads));

    clear(body).append(
      h('a.res-back', { href: `#${KIND_ROUTES[r.kind]}` }, `← ${TITLES[r.kind]}`),
      h(
        'div.res-detail',
        h('div.res-media', viewer, r.media.length > 1 ? strip : null),
        h(
          'div.res-info',
          h('h1', h('span.id', `#${r.id}`), r.title),
          r.description ? h('p.res-desc', r.description) : null,
          kv,
          r.tags.length
            ? h(
                'div',
                h('div.field-label', 'Tags'),
                h(
                  'div.tag-list',
                  r.tags.map((tg) => h('a.chip', { href: `#${KIND_ROUTES[r.kind]}?tags=${encodeURIComponent(tg)}` }, `#${tg}`)),
                ),
              )
            : null,
          actions,
        ),
      ),
    );
  }

  return {};
}

/** 올리기 창 */
export function openResourceUpload(kind, { navigate } = {}) {
  if (!requireLogin(t('upload.loginReason'))) return;
  const me = store.me;
  if (!me.isMember && !me.isAdmin) return void toast(t('upload.membersOnly'), 'error');
  const maxBytes = store.meta?.upload?.resourceMaxBytes ?? 10 * 1024 * 1024;
  const mb = Math.round(maxBytes / 1024 / 1024);
  const tags = new Set();

  openOverlay(
    (close) => {
      let file = null;
      let images = [];
      const fileInput = h('input', { type: 'file', hidden: true });
      const imgInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      const fileLabel = h('div.drop-inner');
      const imgList = h('div.res-upload-images');
      const renderFile = () => {
        clear(fileLabel).append(
          file ? h('b', `${file.name} · ${fmtBytes(file.size)}`) : h('b', t('res.pickFile')),
          h('span.hint', file ? t('upload.change') : t('res.fileHint', { mb })),
        );
      };
      const renderImages = () => {
        clear(imgList);
        images.forEach((f, i) =>
          imgList.append(
            h(
              'span.res-upload-img',
              alphaImg({ src: URL.createObjectURL(f), alt: '' }),
              h(
                'button',
                {
                  type: 'button',
                  'aria-label': t('res.removeImage'),
                  onclick: () => {
                    images.splice(i, 1);
                    renderImages();
                  },
                },
                '×',
              ),
            ),
          ),
        );
        if (images.length < 6) imgList.append(h('button.res-upload-add', { type: 'button', onclick: () => imgInput.click() }, '＋', h('span', t('res.addImages'))));
      };
      const drop = h('button.drop-zone', { type: 'button', onclick: () => fileInput.click() }, fileLabel);
      const setFile = (f) => {
        if (!f) return;
        if (f.size > maxBytes) return toast(t('res.tooBig', { mb }), 'error');
        file = f;
        if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        renderFile();
      };
      fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
      imgInput.addEventListener('change', () => {
        for (const f of imgInput.files ?? []) if (images.length < 6 && f.type.startsWith('image/')) images.push(f);
        imgInput.value = '';
        renderImages();
      });
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('over');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        setFile(e.dataTransfer?.files?.[0]);
      });

      const title = h('input.form-input', { type: 'text', maxlength: 100 });
      const description = h('textarea.form-input.area', { rows: 4, maxlength: 2000 });
      const creators = h('input.form-input', { type: 'text', maxlength: 300, placeholder: t('res.creatorsHint') });
      const youtube = h('textarea.form-input.area', { rows: 2, placeholder: 'https://youtu.be/…' });
      const link = h('input.form-input', { type: 'url', maxlength: 500, placeholder: 'https://…' });
      const tagRow = h('div.tag-list.edit-tags', h('span.faint', '…'));
      api
        .get('/api/resources/tags', { kind })
        .then(({ tags: list }) => {
          clear(tagRow);
          if (!list.length) tagRow.append(h('span.faint', t('res.noTags')));
          for (const tg of list) {
            const chip = h(
              'button.chip',
              {
                type: 'button',
                title: tg.description ?? '',
                onclick: () => {
                  if (tags.has(tg.name)) tags.delete(tg.name);
                  else tags.add(tg.name);
                  chip.classList.toggle('on', tags.has(tg.name));
                },
              },
              `#${tg.name}`,
            );
            tagRow.append(chip);
          }
        })
        .catch(() => clear(tagRow));

      const submit = h('button.btn.primary', { type: 'submit' }, t('upload.submit'));
      renderFile();
      renderImages();

      return h(
        'form.edit-form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            if (!file && !link.value.trim()) return toast(t('res.needFile'), 'error');
            const form = new FormData();
            form.append('kind', kind);
            if (file) form.append('file', file, file.name);
            for (const img of images) form.append('images', img, img.name);
            form.append('title', title.value);
            form.append('description', description.value);
            form.append('creators', creators.value);
            form.append('tags', [...tags].join(','));
            form.append('youtube', youtube.value);
            form.append('linkUrl', link.value);
            submit.disabled = true;
            submit.textContent = t('upload.sending');
            try {
              const { item } = await api.upload('/api/resources', form);
              toast(t('res.done', { id: item.id }), 'ok');
              close();
              navigate?.(`#/res/${item.id}`);
            } catch (err) {
              if (err instanceof ApiError) toast(err.message, 'error');
              else handleApiError(err);
            } finally {
              submit.disabled = false;
              submit.textContent = t('upload.submit');
            }
          },
        },
        h('h3', t('res.upload', { kind: kindName(kind) })),
        h('p.muted', t('res.uploadLead', { n: kindInfo(kind).points })),
        fileInput,
        imgInput,
        drop,
        field('Title', title),
        field('Images', imgList, t('res.imagesHint')),
        field('YouTube', youtube, t('res.youtubeHint')),
        field('Description', description),
        field('Creators', creators),
        field('Tags', tagRow),
        field('Link', link, t('res.linkHint', { mb })),
        h('div.row.form-actions', h('button.btn', { type: 'button', onclick: close }, t('edit.cancel')), submit),
      );
    },
    { className: 'panel' },
  );
}

function field(label, control, hint) {
  const tag = control.matches('input, textarea, select') ? 'label.form-field' : 'div.form-field';
  return h(tag, h('span.form-label', label), control, hint ? h('span.hint', hint) : null);
}
