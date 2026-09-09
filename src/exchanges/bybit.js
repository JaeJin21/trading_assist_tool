// 바이비트 캔들 어댑터. (V5 공개 엔드포인트라 인증 불필요)
//
// 바이낸스와 다른 점:
//  - 봉 단위 표기가 숫자 문자열이다. ('1m' -> '1', '1h' -> '60')
//  - 파라미터 이름이 startTime/endTime 이 아니라 start/end 다.
//  - category(상품군)를 같이 보내야 한다. USDT 무기한은 'linear'.
//  - 응답이 { retCode, result: { list } } 봉투에 싸여 오고,
//    list 가 최신순이라 뒤집어야 한다.

const BASE = 'https://api.bybit.com'
const CATEGORY = 'linear' // USDT 무기한

// 공통 봉 단위 토큰 -> 바이비트 표기(분 단위 숫자 문자열).
const INTERVALS = {
  '1m': '1',
  '5m': '5',
  '1h': '60',
}

export const bybitCandles = {
  id: 'bybit',

  async fetchCandles({ symbol, interval, startTime, endTime, limit }, signal) {
    const params = {
      category: CATEGORY,
      symbol,
      interval: INTERVALS[interval] ?? interval,
    }
    if (startTime) params.start = startTime
    if (endTime) params.end = endTime
    if (limit) params.limit = limit

    const query = new URLSearchParams(params).toString()
    const res = await fetch(`${BASE}/v5/market/kline?${query}`, { signal })
    if (!res.ok) throw new Error(`Bybit ${res.status}`)
    const json = await res.json()

    // HTTP 200 이어도 retCode 로 실패를 알린다.
    if (json.retCode !== 0) {
      throw new Error(`Bybit retCode ${json.retCode}: ${json.retMsg}`)
    }

    // Bybit kline: [startTime, open, high, low, close, volume, turnover] (전부 문자열)
    const candles = (json.result?.list ?? []).map((k) => ({
      time: Number(k[0]) / 1000, // ms -> seconds (UTCTimestamp)
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }))

    // 바이비트는 최신순으로 준다. 차트는 시간 오름차순이어야 하므로 정렬한다.
    return candles.sort((a, b) => a.time - b.time)
  },
}
