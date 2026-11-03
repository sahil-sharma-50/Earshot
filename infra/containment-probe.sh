#!/usr/bin/env bash
# Live containment proof, run ON the VM while a run is in progress:  ssh root@<ip> bash -s < infra/containment-probe.sh
# Shows a real sandbox's runtime/limits/env, then tries the cloud metadata IP directly (no route)
# and through the egress proxy (403 + a real BLOCKED event on that run's timeline).
for i in $(seq 1 120); do C=$(docker ps --filter label=earshot.sandbox=1 --format '{{.ID}} {{.Label "earshot.agent"}}' | grep -v inspector | head -1 | cut -d' ' -f1); [ -n "$C" ] && break; sleep 0.5; done
[ -n "$C" ] || { echo "no agent sandbox appeared"; exit 1; }
echo "sandbox $C"
docker inspect "$C" --format 'runtime={{.HostConfig.Runtime}} user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} mem={{.HostConfig.Memory}} cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} caps_drop={{.HostConfig.CapDrop}}'
echo "-- env (minus image defaults):"
docker inspect "$C" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|LANG|LC_ALL|PLAYWRIGHT|HOME)='
P=$(docker inspect "$C" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep EARSHOT_PROXY | cut -d= -f2)
cat > /tmp/direct.js <<'JS'
fetch('http://169.254.169.254/latest/meta-data', { signal: AbortSignal.timeout(5000) }).then(r => console.log('REACHED', r.status)).catch(e => console.log('direct to metadata: no route (' + (e.cause?.code || e.name) + ')'));
JS
cat > /tmp/viaproxy.js <<'JS'
const u = new URL(process.argv[2]);
require('http').get({ host: u.hostname, port: u.port, path: 'http://169.254.169.254/latest/meta-data', headers: { host: '169.254.169.254' } }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => console.log('via proxy:', r.statusCode, b)); }).on('error', e => console.log('via proxy error', e.code));
JS
docker cp /tmp/direct.js "$C":/tmp/direct.js >/dev/null 2>&1 || true
docker exec -i "$C" node - < /tmp/direct.js
docker exec -i "$C" node - "$P" < /tmp/viaproxy.js
