#!/bin/bash

# autobuild
# ./build.sh

set -e
source .env

docker compose -f docker-compose.yml up -d

# setup rights
chmod -R a+rw workers valkey tmp
