// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NormalStaking
 * @notice 학습용 정상 스테이킹 컨트랙트
 *
 * 구조: 컨트랙트 자체 보유 보상 풀에서 이자 지급
 * 관리자 전액 인출 불가 — 참여자 원금 보호
 */
contract NormalStaking {
    address public owner;

    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        bool exists;
    }

    mapping(address => Stake) public stakes;
    address[] public stakerList;

    uint256 public rewardPool;       // 관리자가 미리 충전한 보상 풀
    uint256 public totalStaked;
    uint256 public annualRate = 10;  // 연 10% (블록 기준으로 근사)
    uint256 public blocksPerYear = 100; // 시뮬레이션용 (실제론 약 2,102,400)

    event Staked(address indexed user, uint256 amount, uint256 blockNumber);
    event Unstaked(address indexed user, uint256 principal, uint256 reward, uint256 blockNumber);
    event RewardPoolFunded(uint256 amount, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() payable {
        owner = msg.sender;
        // 배포 시 보상 풀 초기 충전
        rewardPool = msg.value;
        emit RewardPoolFunded(msg.value, block.number);
    }

    // 보상 풀 추가 충전 (관리자)
    function fundRewardPool() external payable onlyOwner {
        rewardPool += msg.value;
        emit RewardPoolFunded(msg.value, block.number);
    }

    // 스테이킹
    function stake() external payable {
        require(msg.value > 0, "Send ETH");
        require(!stakes[msg.sender].exists || stakes[msg.sender].amount == 0, 
                "Already staking - unstake first");

        stakes[msg.sender] = Stake({
            amount: msg.value,
            stakedAt: block.number,
            exists: true
        });

        stakerList.push(msg.sender);
        totalStaked += msg.value;

        emit Staked(msg.sender, msg.value, block.number);
    }

    // 언스테이킹 (원금 + 블록 기반 보상)
    function unstake() external {
        Stake storage s = stakes[msg.sender];
        require(s.amount > 0, "Not staking");

        uint256 blocksStaked = block.number - s.stakedAt;
        // 보상 = 원금 × 연이율 × (경과블록/연간블록)
        uint256 reward = (s.amount * annualRate * blocksStaked) 
                         / (100 * blocksPerYear);

        // 보상 풀 초과 시 가능한 만큼만 (투명하게 처리)
        if (reward > rewardPool) {
            reward = rewardPool;
        }

        uint256 principal = s.amount;
        s.amount = 0;
        totalStaked -= principal;
        rewardPool -= reward;

        // 원금 + 보상 지급
        (bool success, ) = payable(msg.sender).call{value: principal + reward}("");
        require(success, "Transfer failed");

        emit Unstaked(msg.sender, principal, reward, block.number);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getStakerCount() external view returns (uint256) {
        return stakerList.length;
    }
}