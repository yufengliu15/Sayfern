#!/bin/sh
# Chromium's sandbox needs zypak inside Flatpak (from the Electron base app).
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
exec zypak-wrapper /app/sayfern/sayfern "$@"
