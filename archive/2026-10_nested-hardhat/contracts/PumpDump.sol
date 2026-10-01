// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PumpDump
 * @notice 학습용 펌프앤덤프 패턴 컨트랙트
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 구조: 내부자(인사이더)가 대량 입금으로 풀 팽창(pump) →
 *       외부 후발자 유입 → 내부자가 자신의 몫보다 더 많이 인출(dump) →
 *       후발자는 잔고 부족으로 손실
 * 핵심 패턴: net_flow 급격한 진동, 후발자 출금액 = 0
 */
contract PumpDump {
    address public owner;

    mapping(address => bool) public isInsider;
    mapping(address => uint256) public deposits;
    address[] public participantList;
    mapping(address => bool) public hasParticipated;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event Withdrawn(address indexed user, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // 내부자 등록 (오너만)
    function addInsider(address user) external onlyOwner {
        isInsider[user] = true;
    }

    // 입금 (내부자 + 후발자 공통)
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");

        if (!hasParticipated[msg.sender]) {
            participantList.push(msg.sender);
            hasParticipated[msg.sender] = true;
        }

        deposits[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 내부자 전용 인출 — 컨트랙트 잔고 기준으로 인출 (자신의 입금액 초과 가능)
    function insiderWithdraw(uint256 amount) external {
        require(isInsider[msg.sender], "Not insider");
        require(address(this).balance >= amount, "Insufficient contract balance");

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount, block.number);
    }

    // 일반 참여자 인출 — 잔고 부족 시 가능한 만큼만 (손실 발생 지점)
    function withdraw() external {
        uint256 owed = deposits[msg.sender];
        require(owed > 0, "Nothing to withdraw");

        uint256 contractBalance = address(this).balance;
        uint256 payout = owed <= contractBalance ? owed : contractBalance;

        deposits[msg.sender] = 0;

        if (payout > 0) {
            (bool success, ) = payable(msg.sender).call{value: payout}("");
            require(success, "Transfer failed");
        }

        emit Withdrawn(msg.sender, payout, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getParticipantCount() external view returns (uint256) {
        return participantList.length;
    }
}
