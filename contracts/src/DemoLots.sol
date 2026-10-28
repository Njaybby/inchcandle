// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// Test-network collections anyone can mint, so a visitor can put a lot in a vault without bringing one.
/// They have no value and are deployed only to test networks.

contract DemoLot is ERC721 {
    constructor() ERC721("Inchcandle Demo Lot", "ICLOT") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract DemoToken is ERC20 {
    constructor() ERC20("Inchcandle Demo Token", "ICDEMO") {}

    function mint(address to, uint256 amount) external {
        require(amount <= 1_000_000 ether, "amount");
        _mint(to, amount);
    }
}

contract DemoEdition is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        require(amount <= 1000, "amount");
        _mint(to, id, amount, "");
    }
}
