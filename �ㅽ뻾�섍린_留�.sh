#!/bin/bash
echo "태블릿 Chrome에서 http://$(ipconfig getifaddr en0):8000 으로 접속하세요"
python3 -m http.server 8000
