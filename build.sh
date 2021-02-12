#!/bin/bash
cd cfg
sudo docker build -t camunda-plugins:latest .
cd ..

cd workers/node
./build.sh
cd ../..
