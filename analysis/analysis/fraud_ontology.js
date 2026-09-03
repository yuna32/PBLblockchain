export const FraudOntology = {

  classes: {
    FraudPattern: {
      subClasses: ['PonziScheme', 'RugPull', 'MoneyLaundering',
                   'PumpAndDump', 'HoneypotTrap'],
      description: '블록체인 사기 패턴의 최상위 개념'
    },
    AnomalySignal: {
      subClasses: ['BalanceDrop', 'FlowSpike', 'MaxTxAlert',
                   'ConcentrationDrain', 'ZeroWithdrawBlock',
                   'InputDataOpacity'],
      description: '이상 신호 지표의 최상위 개념'
    },
    EvasionTechnique: {
      subClasses: ['OwnerWithdrawAll', 'SmurfingDeposit',
                   'FlashRepayment', 'HiddenRequireCondition',
                   'GradualDrainObfuscation'],
      description: '탐지 회피 기법의 최상위 개념'
    },
    WalletRole: {
      subClasses: ['Insider', 'LateParticipant', 'Beneficiary',
                   'Victim', 'Mixer'],
      description: '지갑 역할 분류'
    }
  },

  fraudTypes: {
    PonziScheme: {
      label: '폰지 사기',
      description: '신규 입금으로 기존 참여자 수익 지급',
      necessaryConditions: ['BalanceDrop', 'FlowSpike'],
      sufficientConditions: ['MaxTxAlert', 'MidWithdrawalsExist'],
      usesEvasion: ['OwnerWithdrawAll', 'GradualDrainObfuscation'],
      affectedRoles: ['LateParticipant', 'Victim'],
      beneficiaryRoles: ['Insider'],
      detectionThresholds: {
        BALANCE_DROP: 0.2,
        FLOW_SPIKE: 0.5,
        MAX_TX_ALERT: 0.9
      },
      guiEmphasis: {
        panel1: 'owner 노드 빨간 테두리 + 단방향 대형 엣지',
        panel2: '블랙리스트 연관도 + 활동 기간 강조',
        panel3: '잔고 급락 블록 수직선 + 이후 0 구간 회색',
        panel4: ['BALANCE_DROP', 'FLOW_SPIKE', 'MAX_TX_ALERT']
      },
      evasionSubclasses: {
        BalanceDropEvasion: {
          id: 'PonziScheme_BalanceDropEvasion',
          label: '잔고 급락 회피형',
          axiom: {
            baseClass: 'PonziScheme',
            conditions: [
              {
                pattern: 'SPLIT_WITHDRAWAL',
                description: '단일 인출이 전체 잔고의 80% 미만으로 분할',
                threshold: 'max_single_withdrawal / peak_balance < 0.80'
              }
            ]
          },
          consequence: 'BALANCE_DROP 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '인출 횟수 누적 + 인출액 합산 비율로 재탐지'
        },
        MaxTxEvasion: {
          id: 'PonziScheme_MaxTxEvasion',
          label: '최대 거래 회피형',
          axiom: {
            baseClass: 'PonziScheme',
            conditions: [
              {
                pattern: 'REPEATED_SMALL_WITHDRAWAL',
                description: '반복 인출, 단일 건이 잔고의 90% 미만 유지',
                threshold: 'withdrawal_count >= 3 AND max_single_withdrawal / peak_balance < 0.90'
              }
            ]
          },
          consequence: 'MAX_TX_ALERT 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '동일 주소 반복 인출 횟수 누적 추적'
        },
        SlowDrain: {
          id: 'PonziScheme_SlowDrain',
          label: '시간 분산 회피형',
          axiom: {
            baseClass: 'PonziScheme',
            conditions: [
              {
                pattern: 'LONG_PERIOD_SPLIT',
                description: '인출이 전체 블록 구간의 30% 이상에 분산',
                threshold: 'withdrawal_block_span / total_block_span > 0.30'
              }
            ]
          },
          consequence: '시계열 패턴 희석 → 급락 지점 탐지 어려움',
          counter_detection: '누적 인출 비율 시계열 추적'
        }
      }
    },
    RugPull: {
      label: '러그풀',
      description: '잔고 정점에서 단 1회 전액 인출',
      necessaryConditions: ['BalanceDrop', 'MaxTxAlert'],
      sufficientConditions: ['NoMidWithdrawals'],
      usesEvasion: ['OwnerWithdrawAll'],
      affectedRoles: ['LateParticipant', 'Victim'],
      beneficiaryRoles: ['Insider'],
      detectionThresholds: {
        BALANCE_DROP: 0.2,
        MAX_TX_ALERT: 0.9
      },
      guiEmphasis: {
        panel1: 'owner 노드 빨간 테두리 + 컨트랙트→owner 대형 엣지',
        panel2: '블랙리스트 연관도 + 활동 기간 최저점',
        panel3: '잔고 정점→급락 블록 수직선 + 이후 잔고 0 구간 회색',
        panel4: ['MAX_TX_ALERT']
      },
      evasionSubclasses: {
        BalanceDropEvasion: {
          id: 'RugPull_BalanceDropEvasion',
          label: '잔고 급락 회피형',
          axiom: {
            baseClass: 'RugPull',
            conditions: [
              {
                pattern: 'SPLIT_WITHDRAWAL',
                description: '단일 인출이 전체 잔고의 80% 미만으로 분할',
                threshold: 'max_single_withdrawal / peak_balance < 0.80'
              }
            ]
          },
          consequence: 'BALANCE_DROP 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '인출 횟수 누적 + 인출액 합산 비율로 재탐지'
        },
        MaxTxEvasion: {
          id: 'RugPull_MaxTxEvasion',
          label: '최대 거래 회피형',
          axiom: {
            baseClass: 'RugPull',
            conditions: [
              {
                pattern: 'REPEATED_SMALL_WITHDRAWAL',
                description: '반복 인출, 단일 건이 잔고의 90% 미만 유지',
                threshold: 'withdrawal_count >= 3 AND max_single_withdrawal / peak_balance < 0.90'
              }
            ]
          },
          consequence: 'MAX_TX_ALERT 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '동일 주소 반복 인출 횟수 누적 추적'
        },
        SlowDrain: {
          id: 'RugPull_SlowDrain',
          label: '시간 분산 회피형',
          axiom: {
            baseClass: 'RugPull',
            conditions: [
              {
                pattern: 'LONG_PERIOD_SPLIT',
                description: '인출이 전체 블록 구간의 30% 이상에 분산',
                threshold: 'withdrawal_block_span / total_block_span > 0.30'
              }
            ]
          },
          consequence: '시계열 패턴 희석 → 급락 지점 탐지 어려움',
          counter_detection: '누적 인출 비율 시계열 추적'
        }
      }
    },
    MoneyLaundering: {
      label: '자금세탁',
      description: '다수 입금 후 단일 주소로 전액 출금 (레이어링 통합)',
      necessaryConditions: ['UniqueParticipants', 'MaxTxAlert'],
      sufficientConditions: ['SingleDrain'],
      usesEvasion: ['OwnerRecipientArbitrage'],
      affectedRoles: ['Depositor', 'Victim'],
      beneficiaryRoles: ['Insider'],
      detectionThresholds: {
        UNIQUE_PARTICIPANTS: 0.3,
        MAX_TX_ALERT: 0.9
      },
      guiEmphasis: {
        panel1: '다수 입금자 노드 + 단일 수취인 대형 엣지',
        panel2: '고유 참여자 급증 + 활동 기간 최저점',
        panel3: '잔고 정점→단발 급락 + 수취인 주소 강조',
        panel4: ['MAX_TX_ALERT']
      },
      evasionSubclasses: {
        BalanceDropEvasion: {
          id: 'MoneyLaundering_BalanceDropEvasion',
          label: '잔고 급락 회피형',
          axiom: {
            baseClass: 'MoneyLaundering',
            conditions: [
              {
                pattern: 'SPLIT_WITHDRAWAL',
                description: '단일 인출이 전체 잔고의 80% 미만으로 분할',
                threshold: 'max_single_withdrawal / peak_balance < 0.80'
              }
            ]
          },
          consequence: 'BALANCE_DROP 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '인출 횟수 누적 + 인출액 합산 비율로 재탐지'
        },
        MaxTxEvasion: {
          id: 'MoneyLaundering_MaxTxEvasion',
          label: '최대 거래 회피형',
          axiom: {
            baseClass: 'MoneyLaundering',
            conditions: [
              {
                pattern: 'REPEATED_SMALL_WITHDRAWAL',
                description: '반복 인출, 단일 건이 잔고의 90% 미만 유지',
                threshold: 'withdrawal_count >= 3 AND max_single_withdrawal / peak_balance < 0.90'
              }
            ]
          },
          consequence: 'MAX_TX_ALERT 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '동일 주소 반복 인출 횟수 누적 추적'
        },
        SlowDrain: {
          id: 'MoneyLaundering_SlowDrain',
          label: '시간 분산 회피형',
          axiom: {
            baseClass: 'MoneyLaundering',
            conditions: [
              {
                pattern: 'LONG_PERIOD_SPLIT',
                description: '인출이 전체 블록 구간의 30% 이상에 분산',
                threshold: 'withdrawal_block_span / total_block_span > 0.30'
              }
            ]
          },
          consequence: '시계열 패턴 희석 → 급락 지점 탐지 어려움',
          counter_detection: '누적 인출 비율 시계열 추적'
        },
        HopLaundering: {
          id: 'MoneyLaundering_HopLaundering',
          label: '중간 경유 지갑형',
          axiom: {
            baseClass: 'MoneyLaundering',
            conditions: [
              {
                pattern: 'INTERMEDIATE_WALLET',
                description: '입금자와 최종 수집자 사이에 경유 지갑 존재',
                threshold: 'unique_withdraw_addresses NOT IN unique_deposit_addresses AND unique_withdraw_addresses > 1'
              },
              {
                pattern: 'HOP_COUNT',
                description: '경유 횟수 2회 이상',
                threshold: 'addresses_that_both_deposit_and_withdraw >= 2'
              }
            ]
          },
          consequence: '자금 출처 역추적 난이도 상승',
          counter_detection: '입금→경유→인출 주소 체인 그래프 분석'
        }
      }
    },
    HoneypotTrap: {
      label: '허니팟',
      description: '입금은 가능하나 출금이 숨겨진 조건으로 항상 실패',
      necessaryConditions: ['ZeroWithdrawBlock', 'InputDataOpacity'],
      sufficientConditions: ['HiddenRequireCondition'],
      usesEvasion: ['HiddenRequireCondition'],
      affectedRoles: ['Victim'],
      beneficiaryRoles: ['Insider'],
      detectionThresholds: {
        WITHDRAW_SUCCESS_RATE: 0.0,
        MIN_DEPOSIT_BLOCKS: 3
      },
      guiEmphasis: {
        panel1: '입금 엣지만 존재 + 출금 엣지 없음 강조',
        panel2: '출금 비율 0 + 트랜잭션 투명성 최저',
        panel3: 'total_in 지속 증가 + total_out 항상 0',
        panel4: ['ZERO_WITHDRAW', 'INPUT_OPACITY']
      }
    },
    PumpDump: {
      label: '펌프앤덤프',
      description: '내부자 등록 후 가격 부양 → 대량 인출로 일반 참여자 손실',
      necessaryConditions: ['InsiderPrivilege', 'AsymmetricWithdrawal'],
      sufficientConditions: ['LateParticipantLoss'],
      usesEvasion: ['GradualDrainObfuscation'],
      affectedRoles: ['LateParticipant', 'Victim'],
      beneficiaryRoles: ['Insider'],
      detectionThresholds: {
        PROFIT_EXTRACTION: 1.3,
        FLOW_SPIKE: 0.5
      },
      guiEmphasis: {
        panel1: '내부자 노드 강조 + 비대칭 인출 엣지',
        panel2: '내부자 수익률 급등 + 후발자 손실 표시',
        panel3: '내부자 인출 후 잔고 급락 + 후발자 환급 불가 구간',
        panel4: ['PROFIT_EXTRACTION', 'FLOW_SPIKE']
      },
      evasionSubclasses: {
        BalanceDropEvasion: {
          id: 'PumpDump_BalanceDropEvasion',
          label: '잔고 급락 회피형',
          axiom: {
            baseClass: 'PumpDump',
            conditions: [
              {
                pattern: 'SPLIT_WITHDRAWAL',
                description: '단일 인출이 전체 잔고의 80% 미만으로 분할',
                threshold: 'max_single_withdrawal / peak_balance < 0.80'
              }
            ]
          },
          consequence: 'BALANCE_DROP 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '인출 횟수 누적 + 인출액 합산 비율로 재탐지'
        },
        MaxTxEvasion: {
          id: 'PumpDump_MaxTxEvasion',
          label: '최대 거래 회피형',
          axiom: {
            baseClass: 'PumpDump',
            conditions: [
              {
                pattern: 'REPEATED_SMALL_WITHDRAWAL',
                description: '반복 인출, 단일 건이 잔고의 90% 미만 유지',
                threshold: 'withdrawal_count >= 3 AND max_single_withdrawal / peak_balance < 0.90'
              }
            ]
          },
          consequence: 'MAX_TX_ALERT 신호 미발생 → 기본 탐지기 우회 가능',
          counter_detection: '동일 주소 반복 인출 횟수 누적 추적'
        },
        SlowDrain: {
          id: 'PumpDump_SlowDrain',
          label: '시간 분산 회피형',
          axiom: {
            baseClass: 'PumpDump',
            conditions: [
              {
                pattern: 'LONG_PERIOD_SPLIT',
                description: '인출이 전체 블록 구간의 30% 이상에 분산',
                threshold: 'withdrawal_block_span / total_block_span > 0.30'
              }
            ]
          },
          consequence: '시계열 패턴 희석 → 급락 지점 탐지 어려움',
          counter_detection: '누적 인출 비율 시계열 추적'
        },
        DistributedDump: {
          id: 'PumpDump_DistributedDump',
          label: '분산 덤프형 (위장 외부자)',
          axiom: {
            baseClass: 'PumpDump',
            conditions: [
              {
                pattern: 'DUMP_ADDRESS_EXCEEDS_INSIDER_COUNT',
                description: '인출 주소 수가 등록된 내부자 수보다 많음',
                threshold: 'unique_withdraw_addresses > registered_insider_count'
              },
              {
                pattern: 'WITHDRAW_WITHOUT_DEPOSIT',
                description: '입금 이력 없는 주소가 인출',
                threshold: 'addresses_withdraw_only (no prior deposit) >= 2'
              }
            ]
          },
          consequence: '내부자 식별 어려움 → 책임 추적 불가',
          counter_detection: '입금 없는 인출 주소 플래깅 + 내부자 등록 수 대조'
        }
      }
    }
  },

  evasionTechniques: {
    OwnerWithdrawAll: {
      label: '관리자 전액 인출',
      detectedBy: 'static_analysis',
      solidity_pattern: 'onlyOwner + call{value: balance}',
      patch: 'timelock 추가: ownerWithdrawAll에 10블록 지연'
    },
    SmurfingDeposit: {
      label: '스머핑 분산 입금',
      detectedBy: 'dynamic_analysis',
      pattern: 'many small deposits from different addresses',
      patch: '최소 입금액 하한선 0.1 ETH + KYC 연동'
    },
    HiddenRequireCondition: {
      label: '숨겨진 출금 차단 조건',
      detectedBy: 'static_analysis',
      solidity_pattern: 'require(private_bool) inside withdraw — bool never set true by public fn',
      patch: '출금 함수에서 접근 제어 완전 제거 또는 공개'
    },
    GradualDrainObfuscation: {
      label: '점진적 드레인 난독화',
      detectedBy: 'dynamic_analysis',
      pattern: 'multiple small withdrawals before large final drain',
      patch: '누적 출금 임계값 모니터링 + 인출 한도: 단일 인출 잔고의 30% 초과 불가'
    },
    FlashRepayment: {
      label: '플래시 상환',
      detectedBy: 'dynamic_analysis',
      pattern: 'same-block large deposit then full repayment',
      patch: '동일 블록 입출금 제한 + 최소 보유 기간 조건'
    }
  },

  // triggers / implies 인과관계 (설계서 4-1, 4-3절 — v0.2 신규)
  // BehaviorPattern → AnomalySignal 인과관계를 명시화한 것으로, BehaviorPattern만
  // 감지되어도 대응 AnomalySignal 발생을 예측할 수 있게 한다. fraud.owl의
  // triggers/implies ObjectProperty + SWRL 규칙(add_swrl_rules.py imp9~imp13)과
  // 1:1로 대응하는 JS 레이어 표현이다 (설계서 2-2절 JS/OWL 레이어 역할 분리).
  // detectPattern은 prevention_reasoner.js가 소스코드에서 해당 BehaviorPattern의
  // 존재를 추정하는 데 쓰는 정적 프록시 정규식이며, 기존 preventionRules 체크리스트
  // 항목과 개념적으로 겹치되 별도 필드로 관리한다(risk_score에는 영향 없음).
  causalRelations: {
    triggers: [
      {
        pattern: 'OwnerWithdrawAll',
        signal: 'BalanceDrop',
        detectPattern: 'ownerWithdrawAll|withdrawAll|drainAll|emergencyWithdraw',
        rationale: '전액 인출 실행 → 잔고 수직 급락'
      },
      {
        pattern: 'SingleLargeOutflow',
        signal: 'MaxTxAlert',
        detectPattern: 'payable\\(owner\\)|owner\\.call|onlyOwner.*withdraw',
        rationale: '단일 대형 출금 → 최대 단일 TX 경보'
      },
      {
        pattern: 'ParticipantMidExit',
        signal: 'FlowSpike',
        detectPattern: 'function\\s+(withdraw|unstake)\\s*\\(',
        rationale: '중간 출금 다발 → 순유출 급증'
      }
    ],
    implies: [
      {
        pattern: 'InsiderBulkDeposit',
        signal: 'InflowStop',
        detectPattern: 'isInsider|addInsider',
        rationale: '내부자 입금 종료 시점 이후 신규 유입 중단 함의'
      },
      {
        // 설계서 원문은 "WithdrawBlock → implies → WithdrawAttemptFail"이나,
        // 3-1 클래스 계층(WithdrawBlock=AnomalySignal, WithdrawAttemptFail=
        // BehaviorPattern) 및 4-1 Domain/Range(Domain=BehaviorPattern)와
        // 모순되고 "WithdrawBlock" 클래스 자체가 구현체에 존재하지 않는다.
        // WithdrawAttemptFail(BehaviorPattern, 원인) → implies →
        // ZeroWithdrawBlock(AnomalySignal, 결과)로 정정하여 반영한다.
        pattern: 'WithdrawAttemptFail',
        signal: 'ZeroWithdrawBlock',
        detectPattern: 'bool.*private.*false|_withdrawEnabled|private\\s+bool.*=\\s*false',
        rationale: '코드 내 차단 변수 존재 → 출금 시도 실패 함의'
      }
    ]
  },

  anomalySignals: {
    BalanceDrop: {
      label: '잔고 급락',
      formula: 'cumulative_balance[b] < cumulative_balance[b-1] * 0.2',
      severity: 'HIGH'
    },
    FlowSpike: {
      label: '순입금 스파이크',
      formula: '|net_flow[b]| > cumulative_balance[b-1] * 0.5',
      severity: 'HIGH'
    },
    MaxTxAlert: {
      label: '최대 단일 TX 경보',
      formula: 'max_single_tx[b] >= cumulative_balance[b-1] * 0.9',
      severity: 'HIGH'
    },
    ConcentrationDrain: {
      label: '집계 인출',
      formula: 'deposit_addresses > withdraw_addresses * 3',
      severity: 'MEDIUM'
    },
    ZeroWithdrawBlock: {
      label: '출금 0 지속',
      formula: 'total_out == 0 for all blocks while total_in > 0 AND withdraw_attempt actions exist',
      severity: 'HIGH'
    },
    InputDataOpacity: {
      label: '입력 데이터 불투명',
      formula: 'owner_collect or owner_withdraw_all present, OR withdraw_attempt with amount=0',
      severity: 'MEDIUM'
    }
  }

,

  preventionRules: {
    PonziScheme: {
      checklistItems: [
        {
          id: "OWNER_WITHDRAW_ALL",
          label: "무제한 오너 인출 함수",
          detectPattern: "ownerWithdrawAll|withdrawAll|emergencyWithdraw",
          riskWeight: 3,
          ifDetected: "단일 함수로 전체 잔고 인출 가능 → 러그풀 구조 내재",
          fixSuggestion: "함수 제거 또는 timelock + 한도(30%) 동시 적용"
        },
        {
          id: "NO_TIMELOCK",
          label: "타임락 부재",
          detectPattern: "ABSENCE:timelock|ABSENCE:delay|ABSENCE:lockPeriod|ABSENCE:deployBlock",
          riskWeight: 2,
          ifDetected: "즉각 인출 가능 → 러그풀 실행 용이",
          fixSuggestion: "block.number >= deployBlock + N 조건 추가 (N >= 10)"
        },
        {
          id: "REWARD_FROM_DEPOSIT",
          label: "신규 입금이 기존 보상 재원",
          detectPattern: "participants\\[|msg\\.value.*reward|balance.*payout",
          riskWeight: 3,
          ifDetected: "폰지 구조 — 신규 자금이 기존 참여자 수익으로 사용됨",
          fixSuggestion: "독립 보상 풀(rewardPool) 분리, 배포 시 충전"
        },
        {
          id: "NO_WITHDRAWAL_LIMIT",
          label: "단일 출금 한도 없음",
          detectPattern: "ABSENCE:withdrawalLimit|ABSENCE:maxWithdraw|ABSENCE:maxAllowed",
          riskWeight: 2,
          ifDetected: "전액 단발 인출 가능",
          fixSuggestion: "단일 인출 <= 잔고의 30% 제한 추가"
        },
        {
          id: "SINGLE_BENEFICIARY",
          label: "단일 수혜자 구조",
          detectPattern: "payable\\(owner\\)|owner\\.call|onlyOwner.*withdraw",
          riskWeight: 2,
          ifDetected: "모든 자금이 단일 주소로만 흐를 수 있는 구조",
          fixSuggestion: "다중 서명(multisig) 또는 참여자 비례 분배 구조로 전환"
        }
      ],
      riskLevels: {
        CRITICAL: { minScore: 8,  label: "배포 불가",      color: "red"    },
        HIGH:     { minScore: 5,  label: "수정 후 재검토",  color: "orange" },
        MEDIUM:   { minScore: 2,  label: "모니터링 필요",   color: "yellow" },
        LOW:      { minScore: 0,  label: "정상 구조",       color: "green"  }
      }
    },

    RugPull: {
      checklistItems: [
        {
          id: "SINGLE_DRAIN_FUNCTION",
          label: "단발 전액 인출 함수",
          detectPattern: "rugPull|drainAll|withdrawAll",
          riskWeight: 3,
          ifDetected: "명시적 러그풀 함수 존재",
          fixSuggestion: "함수 제거, 참여자별 개별 출금 구조로 전환"
        },
        {
          id: "NO_PARTICIPANT_REFUND",
          label: "참여자 환불 불가 구조",
          detectPattern: "ABSENCE:refund|ABSENCE:emergencyExit",
          riskWeight: 2,
          ifDetected: "참여자가 자금을 회수할 수 없는 구조",
          fixSuggestion: "emergencyExit() 함수 추가"
        }
      ],
      riskLevels: {
        CRITICAL: { minScore: 5,  label: "배포 불가",      color: "red"    },
        HIGH:     { minScore: 3,  label: "수정 후 재검토",  color: "orange" },
        MEDIUM:   { minScore: 1,  label: "모니터링 필요",   color: "yellow" },
        LOW:      { minScore: 0,  label: "정상 구조",       color: "green"  }
      }
    },

    MoneyLaundering: {
      checklistItems: [
        {
          id: "SINGLE_COLLECTOR_DRAIN",
          label: "단일 수집자 전액 인출",
          detectPattern: "withdrawAll.*recipient|recipient\\.call\\{value.*balance",
          riskWeight: 3,
          ifDetected: "다수 지갑 입금 → 단일 주소 전액 인출 구조 (세탁 완성 경로)",
          fixSuggestion: "입금자 비례 환불 구조로 전환. 단일 수혜자 함수 제거"
        },
        {
          id: "NO_DEPOSIT_TRACKING",
          label: "입금자별 추적 불가 구조",
          detectPattern: "ABSENCE:deposits\\[|ABSENCE:userDeposits|ABSENCE:balances\\[",
          riskWeight: 2,
          ifDetected: "개별 입금액 기록 없음 → 자금 출처 역추적 불가",
          fixSuggestion: "depositorAmounts mapping 추가, 이벤트 emit으로 추적 가능하게"
        },
        {
          id: "MANY_TO_ONE_FLOW",
          label: "다수→단일 자금 집중 구조",
          detectPattern: "depositorList|hasDeposited",
          riskWeight: 3,
          ifDetected: "자금세탁 구조의 핵심: 출처 분산 → 목적지 집중",
          fixSuggestion: "최대 수혜자 비율 제한 (단일 주소 30% 초과 인출 불가)"
        },
        {
          id: "NO_MINIMUM_HOLD_PERIOD",
          label: "최소 보유 기간 없음",
          detectPattern: "ABSENCE:holdPeriod|ABSENCE:lockTime|ABSENCE:minBlocks",
          riskWeight: 2,
          ifDetected: "입금 즉시 인출 가능 → 세탁 사이클 가속",
          fixSuggestion: "입금 후 최소 N블록 경과 후 인출 허용"
        }
      ],
      riskLevels: {
        CRITICAL: { minScore: 8,  label: "배포 불가 — 세탁 구조 명확",  color: "red"    },
        HIGH:     { minScore: 5,  label: "수정 후 재검토",               color: "orange" },
        MEDIUM:   { minScore: 2,  label: "모니터링 필요",                color: "yellow" },
        LOW:      { minScore: 0,  label: "정상 구조",                    color: "green"  }
      }
    },
    HoneypotTrap: {
      checklistItems: [
        {
          id: "HIDDEN_WITHDRAW_BLOCK",
          label: "숨겨진 인출 차단 조건",
          detectPattern: "bool.*private.*false|_withdrawEnabled|private.*bool.*=.*false",
          riskWeight: 3,
          ifDetected: "인출이 비공개 조건으로 영구 차단될 수 있는 구조",
          fixSuggestion: "비공개 인출 차단 변수 제거 또는 공개 활성화 함수 추가"
        },
        {
          id: "NO_PUBLIC_WITHDRAW_ACTIVATE",
          label: "공개 인출 활성화 경로 없음",
          detectPattern: "ABSENCE:enableWithdraw|ABSENCE:setWithdrawEnabled|ABSENCE:activateWithdraw",
          riskWeight: 2,
          ifDetected: "외부에서 인출을 활성화할 수 없는 구조",
          fixSuggestion: "public 함수로 인출 조건 변경 또는 hidden condition 완전 제거"
        }
      ],
      riskLevels: {
        CRITICAL: { minScore: 4,  label: "배포 불가",      color: "red"    },
        HIGH:     { minScore: 2,  label: "수정 후 재검토",  color: "orange" },
        MEDIUM:   { minScore: 1,  label: "모니터링 필요",   color: "yellow" },
        LOW:      { minScore: 0,  label: "정상 구조",       color: "green"  }
      }
    },
    PumpDump: {
      checklistItems: [
        {
          id: "INSIDER_REGISTRY",
          label: "내부자 등록 및 특권 구조",
          detectPattern: "isInsider|addInsider",
          riskWeight: 3,
          ifDetected: "내부자만 수익 인출 가능 — 정보 비대칭 착취 구조",
          fixSuggestion: "내부자 특권 제거. 모든 참여자 동일 조건 적용"
        },
        {
          id: "ASYMMETRIC_WITHDRAWAL",
          label: "내부자/외부자 출금 비대칭",
          detectPattern: "insiderWithdraw|require\\(isInsider",
          riskWeight: 3,
          ifDetected: "내부자 전액 인출 후 후발자 잔고 0 — 구조적 피해 설계",
          fixSuggestion: "역할 기반 인출 제거. 비례 분배 또는 FIFO 구조 적용"
        },
        {
          id: "NO_PRICE_ORACLE",
          label: "가격/비율 오라클 부재",
          detectPattern: "ABSENCE:oracle|ABSENCE:priceCheck|ABSENCE:rateLimit",
          riskWeight: 2,
          ifDetected: "내부자가 임의 비율로 인출 가능 — 조작 기준 없음",
          fixSuggestion: "외부 오라클 또는 고정 비율 기준 추가"
        },
        {
          id: "LATE_PARTICIPANT_ZERO_BALANCE",
          label: "후발자 잔고 귀결 0 구조",
          detectPattern: "owed <= contractBalance|payout.*contractBalance",
          riskWeight: 3,
          ifDetected: "내부자 덤프 후 후발자 전액 손실 불가피",
          fixSuggestion: "후발자 최소 원금 보장 조건 추가 또는 참여 제한"
        },
        {
          id: "PUMP_PHASE_NO_DISCLOSURE",
          label: "유인 단계 미공시",
          detectPattern: "ABSENCE:event.*PumpPhase|ABSENCE:emit.*phase",
          riskWeight: 2,
          ifDetected: "펌프 단계 진입 여부를 외부에서 알 수 없음",
          fixSuggestion: "PhaseChanged 이벤트 emit 추가"
        }
      ],
      riskLevels: {
        CRITICAL: { minScore: 9,  label: "배포 불가 — 피해 설계 명확",  color: "red"    },
        HIGH:     { minScore: 5,  label: "수정 후 재검토",               color: "orange" },
        MEDIUM:   { minScore: 2,  label: "모니터링 필요",                color: "yellow" },
        LOW:      { minScore: 0,  label: "정상 구조",                    color: "green"  }
      }
    }
  }
};