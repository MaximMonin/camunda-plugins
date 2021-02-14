#!/bin/bash

set -e
source ../../.env
auth='-u camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)

for (( i=0; i<1000; ++i)); do
  curl -k -H "Content-Type: application/json" -X POST \
    -d '{"variables": {"withSavePoints": {"value": "false"} } }' \
    https://localhost:$CLUSTER_GATE_PORT/engine-rest/process-definition/key/Service.EngineSpeedTest/start $auth
done
