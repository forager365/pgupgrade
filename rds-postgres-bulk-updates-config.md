# RDS PostgreSQL Configuration for Bulk Updates (Multi-AZ)

## Instance Configuration

### Instance Class
**Recommended**: `db.r6i.xlarge` or larger (memory-optimized)

**Why**: Bulk updates require high memory for sorting, indexing, and transaction buffers

| Workload Size | Instance Class | vCPU | RAM | Storage |
|---------------|---------------|------|-----|---------|
| Small | db.r6i.large | 2 | 16GB | 500GB gp3 |
| Medium | db.r6i.xlarge | 4 | 32GB | 1TB gp3 |
| Large | db.r6i.2xlarge | 8 | 64GB | 2TB gp3 |
| Very Large | db.r6i.4xlarge | 16 | 128GB | 4TB gp3 |

### Storage Configuration
- **Type**: `gp3` (General Purpose SSD)
- **IOPS**: 12,000+ (provisioned)
- **Throughput**: 500 MB/s+
- **Why**: Bulk updates generate heavy write I/O

**Storage Sizing**:
- Base storage: 2-3x your data size
- Account for WAL files (can grow to several GB during bulk updates)
- Enable storage autoscaling with 20% threshold

## PostgreSQL Parameter Configuration

### Memory Settings

```ini
# Shared memory for caching (25% of RAM)
shared_buffers = 8GB  # For 32GB instance

# Memory per sort/hash operation
work_mem = 128MB  # Increase for bulk updates

# Memory for maintenance operations (VACUUM, CREATE INDEX)
maintenance_work_mem = 2GB  # Critical for post-update cleanup

# Query planner's assumption of cache size (75% of RAM)
effective_cache_size = 24GB  # For 32GB instance
```

### Write Performance Tuning

```ini
# WAL buffer size
wal_buffers = 16MB

# Time between automatic WAL checkpoints
checkpoint_timeout = 15min  # Increased from default 5min

# Maximum size of WAL between checkpoints
max_wal_size = 4GB  # Increased from default 1GB

# Checkpoint completion target
checkpoint_completion_target = 0.9  # Spread checkpoint I/O

# Synchronous commit (consider async for bulk loads)
synchronous_commit = on  # Keep on for Multi-AZ consistency
```

### Autovacuum Configuration (Critical)

```ini
# Enable autovacuum
autovacuum = on

# Number of autovacuum workers
autovacuum_max_workers = 4  # Increase for large databases

# Time between autovacuum runs
autovacuum_naptime = 10s  # More aggressive than default 60s

# Fraction of table size to trigger vacuum
autovacuum_vacuum_scale_factor = 0.05  # Default 0.2

# Fraction of table size to trigger analyze
autovacuum_analyze_scale_factor = 0.05  # Default 0.1

# Cost limit for autovacuum
autovacuum_vacuum_cost_limit = 2000  # Increased from default 200

# Delay between cost limit cycles
autovacuum_vacuum_cost_delay = 2ms  # Default 2ms
```

### Connection Settings

```ini
# Maximum number of connections
max_connections = 200  # Adjust based on workload

# Maximum prepared transactions (if using)
max_prepared_transactions = 0  # Set to max_connections if needed
```

### Logging (for monitoring)

```ini
# Log slow queries
log_min_duration_statement = 1000  # Log queries > 1 second

# Log autovacuum activity
log_autovacuum_min_duration = 0  # Log all autovacuum runs

# Log checkpoints
log_checkpoints = on
```

## Multi-AZ Specific Considerations

### Synchronous Replication Impact

**How it works**:
- Primary writes data
- Data replicates to standby synchronously
- Commit waits for standby acknowledgment
- Network latency affects commit times

**Optimization strategies**:

1. **Batch commits** to reduce round trips
```sql
-- Bad: Row-by-row commits
UPDATE table SET col = val WHERE id = 1;
COMMIT;
UPDATE table SET col = val WHERE id = 2;
COMMIT;

-- Good: Batch commits
BEGIN;
UPDATE table SET col = val WHERE id BETWEEN 1 AND 10000;
COMMIT;
```

