@echo off
echo ========================================
echo     Mining Test SAL to salpaytest
echo ========================================

echo Starting mining to your primary wallet address...

curl http://127.0.0.1:29081/start_mining ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -d "{\"do_background_mining\":false,\"ignore_battery\":true,\"miner_address\":\"SaLvTyLEbw8B76oyTnt2YacaxPPByqsfWAdBGRsDcWkBjo8HjobZPpFAz9sjXGR7iyXVXsifNtyCdDo731UcXyUdHs4XpESuJmE1G\",\"threads_count\":4}"

echo.
echo Mining started with 4 threads...
echo Leave this window open.
echo Check balance every few minutes with: get_balance
echo.
echo Press Ctrl+C to stop mining when you have enough SAL.
pause
