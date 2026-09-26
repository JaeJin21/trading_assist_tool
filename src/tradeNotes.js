// 트레이드별 복기 메모(메모 / 태그 / 감정)를 브라우저에 저장한다.
//
// 저장 위치는 localStorage 한 칸이고, 그 안에 { [트레이드 id]: 메모 } 로 모아 둔다.
// UI 는 이 파일의 load/save 만 부르므로, 나중에 서버 저장으로 옮길 때 여기만
// 바꾸면 된다. (그때는 같은 함수 이름으로 fetch 를 쓰면 된다)
//
// 키로 쓰는 트레이드 id 는 pairTrades 가 만드는 `{심볼}-{첫 체결 id}` 다.
// 같은 체결 내역을 다시 불러와도 같은 id 가 나오므로 메모가 그대로 붙는다.
// 목데이터도 체결 id 가 900000 부터 고정이라 새로고침해도 메모가 유지된다.

const KEY = 'trading-assist-notes'

// 감정은 자유 입력이 아니라 고르는 것이라 목록을 고정한다. (버튼 순서 그대로)
export const EMOTIONS = ['평온', '불안', '욕심', '공포', '확신']

// 태그는 자유 입력이지만, 자주 쓰는 것은 버튼 한 번으로 넣도록 프리셋을 둔다.
export const TAG_PRESETS = ['뇌동매매', '계획대로', '물타기', '손절지연', '추격매수']

// 메모가 아직 없는 트레이드의 빈 값. 배열을 공유하지 않도록 함수로 만든다.
export const emptyNote = () => ({
  note: '',
  tags: [],
  emotion: null,
  updatedAt: null,
})

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // 배열이나 null 이 들어 있으면 쓸 수 없으니 빈 것으로 취급한다.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    // 저장값이 깨졌거나 브라우저가 localStorage 를 막은 경우.
    // 메모가 없는 것처럼 동작하게 두고, 원인은 콘솔에만 남긴다.
    console.warn('복기 메모를 읽지 못했습니다. 저장된 값을 무시합니다.', err)
    return {}
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
    return true
  } catch (err) {
    // 용량 초과(QuotaExceeded)나 시크릿 모드 차단.
    console.warn('복기 메모를 저장하지 못했습니다.', err)
    return false
  }
}

// 저장된 값이 어떤 모양이든 UI 가 기대하는 모양으로 맞춰서 준다.
// (예전 버전이 남긴 값이나 손으로 고친 값이 들어와도 화면이 깨지지 않게)
function normalize(entry) {
  return {
    note: typeof entry?.note === 'string' ? entry.note : '',
    tags: Array.isArray(entry?.tags)
      ? entry.tags.filter((t) => typeof t === 'string' && t !== '')
      : [],
    emotion: EMOTIONS.includes(entry?.emotion) ? entry.emotion : null,
    updatedAt: typeof entry?.updatedAt === 'number' ? entry.updatedAt : null,
  }
}

// 트레이드 한 건의 메모. 없으면 빈 값.
export function loadTradeNote(tradeId) {
  return normalize(readAll()[tradeId])
}

// 저장하고, 실제로 저장된 값(updatedAt 이 채워진)을 돌려준다.
// 세 칸이 모두 비면 저장하지 않고 지운다. 빈 메모가 쌓이지 않게.
export function saveTradeNote(tradeId, entry) {
  const clean = normalize(entry)
  const empty = !clean.note.trim() && clean.tags.length === 0 && !clean.emotion

  const all = readAll()
  if (empty) {
    delete all[tradeId]
    writeAll(all)
    return { ...clean, updatedAt: null }
  }

  const saved = { ...clean, updatedAt: Date.now() }
  all[tradeId] = saved
  writeAll(all)
  return saved
}
