#!/usr/bin/env bash
# Start a throwaway sshd container for the real SSH terminal-backend tests.
#
#   scripts/ci/start_test_sshd.sh <state-dir> [port]
#
# Generates (once per state dir) a client keypair and a host key, starts a
# Debian sshd on 127.0.0.1:<port> (default 2222) that accepts only that key for
# user `filey`, waits until it answers, and prints the FILEY_TEST_SSH_*
# variables tests/tools/test_ssh_environment.py reads (appended to $GITHUB_ENV
# too when it is set). `docker rm -f filey-test-sshd` stops it.
#
# The image is a plain Debian (13, current stable) with GNU tar and bash, the shape of a real remote
# host (the backend's file sync uses `tar --no-overwrite-dir`). Container-side setup lives in
# test_sshd_container_setup.sh, mounted read-only at /setup.
set -euo pipefail

state_dir="${1:?usage: start_test_sshd.sh <state-dir> [port]}"
port="${2:-2222}"
image="${FILEY_TEST_SSHD_IMAGE:-debian:13-slim}"
name="filey-test-sshd"

mkdir -p "$state_dir"
state_dir="$(cd "$state_dir" && pwd)"
[ -f "$state_dir/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C filey-test -f "$state_dir/id_ed25519"
[ -f "$state_dir/host_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C filey-test-host -f "$state_dir/host_ed25519"
cp "$state_dir/id_ed25519.pub" "$state_dir/authorized_keys"

docker rm -f "$name" >/dev/null 2>&1 || true
setup="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test_sshd_container_setup.sh"
docker run -d --name "$name" -p "127.0.0.1:${port}:22" \
  -v "$state_dir:/keys:ro" -v "$setup:/setup/setup.sh:ro" \
  "$image" bash /setup/setup.sh >/dev/null

for _ in $(seq 1 120); do
  if ssh -i "$state_dir/id_ed25519" -p "$port" -o BatchMode=yes -o ConnectTimeout=2 \
      -o StrictHostKeyChecking=accept-new filey@127.0.0.1 true 2>/dev/null; then
    ready=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != true ]; then
    docker logs "$name" >&2 || true
    echo "sshd container exited before accepting connections" >&2
    exit 1
  fi
  sleep 1
done
if [ -z "${ready:-}" ]; then
  docker logs "$name" >&2 || true
  echo "sshd did not accept the test key within 120s" >&2
  exit 1
fi

env_lines="FILEY_TEST_SSH_HOST=127.0.0.1
FILEY_TEST_SSH_USER=filey
FILEY_TEST_SSH_PORT=$port
FILEY_TEST_SSH_KEY=$state_dir/id_ed25519"
if [ -n "${GITHUB_ENV:-}" ]; then
  printf '%s\n' "$env_lines" >> "$GITHUB_ENV"
fi
printf '%s\n' "$env_lines"
