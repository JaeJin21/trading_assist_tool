// 바이낸스 선물 userTrades 형식과 "똑같은" 가짜 체결 데이터를 만든다.
// 진입(BUY)→청산(SELL)이 짝을 이루는 왕복 트레이드 6건 = 체결 12건.
// time 은 "지금으로부터 N시간 전"으로 잡아, 프론트가 불러오는 최근 100개
// 1시간봉 캔들 범위 안에 들어오게 한다(=그 시점 캔들이 실제로 존재).

// 왕복 트레이드 정의: 진입 시각(몇 시간 전) / 보유 시간(분) / 진입가 / 청산가 / 수량
const ROUND_TRIPS = [
  { entryHoursAgo: 46, holdMin: 90, entry: 77000, exit: 77650, qty: 0.012 },
  { entryHoursAgo: 40, holdMin: 30, entry: 77800, exit: 77500, qty: 0.008 }, // 손실
  { entryHoursAgo: 33, holdMin: 180, entry: 76900, exit: 78200, qty: 0.015 },
  { entryHoursAgo: 26, holdMin: 45, entry: 78100, exit: 78050, qty: 0.02 }, // 소폭 손실
  { entryHoursAgo: 20, holdMin: 240, entry: 77400, exit: 79000, qty: 0.01 },
  { entryHoursAgo: 12, holdMin: 60, entry: 78800, exit: 78300, qty: 0.018 }, // 손실
]

const TAKER_FEE = 0.0004 // 선물 taker 수수료 0.04%

// 한 건의 체결 객체를 userTrades 형식으로 만든다.
function makeFill({ symbol, id, orderId, side, price, qty, realizedPnl, time }) {
  const quoteQty = price * qty // 체결 명목가치
  const commission = quoteQty * TAKER_FEE // 수수료(양수로 계산 후 음수 문자열로)
  return {
    symbol,
    id,
    orderId,
    side, // 'BUY'(진입) / 'SELL'(청산)
    price: price.toFixed(2),
    qty: qty.toFixed(3),
    quoteQty: quoteQty.toFixed(8),
    realizedPnl: realizedPnl.toFixed(8),
    commission: (-commission).toFixed(8),
    commissionAsset: 'USDT',
    positionSide: 'BOTH', // 원웨이 모드
    buyer: side === 'BUY', // BUY 체결이면 매수자
    maker: false, // 시장가 체결이라 taker
    time,
  }
}

// symbol 에 대한 가짜 체결 배열을 생성. (시간 오름차순)
export function generateMockTrades(symbol = 'BTCUSDT') {
  const now = Date.now()
  const fills = []
  let id = 900000 // 아무 시작 번호
  let orderId = 5000000

  for (const t of ROUND_TRIPS) {
    const entryTime = now - t.entryHoursAgo * 60 * 60 * 1000
    const exitTime = entryTime + t.holdMin * 60 * 1000

    // 진입 체결 (BUY, 실현손익 0)
    fills.push(
      makeFill({
        symbol,
        id: id++,
        orderId: orderId++,
        side: 'BUY',
        price: t.entry,
        qty: t.qty,
        realizedPnl: 0,
        time: entryTime,
      })
    )

    // 청산 체결 (SELL, 실현손익 = (청산가-진입가)*수량)
    fills.push(
      makeFill({
        symbol,
        id: id++,
        orderId: orderId++,
        side: 'SELL',
        price: t.exit,
        qty: t.qty,
        realizedPnl: (t.exit - t.entry) * t.qty,
        time: exitTime,
      })
    )
  }

  // 실제 API 처럼 시간 오름차순 정렬.
  return fills.sort((a, b) => a.time - b.time)
}
