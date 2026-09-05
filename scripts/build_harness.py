#!/usr/bin/env python3
"""assets/data/harness.json ← claude_harness/data/commands.yaml.

THE PAGE IS GENERATED, and that is the whole point. harness.html publishes what
the AI harness can do; the repo decides what it can do. Typing the list twice is
how a page ends up advertising a command that was renamed a month ago.

The same registry is rendered by `/mabel-help` in the repo and gated in both
directions by `mabel.py drift` — a command with no file on disk fails, and a
file on disk this page never mentions fails too. So "is the page complete?" is
a question the repo answers rather than a thing anyone remembers to check.

    python3 scripts/build_harness.py            # write assets/data/harness.json
    python3 scripts/build_harness.py --check    # non-zero if it would change
"""
from __future__ import annotations
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
REPO = os.path.dirname(SITE)
SRC = os.path.join(REPO, "claude_harness", "data", "commands.yaml")
OUT = os.path.join(SITE, "assets", "data", "harness.json")

try:
    import yaml
except ImportError:
    sys.exit("PyYAML not found. Run this in the mabel env "
             "(~/miniconda3/envs/mabel/bin/python3).")


def one_line(s):
    return " ".join((s or "").split())


def git_short(path):
    """The commit that last touched the registry — so the page can date itself."""
    try:
        return subprocess.run(["git", "log", "-1", "--format=%h %cs", "--", path],
                              cwd=REPO, capture_output=True, text=True,
                              timeout=10).stdout.strip() or None
    except Exception:
        return None


def build():
    reg = yaml.safe_load(open(SRC))
    groups = []
    for g in reg.get("groups", []):
        cmds = []
        for c in g.get("commands", []):
            cmds.append({
                "name": c["name"],
                "args": "" if c.get("args") in ("—", "-", None) else c["args"],
                "purpose": one_line(c.get("purpose")),
                "reads": one_line(c.get("reads")),
                "safety": c.get("safety", "read"),
                "status": c.get("status", "shipped"),
                "note": one_line(c.get("note")) or None,
                "view": c.get("view"),
            })
        groups.append({"id": g["id"], "name": g["name"],
                       "blurb": one_line(g.get("blurb")), "commands": cmds})

    return {
        "generated_by": "website/scripts/build_harness.py",
        "source": "claude_harness/data/commands.yaml",
        "registry_commit": git_short(SRC),
        "namespace": reg.get("namespace", "mabel"),
        "total": sum(len(g["commands"]) for g in groups),
        "groups": groups,
        "not_built": [{"what": one_line(n.get("what")), "why": one_line(n.get("why"))}
                      for n in reg.get("not_built", [])],
        "retired": reg.get("retired") or {},
    }


def main():
    data = build()
    text = json.dumps(data, indent=1) + "\n"
    if "--check" in sys.argv:
        cur = open(OUT).read() if os.path.exists(OUT) else ""
        # the commit stamp moves on every commit; compare everything else
        strip = lambda t: "\n".join(l for l in t.splitlines()
                                    if '"registry_commit"' not in l)
        # run_all.sh reads the verdict line, not the exit code — a check that
        # only sets $? reported FAIL while passing.
        if strip(cur) != strip(text):
            print("assets/data/harness.json is STALE — re-run scripts/build_harness.py")
            print("\nRESULT: FAIL")
            return 1
        print(f"harness.json matches the registry ({data['total']} commands)")
        print("\nRESULT: PASS")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write(text)
    print(f"wrote assets/data/harness.json — {data['total']} commands in "
          f"{len(data['groups'])} groups, from {data['source']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
