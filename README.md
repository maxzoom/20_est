# 엑셀 기반 견적·주문 관리

거래처와 품목을 검색하고, 재질의 밀도를 이용해 중량을 계산한 뒤 주문을 엑셀에 저장하는 웹 애플리케이션입니다. 저장한 주문으로 메일 미리보기를 만들거나 SMTP로 발송할 수 있습니다.

## 실행 환경

- Node.js 24 이상 및 npm
- Windows PowerShell 기준으로 아래 명령을 실행합니다.
- 별도 데이터베이스 대신 프로젝트의 `excel/` 폴더에 있는 엑셀 파일 4개를 사용합니다.

## 설치 및 실행

프로젝트 폴더에서 의존성을 설치합니다.

```powershell
npm.cmd install
```

서버를 시작합니다.

```powershell
npm.cmd start
```

브라우저에서 <http://127.0.0.1:3000>에 접속합니다. 서버를 종료하려면 실행 중인 터미널에서 `Ctrl+C`를 누릅니다.

PowerShell 실행 정책으로 `npm.ps1`이 차단될 수 있어 `npm.cmd`를 사용합니다. 차단되지 않는 환경에서는 `npm install`, `npm start`도 사용할 수 있습니다.

기본 바인딩은 `0.0.0.0:3000`입니다. 같은 네트워크의 다른 PC에서는 서버 PC의 네트워크 IP와 포트로 접속할 수 있습니다. 주소나 포트를 바꾸려면 서버 실행 전에 환경 변수를 지정합니다.

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
npm.cmd start
```

## 사용 방법

1. 거래처 검색에서 거래처를 선택합니다.
2. 품목 검색에서 품목을 선택합니다.
3. 재질을 선택하고 개당 부피(cm³)와 수량을 입력합니다.
4. 계산된 개당 중량과 총중량을 확인하고 주문을 저장합니다.
5. 주문 내역에서 저장 결과를 확인합니다. 필요한 경우 메일 미리보기와 발송 기능을 사용합니다.

중량은 다음 식으로 계산하며, 주문 저장 시 서버에서도 다시 계산합니다.

```text
개당 중량(kg) = 개당 부피(cm³) × 밀도(g/cm³) ÷ 1000
총중량(kg) = 개당 중량(kg) × 수량
```

## 프로젝트 구성

```text
.
├─ server.js          # 서버 진입 파일과 API 라우팅
├─ public/            # 화면 HTML, CSS, JavaScript
├─ materials.js       # 재질 조회
├─ items.js           # 품목 조회
├─ customers.js       # 거래처 조회
├─ orders.js          # 주문 조회·저장·삭제
├─ health.js          # 엑셀 저장소 상태 확인
├─ mail.js            # 메일 미리보기와 발송 기록 관리
├─ smtp.js            # 환경 설정 로딩 및 SMTP 발송
├─ excel/             # 엑셀 데이터 파일 4개
├─ tests/             # 자동 테스트
├─ .env.example       # 메일 설정 예시
├─ .gitignore         # Git 제외 규칙
├─ package.json       # 실행 명령과 의존성
└─ package-lock.json  # 의존성 버전 기록
```

이 프로젝트의 서버 파일은 `server.js`입니다. `package.json`에 `"type": "module"`이 지정되어 있어 `.js` 파일도 ES 모듈로 실행됩니다. 교재의 `server.mjs`에 해당하며, 파일명을 변경할 필요가 없습니다.

## 엑셀 데이터

다음 파일과 시트 이름을 유지해야 합니다. 첫 행은 열 이름으로 사용합니다.

| 파일 | 데이터 시트 | 필수 식별자 열 |
| --- | --- | --- |
| `excel/거래처내역.xlsx` | `거래처` | `거래처코드` |
| `excel/품목내역.xlsx` | `품목` | `품목코드` |
| `excel/재질정보.xlsx` | `재질` | `재질코드` |
| `excel/주문내역.xlsx` | `주문` | `요청ID` |

각 기능은 식별자 외에도 이름, 사용여부, 밀도 등 해당 코드에서 요구하는 열을 사용하므로 기존 열 구성을 유지하세요. 재질 조회는 요청할 때마다 파일을 다시 읽으며 `사용여부=Y`인 재질을 반환합니다. 밀도 단위는 g/cm³입니다.

주문 저장·삭제는 `주문내역.xlsx`를 변경합니다. 실습 전에 필요한 원본을 백업하고, 저장 오류가 나면 해당 파일이 Excel에서 열려 있는지 확인하세요.

## 메일 설정

SMTP 발송을 사용할 때 `.env.example`을 `.env`로 복사하고 사용하는 메일 서버의 정보를 입력합니다. 기존 `.env`가 있다면 복사하지 말고 해당 파일을 편집하세요.

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

| 환경 변수 | 용도 |
| --- | --- |
| `SMTP_HOST` | SMTP 서버 주소 |
| `SMTP_PORT` | SMTP 포트, 기본값 587 |
| `SMTP_SECURE` | 처음부터 TLS 연결을 사용하면 `true`(일반적으로 465) |
| `SMTP_REQUIRE_TLS` | STARTTLS 필수 여부, 기본값 `true` |
| `SMTP_USER` | SMTP 인증 계정 |
| `SMTP_PASS` | SMTP 인증 비밀번호 |
| `MAIL_FROM` | 발신 이메일 주소. 비어 있으면 이메일 형식의 `SMTP_USER` 사용 |
| `MAIL_FROM_NAME` | 발신자 표시 이름 |

서버는 `.env`를 자동으로 읽습니다. 설정을 변경했다면 서버를 재시작합니다. 실제 비밀번호나 토큰은 README나 Git에 기록하지 않습니다.

메일 미리보기 파일(`.eml`)과 발송 기록은 실행 중 생성되는 `mail-previews/`에 저장됩니다. 화면에서 수신자 1명과 본문을 확인한 후 미리보기 파일을 만들거나 실제 발송을 진행합니다. 실제 발송에는 SMTP 설정과 별도의 발송 확인이 필요합니다. 발송 성공 기록으로 중복 발송을 막고, SMTP 결과가 불명확한 경우 재발송을 보류합니다.

## 주요 API

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| `GET` | `/api/health` | 엑셀 저장소 상태와 데이터 건수 |
| `GET` | `/api/materials` | 사용 중인 재질 목록 |
| `GET` | `/api/items?q=검색어` | 품목 검색 |
| `GET` | `/api/customers?q=검색어` | 거래처 검색 |
| `GET` | `/api/orders` | 주문 목록 |
| `POST` | `/api/orders` | 주문 저장 |
| `DELETE` | `/api/orders/:id` | 주문 삭제 |
| `GET` | `/api/orders/:id/email-preview` | 메일 제목·본문·버전과 기본 수신자 조회 |
| `POST` | `/api/orders/:id/email` | 메일 미리보기 생성 또는 SMTP 발송 |
| `GET` | `/api/mail-previews/:key` | 미리보기 파일 다운로드 |

상태 확인은 서버 실행 후 다음 명령으로 할 수 있습니다.

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health'
```

