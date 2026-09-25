import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
} from 'lightweight-charts'
import { pairTrades, summarize } from './pairTrades'
import { getCandleAdapter } from './exchanges'
import { loadHistory, historyCovers, sliceHistory } from './historyCandles'

const API_BASE = 'http://localhost:3001'
const SYMBOL = 'BTCUSDT'

const INITIAL_COUNT = 20
const BASE_INTERVAL = 500 // ms per candle at 1x speed
const SPEEDS = [0.5, 1, 2, 5]

// 트레이드를 클릭했을 때 불러올 봉 단위와, 진입/청산 앞뒤로 더 붙일 여유 구간.
const TRADE_INTERVAL = '1m'
const PAD_MIN = 60 // 분

// 저장해 둔 과거 캔들이 있을 때, 진입 시각 기준으로 얼마나 앞까지 그릴지.
// 과거 매물대를 보려면 라이브 API 한 번치(1000봉)로는 모자라서 파일을 쓴다.
const PAST_DAYS = 2

// 재생 중 청산 지점을 지나고 몇 봉 더 간 뒤에 자동으로 멈출지.
// 청산 직후 움직임까지 보고 멈추라고 여유를 준다.
const STOP_TAIL = 5

// 표 한 페이지에 보여줄 건수.
const TRADES_PER_PAGE = 5
const FILLS_PER_PAGE = 10

const tableStyle = { borderCollapse: 'collapse', width: '100%', fontSize: 14 }
const thStyle = {
  borderBottom: '1px solid #ccc',
  textAlign: 'left',
  padding: '6px 8px',
  whiteSpace: 'nowrap',
}
const tdStyle = { padding: '6px 8px', whiteSpace: 'nowrap' }

// 손익 색: 이익은 파랑, 손실은 빨강, 0 은 기본색.
const pnlColor = (v) => (v > 0 ? '#2196f3' : v < 0 ? '#e91e63' : '#333')

// 부호를 항상 붙여서 표시. (+12.34 / -5.60)
const fmtPnl = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`

// 보유 시간(ms) -> "2h 30m" 형태.
function fmtHold(ms) {
  const min = Math.round(ms / 60000)
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`
}

// 어떤 시각(ms)이 속한 캔들의 time(초)을 찾는다.
// 마커는 실제 캔들 위에 찍혀야 해서, 체결 시각을 그 시각이 포함된 봉으로 스냅한다.
// (예: 03:22:19 체결 -> 1분봉 03:22:00)
function snapToCandle(candles, timeMs) {
  const sec = timeMs / 1000
  const idx = candles.findLastIndex((c) => c.time <= sec)
  return idx >= 0 ? candles[idx].time : null
}

// 선택한 트레이드의 진입/청산 마커를 만든다.
// 롱은 아래에서 사서(위 화살표) 위에서 팔고, 숏은 그 반대로 표시한다.
function buildTradeMarkers(trade, candles) {
  const long = trade.direction === 'LONG'
  const markers = []

  const entryTime = snapToCandle(candles, trade.entryTime)
  if (entryTime !== null) {
    markers.push({
      time: entryTime,
      position: long ? 'belowBar' : 'aboveBar',
      color: '#2196f3',
      shape: long ? 'arrowUp' : 'arrowDown',
      text: `진입 ${trade.entryPrice.toFixed(2)}`,
    })
  }

  if (!trade.open) {
    const exitTime = snapToCandle(candles, trade.exitTime)
    if (exitTime !== null) {
      markers.push({
        time: exitTime,
        position: long ? 'aboveBar' : 'belowBar',
        color: '#e91e63',
        shape: long ? 'arrowDown' : 'arrowUp',
        text: `청산 ${trade.exitPrice.toFixed(2)}`,
      })
    }
  }

  // 마커는 시간 오름차순이어야 한다.
  return markers.sort((a, b) => a.time - b.time)
}

