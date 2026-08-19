# TierFlow cluster deployment

TierFlow uses one repository and two installation modes:

- **controller**: runs the TierFlow API/database and a local Node Agent. It is the only public API entry and the authoritative business database.
- **worker**: runs a Node Agent plus model services. It does not run a second user/token/billing database.

The controller receives heartbeats at `/api/cluster/heartbeat`. Administrators can list nodes, drain a node, start/stop/restart a whitelisted model, read its journal and request SHA256 verification through `/api/cluster/nodes/...`.

## Network

For the first two DGX Spark machines, a direct 10GbE `/30` link is enough:

```text
controller  192.168.200.1/30
worker      192.168.200.2/30
```

Keep Wi-Fi as the default route. Bind model servers and the worker agent only to the fabric IP. With three or more nodes, use a managed 10GbE switch and a dedicated private subnet/VLAN.

## Build and install

Build the agent on ARM64:

```bash
cd node-agent
go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o tierflow-node-agent .
```

Create one random token and install the same token on the controller API and every Node Agent. Do not put it in Git.

```bash
openssl rand -hex 32 > cluster-agent.token
sudo deploy/cluster/install.sh \
  --mode worker \
  --binary node-agent/tierflow-node-agent \
  --config deploy/cluster/config/worker.json.example \
  --token-file cluster-agent.token \
  --install-model-units
```

Set the controller service environment to:

```text
CLUSTER_AGENT_TOKEN_FILE=/etc/tierflow/cluster-agent.token
CLUSTER_NODE_TIMEOUT_SECONDS=45
```

Model services intentionally conflict on a 120 GiB Spark, so the Node Agent switches between them instead of overcommitting unified memory.
