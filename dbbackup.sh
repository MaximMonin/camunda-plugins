#!/bin/bash

set -e
source .env
CONTAINER=camunda-plugins-db-$ENVIRONMENT
echo "postgres backup.. " $CONTAINER
docker exec -t $CONTAINER pg_dumpall -c -U postgres > camunda.bkp
