// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {InchcandleVaultFactory} from "../src/InchcandleVaultFactory.sol";
import {LotVault} from "../src/LotVault.sol";
import {DemoLot, DemoToken, DemoEdition} from "../src/DemoLots.sol";

/// Deploys the factory and the three demo collections to a test network and records them in deployments/<chain id>.json.
/// The implementation goes out on its own because Ethereum Sepolia charges too much per byte of code for one transaction to deploy both.
contract DeployTestnet is Script {
    function run() external {
        vm.startBroadcast();
        LotVault implementation = new LotVault();
        InchcandleVaultFactory factory = new InchcandleVaultFactory(address(implementation));
        DemoLot nft = new DemoLot();
        DemoToken token = new DemoToken();
        DemoEdition edition = new DemoEdition();
        vm.stopBroadcast();

        string memory json = "testnet";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "implementation", factory.implementation());
        vm.serializeAddress(json, "nft", address(nft));
        vm.serializeAddress(json, "token", address(token));
        string memory out = vm.serializeAddress(json, "edition", address(edition));
        vm.writeJson(out, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console.log("factory", address(factory));
    }
}
