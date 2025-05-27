// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract PaymentChannel {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    
    enum StateChannel { EMPTY, ACTIVE, CLOSING, CLOSED }
    
    address public partA;
    address public partB;
    uint256 public amount;
    StateChannel public state;
    uint256 public closingBlock;
    uint256 public nonce;
    uint256 public balanceA;
    uint256 public balanceB;
    
    IERC20 public thdToken;
    uint256 public constant CHALLENGE_PERIOD = 24; // 24 blocks
    
    mapping(address => uint256) public deposits;
    
    event ChannelOpened(address partA, address partB, uint256 amount);
    event ChannelFunded(address participant, uint256 amount);
    event ChannelClosing(uint256 nonce, uint256 balanceA, uint256 balanceB);
    event ChannelClosed();
    event ChallengeMade(uint256 newNonce, uint256 newBalanceA, uint256 newBalanceB);
    event FundsWithdrawn(address participant, uint256 amount);
    
    constructor(address _partA, address _partB, uint256 _amount, address _thdToken) {
        partA = _partA;
        partB = _partB;
        amount = _amount;
        thdToken = IERC20(_thdToken);
        state = StateChannel.EMPTY;
        nonce = 0;
        balanceA = _amount / 2;
        balanceB = _amount / 2;
        
        emit ChannelOpened(_partA, _partB, _amount);
    }
    
    function fund() external {
        require(state == StateChannel.EMPTY || state == StateChannel.ACTIVE, "Cannot fund in current state");
        require(msg.sender == partA || msg.sender == partB, "Not a channel participant");
        
        uint256 expectedDeposit = amount / 2;
        require(deposits[msg.sender] == 0, "Already funded");
        
        require(thdToken.transferFrom(msg.sender, address(this), expectedDeposit), "Transfer failed");
        deposits[msg.sender] = expectedDeposit;
        
        emit ChannelFunded(msg.sender, expectedDeposit);
        
        // Check if both parties have funded
        if (deposits[partA] > 0 && deposits[partB] > 0) {
            state = StateChannel.ACTIVE;
        }
    }
    
    function message(uint256 _nonce, uint256 _balanceA, uint256 _balanceB) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_nonce, _balanceA, _balanceB));
    }
    
    function closing(uint256 _nonce, uint256 _balanceA, uint256 _balanceB, bytes memory _signature) external {
        require(state == StateChannel.ACTIVE, "Channel not active");
        require(msg.sender == partA || msg.sender == partB, "Not a channel participant");
        require(_balanceA + _balanceB == amount, "Balances don't sum to total amount");
        
        bytes32 messageHash = message(_nonce, _balanceA, _balanceB);
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        address signer = ethSignedMessageHash.recover(_signature);
        address otherParty = (msg.sender == partA) ? partB : partA;
        require(signer == otherParty, "Invalid signature");
        
        state = StateChannel.CLOSING;
        closingBlock = block.number;
        nonce = _nonce;
        balanceA = _balanceA;
        balanceB = _balanceB;
        
        emit ChannelClosing(_nonce, _balanceA, _balanceB);
    }
    
    function challenge(uint256 _nonce, uint256 _balanceA, uint256 _balanceB, bytes memory _signature) external {
        require(state == StateChannel.CLOSING, "Channel not closing");
        require(_nonce > nonce, "Nonce not higher");
        require(_balanceA + _balanceB == amount, "Balances don't sum to total amount");
        require(block.number <= closingBlock + CHALLENGE_PERIOD, "Challenge period expired");
        
        bytes32 messageHash = message(_nonce, _balanceA, _balanceB);
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        address signer = ethSignedMessageHash.recover(_signature);
        require(signer == partA || signer == partB, "Invalid signature");
        
        // Update to newer state
        nonce = _nonce;
        balanceA = _balanceA;
        balanceB = _balanceB;
        
        emit ChallengeMade(_nonce, _balanceA, _balanceB);
    }
    
    function withdraw() external {
        require(state == StateChannel.CLOSING, "Channel not in closing state");
        require(block.number > closingBlock + CHALLENGE_PERIOD, "Challenge period not expired");
        require(msg.sender == partA || msg.sender == partB, "Not a channel participant");
        
        state = StateChannel.CLOSED;
        
        if (balanceA > 0) {
            require(thdToken.transfer(partA, balanceA), "Transfer to partA failed");
            emit FundsWithdrawn(partA, balanceA);
        }
        
        if (balanceB > 0) {
            require(thdToken.transfer(partB, balanceB), "Transfer to partB failed");
            emit FundsWithdrawn(partB, balanceB);
        }
        
        emit ChannelClosed();
    }
    
    function getChannelInfo() external view returns (
        StateChannel _state,
        uint256 _amount,
        uint256 _balanceA,
        uint256 _balanceB,
        uint256 _nonce,
        uint256 _closingBlock
    ) {
        return (state, amount, balanceA, balanceB, nonce, closingBlock);
    }
}