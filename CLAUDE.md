# Trading Assist

바이낸스/바이비트 선물 매매 복기(리플레이) 도구. 내 체결 내역을 "진입→청산"
트레이드 단위로 묶어 보여주고, 트레이드를 고르면 그 시점의 캔들을 봉 단위로
되감아 보면서 매매를 복기하는 것이 목표다.

개인 프로젝트이고, 사용자는 학습 겸 단계적으로(Phase 0, 1, 2 …) 기능을 붙이는
중이다. 주석과 UI 문구는 **한국어**로 쓴다.

## 실행 방법

프론트와 백엔드를 **각각** 띄워야 한다 (터미널 2개).

```bash
# 백엔드 (포트 3001)
cd server && npm start        # = node index.js

# 프론트 (포트 5173)
npm run dev                   # Vite
```

확인 URL: http://localhost:5173 · 백엔드 헬스체크: http://localhost:3001/ping

검증용 명령:

```bash
npm run lint                  # eslint (src + server 둘 다)
npm run build                 # vite build (문법 확인용, dist는 커밋 안 함)
```

## 거래소 전환

`server/.env` 의 **`EXCHANGE`** 한 곳만 바꾸면 체결 조회와 캔들 조회가 모두
따라간다. `binance`(기본) | `bybit`.

프론트는 백엔드 `/config` 를 읽어 같은 거래소의 캔들 어댑터를 고른다.
**체결을 준 거래소와 캔들 거래소가 반드시 같아야** 시각/가격이 맞는다.

`USE_MOCK=true`(기본)이면 각 어댑터가 자기 원본 형식으로 가짜 체결을 만든다.
실거래 기록을 쓰려면 `USE_MOCK=false` + 해당 거래소 키(`BINANCE_*` / `BYBIT_*`).

## 구조

```
src/
  App.jsx          프론트 전체 (차트 + 트레이드 표 + 체결 표). 아직 단일 컴포넌트.
  pairTrades.js    체결 → 트레이드 페어링 로직 (순수 함수, 거래소/UI 무관)
  exchanges/       거래소별 캔들 조회 어댑터
    index.js       레지스트리 + 인터페이스 문서
    binance.js     /api/v3/klines
    bybit.js       /v5/market/kline
server/
  index.js         Express 서버. 어댑터를 골라 쓰기만 한다 (거래소 지식 없음)
  exchanges/       거래소별 체결 조회 + 서명 + 응답 정규화 어댑터
    index.js       레지스트리 + 공통 체결 형식 정의
    binance.js     /fapi/v1/userTrades, 쿼리 서명
    bybit.js       /v5/execution/list, 헤더 서명
  mockTrades.js    가짜 왕복 정의(ROUND_TRIPS) + 바이낸스 형식 생성기
  .env             EXCHANGE / API 키 / USE_MOCK (git 제외, .env.example 참고)
```

### 어댑터 경계 (이 구조의 핵심)

거래소마다 다른 것만 어댑터 안에 있다. **공통 부분(페어링·리플레이·차트)은
거래소를 모른다.**

| 거래소가 다른 부분 | 어디에 있나 |
|---|---|
| 체결 조회 엔드포인트·응답 형식 | `server/exchanges/*.js` |
| 서명 방식 | `server/exchanges/*.js` |
| 캔들 엔드포인트·정렬·봉 단위 표기 | `src/exchanges/*.js` |

**공통 체결 형식** (서버 어댑터가 반드시 이 모양으로 돌려준다):

```js
{ exchange, symbol, id, orderId, side: 'BUY'|'SELL', price, qty,
  realizedPnl, commission /* 낸 수수료, 양수 */, commissionAsset, maker, time /* ms 숫자 */ }
```

**공통 캔들 형식**: `{ time /* 초 */, open, high, low, close }`, 시간 오름차순.
봉 단위는 거래소 표기가 아니라 공통 토큰 `'1m' | '5m' | '1h'` 을 넘기고,
변환은 각 어댑터가 한다.

새 거래소를 붙이려면: 어댑터 파일 2개(서버/프론트) + 각 `exchanges/index.js`의
레지스트리에 한 줄. 다른 곳은 건드릴 필요 없다.

### 거래소별 차이 (실제 호출로 확인한 것)

| | Binance | Bybit V5 |
|---|---|---|
| 체결 | `/fapi/v1/userTrades` | `/v5/execution/list` (`category=linear`) |
| 체결 limit | 넉넉함 | **최대 100**, 조회 구간 **최대 7일** |
| 캔들 | `/api/v3/klines` | `/v5/market/kline` (limit 1000) |
| 캔들 정렬 | 오래된 것부터 | **최신 것부터 → 뒤집어야 함** |
| 봉 단위 | `1m`, `1h` | `1`, `60` |
| 응답 | 배열 직접 | `{retCode, result:{list}}` 봉투, **HTTP 200이어도 retCode≠0이면 실패** |
| side | `BUY`/`SELL` | `Buy`/`Sell` |
| 실현손익 | `realizedPnl` 있음 | **없음** (별도 `/v5/position/closed-pnl`) |
| 서명 | 쿼리스트링 HMAC → `signature=` 파라미터 | `timestamp+key+recvWindow+query` HMAC → `X-BAPI-*` 헤더 |

바이비트에 `realizedPnl`이 없어도 되는 이유: `pairTrades`가 평균가로 계산하는
폴백을 갖고 있다. 두 거래소 목데이터로 손익 결과가 **정확히 일치**하는 것을 확인했다.

### 페어링 로직 (`src/pairTrades.js`)

