// 개별 체결(fill) 목록을 "진입 → 청산" 한 쌍의 트레이드로 묶는다.
//
// 묶는 기준: 심볼별로 시간 순서대로 체결을 훑으면서 순포지션(net position)을
// 계산하고, 포지션이 0 → (열림) → 다시 0 이 되는 구간을 트레이드 한 건으로 본다.
// 이렇게 하면 분할 진입/분할 청산이 섞여 있어도 왕복 한 번이 한 건으로 묶인다.
//
// 입력은 바이낸스 선물 userTrades 형식을 가정한다:
//   { symbol, id, side: 'BUY'|'SELL', price, qty, realizedPnl, commission, time }
//   (price/qty/realizedPnl/commission 은 문자열이어도 된다.)

// 부동소수점 오차 때문에 순포지션이 정확히 0 이 안 될 수 있어서 쓰는 허용치.
const EPSILON = 1e-8

const num = (v) => Number(v ?? 0)

// 체결 배열의 수량가중 평균 단가.
function avgPrice(fills) {
  const qty = fills.reduce((sum, f) => sum + num(f.qty), 0)
  if (qty === 0) return 0
  const notional = fills.reduce((sum, f) => sum + num(f.price) * num(f.qty), 0)
  return notional / qty
}

// 한 구간(그룹)의 체결들을 트레이드 한 건으로 변환한다.
// direction: 'LONG'(BUY 로 시작) | 'SHORT'(SELL 로 시작)
// open: 아직 청산되지 않은 구간이면 true
function buildTrade(symbol, group, direction, open) {
  const entrySide = direction === 'LONG' ? 'BUY' : 'SELL'
  const entryFills = group.filter((f) => f.side === entrySide)
  const exitFills = group.filter((f) => f.side !== entrySide)

  const entryQty = entryFills.reduce((sum, f) => sum + num(f.qty), 0)
  const exitQty = exitFills.reduce((sum, f) => sum + num(f.qty), 0)
  const entryPrice = avgPrice(entryFills)
  const exitPrice = avgPrice(exitFills)

  // 수수료는 음수로 들어오므로 절댓값 합계로 "낸 수수료"를 만든다.
  const fee = group.reduce((sum, f) => sum + Math.abs(num(f.commission)), 0)

  // 실현손익은 거래소가 준 realizedPnl 합계를 우선 사용하고,
  // 없으면 평균 진입가/청산가로 직접 계산한다.
  const reportedPnl = group.reduce((sum, f) => sum + num(f.realizedPnl), 0)
  const computedPnl =
    (direction === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * exitQty
  const grossPnl = open ? 0 : reportedPnl !== 0 ? reportedPnl : computedPnl

  const entryTime = entryFills.length ? entryFills[0].time : group[0].time
  const exitTime = open ? null : exitFills[exitFills.length - 1].time

  return {
    id: `${symbol}-${group[0].id ?? entryTime}`,
    symbol,
    direction,
    open, // true 면 아직 청산 안 된 포지션
    qty: entryQty,
    entryPrice,
    exitPrice: open ? null : exitPrice,
    entryTime,
    exitTime,
    holdMs: open ? null : exitTime - entryTime,
    grossPnl, // 수수료 차감 전
    fee,
    netPnl: open ? 0 : grossPnl - fee, // 수수료 차감 후
    // 진입가 대비 수익률(%). 레버리지는 고려하지 않는다.
    pnlPct: open || entryPrice === 0 ? null : (grossPnl / (entryPrice * exitQty)) * 100,
    fillCount: group.length,
    fills: group,
  }
}

// 체결 배열 -> 트레이드 배열. 청산 시각(미청산은 진입 시각) 오름차순으로 반환.
export function pairTrades(fills) {
  if (!Array.isArray(fills) || fills.length === 0) return []

  // 심볼별로 나눈다. 서로 다른 심볼의 체결은 절대 같은 트레이드로 묶이면 안 된다.
  const bySymbol = new Map()
  for (const f of fills) {
    if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, [])
    bySymbol.get(f.symbol).push(f)
  }

  const trades = []

  for (const [symbol, symbolFills] of bySymbol) {
    // 시간 오름차순 정렬 (API 가 이미 정렬해 주지만 보장할 수는 없다).
    const sorted = [...symbolFills].sort((a, b) => a.time - b.time)

    let position = 0 // 순포지션 (BUY 는 +, SELL 은 -)
    let group = [] // 현재 열려 있는 구간의 체결들
    let direction = null // 이 구간이 LONG 인지 SHORT 인지

    for (const f of sorted) {
      const signedQty = f.side === 'BUY' ? num(f.qty) : -num(f.qty)

      // 포지션이 없는 상태에서 들어온 체결 = 새 구간의 진입.
      if (group.length === 0) direction = signedQty > 0 ? 'LONG' : 'SHORT'

      group.push(f)
      position += signedQty

      // 순포지션이 0 으로 돌아오면 한 왕복이 끝난 것 -> 트레이드 확정.
      if (Math.abs(position) < EPSILON) {
        trades.push(buildTrade(symbol, group, direction, false))
        group = []
        direction = null
        position = 0
      }
    }

    // 루프가 끝났는데 포지션이 남아 있으면 아직 청산 안 된 트레이드.
    if (group.length > 0) {
      trades.push(buildTrade(symbol, group, direction, true))
    }
  }

  // 최신 트레이드가 아래로 가도록 시간 오름차순 정렬.
  return trades.sort((a, b) => (a.exitTime ?? a.entryTime) - (b.exitTime ?? b.entryTime))
}

// 트레이드 목록 요약 (승률, 총손익 등). 표 상단에 보여주기 위한 값들.
export function summarize(trades) {
  const closed = trades.filter((t) => !t.open)
  const wins = closed.filter((t) => t.netPnl > 0)
  return {
    total: trades.length,
    closed: closed.length,
    open: trades.length - closed.length,
    wins: wins.length,
    losses: closed.length - wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    netPnl: closed.reduce((sum, t) => sum + t.netPnl, 0),
    fee: closed.reduce((sum, t) => sum + t.fee, 0),
  }
}
