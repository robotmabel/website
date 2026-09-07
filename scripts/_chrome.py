"""Kill the check's Chrome and delete its profile, on EVERY exit path.

Each check drives its own headless Chrome against a throwaway `--user-data-dir`
under /tmp. Most of them cleaned up only on the happy path — a bare
`p.terminate()` after `asyncio.run(...)`, which never runs if the check raises,
times out, is interrupted, or is killed for memory. A profile is 30–150 MB.

That is not hypothetical: after one working day of suite runs, several of them
killed mid-flight, /tmp held 115 orphaned profiles totalling 5.5 GB, with no
Chrome alive to own any of them. The leak is silent — nothing fails, the disk
just fills.

    from _chrome import cleanup_on_exit
    p = subprocess.Popen([CHROME, ..., f"--user-data-dir={PROF}", ...])
    cleanup_on_exit(p)

One line, and the profile path is read back out of the process's own argv, so
the caller does not have to name it and cannot name it wrongly.

WHAT THIS COVERS: a normal return, sys.exit, an unhandled exception, and
SIGINT/SIGTERM (both are converted to a normal exit so atexit still runs).
What nothing can cover is SIGKILL — for that, run_all.sh sweeps on entry.
"""
from __future__ import annotations
import atexit
import os
import shutil
import signal
import subprocess

_registered = []


def _profile_of(proc) -> str | None:
    """The --user-data-dir this process was launched with, from its own argv."""
    for a in getattr(proc, "args", []) or []:
        a = str(a)
        if a.startswith("--user-data-dir="):
            return a.split("=", 1)[1]
    return None


def _reap(proc, prof):
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Chrome does not always honour SIGTERM inside the deadline,
                # and rm on a live profile leaves the lock files behind.
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
    except Exception:
        pass
    if prof and prof.startswith("/tmp/") and os.path.isdir(prof):
        shutil.rmtree(prof, ignore_errors=True)


def cleanup_on_exit(proc, prof: str | None = None):
    """Register `proc` and its profile for teardown however this process ends."""
    prof = prof or _profile_of(proc)
    _registered.append((proc, prof))

    if len(_registered) == 1:
        atexit.register(_reap_all)
        # A signalled death skips atexit unless the signal is turned into a
        # normal exit. SIGTERM is how the suite runner and the OOM reaper stop
        # a check, and that is exactly when a profile used to be stranded.
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            try:
                if signal.getsignal(sig) in (signal.SIG_DFL, signal.default_int_handler):
                    signal.signal(sig, _on_signal)
            except (ValueError, OSError):
                pass          # not the main thread, or the platform refuses
    return proc


def _reap_all():
    while _registered:
        _reap(*_registered.pop())


def _on_signal(signum, _frame):
    _reap_all()
    # 128+n is the shell's convention for "died on signal n", and it keeps a
    # signalled check distinguishable from a check that merely failed.
    os._exit(128 + signum)


def sweep(prefix: str = "/tmp/cdp-", max_age_s: int = 6 * 3600) -> int:
    """Delete stale profiles nothing is using. For run_all.sh, on entry.

    SIGKILL runs no handler, so a hard-killed check still strands its profile.
    This is the floor under that: anything matching the prefix, older than
    max_age_s, and not currently open by a running Chrome.
    """
    import glob
    import time
    # `ps -Ao args=`, NOT `pgrep -af`. macOS pgrep has no -a, so it printed bare
    # PIDs, the parse found no --user-data-dir= token, `live` came back empty,
    # and the sweep deleted the profile of a check that was still running. The
    # exception guard hid it: a wrong answer, not an error.
    live = set()
    try:
        out = subprocess.run(["ps", "-Ao", "args="],
                             capture_output=True, text=True, timeout=10).stdout
        for line in out.splitlines():
            for tok in line.split():
                if tok.startswith("--user-data-dir="):
                    live.add(tok.split("=", 1)[1])
    except Exception:
        pass

    now, gone = time.time(), 0
    for d in glob.glob(prefix + "*"):
        if d in live or not os.path.isdir(d):
            continue
        try:
            if now - os.path.getmtime(d) < max_age_s:
                continue
        except OSError:
            continue
        shutil.rmtree(d, ignore_errors=True)
        gone += 1
    return gone


if __name__ == "__main__":
    n = sweep(max_age_s=0)
    print(f"swept {n} stale Chrome profile(s)")
