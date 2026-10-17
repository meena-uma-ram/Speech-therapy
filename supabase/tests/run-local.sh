#!/bin/sh
# Test the schema and its row-level security on a plain local PostgreSQL (no Supabase needed).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres sh supabase/tests/run-local.sh
set -e
cd "$(dirname "$0")/../.."
psql -q -v ON_ERROR_STOP=1 -c "drop database if exists tjs_test" -c "create database tjs_test"
psql -q -v ON_ERROR_STOP=1 -d tjs_test -f supabase/tests/local-stubs.sql -f supabase/migrations/0001_tjs_schema.sql
out=$(psql -q -At -v ON_ERROR_STOP=1 -d tjs_test -f supabase/tests/rls.test.sql 2>&1) || { echo "$out" | grep -E "ERROR|FAILED"; exit 1; }
echo "$out" | sed -n "s/.*NOTICE:  //p; /PASSED/p"
