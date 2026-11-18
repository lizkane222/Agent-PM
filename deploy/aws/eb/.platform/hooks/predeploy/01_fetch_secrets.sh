#!/bin/bash
# Pull every SecureString under $SSM_PATH into the file EB sources before starting the app.
# Values are shell-quoted so a quote, $ or backtick in a secret can never run as a command.
set -euo pipefail
SSM_PATH="${SSM_PATH:-/agentpm/prod/}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(curl -s -m 2 http://169.254.169.254/latest/meta-data/placement/region || echo us-east-1)}}"
ENV_FILE=/opt/elasticbeanstalk/deployment/env

aws ssm get-parameters-by-path --path "$SSM_PATH" --recursive --with-decryption \
  --region "$REGION" --output json |
python3 -c '
import json, re, shlex, sys
for p in json.load(sys.stdin).get("Parameters", []):
    name = p["Name"].rsplit("/", 1)[-1]
    if re.fullmatch(r"[A-Z_][A-Z0-9_]*", name):
        print("export %s=%s" % (name, shlex.quote(p["Value"])))
' >> "$ENV_FILE"
