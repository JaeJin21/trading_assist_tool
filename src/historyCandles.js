// 미리 받아둔 과거 캔들 파일을 읽어서 필요한 구간만 잘라 쓴다.
//
// 파일은 scripts/fetchCandles.js 가 만들고(data/bybit-BTCUSDT-1m.json),
// 백엔드가 /data 로 그대로 내려준다. 내용은 앱 공통 캔들 형식
// { time(초), open, high, low, close } 의 시간 오름차순 배열이다.
//
// 라이브 API 는 한 번에 1000봉이 최대라 진입 전 며칠치를 한 번에 못 받는다.
// 그래서 과거 구간은 이 파일에서 가져오고, 파일이 못 덮는 구간만 라이브로 간다.

// 같은 파일을 트레이드 클릭할 때마다 다시 받지 않도록 캐시한다.
// 값은 Promise 라서, 아직 받는 중에 또 눌러도 요청이 한 번만 나간다.
const cache = new Map()

// 파일을 받아 { candles, first, last } 로 만든다. 파일이 없으면 null.
// (null 이면 호출하는 쪽이 라이브 API 로 폴백한다)
export function loadHistory(apiBase, exchange, symbol, interval) {
  const name = `${exchange}-${symbol}-${interval}`
  if (!cache.has(name)) {
    const promise = fetch(`${apiBase}/data/${name}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((candles) => {
        if (!Array.isArray(candles) || candles.length === 0) return null
        return {
          name,
          candles,
          first: candles[0].time,
          last: candles[candles.length - 1].time,
        }
      })
      .catch(() => null) // 백엔드가 안 떠 있거나 파일이 없는 경우
    cache.set(name, promise)
  }
  return cache.get(name)
}

// 요청 구간이 파일 안에 통째로 들어오는지. 한쪽이라도 삐져나오면 false.
export function historyCovers(history, startSec, endSec) {
  return Boolean(history) && history.first <= startSec && history.last >= endSec
}

// time >= target 인 첫 인덱스. (43,200봉을 매번 훑지 않으려고 이진탐색)
function lowerBound(candles, target) {
  let lo = 0
  let hi = candles.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (candles[mid].time < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

// [startSec, endSec] 구간만 잘라낸 새 배열.
export function sliceHistory(history, startSec, endSec) {
  const from = lowerBound(history.candles, startSec)
  const to = lowerBound(history.candles, endSec + 1)
  return history.candles.slice(from, to)
}
