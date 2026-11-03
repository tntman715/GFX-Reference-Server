/**
 * 레퍼런스 분류, 색상 계열, 기본 태그 등 시스템 전체에서 공유하는 상수.
 * 웹사이트와 포토샵 플러그인은 `/api/meta` 를 통해 같은 값을 받아갑니다.
 */

export const CATEGORIES = {
  gm_thumbnail: {
    label: '지메 썸네일',
    shortLabel: '썸네일',
    emoji: '🖼️',
    /** 맵 이름 입력란이 있는지 */
    hasMapName: true,
    /** 맵 이름이 필수인지 */
    requiresMapName: true,
  },
  gm_artwork: {
    label: '지메 기타 작업물',
    shortLabel: '기타 작업물',
    emoji: '🎨',
    hasMapName: false,
    requiresMapName: false,
  },
  non_gm: {
    label: '비지메',
    shortLabel: '비지메',
    emoji: '✨',
    hasMapName: false,
    requiresMapName: false,
  },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && value in CATEGORIES;
}

/** 처음 설치할 때 만들어지는 기본 태그. 이후에는 관리자가 명령어로 추가/삭제합니다. */
export const DEFAULT_TAGS: { name: string; description: string }[] = [
  { name: 'glow', description: '빛 번짐 / 글로우 효과' },
  { name: 'grunge', description: '거친 질감, 그런지 텍스처' },
  { name: '3d', description: '3D 요소가 들어간 작업' },
  { name: 'blender/c4d', description: 'Blender, Cinema 4D 등 3D 툴 렌더' },
  { name: 'modern', description: '모던한 스타일' },
  { name: 'central-texted-composition', description: '텍스트가 중앙에 있는 구도' },
  { name: 'non-central-texted-composition', description: '텍스트가 중앙이 아닌 구도' },
  { name: 'multi-colored', description: '여러 색을 사용한 작업' },
  { name: 'poster-like', description: '포스터 같은 느낌' },
  { name: 'paint', description: '페인팅 / 드로잉 기반' },
  { name: 'complex', description: '요소가 많고 복잡한 작업' },
];

export const COLOR_FAMILIES = {
  red: { label: '빨강', hex: '#e5383b', chromatic: true },
  orange: { label: '주황', hex: '#f48c06', chromatic: true },
  yellow: { label: '노랑', hex: '#ffd60a', chromatic: true },
  green: { label: '초록', hex: '#38b000', chromatic: true },
  cyan: { label: '청록', hex: '#00b4d8', chromatic: true },
  blue: { label: '파랑', hex: '#3a86ff', chromatic: true },
  purple: { label: '보라', hex: '#8338ec', chromatic: true },
  pink: { label: '분홍', hex: '#ff4d9d', chromatic: true },
  black: { label: '검정', hex: '#111111', chromatic: false },
  gray: { label: '회색', hex: '#8d99ae', chromatic: false },
  white: { label: '하양', hex: '#f1f3f5', chromatic: false },
} as const;

export type ColorFamily = keyof typeof COLOR_FAMILIES;
export const COLOR_FAMILY_KEYS = Object.keys(COLOR_FAMILIES) as ColorFamily[];

export function isColorFamily(value: unknown): value is ColorFamily {
  return typeof value === 'string' && value in COLOR_FAMILIES;
}

/**
 * 색상 계열로 필터링할 때 "그 색이 충분히 들어있다"고 보는 최소 비율.
 * 유채색은 어두운 배경 위의 포인트 컬러도 잡히도록 낮게,
 * 무채색은 배경색 대부분이 그 색일 때만 잡히도록 높게 잡습니다.
 */
export function colorFilterThreshold(family: ColorFamily): number {
  return COLOR_FAMILIES[family].chromatic ? 0.1 : 0.4;
}

export const SORTS = ['newest', 'oldest', 'popular', 'random'] as const;
export type SortKey = (typeof SORTS)[number];

export const POPULAR_PERIODS = {
  week: { label: '이번 주', days: 7 },
  month: { label: '이번 달', days: 30 },
  year: { label: '올해', days: 365 },
  all: { label: '전체', days: null },
} as const;
export type PopularPeriod = keyof typeof POPULAR_PERIODS;

export function isPopularPeriod(value: unknown): value is PopularPeriod {
  return typeof value === 'string' && value in POPULAR_PERIODS;
}

export function periodSince(period: PopularPeriod, now = new Date()): Date | null {
  const days = POPULAR_PERIODS[period].days;
  return days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 태그 이름 규칙: 소문자 영문/숫자/한글로 시작, 이후 / + . _ - 허용, 최대 40자 */
export const TAG_NAME_RE = /^[a-z0-9가-힣][a-z0-9가-힣/+._-]{0,39}$/;

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/** "glow, grunge 3d" 같은 입력을 태그 배열로 */
export function parseTagList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[,，#]/)) {
    const name = normalizeTagName(part);
    if (name) out.add(name);
  }
  return [...out];
}

export const SUPPORTED_IMAGE_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'] as const;

export const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  tiff: 'image/tiff',
  heif: 'image/heif',
};

export const EXT_BY_FORMAT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
  tiff: 'tiff',
  heif: 'heic',
};
