#!/bin/bash
# regress.sh — 회귀 검증 진입점
#
# 사본 트리를 만들고(저장소 추적 파일에는 쓰지 않음), 그 안에서
#   (1) 메인·중첩 runPrevention (contracts/*.sol 자동 탐색)
#   (2) N=272 생성 4파일 (evaluate_comparison.js + mcnemar_test.js, EXCLUDE_ADDRESSES="")
#   (3) response_reasoner 스모크 (--old=--new=사본 트리)
# 를 실행한 뒤 기준선(evaluation/regression_baseline)과 비교한다.
# 근거: ~/pbl_backup/regression_design/PROPOSAL.md, FINDINGS.md
set -euo pipefail

usage() {
  cat <<'EOF'
사용법:
  bash scripts/regression/regress.sh                      HEAD를 git archive로 풀어 현재 기준선과 비교
  bash scripts/regression/regress.sh --rev <commit>       특정 커밋
  bash scripts/regression/regress.sh --working-tree       작업트리(git ls-files -co --exclude-standard 중 실제 파일)
  bash scripts/regression/regress.sh --tree <dir>         이미 준비된 사본 트리(자체 검증용, 기준선 갱신 불가)

  기준선 갱신 (자동 갱신 없음):
  bash scripts/regression/regress.sh --update-baseline --reason "<사유>"                  미리보기 실행
  bash scripts/regression/regress.sh --update-baseline --reason "<사유>" --confirm <run_id>  미리보기 결과로 갱신

기타 옵션:
  --baseline-root <dir>   기준선 루트 (기본: <repo>/evaluation/regression_baseline)
  --expected <file>       허용 목록 (기본: scripts/regression/expected_changes.json)
  --runs-root <dir>       실행 산출물 루트 (기본: ~/pbl_backup/regression_runs)

종료 코드:
  0  통과 (차이 없음, 또는 모든 차이가 허용 목록과 정확히 일치) / 미리보기·갱신 성공
  1  허용되지 않은 차이, 허용 목록 미사용 항목, NEW/MISSING, 스모크 실패
  2  실행 오류 (기준선 없음, --reason 누락, 사본 준비 실패, 허용 목록 형식 오류, 갱신 거부 등)
EOF
}

die() { echo "[regress] 오류: $*" >&2; exit 2; }
trap 'echo "[regress] 실행 오류 (줄 $LINENO)" >&2; exit 2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

MODE=archive; REV=HEAD; TREE_SRC=""; UPDATE=0; REASON=""; REASON_SET=0; CONFIRM=""
BASELINE_ROOT="$REPO/evaluation/regression_baseline"
EXPECTED="$SCRIPT_DIR/expected_changes.json"
RUNS_ROOT="$HOME/pbl_backup/regression_runs"
mode_set=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --rev) [ $# -ge 2 ] || die "--rev 값 없음"; REV="$2"; MODE=archive; mode_set=$((mode_set+1)); shift 2 ;;
    --working-tree) MODE=working-tree; mode_set=$((mode_set+1)); shift ;;
    --tree) [ $# -ge 2 ] || die "--tree 값 없음"; TREE_SRC="$2"; MODE=tree; mode_set=$((mode_set+1)); shift 2 ;;
    --update-baseline) UPDATE=1; shift ;;
    --reason) [ $# -ge 2 ] || die "--reason 값 없음"; REASON="$2"; REASON_SET=1; shift 2 ;;
    --confirm) [ $# -ge 2 ] || die "--confirm 값 없음"; CONFIRM="$2"; shift 2 ;;
    --baseline-root) [ $# -ge 2 ] || die "--baseline-root 값 없음"; BASELINE_ROOT="$2"; shift 2 ;;
    --expected) [ $# -ge 2 ] || die "--expected 값 없음"; EXPECTED="$2"; shift 2 ;;
    --runs-root) [ $# -ge 2 ] || die "--runs-root 값 없음"; RUNS_ROOT="$2"; shift 2 ;;
    *) usage >&2; die "알 수 없는 인자: $1" ;;
  esac
done

