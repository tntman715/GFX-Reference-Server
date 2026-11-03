/** 일정 시간이 지나면 사라지는 간단한 메모리 저장소 (검색 페이지, 업로드 대기 등) */
export class TtlMap<K, V> {
  private store = new Map<K, { value: V; expires: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 5000,
  ) {}

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V): void {
    if (this.store.size >= this.maxSize) this.sweep(true);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** 접근할 때마다 만료 시간을 연장 */
  touch(key: K): void {
    const hit = this.store.get(key);
    if (hit) hit.expires = Date.now() + this.ttlMs;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  private sweep(force: boolean) {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.expires < now) this.store.delete(k);
    if (force && this.store.size >= this.maxSize) {
      // 가장 오래된 것부터 정리
      const drop = Math.ceil(this.maxSize * 0.1);
      let i = 0;
      for (const k of this.store.keys()) {
        if (i++ >= drop) break;
        this.store.delete(k);
      }
    }
  }
}
