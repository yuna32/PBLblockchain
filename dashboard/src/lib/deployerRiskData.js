// 자동 생성 파일: scripts/deployer/build_demo.js가 만든다. 직접 고치지 말고 스크립트를 다시 실행한다.
// 시연 시나리오별로 보여 줄 "같은 유형의 실제 사례" 배포자 분석 결과(lib/risk.js normalizeRisk 입력 형식).
// 기준: v1 (조정용 절반으로 정한 기준)
export const DEPLOYER_RISK_RULES = "v1 (조정용 절반으로 정한 기준)";
export const DEPLOYER_RISK_BY_SCENARIO = {
  "ponzi": {
    "level": "strong",
    "score": 76,
    "score_max": 100,
    "summary": "이 배포자는 이 컨트랙트를 배포하기 약 3개월 전, 사기(폰지)로 확인된 컨트랙트를 만든 적이 있습니다",
    "target": {
      "deployer": "0x7df1702da741da556d57646bbb8bb8026d0082c2",
      "contract": "0x75f97d98eb49989f9af40c49a7a1eb32767214f5"
    },
    "indicators": [
      {
        "key": "first_funding",
        "points": 0,
        "cap": 30
      },
      {
        "key": "wallet_maturity",
        "status": "info",
        "points": null,
        "cap": 20,
        "note": "새 지갑 아님: 이 컨트랙트를 만들 때 지갑을 쓴 지 96일. 정상 배포자에게도 흔해(사기 배포자와 1.3배 차이) 점수에는 넣지 않습니다"
      },
      {
        "key": "past_scam_deployments",
        "points": 30,
        "cap": 30
      },
      {
        "key": "fund_flow",
        "points": 0,
        "cap": 10
      }
    ],
    "evidence": [
      {
        "indicator_key": "past_scam_deployments",
        "points": 30,
        "source": "XBlock 연구 데이터, Etherscan",
        "strength": "strong",
        "text": "이 컨트랙트보다 하루 이상 앞서 만든 컨트랙트 중 1개가 연구 데이터(XBlock)에서 폰지로 분류되어 있습니다 (처음 만든 날 2017-05-10)",
        "label_based": true
      }
    ],
    "first_funding": {
      "hops": 1,
      "category": "other"
    },
    "past_deployments": [
      {
        "contract": "0x1ce7986760ade2bf0f322f5ef39ce0de3bd0c82b",
        "deployedAt": "2017-05-10",
        "deployedTs": 1494398241,
        "publicLabel": "scam",
        "sameDay": false
      }
    ],
    "scope": {
      "activity_days": 96,
      "tx_count": 3,
      "as_of": "2017-08-14 (컨트랙트 배포 직전)",
      "failures": [
        "기록 부족(거래 5건 미만)"
      ],
      "sources": [
        "Etherscan(이더리움 메인넷)",
        "XBlock 폰지 라벨"
      ],
      "reason": "XBlock 연구용 데이터에서 폰지로 분류된 실제 컨트랙트의 배포자입니다."
    }
  },
  "normal": {
    "level": "none",
    "score": 0,
    "score_max": 100,
    "summary": "확인한 범위(활동 83일, 이전 배포 64개)에서 이 배포자의 위험 근거는 보이지 않습니다. 안전하다는 뜻은 아닙니다",
    "target": {
      "deployer": "0x6efd5665ab4b345a7ebe63c679b651f375dddb7e",
      "contract": "0x00712a531e207ad77e42586fb81e9fb8f68f0a7d"
    },
    "indicators": [
      {
        "key": "first_funding",
        "points": 0,
        "cap": 30
      },
      {
        "key": "wallet_maturity",
        "status": "info",
        "points": null,
        "cap": 20,
        "note": "새 지갑 아님: 이 컨트랙트를 만들 때 지갑을 쓴 지 83일. 정상 배포자에게도 흔해(사기 배포자와 1.3배 차이) 점수에는 넣지 않습니다"
      },
      {
        "key": "past_scam_deployments",
        "points": 0,
        "cap": 30
      },
      {
        "key": "fund_flow",
        "points": 0,
        "cap": 10
      }
    ],
    "evidence": [],
    "first_funding": {
      "hops": 1,
      "category": "other"
    },
    "past_deployments": [
      {
        "contract": "0x594f1b4fa77be53c36001b2a207e58d8bcbf3d4f",
        "deployedAt": "2017-06-25",
        "deployedTs": 1498395332,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0x3918249900ecad5ee86f84c2c498303fc52614a6",
        "deployedAt": "2017-06-25",
        "deployedTs": 1498408813,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0x2d579b7ba6e79703fc425821e531331fff6e07e2",
        "deployedAt": "2017-06-26",
        "deployedTs": 1498474432,
        "publicLabel": null,
        "sameDay": false
      },
      {
        "contract": "0x10cadaaa45f332d859715a0ae8291f30bad8fead",
        "deployedAt": "2017-06-26",
        "deployedTs": 1498475326,
        "publicLabel": null,
        "sameDay": false
      },
      {
        "contract": "0x1dd5fe0ed412cb1f8efc5d81bb4960a49dee6215",
        "deployedAt": "2017-06-26",
        "deployedTs": 1498475814,
        "publicLabel": null,
        "sameDay": false
      },
      {
        "contract": "0x2d85707324dd03251ef928d5d8325f28c686ecc9",
        "deployedAt": "2017-06-26",
        "deployedTs": 1498476111,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0x0e412af67f6c41e9209da8b8638d65bb883ddf5a",
        "deployedAt": "2017-06-26",
        "deployedTs": 1498495466,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0x7110bb5e18842646438320ca56c0a064ccd99235",
        "deployedAt": "2017-06-27",
        "deployedTs": 1498605383,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0xaa6e94908c4b2d020ef5f92bca529db958df106f",
        "deployedAt": "2017-07-04",
        "deployedTs": 1499126959,
        "publicLabel": "normal",
        "sameDay": false
      },
      {
        "contract": "0xfbd2d8aea3e183e2786ece61665ccaf7574e548b",
        "deployedAt": "2017-07-04",
        "deployedTs": 1499172793,
        "publicLabel": "normal",
        "sameDay": false
      }
    ],
    "scope": {
      "activity_days": 83,
      "tx_count": 995,
      "as_of": "2017-08-30 (컨트랙트 배포 직전)",
      "failures": [],
      "sources": [
        "Etherscan(이더리움 메인넷)",
        "XBlock 폰지 라벨"
      ],
      "reason": "XBlock 연구용 데이터에서 정상으로 분류된 실제 컨트랙트의 배포자입니다. 기준 시점 이전 배포 64개 중 10개(사기 라벨과 최근 배포)만 표에 표시합니다."
    }
  }
};
