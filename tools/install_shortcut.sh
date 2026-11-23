#!/data/data/com.termux/files/usr/bin/sh
# elMotion 홈 화면 버튼 만들기 (Termux:Widget 필요)
# 실행:  sh elMotion/tools/install_shortcut.sh
# 그 뒤 홈 화면에 Termux:Widget 위젯을 추가하면 'elMotion' 버튼이 생긴다.
# 버튼을 누르면: 중계기를 켜고(이미 켜져 있으면 그대로) → 크롬으로 elMotion을 연다.
# elMotion을 닫고 2분이 지나면 중계기는 저절로 꺼진다.
set -e
mkdir -p "$HOME/.shortcuts"
cat > "$HOME/.shortcuts/elMotion" <<'EOS'
#!/data/data/com.termux/files/usr/bin/sh
cd "$HOME/elMotion"
python tools/baro_bridge.py &
BRIDGE=$!
sleep 2
termux-open-url http://localhost:8080
wait $BRIDGE
EOS
chmod 700 "$HOME/.shortcuts/elMotion"
echo "만들었어요: ~/.shortcuts/elMotion"
echo "이제 홈 화면을 길게 눌러 위젯 → Termux:Widget 을 추가하고, 목록에서 elMotion 을 고르세요."
