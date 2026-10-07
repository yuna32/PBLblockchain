# 회귀 검증 (scripts/regression)

분석기·reasoner·평가 스크립트를 고치지 않고, 사본 트리에서 결과를 다시 만들어 기준선과 비교한다.
설계: `~/pbl_backup/regression_design/PROPOSAL.md`, 근거 조사: 같은 폴더 `FINDINGS.md` (저장소 밖 보관본).

## 파일

| 경로 | 내용 |
|---|---|
| `regress.sh` | 진입점. 사본 트리 준비 → 수집 → 비교 → 종료 코드 |
| `regress_collect.mjs` | 사본 트리의 메인·중첩 `runPrevention`을 `contracts/*.sol` 전부에 대해 호출 (사본 트리 모듈만 import) |
| `regress_compare.mjs` | 정규화, 비교, 허용 목록 적용, `summary.md`, 기준선 갱신(confirm) |
| `expected_changes.json` | 의도된 차이 허용 목록 (기준선 하나에 묶임) |
| `../../evaluation/regression_baseline/` | 기준선: `baselines/<baseline_id>/`(정규화 파일, `MANIFEST.json`, `SHA256SUMS`)와 `CURRENT` |

- 이 폴더에는 `package.json`을 두지 않는다. 저장소 루트 `package.json`의 `"type": "module"`이 적용된다.
- 실행 산출물은 `~/pbl_backup/regression_runs/<UTC시각>_<sha7>/`에 쓴다(`tree/`, `out/raw`, `out/norm`, `out/baseline_norm`, `out/smoke`, `logs/`, `summary.md`, `result.json`, `run_manifest.json`). 저장소에는 쓰지 않는다(기준선 갱신 확정 때의 `evaluation/regression_baseline/`만 예외).

## 사용법

```
bash scripts/regression/regress.sh                      # HEAD (git -c core.autocrlf=false archive)
bash scripts/regression/regress.sh --rev <commit>
bash scripts/regression/regress.sh --working-tree       # git ls-files -co --exclude-standard 중 실제 파일, dirty·diff stat 기록
bash scripts/regression/regress.sh --tree <dir>         # 준비된 사본 트리 (자체 검증용, 갱신 불가)

# 기준선 갱신: 미리보기 → 확정 (자동 갱신 경로 없음)
bash scripts/regression/regress.sh --update-baseline --reason "<사유>"
bash scripts/regression/regress.sh --update-baseline --reason "<같은 사유>" --confirm <미리보기 run id>
```

옵션 `--baseline-root`, `--expected`, `--runs-root`로 기준선·허용 목록·산출물 위치를 바꿀 수 있다(자체 검증용).

## 비교 대상

1. 메인(`analysis/prevention_reasoner.js`)·중첩(`analysis/analysis/prevention_reasoner.js`) `runPrevention` JSON, 컨트랙트별.
   컨트랙트는 사본 트리의 `contracts/*.sol`을 자동 탐색한다. 기준선에 없으면 NEW, 기준선에만 있으면 MISSING(둘 다 실패).
2. N=272 생성 4파일: `ontology_predictions.csv`, `disagreement_cases.csv`, `comparison_report.md`, `mcnemar_report.md`.
   사본 트리 안에서 `EXCLUDE_ADDRESSES="" node evaluate_comparison.js && node mcnemar_test.js`로 만든다. CSV는 `address` 행 키로 셀 단위 비교.
3. `response_reasoner` 스모크: 사본 트리의 `evaluation/response_reasoner/response_reasoner.js`를 `--old`=`--new`=사본 트리로 실행
   (이번 실행의 `ontology_predictions.csv`로 자체검사 포함). 통과 조건은 exit 0과 "예측 변경 0개".
   이 exit 0 통과는 스모크 용도일 뿐이며, response_reasoner 단독 사용 시 exit 1은 "변경 있음"을 뜻하는 정보성 결과다.
   스크립트가 없는 과거 커밋(`--rev`)은 SKIP, 그 밖에 스크립트가 없으면 MISSING.
4. 발동 규칙 `rules/triggered_rules.csv`: 스모크가 만든 `<run>/out/smoke/new.jsonl`에서 `address`와
   `triggered_rules[{id, weight, weight_max, fraction}]`만 뽑은 주소별 wide CSV(행 키 address, 열 = 발동한 규칙 id 사전순,
   셀 `weight/weight_max/fraction`, 미발동은 빈 셀). 문자열 정확 일치로 셀 단위 비교한다(float 허용 오차 없음).
   한쪽에 열이 없고 다른 쪽 셀이 비어 있으면 같은 것으로 본다(새 규칙 열은 실제로 발동한 셀만 `<absent>` → 값으로 나온다).
   - 스모크 SKIP → rules SKIP. 스모크 DIFF(자체검사 실패 포함) → new.jsonl을 신뢰할 수 없어 비교하지 않고 rules DIFF(실패).
     스모크 MISSING → 기준선에 rules가 있으면 MISSING.
   - summary "발동 규칙" 절: 같은 address의 `ontology_predictions.csv` 셀 차이가 있으면 `[예측 동반]`, 없으면 `[규칙만]`(표시용, 판정과 무관).
     상세는 앞쪽 50셀까지 보이고 총 셀·주소 수는 항상 적는다. 허용·종료 코드 판정은 전체 셀 기준.

