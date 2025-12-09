# Contract Upgrade: Reward Redemption

## What Changed

### Contract Updates (`contracts/StampCard.sol`)

- Added `RewardRedeemed` event
- Added `redeemReward(address user)` function:
  - Requires user has ≥10 stamps
  - Resets stamps to 0
  - Emits RewardRedeemed event with previous stamp count
  - Updates lastStampTime

### API Updates (`api/server.cjs`)

- Updated `/redeem-reward` endpoint to call contract's `redeemReward()`
- Returns tx hash and status
- Auto-funding support (same as stamping)
- Logs redemption to DB

### UI Already Updated

- Customer sees celebration modal at 10 stamps with redemption QR
- Café scanner detects `redeem=true` parameter
- Button changes to "🎁 Belohnung einlösen"
- Shows success message after redemption

## Deployment Steps

### 1. Compile the contract

```powershell
npx hardhat compile
```

### 2. Deploy to Sepolia

```powershell
npx hardhat run scripts/deploy.cjs --network sepolia
```

This will:

- Deploy the new contract
- Update `.env.local` with new address
- Keep all other env vars intact

### 3. Restart the API server

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
node api/server.cjs
```

### 4. Test the flow

1. Customer collects 10 stamps
2. Celebration modal appears with redemption QR
3. Café scans redemption QR
4. Scanner shows "🎁 Belohnung einlösen" button
5. Click to redeem → stamps reset to 0
6. Customer can start collecting again!

## Gas Estimates (Sepolia)

- `redeemReward()`: ~30-40k gas (~$0.0002 on mainnet equivalents)
- Same auto-funding logic applies (0.01 ETH top-up when < 0.003)

## Database

Redemptions are logged in `stamp_events` table with the redemption tx hash, so you can track:

- Who redeemed rewards
- When they redeemed
- Which café processed the redemption

## Contract Functions

```solidity
// New function
function redeemReward(address user) external
  - Requires: user has >= 10 stamps
  - Effects: Sets stamps to 0, updates timestamp
  - Emits: RewardRedeemed(cafe, user, previousStamps)

// Existing functions (unchanged)
function addStamp(address user) external
function addStamps(address user, uint32 count) external
function getStamps(address cafe, address user) external view returns (uint32)
function getLastStampTime(address cafe, address user) external view returns (uint64)
```

## Notes

- Old contract data won't migrate (different address)
- If you want to preserve stamps, run the rehydrate script after deploying
- Session storage tracks celebration shown per café to avoid spam
