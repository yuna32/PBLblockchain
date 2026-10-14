# response_candidates — 원인 후보 분류 리포트

response_reasoner의 버전 간 비교 결과에서 변경·불일치 주소마다 **"왜 이렇게 됐을 수 있는지"의 후보**와 근거 수치를 낸다. 수동 7단계 중 ④의 앞부분(원인 후보 정리)을 반자동화한다.
- 설계: `~/pbl_backup/response_candidates_design/PROPOSAL.md` (저장소 밖 보관본)
- 조사 산출물: 같은 폴더의 `probe/`, `trees/v2syn/`, `runs/`

**이 도구는 후보만 낸다.**
- 규칙·코드·데이터 수정을 제안하거나 적용하지 않는다. 승인 단계를 대신하지도 않는다.
- 후보는 원인 판정이 아니다.

## 파일

| 경로 | 내용 |
|---|---|
| `response_candidates.js` | 본체 (node 직접 실행, ESM). 저장소로 옮길 때는 같은 내용으로 `.js` 이름을 쓴다(루트 `package.json`의 `"type": "module"`) |
| `README_candidates.md` | 이 문서 |

- 이 폴더에는 `package.json`을 두지 않는다. 저장소에서는 `.js`(루트 `package.json`의 `"type": "module"`)로 실행하고, 저장소 밖 보관본은 `.mjs` 이름이다.
- 검증 스크립트와 결과(`verify/`)는 저장소 밖에서만 관리한다.

## 사용법

```
# 1) response_reasoner로 두 트리를 비교한다 (기존 도구, 변경 없음)
node response_reasoner.js --old <old 트리> --new <new 트리> [--old-pred … --new-pred …] --out <run 디렉터리>

# 2) 그 run과 같은 두 트리로 후보 리포트를 만든다
node response_candidates.js --run <run 디렉터리> --old <old 트리> --new <new 트리> --out <출력 디렉터리> [--near 0.05] [--level F|R]
```

| 인자 | 뜻 |
|---|---|
| `--run` | response_reasoner의 `--out`. `changed.csv`, `disagreement_delta.csv`, `old.jsonl`, `new.jsonl`, `summary.md`를 읽기만 한다 |
| `--old`, `--new` | run을 만들 때 쓴 같은 트리. `summary.md` 1절의 모듈 sha256(앞 16자)과 다르면 코드 2 |
| `--out` | 없거나 비어 있어야 한다. 상위 경로에 `.git`이 있거나, 입력 트리·`--run` 안이면 거부(코드 2) |
| `--near` | C3 경계 근접 폭. 기본 0.05이며 **근거 없는 잠정값**이다 |
| `--level` | F(기본): 트리마다 analyzeDynamic 재실행 + 특징값 재계산 + 자체검사. R: analyzeDynamic을 부르지 않고 run 출력과 로그 원본만 쓴다 |

- 대상 주소: `changed.csv` ∪ `disagreement_delta.csv`의 주소
- 출력 (`--out` 아래, UTF-8·LF, 시각·절대경로·node 버전 없음)
  - `header.md`: 실행 조건, 자체검사, 구조 전제 S1-S5, 후보별 기저율, 범례
  - `candidates.md`: 주소별 블록
  - `candidates.csv`: 긴 형식 `address,code,side,feature,value_old,value_new,threshold,evidence`

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 정상. 후보 유무와 무관(정보성). 대상 주소가 없으면 빈 리포트 |
| 2 | 실행 오류: 인자, 파일 없음, run–트리 해시 불일치, import 실패, 출력 디렉터리 문제 |
| 3 | 자체검사 실패: 출력은 쓰되 실패한 트리 쪽을 수준 R로 내리고 `header.md` 맨 위에 경고 |

1은 쓰지 않는다. response_reasoner의 1(변경 있음, 정보성)과 regress.sh의 1(실패)이 이미 서로 다른 뜻이기 때문이다.

## N=272 예측은 hint로만 정해진다

