@echo off
chcp 65001 >nul
echo 같은 Wi-Fi의 태블릿 Chrome에서  http://이_PC의_IP:8000  으로 접속하세요.
echo (IP 확인: 아래 IPv4 주소)
ipconfig | findstr /i "IPv4"
python -m http.server 8000
