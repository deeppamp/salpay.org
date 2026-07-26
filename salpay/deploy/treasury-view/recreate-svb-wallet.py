#!/usr/bin/env python3
"""Recreate Carrot treasury view-only wallet via generate-from-svb-key (PTY)."""
import os
import pty
import select
import signal
import sys
import time

WDIR = os.environ.get("TREASURY_DIR", "/var/lib/salpay/treasury-view")
CLI = os.environ.get("SALVIUM_CLI", "/opt/salvium/salvium-wallet-cli")
ADDR = os.environ.get(
    "TREASURY_ADDRESS",
    "SC11aKyafJ116XJ9VG9Xt4C8hjXEpMcivH3TKwnxgkjeFcPJAJtz3v4fXXYVBMRBUX7q4iZVHqjKnML2SszqqMHk99jLdupNNb",
)
SVB = os.environ["TREASURY_SVB_SECRET"]  # required
PASS = os.environ.get("TREASURY_VIEW_PASSWORD", "treasury-view-local-only")
RESTORE = os.environ.get("RESTORE_HEIGHT", "538000")
NAME = os.environ.get("WALLET_NAME", "treasury-view-mainnet")

os.makedirs(WDIR, exist_ok=True)
# stop service best-effort
os.system("sudo systemctl stop salpay-treasury-view.service >/dev/null 2>&1 || true")
time.sleep(2)

ts = time.strftime("%Y%m%d-%H%M%S")
backup = os.path.join(WDIR, f"backup-recreate-{ts}")
os.makedirs(backup, exist_ok=True)
for f in (NAME, f"{NAME}.keys"):
    src = os.path.join(WDIR, f)
    if os.path.exists(src):
        os.rename(src, os.path.join(backup, f))
        print("backed up", src)

cmd = [
    CLI,
    "--generate-from-svb-key",
    os.path.join(WDIR, NAME),
    "--password",
    PASS,
    "--offline",
    "--restore-height",
    str(RESTORE),
    "--log-file",
    os.path.join(WDIR, "svb-create-recreate.log"),
    "--log-level",
    "1",
]

pid, fd = pty.fork()
if pid == 0:
    os.execv(CLI, cmd)

buf = b""
sent_addr = False
sent_svb = False
answered_mine = False
answered_restore = False
sent_exit = False
start = time.time()
while time.time() - start < 120:
    r, _, _ = select.select([fd], [], [], 0.4)
    if r:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
        buf += data
        text = buf.decode("utf-8", "replace")
        low = text.lower()
        if (not sent_addr) and "wallet address" in low:
            os.write(fd, (ADDR + "\n").encode())
            sent_addr = True
            print("\n[sent address]", flush=True)
        if sent_addr and (not sent_svb) and (
            "secret" in low or "view-balance" in low or "view balance" in low
        ):
            os.write(fd, (SVB + "\n").encode())
            sent_svb = True
            print("\n[sent svb]", flush=True)
        # Offline height estimates can lag real chain tip — always keep restore height.
        if (not answered_restore) and (
            "still apply restore height" in low or "apply restore height" in low
        ):
            os.write(fd, b"Y\n")
            answered_restore = True
            print("\n[answered Y to restore height]", flush=True)
        if (not answered_mine) and (
            "background mine" in low or "do you want to do it now" in low
        ):
            os.write(fd, b"N\n")
            answered_mine = True
            print("\n[answered N to mining]", flush=True)
        # Wallet open prompt after create — exit cleanly.
        if (
            not sent_exit
            and answered_mine
            and (
                "use the" in low
                or low.rstrip().endswith(">")
                or "[wallet" in low
                or "balance" in low[-200:]
            )
        ):
            os.write(fd, b"exit\n")
            sent_exit = True
            print("\n[sent exit]", flush=True)
    try:
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid:
            print("\nchild exited", status)
            break
    except ChildProcessError:
        break
else:
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass

keys = os.path.join(WDIR, f"{NAME}.keys")
if not os.path.exists(keys):
    print("FAILED: no keys file", file=sys.stderr)
    sys.exit(1)
os.chmod(keys, 0o600)
cache = os.path.join(WDIR, NAME)
if os.path.exists(cache):
    os.chmod(cache, 0o600)
print("SUCCESS", keys, "size", os.path.getsize(keys))
print("sent_addr", sent_addr, "sent_svb", sent_svb)
