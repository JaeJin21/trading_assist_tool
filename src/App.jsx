import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
} from 'lightweight-charts'

const INITIAL_COUNT = 20
const BASE_INTERVAL = 500 // ms per candle at 1x speed
const SPEEDS = [0.5, 1, 2, 5]

function App() {
  const containerRef = useRef(null)
  const seriesRef = useRef(null)
  const candlesRef = useRef([]) // all fetched candles
  const cursorRef = useRef(0) // number of candles currently drawn
  const [cursor, setCursor] = useState(0)
  const [total, setTotal] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

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

    const series = chart.addSeries(CandlestickSeries)
    seriesRef.current = series

    // Fetch BTCUSDT 1h candles from Binance public (no-auth) endpoint.
    const controller = new AbortController()
    fetch(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100',
      { signal: controller.signal }
    )
      .then((res) => res.json())
      .then((klines) => {
        // Binance kline: [openTime, open, high, low, close, volume, ...]
        const candles = klines.map((k) => ({
          time: k[0] / 1000, // ms -> seconds (UTCTimestamp)
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
        }))
        candlesRef.current = candles
        // Draw only the first INITIAL_COUNT candles to start the replay.
        const initial = candles.slice(0, INITIAL_COUNT)
        series.setData(initial)
        cursorRef.current = initial.length
        setCursor(initial.length)
        setTotal(candles.length)

        // Hardcoded entry/exit markers on two of the first candles.
        // (Real trade data will be wired up later.)
        createSeriesMarkers(series, [
          {
            time: candles[5].time,
            position: 'belowBar',
            color: '#2196f3',
            shape: 'arrowUp',
            text: '진입',
          },
          {
            time: candles[12].time,
            position: 'aboveBar',
            color: '#e91e63',
            shape: 'arrowDown',
            text: '청산',
          },
        ])

        chart.timeScale().fitContent()
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Failed to load klines:', err)
      })

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      controller.abort()
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

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
      if (!advanced) setPlaying(false) // reached the end -> stop
    }, BASE_INTERVAL / speed)
    return () => clearInterval(id)
  }, [playing, speed])

  const hasMore = cursor < total

  return (
    <div style={{ padding: 16 }}>
      <h1>Trading Assist</h1>
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
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  )
}

export default App
