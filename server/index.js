// .env 파일의 값을 process.env 로 자동으로 읽어옵니다. (반드시 다른 코드보다 먼저 실행)
import 'dotenv/config'

// Node 내장 암호화 모듈. HMAC SHA256 서명을 만들 때 사용합니다.
import crypto from 'node:crypto'

// 웹 서버 프레임워크.
import express from 'express'

// 가짜 체결 데이터 생성기.
import { generateMockTrades } from './mockTrades.js'

const app = express()

// 프론트(다른 포트 5173)에서 이 백엔드(3001)를 호출할 수 있도록 CORS 허용.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  next()
})

// 가짜/진짜 전환 플래그. .env 의 USE_MOCK 로 제어하고, 기본값은 true(가짜).
// 실제 매매가 생기면 .env 에서 USE_MOCK=false 로 바꾸면 진짜 바이낸스 호출로 되돌아간다.
const USE_MOCK = (process.env.USE_MOCK ?? 'true') !== 'false'

// 서버 포트. .env 에 PORT 가 있으면 그걸 쓰고, 없으면 3001.
const PORT = process.env.PORT || 3001

// .env 에서 읽어온 API 키/시크릿. 코드에 하드코딩하지 않습니다.
const API_KEY = process.env.BINANCE_API_KEY
const API_SECRET = process.env.BINANCE_API_SECRET

// 바이낸스 REST API 기본 주소.
const SPOT_BASE = 'https://api.binance.com' // 현물
const FUTURES_BASE = 'https://fapi.binance.com' // USDⓈ-M 선물

// 서명이 필요한 바이낸스 요청을 보내는 공통 헬퍼.
// baseUrl: 현물/선물 주소, path: 엔드포인트 경로, params: 쿼리 파라미터 객체.
async function signedRequest(baseUrl, path, params = {}) {
  // 타임스탬프(ms)와 시간오차 허용범위를 포함해 전체 파라미터를 구성.
  const withMeta = { ...params, timestamp: Date.now(), recvWindow: 5000 }

  // 객체를 key=value&key=value 형태의 쿼리스트링으로 변환.
  const query = new URLSearchParams(withMeta).toString()

  // 쿼리스트링을 시크릿으로 HMAC-SHA256 서명(16진수).
  const signature = crypto.createHmac('sha256', API_SECRET).update(query).digest('hex')

  // 최종 URL: 쿼리 + 서명.
  const url = `${baseUrl}${path}?${query}&signature=${signature}`

  // API 키는 헤더로 전달. (Node 22 내장 fetch)
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': API_KEY },
  })

  // 상태코드와 본문(JSON)을 함께 반환.
  const data = await response.json()
  return { status: response.status, data }
}

// 키가 설정돼 있는지 확인하는 가드. 없으면 응답을 보내고 true 반환.
function guardKeys(res) {
  if (!API_KEY || !API_SECRET) {
    res.status(500).json({ error: 'BINANCE_API_KEY / BINANCE_API_SECRET 가 .env 에 설정되지 않았습니다.' })
    return true
  }
  return false
}

// 연결 확인용 (인증 불필요).
app.get('/ping', (req, res) => {
  res.send('pong')
})

// 계정 정보 조회 (현물, 서명 요청).
app.get('/account', async (req, res) => {
  if (guardKeys(res)) return
  try {
    const { status, data } = await signedRequest(SPOT_BASE, '/api/v3/account')
    res.status(status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 최근 체결 내역 조회 (선물). USE_MOCK 에 따라 가짜/진짜를 전환.
app.get('/trades', async (req, res) => {
  // 심볼은 쿼리로 받되 기본값 BTCUSDT. 선물 userTrades 는 symbol 이 필수입니다.
  const symbol = req.query.symbol || 'BTCUSDT'
  const limit = 50 // 일단 50건

  // === 가짜 데이터 경로 (지금 기본값) ===
  if (USE_MOCK) {
    const data = generateMockTrades(symbol)
    console.log(`[/trades] (MOCK) ${symbol} count=`, data.length)
    return res.status(200).json(data)
  }

  // === 진짜 바이낸스 경로 (USE_MOCK=false 일 때) ===
  if (guardKeys(res)) return
  try {
    // 선물 체결내역 엔드포인트: /fapi/v1/userTrades
    const { status, data } = await signedRequest(FUTURES_BASE, '/fapi/v1/userTrades', {
      symbol,
      limit,
    })

    // 요청대로 콘솔에도 데이터를 찍어 확인.
    console.log(`[/trades] (REAL) ${symbol} status=${status} count=`, Array.isArray(data) ? data.length : data)

    res.status(status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 서버 시작.
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})
