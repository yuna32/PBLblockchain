// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PonziLab
 * @notice 학습용 폰지 구조 컨트랙트
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 구조: 신규 참여자의 입금이 기존 참여자의 수익 재원
 * 관리자는 언제든 전액 인출 가능 (러그풀 취약점 내포)
 */
contract PonziLab {
    address public owner;

    struct Participant {
        uint256 deposited;
        uint256 reward;
        bool exists;
    }

    mapping(address => Participant) public participants;
    address[] public participantList;

    uint256 public totalDeposited;
    uint256 public rewardRate = 10; // 10% 수익 약속

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed user, uint256 amount, uint256 blockNumber);
    event OwnerWithdraw(address indexed owner, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // 참여자 입금
    function participate() external payable {
        require(msg.value > 0, "Send ETH");

        if (!participants[msg.sender].exists) {
            participantList.push(msg.sender);
            participants[msg.sender].exists = true;
        }

        participants[msg.sender].deposited += msg.value;
        // 10% 수익을 "약속"만 함 — 실제론 신규 입금으로 지급
        participants[msg.sender].reward += (msg.value * rewardRate) / 100;
        totalDeposited += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 참여자 출금 (원금 + 수익 — 컨트랙트 잔고가 있을 때만)
    function withdraw() external {
        Participant storage p = participants[msg.sender];
        require(p.deposited > 0, "Nothing to withdraw");

        uint256 amount = p.deposited + p.reward;
        
        // 잔고 부족 시 있는 만큼만 지급 (폰지의 핵심 취약점)
        if (amount > address(this).balance) {
            amount = address(this).balance;
        }

        p.deposited = 0;
        p.reward = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount, block.number);
    }

    // 관리자 전액 인출 (러그풀 트리거)
    function ownerWithdrawAll() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Empty");

        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Transfer failed");

        emit OwnerWithdraw(owner, balance, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getParticipantCount() external view returns (uint256) {
        return participantList.length;
    }
}