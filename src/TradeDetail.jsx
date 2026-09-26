// 오른쪽 패널: 고른 트레이드의 상세 + 복기 메모(메모/태그/감정) 입력.
//
// 메모 저장은 tradeNotes.js 가 한다. 이 컴포넌트는 "어디에 저장되는지" 모른다.
// App 이 `key={trade.id}` 로 넘기므로 트레이드를 바꾸면 이 컴포넌트가 새로 만들어
// 진다 = 그 트레이드의 저장값으로 다시 시작한다. 그래서 trade 가 바뀌는 경우를
// 따로 처리하지 않는다.

import { useEffect, useRef, useState } from 'react'
import { EMOTIONS, TAG_PRESETS, loadTradeNote, saveTradeNote } from './tradeNotes'
import { fmtHold, fmtPnl, pnlColor } from './format'

// 메모는 타이핑이 멈춘 뒤에 저장한다. 매 글자마다 localStorage 를 쓰지 않으려고.
const SAVE_DELAY = 500 // ms

// 상세 표의 한 줄.
function Row({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

export default function TradeDetail({ trade }) {
  const [entry, setEntry] = useState(() => loadTradeNote(trade.id))
  const [tagInput, setTagInput] = useState('')

  const timerRef = useRef(null)
  const pendingRef = useRef(null) // 아직 저장 안 된 값 (없으면 null)

  // 예약된 저장을 지금 실행한다. updateState=false 면 화면 갱신은 건너뛴다
  // (언마운트 중에는 상태를 바꿀 수 없으므로).
  const flush = (updateState) => {
    clearTimeout(timerRef.current)
    const next = pendingRef.current
    if (!next) return
    pendingRef.current = null
    const saved = saveTradeNote(trade.id, next)
    if (updateState) setEntry(saved)
  }

  // 아래 이펙트가 항상 최신 flush 를 부르도록 ref 로 들고 있는다.
  const flushRef = useRef(flush)
  flushRef.current = flush

  // 다른 트레이드로 옮기거나 탭을 닫을 때, 예약만 된 메모를 잃지 않도록 먼저 쓴다.
  useEffect(() => {
    const onLeave = () => flushRef.current(false)
    window.addEventListener('pagehide', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      onLeave()
    }
  }, [])

  // 값 변경 한 곳. immediate=true 면 기다리지 않고 바로 저장한다.
  const update = (patch, immediate = false) => {
    const next = { ...entry, ...patch }
    setEntry(next)
    pendingRef.current = next
    clearTimeout(timerRef.current)
    if (immediate) flush(true)
    else timerRef.current = setTimeout(() => flush(true), SAVE_DELAY)
  }

  const addTag = (raw) => {
    const tag = raw.trim()
    setTagInput('')
    if (!tag || entry.tags.includes(tag)) return // 빈 값/중복은 그냥 무시
    update({ tags: [...entry.tags, tag] }, true)
  }

  const removeTag = (tag) =>
    update({ tags: entry.tags.filter((t) => t !== tag) }, true)

  // 같은 감정을 다시 누르면 선택 해제.
  const toggleEmotion = (emotion) =>
    update({ emotion: entry.emotion === emotion ? null : emotion }, true)

  const long = trade.direction === 'LONG'

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>{trade.symbol}</strong>
        <span style={{ color: long ? 'var(--up)' : 'var(--down)' }}>
          {long ? '롱' : '숏'}
        </span>
        {trade.open && <span className="faint">미청산</span>}
      </div>

      <div className="panel-pnl" style={{ color: pnlColor(trade.netPnl) }}>
        {trade.open ? '—' : `${fmtPnl(trade.netPnl)} USDT`}
        {!trade.open && (
          <span className="panel-pnl-pct">{fmtPnl(trade.pnlPct)}%</span>
        )}
      </div>

      <dl className="detail-list">
        <Row label="수량">{trade.qty}</Row>
        <Row label="진입가">{trade.entryPrice.toFixed(2)}</Row>
        <Row label="청산가">{trade.open ? '—' : trade.exitPrice.toFixed(2)}</Row>
        <Row label="진입 시각">{new Date(trade.entryTime).toLocaleString()}</Row>
        <Row label="청산 시각">
          {trade.open ? '—' : new Date(trade.exitTime).toLocaleString()}
        </Row>
        <Row label="보유">{trade.open ? '—' : fmtHold(trade.holdMs)}</Row>
        <Row label="손익(수수료 전)">
          {trade.open ? '—' : fmtPnl(trade.grossPnl)}
        </Row>
        <Row label="수수료">{trade.fee.toFixed(4)}</Row>
        <Row label="체결수">{trade.fillCount}</Row>
      </dl>

      <h3 className="panel-title">복기 메모</h3>

      <div className="field">
        <div className="field-label">감정</div>
        <div className="chip-row">
          {EMOTIONS.map((e) => (
            <button
              key={e}
              className={`chip${entry.emotion === e ? ' is-on' : ''}`}
              onClick={() => toggleEmotion(e)}
              title="다시 누르면 선택 해제"
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label">태그</div>
        {entry.tags.length > 0 && (
          <div className="chip-row">
            {entry.tags.map((tag) => (
              <span key={tag} className="chip is-on">
                {tag}
                <button
                  className="chip-x"
                  onClick={() => removeTag(tag)}
                  title={`${tag} 삭제`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className="tag-input"
          onSubmit={(e) => {
            e.preventDefault() // 엔터로 추가. 페이지가 새로고침되지 않게.
            addTag(tagInput)
          }}
        >
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="태그 입력 후 Enter"
          />
          <button type="submit" disabled={!tagInput.trim()}>
            추가
          </button>
        </form>
        {/* 자주 쓰는 태그는 버튼 한 번으로. 이미 붙은 것은 비활성. */}
        <div className="chip-row">
          {TAG_PRESETS.map((tag) => (
            <button
              key={tag}
              className="chip chip-preset"
              onClick={() => addTag(tag)}
              disabled={entry.tags.includes(tag)}
            >
              + {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label">메모</div>
        <textarea
          rows={6}
          value={entry.note}
          onChange={(e) => update({ note: e.target.value })}
          placeholder="왜 들어갔고, 무엇을 봤고, 다음에 뭘 바꿀지"
        />
      </div>

      <div className="faint">
        {entry.updatedAt
          ? `이 브라우저에 저장됨 · ${new Date(entry.updatedAt).toLocaleString()}`
          : '아직 저장된 메모가 없습니다. (입력하면 자동 저장)'}
      </div>
    </div>
  )
}
