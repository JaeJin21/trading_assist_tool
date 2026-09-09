// 바이낸스 어댑터 (USDⓈ-M 선물).
// 기존 server/index.js 에 있던 서명/조회 코드를 그대로 옮겨온 것이다.

import crypto from 'node:crypto'
import { generateMockTrades } from '../mockTrades.js'

const SPOT_BASE = 'https://api.binance.com' // 현물
const FUTURES_BASE = 'https://fapi.binance.com' // USDⓈ-M 선물

// 서명이 필요한 바이낸스 요청. 쿼리스트링 전체를 시크릿으로 HMAC-SHA256 서명하고
// signature 파라미터로 붙인다. API 키는 헤더로 전달.
async function signedRequest(baseUrl, path, params, { apiKey, apiSecret }) {
  const withMeta = { ...params, timestamp: Date.now(), recvWindow: 5000 }
  const query = new URLSearchParams(withMeta).toString()
  const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex')

  const response = await fetch(`${baseUrl}${path}?${query}&signature=${signature}`, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': apiKey },
  })

  const data = await response.json()
  return { status: response.status, data }
}

// 바이낸스 userTrades 한 건 -> 공통 체결 형식.
// 바이낸스 형식이 사실상 공통 형식의 원형이라 대부분 그대로 통과한다.
function normalizeFill(raw) {
  return {
    exchange: 'binance',
    symbol: raw.symbol,
    id: String(raw.id),
    orderId: String(raw.orderId),
    side: raw.side, // 이미 'BUY' / 'SELL'
    price: raw.price,
    qty: raw.qty,
    realizedPnl: raw.realizedPnl ?? '0',
    // 공통 형식의 commission 은 "낸 수수료(양수)". 목데이터가 음수로 만들기
    // 때문에 절댓값으로 맞춘다.
    commission: String(Math.abs(Number(raw.commission ?? 0))),
    commissionAsset: raw.commissionAsset ?? 'USDT',
    maker: Boolean(raw.maker),
    time: Number(raw.time),
  }
}

export function createBinanceAdapter({ apiKey, apiSecret }) {
  return {
    id: 'binance',
    label: 'Binance USDⓈ-M 선물',

    // 실제 체결 내역 조회.
    async fetchFills({ symbol, limit }) {
      const { status, data } = await signedRequest(
        FUTURES_BASE,
        '/fapi/v1/userTrades',
        { symbol, limit },
        { apiKey, apiSecret }
      )
      if (!Array.isArray(data)) {
        throw new Error(`Binance userTrades 실패 (status ${status}): ${JSON.stringify(data)}`)
      }
      return data.map(normalizeFill)
    },

    // 가짜 체결 내역. 바이낸스 원본 형식으로 만든 뒤 같은 정규화를 거친다.
    mockFills(symbol) {
      return generateMockTrades(symbol).map(normalizeFill)
    },

    // 현물 계정 정보. (바이낸스에만 있는 부가 기능)
    async fetchAccount() {
      return signedRequest(SPOT_BASE, '/api/v3/account', {}, { apiKey, apiSecret })
    },
  }
}
