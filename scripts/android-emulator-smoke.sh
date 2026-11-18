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
# A boot-completed property can precede launcher/System UI readiness on hosted API 36 devices.
adb shell input keyevent KEYCODE_HOME
sleep 15
recover_system_overlay() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null 2>&1 || return 0
  adb pull /sdcard/window.xml emulator-evidence/system-window.xml >/dev/null 2>&1 || return 0
  python3 - <<'PYSYSTEM' > emulator-evidence/system-tap.txt
import re, xml.etree.ElementTree as ET
nodes = list(ET.parse('emulator-evidence/system-window.xml').getroot().iter('node'))
title = next((n.get('text', '') for n in nodes if n.get('resource-id') == 'android:id/alertTitle'), '')
# Never dismiss an ANR from VVVion or an unknown app. Keep evidence of infrastructure failures.
if title in ("Quickstep isn't responding", "System UI isn't responding"):
    button = next((n for n in nodes if n.get('resource-id') == 'android:id/aerr_wait'), None)
    if button is not None:
        x1,y1,x2,y2 = map(int,re.findall(r'\d+',button.get('bounds')))
        print((x1+x2)//2, (y1+y2)//2)
PYSYSTEM
  if [[ -s emulator-evidence/system-tap.txt ]]; then
    cp emulator-evidence/system-window.xml "emulator-evidence/system-anr-${attempt:-boot}.xml"
    read -r SYSTEM_X SYSTEM_Y < emulator-evidence/system-tap.txt
    adb shell input tap "$SYSTEM_X" "$SYSTEM_Y"
    sleep 3
  fi
}
recover_system_overlay
adb install -r artifacts/*-debug.apk
# Pregrant this declared runtime permission in the disposable CI device so its first-run dialog does not cover the chat.
adb shell pm grant space.vvvion.app android.permission.POST_NOTIFICATIONS
adb logcat -c
adb shell am start -W -n space.vvvion.app/.MainActivity > emulator-evidence/launch.txt
# Wait for the native loader/site rather than capturing the initial system splash.
for attempt in {1..12}; do
  recover_system_overlay
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
# The fixed-version test APK can legitimately be older than the public APK feed.
# Postpone ONLY the known VVVion update prompt; never install an update or dismiss unknown dialogs.
python3 - <<'PYUPDATE' > emulator-evidence/update-tap.txt
import re, xml.etree.ElementTree as ET
nodes = list(ET.parse('emulator-evidence/portrait.xml').getroot().iter('node'))
owned = [n for n in nodes if n.get('package') == 'space.vvvion.app']
title = any(n.get('text') == 'Доступно обновление' for n in owned)
button = next((n for n in owned if n.get('text') == 'Позже' and n.get('enabled') == 'true'), None)
if title and button is not None:
    x1,y1,x2,y2 = map(int,re.findall(r'\d+',button.get('bounds')))
    print((x1+x2)//2,(y1+y2)//2)
PYUPDATE
if [[ -s emulator-evidence/update-tap.txt ]]; then
  cp emulator-evidence/portrait.xml emulator-evidence/update-prompt.xml
  read -r UPDATE_X UPDATE_Y < emulator-evidence/update-tap.txt
  adb shell input tap "$UPDATE_X" "$UPDATE_Y"
  sleep 2
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml emulator-evidence/portrait.xml >/dev/null
  adb exec-out screencap -p > emulator-evidence/portrait.png
fi
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
for attempt in {1..20}; do
  adb shell dumpsys input_method > emulator-evidence/keyboard.txt
  if grep -Eq 'mIsInputViewShown=true' emulator-evidence/keyboard.txt; then break; fi
  sleep 1
done
grep -Eq 'mIsInputViewShown=true' emulator-evidence/keyboard.txt
# IME visibility can precede the app's completed inset/layout pass. Assert the composer too.
SCREEN_HEIGHT=$(adb shell wm size | tr -d '\r' | sed -n 's/.*: [0-9]*x\([0-9]*\).*/\1/p' | tail -n 1)
export SCREEN_HEIGHT
COMPOSER_VISIBLE=false
for attempt in {1..12}; do
  adb shell uiautomator dump /sdcard/keyboard.xml >/dev/null 2>&1 || true
  adb pull /sdcard/keyboard.xml emulator-evidence/keyboard.xml >/dev/null 2>&1 || true
  if python3 - <<'PYLAYOUT' > emulator-evidence/keyboard-layout.txt
import os, re, xml.etree.ElementTree as ET
nodes = ET.parse('emulator-evidence/keyboard.xml').getroot().iter('node')
fields = [n for n in nodes if n.get('package') == 'space.vvvion.app' and n.get('class') == 'android.widget.EditText' and n.get('focused') == 'true']
for field in fields:
    x1,y1,x2,y2 = map(int,re.findall(r'\d+',field.get('bounds')))
    # Pixel 6 portrait IME takes over a quarter of the display; a full-height stale composer fails.
    if x2 > x1 and 0 < y1 < y2 < int(os.environ['SCREEN_HEIGHT']) * 0.75:
        print('Focused composer visible above the portrait IME:', field.get('bounds'))
        break
else:
    raise SystemExit('Focused composer not visible above IME yet')
PYLAYOUT
  then
    COMPOSER_VISIBLE=true
    break
  fi
  sleep 1
done
[[ "$COMPOSER_VISIBLE" == true ]]
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
  if [[ -f emulator-evidence/offline.xml ]] && grep -Eq 'Нет подключения к интернету|Связи нет' emulator-evidence/offline.xml; then break; fi
  sleep 2
done
grep -Eq 'Нет подключения к интернету|Связи нет' emulator-evidence/offline.xml
grep -q 'Повторить' emulator-evidence/offline.xml
adb exec-out screencap -p > emulator-evidence/offline.png
adb shell svc wifi enable
adb shell svc data enable
adb logcat -d -b crash > emulator-evidence/crash.txt
if grep -q 'Process: space.vvvion.app' emulator-evidence/crash.txt; then
  echo 'VVVion crashed during emulator smoke test'
  exit 1
fi
adb logcat -d -s VVWeb > emulator-evidence/web-console.txt
