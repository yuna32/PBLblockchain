# response_reasoner MVP

버전 간 불일치 케이스 요약기. 설계: `~/pbl_backup/response_design/PROPOSAL.md`, 근거: `FINDINGS.md` (둘 다 저장소 밖 보관본, `~/pbl_backup/response_design/`).
저장소(`~/pbl`) 이동은 승인 후 별도 단계에서 한다.

## 파일

| 경로 | 내용 |
|---|---|
| `response_reasoner.js` | 본체 (node 직접 실행, ESM) |
| `README.md` | 이 문서 |

- 검증 스크립트·사본 트리·실행 출력 예시(`verify/`, `trees/`, `runs/`)와 저장소 밖 실행용 `package.json`은 저장소 밖(`~/pbl_backup/response_mvp/`)에서 관리한다.
- 이 폴더에는 `package.json`을 두지 않는다. 저장소 루트 `package.json`의 `"type": "module"`이 적용되어 `.js`가 ESM으로 실행된다.

## 사용법

```
cd evaluation/response_reasoner   # 저장소 루트 기준
node response_reasoner.js \
  --old ~/pbl_backup/repro/20a3d5c/src --old-pred ~/pbl_backup/repro/20a3d5c/out_empty/ontology_predictions.csv --old-label v3_20a3d5c \
  --new <HEAD 사본 트리> --new-pred <그 트리로 만든 ontology_predictions.csv> --new-label HEAD_c9e75ec \
  --out ~/pbl_backup/response_mvp/runs/<이름>
```

`node response_reasoner.js --help`로 옵션·종료 코드를 볼 수 있다.

- 종료 코드: 0 변경 없음 / 1 변경 있음(정보성. regress.sh의 1=실패와 의미가 다름) / 2 실행 오류 / 3 자체검사 실패
- 출력: `old.jsonl`, `new.jsonl`, `changed.csv`, `disagreement_delta.csv`, `summary.md` (시각·절대경로 없음)
- `--out`은 없거나 비어 있어야 하고, `.git`이 있는 디렉터리 아래나 입력 트리 안이면 거부(코드 2)

## PROPOSAL.md와 달라진 점

| 항목 | PROPOSAL | 구현 |
|---|---|---|
| 파일명·위치 | 미결정 (`.mjs` 안 포함) | `~/pbl_backup/response_mvp/response_reasoner.js` + `package.json`(type module) |
| 정적 출력 | `static_matched_items`(항목 ID) | 내지 않음(결정 3). `static_scores`(유형별 합), `static_top_type`, `static_pred`만 |
| summary 실행 조건 | 트리 경로, 기본 라벨 = 트리 경로 | 경로 없음(결정 5). 기본 라벨 `old`/`new`, 트리 식별은 모듈 sha256(CR 제거) |
| 복사본 드리프트 경고 | 과거 트리 함수 본문 비교 | 트리의 `evaluate_comparison.js` 파일 전체 sha256을 복사 기준본(c9e75ec)과 비교해 같음/다름만 표시. 판정은 자체검사로 |
| 자체검사 대상 | 5개 예측 열 | `true_label` + 5개 예측 열. CSV에 행이 없으면 불일치 |
| tmp 파일 | `--out/.tmp/<address>.csv` | `--out/.tmp/<old|new>_<address>.csv`, 끝나면 `.tmp` 삭제 |
| 저장소 안 `--out` 거부 | "저장소 안이면 거부" | 상위 경로 어디든 `.git`이 있으면 거부 |
| 한쪽에만 있는 주소 | 정의 없음 | 변경으로 셈(종료 코드 1), summary에 표시 |
| changed.csv 열 | 제안 목록 | 제안 목록 + `rules_old`, `rules_new`(`ID:획득점수`를 `;`로 연결) |
| jsonl 필드 | 제안 목록 | + `in_baseline`, `static_status`, `dynamic_status`. `analyzeDynamic`의 `csv`·`description` 제외 |
| `--old` 경로 | `repro/20a3d5c/src` | 같음 (repro 디렉터리 자체가 아니라 그 아래 `src`가 트리 루트) |
