// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EvasiveContract
 * @notice Red-team research contract — Hardhat local network only, never deploy to mainnet.
 *
 * All functions use action names that ARE inside WITHDRAW_ACTIONS / DEPOSIT_ACTIONS.
 * Evasion operates purely through indicator-design and rule-threshold weaknesses:
 *
 *   Scenario A (분산 출금) — FLOW_SPIKE tracks maxSingleWithdraw, not cumulative total.
 *     Splitting 9.6 ETH across 4 × 2.4 ETH "withdraw" txs to 4 fresh addresses keeps
 *     each transfer below the 50% threshold and top-3 concentration below 80%.
 *     → dynamic risk score: 0 / LOW_RISK
 *
 *   Scenario B (임계값 절벽) — BALANCE_DROP has a hard 90% cliff.
 *     Extracting 89% (8.9 ETH, leaving 1.1 ETH) places finalBal just above
 *     peak×0.1 = 1.0 ETH, silencing the highest-weight rule (+45) entirely.
 *     → BALANCE_DROP misses; score 65 via FLOW_SPIKE+CONCENTRATION_DRAIN only.
 *
 *   Scenario C (점수 가중치 격차) — CONCENTRATION_DRAIN+PROFIT_EXTRACTION = 60 pts,
 *     5 short of the HIGH_RISK threshold of 65.  BALANCE_DROP gates on the literal
 *     "owner_withdraw_all" action string, so using "withdraw" suppresses hasOwnerDrain.
 *     A 50-block delay between deposit and drain phases is invisible to all rules.
 *     → 96% extraction → 60 / MEDIUM_RISK
 */
contract EvasiveContract {
    address public owner;

    uint256 public participantCount;
    mapping(address => bool) public participated;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed to, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// Participant entry — logged as "deposit"; increments participantCount.
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");
        if (!participated[msg.sender]) {
            participated[msg.sender] = true;
            participantCount++;
        }
        emit Deposited(msg.sender, msg.value, block.number);
    }

    /// Owner extraction — simulation script controls the action label ("withdraw" or
    /// "owner_withdraw_all") written to the CSV log; the contract is label-agnostic.
    function withdrawTo(address to, uint256 amount) external onlyOwner {
        require(to != address(0) && amount > 0 && amount <= address(this).balance, "Invalid");
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(to, amount, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getParticipantCount() external view returns (uint256) {
        return participantCount;
    }
}
