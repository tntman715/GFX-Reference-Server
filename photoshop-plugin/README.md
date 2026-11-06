# GFX References 포토샵 플러그인 (UXP)

GFX References 레퍼런스를 포토샵 패널에서 검색하고, 원본을 **새 레이어(고급 개체)** 로 바로 불러옵니다.

- 검색: 제목 · 맵 · 제작자 · 태그 · `#번호`, 지메 / 비지메 · 분류 · 색 · 태그 · 정렬, 🎲 랜덤
- **＋ 새 레이어로 불러오기**: 서버가 디스코드 아카이브에서 원본을 가져오고, 현재 문서 가운데에 배치합니다.
  레이어 이름은 `#번호 제목 (제작자)` 입니다. 열린 문서가 없으면 새 문서로 엽니다.
- **새 문서로 열기**
- 팔레트 색을 누르면 **전경색**으로 설정
- ⭐ 반응 남기기, 사이트에서 보기
- 포토샵 언어가 한국어가 아니면 영어로 보입니다.

## 폴더 구성

```
photoshop-plugin/
  manifest.json, index.html, main.js, app.css   ← 단독 플러그인 껍데기 (세 부분을 이어 붙이기만 함)
  gfx-ref/                                      ← 다른 플러그인에 그대로 복사해서 쓰는 부분
    core.js        서버 통신 (화면 · 포토샵 없음)
    photoshop.js   포토샵 기능 (레이어 배치 · 새 문서 · 전경색)
    panel.js       화면 (주어진 칸 안에만 그림)
    panel.css      화면 스타일 (.gfxr 안에서만 적용)
    PORTING.md     다른 플러그인에 넣는 방법
```

## 설치

포토샵 2022 (23.3) 이상.

1. Creative Cloud 에서 **Adobe UXP Developer Tool** 설치
2. **Add Plugin** → 이 폴더의 `manifest.json` 선택 → **Load**
3. 포토샵 **플러그인 → GFX References**

배포할 때는 UXP Developer Tool 의 **Package** 로 `.ccx` 를 만들어 공유하세요.

## 연동

1. 처음 열면 `https://gfxref.duckdns.org` 에 바로 연결됩니다. 다른 서버는 ⚙ 에서 바꿀 수 있어요.
2. **🔗 디스코드 연동** → 표시된 코드를 디스코드에서 `/연동 코드:XXXX-XXXX` 로 입력
3. 연동 정보는 패널에 저장되며 180일 동안 유지됩니다 (`PLUGIN_TOKEN_DAYS`). 1.0 에서 연동했다면 그대로 이어집니다.

## 참고

- `manifest.json` 의 `network.domains` 가 `"all"` 입니다. 특정 서버만 허용하려면
  `["https://gfxref.duckdns.org"]` 처럼 바꾸세요.
- 미리보기는 서버의 `/api/refs/:id/thumb` (JPEG) 를 씁니다 — UXP 패널은 WebP 를 표시하지 못하기 때문입니다.
- `index.html` 은 포토샵 밖(일반 브라우저)에서도 열려서 화면을 확인할 수 있습니다
  (이때 레이어 불러오기 / 전경색 설정은 꺼집니다. 서버의 `CORS_ORIGINS` 에 그 주소가 있어야 합니다).
