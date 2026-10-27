@echo off
chcp 65001 >nul
echo SD 체스 온라인 서버를 시작합니다. (Node.js 필요: https://nodejs.org)
echo 이 PC:  http://localhost:8000
echo 같은 Wi-Fi 기기에서는 아래 IPv4 주소로 접속하세요:  http://이_PC의_IP:8000
ipconfig | findstr /i "IPv4"
node server.js
pause