2. **Monitor replication lag**
```sql
SELECT 
    client_addr,
    state,
    sync_state,
    replay_lag
FROM pg_stat_replication;
```

### Parameter Adjustments for Multi-AZ

```ini
# Keep synchronous commit on for data durability
synchronous_commit = on

# Standby query conflicts (if read replicas)
max_standby_streaming_delay = 30s

# Hot standby feedback (prevents query cancellations)
hot_standby_feedback = on
```

## Application Best Practices

### 1. Use COPY for Bulk Inserts

```sql
-- Much faster than individual INSERTs
COPY table_name FROM STDIN WITH (FORMAT csv);
```

```python
# Python example
import io
import psycopg2

data = io.StringIO("1,value1\n2,value2\n")
cursor.copy_from(data, 'table_name', sep=',', columns=('id', 'col'))
```

### 2. Batch Updates

```python
# Update in chunks
BATCH_SIZE = 10000

for offset in range(0, total_rows, BATCH_SIZE):
    cursor.execute("""
        UPDATE table 
        SET col = val 
        WHERE id >= %s AND id < %s
    """, (offset, offset + BATCH_SIZE))
    conn.commit()
```

### 3. Disable Indexes During Bulk Updates

```sql
-- Drop indexes before bulk update
DROP INDEX idx_table_col;

-- Perform bulk update
UPDATE table SET col = new_val WHERE condition;

-- Recreate index concurrently (no table lock)
CREATE INDEX CONCURRENTLY idx_table_col ON table(col);
```

### 4. Use Unlogged Tables (if data loss acceptable)

```sql
-- Temporarily make table unlogged
ALTER TABLE table_name SET UNLOGGED;

-- Perform bulk updates (no WAL overhead)
UPDATE table_name SET col = val;

-- Make table logged again
ALTER TABLE table_name SET LOGGED;
```

### 5. Disable Triggers Temporarily

```sql
-- Disable triggers
ALTER TABLE table_name DISABLE TRIGGER ALL;

-- Perform bulk update
UPDATE table_name SET col = val;

-- Re-enable triggers
ALTER TABLE table_name ENABLE TRIGGER ALL;
```

### 6. Use Parallel Query (PostgreSQL 11+)

```sql
-- Enable parallel query for session
SET max_parallel_workers_per_gather = 4;

-- Update will use parallel workers if beneficial
UPDATE large_table SET col = val WHERE condition;
```

## Monitoring

### CloudWatch Metrics

**Critical metrics to monitor**:

| Metric | Threshold | Action |
|--------|-----------|--------|
| WriteIOPS | < 80% of provisioned | Increase IOPS if consistently high |
| WriteThroughput | < 80% of provisioned | Increase throughput |
| ReplicaLag | < 1 second | Investigate if higher |
| CPUUtilization | < 80% | Scale up instance if sustained |
| FreeStorageSpace | > 20% | Enable autoscaling |
| DatabaseConnections | < 80% of max | Increase max_connections |

### PostgreSQL Monitoring Queries

**Check for table bloat**:
```sql
SELECT
    schemaname,
    tablename,
    n_dead_tup,
    n_live_tup,
    round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS size,
    last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

**Monitor long-running queries**:
```sql
SELECT
    pid,
    now() - query_start AS duration,
    state,
    query
FROM pg_stat_activity
WHERE state = 'active'
    AND query NOT LIKE '%pg_stat_activity%'
ORDER BY duration DESC;
```

**Check replication status**:
```sql
SELECT
    client_addr AS standby_ip,
    state,
    sync_state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    sync_priority,
    replay_lag
FROM pg_stat_replication;
```

**Monitor checkpoint activity**:
```sql
SELECT
    checkpoints_timed,
    checkpoints_req,
    checkpoint_write_time,
    checkpoint_sync_time,
    buffers_checkpoint,
    buffers_clean,
    buffers_backend
FROM pg_stat_bgwriter;
```

## Post-Bulk Update Maintenance

### Immediate Actions

```sql
-- Run VACUUM ANALYZE to reclaim space and update statistics
VACUUM ANALYZE table_name;

-- For entire database
VACUUM ANALYZE;

