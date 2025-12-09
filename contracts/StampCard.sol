// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract StampCard {
    struct CafeStamp {
        uint32 stamps;
        uint64 lastStampTime;
    }

    // user => cafe => data
    mapping(address => mapping(address => CafeStamp)) private _data;

    event StampAdded(address indexed cafe, address indexed user, uint32 totalStamps);
    event RewardRedeemed(address indexed cafe, address indexed user, uint32 previousStamps);


    /// @notice Café ruft diese Funktion auf, um einem Nutzer einen Stempel zu geben
    function addStamp(address user) external {
        require(user != address(0), "bad user");
        CafeStamp storage s = _data[user][msg.sender];
        unchecked { s.stamps += 1; }
        s.lastStampTime = uint64(block.timestamp);
        emit StampAdded(msg.sender, user, s.stamps);
    }

    /// @notice Café ruft diese Funktion auf, um einem Nutzer mehrere Stempel in einer Transaktion zu geben
    function addStamps(address user, uint32 count) external {
        require(user != address(0), "bad user");
        require(count > 0 && count <= 20, "count out of range");
        CafeStamp storage s = _data[user][msg.sender];
        unchecked { s.stamps += count; }
        s.lastStampTime = uint64(block.timestamp);
        emit StampAdded(msg.sender, user, s.stamps);
    }

    /// @notice Café ruft diese Funktion auf, um die Belohnung einzulösen und Stempel zurückzusetzen
    function redeemReward(address user) external {
        require(user != address(0), "bad user");
        CafeStamp storage s = _data[user][msg.sender];
        require(s.stamps >= 10, "insufficient stamps for reward");
        
        uint32 previousStamps = s.stamps;
        unchecked { s.stamps -= 10; }
        s.lastStampTime = uint64(block.timestamp);
        
        emit RewardRedeemed(msg.sender, user, previousStamps);
    }

    function getStamps(address cafe, address user) external view returns (uint32) {
        return _data[user][cafe].stamps;
    }

    function getLastStampTime(address cafe, address user) external view returns (uint64) {
        return _data[user][cafe].lastStampTime;
    }
}
