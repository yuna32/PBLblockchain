// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FlashLoanPattern
 * @notice 학습용 플래시론 공격 패턴 컨트랙트
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 구조: 한 블록 내에서 대규모 입금 + 즉시 전액 인출 반복
 * 핵심 패턴: max_single_tx == total_in (같은 블록), 잔고 누적 없음
 */
contract FlashLoanPattern {
    address public owner;

    mapping(address => uint256) public deposits;
    address[] public userList;
    mapping(address => bool) public hasInteracted;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed user, uint256 amount, uint256 blockNumber);

    constructor() {
        owner = msg.sender;
    }

    // 대규모 입금 (플래시론 시뮬레이션의 "대출" 단계)
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");

        if (!hasInteracted[msg.sender]) {
            userList.push(msg.sender);
            hasInteracted[msg.sender] = true;
        }

        deposits[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 즉시 전액 인출 (플래시론 "상환" 단계 — 같은 블록 내)
    function withdrawAll() external {
        uint256 amount = deposits[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        require(address(this).balance >= amount, "Insufficient balance");

        deposits[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getUserCount() external view returns (uint256) {
        return userList.length;
    }
}
