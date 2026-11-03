# GFX References 포토샵 플러그인 (UXP)

GFX References 레퍼런스를 포토샵 패널에서 검색하고, 원본을 **새 레이어(고급 개체)** 로 바로 불러옵니다.

- 검색: 제목 · 맵 · 제작자 · 태그 · `#번호`, 분류 / 색 / 태그 / 정렬, 🎲 랜덤
- **＋ 새 레이어로 불러오기**: 서버가 디스코드 아카이브에서 원본을 가져오고, 현재 문서 가운데에 배치합니다.
  레이어 이름은 `#번호 제목 (제작자)` 로 정해집니다. 열린 문서가 없으면 새 문서로 엽니다.
- **새 문서로 열기**
- 팔레트 색을 누르면 **전경색**으로 설정
- ⭐ 반응 남기기, 사이트에서 보기

## 설치

포토샵 2022 (23.3) 이상.

1. Creative Cloud 에서 **Adobe UXP Developer Tool** 설치
2. **Add Plugin** → 이 폴더의 `manifest.json` 선택 → **Load**
3. 포토샵 **플러그인 → GFX References**

배포할 때는 UXP Developer Tool 의 **Package** 로 `.ccx` 를 만들어 공유하세요.

## 연동

1. 패널에 사이트 주소 입력 (예: `https://gfx.example.com`)
2. **🔗 디스코드 연동** → 표시된 코드를 디스코드에서 `/연동 코드:XXXX-XXXX` 로 입력
3. 연동 정보는 패널에 저장되며 180일 동안 유지됩니다 (`PLUGIN_TOKEN_DAYS`).

## 참고

- `manifest.json` 의 `network.domains` 가 `"all"` 로 되어 있습니다. 특정 서버만 허용하려면
  `["https://gfx.example.com"]` 처럼 바꾸세요.
- 미리보기는 서버의 `/api/refs/:id/thumb` (JPEG) 를 사용합니다 — UXP 패널은 WebP 를 표시하지 못하기 때문입니다.
- `main.js` 는 포토샵 밖에서도 열리도록 작성되어 있어서, 일반 브라우저로 UI 를 확인할 수 있습니다
  (이때 레이어 불러오기 / 전경색 설정은 동작하지 않습니다).
