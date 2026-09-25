// 바이비트 공개 캔들을 받아서 로컬 JSON 파일로 저장한다.
//
// 왜 REST 로 받는가:
//   public.bybit.com 에 파일로 올라오는 캔들은 kline_for_metatrader4 뿐인데,
//   2024-11 까지만 올라와 있고 그 뒤로 갱신이 멈췄다. 최근 구간을 받으려면
//   /v5/market/kline (공개, 인증 불필요) 을 페이지로 나눠 부르는 수밖에 없다.
//
// 실제 호출로 확인한 것:
//   - limit 최대 1000. 그보다 크게 보내도 조용히 1000 으로 잘린다.
//   - start 와 end 를 같이 주면 그 구간의 "end 쪽 최신" 1000 개를 준다.
//     (바이낸스처럼 start 부터 앞으로 채워주는 게 아니다. 그래서 아래 루프는
//      end 에서 과거 방향으로 거슬러 올라간다.)
//   - 응답 list 는 항상 최신순이라 뒤집어야 한다.
//   - interval 이 잘못돼도 에러가 아니라 retCode 0 + 빈 list 로 온다. ('1m' 을
//     그대로 보내면 빈 배열이 온다) 그래서 아래에서 토큰을 먼저 검사한다.
//
// 사용법:
//   node scripts/fetchCandles.js                                  (기본값)
//   node scripts/fetchCandles.js --symbol ETHUSDT --interval 5m --days 90
//   node scripts/fetchCandles.js --out data/원하는이름.json

import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://api.bybit.com'
const CATEGORY = 'linear' // USDT 무기한
const MAX_LIMIT = 1000 // 바이비트 상한
const PAGE_DELAY_MS = 120 // 연속 호출 사이 간격 (공개 API 예의)
const MAX_RETRY = 3

// 공통 봉 단위 토큰 -> { 바이비트 표기, 한 봉의 길이(ms) }.
// 바이비트가 실제로 받아주는 값만 넣었다. (호출로 확인: 1,3,5,15,30,60,120,240,360,720,D,W,M)
const MIN = 60 * 1000
const INTERVALS = {
  '1m': { code: '1', ms: MIN },
  '3m': { code: '3', ms: 3 * MIN },
  '5m': { code: '5', ms: 5 * MIN },
  '15m': { code: '15', ms: 15 * MIN },
  '30m': { code: '30', ms: 30 * MIN },
  '1h': { code: '60', ms: 60 * MIN },
  '2h': { code: '120', ms: 120 * MIN },
  '4h': { code: '240', ms: 240 * MIN },
  '6h': { code: '360', ms: 360 * MIN },
  '12h': { code: '720', ms: 720 * MIN },
  '1d': { code: 'D', ms: 1440 * MIN },
}

// --key value 형태의 인자를 객체로.
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key.startsWith('--')) throw new Error(`알 수 없는 인자: ${key}`)
    args[key.slice(2)] = argv[i + 1]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const SYMBOL = args.symbol ?? 'BTCUSDT'
const INTERVAL = args.interval ?? '1m'
const DAYS = Number(args.days ?? 30)

const spec = INTERVALS[INTERVAL]
if (!spec) {
  console.error(
    `지원하지 않는 봉 단위: ${INTERVAL} (가능: ${Object.keys(INTERVALS).join(', ')})`
  )
  process.exit(1)
}

const OUT = args.out ?? `data/bybit-${SYMBOL}-${INTERVAL}.json`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 캔들 한 페이지(최대 1000개). 실패하면 몇 번 다시 시도한다.
async function fetchPage(startMs, endMs) {
  const query = new URLSearchParams({
    category: CATEGORY,
    symbol: SYMBOL,
    interval: spec.code,
    start: String(startMs),
    end: String(endMs),
    limit: String(MAX_LIMIT),
  })

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/v5/market/kline?${query}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      // HTTP 200 이어도 retCode 로 실패를 알린다.
      if (json.retCode !== 0) {
        throw new Error(`retCode ${json.retCode}: ${json.retMsg}`)
      }
      return json.result?.list ?? []
    } catch (err) {
      if (attempt >= MAX_RETRY) throw err
      console.warn(`  재시도 ${attempt}/${MAX_RETRY - 1}: ${err.message}`)
      await sleep(500 * attempt)
    }
  }
}

