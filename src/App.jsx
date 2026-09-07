import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'

function App() {
  const containerRef = useRef(null)

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
        series.setData(candles)
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

  return (
    <div style={{ padding: 16 }}>
      <h1>Trading Assist</h1>
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  )
}

export default App
