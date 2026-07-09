ARG NODE_VERSION=24.16.0
ARG PYTHON_VERSION=3.13

# ==============================================================================
# STAGE 1: JavaScript runner (@n8n/task-runner) artifact from CI
# ==============================================================================
FROM node:${NODE_VERSION}-bookworm-slim AS javascript-runner-builder
COPY ./dist/task-runner-javascript /app/task-runner-javascript

WORKDIR /app/task-runner-javascript

# Pin pnpm to the repo's packageManager version. `pnpm deploy` drops the
# packageManager field from the deployed package.json, so a bare
# `corepack enable pnpm` resolves to corepack's bundled latest (pnpm 11.x).
# pnpm 11 defaults minimumReleaseAge to 1440 (24h), so the `pnpm add` below
# re-resolves the deployed graph and rejects any dependency published less
# than a day ago — e.g. a first-party @n8n_io/ai-assistant-sdk bump landed
# within hours of its npm publish. This container step only re-resolves an
# already-vetted, already-pinned dependency set; the real supply-chain age
# policy is enforced by the host install (pnpm-workspace.yaml + SafeChain).
ARG PNPM_VERSION=10.32.1
RUN corepack enable pnpm && corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Remove `catalog` and `workspace` references from package.json to allow `pnpm add` in extended images
RUN node -e "const pkg = require('./package.json'); \
    Object.keys(pkg.dependencies || {}).forEach(k => { \
        const val = pkg.dependencies[k]; \
        if (val === 'catalog:' || val.startsWith('catalog:') || val.startsWith('workspace:')) \
            delete pkg.dependencies[k]; \
    }); \
    Object.keys(pkg.devDependencies || {}).forEach(k => { \
        const val = pkg.devDependencies[k]; \
        if (val === 'catalog:' || val.startsWith('catalog:') || val.startsWith('workspace:')) \
            delete pkg.devDependencies[k]; \
    }); \
    delete pkg.devDependencies; \
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));"

# Install selected third-party modules used by Code node JavaScript sandbox
RUN rm -f node_modules/.modules.yaml && \
    pnpm add \
    moment@2.30.1 \
    cheerio@1.0.0-rc.6 \
    xlsx@0.18.5 \
    xlsx-populate@1.21.0 \
    exceljs@4.4.0 \
    papaparse@5.5.2 \
    csv-parse@5.6.0 \
    date-fns@4.1.0 \
    luxon@3.5.0 \
    mathjs@14.2.1 \
    pdf-lib@1.17.1 \
    pdfkit@0.16.0 \
    jszip@3.10.1 \
    --prod --no-lockfile

