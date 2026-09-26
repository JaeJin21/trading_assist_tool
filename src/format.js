// 표시용 숫자/시간 포맷. 트레이드 목록과 상세 패널이 같은 모양으로 쓰도록
// 한곳에 모아 둔다. (거래소/UI 컴포넌트를 모르는 순수 함수들)

// 손익 색: 이익은 파랑, 손실은 빨강, 0 은 기본색. (프로젝트 색 규칙)
export const pnlColor = (v) =>
  v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text)'

// 부호를 항상 붙여서 표시. (+12.34 / -5.60)
export const fmtPnl = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`

// 보유 시간(ms) -> "2h 30m" 형태.
export function fmtHold(ms) {
  const min = Math.round(ms / 60000)
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`
}

// 좁은 목록에 들어갈 짧은 시각. "09-25 14:03" (연도는 생략)
export function fmtShort(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