// 목록을 페이지 단위로 잘라 보여주기 위한 공용 훅.
//
// 나중에 캘린더로 기간을 고르게 되면, 필터링한 배열을 그대로 이 훅에 넘기면 된다.
// items 배열이 바뀌면(= 기간을 다시 고르면) 자동으로 1페이지로 돌아간다.
// 그래서 items 는 반드시 useMemo 로 감싸서 매 렌더마다 새로 만들지 않아야 한다.
function usePagedList(items, perPage) {
  const [page, setPage] = useState(0)
  const [prevItems, setPrevItems] = useState(items)

  // 목록 자체가 교체되면(새로 조회, 기간 필터 변경 등) 첫 페이지부터 다시 본다.
  if (items !== prevItems) {
    setPrevItems(items)
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(items.length / perPage))
  // 건수가 줄어 현재 페이지가 사라진 경우를 대비해 마지막 페이지로 붙인다.
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = items.slice(safePage * perPage, safePage * perPage + perPage)

  return { page: safePage, pageCount, pageItems, setPage }
}

// 표 아래에 붙는 페이지 이동 버튼.
function Pager({ page, pageCount, onChange }) {
  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      <button onClick={() => onChange(page - 1)} disabled={page === 0}>
        이전
      </button>
      <span style={{ margin: '0 8px' }}>
        {page + 1} / {pageCount}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount - 1}
      >
        다음
      </button>
    </div>
  )
}

