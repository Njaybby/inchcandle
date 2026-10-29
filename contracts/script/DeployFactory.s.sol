// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {InchcandleVaultFactory} from "../src/InchcandleVaultFactory.sol";

/// Deploys only the factory, for a public chain.
contract DeployFactory is Script {
    function run() external returns (InchcandleVaultFactory factory) {
        vm.startBroadcast();
        factory = new InchcandleVaultFactory(address(0));
        vm.stopBroadcast();
        console.log("factory", address(factory));
        console.log("implementation", factory.implementation());
    }
}
