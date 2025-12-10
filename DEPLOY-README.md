# Aurora PostgreSQL IAM Authentication - CDK Deployment

Secure architecture with Lambda writing to Aurora PostgreSQL using IAM authentication only.

## Architecture

```
Lambda (IAM) → RDS Proxy (IAM + TLS) → Aurora PostgreSQL (IAM User)
```

## Prerequisites

- AWS CLI configured
- Node.js 18+ installed
- AWS account with permissions to create VPC, RDS, Lambda, IAM resources

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
npx cdk bootstrap
```

### 3. Deploy Stack

```bash
npx cdk deploy
```

Note the outputs:
- `ProxyEndpoint` - RDS Proxy endpoint
- `ClusterEndpoint` - Aurora cluster endpoint
- `SetupSQL` - SQL commands to run

### 4. Configure Database

Connect to Aurora using master credentials:

```bash
psql -h <ClusterEndpoint> -U postgres -d mydb
```

Run the SQL from `SetupSQL` output:

```sql
CREATE USER lambda_writer;
GRANT rds_iam TO lambda_writer;
ALTER USER lambda_writer SET rds.force_ssl = 1;

CREATE SCHEMA foo;
CREATE SCHEMA bar;

GRANT USAGE ON SCHEMA foo, bar TO lambda_writer;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA foo TO lambda_writer;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bar TO lambda_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT INSERT, UPDATE, DELETE ON TABLES TO lambda_writer;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA foo, bar TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT USAGE ON SEQUENCES TO lambda_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA bar GRANT USAGE ON SEQUENCES TO lambda_writer;
```

### 5. Create Test Tables

```sql
CREATE TABLE foo.table1 (id SERIAL PRIMARY KEY, col TEXT);
CREATE TABLE bar.table1 (id SERIAL PRIMARY KEY, col TEXT);
```

### 6. Test Lambda

Invoke the Lambda function:

```bash
aws lambda invoke --function-name <FunctionName> response.json
```

### 7. Verify

Check data was inserted:

```sql
SELECT * FROM foo.table1;
```

## Security Features

| Feature | Implementation |
|---------|----------------|
| Authentication | IAM only (no passwords) |
| Authorization | Write-only to `foo` and `bar` schemas |
| Network | Private subnets + security groups |
| Encryption | TLS enforced on all connections |
| Least Privilege | Lambda can only connect as `lambda_writer` |

## Troubleshooting

### Lambda cannot connect

Check:
1. Lambda is in VPC with NAT gateway
2. Security groups allow traffic
3. IAM role has `rds-db:connect` permission
4. Database user `lambda_writer` exists with `rds_iam` role

### Permission denied errors

Verify:
```sql
SELECT * FROM information_schema.role_table_grants 
WHERE grantee = 'lambda_writer';
```

### SSL errors

Ensure:
- `rds.force_ssl = 1` set on user
- Lambda connection uses `sslmode='require'`

## Cleanup

```bash
npx cdk destroy
```

## Cost Estimate

- Aurora Serverless v2: ~$0.12/ACU-hour (min 0.5 ACU)
- RDS Proxy: ~$0.015/hour
- NAT Gateway: ~$0.045/hour
- Lambda: Pay per invocation

**Estimated**: ~$50-100/month for dev environment
