#!/bin/bash

set -e
source ../../.env
auth='-u camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)

curl -k -H "Content-Type: application/json" -X POST \
  -d '{"timeout": 20, "variables": {"incident": {"value": {"id": "testid", "processId": "testProcessId", "processKey": "testProcessKey", "message": "Test message"}} } }' \
  https://localhost:$CLUSTER_GATE_PORT/engine-rest/process-definition/key/Service.IncidentHandler/start $auth
