import { api } from './api.js';

/** 사이트 전역 상태 (메타 정보, 로그인 사용자) */
export const store = {
  meta: null,
  me: null,
  listeners: new Set(),

  async init() {
    const [meta, me] = await Promise.all([api.get('/api/meta'), api.get('/api/auth/me').catch(() => ({ user: null }))]);
    this.meta = meta;
    this.me = me.user;
    this.emit();
  },

  async refreshMeta() {
    this.meta = await api.get('/api/meta');
    this.emit();
  },

  setMe(user) {
    this.me = user;
    this.emit();
  },

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  emit() {
    for (const fn of this.listeners) fn(this);
  },

  category(key) {
    return this.meta?.categories.find((c) => c.key === key);
  },

  color(key) {
    return this.meta?.colors.find((c) => c.key === key);
  },
};
