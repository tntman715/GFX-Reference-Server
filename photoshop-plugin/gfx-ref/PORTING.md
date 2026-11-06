# 다른 플러그인에 GFX References 넣기

`gfx-ref/` 폴더 하나만 복사하면 됩니다. 세 부분이 서로를 직접 부르지 않아서 필요한 것만 골라 쓸 수 있어요.

| 파일 | 하는 일 | 필요한 것 |
| --- | --- | --- |
| `core.js` | 서버 통신: 검색 · 원본 받기 · 반응 · 디스코드 연동 | `fetch` 만 (화면 · 포토샵 없음) |
| `photoshop.js` | 포토샵: 레이어로 배치 · 새 문서 · 전경색 | UXP (`require('photoshop')`, `require('uxp')`) |
| `panel.js` + `panel.css` | 검색 · 상세 · 연동 화면 | 위 두 개를 넘겨받음 |

## 1. 화면까지 통째로 넣기 (탭 하나로)

1. `gfx-ref/` 폴더를 플러그인 폴더 안에 복사합니다.
2. 플러그인의 `manifest.json` 에 권한을 더합니다 (이미 있으면 그대로):

   ```json
   "requiredPermissions": {
     "network": { "domains": ["https://gfxref.duckdns.org"] },
     "localFileSystem": "plugin",
     "launchProcess": { "schemes": ["https", "http"], "extensions": [] }
   }
   ```

3. HTML 에 CSS 와 스크립트를 넣습니다:

   ```html
   <link rel="stylesheet" href="gfx-ref/panel.css" />
   <div id="gfx-tab"></div>
   <script src="gfx-ref/core.js"></script>
   <script src="gfx-ref/photoshop.js"></script>
   <script src="gfx-ref/panel.js"></script>
   ```

4. 탭을 열 때 화면을 붙입니다:

   ```js
   const G = globalThis.GFXRef;
   const client = G.core.createClient({ storage: G.core.storage.local('gfx.') });
   const host = G.photoshop.createPhotoshopHost();
   const panel = G.panel.mountPanel(document.getElementById('gfx-tab'), {
     client,
     host,
     onEvent: (name, data) => console.log('GFX', name, data), // placed / opened / color / linked / error
   });
   // 탭을 닫을 때: panel.destroy();
   ```

`require` 로도 부를 수 있어요: `const core = require('./gfx-ref/core.js');`

## 2. 기능만 쓰기 (화면은 내 플러그인 것으로)

```js
const core = require('./gfx-ref/core.js');
const ps = require('./gfx-ref/photoshop.js');

const client = core.createClient({ storage: core.storage.local('gfx.') });
const host = ps.createPhotoshopHost();

await client.connect(); // 분류 · 태그 · 색 목록: client.meta
const { items, total, hasMore } = await client.search({ q: 'glow', scope: 'gd', sort: 'popular' }, 1, 20);
// 썸네일 주소: client.thumbUrl(items[0], 320)

// 디스코드 연동 (원본을 받으려면 한 번 필요)
const link = client.link({ onCode: (c) => showCode(c.userCode, c.command) });
await link.done;

const file = await client.downloadOriginal(items[0].id); // { data: ArrayBuffer, mime, filename }
await host.placeAsLayer(file, { name: require('./gfx-ref/panel.js').layerName(items[0]) }); // '#번호 제목 (제작자)'
await host.setForegroundColor(items[0].palette[0].hex);
```

### 검색 조건

`client.search(filters, page, limit)` 의 `filters`:

| 이름 | 값 |
| --- | --- |
| `q` | 검색어 (제목 · 맵 · 제작자 · 태그 · `#번호`) |
| `scope` | `'gd'` 지메 / `'nongd'` 비지메 (분류를 고르면 무시) |
| `category` | `'gm_thumbnail'` · `'gm_artwork'` · `'non_gm'` |
| `color` | `client.meta.colors[].key` |
| `tags` | `'glow,3d'` 또는 `['glow', '3d']` (모두 포함) |
| `sort` | `'newest'` · `'popular'` · `'random'` (+ `seed`) · `'oldest'` |

## 바꿀 수 있는 것

- **저장 위치**: `storage` 에 `{ get(key), set(key, value), remove(key) }` 를 넘기면 내 플러그인의 설정 저장소를 씁니다.
  같은 접두사(`'gfx.'`)를 쓰면 단독 GFX 플러그인과 연동 정보를 함께 씁니다.
- **서버 주소**: `createClient({ server: 'https://…' })`. 비우면 저장된 주소 → 기본 주소(`https://gfxref.duckdns.org`).
- **글자 / 언어**: `mountPanel(root, { lang: 'en', strings: { ko: { 'detail.place': '레이어로' } } })`.
  모든 글자는 `GFXRef.panel.STRINGS` 에 있어요.
- **색**: `panel.css` 맨 위 `--gfxr-accent` 같은 변수만 바꾸면 됩니다.
- **포토샵 모듈**: 내 플러그인에 이미 있으면 `createPhotoshopHost({ photoshop, uxp })` 로 넘깁니다.
  작업 내역(History) 이름 앞말은 `commandPrefix` 로 바꿀 수 있어요.

## 지켜야 할 것

- 원본 받기 · 반응은 **디스코드 연동이 필요**합니다. 토큰은 `storage` 에만 저장되고 화면이나 로그에 보이지 않게 하세요.
- 포토샵 패널은 WebP 를 못 보여 줘서 썸네일은 꼭 `client.thumbUrl()` (JPEG) 을 쓰세요.
- 원본 받기는 서버에서 1분에 몇 번으로 제한돼 있어요. 여러 장을 한꺼번에 받지 마세요.
