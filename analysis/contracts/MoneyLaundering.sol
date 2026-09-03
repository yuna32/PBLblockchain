// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MoneyLaundering
 * @notice 학습용 자금세탁 패턴 컨트랙트
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 구조: 다수 지갑이 소액을 분산 입금 (레이어링) → 단일 지갑이 전액 대규모 인출 (통합)
 * 핵심 패턴: unique_participants 급증 → max_single_tx 단발 폭발
 */
contract MoneyLaundering {
    address public owner;

    mapping(address => uint256) public deposits;
    address[] public depositorList;
    mapping(address => bool) public hasDeposited;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed recipient, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // 소액 분산 입금 — 다수 지갑이 각자 조금씩
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");

        if (!hasDeposited[msg.sender]) {
            depositorList.push(msg.sender);
            hasDeposited[msg.sender] = true;
        }

        deposits[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 집계 인출 — 단일 지갑(수취인)으로 전액 이체 (레이어링 완료)
    function withdrawAll(address payable recipient) external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");

        (bool success, ) = recipient.call{value: balance}("");
        require(success, "Transfer failed");

        emit Withdrawn(recipient, balance, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getDepositorCount() external view returns (uint256) {
        return depositorList.length;
    }
}
