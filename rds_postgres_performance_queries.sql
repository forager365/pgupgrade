-- ============================================
-- AWS RDS PostgreSQL Performance Metrics
-- ============================================

-- 1. Current Database Connections
SELECT 
    datname,
    count(*) as connections,
    max_conn,
    round(100.0 * count(*) / max_conn, 2) as pct_used
FROM pg_stat_activity, 
    (SELECT setting::int as max_conn FROM pg_settings WHERE name='max_connections') mc
GROUP BY datname, max_conn
ORDER BY connections DESC;

-- 2. Long Running Queries
SELECT 
    pid,
    usename,
    datname,
    state,
    query_start,
    now() - query_start as duration,
    wait_event_type,
    wait_event,
    left(query, 100) as query
FROM pg_stat_activity
WHERE state != 'idle' 
    AND query_start < now() - interval '5 minutes'
ORDER BY duration DESC;

-- 3. Table Statistics (Most Active Tables)
SELECT 
    schemaname,
    relname,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_live_tup,
    n_dead_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_tup_pct
FROM pg_stat_user_tables
ORDER BY seq_scan + idx_scan DESC
LIMIT 20;

-- 4. Index Usage Statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC
LIMIT 20;

-- 5. Cache Hit Ratio (should be > 99%)
SELECT 
    datname,
    blks_read,
    blks_hit,
    round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) as cache_hit_ratio
FROM pg_stat_database
WHERE datname IS NOT NULL
ORDER BY cache_hit_ratio;

-- 6. Database Size and Growth
SELECT 
    datname,
    pg_size_pretty(pg_database_size(datname)) as size,
    numbackends as connections
FROM pg_stat_database
WHERE datname NOT IN ('template0', 'template1', 'rdsadmin')
ORDER BY pg_database_size(datname) DESC;

-- 7. Top 20 Slowest Queries (requires pg_stat_statements)
SELECT 
    round(total_exec_time::numeric, 2) as total_time_ms,
    calls,
    round(mean_exec_time::numeric, 2) as mean_time_ms,
    round(max_exec_time::numeric, 2) as max_time_ms,
    round(stddev_exec_time::numeric, 2) as stddev_time_ms,
    rows,
    left(query, 100) as query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 8. Blocking Queries
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS blocking_statement
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- 9. Vacuum and Analyze Statistics
SELECT 
    schemaname,
    relname,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count,
    analyze_count,
    autoanalyze_count
FROM pg_stat_user_tables
ORDER BY last_autovacuum NULLS FIRST
LIMIT 20;

-- 10. Replication Lag (for read replicas)
SELECT 
    client_addr,
    state,
    sync_state,
    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) as lag_bytes,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) as lag_size
FROM pg_stat_replication;

-- 11. Transaction ID Wraparound Risk
SELECT 
    datname,
    age(datfrozenxid) as xid_age,
    2147483647 - age(datfrozenxid) as xids_remaining,
    round(100.0 * age(datfrozenxid) / 2147483647, 2) as pct_towards_wraparound
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

-- 12. Wait Events Summary
SELECT 
    wait_event_type,
    wait_event,
    count(*) as count
FROM pg_stat_activity
WHERE wait_event IS NOT NULL
GROUP BY wait_event_type, wait_event
ORDER BY count DESC;
