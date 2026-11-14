#!/usr/bin/env bash
set -euo pipefail
mkdir -p emulator-evidence
collect_evidence() {
  adb logcat -d -b crash > emulator-evidence/crash.txt 2>&1 || true
  adb logcat -d -s VVWeb VVBridge > emulator-evidence/web-console.txt 2>&1 || true
  adb exec-out screencap -p > emulator-evidence/final.png 2>/dev/null || true
  adb shell dumpsys activity activities > emulator-evidence/final-activity.txt 2>&1 || true
}
trap collect_evidence EXIT
# Android's first immersive-mode tutorial is a system overlay, not app content.
adb shell settings put secure immersive_mode_confirmations confirmed
adb install -r artifacts/*-debug.apk
adb logcat -c
adb shell am start -W -n space.vvvion.app/.MainActivity > emulator-evidence/launch.txt
# Wait for the native loader/site rather than capturing the initial system splash.
for attempt in {1..12}; do
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/window.xml emulator-evidence/portrait.xml >/dev/null 2>&1 || true
  if [[ -f emulator-evidence/portrait.xml ]] && grep -q 'android.webkit.WebView' emulator-evidence/portrait.xml; then break; fi
  sleep 2
done
grep -q 'space.vvvion.app' emulator-evidence/portrait.xml
for attempt in {1..20}; do
  adb logcat -d -s VVBridge > emulator-evidence/bridge.txt
  if grep -q 'version.*3.0.2.*forgedRejected.*true' emulator-evidence/bridge.txt; then break; fi
  sleep 2
done
grep -q 'version.*3.0.2.*forgedRejected.*true' emulator-evidence/bridge.txt
adb shell uiautomator dump /sdcard/window.xml >/dev/null
adb pull /sdcard/window.xml emulator-evidence/portrait.xml >/dev/null
adb exec-out screencap -p > emulator-evidence/portrait.png
# Focus a real web input; exercise native IME resizing without sending a message.
adb shell settings put secure show_ime_with_hard_keyboard 1
python3 - <<'PYINPUT' > emulator-evidence/input-tap.txt
import re, xml.etree.ElementTree as ET
nodes = ET.parse('emulator-evidence/portrait.xml').getroot().iter('node')
field = next((n for n in nodes if n.get('class') == 'android.widget.EditText' and n.get('enabled') == 'true'), None)
if field is None:
    raise SystemExit('No enabled input in the rendered chat screen')
x1,y1,x2,y2 = map(int,re.findall(r'\d+',field.get('bounds')))
print((x1+x2)//2,(y1+y2)//2)
PYINPUT
read -r INPUT_X INPUT_Y < emulator-evidence/input-tap.txt
adb shell input tap "$INPUT_X" "$INPUT_Y"
sleep 2
adb shell dumpsys input_method > emulator-evidence/keyboard.txt
grep -Eq 'mInputShown=true|mIsInputViewShown=true|isInputShown=true' emulator-evidence/keyboard.txt
adb exec-out screencap -p > emulator-evidence/keyboard.png
adb shell input keyevent KEYCODE_BACK
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 2
adb shell dumpsys activity activities > emulator-evidence/landscape-activity.txt
grep -q 'space.vvvion.app/.MainActivity' emulator-evidence/landscape-activity.txt
adb exec-out screencap -p > emulator-evidence/landscape.png
# Home/relaunch must preserve the existing activity rather than crash the renderer.
adb shell input keyevent KEYCODE_HOME
adb shell am start -W -n space.vvvion.app/.MainActivity > emulator-evidence/relaunch.txt
sleep 2
adb shell dumpsys activity activities > emulator-evidence/relaunch-activity.txt
grep -q 'space.vvvion.app/.MainActivity' emulator-evidence/relaunch-activity.txt
# A fresh offline launch must reach the native recovery screen, without a blank browser error page.
adb shell svc wifi disable
adb shell svc data disable
adb shell am force-stop space.vvvion.app
adb shell am start -W -n space.vvvion.app/.MainActivity > emulator-evidence/offline-launch.txt
for attempt in {1..12}; do
  adb shell uiautomator dump /sdcard/offline.xml >/dev/null 2>&1 || true
  adb pull /sdcard/offline.xml emulator-evidence/offline.xml >/dev/null 2>&1 || true
  if [[ -f emulator-evidence/offline.xml ]] && grep -q 'Нет подключения к интернету' emulator-evidence/offline.xml; then break; fi
  sleep 2
done
grep -q 'Нет подключения к интернету' emulator-evidence/offline.xml
adb exec-out screencap -p > emulator-evidence/offline.png
adb shell svc wifi enable
adb shell svc data enable
adb logcat -d -b crash > emulator-evidence/crash.txt
if grep -q 'Process: space.vvvion.app' emulator-evidence/crash.txt; then
  echo 'VVVion crashed during emulator smoke test'
  exit 1
fi
adb logcat -d -s VVWeb > emulator-evidence/web-console.txt