정규화: CR 제거, 파일 끝 개행 하나로 통일, md의 `> 생성:` 줄 제외, 사본 트리 절대경로 → `<TREE>`.
N=272 변화에는 `[논문표1]`(ontology_predictions.csv, comparison_report.md), `[논문 McNemar]`(disagreement_cases.csv, mcnemar_report.md) 태그를 붙인다.

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 통과: 차이 없음, 또는 모든 차이가 허용 목록과 정확히 일치. 미리보기·갱신 확정 성공 |
| 1 | 허용되지 않은 차이, 허용 목록 미사용 항목, NEW/MISSING, 스모크 DIFF/MISSING |
| 2 | 실행 오류: 기준선 없음, `--reason` 누락, 사본 준비 실패, 허용 목록 형식 오류, 기준선 무결성 오류, 갱신 거부 |

summary 상태값: `PASS` / `ALLOWED (n)` / `DIFF` / `NEW` / `MISSING` / `SKIP`.

## 허용 목록 (`expected_changes.json`)

```json
{
  "baseline_id": "<CURRENT의 기준선 id>",
  "entries": [
    { "target": "prevention/main/Honeypot.json", "path": "$.risk_level", "from": "HIGH", "to": "CRITICAL",
      "commit": "<커밋>", "reason": "<사유>" },
    { "target": "n272/ontology_predictions.csv", "key": "0x…", "column": "dynamic_exact_pred", "from": "0", "to": "1",
      "commit": "<커밋>", "reason": "<사유>" },
    { "target": "n272/comparison_report.md", "path": "line", "from": "<이전 줄>", "to": "<새 줄>",
      "commit": "<커밋>", "reason": "<사유>" },
    { "target": "rules/triggered_rules.csv", "key": "0x…", "column": "CONCENTRATION_DRAIN", "from": "23/35/0.67", "to": "24/35/0.67",
      "commit": "<커밋>", "reason": "<사유>" }
  ]
}
```

- `target`, `from`, `to`, `commit`, `reason`은 필수이며 빈 값이면 코드 2. 빈 문자열 값은 `"<empty>"`, 없음은 `"<absent>"`로 적는다.
- JSON 대상은 `path`(`$.a.b[0]` 형식), CSV는 `key`(address)와 `column`(행 추가·삭제는 `"<row>"`), md는 `"path": "line"`.
- 와일드카드 `*`는 `target`의 prevention 파일명에만 쓸 수 있다.
- 매치되지 않은 항목은 실패(코드 1). `entries`가 비어 있지 않은데 `baseline_id`가 현재 기준선과 다르면 코드 2.
- 기준선을 갱신해도 허용 목록은 자동으로 비우지 않는다. 사람이 비운다.

**운영 원칙 (발동 규칙):** 임계값·가중치 조정처럼 의도된 대규모 규칙 변경은 수십~수백 셀이 함께 바뀌므로
`expected_changes.json` 항목으로 적지 않는다. 변경을 커밋한 뒤 `--update-baseline` 미리보기로 diff 전체를 확인하고
`--confirm`으로 기준선을 갱신해 처리한다. 허용 목록은 몇 개 셀의 국소적 변화에만 쓴다.

## 기준선 갱신 규칙

1. `--update-baseline --reason`으로 비교를 실행하고, 기준선과의 diff 전체를 출력하며 `<run>/update_preview.diff`에 저장한다.
2. `--confirm <run id>`로만 실제 갱신한다. 사유는 미리보기와 같아야 하고, 미리보기 이후 CURRENT나 정규화 출력이 바뀌었으면 거부한다.
3. `--working-tree`이면서 dirty, `--tree`, 허용 목록 미사용 항목이 남은 경우, 스모크가 PASS가 아닌 경우(SKIP·DIFF·MISSING —
   발동 규칙을 기준선에 넣을 수 없음)는 거부(코드 2).
4. 새 기준선은 `baselines/<미리보기 run id>/`에 추가하고 `CURRENT`만 바꾼다. 이전 기준선 디렉터리는 남는다.
5. `SHA256SUMS`는 CR 제거 후 내용의 해시다(작업트리 CRLF 체크아웃에도 견딤). 매 실행마다 검증하고 불일치면 코드 2.

## 하지 않는 것

pipeline 리포트 등급 층, `analyzeDynamic` 중간값 수집, 논문 docx 대조·추출, v3 md 재생성.

## 주석

- `mcnemar_report.md`의 "일치" 열은 `mcnemar_test.js:124-126`의 TARGETS가 v1 값으로 고정되어 항상 ❌다.
- node 버전이 기준선 MANIFEST와 다르면 경고만 한다(실패 아님).
