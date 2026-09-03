"""
Task 2: Build fraud.owl from scratch using owlready2.
Mirrors the class/property structure in analysis/fraud_ontology.js.
"""
from owlready2 import *

onto = get_ontology("http://fraud-detection.local/fraud.owl#")

with onto:

    # ── Top-level contract classes ─────────────────────────────────────────────
    class FraudContract(Thing):
        comment = ["블록체인 사기 컨트랙트 최상위 개념"]

    class NormalContract(Thing):
        comment = ["정상 컨트랙트"]

    class FundMovementFraud(FraudContract):
        comment = ["자금 이동 기반 사기 (잔고 유출 공통)"]

    class FundFreezeFraud(FraudContract):
        comment = ["자금 동결 기반 사기 (출금 차단)"]

    # ── Fraud type classes (from fraudTypes in fraud_ontology.js) ──────────────
    class PonziScheme(FundMovementFraud):
        comment = ["폰지 사기: 신규 입금으로 기존 참여자 수익 지급"]

    class RugPull(FundMovementFraud):
        comment = ["러그풀: 잔고 정점에서 단 1회 전액 인출"]

    class PumpAndDump(FundMovementFraud):
        comment = ["펌프앤덤프: 내부자 부양 후 대량 인출"]

    class MoneyLaundering(FundMovementFraud):
        comment = ["자금세탁: 다수 입금 → 단일 주소 전액 출금"]

    class HoneyPot(FundFreezeFraud):
        comment = ["허니팟: 입금은 가능하나 출금이 항상 실패"]

    # ── Evasion subclasses (from evasionSubclasses in fraud_ontology.js) ───────
    class PonziScheme_BalanceDropEvasion(PonziScheme):
        comment = ["잔고 급락 회피형 폰지: 단일 인출 80% 미만 분할"]

    class PonziScheme_MaxTxEvasion(PonziScheme):
        comment = ["최대 거래 회피형 폰지: 반복 인출로 경보 우회"]

    class PonziScheme_SlowDrain(PonziScheme):
        comment = ["시간 분산 회피형 폰지: 인출 블록 구간 30%+ 분산"]

    class RugPull_BalanceDropEvasion(RugPull):
        comment = ["잔고 급락 회피형 러그풀"]

    class RugPull_MaxTxEvasion(RugPull):
        comment = ["최대 거래 회피형 러그풀"]

    class RugPull_SlowDrain(RugPull):
        comment = ["시간 분산 회피형 러그풀"]

    class MoneyLaundering_BalanceDropEvasion(MoneyLaundering):
        comment = ["잔고 급락 회피형 세탁"]

    class MoneyLaundering_MaxTxEvasion(MoneyLaundering):
        comment = ["최대 거래 회피형 세탁"]

    class MoneyLaundering_SlowDrain(MoneyLaundering):
        comment = ["시간 분산 회피형 세탁"]

    class MoneyLaundering_HopLaundering(MoneyLaundering):
        comment = ["중간 경유 지갑형 세탁: 입금/출금 주소 불일치"]

    class PumpDump_BalanceDropEvasion(PumpAndDump):
        comment = ["잔고 급락 회피형 펌프앤덤프"]

    class PumpDump_MaxTxEvasion(PumpAndDump):
        comment = ["최대 거래 회피형 펌프앤덤프"]

    class PumpDump_SlowDrain(PumpAndDump):
        comment = ["시간 분산 회피형 펌프앤덤프"]

    class PumpDump_DistributedDump(PumpAndDump):
        comment = ["분산 덤프형 펌프앤덤프: 위장 외부자 주소 사용"]

    # ── Anomaly signal classes (from anomalySignals in fraud_ontology.js) ──────
    class AnomalySignal(Thing):
        comment = ["이상 신호 지표 최상위 개념"]

    class BalanceDrop(AnomalySignal):
        comment = ["오너 액션으로 잔고 80%+ 급락"]

    class FlowSpike(AnomalySignal):
        comment = ["단일 출금이 총 입금의 50%+"]

    class MaxTxAlert(AnomalySignal):
        comment = ["단일 TX가 잔고의 90%+"]

    class ConcentrationDrain(AnomalySignal):
        comment = ["상위 3개 지갑이 총 출금의 80%+"]

    class ZeroWithdrawBlock(AnomalySignal):
        comment = ["출금 시도 있으나 성공 금액 0 지속"]

    class InputDataOpacity(AnomalySignal):
        comment = ["입력 데이터 불투명 (owner_collect 등)"]

    class InflowStop(AnomalySignal):
        comment = ["신규 입금 중단 (폰지 붕괴 신호)"]

    # ── Behavior pattern classes (aligned with hintFraudType conditions) ───────
    class BehaviorPattern(Thing):
        comment = ["행동 패턴 분류"]

    class ParticipantMidExit(BehaviorPattern):
        comment = ["참여자 중간 인출: 마지막 블록 이전 withdraw 존재"]

    class OwnerWithdrawAll(BehaviorPattern):
        comment = ["오너 전액 인출: 최대 인출 수령자가 예금자 목록에 없음"]

    class CollectorIsDepositor(BehaviorPattern):
        comment = ["수집자 = 입금자: 최대 인출 수령자가 예금자 목록에 포함 (자금세탁 지표)"]

    class DistributedInflow(BehaviorPattern):
        comment = ["분산 입금: 5개 이상 고유 입금 주소"]

    class SingleLargeOutflow(BehaviorPattern):
        comment = ["단일 대형 인출: 최대 단일 인출이 정점 잔고의 70%+"]

    class InsiderBulkDeposit(BehaviorPattern):
        comment = ["내부자 대량 입금 (펌프 단계)"]

    class InsiderExitSuccess(BehaviorPattern):
        comment = ["일부 인출 성공 (양수 금액)"]

    class WithdrawAttemptFail(BehaviorPattern):
        comment = ["인출 시도 실패 (금액=0): 허니팟 또는 후발자 손실"]

    class InflowContinues(BehaviorPattern):
        comment = ["첫 인출 시도 후에도 입금 계속"]

    # ── Evasion technique classes (from evasionTechniques in fraud_ontology.js) ─
    class EvasionTechnique(Thing):
        comment = ["탐지 회피 기법 최상위 개념"]

    class SplitWithdrawal(EvasionTechnique):
        comment = ["분할 인출: 단일 건이 잔고 80% 미만"]

    class RepeatedSmallWithdrawal(EvasionTechnique):
        comment = ["반복 소액 인출: 3회+ 인출, 단일 건 90% 미만"]

    class LongPeriodSplit(EvasionTechnique):
        comment = ["장기 분산 인출: 블록 구간 30%+ 걸쳐 인출"]

    class MultiWalletDispersion(EvasionTechnique):
        comment = ["다중 지갑 분산 (스머핑)"]

    class HopLaunderingTech(EvasionTechnique):
        comment = ["중간 경유 지갑 세탁 기법"]

    # ── Object properties ──────────────────────────────────────────────────────
    class hasSignal(ObjectProperty):
        domain = [FraudContract]
        range  = [AnomalySignal]
        comment = ["컨트랙트가 이상 신호를 보임"]

    class hasPattern(ObjectProperty):
        domain = [FraudContract]
        range  = [BehaviorPattern]
        comment = ["컨트랙트가 행동 패턴을 보임"]

    class usesEvasion(ObjectProperty):
        domain = [FraudContract]
        range  = [EvasionTechnique]
        comment = ["컨트랙트가 특정 회피 기법을 사용"]

    class classifiedAs(ObjectProperty):
        domain = [FraudContract]
        range  = [FraudContract]
        comment = ["추론된 사기 분류 (SWRL 규칙으로 도출)"]

    # triggers / implies (설계서 4-1, 4-3절 — v0.2 신규)
    # BehaviorPattern → AnomalySignal 인과관계. BehaviorPattern만 감지되어도
    # 대응 AnomalySignal 발생을 추론할 수 있도록 명시화한다.
    class triggers(ObjectProperty):
        domain = [BehaviorPattern]
        range  = [AnomalySignal]
        comment = ["특정 행동 패턴이 어떤 이상 신호를 유발함 (인과관계, v0.2 추가)"]

    class implies(ObjectProperty):
        domain = [BehaviorPattern]
        range  = [AnomalySignal]
        comment = ["특정 행동 패턴이 어떤 이상 신호를 함의함 (인과관계, v0.2 추가)"]

    # ── Data properties ────────────────────────────────────────────────────────
    class riskScore(DataProperty, FunctionalProperty):
        domain = [FraudContract]
        range  = [int]
        comment = ["예방 분석 위험 점수 (0-20)"]

    class riskLevel(DataProperty, FunctionalProperty):
        domain = [FraudContract]
        range  = [str]
        comment = ["위험 등급: CRITICAL/HIGH/MEDIUM/LOW/FILE_NOT_FOUND"]

    class contractAddress(DataProperty, FunctionalProperty):
        domain = [FraudContract]
        range  = [str]
        comment = ["컨트랙트 배포 주소 (0x...)"]

    class peakBalance(DataProperty, FunctionalProperty):
        domain = [FraudContract]
        range  = [float]
        comment = ["시뮬레이션 중 최고 잔고 (ETH)"]

    class finalBalance(DataProperty, FunctionalProperty):
        domain = [FraudContract]
        range  = [float]
        comment = ["시뮬레이션 종료 시 잔고 (ETH)"]

    # ── triggers / implies 인과관계 공리 (설계서 4-3절, v0.2 신규) ──────────────
    # BehaviorPattern 서브클래스가 대응 AnomalySignal 서브클래스를 triggers/implies
    # 하는 TBox 존재 제약(existential restriction). 분류 공리(5-1, 5-2)나 회피
    # 서브클래스 공리(5-3)와 독립적인 부가 공리이며 기존 추론 결과에 영향을 주지 않는다.
    #
    # WithdrawBlock(AnomalySignal) → implies → WithdrawAttemptFail(BehaviorPattern)
    # 원문 표기는 설계서 3-1 클래스 계층(WithdrawBlock=AnomalySignal,
    # WithdrawAttemptFail=BehaviorPattern)과 4-1 Domain/Range 표(Domain=BehaviorPattern)
    # 모두와 모순된다. 실제 구현체에는 "WithdrawBlock" 클래스 자체가 존재하지 않으므로,
    # 원인/결과를 3-1·4-1 기준에 맞춰 WithdrawAttemptFail(BehaviorPattern, 원인)
    # → implies → ZeroWithdrawBlock(AnomalySignal, 결과)로 정정하여 반영한다.
    OwnerWithdrawAll.is_a.append(triggers.some(BalanceDrop))
    SingleLargeOutflow.is_a.append(triggers.some(MaxTxAlert))
    ParticipantMidExit.is_a.append(triggers.some(FlowSpike))
    InsiderBulkDeposit.is_a.append(implies.some(InflowStop))
    WithdrawAttemptFail.is_a.append(implies.some(ZeroWithdrawBlock))

# ── Save ───────────────────────────────────────────────────────────────────────
import os
os.makedirs("ontology", exist_ok=True)
onto.save(file="ontology/fraud.owl", format="rdfxml")

size = os.path.getsize("ontology/fraud.owl")
print(f"fraud.owl saved  ({size:,} bytes)")
print(f"  Classes    : {len(list(onto.classes()))}")
print(f"  ObjectProps: {len(list(onto.object_properties()))}")
print(f"  DataProps  : {len(list(onto.data_properties()))}")
