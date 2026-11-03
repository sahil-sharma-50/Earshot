#!/usr/bin/env bash
# Creates the Earshot VM on Vultr (BILLABLE: vc2-2c-4gb in fra, ~$20/month from credit).
# Run from the repo root ONLY after the owner has confirmed. Uses the project vultr-cli wrapper.
# Everything is labelled/tagged agent-rush so it can be found and removed.
set -euo pipefail
cd "$(dirname "$0")/.."
V=./.tools/bin/vultr
REGION=${REGION:-fra}
PLAN=${PLAN:-vc2-2c-4gb}
PUBKEY_FILE=${PUBKEY_FILE:-$HOME/.ssh/id_ed25519.pub}
py() { python -I -c "$1"; }

[ -f "$PUBKEY_FILE" ] || { echo "missing $PUBKEY_FILE (run ssh-keygen -t ed25519 first)"; exit 1; }
export PUBKEY="$(cat "$PUBKEY_FILE")"

# 1. SSH key (reuse if this public key is already registered)
KEY_ID=$($V ssh-key list -o json | py "
import json, os, sys
want = os.environ['PUBKEY'].split()[:2]
keys = [k for k in json.load(sys.stdin).get('ssh_keys', []) if k['ssh_key'].split()[:2] == want]
print(keys[0]['id'] if keys else '')")
if [ -z "$KEY_ID" ]; then
  KEY_ID=$($V ssh-key create --name earshot-agent-rush --key "$PUBKEY" -o json | py "import json,sys; print(json.load(sys.stdin)['ssh_key']['id'])")
fi
echo "ssh key: $KEY_ID"

# 2. Firewall group: 80/443 open, 22 from this machine only
FW_ID=$($V firewall group list -o json | py "
import json, sys
g = [x for x in json.load(sys.stdin).get('firewall_groups', []) if x.get('description') == 'earshot-agent-rush']
print(g[0]['id'] if g else '')")
if [ -z "$FW_ID" ]; then
  FW_ID=$($V firewall group create --description earshot-agent-rush -o json | py "import json,sys; print(json.load(sys.stdin)['firewall_group']['id'])")
  MYIP=$(curl -s https://api.ipify.org)
  $V firewall rule create "$FW_ID" --ip-type v4 --protocol tcp --port 80 --subnet 0.0.0.0 --size 0 --notes "http: ACME + redirect" >/dev/null
  $V firewall rule create "$FW_ID" --ip-type v4 --protocol tcp --port 443 --subnet 0.0.0.0 --size 0 --notes "https" >/dev/null
  $V firewall rule create "$FW_ID" --ip-type v4 --protocol tcp --port 22 --subnet "$MYIP" --size 32 --notes "ssh from owner" >/dev/null
fi
echo "firewall group: $FW_ID"

# 3. Ubuntu 24.04 x64 id, from live data
OS_ID=$($V os list -o json | py "
import json, sys
print([o['id'] for o in json.load(sys.stdin)['os'] if o['name'].startswith('Ubuntu 24.04') and 'x64' in o['name']][0])")
echo "os: $OS_ID"

# 4. Instance
INSTANCE_ID=$($V instance create --region "$REGION" --plan "$PLAN" --os "$OS_ID" --label earshot --tags agent-rush \
  --ssh-keys "$KEY_ID" --firewall-group "$FW_ID" --host earshot -o json | py "import json,sys; print(json.load(sys.stdin)['instance']['id'])")
echo "instance: $INSTANCE_ID (waiting for it to become active)"

IP=""
for _ in $(seq 1 60); do
  read -r STATUS IP < <($V instance get "$INSTANCE_ID" -o json | py "import json,sys; i=json.load(sys.stdin)['instance']; print(i['status'], i['main_ip'])")
  if [ "$STATUS" = "active" ] && [ "$IP" != "0.0.0.0" ]; then break; fi
  sleep 10
done
echo "VM ready: $IP"
echo "public host: $(echo "$IP" | tr . -).sslip.io"