// 바이비트 원본 [startTime, open, high, low, close, volume, turnover] (전부 문자열)
// -> 앱이 쓰는 공통 캔들 형식 { time(초), open, high, low, close }
function normalize(raw) {
  return {
    time: Number(raw[0]) / 1000, // ms -> 초
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
  }
}

async function main() {
  const endMs = Date.now()
  const startMs = endMs - DAYS * 24 * 60 * 60 * 1000
  const expected = Math.floor((endMs - startMs) / spec.ms)

  console.log(`${SYMBOL} ${INTERVAL} / 최근 ${DAYS}일`)
  console.log(
    `구간 ${new Date(startMs).toISOString()} ~ ${new Date(endMs).toISOString()}`
  )
  console.log(`예상 ${expected}봉 (페이지당 최대 ${MAX_LIMIT}봉)`)

  // 최신 쪽에서 과거 방향으로 1000개씩 거슬러 올라간다.
  // (end 를 주면 그 시각 기준 최신 봉부터 주기 때문)
  // 같은 봉이 페이지 경계에서 겹칠 수 있어 time 을 키로 Map 에 모은다.
  const byTime = new Map()
  let cursor = endMs // 이번 페이지가 끝나는 시각
  let page = 0

  while (cursor > startMs) {
    const list = await fetchPage(startMs, cursor)
    if (list.length === 0) break // 구간 시작보다 더 과거가 없으면 끝

    for (const raw of list) byTime.set(Number(raw[0]), normalize(raw))

    // 응답은 최신순이라 마지막 원소가 이 페이지에서 가장 오래된 봉이다.
    // 다음 페이지는 그 봉 바로 직전까지 받는다.
    const oldestMs = Number(list[list.length - 1][0])
    const next = oldestMs - 1
    if (next >= cursor) break // 안전장치: 진행이 없으면 무한루프 방지
    cursor = next

    page += 1
    process.stdout.write(`\r받는 중... ${page}페이지 / ${byTime.size}봉`)
    await sleep(PAGE_DELAY_MS)
  }
  console.log()

  // 아직 진행 중인(닫히지 않은) 마지막 봉은 버린다.
  // 그대로 저장하면 close/high/low 가 받은 순간의 중간값이라 나중에 실제 캔들과
  // 달라진다. 과거 구간을 저장해 두는 게 목적이므로 완성된 봉만 남긴다.
  const nowSec = Date.now() / 1000
  const candles = [...byTime.values()]
    .filter((c) => c.time + spec.ms / 1000 <= nowSec)
    .sort((a, b) => a.time - b.time)
  if (candles.length === 0) {
    console.error('받은 캔들이 없습니다.')
    process.exit(1)
  }

  // 빠진 봉 확인. 거래소 점검 등으로 구멍이 있을 수 있어 그냥 알려만 준다.
  const stepSec = spec.ms / 1000
  const gaps = []
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].time - candles[i - 1].time
    if (diff !== stepSec) {
      gaps.push({
        from: new Date(candles[i - 1].time * 1000).toISOString(),
        to: new Date(candles[i].time * 1000).toISOString(),
        missing: Math.round(diff / stepSec) - 1,
      })
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(candles))

  const sizeMb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2)
  console.log(`저장: ${OUT} (${candles.length}봉, ${sizeMb} MB)`)
  console.log(
    `범위 ${new Date(candles[0].time * 1000).toISOString()} ~ ` +
      `${new Date(candles[candles.length - 1].time * 1000).toISOString()}`
  )
  if (gaps.length === 0) {
    console.log('빠진 봉 없음 (연속)')
  } else {
    const missing = gaps.reduce((sum, g) => sum + g.missing, 0)
    console.log(`빠진 봉 ${missing}개 / 구멍 ${gaps.length}군데:`)
    for (const g of gaps.slice(0, 5)) {
      console.log(`  ${g.from} ~ ${g.to} (${g.missing}봉)`)
    }
    if (gaps.length > 5) console.log(`  ... 외 ${gaps.length - 5}군데`)
  }
}

main().catch((err) => {
  console.error('실패:', err.message)
  process.exit(1)
})
