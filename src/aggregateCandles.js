// 1분봉을 묶어 상위 봉을 만드는 집계 함수.
//
// 거래소도 저장소도 모르는 순수 함수다. 저장해 둔 파일이든 라이브 API 응답이든
// 공통 캔들 형식 { time(초), open, high, low, close } 배열이면 그대로 쓸 수 있다.
//
// 봉 경계는 정시 기준이다. epoch(1970-01-01 00:00 UTC)부터 봉 길이로 끊으므로
// 1시간봉은 매시 00분, 4시간봉은 UTC 00/04/08/12/16/20시에 시작한다.
// 거래소가 주는 상위 봉과 같은 경계라서, 실제 바이비트 5m/1h/4h 캔들과
// 대조해 값이 일치하는 것을 확인했다.

// 지원하는 봉 단위와 길이(초).
// 1주/1달은 길이가 일정하지 않아(주 시작 요일, 달마다 다른 일수) 이 방식으로는
// 만들지 않는다. 필요하면 거래소에서 직접 받는다.
export const AGGREGATE_INTERVALS = {
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
}

// 1분봉 배열 -> 상위 봉 배열.
//
// candles: 공통 캔들 형식, 시간 오름차순.
// interval: AGGREGATE_INTERVALS 의 키.
//
// 각 상위 봉은 그 구간에 든 1분봉들의 (첫 시가, 최고가, 최저가, 마지막 종가)다.
// 빠진 1분봉이 있어도 있는 것만으로 만들고, 아예 비어 있는 구간은 건너뛴다.
// (거래소도 거래가 없던 구간은 봉을 주지 않는다)
// 첫 봉과 마지막 봉은 구간이 덜 찬 상태일 수 있다. 입력 1분봉이 봉 경계에 딱
// 맞춰 시작/끝나지 않으면 그렇다. (예: 11:33 부터 있는 데이터로 4시간봉을
// 만들면 08:00 봉은 11:33~11:59 분량만 들어간다 — 실제 거래소 4시간봉과 시가/
// 고저가 다르다) 받아둔 데이터까지로 만든 것이므로 그대로 두고, 값을 거래소와
// 대조할 때는 양끝을 빼고 본다.
export function aggregateCandles(candles, interval) {
  const step = AGGREGATE_INTERVALS[interval]
  if (!step) {
    throw new Error(
      `지원하지 않는 봉 단위: ${interval} ` +
        `(가능: ${Object.keys(AGGREGATE_INTERVALS).join(', ')})`
    )
  }
  if (!Array.isArray(candles) || candles.length === 0) return []
  if (step === 60) return [...candles] // 1분봉은 묶을 게 없다

  const out = []
  let bucket = null // 지금 만들고 있는 상위 봉

  for (const c of candles) {
    // 이 1분봉이 속한 상위 봉의 시작 시각.
    const bucketTime = Math.floor(c.time / step) * step

    if (!bucket || bucket.time !== bucketTime) {
      if (bucket) out.push(bucket)
      // 새 봉의 시가는 이 구간 첫 1분봉의 시가.
      bucket = {
        time: bucketTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }
      continue
    }

    // 같은 구간이면 고가/저가를 갱신하고 종가는 계속 덮어쓴다.
    if (c.high > bucket.high) bucket.high = c.high
    if (c.low < bucket.low) bucket.low = c.low
    bucket.close = c.close
  }

  if (bucket) out.push(bucket)
  return out
}
