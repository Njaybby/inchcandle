// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title LotVault
/// @notice Holds one auction lot for an Inchcandle room until the room's result is attested.
/// @dev Deployed as a minimal proxy by InchcandleVaultFactory, one per lot.
/// A settlement needs signatures from at least `threshold` of the vault's attesters over the room id, the winning claim key, the price and the result hash.
/// The winner then signs the destination with the claim key, and anyone may submit that signature.
/// If nobody settles by `settleBy`, the seller can take the lot back.
contract LotVault is ERC721Holder, ERC1155Holder {
    using SafeERC20 for IERC20;

    enum Standard {
        ERC721,
        ERC1155,
        ERC20,
        Native
    }

    enum State {
        Empty,
        Held,
        Settled,
        Claimed,
        Returned
    }

    struct Asset {
        Standard standard;
        address token;
        uint256 id;
        uint256 amount;
    }

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Inchcandle Vault");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant SETTLEMENT_TYPEHASH =
        keccak256("Settlement(bytes32 roomId,address claimKey,uint256 price,bytes32 resultHash)");
    bytes32 public constant NO_SALE_TYPEHASH = keccak256("NoSale(bytes32 roomId,bytes32 resultHash)");
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address destination)");

    address public factory;
    address public seller;
    bytes32 public roomId;
    Asset public asset;
    uint64 public settleBy;
    uint8 public threshold;
    State public state;
    address public claimKey;
    uint256 public price;
    bytes32 public resultHash;
    address public recipient;

    address[] private _attesters;
    mapping(address => bool) public isAttester;

    event Settled(address indexed claimKey, uint256 price, bytes32 resultHash);
    event NoSale(bytes32 resultHash);
    event Claimed(address indexed destination);
    event Returned(address indexed seller);

    error AlreadyInitialized();
    error OnlyFactory();
    error WrongState(State current);
    error NotEnoughSignatures(uint256 valid, uint256 needed);
    error SignersNotAscending();
    error UnknownSigner(address signer);
    error WrongClaimSignature();
    error OnlySeller();
    error TooEarly(uint64 settleBy);
    error ZeroAddress();
    error NativeTransferFailed();

    constructor() {
        // The implementation itself can never hold a lot.
        factory = address(1);
    }

    /// @notice Called once by the factory in the transaction that deploys this vault and moves the lot into it.
    function initialize(
        address seller_,
        bytes32 roomId_,
        Asset calldata asset_,
        address[] calldata attesters_,
        uint8 threshold_,
        uint64 settleBy_
    ) external {
        if (factory != address(0)) revert AlreadyInitialized();
        factory = msg.sender;
        seller = seller_;
        roomId = roomId_;
        asset = asset_;
        threshold = threshold_;
        settleBy = settleBy_;
        for (uint256 i = 0; i < attesters_.length; i++) {
            _attesters.push(attesters_[i]);
            isAttester[attesters_[i]] = true;
        }
        state = State.Held;
    }

    function attesters() external view returns (address[] memory) {
        return _attesters;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function settlementDigest(address claimKey_, uint256 price_, bytes32 resultHash_) public view returns (bytes32) {
        return _typed(keccak256(abi.encode(SETTLEMENT_TYPEHASH, roomId, claimKey_, price_, resultHash_)));
    }

    function noSaleDigest(bytes32 resultHash_) public view returns (bytes32) {
        return _typed(keccak256(abi.encode(NO_SALE_TYPEHASH, roomId, resultHash_)));
    }

    function claimDigest(address destination) public view returns (bytes32) {
        return _typed(keccak256(abi.encode(CLAIM_TYPEHASH, destination)));
    }

    /// @notice Records the winner's claim key once enough attesters agree on the result.
    /// @param signatures Attester signatures over the settlement digest, ordered by signer address, lowest first.
    function settle(address claimKey_, uint256 price_, bytes32 resultHash_, bytes[] calldata signatures) external {
        if (state != State.Held) revert WrongState(state);
        if (claimKey_ == address(0)) revert ZeroAddress();
        _checkQuorum(settlementDigest(claimKey_, price_, resultHash_), signatures);
        state = State.Settled;
        claimKey = claimKey_;
        price = price_;
        resultHash = resultHash_;
        emit Settled(claimKey_, price_, resultHash_);
    }

    /// @notice Returns the lot to the seller once enough attesters agree that nothing sold.
    function settleNoSale(bytes32 resultHash_, bytes[] calldata signatures) external {
        if (state != State.Held) revert WrongState(state);
        _checkQuorum(noSaleDigest(resultHash_), signatures);
        state = State.Returned;
        resultHash = resultHash_;
        emit NoSale(resultHash_);
        _send(seller);
        emit Returned(seller);
    }

    /// @notice Sends the lot to the destination the winner signed with the claim key. Anyone may submit it.
    function claim(address destination, bytes calldata signature) external {
        if (state != State.Settled) revert WrongState(state);
        if (destination == address(0)) revert ZeroAddress();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(claimDigest(destination), signature);
        if (err != ECDSA.RecoverError.NoError || signer != claimKey) revert WrongClaimSignature();
        state = State.Claimed;
        recipient = destination;
        emit Claimed(destination);
        _send(destination);
    }

    /// @notice Gives the lot back to the seller when nobody settled the room in time.
    function reclaim() external {
        if (msg.sender != seller) revert OnlySeller();
        if (state != State.Held) revert WrongState(state);
        if (block.timestamp <= settleBy) revert TooEarly(settleBy);
        state = State.Returned;
        emit Returned(seller);
        _send(seller);
    }

    function _typed(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _checkQuorum(bytes32 digest, bytes[] calldata signatures) private view {
        address last;
        uint256 valid;
        for (uint256 i = 0; i < signatures.length; i++) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signatures[i]);
            if (err != ECDSA.RecoverError.NoError || !isAttester[signer]) revert UnknownSigner(signer);
            if (signer <= last) revert SignersNotAscending();
            last = signer;
            valid++;
        }
        if (valid < threshold) revert NotEnoughSignatures(valid, threshold);
    }

    function _send(address to) private {
        Asset memory a = asset;
        if (a.standard == Standard.ERC721) {
            IERC721(a.token).safeTransferFrom(address(this), to, a.id);
        } else if (a.standard == Standard.ERC1155) {
            IERC1155(a.token).safeTransferFrom(address(this), to, a.id, a.amount, "");
        } else if (a.standard == Standard.ERC20) {
            IERC20(a.token).safeTransfer(to, a.amount);
        } else {
            (bool ok,) = to.call{value: a.amount}("");
            if (!ok) revert NativeTransferFailed();
        }
    }

    receive() external payable {
        if (msg.sender != factory) revert OnlyFactory();
    }
}
