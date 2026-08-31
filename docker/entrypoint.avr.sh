#!/bin/bash
set -e

# Entrypoint for the AVR-only IT-Arduino Simulator image.
#
# Forked from docker/entrypoint.sh. The upstream script installed four
# arduino-cli cores (AVR, RP2040, ATTinyCore, STM32), registered four board
# manager index URLs and sourced the ESP-IDF environment. This fork ships
# four AVR boards — Uno, Nano, Mega 2560 and ATtiny85 — so it needs exactly
# two cores and one extra index.

# Auto-generate SECRET_KEY if not provided so the app boots out-of-the-box
# without requiring the user to create backend/.env first. Persists in the
# data volume so JWTs survive container restarts.
if [ -z "$SECRET_KEY" ]; then
    SECRET_FILE="${DATA_DIR:-/app/data}/.secret_key"
    mkdir -p "$(dirname "$SECRET_FILE")"
    if [ ! -f "$SECRET_FILE" ]; then
        echo "No SECRET_KEY provided — generating one (saved to $SECRET_FILE)"
        head -c 48 /dev/urandom | base64 | tr -d '\n' > "$SECRET_FILE"
    fi
    export SECRET_KEY="$(cat "$SECRET_FILE")"
fi

# Ensure arduino-cli config and board manager URLs are set up.
if [ ! -f /root/.arduino15/arduino-cli.yaml ]; then
    echo "Initializing arduino-cli config..."
    arduino-cli config init 2>/dev/null || true
    # ATTinyCore (Spence Konde) — needed for ATtiny85 FQBNs.
    # Without this URL `core install ATTinyCore:avr` fails with
    #   "Platform 'ATTinyCore:avr' not found: platform not installed".
    # See https://github.com/SpenceKonde/ATTinyCore
    arduino-cli config add board_manager.additional_urls \
        http://drazzy.com/package_drazzy.com_index.json 2>/dev/null || true
fi

# Seed board-manager indexes vendored into the image (upstream issue #254).
# A /root/.arduino15 volume created by an older image can lack an index
# file that the config references; arduino-cli then fails instance init
# outright, which breaks EVERY compile — not just the boards from that
# index. A stale index is harmless, a missing one is fatal, so copy any
# vendored index the volume does not already have. `core update-index`
# below still refreshes whatever is reachable.
if [ -d /opt/arduino15-seed ]; then
    for seed in /opt/arduino15-seed/package_*.json; do
        [ -f "$seed" ] || continue
        dest="/root/.arduino15/$(basename "$seed")"
        if [ ! -f "$dest" ]; then
            echo "Seeding board index $(basename "$seed") (missing from volume)"
            cp "$seed" "$dest"
        fi
    done
fi

# Install missing cores. Both downloads happen once and then live in the
# /root/.arduino15 named volume — that volume is why compiles stay fast
# across container rebuilds, so keep it mounted.
#   arduino:avr        Uno, Nano, Mega 2560
#   ATTinyCore:avr     ATtiny85 (pinned to 1.4.1, the version upstream tests)
arduino-cli core update-index 2>/dev/null || true
arduino-cli core install arduino:avr 2>/dev/null || true
arduino-cli core install ATTinyCore:avr@1.4.1 2>/dev/null || true

# Library Manager libraries needed by site-projects sketches
# (scripts/siteProjects/).
# The site's code is copied verbatim (no edits to make a sketch fit the
# simulator), so a missing #include is fixed by installing the library here,
# never by swapping it for a different one in the sketch.
#
# Persisted in the /root/Arduino named volume (arduino-user-libs in
# docker-compose.avr.yml), same as the cores above — survives `docker
# restart`/`down`+`up`. Each install is independent and idempotent (a
# broken name here must not block the others, matching the core installs
# above); re-running an already-installed one is a no-op.
#
# Final branch review, IMPORTANT I10: LiquidCrystal was installed by hand
# into a running container with no trace outside a gitignored report —
# restated here so a from-scratch container reaches the same state with one
# command (a container restart).
#   LiquidCrystal                          parallel LCD1602 (#28, #63, ...)
#   Servo                                  #44, #49, #54
#   LiquidCrystal I2C (Frank de Brabander) #43, #45, #47, #69 (LiquidCrystal_I2C.h — PCF8574)
#   Adafruit NeoPixel                      #39
#   Adafruit Fingerprint Sensor Library    #68's #include, though #68 itself
#                                           is blocked for an unrelated site
#                                           source defect (see manifest.json)
#   Keypad (Mark Stanley, Alexander Brevig) #46's #include (matrix keypad
#                                           constructor call), though #46
#                                           itself is blocked for an
#                                           unrelated site source defect
#                                           (see manifest.json)
#   Low-Power (Rocket Scream Electronics)  #40's #include <LowPower.h>
#                                           (LowPower.powerDown(...) sleep
#                                           call) — registry name is
#                                           "Low-Power" (with hyphen);
#                                           `lib search LowPower` (no
#                                           hyphen) does not surface it by
#                                           exact name, only as another
#                                           library's listed dependency —
#                                           found by searching "Low-Power"
#                                           directly, confirmed against the
#                                           real rocketscream/Low-Power repo
#                                           (author/website/API match)
# Adafruit_LiquidCrystal.h (#78) is deliberately NOT installed: #78 is
# blocked (MCP23008 I2C backpack, not emulated in this fork's catalog).
# iarduino_KB.h (#43's keypad library) is deliberately NOT installed: it is
# not in the arduino-cli registry at all (`lib search iarduino` — no match),
# not a name/version issue that install could fix.
arduino-cli lib install "LiquidCrystal" 2>/dev/null || true
arduino-cli lib install "Servo" 2>/dev/null || true
arduino-cli lib install "LiquidCrystal I2C" 2>/dev/null || true
arduino-cli lib install "Adafruit NeoPixel" 2>/dev/null || true
arduino-cli lib install "Adafruit Fingerprint Sensor Library" 2>/dev/null || true
arduino-cli lib install "Keypad" 2>/dev/null || true
arduino-cli lib install "Low-Power" 2>/dev/null || true

# Start FastAPI backend in the background on port 8001
echo "Starting IT-Arduino Simulator backend..."
uvicorn app.main:app --host 127.0.0.1 --port 8001 &
UVICORN_PID=$!

# Wait for backend to be healthy before starting nginx
sleep 2

# Start Nginx in the background (not exec — we need to monitor both)
echo "Starting nginx on port 80..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Exit as soon as either process dies so Docker can restart the container.
# wait -n requires bash 4.3+ (standard on Debian Bullseye / Ubuntu 20.04+).
wait -n $UVICORN_PID $NGINX_PID
EXIT_CODE=$?

echo "A process exited (code $EXIT_CODE) — shutting down container"
kill $UVICORN_PID $NGINX_PID 2>/dev/null || true
wait $UVICORN_PID $NGINX_PID 2>/dev/null || true
exit $EXIT_CODE
