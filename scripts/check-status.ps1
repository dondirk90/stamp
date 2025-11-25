# Stamp System Status Check
Write-Host "=== Stamp System Status Check ===" -ForegroundColor Cyan
Write-Host ""

# Check 1: Hardhat Node
Write-Host "[1] Checking Hardhat Node (port 8545)..." -ForegroundColor Yellow
try {
    $rpc = Test-NetConnection -ComputerName 127.0.0.1 -Port 8545 -WarningAction SilentlyContinue
    if ($rpc.TcpTestSucceeded) {
        Write-Host "    OK Hardhat Node is running" -ForegroundColor Green
        try {
            $body = '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
            $blockRes = curl.exe -sS -X POST -H "Content-Type: application/json" -d $body http://127.0.0.1:8545 2>$null
            $block = ($blockRes | ConvertFrom-Json).result
            Write-Host "    OK Block number: $block" -ForegroundColor Green
        } catch {
            Write-Host "    WARN Could not get block number" -ForegroundColor Yellow
        }
    } else {
        Write-Host "    FAIL Hardhat Node NOT running!" -ForegroundColor Red
        Write-Host "         Run: pnpm run chain" -ForegroundColor Gray
    }
} catch {
    Write-Host "    FAIL Error checking Hardhat" -ForegroundColor Red
}

Write-Host ""

# Check 2: API Server
Write-Host "[2] Checking API Server (port 3000)..." -ForegroundColor Yellow
try {
    $api = Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -WarningAction SilentlyContinue
    if ($api.TcpTestSucceeded) {
        Write-Host "    OK API Server is running" -ForegroundColor Green
        try {
            $debugInfo = curl.exe -sS http://127.0.0.1:3000/debug/info 2>$null | ConvertFrom-Json
            Write-Host "    OK Contract: $($debugInfo.contract)" -ForegroundColor Green
            Write-Host "    OK Wallet: $($debugInfo.wallet)" -ForegroundColor Green
            if ($debugInfo.blockNumber) {
                Write-Host "    OK Connected to RPC (block: $($debugInfo.blockNumber))" -ForegroundColor Green
            }
        } catch {
            Write-Host "    WARN API running but returned error" -ForegroundColor Yellow
        }
    } else {
        Write-Host "    FAIL API Server NOT running!" -ForegroundColor Red
        Write-Host "         Run: node api/server.cjs" -ForegroundColor Gray
    }
} catch {
    Write-Host "    FAIL Error checking API" -ForegroundColor Red
}

Write-Host ""

# Check 3: Apps Server
Write-Host "[3] Checking Apps Server (port 8080)..." -ForegroundColor Yellow
try {
    $apps = Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -WarningAction SilentlyContinue
    if ($apps.TcpTestSucceeded) {
        Write-Host "    OK Apps Server is running" -ForegroundColor Green
        Write-Host "    OK Customer page: http://127.0.0.1:8080/customer-register.html" -ForegroundColor Green
        Write-Host "    OK Cafe scanner: http://127.0.0.1:8080/cafe-scanner.html" -ForegroundColor Green
    } else {
        Write-Host "    FAIL Apps Server NOT running!" -ForegroundColor Red
        Write-Host "         Run: cd apps; node server.cjs" -ForegroundColor Gray
    }
} catch {
    Write-Host "    FAIL Error checking Apps Server" -ForegroundColor Red
}

Write-Host ""

# Check 4: Contract Deployment
Write-Host "[4] Checking Contract Deployment..." -ForegroundColor Yellow
if (Test-Path .env.local) {
    $envContent = Get-Content .env.local
    $contractAddr = ($envContent | Select-String "STAMPCARD_ADDRESS=(.+)").Matches.Groups[1].Value
    if ($contractAddr) {
        Write-Host "    OK Contract address in .env.local: $contractAddr" -ForegroundColor Green
        
        # Try to check if contract has code
        try {
            $codeBody = "{`"jsonrpc`":`"2.0`",`"id`":1,`"method`":`"eth_getCode`",`"params`":[`"$contractAddr`",`"latest`"]}"
            $codeRes = curl.exe -sS -X POST -H "Content-Type: application/json" -d $codeBody http://127.0.0.1:8545 2>$null
            $code = ($codeRes | ConvertFrom-Json).result
            if ($code -and $code -ne "0x" -and $code -ne "0x0") {
                Write-Host "    OK Contract is deployed!" -ForegroundColor Green
            } else {
                Write-Host "    FAIL Contract NOT deployed at this address!" -ForegroundColor Red
                Write-Host "         Run: pnpm run deploy" -ForegroundColor Gray
            }
        } catch {
            Write-Host "    WARN Could not verify contract code" -ForegroundColor Yellow
        }
    } else {
        Write-Host "    FAIL STAMPCARD_ADDRESS not set in .env.local" -ForegroundColor Red
    }
} else {
    Write-Host "    FAIL .env.local file not found!" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "If any checks failed, run the commands shown above." -ForegroundColor Gray
Write-Host "Typical startup order:" -ForegroundColor Gray
Write-Host "  1. pnpm run chain          (Terminal 1 - keep running)" -ForegroundColor Gray
Write-Host "  2. pnpm run deploy         (Terminal 2 - run once)" -ForegroundColor Gray
Write-Host "  3. node api/server.cjs     (Terminal 3 - keep running)" -ForegroundColor Gray
Write-Host "  4. cd apps; node server.cjs (Terminal 4 - keep running)" -ForegroundColor Gray
Write-Host ""
Write-Host "Then open: http://127.0.0.1:8080/customer-register.html" -ForegroundColor Cyan
Write-Host ""
