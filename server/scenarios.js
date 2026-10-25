// 시연 시나리오 목록. 설명은 scripts/simulate_*.js의 기본값(환경변수 없음) 기준이다.
export const SCENARIO_LIST = [
  {
    id: "normal",
    label: "정상 스테이킹",
    expectedType: "normal_staking",
    description: "운영자가 보상 풀을 채우고, 참여자 10명이 스테이킹한 뒤 보상과 함께 원금을 돌려받는다."
  },
  {
    id: "ponzi",
    label: "폰지 사기",
    expectedType: "ponzi_scheme",
    description: "참여자 10명이 입금하고, 먼저 들어온 3명이 신규 입금으로 수익을 받은 뒤 운영자가 남은 잔고를 전액 인출한다."
  },
  {
    id: "rugpull",
    label: "러그풀",
    expectedType: "rug_pull",
    description: "참여자 10명이 점점 큰 금액을 입금한 뒤 운영자가 잔고 전액을 한 번에 인출한다."
  },
  {
    id: "laundering",
    label: "자금세탁",
    expectedType: "money_laundering",
    description: "지갑 19개가 소액을 나눠 입금하고, 한 지갑이 모인 자금 전액을 인출한다(레이어링)."
  },
  {
    id: "pumpdump",
    label: "펌프앤덤프",
    expectedType: "pump_and_dump",
    description: "내부자 3명이 먼저 대량 입금하고 후발자 5명이 들어온 뒤, 내부자가 자금을 빼내 후발자의 출금이 실패한다."
  }
];
