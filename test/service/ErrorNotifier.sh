#!/bin/bash

set -e
source ../../.env
auth='-u camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)

curl -k -H "Content-Type: application/json" -X POST \
  -d '{"timeout": 20, "variables": {"error": {"value": {"processId": "testProcessId", "processKey": "testProcessKey", "message": "Error message"}} } }' \
  https://localhost:$CLUSTER_GATE_PORT/engine-rest/process-definition/key/Service.ErrorNotifier/start $auth