# ==============================================================================
# STAGE 2: Python runner build (@n8n/task-runner-python) with uv
# Produces a relocatable venv tied to the python version used
# ==============================================================================
FROM python:${PYTHON_VERSION}-slim AS python-runner-builder
ARG TARGETPLATFORM
ARG UV_VERSION=0.8.14

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget tar && \
    rm -rf /var/lib/apt/lists/*

RUN set -e; \
  case "$TARGETPLATFORM" in \
    "linux/amd64") UV_ARCH="x86_64-unknown-linux-gnu" ;; \
    "linux/arm64") UV_ARCH="aarch64-unknown-linux-gnu" ;; \
    *) echo "Unsupported platform: $TARGETPLATFORM" >&2; exit 1 ;; \
  esac; \
  mkdir -p /tmp/uv && cd /tmp/uv; \
  wget -q "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz"; \
  wget -q "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_ARCH}.tar.gz.sha256"; \
  sha256sum -c "uv-${UV_ARCH}.tar.gz.sha256"; \
	tar -xzf "uv-${UV_ARCH}.tar.gz"; \
  install -m 0755 "uv-${UV_ARCH}/uv" /usr/local/bin/uv; \
  cd / && rm -rf /tmp/uv

WORKDIR /app/task-runner-python

COPY packages/@n8n/task-runner-python/pyproject.toml \
     packages/@n8n/task-runner-python/uv.lock** \
     packages/@n8n/task-runner-python/.python-version** \
     ./

RUN uv venv
RUN uv sync \
			--frozen \
			--no-editable \
			--no-install-project \
			--no-dev \
			--all-extras

COPY packages/@n8n/task-runner-python/ ./
RUN uv sync \
      --frozen \
			--no-dev \
			--all-extras \
      --no-editable

# Install the python runner package itself into site packages. We can remove the src directory then
RUN uv pip install . && rm -rf /app/task-runner-python/src

# ==============================================================================
# STAGE 3: Task Runner Launcher download
# ==============================================================================
FROM debian:bookworm-slim AS launcher-downloader
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION=1.4.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget tar && \
    rm -rf /var/lib/apt/lists/*

RUN set -e; \
    case "$TARGETPLATFORM" in \
        "linux/amd64") ARCH_NAME="amd64" ;; \
        "linux/arm64") ARCH_NAME="arm64" ;; \
        *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac; \
    mkdir /launcher-temp && cd /launcher-temp; \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz"; \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256"; \
    echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256) task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256; \
    sha256sum -c checksum.sha256; \
    mkdir -p /launcher-bin; \
    tar xzf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz -C /launcher-bin; \
    cd / && rm -rf /launcher-temp

# ==============================================================================
# STAGE 4: Runtime
# ==============================================================================
FROM python:${PYTHON_VERSION}-slim AS runtime
ARG N8N_VERSION=snapshot
ARG N8N_RELEASE_TYPE=dev

ENV NODE_ENV=production \
    N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE} \
    SHELL=/bin/sh

# Bring `uv` over from python-runner-builder, to make the image easier to extend
COPY --from=python-runner-builder /usr/local/bin/uv /usr/local/bin/uv

# Install runtime dependencies. tini handles PID 1 signal forwarding; libstdc++6
# is required by Node native modules.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini libstdc++6 && \
    apt-get upgrade -y && \
    pip install --no-cache-dir "pip>=26.0" && \
    rm -rf /var/lib/apt/lists/*

# Bring node, corepack and pnpm over from the JS builder stage (glibc-linked)
COPY --from=javascript-runner-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=javascript-runner-builder /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack && \
    ln -s ../lib/node_modules/corepack/dist/pnpm.js /usr/local/bin/pnpm

RUN groupadd -r -g 1000 runner \
 && useradd  -r -u 1000 -g runner -d /home/runner -m -s /usr/sbin/nologin runner

WORKDIR /home/runner

COPY --from=javascript-runner-builder --chown=root:root /app/task-runner-javascript /opt/runners/task-runner-javascript
COPY --from=python-runner-builder --chown=root:root /app/task-runner-python /opt/runners/task-runner-python
COPY --from=launcher-downloader /launcher-bin/* /usr/local/bin/
COPY --chown=root:root docker/images/runners/n8n-task-runners.json /etc/task-runners.json
COPY --chown=root:root docker/images/runners/n8n-task-runners.json /etc/n8n-task-runners.json

# Preinstall popular Python libraries into runner venv
RUN uv pip install -p /opt/runners/task-runner-python/.venv/bin/python \
    requests==2.32.3 \
    httpx==0.27.2 \
    pytz==2024.1 \
    python-dateutil==2.9.0.post0 \
    Unidecode==1.3.7 \
    openpyxl==3.1.5 \
    xlsxwriter==3.2.0 \
    pandas==2.2.3 \
    numpy==2.1.2 \
    beautifulsoup4==4.12.3 \
    lxml==5.3.0 \
    Pillow==11.0.0 \
    pydantic==2.10.4 \
    Jinja2==3.1.5 \
    PyJWT==2.10.1 \
    cryptography==44.0.0 \
    regex==2024.11.6 \
    charset-normalizer==3.4.1 \
    msgpack==1.1.0 \
    orjson==3.10.13 \
    qrcode==8.0 \
    pypdf==5.1.0 \
    tabulate==0.9.0 \
    networkx==3.4.2 \
    python-slugify==8.0.4 \
    phonenumbers==8.13.52 \
    email-validator==2.2.0 \
    matplotlib==3.10.0 \
    seaborn==0.13.2 \
    reportlab==4.2.5 \
    fpdf2==2.8.2 \
    pymupdf==1.27.2 \
    opencv-python-headless==4.11.0.86

USER runner

EXPOSE 5680/tcp
ENTRYPOINT ["tini", "--", "/usr/local/bin/task-runner-launcher"]
CMD ["javascript", "python"]

LABEL org.opencontainers.image.title="n8n task runners" \
      org.opencontainers.image.description="Sidecar image providing n8n task runners for JavaScript and Python code execution" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version="${N8N_VERSION}"
