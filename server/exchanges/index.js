// 거래소 어댑터 레지스트리.
// 새 거래소를 붙이려면 어댑터 파일을 만들고 여기 FACTORIES 에 추가하면 된다.
//
// 어댑터가 지켜야 하는 인터페이스:
//   id            거래소 식별자 ('binance' | 'bybit' ...)
//   label         화면에 보여줄 이름
//   fetchFills({ symbol, limit })  -> 공통 체결 형식 배열 (시간 오름차순)
//   mockFills(symbol)              -> 같은 형식의 가짜 데이터
//   fetchAccount()                 -> (선택) 계정 정보. 없으면 /account 는 501.
//
// 공통 체결 형식:
//   { exchange, symbol, id, orderId, side: 'BUY'|'SELL', price, qty,
//     realizedPnl, commission(낸 수수료, 양수), commissionAsset, maker, time(ms) }

import { createBinanceAdapter } from './binance.js'
import { createBybitAdapter } from './bybit.js'

const FACTORIES = {
  binance: createBinanceAdapter,
  bybit: createBybitAdapter,
}

export const EXCHANGE_IDS = Object.keys(FACTORIES)

// id 로 어댑터를 만든다. 모르는 id 면 바로 에러를 내서 오타를 조용히 넘기지 않는다.
export function createExchange(id, keys) {
  const factory = FACTORIES[id]
  if (!factory) {
    throw new Error(
      `알 수 없는 거래소 '${id}'. 사용 가능: ${EXCHANGE_IDS.join(', ')}`
    )
  }
  return factory(keys)
}