- 평가 경로에서 동적 예측은 `fraud_type_hint`가 집합 `EXACT_HINTS`/`SUPER_HINTS`에 드는지로만 정해진다 (`evaluation/ponzi_comparison/evaluate_comparison.js:181-184, 204-205`).
- `dynamic_risk_score`와 verdict 컷오프(HIGH ≥65, MEDIUM ≥25, `analysis/dynamic_analyzer.js:219-223`)는 예측에 쓰이지 않는다.
- 그래서 점수 컷오프 근접은 후보로 두지 않는다. score, raw(=Σweight, 100 캡 전 합), verdict는 "참고 수치(예측 미사용)" 줄에만 적는다.
- 이 경로에서 hint를 정하는 술어
  - P_osc = cycles≥2 → flash_loan
  - P_rug = s/p≥0.70 ∧ 출금>0 ∧ mid=0 → rug_pull
  - P_ponzi = BALANCE_DROP 발동(drop≥0.50625) ∧ flow≥0.5 ∧ mid≥1 → ponzi_scheme
  - 그 외 unknown
- 근거: `dynamic_analyzer.js:113, 242, 266-272, 360, 440, 448, 686`과 구조 전제 S1-S4(PROPOSAL 2-4절).

## 후보 코드

신뢰도·순위는 없다. 코드 순서대로 나열하고, 각 줄에 근거 수치와 기준값을 적는다. 기저율은 `header.md` 4절에 있다.

| 코드 | 판정식 |
|---|---|
| C1-DATA | 두 트리의 `data/logs/<주소>.csv` sha256(CR 제거)가 다름. 근거: 행 수, minCum, 분석기 sha 같음/다름(둘 다 다르면 기여 분리는 사람 판단) |
| C1-CODE | 분석기 sha 다름 ∧ 로그 sha 같음 ∧ 변경 층 ∈ {dynamic, both} |
| C2-OSC / C2-RUG / C2-PONZI | 위 술어가 o→n에서 참/거짓이 바뀜 (양쪽 모두 확정된 경우만) |
| C3-NEAR:<특징> | o 또는 n에서 경계 근접: \|flow−0.5\|, \|drop−0.50625\|(출금>0), (mid=0일 때) \|s/p−0.70\| ≤ `--near`. cycles ∈ {1,2}(이산값, 폭 무관). mid_exits는 넣지 않는다 |
| C4-REG | run 트리의 `known_outliers.csv` 등재 (new 트리 우선). **동반 관찰**로만 표기 |
| C4-NEG | o 또는 n 로그의 cumulative_balance 최솟값 < 0. **동반 관찰**로만 표기 |
| C0-NONE | 위 후보가 하나도 없음 → 사람 조사 필요. 판정 특징값은 항상 출력 |

- C4가 "동반 관찰"인 이유: 정답 사례 0xbc9ccc8a·0xcafe1a77·0x20d42f2e에서 데이터 손상이 함께 있었지만 사람이 내린 원인은 규칙이었다.
- 정적 층만 바뀐 주소는 "정적 원인 후보를 내지 않는다"는 줄과 함께 C0-NONE이 된다(PROPOSAL 5-2절).

C4-REG는 `--old`/`--new` 트리 안의 `evaluation/ponzi_comparison/data/known_outliers.csv`만 읽는다(new 트리 우선, `response_reasoner.js:603-604`와 같은 규칙). 이 파일은 커밋 3386f41에서 처음 생겼으므로, 두 트리가 모두 그 이전 커밋이면(예: `trees/v2syn`, `repro/20a3d5c`) 현재 레지스트리에 등재된 주소라도 C4-REG는 나오지 않고 데이터 품질 신호는 C4-NEG(로그의 cumulative_balance 최솟값 < 0)만 남는다. v2syn→v3 검증에서 0xbc9ccc8a·0xcafe1a77·0x20d42f2e에 C4-REG가 없는 것이 이 때문이다.

## 자체검사와 강등 (PROPOSAL 3-3, 7, 8-2, 8-5절)

