#!/bin/bash

# deploy diagrams placed in subdirs

set -e
source ../.env
auth='-u camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)

for filename in service/*.bpmn; do
   model=$(cat $filename | grep '  <bpmn:process id="' | cut -d'"' -f 2)
   upload='upload=@"./'$filename'"'
   fileshort=$(echo $filename | cut -d'.' -f 1 | cut -d'/' -f 2)
   deployname='deployment-name='$fileshort
   echo $model' -> '$fileshort
   curl -k -H "Content-Type: multipart/form-data" -X POST -F $upload -F $deployname -F 'deploy-changed-only=true' \
      -F 'deployment-source=Camunda Modeler' https://localhost:$CLUSTER_GATE_PORT/engine-rest/deployment/create $auth
   echo ' done'
done

for filename in service/*.dmn; do
   model=$(cat $filename | grep '  <decision id="' | cut -d'"' -f 2)
   upload='upload=@"./'$filename'"'
   fileshort=$(echo $filename | cut -d'.' -f 1 | cut -d'/' -f 2)
   deployname='deployment-name='$fileshort
   echo $model' -> '$fileshort
   curl -k -H "Content-Type: multipart/form-data" -X POST -F $upload -F $deployname -F 'deploy-changed-only=true' \
      -F 'deployment-source=Camunda Modeler' https://localhost:$CLUSTER_GATE_PORT/engine-rest/deployment/create $auth
   echo ' done'
done
