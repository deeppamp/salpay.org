@echo off
echo ========================================
echo     Mining Test SAL to salpaytest
echo ========================================

echo Starting mining to your primary wallet address...

curl http://127.0.0.1:29081/start_mining ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -d "{\"do_background_mining\":false,\"ignore_battery\":true,\"miner_address\":\"SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv\",\"threads_count\":1}"

echo.
echo Mining started with 1 thread...
echo Leave this window open.
echo Check balance every few minutes with: get_balance
echo.
echo Press Ctrl+C to stop mining when you have enough SAL.
pause