수준 F에서 트리마다 세 가지를 검사한다.
- (i) analyzeDynamic 재실행 결과(상태, 발동 규칙, hint) = run의 jsonl
- (ii) 축약 판정식 = 반환 hint (모든 분석 주소). 같은 결과로 정한 dynamic 예측도 run 예측과 대조해 (ii')로 표시한다
- (iii) 재계산한 OSCILLATING_BALANCE·BALANCE_DROP·FLOW_SPIKE의 발동 여부와 fraction = 반환값

하나라도 실패한 트리는 수준 R로 내린다.
- 그 트리 쪽 C2는 발동 규칙 id로만 판정한다. P_osc=OSC 발동, P_ponzi=BD∧FS가 아니면 거짓, 그 외는 미계산이며 3값 논리를 쓴다.
- C3와 판정 특징값은 `생략`으로 쓴다.
- 해당 블록에 `(old 측 자체검사 실패 — C2 부분, C3 생략)`을 붙이고 종료 코드 3을 낸다.

복사한 로직(블록마다 원본 파일:줄과 "원본 변경 시 동기화 필요" 주석):

| 원본 | 내용 |
|---|---|
| `evaluate_comparison.js:54-67, 131-175, 177-184` | parseCSV, convertToPerTx, PER_TX_HEADER·EXACT/SUPER_HINTS |
| `dynamic_analyzer.js` | `8-9, 38-40, 73-76, 99-114, 125-130, 139, 234-242, 255-258, 266-272, 286, 458, 652-672, 686` |
| `response_reasoner.js:77-103, 283-294, 381-385, 414-421` | sha256NoCR·isInside·prepareOut, loadOutliers, changeClass, changed_layer |

분석기가 바뀌어 복사본과 어긋나면 자체검사가 잡고 강등한다. 실측: d50568b 분석기 트리에서 (ii) 174/269, (iii) 57/269.

## C3 폭과 기저율

| `--near` | HEAD에서 C3 성립 (전체 269 분석 주소 중) | cycles | drop | flow | s/p |
|---|---:|---:|---:|---:|---:|
| 0.02 | 27 (10.0%) | 19 | 6 | 5 | 1 |
| 0.05 (기본) | 34 (12.6%) | 19 | 10 | 7 | 2 |
| 0.10 | 43 (16.0%) | 19 | 18 | 10 | 2 |

기본값 0.05는 근거 없는 잠정값이다. 값은 아직 정하지 않았다.

## 정답 사례 재현 (검증 결과)

| 주소 | 비교 | 도구 후보 | PROPOSAL 5-3 표 |
|---|---|---|---|
| 0x2c2e3baa | v3→HEAD | C1-DATA, C2-OSC, C3-NEAR:cycles, C4-REG, C4-NEG | 일치 |
| 0x582e3d8d | v3→HEAD | C1-DATA, C2-OSC, C4-REG, C4-NEG | 일치 |
| 0x9a2e9235 | v3→HEAD | C1-DATA, C2-OSC, C4-REG, C4-NEG | 일치 |
| 0xb5b8749 | v2syn→v3 | C1-CODE, C2-PONZI | 일치 |
| 0xbc9ccc8a, 0xcafe1a77, 0x20d42f2e | v2syn→v3 | C1-CODE, C2-PONZI, C4-NEG | C4-REG 없음 (아래) |

- C4-REG 차이의 원인: 이 run의 두 트리(v2syn, 20a3d5c)에는 `known_outliers.csv`가 없다. 이 파일은 3386f41에서 생겼다.
- 도구는 response_reasoner와 같은 규칙으로 run 트리의 레지스트리만 읽는다. PROPOSAL 5-3 표는 현재 레지스트리를 가정하고 적은 것이다.

### 사람이 다뤘으나 재현되지 않은 사례

| 주소 | 사람 결론 (`EVASION_ANALYSIS.md`) | 도구 |
|---|---|---|
| 0xd0a6e6c5 | `:516` 데이터 파이프라인 손상 (신규 오탐) | v3→HEAD·v2syn→v3 어느 run에서도 예측 변경 목록에 없음 → 대상 아님, 후보 없음 |
| 0x4398a4a1 | `:517` 패치 의도대로 작동 (신규 포착) | 위와 같음 |

v2syn은 분석기만 패치 직전(d50568b)으로 바꾼 합성 트리다. 사람이 분석할 때의 v2 데이터·평가와 달라서 이 두 건이 재현되지 않은 것으로 추정한다(미확인).

## 하지 않는 것

- 규칙·코드 수정 제안, 자동 적용, 승인 단계 대체
- fixture 로그 모드, FN/FP 목록 기반 검증(저장소에 목록 없음)
- 기존 문서 불일치 수정: 0xbc9ccc8a의 레지스트리(corrupt) vs `EVASION_ANALYSIS.md:515`(정상 데이터), `CLAUDE.md:333` 건수
- 정적 checklist 항목 단위 원인, 점수 전용 규칙(CONCENTRATION_DRAIN, BALANCE_TIMESERIES_DRAIN, TEMPORAL_PATTERN)의 근접도, convertToPerTx 재라벨 후보(C6-RELABEL)