[ "$mode_set" -le 1 ] || die "--rev / --working-tree / --tree 는 하나만"
[ "$UPDATE" = 1 ] || [ "$REASON_SET" = 0 ] || die "--reason 은 --update-baseline 과 함께만"
[ "$UPDATE" = 1 ] || [ -z "$CONFIRM" ] || die "--confirm 은 --update-baseline 과 함께만"
if [ "$UPDATE" = 1 ] && [ -z "$REASON" ]; then die "--update-baseline 에는 --reason 필수"; fi
command -v node > /dev/null || die "node 없음"

# ── 갱신 확정: 새로 실행하지 않고 미리보기 결과로 기준선을 쓴다 ──
if [ -n "$CONFIRM" ]; then
  [ "$mode_set" = 0 ] || die "--confirm 에는 --rev/--working-tree/--tree 를 쓰지 않는다 (미리보기 때 정해짐)"
  rc=0
  node "$SCRIPT_DIR/regress_compare.mjs" confirm --runs-root "$RUNS_ROOT" --confirm "$CONFIRM" \
    --baseline-root "$BASELINE_ROOT" --reason "$REASON" || rc=$?
  exit "$rc"
fi

if [ "$UPDATE" = 0 ] && [ ! -f "$BASELINE_ROOT/CURRENT" ]; then
  die "기준선 없음 ($BASELINE_ROOT/CURRENT). 처음이면 --update-baseline --reason 으로 만든다"
fi

# ── 사본 트리 준비 ──
cd "$REPO"
case "$MODE" in
  archive)
    SRC_REV="$(git rev-parse --verify --quiet "${REV}^{commit}")" || die "rev 해석 실패: $REV"
    ;;
  working-tree|tree)
    SRC_REV="$(git rev-parse HEAD)"
    ;;
esac
if [ -n "$(git status --porcelain)" ]; then DIRTY=true; else DIRTY=false; fi
[ "$MODE" = tree ] && DIRTY=unknown
if [ "$UPDATE" = 1 ] && [ "$MODE" = working-tree ] && [ "$DIRTY" = true ]; then
  die "source_mode=working-tree 이면서 dirty — 기준선 갱신 거부 (git status --porcelain 비어 있지 않음)"
fi
if [ "$UPDATE" = 1 ] && [ "$MODE" = tree ]; then die "--tree 사본은 기준선으로 삼지 않는다 — 갱신 거부"; fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
if [ "$MODE" = tree ]; then SUFFIX=tree; else SUFFIX="${SRC_REV:0:7}"; fi
RUN_ID="${TS}_${SUFFIX}"; n=1
mkdir -p "$RUNS_ROOT"
while [ -e "$RUNS_ROOT/$RUN_ID" ]; do n=$((n+1)); RUN_ID="${TS}_${SUFFIX}_$n"; done
RUN="$RUNS_ROOT/$RUN_ID"
mkdir -p "$RUN/tree" "$RUN/logs" "$RUN/out/raw/n272" "$RUN/out/raw/prevention"
echo "[regress] run=$RUN_ID mode=$MODE rev=${SRC_REV:0:7}"

DIFF_STAT_FILE="$RUN/git_diff_stat.txt"; : > "$DIFF_STAT_FILE"
case "$MODE" in
  archive)
    git -c core.autocrlf=false archive "$SRC_REV" | tar -x -C "$RUN/tree" || die "사본 준비 실패 (git archive)"
    ;;
  working-tree)
    git ls-files -co --exclude-standard -z | while IFS= read -r -d '' f; do
      if [ -f "$f" ]; then printf '%s\0' "$f"; fi
    done > "$RUN/logs/filelist.z"
    tar --null -T "$RUN/logs/filelist.z" -cf - | tar -x -C "$RUN/tree" || die "사본 준비 실패 (작업트리 복사)"
    { echo "# git diff --stat (unstaged)"; git diff --stat; echo "# git diff --cached --stat"; git diff --cached --stat;
      echo "# untracked (exclude-standard)"; git ls-files -o --exclude-standard; } > "$DIFF_STAT_FILE"
    ;;
  tree)
    [ -d "$TREE_SRC" ] || die "--tree 디렉터리 없음: $TREE_SRC"
    cp -a "$TREE_SRC/." "$RUN/tree/" || die "사본 준비 실패 (--tree 복사)"
    ;;
esac
TREE="$(cd "$RUN/tree" && pwd -P)"
[ -d "$TREE/evaluation/ponzi_comparison" ] || die "사본 트리에 evaluation/ponzi_comparison 없음"

