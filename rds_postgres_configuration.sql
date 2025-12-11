-- ============================================
-- AWS RDS PostgreSQL Configuration Check
-- ============================================

-- 1. All Performance-Related Settings
SELECT 
    name,
    setting,
    unit,
    category,
    short_desc
FROM pg_settings
WHERE category IN (
    'Resource Usage / Memory',
    'Resource Usage / Kernel Resources',
    'Write-Ahead Log',
    'Query Tuning / Planner Cost Constants',
    'Query Tuning / Planner Method Configuration',
    'Query Tuning / Other Planner Options',
    'Connections and Authentication / Connection Settings',
    'Resource Usage / Asynchronous Behavior'
)
ORDER BY category, name;

-- 2. Critical Performance Parameters
SELECT 
    name,
    setting,
    unit,
    context,
    source
FROM pg_settings
WHERE name IN (
    'max_connections',
    'shared_buffers',
    'effective_cache_size',
    'maintenance_work_mem',
    'work_mem',
    'random_page_cost',
    'effective_io_concurrency',
    'wal_buffers',
    'checkpoint_completion_target',
    'max_wal_size',
    'min_wal_size',
    'default_statistics_target',
    'autovacuum',
    'autovacuum_max_workers',
    'autovacuum_naptime',
    'max_worker_processes',
    'max_parallel_workers_per_gather',
    'max_parallel_workers'
)
ORDER BY name;

-- 3. Memory Configuration Summary
SELECT 
    pg_size_pretty((SELECT setting::bigint * 8192 FROM pg_settings WHERE name='shared_buffers')) as shared_buffers,
    pg_size_pretty((SELECT setting::bigint * 1024 FROM pg_settings WHERE name='work_mem')) as work_mem,
    pg_size_pretty((SELECT setting::bigint * 1024 FROM pg_settings WHERE name='maintenance_work_mem')) as maintenance_work_mem,
    pg_size_pretty((SELECT setting::bigint * 1024 FROM pg_settings WHERE name='effective_cache_size')) as effective_cache_size,
    (SELECT setting FROM pg_settings WHERE name='max_connections') as max_connections;

-- 4. WAL Configuration
SELECT 
    name,
    setting,
    unit
FROM pg_settings
WHERE name LIKE 'wal_%' OR name LIKE '%checkpoint%'
ORDER BY name;

-- 5. Autovacuum Configuration
SELECT 
    name,
    setting,
    unit,
    short_desc
FROM pg_settings
WHERE name LIKE 'autovacuum%'
ORDER BY name;

-- 6. Query Planner Configuration
SELECT 
    name,
    setting,
    unit
FROM pg_settings
WHERE category LIKE 'Query Tuning%'
ORDER BY name;

-- 7. Extensions Installed
SELECT 
    extname,
    extversion,
    extrelocatable
FROM pg_extension
ORDER BY extname;

-- 8. Parameter Groups (RDS Specific - shows modified parameters)
SELECT 
    name,
    setting,
    boot_val,
    reset_val,
    source,
    sourcefile
FROM pg_settings
WHERE source != 'default' AND source != 'override'
ORDER BY name;
