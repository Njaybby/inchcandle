// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {InchcandleVaultFactory} from "../src/InchcandleVaultFactory.sol";
import {MockNFT, MockToken, MockEdition} from "../test/mocks/Mocks.sol";

/// Deploys the factory and three demo collections to a local anvil chain and mints demo lots to the first two dev accounts.
contract DeployLocal is Script {
    function run() external {
        address seller = vm.envOr("IC_DEV_SELLER", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        vm.startBroadcast();
        InchcandleVaultFactory factory = new InchcandleVaultFactory();
        MockNFT nft = new MockNFT();
        MockToken token = new MockToken();
        MockEdition edition = new MockEdition();
        for (uint256 id = 1; id <= 24; id++) nft.mint(seller, id);
        token.mint(seller, 1_000_000 ether);
        edition.mint(seller, 1, 100);
        vm.stopBroadcast();

        string memory json = "local";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "implementation", factory.implementation());
        vm.serializeAddress(json, "nft", address(nft));
        vm.serializeAddress(json, "token", address(token));
        string memory out = vm.serializeAddress(json, "edition", address(edition));
        vm.writeJson(out, "./deployments/anvil.json");
    }
}
