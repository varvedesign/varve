# Newer-Mesa host for the AppImageHub-shaped launch check.
# Fedora's Mesa is newer than the ubuntu-22.04 build host. The AppImage
# must talk to this host EGL stack without a white screen.
# Deliberately does NOT install WebKitGTK or GTK.
FROM docker.io/library/fedora:latest

RUN dnf -y install --setopt=install_weak_deps=False \
      ca-certificates \
      dbus-daemon \
      dejavu-sans-fonts \
      fontconfig \
      libX11 \
      libXcomposite \
      libXcursor \
      libXdamage \
      libXext \
      libXfixes \
      libXi \
      libXinerama \
      libXrandr \
      libXrender \
      libXScrnSaver \
      libXtst \
      libdrm \
      libxkbcommon \
      mesa-dri-drivers \
      mesa-libEGL \
      mesa-libGL \
      mesa-libGLES \
      mesa-libgbm \
      nspr \
      nss \
      procps-ng \
      wayland \
      xorg-x11-server-Xvfb \
      xwininfo \
    && dnf clean all \
    && if rpm -q webkit2gtk4.1 >/dev/null 2>&1 || rpm -q webkit2gtk3 >/dev/null 2>&1; then \
         echo 'webkit2gtk must not be installed in the AppImage smoke image' >&2; \
         exit 1; \
       fi \
    && if rpm -q gtk3 >/dev/null 2>&1; then \
         echo 'gtk3 must not be installed in the AppImage smoke image' >&2; \
         exit 1; \
       fi