정상이면 `status: "ok"`, `storage`, `counts`를 반환합니다. 건수는 헤더와 빈 행을 제외하고 미사용 행을 포함합니다. 파일·시트·필수 식별자 오류가 있으면 HTTP 503을 반환합니다.

## 검증 명령

```powershell
node --check server.js
npm.cmd test
```

첫 명령은 서버 파일의 문법을 확인하고, 두 번째 명령은 `node --test`로 자동 테스트를 실행합니다.

## 첫 Git 커밋

앱 소스, `public/`, `tests/`, `package.json`, `package-lock.json`, `README.md`, `.gitignore`, `.env.example`을 포함합니다. 배포에 필요한 교육용 초기 엑셀 자료는 내용을 확인한 뒤 포함합니다.

현재 `.gitignore`는 `node_modules/`, `.npm-cache/`, `.env` 및 기타 `.env.*` 파일, `mail-previews/`를 제외하며 `.env.example`은 포함하도록 설정되어 있습니다.

운영 중인 실제 업무 엑셀과 로그는 커밋 전에 별도로 확인하세요. 현재 `.gitignore`에는 `excel/`과 `*.log` 제외 규칙이 없습니다. 이미 Git이 추적하는 파일은 `.gitignore`에 추가해도 자동으로 추적이 해제되지 않습니다.

## 소스관리 연습
Git으로 변경을 기록합니다.