function App() {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const markersRef = useRef(null)
  const candlesRef = useRef([]) // all fetched candles
  const cursorRef = useRef(0) // number of candles currently drawn
  const tradeLoadRef = useRef(null) // 진행 중인 트레이드 캔들 요청 (취소용)
  const stopIndexRef = useRef(null) // 재생 자동 정지 지점. null 이면 끝까지 간다.
  const [cursor, setCursor] = useState(0)
  const [total, setTotal] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [trades, setTrades] = useState([]) // 백엔드 /trades 응답
  const [selectedTrade, setSelectedTrade] = useState(null) // 클릭한 트레이드
  const [chartStatus, setChartStatus] = useState('') // 로딩/에러 메시지
  const [config, setConfig] = useState(null) // 백엔드 /config (어느 거래소인지)

  // 캔들을 어느 거래소에서 받아올지. 체결 내역을 준 거래소와 반드시 같아야 한다.
  const candleAdapter = config ? getCandleAdapter(config.exchange) : null

  // 새 캔들 묶음을 차트에 올리고 리플레이 상태를 초기화한다.
  // drawCount: 처음에 그려둘 캔들 개수 (나머지는 재생/다음으로 하나씩 나온다)
  const applyCandles = (candles, drawCount) => {
    candlesRef.current = candles
    const count = Math.min(Math.max(drawCount, 1), candles.length)
    seriesRef.current.setData(candles.slice(0, count))
    cursorRef.current = count
    setCursor(count)
    setTotal(candles.length)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 400,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333333',
      },
      grid: {
        vertLines: { color: '#e1e3e6' },
        horzLines: { color: '#e1e3e6' },
      },
    })
    chartRef.current = chart

    const series = chart.addSeries(CandlestickSeries)
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // 백엔드가 어느 거래소로 돌고 있는지 먼저 받아온다.
  // 캔들도 같은 거래소에서 받아야 체결 시각과 차트가 맞는다.
  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then(setConfig)
      .catch((err) => {
        console.error('Failed to load config:', err)
        setChartStatus('백엔드(/config)에 연결하지 못했습니다.')
      })
  }, [])

  // 백엔드 /trades 에서 체결 내역을 받아온다. (지금은 가짜 데이터)
  useEffect(() => {
    fetch(`${API_BASE}/trades`)
      .then((res) => res.json())
      .then((data) => setTrades(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load trades:', err))
  }, [])

  // 시작 화면: 1시간봉 100개. 거래소를 알게 된 뒤에 불러온다.
  // (트레이드를 클릭하면 그 구간의 1분봉으로 교체된다)
  useEffect(() => {
    if (!candleAdapter) return
    const controller = new AbortController()
    candleAdapter
      .fetchCandles(
        { symbol: SYMBOL, interval: '1h', limit: 100 },
        controller.signal
      )
      .then((candles) => {
        applyCandles(candles, INITIAL_COUNT)
        chartRef.current?.timeScale().fitContent()
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Failed to load klines:', err)
      })
    return () => controller.abort()
  }, [candleAdapter])

  // 트레이드 한 건을 클릭했을 때: 진입 시각 앞뒤 구간의 1분봉을 불러와 그린다.
  const handleSelectTrade = async (trade) => {
    if (!candleAdapter) return // 아직 어느 거래소인지 모르는 상태
    setPlaying(false)

    // 이전 요청이 아직 살아 있으면 취소해서 응답이 뒤섞이지 않게 한다.
    tradeLoadRef.current?.abort()
    const controller = new AbortController()
    tradeLoadRef.current = controller

    // 진입 앞뒤로 PAD_MIN 만큼 여유를 준다. 청산까지 한 화면에 들어오도록
    // 끝은 청산 시각 기준으로 잡고, 미청산이면 진입 시각 기준으로 잡는다.
    const pad = PAD_MIN * 60 * 1000
    const endTime = (trade.exitTime ?? trade.entryTime) + pad

    // 저장 파일이 있으면 진입 전 PAST_DAYS 일치까지 거슬러 올라가 그린다.
    // 없거나 구간을 못 덮으면 예전처럼 진입 -PAD_MIN 부터만 라이브로 받는다.
    const pastStart = trade.entryTime - PAST_DAYS * 24 * 60 * 60 * 1000
    const liveStart = trade.entryTime - pad

    setChartStatus('캔들 불러오는 중...')
    try {
      const history = await loadHistory(
        API_BASE,
        config.exchange,
        trade.symbol,
        TRADE_INTERVAL
      )
      const useHistory = historyCovers(history, pastStart / 1000, endTime / 1000)

      const startTime = useHistory ? pastStart : liveStart
      const candles = useHistory
        ? sliceHistory(history, startTime / 1000, endTime / 1000)
        : await candleAdapter.fetchCandles(
            {
              symbol: trade.symbol,
              interval: TRADE_INTERVAL,
              startTime,
              endTime,
              limit: 1000, // 두 거래소 모두 1회 요청 최대치가 1000
            },
            controller.signal
          )

      // 기다리는 사이에 다른 트레이드를 눌렀으면 이 응답은 버린다.
      // (파일은 캐시에서 바로 오므로 라이브 요청보다 먼저 도착할 수 있다)
      if (tradeLoadRef.current !== controller) return

      if (candles.length === 0) {
        setChartStatus('이 구간의 캔들이 없습니다.')
        return
      }

      // 진입 시점까지는 그려두고, 그 이후는 재생으로 하나씩 보도록 커서를 잡는다.
      const entrySec = trade.entryTime / 1000
      const entryIdx = candles.findLastIndex((c) => c.time <= entrySec)
      applyCandles(candles, entryIdx >= 0 ? entryIdx + 1 : INITIAL_COUNT)

      // 청산 봉까지 그려지려면 커서가 exitIdx + 1 이어야 한다. 거기에 STOP_TAIL
      // 만큼 더 가서 멈추도록 자동 정지 지점을 잡는다. 미청산이면 정지 없음.
      const exitIdx = trade.open
        ? -1
        : candles.findLastIndex((c) => c.time <= trade.exitTime / 1000)
      stopIndexRef.current =
        exitIdx >= 0 ? Math.min(exitIdx + 1 + STOP_TAIL, candles.length) : null

      chartRef.current?.timeScale().fitContent()

      // 캔들이 준비된 뒤에 선택 상태를 바꾼다. 먼저 바꾸면 마커를 그리는 아래
      // 이펙트가 아직 교체 전인 캔들 위에 엉뚱한 마커를 찍는다.
      setSelectedTrade(trade)

      const range = `${new Date(startTime).toLocaleString()} ~ ${new Date(endTime).toLocaleString()}`
      const source = useHistory ? `저장 데이터 (진입 전 ${PAST_DAYS}일)` : '라이브 API'
      setChartStatus(
        `${trade.symbol} ${TRADE_INTERVAL} · ${range} (${candles.length}봉) · ${source}`
      )
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Failed to load trade klines:', err)
      setChartStatus(`캔들 로딩 실패: ${err.message}`)
    }
  }

  // Append exactly one more candle to the right. Returns false when none left.
  const appendNext = () => {
    const next = cursorRef.current
    if (next >= candlesRef.current.length) return false
    seriesRef.current.update(candlesRef.current[next])
    cursorRef.current = next + 1
    setCursor(next + 1)
    return true
  }

  const handleNext = () => {
    appendNext()
  }

  // Auto-play: while playing, append one candle. Interval scales with speed
  // (higher speed -> shorter interval). Changing speed restarts the timer.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      const advanced = appendNext()
      if (!advanced) {
        setPlaying(false) // reached the end -> stop
        return
      }
      // 청산 지점(+STOP_TAIL)에 닿으면 한 번 멈춘다. 정지 지점을 비워두므로
      // 다시 재생을 누르면 남은 구간을 끝까지 볼 수 있다.
      if (stopIndexRef.current !== null && cursorRef.current >= stopIndexRef.current) {
        stopIndexRef.current = null
        setPlaying(false)
      }
    }, BASE_INTERVAL / speed)
    return () => clearInterval(id)
  }, [playing, speed])

  // 선택한 트레이드의 진입/청산 마커를 그린다.
  // 아직 그려지지 않은 캔들 위에는 마커를 찍을 수 없으므로, 리플레이 커서가
  // 지나간 지점의 마커만 보여준다. (청산 마커는 재생이 청산 시점에 닿으면 나온다)
  useEffect(() => {
    if (!markersRef.current) return
    if (!selectedTrade || cursor === 0) {
      markersRef.current.setMarkers([])
      return
    }
    const candles = candlesRef.current
    const lastDrawnTime = candles[cursor - 1].time
    const markers = buildTradeMarkers(selectedTrade, candles).filter(
      (m) => m.time <= lastDrawnTime
    )
    markersRef.current.setMarkers(markers)
  }, [selectedTrade, cursor])

  const hasMore = cursor < total

  // 개별 체결을 "진입→청산" 왕복 트레이드로 묶는다.
  const pairedTrades = useMemo(() => pairTrades(trades), [trades])
  const stats = useMemo(() => summarize(pairedTrades), [pairedTrades])

  // 두 표 모두 최신 건이 위로 오게 뒤집어서 보여준다.
  // pairTrades 는 체결이 시간 오름차순이라고 전제하므로, 원본(trades)은 건드리지
  // 않고 표시용 사본만 정렬한다.
  //
  // 기간(캘린더) 필터가 생기면 여기서 정렬 전에 걸러주면 된다. 아래 usePagedList 가
  // 목록이 바뀐 걸 알아채고 1페이지로 돌려준다.
  const tradesDesc = useMemo(
    () =>
      [...pairedTrades].sort(
        // pairTrades 와 같은 기준(청산 시각, 미청산은 진입 시각)으로 내림차순.
        (a, b) => (b.exitTime ?? b.entryTime) - (a.exitTime ?? a.entryTime)
      ),
    [pairedTrades]
  )
  const fillsDesc = useMemo(
    () => [...trades].sort((a, b) => b.time - a.time),
    [trades]
  )

  const tradePage = usePagedList(tradesDesc, TRADES_PER_PAGE)
  const fillPage = usePagedList(fillsDesc, FILLS_PER_PAGE)

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>Trading Assist</h1>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
        {config
          ? `${config.label} · ${config.useMock ? '목데이터' : '실거래 데이터'}`
          : '거래소 확인 중...'}
      </div>
      <div style={{ marginBottom: 8 }}>
        <button onClick={() => setPlaying((p) => !p)} disabled={!hasMore}>
          {playing ? '일시정지' : '재생'}
        </button>
        <button
          onClick={handleNext}
          disabled={!hasMore || playing}
          style={{ marginLeft: 8 }}
        >
          다음
        </button>
        <span style={{ marginLeft: 8 }}>
          {cursor} / {total}
        </span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ marginRight: 8 }}>속도:</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              marginRight: 4,
              fontWeight: speed === s ? 'bold' : 'normal',
            }}
          >
            {s}x
          </button>
        ))}
      </div>
      {chartStatus && (
        <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          {chartStatus}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%' }} />

      <h2 style={{ marginTop: 24 }}>트레이드 ({pairedTrades.length})</h2>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
        청산 {stats.closed}건 · 승 {stats.wins} / 패 {stats.losses} · 승률{' '}
        {stats.winRate.toFixed(1)}% · 순손익{' '}
        <strong style={{ color: pnlColor(stats.netPnl) }}>
          {fmtPnl(stats.netPnl)} USDT
        </strong>{' '}
        (수수료 {stats.fee.toFixed(4)}){stats.open > 0 && ` · 미청산 ${stats.open}건`}
      </div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        행을 클릭하면 그 트레이드의 진입 시각 전후 1분봉을 불러옵니다. 최신
        트레이드가 위에 오고, 한 페이지에 {TRADES_PER_PAGE}건씩 보여줍니다.
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            {[
              '심볼',
              '방향',
              '수량',
              '진입가',
              '청산가',
              '진입 시각',
              '청산 시각',
              '보유',
              '손익',
              '수익률',
              '체결수',
            ].map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tradePage.pageItems.map((t) => (
            <tr
              key={t.id}
              onClick={() => handleSelectTrade(t)}
              style={{
                cursor: 'pointer',
                background: t.id === selectedTrade?.id ? '#eef4ff' : 'transparent',
              }}
            >
              <td style={tdStyle}>{t.symbol}</td>
              <td
                style={{
                  ...tdStyle,
                  color: t.direction === 'LONG' ? '#2196f3' : '#e91e63',
                }}
              >
                {t.direction === 'LONG' ? '롱' : '숏'}
              </td>
              <td style={tdStyle}>{t.qty}</td>
              <td style={tdStyle}>{t.entryPrice.toFixed(2)}</td>
              <td style={tdStyle}>{t.open ? '-' : t.exitPrice.toFixed(2)}</td>
              <td style={tdStyle}>{new Date(t.entryTime).toLocaleString()}</td>
              <td style={tdStyle}>
                {t.open ? (
                  <span style={{ color: '#999' }}>미청산</span>
                ) : (
                  new Date(t.exitTime).toLocaleString()
                )}
              </td>
              <td style={tdStyle}>{t.open ? '-' : fmtHold(t.holdMs)}</td>
              <td style={{ ...tdStyle, color: pnlColor(t.netPnl) }}>
                {t.open ? '-' : fmtPnl(t.netPnl)}
              </td>
              <td style={{ ...tdStyle, color: pnlColor(t.netPnl) }}>
                {t.open ? '-' : `${fmtPnl(t.pnlPct)}%`}
              </td>
              <td style={tdStyle}>{t.fillCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager
        page={tradePage.page}
        pageCount={tradePage.pageCount}
        onChange={tradePage.setPage}
      />

      <h2 style={{ marginTop: 24 }}>체결 내역 ({trades.length})</h2>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
        최신 체결이 위에 옵니다. 한 페이지에 {FILLS_PER_PAGE}건씩 보여줍니다.
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            {['시각', '심볼', '방향', '가격', '수량'].map((h) => (
              <th key={h} style={thStyle}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fillPage.pageItems.map((t) => (
            <tr key={t.id}>
              <td style={tdStyle}>{new Date(t.time).toLocaleString()}</td>
              <td style={tdStyle}>{t.symbol}</td>
              <td
                style={{
                  ...tdStyle,
                  color: t.side === 'BUY' ? '#2196f3' : '#e91e63',
                }}
              >
                {t.side === 'BUY' ? '매수' : '매도'}
              </td>
              <td style={tdStyle}>{t.price}</td>
              <td style={tdStyle}>{t.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager
        page={fillPage.page}
        pageCount={fillPage.pageCount}
        onChange={fillPage.setPage}
      />
    </div>
  )
}

export default App
