# demo/ — 시연용 MVP 1단계 (서비스화 기반)

Node 22.10 이상이 필요하다(hardhat 3). 저장소 루트에서 `nvm use`.

| 경로 | 내용 |
|---|---|
| `run.js` | `runScenario(name, outDir, options)` — 시뮬레이션(hardhat 하위 프로세스) → `buildReport` → `outDir`에 CSV, `report.json`, `envelope.json`. 시뮬레이션이 실패하면 `fixtures/<name>/`의 CSV로 분석하고 `source: "fixture"` |
| `build_fixtures.js` | `fixtures/` 다시 만들기 (폴백 없음, laundering 시드 `pbl-demo`) |
| `lib/canonical.js` | RFC 8785(JCS) 방식 canonical 직렬화, SHA-256, envelope |
| `lib/onset.js` | 사기 발현 시점 추정 `computeOnset(rows, dynamic)` (규칙 미확정) |
| `lib/csv.js` | 시뮬레이션 CSV 파서 (CRLF 처리) |
| `fixtures/<scenario>/` | normal, ponzi, rugpull, laundering, pumpdump의 CSV, `report.json`, `envelope.json` |
| `test/` | `node --test demo/test/*.test.js` |

시나리오 이름: `normal`, `ponzi`, `rugpull`, `laundering`, `pumpdump`.

```
node demo/run.js ponzi /tmp/demo-out/ponzi
node demo/build_fixtures.js            # demo/fixtures 갱신
```

- 시뮬레이션 출력은 `DEMO_LOG_DIR`, laundering 금액은 `DEMO_SEED`로 고정한다(`run.js`가 설정). `analysis/logs`, `analysis/reports`에는 쓰지 않는다.
- hardhat 실행 시 저장소의 `cache/`, `artifacts/`(둘 다 `.gitignore`)가 갱신될 수 있다.
- 리포트 해시는 `timestamp`, `dynamic.csv`, `trust.csv`, `static.file`을 뺀 리포트의 canonical 문자열을 해시한다. 입력 해시(정규화 CSV, .sol)는 `envelope.input`에 따로 있다.
