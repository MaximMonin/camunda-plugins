#!/bin/bash
cd cfg
sudo docker build --network host -t camunda-plugins:latest .
cd ..

cd workers/node
./build.sh
cd ../..
