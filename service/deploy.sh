#!/bin/bash

# deploy diagrams placed in subdirs

set -e
source ../.env
auth='-u camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)

for filename in service/*.bpmn; do
   model=$(cat $filename |grep '  <bpmn:process id="' | cut -d'"' -f 2)
   upload='upload=@"./'$filename'"'
   deployname='deployment-name='$model
   curl -k -H "Content-Type: multipart/form-data" -X POST -F $upload -F $deployname -F 'deploy-changed-only=true' \
      https://localhost:$CLUSTER_GATE_PORT/engine-rest/deployment/create $auth
done

for filename in service/*.dmn; do
   model=$(cat $filename |grep '  <decision id="' | cut -d'"' -f 2)
   upload='upload=@"./'$filename'"'
   deployname='deployment-name='$model
   curl -k -H "Content-Type: multipart/form-data" -X POST -F $upload -F $deployname -F 'deploy-changed-only=true' \
      https://localhost:$CLUSTER_GATE_PORT/engine-rest/deployment/create $auth
done
