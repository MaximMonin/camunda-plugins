#!/bin/bash

set -e
source ../../.env
user='camunda:'$(echo $CAMUNDA_PASSWORD | base64 --decode -w0)
auth=$(echo -n $user | base64)
docker pull williamyeh/wrk

myip=$(hostname -I | cut -d' ' -f1)
# run 100 connections within 10 threads during 10 seconds (spam start process)
docker run --rm -v `pwd`:/data --net camunda-plugins-$ENVIRONMENT williamyeh/wrk -s stress2.lua -t10 -c100 -d10s -H "Authorization: Basic $auth" \
  https://$myip:$CLUSTER_GATE_PORT/engine-rest/process-definition/key/Service.EngineSpeedTest/start
