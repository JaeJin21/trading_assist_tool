// .env 파일의 값을 process.env 로 자동으로 읽어옵니다. (반드시 다른 코드보다 먼저 실행)
import 'dotenv/config'

// 웹 서버 프레임워크.
import express from 'express'

// 받아둔 캔들 파일 경로를 잡는 데 쓴다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 거래소 어댑터. 거래소별 차이(서명, 엔드포인트, 응답 형식)는 전부 여기 안에 있다.
import { createExchange, EXCHANGE_IDS } from './exchanges/index.js'

const app = express()

// 프론트(다른 포트 5173)에서 이 백엔드(3001)를 호출할 수 있도록 CORS 허용.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  next()
})

// 미리 받아둔 과거 캔들 파일(scripts/fetchCandles.js 가 만든 data/*.json)을
// 프론트가 그대로 읽어갈 수 있게 정적으로 내려준다.
// 라이브 API 는 1회 1000봉이 최대라, 진입 전 며칠치는 이 파일에서 가져온다.
const DATA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data'
)
app.use('/data', express.static(DATA_DIR))

// 어느 거래소를 쓸지. .env 의 EXCHANGE 로 전환하고, 기본값은 binance.
const EXCHANGE_ID = process.env.EXCHANGE || 'binance'

// 가짜/진짜 전환 플래그. .env 의 USE_MOCK 로 제어하고, 기본값은 true(가짜).
// 실제 매매가 생기면 .env 에서 USE_MOCK=false 로 바꾸면 진짜 거래소 호출로 되돌아간다.
const USE_MOCK = (process.env.USE_MOCK ?? 'true') !== 'false'

// 서버 포트. .env 에 PORT 가 있으면 그걸 쓰고, 없으면 3001.
const PORT = process.env.PORT || 3001

// .env 에서 읽어온 API 키/시크릿. 코드에 하드코딩하지 않습니다.
// 키 이름은 거래소별로 나누고, 없으면 예전 BINANCE_* 이름으로도 찾아본다.
const KEYS = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
  },
  bybit: {
    apiKey: process.env.BYBIT_API_KEY,
    apiSecret: process.env.BYBIT_API_SECRET,
  },
}

// 선택한 거래소의 어댑터를 만든다. 잘못된 이름이면 여기서 바로 죽는 게 낫다.
const exchange = createExchange(EXCHANGE_ID, KEYS[EXCHANGE_ID] ?? {})

// 키가 설정돼 있는지 확인하는 가드. 없으면 응답을 보내고 true 반환.
function guardKeys(res) {
  const { apiKey, apiSecret } = KEYS[exchange.id] ?? {}
  if (!apiKey || !apiSecret) {
    const prefix = exchange.id.toUpperCase()
    res.status(500).json({
      error: `${prefix}_API_KEY / ${prefix}_API_SECRET 가 .env 에 설정되지 않았습니다.`,
    })
    return true
  }
  return false
}

// 연결 확인용 (인증 불필요).
app.get('/ping', (req, res) => {
  res.send('pong')
})

// 프론트가 "지금 어느 거래소를 쓰는지" 알아야 캔들도 같은 거래소에서 받아온다.
// 거래소 전환을 .env 한 곳에서만 하도록 서버가 알려주는 방식.
app.get('/config', (req, res) => {
  res.json({
    exchange: exchange.id,
    label: exchange.label,
    useMock: USE_MOCK,
    available: EXCHANGE_IDS,
  })
})

// 계정 정보 조회. 어댑터가 지원할 때만 동작한다. (지금은 바이낸스 현물만)
app.get('/account', async (req, res) => {
  if (!exchange.fetchAccount) {
    return res
      .status(501)
      .json({ error: `${exchange.id} 어댑터는 /account 를 지원하지 않습니다.` })
  }
  if (guardKeys(res)) return
  try {
    const { status, data } = await exchange.fetchAccount()
    res.status(status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 최근 체결 내역 조회. USE_MOCK 에 따라 가짜/진짜를 전환한다.
// 응답은 거래소와 무관한 공통 형식이라, 프론트는 어느 거래소인지 몰라도 된다.
app.get('/trades', async (req, res) => {
  const symbol = req.query.symbol || 'BTCUSDT'
  const limit = 50 // 일단 50건

  // === 가짜 데이터 경로 (지금 기본값) ===
  if (USE_MOCK) {
    const data = exchange.mockFills(symbol)
    console.log(`[/trades] (MOCK/${exchange.id}) ${symbol} count=`, data.length)
    return res.status(200).json(data)
  }

  // === 진짜 거래소 경로 (USE_MOCK=false 일 때) ===
  if (guardKeys(res)) return
  try {
    const data = await exchange.fetchFills({ symbol, limit })
    console.log(`[/trades] (REAL/${exchange.id}) ${symbol} count=`, data.length)
    res.status(200).json(data)
  } catch (err) {
    console.error(`[/trades] (REAL/${exchange.id}) 실패:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// 서버 시작.
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  console.log(`거래소: ${exchange.label} (${exchange.id}) / 목데이터: ${USE_MOCK}`)
})
