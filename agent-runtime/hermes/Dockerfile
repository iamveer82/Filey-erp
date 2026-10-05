# The running image is selected by its reviewed digest, never by this build tag.
FROM python:3.14.0-slim@sha256:0aecac02dc3d4c5dbb024b753af084cafe41f5416e02193f1ce345d671ec966e
WORKDIR /opt/filey/hermes
COPY . /opt/filey/hermes/
RUN python -m venv /opt/filey/venv \
    && /opt/filey/venv/bin/python -m pip install --no-cache-dir --require-hashes -r requirements.lock \
    && python -B bootstrap.py --cache /var/lib/filey-hermes --source-only \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin filey
ENV FILEY_HERMES_SOURCE_DIR=/var/lib/filey-hermes/79af3f6cea8067284a7ea5725078578b3f790adb/hermes-agent-79af3f6cea8067284a7ea5725078578b3f790adb \
    PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 PYTHONUTF8=1
USER 10001:10001
ENTRYPOINT ["/opt/filey/venv/bin/python", "-B", "/opt/filey/hermes/runner.py"]
