// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InchcandleVaultFactory} from "../src/InchcandleVaultFactory.sol";
import {LotVault} from "../src/LotVault.sol";
import {MockNFT, MockToken, MockEdition} from "./mocks/Mocks.sol";

contract LotVaultTest is Test {
    InchcandleVaultFactory factory;
    MockNFT nft;
    MockToken token;
    MockEdition edition;

    address seller = makeAddr("seller");
    uint256[3] attesterKeys = [uint256(0xA11CE), uint256(0xB0B), uint256(0xCA7)];
    address[] attesters;
    uint256 claimSecret = 0xC1A1;
    address claimKey;
    address destination = makeAddr("fresh destination");
    bytes32 roomId = keccak256("room abcdefghijkm");
    bytes32 resultHash = keccak256("judged bids");

    function setUp() public {
        factory = new InchcandleVaultFactory();
        nft = new MockNFT();
        token = new MockToken();
        edition = new MockEdition();
        for (uint256 i = 0; i < 3; i++) attesters.push(vm.addr(attesterKeys[i]));
        claimKey = vm.addr(claimSecret);
        nft.mint(seller, 7);
        token.mint(seller, 1_000 ether);
        edition.mint(seller, 3, 10);
        vm.deal(seller, 10 ether);
    }

    function openNft() internal returns (LotVault vault) {
        vm.startPrank(seller);
        nft.approve(address(factory), 7);
        vault = LotVault(payable(factory.open(roomId, LotVault.Asset(LotVault.Standard.ERC721, address(nft), 7, 1), attesters, 2, uint64(block.timestamp + 1 days))));
        vm.stopPrank();
    }

    function sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Signatures from the given attester indices, ordered by signer address as the vault requires.
    function quorum(bytes32 digest, uint256[] memory which) internal view returns (bytes[] memory sigs) {
        uint256[] memory keys = new uint256[](which.length);
        for (uint256 i = 0; i < which.length; i++) keys[i] = attesterKeys[which[i]];
        for (uint256 i = 0; i < keys.length; i++) {
            for (uint256 j = i + 1; j < keys.length; j++) {
                if (vm.addr(keys[j]) < vm.addr(keys[i])) (keys[i], keys[j]) = (keys[j], keys[i]);
            }
        }
        sigs = new bytes[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) sigs[i] = sign(keys[i], digest);
    }

    function two() internal pure returns (uint256[] memory w) {
        w = new uint256[](2);
        w[0] = 0;
        w[1] = 2;
    }

    function test_vaultAddressIsKnownBeforeDeposit() public {
        address predicted = factory.predict(seller, roomId);
        LotVault vault = openNft();
        assertEq(address(vault), predicted);
        assertEq(nft.ownerOf(7), address(vault));
        assertEq(uint8(vault.state()), uint8(LotVault.State.Held));
    }

    function test_settleThenClaimToAFreshAddress() public {
        LotVault vault = openNft();
        vault.settle(claimKey, 19_2000_0000, resultHash, quorum(vault.settlementDigest(claimKey, 19_2000_0000, resultHash), two()));
        assertEq(vault.claimKey(), claimKey);
        // A stranger submits the winner's signed claim; the lot still goes where the winner chose.
        vm.prank(makeAddr("relay"));
        vault.claim(destination, sign(claimSecret, vault.claimDigest(destination)));
        assertEq(nft.ownerOf(7), destination);
        assertEq(uint8(vault.state()), uint8(LotVault.State.Claimed));
    }

    function test_oneSignatureIsNotAQuorum() public {
        LotVault vault = openNft();
        uint256[] memory one = new uint256[](1);
        one[0] = 1;
        bytes32 digest = vault.settlementDigest(claimKey, 1, resultHash);
        vm.expectRevert(abi.encodeWithSelector(LotVault.NotEnoughSignatures.selector, 1, 2));
        vault.settle(claimKey, 1, resultHash, quorum(digest, one));
    }

    function test_theSameAttesterTwiceIsNotAQuorum() public {
        LotVault vault = openNft();
        bytes32 digest = vault.settlementDigest(claimKey, 1, resultHash);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sign(attesterKeys[0], digest);
        sigs[1] = sign(attesterKeys[0], digest);
        vm.expectRevert(LotVault.SignersNotAscending.selector);
        vault.settle(claimKey, 1, resultHash, sigs);
    }

    function test_outsidersCannotAttest() public {
        LotVault vault = openNft();
        bytes32 digest = vault.settlementDigest(claimKey, 1, resultHash);
        bytes[] memory sigs = quorum(digest, two());
        sigs[0] = sign(0xBAD, digest);
        vm.expectPartialRevert(LotVault.UnknownSigner.selector);
        vault.settle(claimKey, 1, resultHash, sigs);
    }

    function test_aSettlementForOneResultDoesNotSettleAnother() public {
        LotVault vault = openNft();
        bytes[] memory sigs = quorum(vault.settlementDigest(claimKey, 1, resultHash), two());
        vm.expectPartialRevert(LotVault.UnknownSigner.selector);
        vault.settle(makeAddr("attacker key"), 1, resultHash, sigs);
    }

    function test_signaturesForAnotherVaultDoNotWork() public {
        LotVault vault = openNft();
        vm.startPrank(seller);
        token.approve(address(factory), 5 ether);
        LotVault other = LotVault(payable(factory.open(keccak256("another room"), LotVault.Asset(LotVault.Standard.ERC20, address(token), 0, 5 ether), attesters, 2, uint64(block.timestamp + 1 days))));
        vm.stopPrank();
        bytes[] memory sigs = quorum(other.settlementDigest(claimKey, 1, resultHash), two());
        vm.expectPartialRevert(LotVault.UnknownSigner.selector);
        vault.settle(claimKey, 1, resultHash, sigs);
    }

    function test_onlyTheClaimKeyChoosesTheDestination() public {
        LotVault vault = openNft();
        vault.settle(claimKey, 1, resultHash, quorum(vault.settlementDigest(claimKey, 1, resultHash), two()));
        bytes32 digest = vault.claimDigest(destination);
        bytes memory forged = sign(0xBEEF, digest);
        vm.expectRevert(LotVault.WrongClaimSignature.selector);
        vault.claim(destination, forged);
        // The winner's signature for one address does not send the lot to another.
        bytes memory sig = sign(claimSecret, digest);
        vm.expectRevert(LotVault.WrongClaimSignature.selector);
        vault.claim(makeAddr("thief"), sig);
        vault.claim(destination, sig);
        vm.expectRevert(abi.encodeWithSelector(LotVault.WrongState.selector, LotVault.State.Claimed));
        vault.claim(destination, sig);
    }

    function test_noSaleReturnsTheLot() public {
        LotVault vault = openNft();
        vault.settleNoSale(resultHash, quorum(vault.noSaleDigest(resultHash), two()));
        assertEq(nft.ownerOf(7), seller);
        assertEq(uint8(vault.state()), uint8(LotVault.State.Returned));
    }

    function test_sellerReclaimsOnlyAfterTheDeadline() public {
        LotVault vault = openNft();
        vm.prank(seller);
        vm.expectPartialRevert(LotVault.TooEarly.selector);
        vault.reclaim();
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(makeAddr("not seller"));
        vm.expectRevert(LotVault.OnlySeller.selector);
        vault.reclaim();
        vm.prank(seller);
        vault.reclaim();
        assertEq(nft.ownerOf(7), seller);
        bytes[] memory sigs = quorum(vault.settlementDigest(claimKey, 1, resultHash), two());
        vm.expectRevert(abi.encodeWithSelector(LotVault.WrongState.selector, LotVault.State.Returned));
        vault.settle(claimKey, 1, resultHash, sigs);
    }

    function test_tokensEditionsAndNativeCoins() public {
        vm.startPrank(seller);
        token.approve(address(factory), 250 ether);
        LotVault t = LotVault(payable(factory.open(keccak256("t"), LotVault.Asset(LotVault.Standard.ERC20, address(token), 0, 250 ether), attesters, 2, uint64(block.timestamp + 1 days))));
        edition.setApprovalForAll(address(factory), true);
        LotVault e = LotVault(payable(factory.open(keccak256("e"), LotVault.Asset(LotVault.Standard.ERC1155, address(edition), 3, 4), attesters, 2, uint64(block.timestamp + 1 days))));
        LotVault n = LotVault(payable(factory.open{value: 2 ether}(keccak256("n"), LotVault.Asset(LotVault.Standard.Native, address(0), 0, 2 ether), attesters, 2, uint64(block.timestamp + 1 days))));
        vm.stopPrank();
        LotVault[3] memory vaults = [t, e, n];
        for (uint256 i = 0; i < 3; i++) {
            vaults[i].settle(claimKey, 1, resultHash, quorum(vaults[i].settlementDigest(claimKey, 1, resultHash), two()));
            vaults[i].claim(destination, sign(claimSecret, vaults[i].claimDigest(destination)));
        }
        assertEq(token.balanceOf(destination), 250 ether);
        assertEq(edition.balanceOf(destination, 3), 4);
        assertEq(destination.balance, 2 ether);
    }

    function test_factoryRejectsBadVaults() public {
        vm.startPrank(seller);
        nft.approve(address(factory), 7);
        LotVault.Asset memory a = LotVault.Asset(LotVault.Standard.ERC721, address(nft), 7, 1);
        vm.expectRevert(InchcandleVaultFactory.BadThreshold.selector);
        factory.open(roomId, a, attesters, 4, uint64(block.timestamp + 1));
        address[] memory dup = new address[](2);
        dup[0] = attesters[0];
        dup[1] = attesters[0];
        vm.expectRevert(InchcandleVaultFactory.BadAttesters.selector);
        factory.open(roomId, a, dup, 1, uint64(block.timestamp + 1));
        vm.expectRevert(InchcandleVaultFactory.BadDeadline.selector);
        factory.open(roomId, a, attesters, 2, uint64(block.timestamp));
        vm.expectRevert(InchcandleVaultFactory.BadAsset.selector);
        factory.open{value: 1}(roomId, a, attesters, 2, uint64(block.timestamp + 1));
        vm.stopPrank();
        LotVault implementation = LotVault(payable(factory.implementation()));
        vm.expectRevert(LotVault.AlreadyInitialized.selector);
        implementation.initialize(seller, roomId, a, attesters, 2, 1);
    }
}