`pairTrades(fills)` — 공통 형식 체결 배열을 왕복 트레이드 배열로 변환.

묶는 기준은 단순 2개씩 짝짓기가 아니라 **순포지션(net position)이 0 → 열림 →
다시 0이 되는 구간**을 한 건으로 본다. BUY는 +, SELL은 −로 누적한다. 이유:

- 심볼별로 먼저 나누므로 다른 심볼끼리 섞이지 않는다
- 분할 진입 / 분할 청산이 있어도 왕복 한 번이 한 건으로 묶인다
- SELL로 시작하면 자동으로 `SHORT`
- 끝까지 안 닫힌 포지션은 `open: true` (표에 "미청산")

트레이드 객체: `symbol, direction, open, qty, entryPrice, exitPrice, entryTime,
exitTime, holdMs, grossPnl, fee, netPnl, pnlPct, fillCount, fills`.
가격은 수량가중 평균. 손익은 `realizedPnl` 합계 우선, 없으면 평균가로 계산.
`netPnl`은 수수료 차감 후. `summarize(trades)`는 승/패·승률·순손익 요약.

### 프론트 (`src/App.jsx`)

- `applyCandles(candles, drawCount)` — 새 캔들 묶음을 차트에 올리고 리플레이
  커서를 초기화. 앞의 `drawCount`개만 그리고 나머지는 재생/다음으로 하나씩.
- 리플레이 엔진: `candlesRef`(전체) + `cursorRef`(그린 개수), `appendNext()`가
  `series.update()`로 한 개씩 추가. 재생은 `setInterval(BASE_INTERVAL / speed)`.
  **데이터 무관 구조**라 캔들을 갈아끼워도 그대로 동작한다.
- 시작 화면은 1시간봉 100개, 앞 20개만 그려둔 상태.
- **트레이드 행 클릭** → `handleSelectTrade()`: 진입 −60분 ~ 청산 +60분 구간의
  **1분봉**(`TRADE_INTERVAL`)을 어댑터로 불러와 교체. 진입 봉까지 그려두고 대기.
  이전 요청은 `AbortController`로 취소.
- **자동 정지**: `stopIndexRef` = 청산 봉 + `STOP_TAIL`(5봉). 재생이 여기 닿으면
  한 번 멈춘다. 정지 후 다시 재생을 누르면 남은 구간을 끝까지 볼 수 있다.
- **마커**: 선택한 트레이드의 실제 진입/청산 시각·가격. 체결 시각을 그 시각이
  포함된 봉으로 내림 스냅한다(마커는 실제 캔들 위에만 찍힌다). 아직 안 그려진
  캔들의 마커는 숨기므로, 청산 마커는 재생이 청산 시점에 닿아야 나타난다.

렌더링 순서: 헤더(거래소 표시) → 차트 → 트레이드 표 → 체결 내역 표(원본 확인용).
스타일은 파일 상단 `tableStyle`/`thStyle`/`tdStyle` 상수를 공유.
색 규칙: 이익·매수·롱 = 파랑 `#2196f3`, 손실·매도·숏 = 빨강 `#e91e63`.

## 현재 상태

목데이터 기준 12체결 → 6트레이드, 승률 50%, 순손익 +25.72 USDT.
**두 거래소 어댑터가 완전히 같은 결과**를 낸다(어댑터 리팩터링 전후로 값 동일).
캔들 어댑터도 양쪽 실제 API로 검증했다(120봉, 오름차순, 형식 일치).

### 알려진 미완성 / 주의점

- **목데이터 가격이 실제 시세와 무관하다.** `mockTrades.js`의 `ROUND_TRIPS`는
  77000~79000대 어림수 하드코딩인데 차트는 진짜 캔들이다. 6건 중 3건은 차트상
  움직임과 손익 방향이 **반대**로 보인다. 로직 버그가 아니라 데이터 문제.
  고치려면 해당 시각의 실제 캔들 가격을 진입가/청산가로 쓰게 하면 된다.
- **바이낸스 캔들은 현물(`api.binance.com`), 체결은 선물(`fapi`)이다.** Phase 0부터
  이어진 불일치. 가격이 미세하게 다르다. 바이비트는 양쪽 다 `linear`(무기한).
- 봉 단위가 1분 고정. 1분/5분/1시간 전환 UI는 없음 (`TRADE_INTERVAL` 상수,
  어댑터는 이미 3종을 지원).
- 수익률(%)은 **레버리지 미반영**.
- `/trades`는 심볼당 최근 50건(바이비트는 최대 100). 조회 구간 시작 시점에 이미
  열려 있던 포지션은 진입 체결이 잘려 "청산만 있는 트레이드"로 잘못 묶일 수 있다.
- 심볼이 `BTCUSDT` 고정 (`SYMBOL` 상수).
- `/account`는 바이낸스 어댑터에만 있다. 바이비트에서는 501을 준다.
- `App.jsx`가 단일 컴포넌트로 커지는 중. 더 커지면 분리 필요.

## 작업 규칙

- **사용자가 시킨 것만 한다.** 요청 범위를 넘어 기능을 덧붙이지 않는다.
  개선안이 보이면 하지 말고 말로 제안한다.
- 판단해서 정한 것(기본값, 동작 방식 등)이 있으면 작업 후 명시적으로 알린다.
- 외부 API 스펙은 기억에 의존하지 말고 문서 확인 + 실제 호출로 검증한다.
- 코드 주석은 한국어. 기존 파일의 주석 밀도와 톤을 따라간다.
- 변경 후 `npm run lint`와 `npm run build`로 확인한다.
- 비밀키는 `.env`에만. 코드에 하드코딩 금지.