-- Check for bloat
SELECT pg_size_pretty(pg_total_relation_size('table_name'));
```

### If Significant Bloat (>40%)

```sql
-- VACUUM FULL reclaims space but requires exclusive lock
-- Schedule during maintenance window
VACUUM FULL table_name;

-- Or use REINDEX for indexes
REINDEX TABLE CONCURRENTLY table_name;
```

### Update Statistics

```sql
-- Ensure query planner has accurate statistics
ANALYZE table_name;

-- Or for specific columns
ANALYZE table_name (col1, col2);
```

## Performance Testing

### Before Bulk Update

```sql
-- Capture baseline statistics
CREATE TABLE baseline_stats AS
SELECT * FROM pg_stat_user_tables WHERE tablename = 'your_table';

-- Note current size
SELECT pg_size_pretty(pg_total_relation_size('your_table'));
```

### During Bulk Update

```bash
# Monitor from command line
watch -n 5 "psql -c \"SELECT state, count(*) FROM pg_stat_activity GROUP BY state;\""
```

### After Bulk Update

```sql
-- Compare statistics
SELECT
    b.n_tup_upd AS before_updates,
    a.n_tup_upd AS after_updates,
    a.n_tup_upd - b.n_tup_upd AS updates_performed,
    a.n_dead_tup AS dead_tuples
FROM pg_stat_user_tables a
JOIN baseline_stats b ON a.tablename = b.tablename
WHERE a.tablename = 'your_table';
```

## Cost Optimization

### Reserved Instances
- **1-year commitment**: ~34% savings
- **3-year commitment**: ~56% savings

### Savings Plans
- Flexible across instance families
- ~30-40% savings

### Right-sizing
```sql
-- Check actual resource usage
SELECT
    datname,
    numbackends AS connections,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();
```

**If cache hit ratio < 90%**: Consider more memory (larger instance)
**If CPU < 50% sustained**: Consider smaller instance

## Troubleshooting

### Issue: Bulk update is slow

**Check**:
1. Indexes on updated columns (consider dropping temporarily)
2. Triggers on table (consider disabling)
3. Foreign key constraints (can slow updates)
4. Autovacuum running concurrently (check pg_stat_activity)

### Issue: High replication lag

**Check**:
1. Network latency between AZs
2. Standby under heavy load
3. Large transactions (break into smaller batches)

**Solution**:
```sql
-- Break large updates into smaller transactions
DO $$
DECLARE
    batch_size INT := 10000;
    offset_val INT := 0;
    rows_affected INT;
BEGIN
    LOOP
        UPDATE table
        SET col = val
        WHERE id >= offset_val AND id < offset_val + batch_size;
        
        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        EXIT WHEN rows_affected = 0;
        
        offset_val := offset_val + batch_size;
        COMMIT;
    END LOOP;
END $$;
```

### Issue: Out of disk space

**Check**:
```sql
-- Check WAL file size
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'));

-- Check table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

**Solution**:
- Enable storage autoscaling
- Increase max_wal_size cautiously
- Run VACUUM to reclaim space

## Summary Checklist

- [ ] Use memory-optimized instance (r6i family)
- [ ] Configure gp3 storage with adequate IOPS
- [ ] Set shared_buffers to 25% of RAM
- [ ] Increase work_mem and maintenance_work_mem
- [ ] Configure aggressive autovacuum settings
- [ ] Batch updates into chunks (10,000 rows)
- [ ] Consider dropping indexes during bulk updates
- [ ] Monitor replication lag in Multi-AZ
- [ ] Run VACUUM ANALYZE after bulk updates
- [ ] Monitor CloudWatch metrics during updates
- [ ] Test in non-production environment first
- [ ] Schedule during low-traffic periods
- [ ] Have rollback plan ready

## Estimated Performance

**Typical bulk update performance** (db.r6i.xlarge):
- **Small updates** (< 100K rows): 1-5 minutes
- **Medium updates** (100K-1M rows): 5-30 minutes
- **Large updates** (1M-10M rows): 30-120 minutes
- **Very large updates** (> 10M rows): 2+ hours

**Factors affecting performance**:
- Number of indexes
- Row size
- Update complexity
- Concurrent activity
- Multi-AZ replication overhead (~10-20% slower than single-AZ)
