// 바이낸스 캔들 어댑터. (공개 엔드포인트라 인증 불필요)

const BASE = 'https://api.binance.com'

// 공통 봉 단위 토큰 -> 바이낸스 표기. 바이낸스는 그대로 쓴다.
const INTERVALS = {
  '1m': '1m',
  '5m': '5m',
  '1h': '1h',
}

export const binanceCandles = {
  id: 'binance',

  async fetchCandles({ symbol, interval, startTime, endTime, limit }, signal) {
    const params = { symbol, interval: INTERVALS[interval] ?? interval }
    if (startTime) params.startTime = startTime
    if (endTime) params.endTime = endTime
    if (limit) params.limit = limit

    const query = new URLSearchParams(params).toString()
    const res = await fetch(`${BASE}/api/v3/klines?${query}`, { signal })
    if (!res.ok) throw new Error(`Binance ${res.status}`)
    const klines = await res.json()

    // Binance kline: [openTime, open, high, low, close, volume, ...]
    // 이미 시간 오름차순이라 그대로 매핑하면 된다.
    return klines.map((k) => ({
      time: k[0] / 1000, // ms -> seconds (UTCTimestamp)
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }))
  },
}
