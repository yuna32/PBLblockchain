// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PonziLabPatched
 * @notice 학습용 폰지 구조 컨트랙트 — 3가지 패치 적용 버전
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 패치 1: ownerWithdrawAll 에 10블록 타임락 적용
 * 패치 2: 단일 인출이 현재 잔고의 30% 초과 불가
 * 패치 3: 최소 입금액 0.1 ETH 강제
 */
contract PonziLabPatched {
    address public owner;
    uint256 public deployBlock;

    struct Participant {
        uint256 deposited;
        uint256 reward;
        bool exists;
    }

    mapping(address => Participant) public participants;
    address[] public participantList;

    uint256 public totalDeposited;
    uint256 public rewardRate = 10;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed user, uint256 amount, uint256 blockNumber);
    event OwnerWithdraw(address indexed owner, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        deployBlock = block.number;
    }

    // 패치 3: 최소 입금액 0.1 ETH 적용
    function participate() external payable {
        require(msg.value >= 0.1 ether, "Minimum deposit: 0.1 ETH");

        if (!participants[msg.sender].exists) {
            participantList.push(msg.sender);
            participants[msg.sender].exists = true;
        }

        participants[msg.sender].deposited += msg.value;
        participants[msg.sender].reward += (msg.value * rewardRate) / 100;
        totalDeposited += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    function withdraw() external {
        Participant storage p = participants[msg.sender];
        require(p.deposited > 0, "Nothing to withdraw");

        uint256 amount = p.deposited + p.reward;
        if (amount > address(this).balance) {
            amount = address(this).balance;
        }

        p.deposited = 0;
        p.reward = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount, block.number);
    }

    // 패치 1+2: 타임락 + 30% 인출 한도
    function ownerWithdrawAll() external onlyOwner {
        // 패치 1: 10블록 타임락
        require(block.number >= deployBlock + 10, "Timelock: wait 10 blocks after deploy");

        uint256 balance = address(this).balance;
        require(balance > 0, "Empty");

        // 패치 2: 단일 인출은 현재 잔고의 30% 초과 불가
        uint256 maxAllowed = balance * 30 / 100;
        require(balance <= maxAllowed, "Withdrawal exceeds 30% of balance limit");

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
