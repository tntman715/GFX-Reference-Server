import { api, ApiError } from '../api.js';
import { emptyState, handleApiError, openLogin } from '../components.js';
import { clear, debounce, fmtDate, h, spinner, toast } from '../dom.js';
import { store } from '../store.js';

/**
 * 가져오기: 예전 채팅 채널(gdfx 등)의 "맵이름 by 제작자" 글을 레퍼런스로 옮기기.
 * 디스코드 서버 멤버 누구나 태그를 붙여 저장할 수 있고, 저장한 사람이 올린 사람(점수)이 됩니다.
 * 채널 읽기 · 이름 정리 · 새 태그 만들기는 관리자만. 키보드만으로 빠르게 태그를 붙일 수 있어요. (한국어로만)
 */

const TAG_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const CATEGORY_KEYS = { z: 'gm_thumbnail', x: 'gm_artwork', c: 'non_gm' };
const BASE = '/api/import';
const ADMIN = '/api/admin/import';
/** 다른 사람이 맡고 있거나 이미 저장한 후보 */
const TAKEN = new Set(['claimed', 'already_imported']);

let guildId = null;
const discordLink = (item) => `https://discord.com/channels/${guildId ?? '@me'}/${item.channelId}/${item.messageId}`;
const keyBadge = (k) => h('kbd', k.toUpperCase());

