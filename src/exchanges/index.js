// 프론트 쪽 거래소 어댑터 레지스트리 (캔들 조회 담당).
//
// 어댑터가 지켜야 하는 인터페이스:
//   id
//   fetchCandles({ symbol, interval, startTime, endTime, limit }, signal)
//     -> [{ time(초), open, high, low, close }] 시간 오름차순
//
// interval 은 거래소 표기가 아니라 공통 토큰('1m' | '5m' | '1h')을 넘긴다.
// 거래소별 표기 변환은 각 어댑터가 알아서 한다.

import { binanceCandles } from './binance.js'
import { bybitCandles } from './bybit.js'

const ADAPTERS = {
  binance: binanceCandles,
  bybit: bybitCandles,
}

export const DEFAULT_EXCHANGE = 'binance'

// 모르는 id 가 오면 기본값으로 떨어뜨린다. (백엔드가 새 거래소를 먼저 알게 될 수 있음)
export function getCandleAdapter(id) {
  return ADAPTERS[id] ?? ADAPTERS[DEFAULT_EXCHANGE]
}
