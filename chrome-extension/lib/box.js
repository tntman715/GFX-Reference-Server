// 보관함: 담은 사진을 브라우저 안(IndexedDB)에 저장합니다. 서버에는 '올리기' 전까지 아무것도 가지 않아요.
// background.js(서비스 워커)와 library.js(보관함 화면)가 함께 씁니다.

const DB_NAME = 'gfx-box';
const STORE = 'items';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('key', 'key', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * 항목 모양:
 *   { id, key, imageUrl, pageUrl, title, site, savedAt,
 *     blob, mime, size,              // 사진 파일 (가져오지 못했으면 blob 이 null)
 *     uploadedRef, uploadedAt }      // 올린 뒤: 레퍼런스 번호
 */
export async function listItems() {
  const items = await done((await tx('readonly')).getAll());
  return items.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getItem(id) {
  return done((await tx('readonly')).get(id));
}

export async function findByKey(key) {
  return done((await tx('readonly')).index('key').get(key));
}

export async function putItem(item) {
  return done((await tx('readwrite')).put(item));
}

export async function updateItem(id, patch) {
  const item = await getItem(id);
  if (!item) return null;
  Object.assign(item, patch);
  await putItem(item);
  return item;
}

export async function deleteItems(ids) {
  const store = await tx('readwrite');
  await Promise.all(ids.map((id) => done(store.delete(id))));
}

export async function pendingCount() {
  return (await listItems()).filter((i) => !i.uploadedRef).length;
}

// ── 사진 주소 ─────────────────────────────────────────────

/** 같은 사진인지 알아보는 열쇠 (핀터레스트는 크기 부분을 빼고 비교) */
export function imageKey(url) {
  const pin = /^https:\/\/i\.pinimg\.com\/(?:\d+x[^/]*|originals)\/(.+?)(?:\.\w+)?$/i.exec(url);
  if (pin) return 'pinimg:' + pin[1];
  return url;
}

/** 핀터레스트 사진은 원본 → 큰 크기 순서로 시도할 주소 목록 */
export function candidateUrls(url) {
  const m = /^https:\/\/i\.pinimg\.com\/(?:\d+x[^/]*|originals)\/(.+?)\.(\w+)$/i.exec(url);
  if (!m) return [url];
  const [, path, ext] = m;
  const exts = [ext.toLowerCase(), 'png', 'jpg', 'webp', 'gif'].filter((e, i, a) => a.indexOf(e) === i);
  return [
    ...exts.map((e) => `https://i.pinimg.com/originals/${path}.${e}`),
    `https://i.pinimg.com/1200x/${path}.${ext}`,
    `https://i.pinimg.com/736x/${path}.${ext}`,
    url,
  ];
}

const MAX_BYTES = 60 * 1024 * 1024;

/** 사진 파일 받기. 실패하면 null (권한이 없거나 사이트가 막음) */
export async function fetchImage(url) {
  for (const u of candidateUrls(url)) {
    try {
      const res = await fetch(u, { credentials: 'omit' });
      if (!res.ok) continue;
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!mime.startsWith('image/')) continue;
      const blob = await res.blob();
      if (!blob.size || blob.size > MAX_BYTES) continue;
      return { blob, mime, size: blob.size, url: u };
    } catch {
      /* 다음 주소로 */
    }
  }
  return null;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 출처로 남길 주소: 핀 주소는 깔끔하게, 그 밖에는 ? 뒤를 그대로 둠 */
export function cleanPageUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const pin = /^(https:\/\/[^/]*pinterest\.[^/]+\/pin\/[^/?#]+)/i.exec(url);
  if (pin) return pin[1] + '/';
  return url.split('#')[0].slice(0, 500);
}

/**
 * 보관함에 담기. 돌려주는 값: { status: 'saved' | 'exists', item }
 * 사진을 지금 못 받으면 주소만 담고(blob: null) 나중에 보관함 화면에서 다시 받아요.
 */
export async function saveToBox({ imageUrl, pageUrl, title }) {
  if (!imageUrl || !/^(https?:|data:image\/)/i.test(imageUrl)) throw new Error('이 사진은 담을 수 없어요.');
  const key = imageKey(imageUrl);
  const existing = await findByKey(key);
  if (existing) return { status: 'exists', item: existing };
  const file = await fetchImage(imageUrl);
  const item = {
    key,
    imageUrl: file ? file.url : imageUrl,
    pageUrl: cleanPageUrl(pageUrl),
    title: (title || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    site: hostOf(pageUrl || imageUrl),
    savedAt: Date.now(),
    blob: file ? file.blob : null,
    mime: file ? file.mime : null,
    size: file ? file.size : 0,
    uploadedRef: null,
    uploadedAt: null,
  };
  item.id = await putItem(item);
  return { status: 'saved', item };
}
