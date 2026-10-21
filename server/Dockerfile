# syntax=docker/dockerfile:1
# Job Hunt server: the app in a browser, running on a Synology NAS (Container Manager) or any Docker host.
# Build from the repository root:  docker build -f server/Dockerfile -t job-hunt-server .

# The program is compiled on the build machine's own processor for both Intel and ARM (cross-compiling),
# which takes minutes; compiling the ARM one under emulation took over half an hour.
FROM --platform=$BUILDPLATFORM rust:1-bookworm AS build
ARG TARGETARCH
ARG BUILDARCH
RUN case "$TARGETARCH" in arm64) T=aarch64-unknown-linux-gnu ;; *) T=x86_64-unknown-linux-gnu ;; esac \
    && echo "$T" > /target \
    && if [ "$TARGETARCH" != "$BUILDARCH" ]; then \
         case "$TARGETARCH" in \
           arm64) PKGS="gcc-aarch64-linux-gnu libc6-dev-arm64-cross" ;; \
           *) PKGS="gcc-x86-64-linux-gnu libc6-dev-amd64-cross" ;; \
         esac; \
         apt-get update && apt-get install -y --no-install-recommends $PKGS && rm -rf /var/lib/apt/lists/*; \
       fi \
    && rustup target add "$T"
WORKDIR /src
COPY core ./core
# The built-in Google connection, when the build is given one (a build secret, kept out of the image).
RUN --mount=type=secret,id=google_client \
    T="$(cat /target)" \
    && export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    && if [ "$TARGETARCH" != "$BUILDARCH" ] && [ "$TARGETARCH" = "amd64" ]; then \
         export CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc; fi \
    && JOBHUNT_GOOGLE_CLIENT="$(cat /run/secrets/google_client 2>/dev/null || true)" \
       cargo build --release --manifest-path core/Cargo.toml --bin jobhunt-server --target "$T" \
    && cp "core/target/$T/release/jobhunt-server" /jobhunt-server

FROM debian:bookworm-slim
# LibreOffice makes the PDF copies; fonts keep CVs looking like they do in Word.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl bash libreoffice-writer-nogui fonts-liberation2 fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
# Claude Code, for using your Claude subscription (sign in with CLAUDE_CODE_OAUTH_TOKEN; see server/README.md).
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && cp -L /root/.local/bin/claude /usr/local/bin/claude \
    && claude --version
COPY --from=build /jobhunt-server /usr/local/bin/jobhunt-server
COPY static /app/static
ENV JOBHUNT_DATA=/data JOBHUNT_STATIC=/app/static JOBHUNT_PORT=8790 HOME=/data/home DISABLE_AUTOUPDATER=1
VOLUME ["/data", "/backups"]
EXPOSE 8790
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fsS -o /dev/null http://127.0.0.1:8790/login || exit 1
CMD ["jobhunt-server"]