# ── (1) runPrevention: 사본 트리의 모듈만 import ──
for w in main nested; do
  node "$SCRIPT_DIR/regress_collect.mjs" "$TREE" "$w" "$RUN/out/raw/prevention/$w" \
    > "$RUN/logs/prevention_$w.log" 2> "$RUN/logs/prevention_$w.err" || die "runPrevention 수집 실패 ($w) — logs/prevention_$w.err"
done

# ── (2) N=272: 사본 트리 안에서 CLI 실행 ──
(
  cd "$TREE/evaluation/ponzi_comparison"
  EXCLUDE_ADDRESSES="" node evaluate_comparison.js > "$RUN/logs/evaluate.log" 2>&1
  node mcnemar_test.js > "$RUN/logs/mcnemar.log" 2>&1
) || die "N=272 실행 실패 — logs/evaluate.log, logs/mcnemar.log"
for f in ontology_predictions.csv disagreement_cases.csv comparison_report.md mcnemar_report.md; do
  cp -p "$TREE/evaluation/ponzi_comparison/results/$f" "$RUN/out/raw/n272/$f"
done

# ── (3) response_reasoner 스모크: 출력은 <run>/out/ 아래에만 ──
SMOKE_REL=evaluation/response_reasoner/response_reasoner.js
SMOKE_STATE=present; SMOKE_EXIT=""; SMOKE_STDOUT="$RUN/logs/smoke.stdout"
if [ ! -f "$TREE/$SMOKE_REL" ]; then
  if [ "$MODE" = archive ] && ! git cat-file -e "$SRC_REV:$SMOKE_REL" 2> /dev/null; then
    SMOKE_STATE=absent_in_rev
  else
    SMOKE_STATE=absent
  fi
else
  SMOKE_EXIT=0
  ( cd "$TREE/evaluation/response_reasoner" && node response_reasoner.js \
      --old "$TREE" --new "$TREE" \
      --old-pred "$RUN/out/raw/n272/ontology_predictions.csv" --new-pred "$RUN/out/raw/n272/ontology_predictions.csv" \
      --old-label tree --new-label tree --out "$RUN/out/smoke" ) > "$SMOKE_STDOUT" 2> "$RUN/logs/smoke.stderr" || SMOKE_EXIT=$?
fi

# ── 비교 ──
rc=0
PREVIEW_ARGS=()
if [ "$UPDATE" = 1 ]; then PREVIEW_ARGS=(--preview --reason "$REASON"); fi
RG_RUN_ID="$RUN_ID" RG_SOURCE_REV="$SRC_REV" RG_SOURCE_MODE="$MODE" RG_DIRTY="$DIRTY" \
RG_DIFF_STAT_FILE="$DIFF_STAT_FILE" RG_EXCLUDE="" \
RG_SMOKE_STATE="$SMOKE_STATE" RG_SMOKE_EXIT="$SMOKE_EXIT" RG_SMOKE_STDOUT="$SMOKE_STDOUT" \
  node "$SCRIPT_DIR/regress_compare.mjs" compare --run "$RUN" --tree "$TREE" \
    --baseline-root "$BASELINE_ROOT" --expected "$EXPECTED" "${PREVIEW_ARGS[@]}" || rc=$?

if [ "$UPDATE" = 1 ] && [ "$rc" = 0 ]; then
  diff -ruN "$RUN/out/baseline_norm" "$RUN/out/norm" --exclude=smoke.json \
    | sed -e "s#$RUN/out/baseline_norm#a#g" -e "s#$RUN/out/norm#b#g" \
          -e 's#^\(---\|+++\) \([^\t]*\)\t.*#\1 \2#' > "$RUN/update_preview.diff" || true
  echo
  echo "================ 기준선 갱신 미리보기: diff 전체 (update_preview.diff) ================"
  cat "$RUN/update_preview.diff"
  echo "================ 끝 ($(grep -c '' "$RUN/update_preview.diff") 줄) ================"
  echo "적용하려면: bash scripts/regression/regress.sh --update-baseline --reason \"<같은 사유>\" --confirm $RUN_ID"
fi
echo "[regress] run 디렉터리: $RUN  (summary.md)"
exit "$rc"
