#!/bin/bash
# Runs the revision-guard proof on a THROWAWAY PostgreSQL cluster on a private
# socket. Needs the Debian/Ubuntu postgresql package and root (initdb refuses
# to run as root, so the cluster is owned by the postgres user). Touches no
# real database. Usage: tests/sql/run.sh
set -e
cd "$(dirname "$0")"
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=/var/tmp/bp-pgproof; S=/var/tmp/bp-pgproof-sock
rm -rf $D $S; mkdir -p $S; chown postgres $S
su postgres -c "$BIN/initdb -D $D -A trust >/dev/null && $BIN/pg_ctl -D $D -o \"-p 54329 -k $S -c listen_addresses=''\" -l $D/log -w start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $D -m fast stop >/dev/null" || true' EXIT
psql -h $S -p 54329 -U postgres -X -q -c "create database proof"
sed -i "s#/var/tmp/pgproof-sock#$S#" lib.sh
./revision-guard.test.sh
