import { api, ApiError } from '../api.js';
import { handleApiError, openOverlay, requireLogin } from '../components.js';
import { clear, fmtBytes, h, toast } from '../dom.js';
import { categoryLabel, t } from '../i18n.js';
import { store } from '../store.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/** 사이트에서 레퍼런스 올리기 (디스코드 /업로드 와 같은 내용) */
export function openUploadForm({ navigate } = {}) {
  if (!requireLogin(t('upload.loginReason'))) return;
  const me = store.me;
  if (!me.isMember && !me.isAdmin) {
    toast(t('upload.membersOnly'), 'error');
    return;
  }
  if (!store.meta?.archive?.available) {
    toast(t('upload.offline'), 'error');
    return;
  }

  const categories = store.meta?.categories ?? [];
  const maxBytes = store.meta?.upload?.maxBytes ?? 10 * 1024 * 1024;
  let file = null;
  let previewUrl = null;
  let category = categories[0]?.key ?? 'gm_thumbnail';
  const tags = new Set();

  openOverlay(
    (close) => {
      // ── 파일 고르기 (누르거나 끌어다 놓기) ──
      const fileInput = h('input', { type: 'file', accept: ACCEPT, hidden: true });
      const dropInner = h('div.drop-inner');
      const drop = h('button.drop-zone', { type: 'button', onclick: () => fileInput.click() }, dropInner);
      const renderDrop = () => {
        clear(dropInner);
        if (file) {
          dropInner.append(
            h('img', { src: previewUrl, alt: '' }),
            h('span.drop-name', `${file.name} · ${fmtBytes(file.size)}`),
            h('span.hint', t('upload.change')),
          );
        } else {
          dropInner.append(h('b', t('upload.pick')), h('span.hint', t('upload.limit', { mb: Math.round(maxBytes / 1024 / 1024) })));
        }
      };
      const setFile = (f) => {
        if (!f) return;
        if (!f.type.startsWith('image/')) return toast(t('upload.notImage'), 'error');
        if (f.size > maxBytes) return toast(t('upload.tooBig', { mb: Math.round(maxBytes / 1024 / 1024) }), 'error');
        file = f;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(f);
        // 제목/맵 이름이 비어 있으면 파일 이름으로 채워 둠
        if (!mapName.value && !title.value) {
          const base = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
          if (mapField.hidden) title.value = base;
          else mapName.value = base;
        }
        renderDrop();
      };
      renderDrop();
      fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
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

      // ── 입력칸 ──
      const mapName = h('input.form-input', { type: 'text', maxlength: 100 });
      const title = h('input.form-input', { type: 'text', maxlength: 100, placeholder: t('upload.titleHint') });
      const creators = h('input.form-input', { type: 'text', maxlength: 300, placeholder: t('upload.creatorsHint', { name: me.displayName || me.username }) });
      const mapField = field('Map', mapName);

      const catRow = h('div.segmented.wrap');
      const renderCats = () => {
        clear(catRow);
        for (const c of categories) {
          catRow.append(
            h(
              'button',
              {
                type: 'button',
                class: c.key === category ? 'on' : '',
                onclick: () => {
                  category = c.key;
                  renderCats();
                },
              },
              categoryLabel(c),
            ),
          );
        }
        const cat = categories.find((c) => c.key === category);
        mapField.hidden = cat ? !cat.hasMapName : false;
      };
      renderCats();

      const tagRow = h('div.tag-list.edit-tags');
      for (const tg of store.meta?.tags ?? []) {
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

      const dupBox = h('div.upload-dup');
      const submit = h('button.btn.primary', { type: 'submit' }, t('upload.submit'));

      async function send(allowDuplicate) {
        if (!file) {
          toast(t('upload.needFile'), 'error');
          return;
        }
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('category', category);
        form.append('mapName', mapField.hidden ? '' : mapName.value);
        form.append('title', title.value);
        form.append('creators', creators.value);
        form.append('tags', [...tags].join(','));
        if (allowDuplicate) form.append('allowDuplicate', '1');
        submit.disabled = true;
        submit.textContent = t('upload.sending');
        try {
          const { item } = await api.upload('/api/refs', form);
          toast(t('upload.done', { id: item.id }), 'ok');
          close();
          store.refreshMeta().catch(() => undefined);
          navigate?.(`#/ref/${item.id}`);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'duplicate') showDuplicate(err);
          else handleApiError(err);
        } finally {
          submit.disabled = false;
          submit.textContent = t('upload.submit');
        }
      }

      function showDuplicate(err) {
        clear(dupBox).append(
          h('div.upload-dup-title', t('upload.duplicate')),
          h(
            'div.upload-dup-list',
            (err.data?.matches ?? []).map((m) =>
              h('a', { href: `#/ref/${m.id}`, target: '_blank' }, h('img', { src: api.url(m.thumbUrl), alt: '' }), h('span', `#${m.id} ${m.title}`)),
            ),
          ),
          h('button.btn.sm', { type: 'button', onclick: () => send(true) }, t('upload.anyway')),
        );
      }

      return h(
        'form.edit-form',
        {
          onsubmit: (e) => {
            e.preventDefault();
            send(false);
          },
        },
        h('h3', 'Upload'),
        h('p.muted', t('upload.lead', { n: store.meta?.scoring?.pointsPerUpload ?? 10 })),
        fileInput,
        drop,
        field('Category', catRow),
        mapField,
        field('Creators', creators, t('edit.creatorsHint')),
        field('Title', title),
        field('Tags', tagRow),
        dupBox,
        h('div.row.form-actions', h('button.btn', { type: 'button', onclick: close }, t('edit.cancel')), submit),
      );
    },
    {
      className: 'panel',
      onClose: () => previewUrl && URL.revokeObjectURL(previewUrl),
    },
  );
}

function field(label, control, hint) {
  // 버튼 묶음을 label 로 감싸면 글자를 눌렀을 때 첫 버튼이 눌려서, 입력칸일 때만 label
  const tag = control.matches('input, textarea, select') ? 'label.form-field' : 'div.form-field';
  return h(tag, h('span.form-label', label), control, hint ? h('span.hint', hint) : null);
}
