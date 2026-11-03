# Public simulation queue

The overview uses the complete camera/teleop console with an orbitable robot picture-in-picture. `assets/teleop-app.js` joins the queue explicitly; spectators receive state but cannot send movement, reset or joint commands. Sessions last 120 seconds. Expiry or disconnect resets the simulated plant and advances the FIFO queue. Offline waiting does not consume a session.

The gateway in `sim_queue_server.py` enforces these rules on the server. Client-side button disabling is only a UI affordance. Each spectator has a bounded output buffer, so a slow connection cannot block another visitor's state or the lease timer.

Queue updates report `people_ahead` (including the current driver), `estimated_wait_seconds`, and the current turn's remaining time. The estimate is the active turn's remainder plus two minutes per queued visitor ahead. Early departures shorten it. When the simulation is unavailable, the estimate is null and the UI shows that the visitor's place is held. Joining or reconnecting does not extend an active lease.

## Dedicated simulation routing

- Caddy `/sim/teleop` → loopback `127.0.0.1:7011/teleop` (queue gateway).
- Gateway → `ws://127.0.0.1:7006/teleop` (existing simulation tunnel).
- `/sim/camera/*` remains on the simulation video service at 7007.
- Keep the existing Caddy token gate. The gateway binds to loopback.
- Physical robot `/teleop`, `/real/*`, `/real-video/*` and Hive routes are separate and must remain unchanged.

The home simulation host supplies MuJoCo state and camera frames through the existing tunnel. The gateway does not replace that host or fabricate a video feed when it is unavailable.

## Home GPU host

The home host runs two enabled user services, `mabel-web-sim.service` and `mabel-web-sim-tunnel.service`, with lingering enabled. The simulation uses its own environment at `~/.local/share/mabel-web-sim/venv`, EGL rendering, the canonical home scene and the simulation bridge as the sole physics owner. The tunnel registers only `mabel_sim_control` and `mabel_sim_video`. Its configuration is private at `~/.config/mabel-web-sim/relay.toml`; never commit it.

Use `systemctl --user status mabel-web-sim.service mabel-web-sim-tunnel.service` and `journalctl --user -u mabel-web-sim.service` on that host. Restart both with `systemctl --user restart mabel-web-sim.service mabel-web-sim-tunnel.service`.

## Install / update

Use an isolated virtual environment with `aiohttp>=3.9,<4`. Install the script at `/opt/mabel-sim-queue/sim_queue_server.py` and the included `mabel-sim-queue.service` in `/etc/systemd/system/`. The unit uses the virtual environment at `/opt/mabel-sim-queue/venv`.

Before changing Caddy, back up its configuration privately. Change only the control upstream inside the existing `/sim/*` handler from 7006 to 7011; validate and gracefully reload Caddy. Do not change the other routes or restart the tunnel.

`GET http://127.0.0.1:7011/healthz` reports aggregate readiness and queue length without identifying visitors. `python scripts/simqueuetest.py` tests real WebSocket clients against a simulated upstream: exclusive commands, FIFO order, expiry, reset, disconnect handoff and offline waiting.
