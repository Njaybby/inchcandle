// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {LotVault} from "./LotVault.sol";

/// @title InchcandleVaultFactory
/// @notice Deploys one LotVault per auction lot and moves the lot into it in the same transaction.
/// @dev The vault address depends only on the seller and the room id, so a room can name its vault before the lot is deposited.
contract InchcandleVaultFactory {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ATTESTERS = 16;

    address public immutable implementation;

    event VaultOpened(
        address indexed vault,
        address indexed seller,
        bytes32 indexed roomId,
        LotVault.Standard standard,
        address token,
        uint256 id,
        uint256 amount,
        address[] attesters,
        uint8 threshold,
        uint64 settleBy
    );

    error BadThreshold();
    error BadAttesters();
    error BadDeadline();
    error BadAsset();

    /// Pass zero to deploy a fresh implementation here, or an existing LotVault where one transaction cannot hold both.
    constructor(address impl) {
        implementation = impl == address(0) ? address(new LotVault()) : impl;
    }

    function salt(address seller, bytes32 roomId) public pure returns (bytes32) {
        return keccak256(abi.encode(seller, roomId));
    }

    function predict(address seller, bytes32 roomId) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt(seller, roomId));
    }

    /// @notice Opens a vault for a room and deposits the lot from the caller.
    /// @dev The caller approves this factory for the token first. A native-coin lot is sent as the call's value.
    function open(
        bytes32 roomId,
        LotVault.Asset calldata asset,
        address[] calldata attesters,
        uint8 threshold,
        uint64 settleBy
    ) external payable returns (address vault) {
        if (threshold == 0 || threshold > attesters.length) revert BadThreshold();
        if (attesters.length > MAX_ATTESTERS) revert BadAttesters();
        for (uint256 i = 0; i < attesters.length; i++) {
            if (attesters[i] == address(0)) revert BadAttesters();
            for (uint256 j = 0; j < i; j++) {
                if (attesters[j] == attesters[i]) revert BadAttesters();
            }
        }
        if (settleBy <= block.timestamp) revert BadDeadline();
        if (asset.standard == LotVault.Standard.Native) {
            if (asset.amount == 0 || msg.value != asset.amount || asset.token != address(0)) revert BadAsset();
        } else {
            if (msg.value != 0 || asset.token == address(0) || asset.amount == 0) revert BadAsset();
            if (asset.standard == LotVault.Standard.ERC721 && asset.amount != 1) revert BadAsset();
        }

        vault = Clones.cloneDeterministic(implementation, salt(msg.sender, roomId));
        LotVault(payable(vault)).initialize(msg.sender, roomId, asset, attesters, threshold, settleBy);

        if (asset.standard == LotVault.Standard.ERC721) {
            IERC721(asset.token).safeTransferFrom(msg.sender, vault, asset.id);
        } else if (asset.standard == LotVault.Standard.ERC1155) {
            IERC1155(asset.token).safeTransferFrom(msg.sender, vault, asset.id, asset.amount, "");
        } else if (asset.standard == LotVault.Standard.ERC20) {
            IERC20(asset.token).safeTransferFrom(msg.sender, vault, asset.amount);
        } else {
            (bool ok,) = vault.call{value: msg.value}("");
            if (!ok) revert BadAsset();
        }

        emit VaultOpened(vault, msg.sender, roomId, asset.standard, asset.token, asset.id, asset.amount, attesters, threshold, settleBy);
    }
}
