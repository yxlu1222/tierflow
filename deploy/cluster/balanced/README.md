# Two-Spark balanced four-model profile

This profile assigns Qwen3.8-27B and LFM2.5-2.6B to the controller Spark,
and Nemotron-3.5-Lightning plus Ling-3.0-tiny to the worker Spark.

The controller runs Qwen at `mem-fraction-static=0.57` and starts LFM only
after Qwen is healthy. LFM reserves sixteen 131072-token slots.

The worker starts Nemotron first at `mem-fraction-static=0.55` with four
running requests. Ling waits for Nemotron readiness, then starts at
`mem-fraction-static=0.53` with eight running requests. Because Ling starts
after Nemotron, its fraction is applied to the memory remaining at that point.
This targets roughly 100 GiB node utilization while retaining approximately
18-22 GiB of available unified memory under load.

The node-agent files intentionally list only the models assigned to each
machine. Channel IDs are Qwen `2`, Nemotron `4`, LFM `5`, and Ling `6`.

The full unit files are required because systemd dependency directives such as
`Conflicts=` cannot be subtracted reliably from a drop-in. On the controller,
the legacy `tierflow-model-qwen38.service.d/lfm25-conflict.conf` drop-in must be
disabled when this profile is installed. On the worker, the legacy Ling cohost
warm-up drop-in must also be disabled because LFM is no longer placed there.
