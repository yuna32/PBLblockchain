// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RugPull
 * @notice 학습용 러그풀 컨트랙트
 * 실제 배포 금지 — 교육 목적 전용
 *
 * 구조: 참여자들이 꾸준히 입금 → 잔고 최대치 도달 → 오너가 전액 단번에 인출
 * 핵심 패턴: 누적 잔고 역V자 곡선, 피크에서 max_single_tx 폭발
 */
contract RugPull {
    address public owner;

    struct Depositor {
        uint256 deposited;
        bool exists;
    }

    mapping(address => Depositor) public depositors;
    address[] public depositorList;

    uint256 public totalDeposited;
    bool public rugPulled;

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event OwnerWithdraw(address indexed owner, uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // 참여자 입금 — 잔고 점진 축적
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");
        require(!rugPulled, "Already rug pulled");

        if (!depositors[msg.sender].exists) {
            depositorList.push(msg.sender);
            depositors[msg.sender].exists = true;
        }

        depositors[msg.sender].deposited += msg.value;
        totalDeposited += msg.value;

        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 오너 전액 단번 인출 — 러그풀 트리거 (중간 인출 없음)
    function rugPullAll() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to pull");

        rugPulled = true;

        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Transfer failed");

        emit OwnerWithdraw(owner, balance, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getDepositorCount() external view returns (uint256) {
        return depositorList.length;
    }
}
