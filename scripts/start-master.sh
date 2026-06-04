#!/bin/bash

screen -dmS cluster -- bash -c "node master | tee log.txt"
