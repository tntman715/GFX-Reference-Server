# 설치 · 배포 가이드

GFX References 를 실제 디스코드 서버에 연결해서 운영하는 방법입니다.
무료 서비스만으로 운영할 수 있게 구성했습니다. 각 서비스의 무료 한도는 바뀔 수 있으니 가입할 때 확인하세요.

| 역할 | 추천 서비스 | 무료 한도 (작성 시점) |
| --- | --- | --- |
| 원본 사진 | 디스코드 아카이브 채널 | 첨부 한도 내 무제한 (부스트 없음 10MB/장) |
| 미리보기 이미지 | **Cloudflare R2** | 저장 10GB/월, 다운로드(egress) 무료 |
| 태그 · 이름 · 제작자 · 반응 · 점수 | **Neon** 또는 Supabase (Postgres) | 0.5GB 안팎 — 메타데이터만 저장하므로 충분 |
| 봇 + 사이트 서버 | Oracle Cloud Always Free VM, 집 PC + Cloudflare Tunnel 등 | 24시간 켜져 있어야 함 |

> 미리보기는 기본 720px WebP 라 장당 보통 40~120KB 입니다. 10GB 면 대략 10만 장 이상 담을 수 있습니다.

---

## 1. 디스코드 봇 만들기

1. <https://discord.com/developers/applications> → **New Application** → 이름 `GFX References`.
2. **General Information** 의 **Application ID** → `.env` 의 `DISCORD_CLIENT_ID`.
3. **Bot** 탭 → **Reset Token** → 복사해서 `DISCORD_TOKEN`.
   - *Privileged Gateway Intents* 는 **켤 필요 없습니다** (슬래시 명령어와 반응만 사용).
4. **OAuth2** 탭
   - **Client Secret** → `DISCORD_CLIENT_SECRET` (사이트 디스코드 로그인용)
   - **Redirects** 에 `https://<사이트 주소>/api/auth/discord/callback` 추가
5. 봇을 서버에 초대합니다. `APP_ID` 를 바꿔서 브라우저로 여세요.

   ```
   https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot+applications.commands&permissions=126016
   ```

   `126016` = 채널 보기 · 메시지 보내기 · 링크 첨부 · 파일 첨부 · 메시지 기록 보기 · 반응 추가 · 메시지 관리
   (메시지 관리는 사이트에서 반응을 취소했을 때 아카이브 메시지의 반응도 지우기 위한 것으로, 빼도 됩니다.)

6. 디스코드 **사용자 설정 → 고급 → 개발자 모드** 를 켜고
   - 서버 아이콘 우클릭 → **서버 ID 복사** → `DISCORD_GUILD_ID`
   - 채널 우클릭 → **채널 ID 복사** → 아래 채널 ID 들

### 채널 준비

| 채널 | 설정 | `.env` |
| --- | --- | --- |
| `#레퍼런스-아카이브` | 모두 **보기 · 반응 추가** 가능, **메시지 보내기는 봇만** | `ARCHIVE_CHANNEL_ID` |
| `#인기-레퍼런스` (선택) | 매주 월요일 TOP 5 가 올라옴 | `HIGHLIGHT_CHANNEL_ID` |
| `#레퍼런스-업로드` (선택) | `/업로드` 를 이 채널에서만 쓰게 하려면 | `UPLOAD_CHANNEL_IDS` |

분류마다 아카이브를 나누고 싶다면 `ARCHIVE_CHANNEL_GM_THUMBNAIL` / `ARCHIVE_CHANNEL_GM_ARTWORK` / `ARCHIVE_CHANNEL_NON_GM` 을 따로 지정하세요.

> ⚠️ 아카이브 채널의 봇 메시지를 지우면 그 레퍼런스의 원본도 사라집니다. 레퍼런스 삭제는 `/삭제` 로 해주세요.

관리자는 **서버 관리** 권한이 있는 사람이 자동으로 되고, 다른 역할을 추가하려면 `ADMIN_ROLE_IDS` 에 역할 ID 를 넣으세요.

---

## 2. 데이터베이스 (Neon)

1. <https://neon.tech> 가입 → **New Project** (가까운 지역 선택)
2. **Connection string** 복사 → `DATABASE_URL`, 그리고 `DATABASE_SSL=true`

   ```
   DATABASE_URL=postgres://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require
   ```

테이블은 서버가 처음 켜질 때 자동으로 만들어지고, 기본 태그 11개도 함께 들어갑니다.

> Supabase 를 쓴다면 **Project Settings → Database → Connection string (URI)** 를 그대로 넣으면 됩니다.
> `DATABASE_URL` 을 비워두면 `data/pglite` 에 내장 Postgres(PGlite)를 사용합니다 — 혼자 테스트할 때 편합니다.

---

## 3. 미리보기 저장소 (Cloudflare R2, 무료 10GB)

1. Cloudflare 대시보드 → **R2 Object Storage** (처음 쓸 때 결제 수단 등록을 요구할 수 있지만 무료 한도 안에서는 과금되지 않습니다)
2. **Create bucket** → 이름 예: `gfx-previews`
3. 버킷 → **Settings → Public access**
   - 테스트: **r2.dev 서브도메인** 켜기
   - 운영: **Custom Domain** 연결 추천 (예: `img.gfx.example.com`) — r2.dev 주소는 속도 제한이 있습니다
   - 공개 주소를 `PREVIEW_PUBLIC_BASE_URL` 에 넣기
