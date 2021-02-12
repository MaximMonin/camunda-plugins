#!/bin/bash

set -e
source .env
CONTAINER=camunda-plugins-db-$ENVIRONMENT
echo "postgres restore.. " $CONTAINER
docker stop camunda-plugins-engine1-$ENVIRONMENT
docker stop camunda-plugins-engine2-$ENVIRONMENT
cat camunda.bkp | docker exec -i $CONTAINER psql -U postgres
./start.sh