export function mountImport(root) {
  const points = store.meta?.scoring?.pointsPerUpload ?? 10;
  const head = h(
    'div.page-head',
    h(
      'div',
      h('h1', 'Import'),
      h('p', `예전 채널에 올라온 "맵이름 by 제작자" 글에 태그를 붙여 레퍼런스로 옮겨요. 저장하면 내가 올린 레퍼런스가 되고 +${points}점을 받아요.`),
    ),
  );
  const body = h('div', spinner());
  root.append(head, body);

  const me = store.me;
  if (!me?.isMember && !me?.isAdmin) {
    clear(body).append(
      me
        ? emptyState('GFX References 디스코드 서버 멤버만 사용할 수 있어요.')
        : emptyState('로그인이 필요해요.', h('button.btn.primary', { onclick: () => openLogin() }, '로그인')),
    );
    // 이 화면에서 로그인하면 바로 다시 그림
    const off = store.on((s) => {
      if (s.me?.isMember || s.me?.isAdmin) {
        off();
        window.location.reload();
      }
    });
    return { destroy: off };
  }
  const isAdmin = !!me.isAdmin;

  const state = {
    tab: 'tag',
    status: 'pending',
    items: [],
    index: 0,
    counts: { pending: 0, imported: 0, skipped: 0 },
    scan: null,
    groups: { creator: [], map: [] },
    prevTags: [],
    busy: false,
  };
  let scanTimer = null;
  let destroyed = false;

  // ── 상단: 채널 확인 · 개수 · 탭 ──────────────────────────
  const channelSelect = h('select.select', { 'aria-label': '채널' });
  const scanBtn = h('button.btn.sm', { onclick: startScan }, '채널 확인하기');
  const scanInfo = h('span.imp-scan-info');
  const channelInfo = h('span.imp-scan-info.warn');
  const countsEl = h('div.imp-counts');
  const tabs = h('div.imp-tabs');
  const panel = h('div.imp-panel');
  clear(body).append(
    h(
      'div.imp-toolbar',
      isAdmin
        ? h('div.imp-scan', channelSelect, scanBtn, scanInfo, channelInfo)
        : h('div.imp-scan', h('span.imp-scan-info', '다른 분이 태그를 붙이는 중인 후보는 자동으로 건너뛰어요.')),
      countsEl,
    ),
    tabs,
    panel,
  );

  function renderCounts() {
    const c = state.counts;
    clear(countsEl).append(
      h('span.chip.static', `대기 ${c.pending}`),
      h('span.chip.static', `옮김 ${c.imported}`),
      h('span.chip.static', `건너뜀 ${c.skipped}`),
    );
    const nameCount = state.groups.creator.length + state.groups.map.length;
    // 이름 정리(모든 레퍼런스의 이름을 바꿈)는 관리자만
    if (!isAdmin) return void clear(tabs);
    clear(tabs).append(
      h('button.chip', { class: state.tab === 'tag' ? 'on' : '', onclick: () => setTab('tag') }, '태그 붙이기'),
      h('button.chip', { class: state.tab === 'names' ? 'on' : '', onclick: () => setTab('names') }, '이름 정리', nameCount ? h('span.count', String(nameCount)) : null),
    );
  }

  function renderScan() {
    const s = state.scan;
    scanBtn.disabled = !!s?.running;
    if (!s || (!s.running && !s.finishedAt)) return void (scanInfo.textContent = '');
    if (s.running) scanInfo.textContent = `확인 중… 메시지 ${s.scanned}개 · 레퍼런스 글 ${s.found}개`;
    else if (s.error) scanInfo.textContent = `확인 실패: ${s.error}`;
    else if (s.contentHidden)
      scanInfo.textContent = '메시지 내용이 모두 비어 있어요. 디스코드 개발자 포털에서 Message Content Intent 를 켜 주세요.';
    else scanInfo.textContent = `완료 — 메시지 ${s.scanned}개 중 레퍼런스 글 ${s.found}개, 새 후보 ${s.added}개`;
    scanInfo.classList.toggle('warn', !!(s.error || s.contentHidden));
  }

  async function loadStatus() {
    const data = await api.get(`${BASE}/status`);
    guildId = data.guildId;
    state.counts = data.counts;
    state.scan = data.scan;
    renderCounts();
    renderScan();
    return data;
  }

  async function loadChannels() {
    if (!isAdmin) return;
    clear(channelInfo);
    clear(channelSelect).append(h('option', { value: '' }, '채널 불러오는 중…'));
    let channels = [];
    let error = null;
    try {
      ({ channels } = await api.get(`${ADMIN}/channels`));
    } catch (err) {
      error = err;
    }
    if (!channels.length) {
      // 실패하면 이유와 다시 시도 버튼을 바로 옆에 보여줌 (알림은 금방 사라져서)
      clear(channelSelect).append(h('option', { value: '' }, '채널 없음'));
      clear(channelInfo).append(
        error ? `채널 목록을 불러오지 못했어요: ${error.message} ` : '봇이 볼 수 있는 채널이 없어요. ',
        h('button.btn.sm', { onclick: loadChannels }, '다시 시도'),
      );
      return;
    }
    // gdfx 라는 채널이 여러 개면 목록에서 먼저 나오는 것 (원래 쓰던 채널)
    const preferred = channels.find((c) => /gdfx/i.test(c.name))?.id;
    // DOM append 는 배열을 펼치지 않으므로 ... 로 넘김
    clear(channelSelect).append(
      ...channels.map((c) => h('option', { value: c.id, selected: c.id === preferred }, `${c.parentName ? `${c.parentName} / ` : ''}#${c.name}`)),
    );
  }

  async function startScan() {
    if (!channelSelect.value) return;
    try {
      const data = await api.post(`${ADMIN}/scan`, { channelId: channelSelect.value });
      state.scan = data.scan;
      renderScan();
      pollScan();
    } catch (err) {
      handleApiError(err);
    }
  }

  function pollScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(async () => {
      if (destroyed) return;
      const data = await loadStatus().catch(() => null);
      if (data?.scan.running) pollScan();
      else {
        await Promise.all([loadItems(), loadGroups()]);
        render();
      }
    }, 1000);
  }

  // ── 데이터 ──────────────────────────────────────────────
  async function loadItems() {
    const { items } = await api.get(`${BASE}/items`, { status: state.status });
    state.items = items;
    state.index = Math.min(state.index, Math.max(0, items.length - 1));
  }

  async function loadGroups() {
    if (!isAdmin) return;
    const [c, m] = await Promise.all([api.get(`${ADMIN}/names`, { field: 'creator' }), api.get(`${ADMIN}/names`, { field: 'map' })]);
    state.groups = { creator: c.groups, map: m.groups };
    renderCounts();
  }

  function setTab(tab) {
    state.tab = tab;
    renderCounts();
    render();
  }

  function render() {
    if (state.tab === 'names') renderNames();
    else renderTagger();
  }

  // ── 태그 붙이기 ─────────────────────────────────────────
  let form = null; // 지금 보고 있는 후보의 입력 상태

  function current() {
    return state.items[state.index] ?? null;
  }

  function renderTagger() {
    clear(panel);
    const filter = h(
      'select.select',
      {
        'aria-label': '보기',
        onchange: async (e) => {
          state.status = e.target.value;
          state.index = 0;
          await loadItems().catch(handleApiError);
          renderTagger();
        },
      },
      h('option', { value: 'pending', selected: state.status === 'pending' }, '대기 중'),
      h('option', { value: 'skipped', selected: state.status === 'skipped' }, '건너뛴 것'),
    );
    const item = current();
    if (!item) {
      form = null;
      panel.append(
        h('div.imp-bar', filter),
        emptyState(
          state.status === 'pending'
            ? state.counts.imported
              ? '지금 정리할 후보가 없어요. 모두 정리했거나 다른 분들이 작업 중이에요. 🎉'
              : isAdmin
                ? '아직 후보가 없어요. 위에서 채널을 고르고 "채널 확인하기"를 눌러 주세요.'
                : '아직 후보가 없어요.'
            : '건너뛴 후보가 없어요.',
        ),
      );
      return;
    }

    form = {
      id: item.id,
      category: item.category,
      tags: new Set(item.tags),
      dirty: false,
      duplicate: null,
    };

    const progress = h('div.imp-progress', `${state.index + 1} / ${state.items.length}`);
    const img = h('img.imp-img', { src: api.url(`${BASE}/items/${item.id}/image`), alt: item.filename });
    img.addEventListener('error', () => img.replaceWith(h('div.imp-img-missing', '이미지를 불러오지 못했어요. 디스코드에서 메시지가 지워졌을 수 있어요.')));
    const media = h(
      'div.imp-media',
      img,
      h(
        'div.imp-source',
        h('div', h('strong', item.authorName ?? '알 수 없음'), ' · ', fmtDate(item.postedAt), ' · ', h('a', { href: discordLink(item), target: '_blank', rel: 'noopener' }, '디스코드에서 보기')),
        item.content ? h('pre.imp-content', item.content) : null,
      ),
    );

    const catRow = h('div.imp-cats');
    const renderCats = () => {
      clear(catRow).append(
        ...Object.entries(CATEGORY_KEYS).map(([k, key]) => {
          const cat = store.category(key);
          return h(
            'button.chip',
            {
              class: form.category === key ? 'on' : '',
              onclick: () => setCategory(key),
            },
            keyBadge(k),
            ` ${cat?.emoji ?? ''} ${cat?.label ?? key}`,
          );
        }),
      );
    };

    const mapInput = h('input.imp-input', { value: item.mapName ?? '', placeholder: '맵 이름', 'aria-label': '맵 이름' });
    const creatorInput = h('input.imp-input', { value: item.creatorName ?? '', placeholder: '제작자', 'aria-label': '제작자' });
    const mapHint = h('div.imp-hint');
    const creatorHint = h('div.imp-hint');
    const suggest = (field, input, hint) => {
      const run = async () => {
        const name = input.value.trim();
        clear(hint);
        if (!name) return;
        try {
          const { similar } = await api.get(`${BASE}/suggest`, { field, name });
          if (form?.id !== item.id || !similar.length) return;
          hint.append(
            h('span', '비슷한 이름: '),
            ...similar.map((s) =>
              h(
                'button.chip.sm',
                {
                  onclick: () => {
                    input.value = s.name;
                    form.dirty = true;
                    clear(hint);
                  },
                },
                s.name,
                h('span.count', String(s.count)),
              ),
            ),
          );
        } catch {
          /* 힌트는 없어도 됨 */
        }
      };
      const later = debounce(run, 250);
      input.addEventListener('input', () => {
        form.dirty = true;
        later();
      });
      run();
    };
    suggest('map', mapInput, mapHint);
    suggest('creator', creatorInput, creatorHint);

    const tagGrid = h('div.imp-tags');
    const renderTags = () => {
      clear(tagGrid).append(
        ...(store.meta?.tags ?? []).map((t, i) =>
          h(
            'button.chip',
            { class: form.tags.has(t.name) ? 'on' : '', title: t.description ?? '', onclick: () => toggleTag(t.name) },
            TAG_KEYS[i] ? keyBadge(TAG_KEYS[i]) : null,
            ` #${t.name}`,
          ),
        ),
        isAdmin ? h('button.chip', { onclick: addTag, title: '새 태그 만들기' }, '＋ 새 태그') : null,
      );
    };

    const dupBox = h('div.imp-dup');
    const actions = h(
      'div.imp-actions',
      h('button.btn.primary', { onclick: () => save(false) }, '저장하고 다음 ', keyBadge('Enter')),
      state.status === 'pending'
        ? h('button.btn', { onclick: skip }, '건너뛰기 ', keyBadge('S'))
        : h('button.btn', { onclick: restore }, '대기로 되돌리기 ', keyBadge('R')),
      h('button.btn.ghost', { onclick: () => move(-1), disabled: state.index === 0 }, '← 이전'),
      h('button.btn.ghost', { onclick: () => move(1), disabled: state.index >= state.items.length - 1 }, '다음 →'),
      h('button.btn.ghost', { onclick: copyPrevTags, disabled: !state.prevTags.length }, '이전 태그 ', keyBadge('A')),
    );

    form.mapInput = mapInput;
    form.creatorInput = creatorInput;
    form.renderCats = renderCats;
    form.renderTags = renderTags;
    form.dupBox = dupBox;
    renderCats();
    renderTags();

    panel.append(
      h('div.imp-bar', filter, progress),
      h(
        'div.imp-grid',
        media,
        h(
          'div.imp-form',
          h('label.imp-label', '분류'),
          catRow,
          h('label.imp-label', '맵 이름'),
          mapInput,
          mapHint,
          h('label.imp-label', '제작자'),
          creatorInput,
          creatorHint,
          h('label.imp-label', '태그'),
          tagGrid,
          dupBox,
          actions,
          h('p.imp-help', '입력칸 밖에서: 숫자/QWERTY 줄 = 태그, Z/X/C = 분류, ←/→ = 이동, Esc = 입력칸 나가기. 입력칸 안에서도 Enter 로 저장돼요.'),
        ),
      ),
    );

    // 다음 이미지 미리 받아두기
    for (const next of state.items.slice(state.index + 1, state.index + 3)) new Image().src = api.url(`${BASE}/items/${next.id}/image`);

    // 이 후보를 맡아 둠: 다른 분이 이미 맡았으면 다음 것으로
    if (state.status === 'pending') {
      api.post(`${BASE}/items/${item.id}/claim`).catch((err) => {
        if (form?.id !== item.id) return;
        if (isTaken(err)) dropTaken(err);
      });
    }
  }

  function isTaken(err) {
    return err instanceof ApiError && TAKEN.has(err.code);
  }

  /** 다른 분이 맡았거나 이미 저장한 후보: 알려 주고 목록에서 빼기 */
  function dropTaken(err) {
    toast(err.message);
    if (err.code === 'already_imported') {
      state.counts.pending = Math.max(0, state.counts.pending - 1);
      state.counts.imported++;
      renderCounts();
    }
    if (form) form.dirty = false;
    removeCurrent();
  }

  function setCategory(key) {
    if (!form) return;
    form.category = key;
    form.dirty = true;
    form.renderCats();
  }

  function toggleTag(name) {
    if (!form) return;
    if (form.tags.has(name)) form.tags.delete(name);
    else form.tags.add(name);
    form.dirty = true;
    form.renderTags();
  }

  async function addTag() {
    const name = window.prompt('새 태그 이름 (영문 소문자 · 숫자 · - 권장)');
    if (!name?.trim()) return;
    try {
      const { tag } = await api.post('/api/admin/tags', { name });
      await store.refreshMeta();
      toast(`#${tag.name} 태그를 만들었어요.`);
      if (form) {
        form.tags.add(tag.name);
        form.dirty = true;
        form.renderTags();
      }
    } catch (err) {
      handleApiError(err);
    }
  }

  function copyPrevTags() {
    if (!form || !state.prevTags.length) return;
    form.tags = new Set(state.prevTags);
    form.dirty = true;
    form.renderTags();
  }

  function patch() {
    return {
      mapName: form.mapInput.value,
      creatorName: form.creatorInput.value,
      category: form.category,
      tags: [...form.tags],
    };
  }

  /** 다른 후보로 넘어가기 전에 고친 내용을 임시 저장 */
  async function saveDraft() {
    if (!form?.dirty) return;
    const id = form.id;
    const res = await api.post(`${BASE}/items/${id}`, patch());
    const i = state.items.findIndex((x) => x.id === id);
    if (i >= 0) state.items[i] = res.item;
  }

  async function move(delta) {
    const next = state.index + delta;
    if (next < 0 || next >= state.items.length) return;
    try {
      await saveDraft();
    } catch (err) {
      if (!isTaken(err)) {
        handleApiError(err);
        return;
      }
      // 다른 분이 가져간 후보는 빼고 넘어감
      toast(err.message);
      state.items.splice(state.index, 1);
      state.index = Math.max(0, Math.min(delta > 0 ? state.index : next, state.items.length - 1));
      renderTagger();
      return;
    }
    state.index = next;
    renderTagger();
  }

  /** 지금 후보를 목록에서 빼고 같은 자리의 다음 후보를 보여줌 */
  function removeCurrent() {
    state.items.splice(state.index, 1);
    state.index = Math.min(state.index, Math.max(0, state.items.length - 1));
    renderTagger();
  }

  async function save(allowDuplicate) {
    if (!form || state.busy) return;
    state.busy = true;
    const id = form.id;
    try {
      await api.post(`${BASE}/items/${id}`, patch());
      const res = await api.post(`${BASE}/items/${id}/commit`, { allowDuplicate });
      state.prevTags = [...form.tags];
      state.counts[state.status]--;
      state.counts.imported++;
      renderCounts();
      toast(`#${res.ref.id} 로 옮겼어요.`);
      removeCurrent();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate') showDuplicate(err);
      else if (isTaken(err)) dropTaken(err);
      else handleApiError(err);
    } finally {
      state.busy = false;
    }
  }

  function showDuplicate(err) {
    const matches = err.data?.matches ?? [];
    form.duplicate = true;
    clear(form.dupBox).append(
      h('div.imp-dup-title', '⚠️ 비슷한 레퍼런스가 이미 있어요'),
      h(
        'div.imp-dup-list',
        matches.map((m) => h('a', { href: `#/ref/${m.id}`, target: '_blank' }, h('img', { src: api.url(m.thumbUrl), alt: '' }), h('span', `#${m.id} ${m.title}`))),
      ),
      h(
        'div.imp-actions',
        h('button.btn.primary.sm', { onclick: () => save(true) }, '그래도 저장 ', keyBadge('Shift+Enter')),
        h('button.btn.sm', { onclick: skip }, '건너뛰기 ', keyBadge('S')),
      ),
    );
    if (!matches.length) toast(err.message, 'error');
  }

  async function skip() {
    if (!form || state.busy) return;
    try {
      await saveDraft();
      await api.post(`${BASE}/items/${form.id}/skip`);
      state.counts[state.status]--;
      state.counts.skipped++;
      renderCounts();
      removeCurrent();
    } catch (err) {
      if (isTaken(err)) dropTaken(err);
      else handleApiError(err);
    }
  }

  async function restore() {
    if (!form || state.busy) return;
    try {
      await saveDraft();
      await api.post(`${BASE}/items/${form.id}/restore`);
      state.counts.skipped--;
      state.counts.pending++;
      renderCounts();
      removeCurrent();
    } catch (err) {
      handleApiError(err);
    }
  }

  function onKey(e) {
    if (state.tab !== 'tag' || !form || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.overlay:not(.closing)')) return;
    const typing = e.target instanceof HTMLElement && e.target.matches('input, textarea, select');
    if (e.key === 'Enter' && !e.isComposing) {
      if (e.target instanceof HTMLElement && e.target.matches('button, a')) return;
      e.preventDefault();
      save(e.shiftKey && !!form.duplicate);
      return;
    }
    if (typing) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    const tagIndex = TAG_KEYS.indexOf(k);
    const tags = store.meta?.tags ?? [];
    let handled = true;
    if (tagIndex >= 0 && tags[tagIndex]) toggleTag(tags[tagIndex].name);
    else if (CATEGORY_KEYS[k]) setCategory(CATEGORY_KEYS[k]);
    else if (k === 's' && state.status === 'pending') skip();
    else if (k === 'r' && state.status === 'skipped') restore();
    else if (k === 'a') copyPrevTags();
    else if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else handled = false;
    if (handled) e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  // ── 이름 정리 ───────────────────────────────────────────
  function renderNames() {
    clear(panel);
    const section = (field, title) => {
      const groups = state.groups[field];
      return h(
        'section.imp-names',
        h('h2', title, h('span.count', String(groups.length))),
        groups.length
          ? groups.map((g) => groupCard(field, g))
          : h('p.muted', '비슷하게 쓴 이름이 없어요.'),
      );
    };
    panel.append(
      h('p.imp-help', '같은 대상을 조금씩 다르게 쓴 것 같은 이름들이에요. 남길 이름을 고르거나 직접 입력한 뒤 "통일하기"를 누르면, 대기 중인 후보와 이미 옮긴 레퍼런스 모두 바뀌어요.'),
      h('div.imp-names-grid', section('creator', '제작자'), section('map', '맵 이름')),
    );
  }

  function groupCard(field, g) {
    const input = h('input.imp-input', { value: g.suggested, 'aria-label': '통일할 이름' });
    const name = `g-${field}-${g.names.map((n) => n.name).join('|')}`;
    return h(
      'div.imp-group',
      h(
        'div.imp-group-names',
        g.names.map((n) =>
          h(
            'label',
            h('input', {
              type: 'radio',
              name,
              checked: n.name === g.suggested,
              onchange: () => (input.value = n.name),
            }),
            h('span', n.name),
            h('span.count', `${n.count}`),
          ),
        ),
      ),
      input,
      h(
        'div.imp-actions',
        h(
          'button.btn.primary.sm',
          {
            onclick: async () => {
              try {
                const res = await api.post(`${ADMIN}/names/rename`,{ field, from: g.names.map((n) => n.name), to: input.value });
                toast(`"${input.value.trim()}" 로 통일했어요. (후보 ${res.items}개 · 레퍼런스 ${res.refs}개)`);
                await Promise.all([loadGroups(), loadItems()]);
                renderNames();
              } catch (err) {
                handleApiError(err);
              }
            },
          },
          '통일하기',
        ),
        h(
          'button.btn.ghost.sm',
          {
            onclick: async () => {
              try {
                await api.post(`${ADMIN}/names/ignore`,{ field, names: g.names.map((n) => n.name) });
                await loadGroups();
                renderNames();
              } catch (err) {
                handleApiError(err);
              }
            },
          },
          '서로 다른 이름이에요',
        ),
      ),
    );
  }

  // ── 시작 ────────────────────────────────────────────────
  (async () => {
    try {
      const [status] = await Promise.all([loadStatus(), loadChannels(), loadItems(), loadGroups()]);
      if (destroyed) return;
      if (status.scan.running) pollScan();
      render();
    } catch (err) {
      clear(panel).append(emptyState(err.message));
    }
  })();

  return {
    destroy() {
      destroyed = true;
      clearTimeout(scanTimer);
      document.removeEventListener('keydown', onKey);
      saveDraft().catch(() => undefined);
    },
  };
}