4. R2 메인 → **Manage R2 API Tokens → Create API token** → 권한 **Object Read & Write**, 위 버킷만 선택
5. `.env` 설정

   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=gfx-previews
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   PREVIEW_PUBLIC_BASE_URL=https://img.gfx.example.com
   ```

Backblaze B2, MinIO 등 다른 S3 호환 저장소도 같은 방식으로 쓸 수 있습니다.

---

## 4. 서버 실행

Node.js 20.12 이상이 필요합니다.

```bash
cd server
cp .env.example .env    # 위에서 받은 값 채우기
npm install
npm run build
npm start
```

정상이라면 다음과 같은 로그가 나옵니다.

```
INFO  [main] DB: postgres · 미리보기 저장소: s3 · 원본 보관: discord · 봇: 사용
INFO  [main] 웹사이트 / API: http://localhost:3000
INFO  [bot] 디스코드 봇 로그인: GFX References#1234
INFO  [bot] 슬래시 명령어 14개를 서버에 등록했습니다.
```

슬래시 명령어는 `DISCORD_GUILD_ID` 서버에 바로 등록됩니다 (명령어 정의가 바뀌었을 때만 다시 등록).

### Docker

```bash
cp server/.env.example server/.env   # 값 채우기
docker compose up -d --build
```

`gfx-data` 볼륨에 로컬 데이터(내장 DB를 쓸 때)가 저장됩니다.

### 24시간 켜두기

봇은 항상 켜져 있어야 합니다.

- **Oracle Cloud Always Free** VM (ARM) 에 Docker 로 실행
- **집 PC / 라즈베리파이** + **Cloudflare Tunnel** 로 `https://gfx.example.com` 공개
- Railway, Fly.io 같은 저가 호스팅

systemd 예시 (`/etc/systemd/system/gfx.service`):

```ini
[Unit]
Description=GFX References
After=network-online.target

[Service]
WorkingDirectory=/opt/gfx/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 주소와 HTTPS

- `PUBLIC_BASE_URL` 은 사람들이 접속하는 **https 주소**로 설정하세요 (예: `https://gfx.example.com`).
  디스코드 OAuth 리다이렉트, 임베드 링크, 쿠키 보안에 쓰입니다.
- `PREVIEW_PUBLIC_BASE_URL` 이 없으면 미리보기를 서버가 `/api/previews/...` 로 중계합니다.
  이때 디스코드 임베드가 이미지를 불러오려면 서버가 https 로 공개되어 있어야 합니다
  (localhost 에서 테스트할 때는 봇이 미리보기를 파일로 첨부합니다).
- 웹사이트를 Cloudflare Pages 같은 다른 도메인에 올리고 싶다면 `web/config.js` 의 `apiBase` 에 서버 주소를,
  서버 `.env` 의 `CORS_ORIGINS` 에 사이트 주소를 넣으세요.

---

## 5. 포토샵 플러그인 설치

포토샵 2022 (23.3) 이상이 필요합니다.

### 개발 / 직접 설치

1. Creative Cloud 에서 **Adobe UXP Developer Tool** 설치
2. **Add Plugin** → `photoshop-plugin/manifest.json` 선택 → **Load**
3. 포토샵 메뉴 **플러그인 → GFX References** 패널 열기

### 다른 사람에게 배포

UXP Developer Tool 에서 **Package** → `.ccx` 파일을 만들어 공유하면, 받은 사람은 더블클릭으로 설치할 수 있습니다.
(Adobe Exchange 마켓플레이스에 올리려면 Adobe Developer Console 에서 받은 플러그인 ID 로 `manifest.json` 의 `id` 를 바꿔야 합니다.)

### 처음 사용할 때

1. 패널에 사이트 주소 입력 (예: `https://gfx.example.com`)
2. **🔗 디스코드 연동** → 표시된 코드를 디스코드에서 `/연동 코드:XXXX-XXXX` 로 입력
3. 검색 → 썸네일 선택 → **＋ 새 레이어로 불러오기** (열린 문서가 없으면 새 문서로 열림)
4. 팔레트 색을 누르면 **전경색**으로 설정됩니다

---

## 6. 점검 목록

- [ ] `/업로드` 로 이미지를 올리면 아카이브 채널에 원본 + 정보 임베드가 올라온다
- [ ] 아카이브 메시지에 ⭐ 반응을 누르면 `/인기` 에 반영된다
- [ ] 사이트에서 검색되고, 디스코드 로그인 후 원본 다운로드가 된다
- [ ] 포토샵 플러그인에서 연동 후 레이어로 불러와진다
- [ ] `/관리 태그추가` 로 새 태그를 만들면 업로드 자동완성에 나온다

## 7. 백업

- **원본**: 디스코드 아카이브 채널에 있습니다.
- **메타데이터**: Neon/Supabase 의 백업 기능을 쓰거나 `pg_dump "$DATABASE_URL" > backup.sql`.
- **미리보기**: R2 버킷 — 따로 보관하고 싶다면 `rclone` 등으로 버킷을 복사하세요.
- 내장 DB 를 쓴다면 `server/data/` 폴더 전체를 백업하세요.
