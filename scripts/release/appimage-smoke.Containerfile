# Minimal Ubuntu for the AppImageHub-style launch check.
# Has a display stack (Xvfb + Mesa) and deliberately does NOT install
# libwebkit2gtk or GTK — those must come from the AppImage payload.
FROM docker.io/library/ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      dbus-x11 \
      fontconfig \
      fonts-dejavu-core \
      libdrm2 \
      libegl1 \
      libgbm1 \
      libgl1 \
      libgles2 \
      libwayland-client0 \
      libx11-6 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxinerama1 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      procps \
      x11-utils \
      xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && if dpkg -l 'libwebkit2gtk*' 2>/dev/null | grep -q '^ii'; then \
         echo 'libwebkit2gtk must not be installed in the AppImage smoke image' >&2; \
         exit 1; \
       fi \
    && if dpkg -l 'libgtk-3-0' 2>/dev/null | grep -q '^ii'; then \
         echo 'libgtk-3-0 must not be installed in the AppImage smoke image' >&2; \
         exit 1; \
       fi
