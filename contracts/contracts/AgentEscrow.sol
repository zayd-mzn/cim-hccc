// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal ERC20 surface. On Hedera every HTS fungible token exposes this facade at its
/// EVM address (HIP-218 / HIP-376), so the contract talks to the credits token like an ERC20.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Hedera Token Service system contract (0x167). Only used to associate this contract
/// with the credits token; a contract must be associated before it can hold HTS tokens.
interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
}

/// Settlement + escrow for Agent Market.
/// Consumer pays into the contract against a jobId -> funds are HELD ->
/// Provider submits the delivery hash -> funds are RELEASED to the provider.
/// If the provider never delivers, the consumer can REFUND after the deadline.
contract AgentEscrow {
    enum Status { None, Held, Released, Refunded }

    struct Job {
        address consumer;
        address provider;
        uint256 amount;
        uint64 deadline;     // unix seconds; refund allowed after this
        Status status;
        bytes32 resultHash;  // sha256 of the delivered result (set on release)
    }

    address public constant HTS = address(0x167);
    int64 private constant SUCCESS = 22;
    int64 private constant ALREADY_ASSOCIATED = 194;

    IERC20 public immutable token;
    mapping(bytes32 => Job) public jobs;

    /// Proof events: x402 verification and the reputation engine key off these.
    event JobFunded(bytes32 indexed jobId, address indexed consumer, address indexed provider, uint256 amount, uint64 deadline);
    event JobReleased(bytes32 indexed jobId, address indexed provider, uint256 amount, bytes32 resultHash);
    event JobRefunded(bytes32 indexed jobId, address indexed consumer, uint256 amount);

    constructor(address token_) {
        token = IERC20(token_);
    }

    /// One-time: associate this contract with the credits token (HTS requirement).
    function associate() external {
        int64 rc = IHederaTokenService(HTS).associateToken(address(this), address(token));
        require(rc == SUCCESS || rc == ALREADY_ASSOCIATED, "associate failed");
    }

    /// Consumer pays into escrow. Needs a prior token allowance for this contract.
    function fund(bytes32 jobId, address provider, uint256 amount, uint64 deadline) external {
        require(jobs[jobId].status == Status.None, "job exists");
        require(amount > 0, "amount=0");
        require(provider != address(0) && provider != msg.sender, "bad provider");
        require(deadline > block.timestamp, "deadline in past");

        jobs[jobId] = Job(msg.sender, provider, amount, deadline, Status.Held, bytes32(0));
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit JobFunded(jobId, msg.sender, provider, amount, deadline);
    }

    /// Provider submits the delivery hash -> contract releases the held funds to the provider.
    function deliver(bytes32 jobId, bytes32 resultHash) external {
        Job storage j = jobs[jobId];
        require(j.status == Status.Held, "not held");
        require(msg.sender == j.provider, "only provider");
        require(resultHash != bytes32(0), "empty hash");

        j.status = Status.Released;
        j.resultHash = resultHash;
        require(token.transfer(j.provider, j.amount), "transfer failed");
        emit JobReleased(jobId, j.provider, j.amount, resultHash);
    }

    /// Consumer reclaims funds if the provider has not delivered by the deadline.
    function refund(bytes32 jobId) external {
        Job storage j = jobs[jobId];
        require(j.status == Status.Held, "not held");
        require(msg.sender == j.consumer, "only consumer");
        require(block.timestamp > j.deadline, "deadline not passed");

        j.status = Status.Refunded;
        require(token.transfer(j.consumer, j.amount), "transfer failed");
        emit JobRefunded(jobId, j.consumer, j.amount);
    }
}
