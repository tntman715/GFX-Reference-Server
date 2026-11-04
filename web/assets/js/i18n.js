/**
 * 한국어 / English 문구.
 * 메뉴, 페이지 제목, 작은 라벨처럼 쉬운 제목은 두 언어 모두 영어로 두고
 * 설명, 버튼, 안내 문구만 바뀝니다. 문구를 고칠 때는 이 파일만 고치면 돼요.
 */

const STORAGE_KEY = 'gfx.lang';

const STRINGS = {
  ko: {
    // 상단 바 · 계정
    'bot.connecting': '연결 중',
    'bot.online': '봇 온라인',
    'bot.offline': '봇 오프라인',
    'bot.onlineTitle': '디스코드 봇이 연결되어 있어요',
    'bot.offlineTitle': '디스코드 봇이 오프라인이에요',
    'banner.offline': '디스코드 봇이 오프라인이라 원본 다운로드가 잠시 멈췄어요. 검색과 미리보기는 그대로 쓸 수 있어요.',
    'account.login': '로그인',
    'account.menu': '계정 메뉴',
    'account.hello': '{name} 님',
    'account.profile': '내 프로필',
    'account.logout': '로그아웃',
    'account.loggedOut': '로그아웃했어요',
    'random.title': '아무 레퍼런스나 하나 보기',
    'lang.label': '언어',
    'start.failed': '서버에 연결할 수 없어요. 잠시 후 새로고침해 주세요.',
    'login.failed': '로그인하지 못했어요.',

    // 공통
    loading: '불러오는 중',
    close: '닫기',
    'error.generic': '오류가 발생했어요.',
    'error.request': '요청 실패 ({status})',
    'error.download': '다운로드 실패 ({status})',
    'grid.error': '불러오지 못했어요.',
    all: '전체',
    copy: '복사',
    copied: '복사했어요',

    // 로그인 창
    'login.reason': '원본 다운로드와 반응은 GFX References 디스코드 서버 멤버만 쓸 수 있어요.',
    'login.oauth': 'Discord 계정으로 로그인',
    'login.or': '또는',
    'login.device': '디스코드 명령어로 로그인',
    'login.unavailable': '지금은 로그인할 수 없어요. 디스코드 봇이 오프라인이에요.',
    'login.typeCommand': '디스코드 서버의 아무 채널에서 이 명령어를 입력하세요.',
    'login.waiting': '승인을 기다리는 중… 10분 안에 입력해 주세요.',
    'login.expired': '코드가 만료되었어요. 다시 시도해 주세요.',
    'login.done': '{name}님, 로그인했어요',

    // 탐색
    'explore.lead': '디스코드 서버에 올라온 썸네일과 작업물 {n}개',
    'explore.search': '제목, 맵 이름, 제작자, 태그, #번호로 검색',
    'explore.searchLabel': '검색',
    'explore.sortLabel': '정렬',
    'sort.newest': '최신순',
    'sort.popular': '인기순',
    'sort.oldest': '오래된순',
    'sort.random': '무작위',
    'explore.onlyCategory': '{label}만 보기',
    'explore.customColor': '직접 선택',
    'explore.customColorTitle': '원하는 색으로 찾기',
    'explore.hexSort': '색상 코드로 찾을 때는 색이 비슷한 순서로 보여줘요',
    'explore.removeFilter': '필터 해제',
    'explore.creator': '제작자 {name}',
    'explore.uploader': '올린 사람 {name}',
    'explore.clearAll': '모두 지우기',
    'explore.searching': '검색 중…',
    'explore.count': '{n}개의 레퍼런스',
    'explore.countOne': '{n}개의 레퍼런스',
    'explore.noMatch': '조건에 맞는 레퍼런스가 없어요.',
    'explore.noRefs': '아직 레퍼런스가 없어요. 디스코드에서 /업로드 명령어로 올릴 수 있어요.',

    // 인기
    'popular.lead': '받은 반응이 많은 순서예요. 디스코드 아카이브에 달린 반응도 함께 셉니다.',
    'popular.empty': '이 기간에는 반응을 받은 레퍼런스가 아직 없어요.',

    // 색상
    'colors.lead': '대표 색으로 모아 보거나, 색 코드로 그 색이 들어간 작업물을 찾을 수 있어요.',
    'colors.pick': '색 선택',
    'colors.code': '색상 코드',
    'colors.hint': '색을 고르거나 코드를 입력하고 Enter',
    'colors.search': '찾기',
    'colors.count': '{n}개',
    'colors.choose': '위에서 색을 고르거나 색 코드를 입력해 보세요.',
    'colors.empty': '이 색이 들어간 레퍼런스가 없어요.',

    // 랭킹
    'ranking.rules': '업로드 1개당 +{u}점, 내 레퍼런스가 받은 반응 1개당 +{r}점 (내가 단 반응은 빼고 셉니다)',
    'ranking.empty': '아직 랭킹이 없어요.',
    'ranking.points': '{n}점',
    'ranking.detail': '업로드 {u} · 받은 반응 {r}',
    'ranking.prev': '← 이전',
    'ranking.next': '다음 →',

    // 프로필
    'profile.rank': '전체 {r}위',
    'profile.rankShort': '{r}위',
    'profile.empty': '아직 없어요.',

    // 상세
    'detail.react': '반응 남기기',
    'detail.unreact': '반응 취소',
    'detail.loginToReact': '반응을 남기려면 디스코드로 로그인해 주세요.',
    'detail.loginToDownload': '원본은 디스코드로 로그인한 뒤 받을 수 있어요.',
    'detail.loginToDm': 'DM으로 받으려면 디스코드로 로그인해 주세요.',
    'detail.download': '원본 다운로드',
    'detail.downloading': '디스코드에서 가져오는 중…',
    'detail.downloaded': '다운로드: {name}',
    'detail.dm': '디스코드 DM으로 받기',
    'detail.dmSent': '디스코드 DM으로 원본을 보냈어요',
    'detail.moreByCreator': '이 제작자의 레퍼런스 보기',
    'detail.unknown': '알 수 없음',
    'detail.noTags': '태그 없음',
    'detail.paletteHint': '누르면 이 색으로 검색, 길게 누르거나 우클릭하면 복사',
    'detail.hexCopied': '{hex} 복사했어요',
    'detail.copyLink': '링크 복사',
    'detail.linkCopied': '링크를 복사했어요',
    'detail.similar': '비슷한 색감',
    'detail.archiveOk': '원본은 GFX References 디스코드 아카이브에서 바로 가져와요.',
    'detail.archiveOff': '디스코드 봇이 오프라인이라 지금은 원본을 받을 수 없어요.',
    'detail.similarEmpty': '색감이 비슷한 레퍼런스가 아직 없어요.',

    // 바닥
    'footer.text': '새 레퍼런스는 디스코드 서버에서 /업로드 명령어로 올려요. 올린 작업물은 이곳에 바로 정리돼요.',
    'footer.random': '랜덤으로 하나 보기',
    'footer.note': '원본 파일은 디스코드 서버에 보관되며, 디스코드로 로그인하면 받을 수 있어요.',
  },

  en: {
    'bot.connecting': 'Connecting',
    'bot.online': 'Bot online',
    'bot.offline': 'Bot offline',
    'bot.onlineTitle': 'The Discord bot is connected',
    'bot.offlineTitle': 'The Discord bot is offline',
    'banner.offline': 'The Discord bot is offline, so downloads are paused. Search and previews still work.',
    'account.login': 'Log in',
    'account.menu': 'Account menu',
    'account.hello': '{name}',
    'account.profile': 'My profile',
    'account.logout': 'Log out',
    'account.loggedOut': 'Logged out',
    'random.title': 'Open a random reference',
    'lang.label': 'Language',
    'start.failed': "Can't reach the server. Try refreshing in a moment.",
    'login.failed': 'Login failed.',

    loading: 'Loading',
    close: 'Close',
    'error.generic': 'Something went wrong.',
    'error.request': 'Request failed ({status})',
    'error.download': 'Download failed ({status})',
    'grid.error': "Couldn't load this.",
    all: 'All',
    copy: 'Copy',
    copied: 'Copied',

    'login.reason': 'Downloading originals and reacting are for members of the GFX References Discord server.',
    'login.oauth': 'Continue with Discord',
    'login.or': 'or',
    'login.device': 'Log in with a Discord command',
    'login.unavailable': 'Login is unavailable while the Discord bot is offline.',
    'login.typeCommand': 'Type this command in any channel on the Discord server.',
    'login.waiting': 'Waiting for approval… Enter it within 10 minutes.',
    'login.expired': 'The code expired. Please try again.',
    'login.done': 'Logged in as {name}',

    'explore.lead': '{n} thumbnails and artworks from our Discord server',
    'explore.search': 'Search titles, maps, creators, tags or #number',
    'explore.searchLabel': 'Search',
    'explore.sortLabel': 'Sort',
    'sort.newest': 'Newest',
    'sort.popular': 'Popular',
    'sort.oldest': 'Oldest',
    'sort.random': 'Random',
    'explore.onlyCategory': 'Show {label} only',
    'explore.customColor': 'Custom',
    'explore.customColorTitle': 'Search by a custom color',
    'explore.hexSort': 'Results are sorted by color similarity when searching by color code',
    'explore.removeFilter': 'Remove filter',
    'explore.creator': 'Creator: {name}',
    'explore.uploader': 'Uploader: {name}',
    'explore.clearAll': 'Clear all',
    'explore.searching': 'Searching…',
    'explore.count': '{n} references',
    'explore.countOne': '{n} reference',
    'explore.noMatch': 'No references match these filters.',
    'explore.noRefs': 'No references yet. They can be uploaded on Discord with /업로드.',

    'popular.lead': 'Ranked by reactions, including reactions on the Discord archive.',
    'popular.empty': 'Nothing has received reactions in this period yet.',

    'colors.lead': 'Browse by main color, or search with a color code.',
    'colors.pick': 'Pick a color',
    'colors.code': 'Color code',
    'colors.hint': 'Pick a color or type a code and press Enter',
    'colors.search': 'Search',
    'colors.count': '{n}',
    'colors.choose': 'Pick a color above or enter a color code.',
    'colors.empty': 'No references with this color.',

    'ranking.rules': '+{u} per upload, +{r} per reaction received (your own reactions are not counted)',
    'ranking.empty': 'No rankings yet.',
    'ranking.points': '{n} pts',
    'ranking.detail': 'Uploads {u} · Reactions {r}',
    'ranking.prev': '← Prev',
    'ranking.next': 'Next →',

    'profile.rank': 'Rank #{r}',
    'profile.rankShort': '#{r}',
    'profile.empty': 'Nothing yet.',

    'detail.react': 'React',
    'detail.unreact': 'Remove reaction',
    'detail.loginToReact': 'Log in with Discord to react.',
    'detail.loginToDownload': 'Log in with Discord to download originals.',
    'detail.loginToDm': 'Log in with Discord to get it in your DMs.',
    'detail.download': 'Download original',
    'detail.downloading': 'Fetching from Discord…',
    'detail.downloaded': 'Downloaded {name}',
    'detail.dm': 'Send to my Discord DMs',
    'detail.dmSent': 'Sent to your Discord DMs',
    'detail.moreByCreator': 'More by this creator',
    'detail.unknown': 'Unknown',
    'detail.noTags': 'No tags',
    'detail.paletteHint': 'Click to search this color, long-press or right-click to copy',
    'detail.hexCopied': 'Copied {hex}',
    'detail.copyLink': 'Copy link',
    'detail.linkCopied': 'Link copied',
    'detail.similar': 'Similar colors',
    'detail.archiveOk': 'Originals come straight from the GFX References Discord archive.',
    'detail.archiveOff': 'The Discord bot is offline, so originals are unavailable right now.',
    'detail.similarEmpty': 'No references with a similar palette yet.',

    'footer.text': 'New references are uploaded on our Discord server with the /업로드 command and show up here right away.',
    'footer.random': 'Open a random one',
    'footer.note': 'Original files are kept on the Discord server and can be downloaded after logging in with Discord.',
  },
};

