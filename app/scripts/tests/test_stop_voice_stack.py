"""
stop-voice-stack.sh kills processes, so the property that matters is what it refuses to kill.

These tests start real, harmless processes and run the script against them:
  * a foreign process listening on the relay port must be LEFT ALONE (the script identifies the
    relay by port AND working directory, not by the generic name "node server.js");
  * a cloudflared-looking process pointed at some other port must be LEFT ALONE;
  * this project's own relay and a tunnel to its ports are stopped.
"""

import os
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
SCRIPT = APP / "scripts" / "stop-voice-stack.sh"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_script(*args, relay_port, django_port=1):
    env = dict(os.environ, VOICE_RELAY_PORT=str(relay_port), DJANGO_PORT=str(django_port))
    return subprocess.run(["sh", str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=30)


def alive(proc) -> bool:
    return proc.poll() is None


class Listener:
    """A real process listening on a port, started from a chosen working directory."""

    def __init__(self, port, cwd):
        code = textwrap.dedent(f"""
            import socket, time
            s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", {port})); s.listen(); time.sleep(60)
        """)
        self.proc = subprocess.Popen([sys.executable, "-c", code], cwd=cwd)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                return
            except OSError:
                time.sleep(0.1)
        raise RuntimeError("listener did not start")

    def stop(self):
        if alive(self.proc):
            self.proc.kill()
        self.proc.wait()


class FakeTunnel:
    """Looks like `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` to pgrep."""

    def __init__(self, port):
        self.dir = tempfile.mkdtemp()
        # NOT `exec sleep`: exec would replace the process, so `ps`/`pgrep` would see "sleep 60"
        # instead of the tunnel command line, and the script under test could never match it.
        # Running sleep as a child keeps this shell — and its real argv — alive and visible.
        fake = Path(self.dir) / "cloudflared"
        fake.write_text("#!/bin/sh\nsleep 60\n")
        fake.chmod(0o755)
        self.proc = subprocess.Popen(
            [str(fake), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
        )
        time.sleep(0.3)

    def stop(self):
        subprocess.run(["pkill", "-P", str(self.proc.pid)], capture_output=True)
        if alive(self.proc):
            self.proc.kill()
        self.proc.wait()


class StopVoiceStackTests(unittest.TestCase):
    def setUp(self):
        self.cleanup = []

    def tearDown(self):
        for c in self.cleanup:
            c.stop()

    def _own(self, obj):
        self.cleanup.append(obj)
        return obj

    def test_the_script_exists_and_is_valid_shell(self):
        self.assertTrue(SCRIPT.exists())
        self.assertEqual(subprocess.run(["sh", "-n", str(SCRIPT)]).returncode, 0)

    def test_dry_run_stops_nothing(self):
        port = free_port()
        relay_dir = APP / "voice-relay-server"
        relay = self._own(Listener(port, relay_dir))
        out = run_script("--dry-run", relay_port=port)
        self.assertIn("would stop voice relay", out.stdout)
        self.assertTrue(alive(relay.proc), "a dry run must not kill anything")

    def test_stops_this_projects_relay(self):
        port = free_port()
        relay = self._own(Listener(port, APP / "voice-relay-server"))
        out = run_script(relay_port=port)
        relay.proc.wait(timeout=5)
        self.assertFalse(alive(relay.proc), out.stdout)
        self.assertIn("stopped voice relay", out.stdout)

    def test_leaves_a_foreign_process_on_the_relay_port_alone(self):
        # Another project's server on the same port: identified by port alone, it would die.
        port = free_port()
        foreign = self._own(Listener(port, tempfile.gettempdir()))
        out = run_script(relay_port=port)
        self.assertTrue(alive(foreign.proc), "killed a process that is not this project's relay")
        self.assertIn("left alone", out.stdout)
        self.assertIn("not this project's relay", out.stdout)

    def test_the_fake_tunnel_really_looks_like_a_tunnel_to_pgrep(self):
        # Guards the fixture itself: if this fails, every "left alone" test below would pass
        # for the wrong reason (nothing matched because nothing LOOKED like a tunnel).
        port = free_port()
        tunnel = self._own(FakeTunnel(port))
        found = subprocess.run(["pgrep", "-f", f"cloudflared tunnel .*--url http://127.0.0.1:{port}$"],
                               capture_output=True, text=True)
        self.assertIn(str(tunnel.proc.pid), found.stdout.split())

    def test_stops_a_tunnel_to_the_relay_port(self):
        port = free_port()
        tunnel = self._own(FakeTunnel(port))
        run_script(relay_port=port)
        tunnel.proc.wait(timeout=5)
        self.assertFalse(alive(tunnel.proc))

    def test_leaves_a_tunnel_to_some_other_port_alone(self):
        port, other = free_port(), free_port()
        stranger = self._own(FakeTunnel(other))
        run_script(relay_port=port)
        self.assertTrue(alive(stranger.proc), "killed a tunnel that belongs to something else")

    def test_a_port_that_merely_starts_with_the_same_digits_is_not_matched(self):
        # 8765 must not match 87650 (a different tunnel): the pattern is anchored to the end of
        # the argument. The ports are chosen, not taken from the OS: OS-assigned ports are five
        # digits, so appending a digit overflows 65535 and the test silently stops testing a
        # prefix at all (it passed with the anchor removed).
        relay_port, lookalike_port = 4321, 43210
        self.assertTrue(str(lookalike_port).startswith(str(relay_port)))
        self.assertLess(lookalike_port, 65536)
        lookalike = self._own(FakeTunnel(lookalike_port))
        run_script(relay_port=relay_port)
        self.assertTrue(alive(lookalike.proc), "a tunnel to :43210 was killed as if it were :4321")

    def test_the_real_port_is_still_matched_when_a_lookalike_exists(self):
        relay_port, lookalike_port = 4322, 43220
        target = self._own(FakeTunnel(relay_port))
        lookalike = self._own(FakeTunnel(lookalike_port))
        run_script(relay_port=relay_port)
        target.proc.wait(timeout=5)
        self.assertFalse(alive(target.proc))
        self.assertTrue(alive(lookalike.proc))

    def test_reports_cleanly_when_nothing_is_running(self):
        out = run_script(relay_port=free_port())
        self.assertEqual(out.returncode, 0)
        self.assertIn("no voice relay or tunnels were running", out.stdout)

    def test_never_uses_a_broad_process_name_kill(self):
        # Executable lines only: the header comment names these commands to explain why they
        # are banned, and that explanation must not trip the check.
        code = "\n".join(l for l in SCRIPT.read_text().splitlines() if not l.lstrip().startswith("#"))
        for bad in ("pkill cloudflared", "pkill node", "killall", "pkill -f node", 'pkill -f "node server.js"'):
            self.assertNotIn(bad, code)

    def test_the_source_scan_actually_sees_executable_lines(self):
        # A scan over an empty string would pass forever.
        code = "\n".join(l for l in SCRIPT.read_text().splitlines() if not l.lstrip().startswith("#"))
        self.assertIn("pgrep -f", code)
        self.assertIn("kill_pid", code)


if __name__ == "__main__":
    unittest.main()
