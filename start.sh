#!/bin/bash

# autobuild
# ./build.sh

set -e
source .env

if [[ $REPLICA_PORT ]]; then 
  docker-compose -f docker-compose.yml -f replica-compose.yml up -d
else 
  docker-compose -f docker-compose.yml up -d
fi
# setup rights
chmod -R a+rw workers redis
