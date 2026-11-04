import { t } from './i18n.js';

const BASE = (window.GFX_CONFIG?.apiBase || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status, code, data = null) {
    super(message);
    this.status = status;
    this.code = code;
    /** 오류 응답 본문 전체 (예: 중복일 때 비슷한 레퍼런스 목록) */
    this.data = data;
  }
}

function url(path, params) {
  const u = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  }
  return u.toString();
}

async function request(method, path, { params, body } = {}) {
  const res = await fetch(url(path, params), {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 본문 없음 */
  }
  if (!res.ok) throw new ApiError(data?.error || t('error.request', { status: res.status }), res.status, data?.code, data);
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  url,

  /** 파일 올리기 (multipart). FormData 를 그대로 보냄 */
  async upload(path, form) {
    const res = await fetch(url(path), { method: 'POST', credentials: 'include', body: form });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 본문 없음 */
    }
    if (!res.ok) throw new ApiError(data?.error || t('error.request', { status: res.status }), res.status, data?.code, data);
    return data;
  },

  /** 원본 다운로드: fetch → blob → 저장 */
  async download(id) {
    const res = await fetch(url(`/api/refs/${id}/original`), { credentials: 'include' });
    if (!res.ok) {
      let data = null;
      try {
        data = await res.json();
      } catch {}
      throw new ApiError(data?.error || t('error.download', { status: res.status }), res.status, data?.code);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="([^"]+)"/i.exec(cd);
    const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : `reference-${id}`;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return name;
  },

  loginUrl(redirect) {
    return url('/api/auth/discord/login', { redirect });
  },
};
