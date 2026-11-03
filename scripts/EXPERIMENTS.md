# Website physics and recorded views

The website experiments use their own `SimWorld`, state file and lock. They do
not connect to hardware, the regular simulation instance, or the training process.

`experiment_server.py` runs CPU MuJoCo physics at the canonical model timestep.
The browser renders the measured joint and floating-base states. The motion
experiment uses the repository's `safe_base_step`, plus the real lift's 0.06 m/s
rate limit. The retargeting experiment executes selected recorded joint references
through position actuators and streams the resulting physical state.

The 5080 user service is `mabel-web-experiments.service`. Port 18824 is private:
its internal upstream connection and recording telemetry stay on loopback. Port
18825 exposes only `/teleop` and `/healthz`. Tailscale Funnel on **8443** publishes
that allowlisted listener. The pre-existing Funnel on 443 is unchanged.

The server owns a single 120-second FIFO lease across both experiments. It sends
position, people ahead, estimated wait and remaining turn time. Spectators receive
state; commands from non-owners are discarded. Leaving, disconnecting or expiring
resets the world and promotes the next visitor. Reset restores the model's home
keyframe and matching actuator targets.

Recorded assets are generated from actual states:

- `build_retarget_replays.py --robot-root ROOT`: the existing offline ablation
  harness, all seven maps for 20 episodes. Exports robot states only, up to the
  first six seconds or the end of the episode. No raw EgoDex human inputs are
  included. Names follow the active paper: GMR-like, Frozen fingers and Posture
  variant describe adapted/shared-map configurations.
- `build_base_odometry.py`: checks hashes and recomputes statistics from the
  active paper's frozen CSV traces before sampling. The stress run is explicitly
  partial. Wheel odometry is compared with ZED VIO/IMU, not motion-capture truth.
- `build_motion_replay.py --endpoint URL --robot-root ROOT`: records the actual
  queued MuJoCo motion experiment. Joint poses, speed and tilt are measured.
- `assets/setup/*-provenance.json`: actual MILO terminal/browser captures with
  simulation adapters and a dedicated scratch calibration copy. The cockpit
  capture attaches to measured MuJoCo telemetry; it does not use `--demo`.

The three concise MABEL results are calculated from the archived aggregate JSON;
no scores are changed or unsupported winner rankings shown. Hardware prices use
the same frozen CNY-to-USD conversion as the BOM generator.

Run `scripts/studiorefinementtest.py`, `learningcameratest.py`,
`overviewscenestest.py`, and `acctest.py` against the preview server. The studio
check covers Chrome desktop and WebKit mobile, actual orbit/recenter controls,
episode selection, recorded chapter seeks and compact replay/plot rows.
