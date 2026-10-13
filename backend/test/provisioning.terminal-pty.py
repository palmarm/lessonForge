"""POSIX/Python 3 fixture-only regression against the built terminal prompt class.

From backend/: npm run build, then python3 test/provisioning.terminal-pty.py.
Do not run the build in a workspace containing real .env files during agent checks.
No database or provisioning entrypoint is used by these probes.
"""

import errno
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import termios
import time


FIXTURE = " Unicode 🔒 fixture-pressure-password ".encode()
MODES = [
    "success", "pressure",
    "pending-interrupt", "pending-eof", "pending-signal",
    "pending-input-error", "pending-output-error",
    "hidden-interrupt", "hidden-eof", "hidden-signal",
    "hidden-input-error", "hidden-output-error",
]


def run_case(mode):
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    captured = bytearray()
    script = Path(__file__).with_name("provisioning.terminal-probe.mjs")
    child = subprocess.Popen(
        ["node", str(script), mode],
        stdin=slave, stdout=slave, stderr=slave, close_fds=True,
    )

    def collect(timeout=0.1):
        if select.select([master], [], [], timeout)[0]:
            try:
                captured.extend(os.read(master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def wait_for(marker):
        deadline = time.monotonic() + 15
        while marker not in captured and time.monotonic() < deadline:
            collect()
            if child.poll() is not None:
                break
        assert marker in captured, (mode, "missing marker", marker.decode())

    def assert_hidden():
        assert not termios.tcgetattr(slave)[3] & termios.ECHO, (mode, "TTY echo enabled")
        assert FIXTURE not in captured, (mode, "fixture password exposed")
        assert b"fixture-pressure-password" not in captured, (mode, "secret fragment exposed")

    try:
        if mode == "pressure":
            marker = b"Pressure password [input hidden]: "
            wait_for(marker)
            deadline = time.monotonic() + 15
            writes = 0
            # Continue writing while prompt/idle editors are replaced, rather
            # than waiting for a stable prompt before every fixture input.
            while b"READY_PENDING" not in captured and time.monotonic() < deadline:
                assert child.poll() is None, (mode, "probe exited during pressure")
                assert_hidden()
                os.write(master, FIXTURE + b"\r")
                writes += 1
                collect(0.0005)
            assert b"READY_PENDING" in captured, (mode, "pressure barrier not reached")
            assert captured.count(marker) == 500, (mode, "not all transitions exercised")
            assert writes >= 500, (mode, "insufficient pressure input")
            assert_hidden()
            # Drain remaining input while the owner is still silent/raw, then
            # permit final cleanup. No fixture bytes are sent after this point.
            collect(0.1)
            assert_hidden()
            child.send_signal(signal.SIGUSR1)
            wait_for(b"SUCCESS")
        else:
            wait_for(b"Password [input hidden]: ")
            assert_hidden()
            if mode.startswith("hidden-"):
                if mode != "hidden-eof":
                    os.write(master, b"fixture-secret-fragment")
            else:
                os.write(master, FIXTURE + b"\x15\x19\r")
                wait_for(b"Confirmation [input hidden]: ")
                assert_hidden()
                os.write(master, b"\x19" + FIXTURE + b"\x15\x19\r")
                wait_for(b"READY_PENDING")
                before = bytes(captured)
                os.write(master, b"\x19pending text\x15\x19\x1b[A\x1b[D\x7f\t\r")
                collect(0.1)
                assert bytes(captured) == before, (mode, "idle editing echoed")
                assert_hidden()
            if mode == "success":
                child.send_signal(signal.SIGUSR1)
                wait_for(b"Visible answer: ")
                assert_hidden()
                os.write(master, b"\x19\x1f\x1b[Aaccepted\rvisible-tail")
                wait_for(b"SUCCESS")
            elif mode.endswith("interrupt"):
                os.write(master, b"\x03")
            elif mode.endswith("eof"):
                os.write(master, b"\x04")
            elif mode.endswith("signal"):
                child.send_signal(signal.SIGTERM)
            elif mode.endswith("input-error"):
                child.send_signal(signal.SIGUSR2)
            elif mode.endswith("output-error"):
                child.send_signal(signal.SIGHUP)
            if mode != "success":
                wait_for(b"CANCELLED")
        assert child.wait(timeout=15) == 0, (mode, "nonzero probe exit")
        collect(0)
        assert b"FINAL_RESTORE" in captured, (mode, "missing cleanup boundary")
        before_restore = bytes(captured).split(b"FINAL_RESTORE", 1)[0]
        for secret in [FIXTURE, b"fixture-pressure-password", b"fixture-secret-fragment", b"visible-tail"]:
            assert secret not in before_restore, (mode, "secret or trailing input exposed before restoration")
        assert termios.tcgetattr(slave) == original, (mode, "original TTY settings not restored")
        print(mode + ": passed (input hidden; TTY restored)")
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=15)
        os.close(master)
        os.close(slave)


if __name__ == "__main__":
    for selected_mode in MODES:
        run_case(selected_mode)
    print(str(len(MODES)) + " compiled real-PTY cases passed")
