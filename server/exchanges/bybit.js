// 바이비트 어댑터 (V5 API, USDT 무기한 = category 'linear').
//
// 바이낸스와 다른 점:
//  - 서명 문자열이 `timestamp + apiKey + recvWindow + queryString` 이고,
//    서명을 쿼리가 아니라 X-BAPI-* 헤더로 보낸다.
//  - 응답이 { retCode, retMsg, result } 봉투에 싸여 온다. HTTP 200 이어도
//    retCode 가 0 이 아니면 실패다.
//  - side 가 'Buy' / 'Sell' (대소문자 다름).
//  - 실현손익 필드가 없다. (별도 엔드포인트 /v5/position/closed-pnl 에 있음)
//    -> 공통 형식에서는 '0' 으로 두고, pairTrades 가 평균가로 계산하게 맡긴다.
//  - limit 최대 100, 조회 구간 최대 7일.

import crypto from 'node:crypto'
import { ROUND_TRIPS, TAKER_FEE } from '../mockTrades.js'

const BASE = 'https://api.bybit.com'
const RECV_WINDOW = '5000'
const CATEGORY = 'linear' // USDT 무기한

// 서명이 필요한 바이비트 요청.
async function signedRequest(path, params, { apiKey, apiSecret }) {
  const query = new URLSearchParams(params).toString()
  const timestamp = String(Date.now())

  // 바이비트 GET 서명 대상: timestamp + apiKey + recvWindow + queryString
  const payload = timestamp + apiKey + RECV_WINDOW + query
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex')

  const response = await fetch(`${BASE}${path}?${query}`, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': signature,
    },
  })

  const data = await response.json()
  return { status: response.status, data }
}

// 바이비트 execution 한 건 -> 공통 체결 형식.
function normalizeFill(raw) {
  return {
    exchange: 'bybit',
    symbol: raw.symbol,
    id: String(raw.execId),
    orderId: String(raw.orderId),
    side: raw.side === 'Buy' ? 'BUY' : 'SELL', // 'Buy'/'Sell' -> 'BUY'/'SELL'
    price: raw.execPrice,
    qty: raw.execQty,
    realizedPnl: '0', // 바이비트 체결 응답에는 실현손익이 없다
    commission: String(Math.abs(Number(raw.execFee ?? 0))),
    commissionAsset: 'USDT',
    maker: Boolean(raw.isMaker),
    time: Number(raw.execTime), // 문자열 ms -> 숫자
  }
}

// 가짜 체결 데이터를 "바이비트 원본 형식"으로 만든다.
// 바이낸스 목데이터와 같은 왕복 정의(ROUND_TRIPS)를 쓰되 필드 이름만 바이비트식.
// 이렇게 해야 위 normalizeFill 이 실제로 동작하는지 목데이터로도 확인된다.
function generateMockRaw(symbol) {
  const now = Date.now()
  const fills = []
  let execId = 700000
  let orderId = 3000000

  for (const t of ROUND_TRIPS) {
    const entryTime = now - t.entryHoursAgo * 60 * 60 * 1000
    const exitTime = entryTime + t.holdMin * 60 * 1000

    const make = (side, price, time, closedSize) => ({
      symbol,
      execId: String(execId++),
      orderId: String(orderId++),
      side, // 'Buy' / 'Sell'
      execPrice: price.toFixed(2),
      execQty: t.qty.toFixed(3),
      execFee: (price * t.qty * TAKER_FEE).toFixed(8),
      execTime: String(time),
      execType: 'Trade',
      isMaker: false,
      closedSize,
    })

    fills.push(make('Buy', t.entry, entryTime, '')) // 진입
    fills.push(make('Sell', t.exit, exitTime, t.qty.toFixed(3))) // 청산
  }

  return fills.sort((a, b) => Number(a.execTime) - Number(b.execTime))
}

export function createBybitAdapter({ apiKey, apiSecret }) {
  return {
    id: 'bybit',
    label: 'Bybit USDT 무기한',

    async fetchFills({ symbol, limit }) {
      const { status, data } = await signedRequest(
        '/v5/execution/list',
        // 바이비트 limit 최대는 100.
        { category: CATEGORY, symbol, limit: Math.min(limit, 100) },
        { apiKey, apiSecret }
      )

      // HTTP 200 이어도 retCode 로 실패를 알린다.
      if (data?.retCode !== 0) {
        throw new Error(
          `Bybit execution/list 실패 (status ${status}, retCode ${data?.retCode}): ${data?.retMsg}`
        )
      }

      const list = data.result?.list ?? []
      // 바이비트는 최신순으로 주므로 시간 오름차순으로 뒤집는다.
      return list
        .map(normalizeFill)
        .sort((a, b) => a.time - b.time)
    },

    mockFills(symbol) {
      return generateMockRaw(symbol).map(normalizeFill)
    },
  }
}