// 서버가 한국어로 보내 주는 이름들의 영어 표기 (key 기준)
const EN_CATEGORIES = {
  gm_thumbnail: { label: 'GM Thumbnail', shortLabel: 'Thumbnail' },
  gm_artwork: { label: 'GM Artwork', shortLabel: 'Artwork' },
  non_gm: { label: 'Non-GM', shortLabel: 'Non-GM' },
};
const EN_PERIODS = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  return langs.some((l) => /^ko\b/i.test(l)) ? 'ko' : 'en';
}

let current = detect();
const listeners = new Set();
document.documentElement.lang = current;

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (lang === current || !STRINGS[lang]) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** t('explore.count', { n: 12 }) → "12개의 레퍼런스" */
export function t(key, vars) {
  const s = STRINGS[current][key] ?? STRINGS.ko[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

export function locale() {
  return current === 'ko' ? 'ko-KR' : 'en-US';
}

/** 분류 이름. c 는 meta.categories 의 항목 또는 { key, label } */
export function categoryLabel(c, short = false) {
  if (!c) return '';
  const en = current === 'en' ? EN_CATEGORIES[c.key] : null;
  if (en) return short ? en.shortLabel : en.label;
  return short ? (c.shortLabel ?? c.label) : c.label;
}

export function colorLabel(c) {
  if (!c) return '';
  return current === 'en' ? colorNameEn(c.key) : c.label;
}

/** 색 계열 key 의 영어 이름 (제목은 두 언어 모두 영어) */
export function colorNameEn(key) {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

export function periodLabel(p) {
  if (!p) return '';
  return current === 'en' ? (EN_PERIODS[p.key] ?? p.label) : p.label;
}

/** index.html 의 data-i18n 요소 글자를 현재 언어로 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
